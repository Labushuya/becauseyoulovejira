// GitHub channel (ADR-0050, plan beobachtete-quellen GH-1) against a fake of the GitHub API on
// 127.0.0.1 (tests/support/fake-github.mjs, invented repositories). The disposable instance runs in
// the test mode of the harness, so the client talks to the fake instead of api.github.com, and the
// cron rests: tests/fixtures/pb_hooks/github-cron.pb.js runs it with a given clock. Checked: the
// first run as base without a flood, conditional requests (304), a changed, new and removed
// watched file as entries with commits, lines, compare link, short diff and copy, the status of
// earlier entries, new patterns without a flood, pull requests and their status (the ticket stays
// as it is), releases, pagination, target projects of repository and connection, the checks of the
// settings, rate limits, errors of repository and connection, public repositories without a token,
// "Verbindung prüfen", the cron and the time of a run; GitHub is only read (GET) and the token never
// shows.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blobSha, startFakeGitHub } from '../support/fake-github.mjs';
import { writtenLogs } from '../support/logs.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';

// Invented tokens, built from parts so no scanner takes them for real ones.
const TOKEN = 'github' + '_pat_' + '11FAKE0ERFUNDEN0' + 'NurFuerTests_' + 'a'.repeat(50);
const WRONG = 'github' + '_pat_' + '11FAKE0FALSCH000' + 'NurFuerTests_' + 'b'.repeat(50);
// Time of one run in this instance: enough for a run against the local fake, short enough for the
// case of a slow GitHub.
const RUN_MS = scaled(8_000);

const FILES = {
	'README.md': '# Roadmap-Projekt\n',
	'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n- Start\n',
	'ROADMAP.md': '# Roadmap\n\n- Q4: Eingang\n',
	'docs/roadmap.md': '# Plan\n',
	'docs/guide.md': '# Anleitung\n',
	'src/app.js': 'console.log(1);\n'
};

let fake;
let instance;
let superuser;
let owner;
let other;
let responses = '';

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function user() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return { id: record.id, pb };
}

/**
 * A GitHub connection of `who`, created by the superuser with any settings; the way of a user
 * through the interface is web-data-github.test.mjs (GH-2).
 */
function connection(who, settings, data = {}) {
	return superuser.collection('connections').create({
		owner: who.id,
		type: 'github',
		label: 'GitHub',
		enabled: true,
		secret_env: 'BYL_GITHUB_TOKEN',
		settings,
		...data
	});
}

async function call(who, method, path, body) {
	const response = await fetch(`${instance.url}/api/byl/connections/${path}`, {
		method,
		headers: { Authorization: who.pb.authStore.token, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await response.text();
	responses += text;
	return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

const run = async (who, conn) => (await call(who, 'POST', `${conn.id}/run`)).body;
const details = async (who, conn) => (await call(who, 'GET', `${conn.id}/github`)).body;

function itemsOf(who, conn) {
	return who.pb.collection('inbox_items').getFullList({ sort: 'created,id', filter: who.pb.filter('connection = {:id}', { id: conn.id }) });
}

/** The entry of a source (source_ref) and version, newest first. */
async function entryOf(who, conn, title) {
	const items = await itemsOf(who, conn);
	return items.filter((item) => item.title === title);
}

async function originalOf(who, item) {
	const token = await who.pb.files.getToken();
	const response = await fetch(`${instance.url}/api/files/inbox_items/${item.id}/${item.original}?token=${token}`);
	return response.text();
}

function cron(now) {
	return superuser.send('/api/byl-test/github/cron', { method: 'POST', body: { now } });
}

beforeAll(async () => {
	fake = await startFakeGitHub({ token: TOKEN });
	instance = await startPocketBase({
		env: {
			BYL_TEST_GITHUB_PORT: String(fake.port),
			BYL_TEST_GITHUB_TIMING: String(RUN_MS),
			BYL_GITHUB_TOKEN: TOKEN,
			BYL_GITHUB_WRONG: WRONG
		}
	});
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await user();
	other = await user();
});

afterAll(async () => {
	await fake?.close();
	await instance?.stop();
});

beforeEach(() => fake.clear());

describe('first run and conditional requests', () => {
	const repo = 'octo/roadmap';
	let conn;

	it('takes the current state as base: no entry for files and releases, only the open pull requests', async () => {
		fake.addRepo(repo, { files: FILES });
		fake.openPull(repo, { title: 'Alt und offen' });
		fake.openPull(repo, { title: 'Alt geschlossen' });
		fake.updatePull(repo, 2, 'close');
		fake.openPull(repo, { title: 'Alt gemergt' });
		fake.updatePull(repo, 3, 'merge');
		fake.openPull(repo, { title: 'Entwurf', draft: true });
		fake.publishRelease(repo, { tag: 'v1.0.0', title: 'Erste' });
		fake.publishRelease(repo, { tag: 'v1.1.0', draft: true });
		conn = await connection(owner, { repos: [{ repo }] });

		expect(await run(owner, conn)).toMatchObject({ status: 'ok', created: 2, duplicates: 0, updated: 0, failed: 0, error: '' });
		const items = await itemsOf(owner, conn);
		expect(items.map((item) => [item.kind, item.title, item.watch])).toEqual([
			['pull_request', `PR #4 in ${repo}: Entwurf`, { kind: 'pull', state: 'open' }],
			['pull_request', `PR #1 in ${repo}: Alt und offen`, { kind: 'pull', state: 'open' }]
		]);
		expect(items.every((item) => item.channel === 'github' && item.state === 'new' && item.connection === conn.id)).toBe(true);
		expect(items[0].source_url).toBe(`https://github.com/${repo}/pull/4`);
		expect(items[0].body).toContain('- Entwurf: ja');

		const summary = await details(owner, conn);
		expect(summary).toMatchObject({ authenticated: true, interval: 15, limit: null });
		expect(summary.repos).toHaveLength(1);
		expect(summary.repos[0]).toMatchObject({
			repo,
			url: `https://github.com/${repo}`,
			branch: 'main',
			private: false,
			files: 4,
			openPulls: 2,
			openPullsMore: false,
			lastRelease: { tag: 'v1.0.0', name: 'Erste' },
			lastChange: null,
			error: ''
		});
		expect(summary.rate).toMatchObject({ limit: 5000 });
		expect(fake.requests.length).toBeGreaterThan(0);
		expect(fake.requests.every((request) => request.method === 'GET' && request.authorized)).toBe(true);
	});

	it('asks only conditionally without a change: three requests, all answered 304, none counted', async () => {
		const before = fake.rate('token').remaining;
		expect(await run(owner, conn)).toMatchObject({ status: 'ok', created: 0, duplicates: 0, updated: 0 });
		expect(fake.requests.map((request) => [request.path, request.conditional, request.status])).toEqual([
			[`/repos/${repo}/branches/main`, true, 304],
			[`/repos/${repo}/pulls`, true, 304],
			[`/repos/${repo}/releases`, true, 304]
		]);
		expect(fake.rate('token').remaining).toBe(before);
		const record = await owner.pb.collection('connections').getOne(conn.id);
		// The state of the channel never leaves the server.
		expect(record).not.toHaveProperty('watch');
		expect(record.last_error).toBe('');
		expect(record.last_hint).toBe('');
	});

	it('makes one entry of a changed CHANGELOG with commits, authors, lines, compare link, short diff and copy', async () => {
		fake.commit(repo, { files: { 'CHANGELOG.md': '# Changelog\n\n## 1.1.0\n- Eingang\n\n## 1.0.0\n- Start\n' }, message: 'Notiere 1.1.0', author: 'Anna Beispiel' });
		fake.commit(repo, { files: { 'src/app.js': 'console.log(2);\n' }, message: 'Code' });
		const last = fake.commit(repo, { files: { 'CHANGELOG.md': '# Changelog\n\n## 1.1.0\n- Eingang\n- Karten\n\n## 1.0.0\n- Start\n' }, message: 'Karten *dazu*', author: 'Ben Beispiel' });
		expect(await run(owner, conn)).toMatchObject({ status: 'ok', created: 1, updated: 0, failed: 0 });
		const [entry] = await entryOf(owner, conn, `CHANGELOG.md in ${repo} geändert`);
		const content = '# Changelog\n\n## 1.1.0\n- Eingang\n- Karten\n\n## 1.0.0\n- Start\n';
		expect(entry).toMatchObject({
			kind: 'change',
			source_ref: `file:${repo}:CHANGELOG.md`,
			source_url: `https://github.com/${repo}/blob/${last.sha}/CHANGELOG.md`,
			watch: { kind: 'file', state: 'current' }
		});
		expect(entry.source_meta.github).toMatchObject({ kind: 'file', repo, path: 'CHANGELOG.md', action: 'changed', sha: blobSha(content), additions: 4, deletions: 0, commits: 2, copy: 'complete' });
		expect(entry.body).toContain('- Zeilen: +4 / −0');
		expect(entry.body).toContain('- Autoren: Ben Beispiel, Anna Beispiel');
		expect(entry.body).toContain('Karten \\*dazu\\* – Ben Beispiel');
		expect(entry.body).toContain('Notiere 1.1.0 – Anna Beispiel');
		expect(entry.body).not.toContain('Code –');
		expect(entry.body).toContain(`/compare/`);
		expect(entry.body).toContain('```diff\n@@ -1,4 +1,8 @@');
		expect(entry.body).toContain(`**Neuer Inhalt:**\n\n${content.trimEnd()}`);
		expect(await originalOf(owner, entry)).toBe(content);
		// PocketBase stores the name in lower case with a suffix of its own.
		expect(entry.original).toMatch(/^changelog_\w+\.md$/i);
		const summary = await details(owner, conn);
		expect(summary.repos[0].lastChange).toMatchObject({ path: 'CHANGELOG.md', action: 'changed' });
	});

	it('shows earlier entries as changed since, and a version that comes back as current; one entry per version', async () => {
		fake.commit(repo, { files: { 'CHANGELOG.md': '# Changelog\n\n## 1.2.0\n- Mehr\n' }, message: 'Neu geschrieben' });
		expect(await run(owner, conn)).toMatchObject({ created: 1, updated: 1 });
		const first = (await entryOf(owner, conn, `CHANGELOG.md in ${repo} geändert`))[0];
		expect(first.watch).toMatchObject({ kind: 'file', state: 'changed' });
		expect(Date.parse(first.watch.since)).toBeGreaterThan(Date.parse(first.created.replace(' ', 'T')) - 120_000);

		// Back to the first changed version: no second entry of it, its status is current again.
		fake.commit(repo, { files: { 'CHANGELOG.md': '# Changelog\n\n## 1.1.0\n- Eingang\n- Karten\n\n## 1.0.0\n- Start\n' }, message: 'Zurück' });
		expect(await run(owner, conn)).toMatchObject({ created: 0, duplicates: 1, updated: 2 });
		const entries = await entryOf(owner, conn, `CHANGELOG.md in ${repo} geändert`);
		expect(entries.map((entry) => entry.watch.state)).toEqual(['current', 'changed']);
	});

	it('finds new and removed watched files; other files bring nothing', async () => {
		fake.commit(repo, { files: { 'docs/plan/roadmap.md': '# Roadmap 2027\n', 'src/app.js': 'console.log(3);\n', 'CHANGELOG.md': null } });
		expect(await run(owner, conn)).toMatchObject({ created: 2, updated: 2 });
		const [added] = await entryOf(owner, conn, `docs/plan/roadmap.md in ${repo} neu`);
		expect(added).toMatchObject({ kind: 'change', watch: { kind: 'file', state: 'current' } });
		expect(added.body).toContain('# Roadmap 2027');
		const [removed] = await entryOf(owner, conn, `CHANGELOG.md in ${repo} gelöscht`);
		expect(removed.watch).toBeNull();
		expect(removed.original).toBe('');
		expect(removed.source_meta.github.version).toMatch(/^removed-[0-9a-f]{40}$/);
		const earlier = await entryOf(owner, conn, `CHANGELOG.md in ${repo} geändert`);
		expect(earlier.map((entry) => entry.watch.state)).toEqual(['gone', 'gone']);
		expect((await itemsOf(owner, conn)).some((item) => item.title.includes('src/app.js'))).toBe(false);
	});

	it('takes new patterns as base: no flood, and only later changes become entries', async () => {
		const settings = { repos: [{ repo, paths: ['ROADMAP*', 'CHANGELOG*', 'docs/**/*.md'] }] };
		await owner.pb.collection('connections').update(conn.id, { settings });
		const count = (await itemsOf(owner, conn)).length;
		expect(await run(owner, conn)).toMatchObject({ created: 0 });
		expect(await itemsOf(owner, conn)).toHaveLength(count);
		expect((await details(owner, conn)).repos[0].files).toBe(4);

		fake.commit(repo, { files: { 'docs/guide.md': '# Anleitung\n\nNeu\n', 'README.md': '# Anders\n' } });
		expect(await run(owner, conn)).toMatchObject({ created: 1 });
		expect(await entryOf(owner, conn, `docs/guide.md in ${repo} geändert`)).toHaveLength(1);
		expect(await entryOf(owner, conn, `README.md in ${repo} geändert`)).toHaveLength(0);
		expect(await entryOf(owner, conn, `README.md in ${repo} gelöscht`)).toHaveLength(0);
	});
});

describe('pull requests and releases', () => {
	const repo = 'octo/prs';
	let conn;

	it('take new pull requests and follow their state; the ticket of an entry stays as it is', async () => {
		fake.addRepo(repo, { files: FILES });
		fake.openPull(repo, { title: 'Offen vor dem Start' });
		fake.openPull(repo, { title: 'Geschlossen vor dem Start' });
		fake.updatePull(repo, 2, 'close');
		conn = await connection(owner, { repos: [{ repo }] });
		expect(await run(owner, conn)).toMatchObject({ created: 1 });

		fake.openPull(repo, { title: 'Neu', body: 'Bitte **prüfen**.' });
		expect(await run(owner, conn)).toMatchObject({ created: 1, updated: 0 });
		const [entry] = await entryOf(owner, conn, `PR #3 in ${repo}: Neu`);
		expect(entry.watch).toEqual({ kind: 'pull', state: 'open' });
		expect(entry.body).toContain('Bitte **prüfen**.');
		const ticket = await owner.pb.collection('tickets').create({ owner: owner.id, title: 'Aus dem PR', source_item: entry.id });
		const history = await owner.pb.collection('ticket_history').getFullList({ filter: owner.pb.filter('ticket = {:id}', { id: ticket.id }) });

		const merged = fake.updatePull(repo, 3, 'merge');
		fake.updatePull(repo, 1, 'close');
		// A closed pull request of before the base that changes again stays out.
		fake.updatePull(repo, 2, { title: 'Umbenannt' });
		expect(await run(owner, conn)).toMatchObject({ created: 0, updated: 2 });
		const after = await owner.pb.collection('inbox_items').getOne(entry.id);
		expect(after.watch).toEqual({ kind: 'pull', state: 'merged', since: new Date(merged.merged_at).toISOString() });
		expect(after.state).toBe('converted');
		const [older] = await entryOf(owner, conn, `PR #1 in ${repo}: Offen vor dem Start`);
		expect(older.watch).toMatchObject({ kind: 'pull', state: 'closed' });
		expect((await itemsOf(owner, conn)).some((item) => item.title.includes('#2'))).toBe(false);
		const unchanged = await owner.pb.collection('tickets').getOne(ticket.id);
		expect(unchanged.updated).toBe(ticket.updated);
		expect(await owner.pb.collection('ticket_history').getFullList({ filter: owner.pb.filter('ticket = {:id}', { id: ticket.id }) })).toHaveLength(history.length);
		expect((await details(owner, conn)).repos[0].openPulls).toBe(0);

		fake.updatePull(repo, 1, 'reopen');
		expect(await run(owner, conn)).toMatchObject({ updated: 1 });
		expect((await entryOf(owner, conn, `PR #1 in ${repo}: Offen vor dem Start`))[0].watch).toEqual({ kind: 'pull', state: 'open' });
	});

	it('take a published release, never a draft', async () => {
		fake.publishRelease(repo, { tag: 'v2.0.0-rc.1', title: 'Kandidat', prerelease: true, body: 'Notizen' });
		fake.publishRelease(repo, { tag: 'v2.0.0', draft: true });
		expect(await run(owner, conn)).toMatchObject({ created: 1 });
		const [release] = await entryOf(owner, conn, `Release v2.0.0-rc.1 in ${repo}: Kandidat`);
		expect(release).toMatchObject({ kind: 'release', watch: null, source_url: `https://github.com/${repo}/releases/tag/v2.0.0-rc.1` });
		expect(release.body).toContain('- Vorabversion: ja');
		expect((await details(owner, conn)).repos[0].lastRelease).toMatchObject({ tag: 'v2.0.0-rc.1', prerelease: true });
		expect(await run(owner, conn)).toMatchObject({ created: 0 });
	});

	it('read every page: 150 open pull requests are counted, the newest 20 come in', async () => {
		const busy = 'octo/busy';
		fake.addRepo(busy, { files: FILES });
		for (let number = 1; number <= 150; number += 1) fake.openPull(busy, { title: `Viel ${number}` });
		const crowded = await connection(owner, { repos: [{ repo: busy, events: { files: false, releases: false } }] });
		expect(await run(owner, crowded)).toMatchObject({ created: 20 });
		const titles = (await itemsOf(owner, crowded)).map((item) => item.title);
		expect(titles[0]).toBe(`PR #150 in ${busy}: Viel 150`);
		expect(titles).not.toContain(`PR #130 in ${busy}: Viel 130`);
		expect((await details(owner, crowded)).repos[0]).toMatchObject({ openPulls: 150, openPullsMore: false });
		expect(fake.requests.some((request) => request.path === `/repos/${busy}/pulls` && request.query.page === '2')).toBe(true);
		expect(fake.requests.some((request) => request.path.includes('/branches/') || request.path.includes('/releases'))).toBe(false);
	});
});

describe('target project of repository and connection (ADR-0049 §3)', () => {
	it('gives entries the target of their repository, else the one of the connection', async () => {
		const own = await owner.pb.collection('projects').create({ owner: owner.id, name: 'Eigen', code: 'EIGEN' });
		const shared = await owner.pb.collection('projects').create({ owner: owner.id, name: 'Allgemein', code: 'ALLG' });
		fake.addRepo('octo/target-a', { files: FILES });
		fake.addRepo('octo/target-b', { files: FILES });
		const conn = await connection(owner, { repos: [{ repo: 'octo/target-a' }, { repo: 'octo/target-b' }] });
		await owner.pb.collection('connections').update(conn.id, {
			target_project: shared.id,
			settings: { repos: [{ repo: 'octo/target-a', target: own.id }, { repo: 'octo/target-b' }] }
		});
		await run(owner, conn);
		fake.openPull('octo/target-a', { title: 'A' });
		fake.openPull('octo/target-b', { title: 'B' });
		expect(await run(owner, conn)).toMatchObject({ created: 2 });
		const items = await itemsOf(owner, conn);
		expect(items.map((item) => [item.title, item.target_project])).toEqual([
			['PR #1 in octo/target-a: A', own.id],
			['PR #1 in octo/target-b: B', shared.id]
		]);

		// A deleted target of a repository counts as none: the target of the connection applies.
		await owner.pb.collection('projects').delete(own.id);
		fake.openPull('octo/target-a', { title: 'A2' });
		expect(await run(owner, conn)).toMatchObject({ created: 1 });
		const [later] = await entryOf(owner, conn, 'PR #2 in octo/target-a: A2');
		expect(later.target_project).toBe(shared.id);
	});

	it('takes only an active project of the area as new target of a repository', async () => {
		const archived = await owner.pb.collection('projects').create({ owner: owner.id, name: 'Alt', code: 'ALT' });
		await owner.pb.collection('projects').update(archived.id, { archived: true });
		const foreign = await other.pb.collection('projects').create({ owner: other.id, name: 'Fremd', code: 'FREMD' });
		const conn = await connection(owner, { repos: [{ repo: 'octo/target-a' }] });
		const attempt = (target) => owner.pb.collection('connections').update(conn.id, { settings: { repos: [{ repo: 'octo/target-a', target }] } });
		await expect(attempt(archived.id)).rejects.toMatchObject({ status: 400, response: { data: { settings: { code: 'validation_target_project_archived' } } } });
		await expect(attempt(foreign.id)).rejects.toMatchObject({ status: 400, response: { data: { settings: { code: 'validation_target_project_missing' } } } });
		await expect(attempt('abcdefghijklmno')).rejects.toMatchObject({ status: 400, response: { data: { settings: { code: 'validation_target_project_missing' } } } });
	});
});

describe('settings, the status field and rights', () => {
	it('refuses bad settings with their codes', async () => {
		const conn = await connection(owner, {});
		const attempt = (settings) => owner.pb.collection('connections').update(conn.id, { settings });
		const cases = [
			[{ repos: [{ repo: 'octo' }] }, 'validation_github_repo'],
			[{ repos: [{ repo: 'a/b', paths: ['/x'] }] }, 'validation_github_paths'],
			[{ repos: [{ repo: 'a/b' }, { repo: 'A/B' }] }, 'validation_github_repo_duplicate'],
			[{ interval: 2 }, 'validation_github_interval'],
			[{ keywords: ['todo'] }, 'validation_github_settings']
		];
		for (const [settings, code] of cases) {
			await expect(attempt(settings), code).rejects.toMatchObject({ status: 400, response: { data: { settings: { code } } } });
		}
		// The state of the channel is hidden: PocketBase drops it from a request of a client, and the
		// hook would refuse it anyway (connection-rules SERVER_FIELDS, unit test).
		await run(owner, conn);
		const stored = (await superuser.collection('connections').getOne(conn.id)).watch;
		expect(stored).toMatchObject({ repos: {}, limit: null });
		await owner.pb.collection('connections').update(conn.id, { watch: { repos: { 'x/y': {} } } });
		expect((await superuser.collection('connections').getOne(conn.id)).watch).toEqual(stored);
	});

	it('lets no client write the status of an entry', async () => {
		const item = await owner.pb.collection('inbox_items').create({ owner: owner.id, channel: 'manual', kind: 'todo', title: 'Hand', watch: { kind: 'pull', state: 'merged' } });
		expect(item.watch).toBeNull();
		await expect(owner.pb.collection('inbox_items').update(item.id, { watch: { kind: 'file', state: 'gone' } })).rejects.toMatchObject({
			status: 400,
			response: { data: { watch: { code: 'validation_inbox_immutable' } } }
		});
	});

	it('answers 404 for connections of others and of other kinds', async () => {
		const conn = await connection(owner, {});
		expect((await call(other, 'GET', `${conn.id}/github`)).status).toBe(404);
		expect((await call(other, 'POST', `${conn.id}/github/check`)).status).toBe(404);
		const calendar = await superuser.collection('connections').create({ owner: owner.id, type: 'calendar', label: 'K', enabled: true, secret_env: 'BYL_KALENDER' });
		expect((await call(owner, 'GET', `${calendar.id}/github`)).status).toBe(404);
	});
});

describe('rate limits (ADR-0050 §6)', () => {
	it('stops at the primary limit, says when the next run may ask, and the cron waits until then', async () => {
		fake.addRepo('octo/limit', { files: FILES });
		const conn = await connection(owner, { interval: 5, repos: [{ repo: 'octo/limit' }] });
		await run(owner, conn);
		const reset = Math.floor(Date.now() / 1000) + 600;
		fake.setRate('token', 0, reset);
		fake.commit('octo/limit', { files: { 'CHANGELOG.md': '# neu\n' } });
		const result = await run(owner, conn);
		expect(result).toMatchObject({ status: 'limited', until: new Date(reset * 1000 + 1000).toISOString(), created: 0 });
		expect(result.hint).toMatch(/^GitHub-Anfragelimit erreicht\. Nächster Abruf ab \d\d\.\d\d\.\d{4}, \d\d:\d\d\.$/);
		const record = await owner.pb.collection('connections').getOne(conn.id);
		expect(record.last_error).toBe('');
		expect(record.last_hint).toBe(result.hint);
		expect((await details(owner, conn)).limit).toMatchObject({ kind: 'primary' });

		// Before the reset the cron leaves the connection alone, also when its interval has passed.
		fake.clear();
		await cron(Date.now() + 6 * 60 * 1000);
		expect(fake.requests.filter((request) => request.path.includes('octo/limit'))).toEqual([]);
		// "Jetzt abrufen" asks GitHub neither.
		expect(await run(owner, conn)).toMatchObject({ status: 'limited' });
		expect(fake.requests.filter((request) => request.path.includes('octo/limit'))).toEqual([]);

		fake.setRate('token', 5000, reset + 3600);
		await cron(reset * 1000 + 60_000);
		expect(fake.requests.some((request) => request.path === '/repos/octo/limit/branches/main')).toBe(true);
		expect(await entryOf(owner, conn, 'CHANGELOG.md in octo/limit geändert')).toHaveLength(1);
	});

	it('waits after a secondary limit as long as Retry-After says', async () => {
		fake.addRepo('octo/secondary', { files: FILES });
		const conn = await connection(owner, { interval: 5, repos: [{ repo: 'octo/secondary' }] });
		await run(owner, conn);
		fake.openPull('octo/secondary', { title: 'Wartet' });
		fake.inject({ path: /\/repos\/octo\/secondary\/pulls$/, status: 429, headers: { 'retry-after': '120' }, body: { message: 'You have exceeded a secondary rate limit.' } });
		const started = Date.now();
		const result = await run(owner, conn);
		expect(result.status).toBe('limited');
		expect(Date.parse(result.until)).toBeGreaterThanOrEqual(started + 119_000);
		expect(result.hint).toMatch(/^GitHub bremst gerade die Anfragen\./);
		expect((await details(owner, conn)).limit).toMatchObject({ kind: 'secondary' });
		await cron(Date.parse(result.until) + 5 * 60 * 1000);
		expect(await entryOf(owner, conn, 'PR #1 in octo/secondary: Wartet')).toHaveLength(1);
	});
});

describe('errors, public repositories and "Verbindung prüfen"', () => {
	it('names an error of one repository at it and goes on with the others', async () => {
		fake.addRepo('octo/fine', { files: FILES });
		const conn = await connection(owner, { repos: [{ repo: 'octo/missing' }, { repo: 'octo/fine' }] });
		expect(await run(owner, conn)).toMatchObject({ status: 'ok', error: '' });
		const summary = await details(owner, conn);
		expect(summary.repos[0].error).toContain('nicht gefunden oder kein Zugriff (404)');
		expect(summary.repos[1]).toMatchObject({ error: '', files: 4 });
		expect((await owner.pb.collection('connections').getOne(conn.id)).last_hint).toBe('1 Repository mit Fehler; der Grund steht in den Details.');
	});

	it('stores an error of the token at the connection, without the token', async () => {
		fake.addRepo('octo/token', { files: FILES });
		const conn = await connection(owner, { repos: [{ repo: 'octo/token' }] }, { secret_env: 'BYL_GITHUB_WRONG' });
		const result = await run(owner, conn);
		expect(result.status).toBe('error');
		expect(result.error).toContain('GitHub lehnt den Token ab (401). Stimmt der Wert von BYL_GITHUB_WRONG');
		expect((await owner.pb.collection('connections').getOne(conn.id)).last_error).toBe(result.error);
	});

	it('reads public repositories without a token, a private one only with it', async () => {
		fake.addRepo('octo/public', { files: FILES });
		fake.addRepo('octo/private', { files: FILES, private: true });
		const conn = await connection(owner, { repos: [{ repo: 'octo/public' }, { repo: 'octo/private' }] }, { secret_env: 'BYL_GITHUB_NONE' });
		expect(await run(owner, conn)).toMatchObject({ status: 'ok' });
		const summary = await details(owner, conn);
		expect(summary.authenticated).toBe(false);
		expect(summary.repos[0]).toMatchObject({ files: 4, error: '' });
		expect(summary.repos[1].error).toContain('(404)');
		expect(fake.requests.every((request) => !request.authorized)).toBe(true);
		const withToken = await connection(owner, { repos: [{ repo: 'octo/private' }] });
		await run(owner, withToken);
		expect((await details(owner, withToken)).repos[0]).toMatchObject({ files: 4, private: true, error: '' });
	});

	it('checks the token, the limit and every repository on request', async () => {
		const conn = await connection(owner, { repos: [{ repo: 'octo/fine' }, { repo: 'octo/missing' }] });
		const result = await call(owner, 'POST', `${conn.id}/github/check`);
		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({ status: 'ok', authenticated: true, login: 'anna', rate: { limit: 5000 } });
		expect(result.body.repos).toEqual([
			{ repo: 'octo/fine', ok: true, name: 'octo/fine', private: false, message: '' },
			{ repo: 'octo/missing', ok: false, name: 'octo/missing', private: false, message: expect.stringContaining('(404)') }
		]);
		expect((await owner.pb.collection('connections').getOne(conn.id)).last_ok_at).not.toBe('');
		const anonymous = await connection(owner, { repos: [{ repo: 'octo/fine' }] }, { secret_env: 'BYL_GITHUB_NONE' });
		expect((await call(owner, 'POST', `${anonymous.id}/github/check`)).body).toMatchObject({ status: 'ok', authenticated: false, login: '', rate: { limit: 60 } });
		const wrong = await connection(owner, {}, { secret_env: 'BYL_GITHUB_WRONG' });
		const refused = (await call(owner, 'POST', `${wrong.id}/github/check`)).body;
		expect(refused).toMatchObject({ status: 'error', message: expect.stringContaining('(401)') });
		expect((await owner.pb.collection('connections').getOne(wrong.id)).last_error).toBe(refused.message);
	});
});

describe('cron and the time of a run', () => {
	it('registers the job and runs a connection once its interval has passed', async () => {
		const crons = await superuser.send('/api/crons', {});
		expect(crons).toContainEqual(expect.objectContaining({ id: 'byl-github', expression: '* * * * *' }));
		fake.addRepo('octo/cron', { files: FILES });
		const conn = await connection(owner, { interval: 30, repos: [{ repo: 'octo/cron' }] });
		await run(owner, conn);
		const ran = () => fake.requests.some((request) => request.path.startsWith('/repos/octo/cron/'));
		fake.clear();
		await cron(Date.now() + 10 * 60 * 1000);
		expect(ran()).toBe(false);
		await cron(Date.now() + 30 * 60 * 1000);
		expect(ran()).toBe(true);
	});

	it('leaves the rest for the next run when GitHub answers too slowly', async () => {
		fake.addRepo('octo/slow-a', { files: FILES });
		fake.addRepo('octo/slow-b', { files: FILES });
		const conn = await connection(owner, { repos: [{ repo: 'octo/slow-a' }, { repo: 'octo/slow-b' }] });
		fake.slow(Math.round(RUN_MS * 0.4));
		const result = await run(owner, conn);
		fake.slow(0);
		expect(result).toMatchObject({ status: 'ok', error: '' });
		expect((await owner.pb.collection('connections').getOne(conn.id)).last_hint).toBe('Nicht alle Repositorys geschafft; der Rest folgt beim nächsten Abruf.');
		expect(fake.requests.some((request) => request.path.startsWith('/repos/octo/slow-b'))).toBe(false);
		expect(await run(owner, conn)).toMatchObject({ status: 'ok' });
		expect((await details(owner, conn)).repos.map((repo) => repo.files)).toEqual([4, 4]);
	});
});

describe('repositories of the token and "Alle meine Repositorys" (addendum of 2026-10-02)', () => {
	const repos = async (who, conn, refresh = false) => (await call(who, 'GET', `${conn.id}/github/repos${refresh ? '?refresh=1' : ''}`)).body;
	const hint = async (conn) => (await owner.pb.collection('connections').getOne(conn.id)).last_hint;
	/** The cron of this block runs only `keep`: every other GitHub connection rests. */
	const restOthers = async (keep) => {
		for (const record of await superuser.collection('connections').getFullList({ filter: 'type = "github" && enabled = true' })) {
			if (record.id !== keep?.id) await superuser.collection('connections').update(record.id, { enabled: false });
		}
	};
	let auto;

	beforeAll(async () => {
		await restOthers(null);
		fake.addRepo('anna/roadmap', { files: FILES });
		fake.addRepo('anna/notes', { files: FILES, private: true });
		fake.addRepo('anna/alt', { files: FILES, archived: true });
		fake.addRepo('anna/gabel', { files: FILES, fork: true });
		fake.addRepo('octo-org/team', { files: FILES, org: true, private: true });
		// More than one page of 100, from another account.
		for (let i = 0; i < 101; i += 1) fake.addRepo(`ben/r${String(i).padStart(3, '0')}`, { empty: true });
	});

	it('lists the repositories of the token over every page and marks entered, automatic and excluded ones', async () => {
		const conn = await connection(owner, { repos: [{ repo: 'anna/notes' }], exclude: ['anna/roadmap'] });
		const list = await repos(owner, conn);
		expect(list).toMatchObject({ status: 'ok', message: '', login: 'anna', more: false });
		const byName = new Map(list.repos.map((entry) => [entry.repo, entry]));
		expect(byName.get('anna/notes')).toEqual({ repo: 'anna/notes', private: true, archived: false, fork: false, org: false, own: true, state: 'entered' });
		expect(byName.get('anna/roadmap')).toMatchObject({ own: true, state: 'excluded' });
		expect(byName.get('anna/alt')).toMatchObject({ archived: true, own: true, state: '' });
		expect(byName.get('anna/gabel')).toMatchObject({ fork: true, own: true });
		expect(byName.get('octo-org/team')).toMatchObject({ org: true, own: false, private: true });
		expect(byName.get('ben/r100')).toMatchObject({ own: false });
		expect(byName.has('octo/roadmap')).toBe(true);
		const lists = fake.requests.filter((request) => request.path === '/user/repos');
		expect(lists.length).toBeGreaterThan(1);
		expect(lists.every((request) => request.authorized && request.query.affiliation === 'owner,collaborator,organization_member' && request.query.per_page === '100')).toBe(true);
		expect(fake.requests.some((request) => request.path === '/user')).toBe(true);
		// Within the hour the stored list answers, even with refresh=1 (at most once a minute).
		fake.clear();
		expect((await repos(owner, conn)).repos).toHaveLength(list.repos.length);
		expect((await repos(owner, conn, true)).repos).toHaveLength(list.repos.length);
		expect(fake.requests).toEqual([]);
		// The list stays in the server.
		expect(await owner.pb.collection('connections').getOne(conn.id)).not.toHaveProperty('watch');
	});

	it('names no list without a token and an error of the token without the token', async () => {
		const none = await connection(owner, {}, { secret_env: 'BYL_GITHUB_NONE' });
		expect(await repos(owner, none)).toMatchObject({ status: 'no_token', message: expect.stringMatching(/^Ohne Token nennt GitHub keine Liste/), repos: [] });
		const wrong = await connection(owner, {}, { secret_env: 'BYL_GITHUB_WRONG' });
		expect(await repos(owner, wrong)).toMatchObject({ status: 'error', message: expect.stringContaining('(401)'), repos: [] });
		expect((await call(other, 'GET', `${none.id}/github/repos`)).status).toBe(404);
	});

	it('lists only the granted repositories of a fine-grained token with "Only select repositories"', async () => {
		fake.grantOnly(['anna/roadmap', 'anna/notes']);
		try {
			const conn = await connection(owner, {});
			expect((await repos(owner, conn)).repos.map((entry) => entry.repo)).toEqual(['anna/notes', 'anna/roadmap']);
		} finally {
			fake.grantOnly(null);
		}
	});

	it('watches every own repository with the defaults, without a flood: no fork, nothing archived, no organization', async () => {
		fake.openPull('anna/roadmap', { title: 'Offen von vorher' });
		auto = await connection(owner, { auto: true });
		expect(await run(owner, auto)).toMatchObject({ status: 'ok', created: 0, error: '' });
		expect(await itemsOf(owner, auto)).toEqual([]);
		expect(await hint(auto)).toBe('Alle meine Repositorys: 2 Repositorys werden jetzt beobachtet.');
		const summary = await details(owner, auto);
		expect(summary.repos.map((entry) => [entry.repo, entry.auto])).toEqual([
			['anna/notes', true],
			['anna/roadmap', true]
		]);
		expect(summary.repos.every((entry) => entry.files === 4 && entry.target === '' && entry.events.files && entry.paths.includes('CHANGELOG*'))).toBe(true);
		expect(summary.repos.find((entry) => entry.repo === 'anna/roadmap').openPulls).toBe(1);
		expect(summary.auto).toMatchObject({ enabled: true, login: 'anna', count: 2, more: 0, added: ['anna/notes', 'anna/roadmap'], removed: [], error: '', excluded: [] });
		// Unchanged: the next run asks conditionally and changes nothing.
		fake.clear();
		expect(await run(owner, auto)).toMatchObject({ status: 'ok', created: 0 });
		expect(await hint(auto)).toBe('');
		expect(fake.requests.some((request) => request.path.startsWith('/user'))).toBe(false);
		// After the base, a new pull request comes in as usual.
		fake.openPull('anna/roadmap', { title: 'Neu nach der Basis' });
		expect(await run(owner, auto)).toMatchObject({ created: 1 });
		expect((await itemsOf(owner, auto)).map((item) => item.title)).toEqual(['PR #2 in anna/roadmap: Neu nach der Basis']);
	});

	it('reads the list again after an hour with ETag: new repositories come, archived and deleted ones go, with a hint', async () => {
		await restOthers(auto);
		const before = fake.rate('token').remaining;
		fake.clear();
		await cron(Date.now() + 2 * 60 * 60 * 1000);
		// Unchanged list: every page and the user answered 304, none counted.
		const listed = fake.requests.filter((request) => request.path === '/user' || request.path === '/user/repos');
		expect(listed.length).toBeGreaterThan(1);
		expect(listed.every((request) => request.conditional && request.status === 304)).toBe(true);
		expect(fake.rate('token').remaining).toBe(before);

		fake.addRepo('anna/neu', { files: FILES });
		fake.archive('anna/notes');
		fake.clear();
		await cron(Date.now() + 4 * 60 * 60 * 1000);
		expect(await hint(auto)).toBe('Alle meine Repositorys: neu beobachtet anna/neu; nicht mehr beobachtet anna/notes (archiviert).');
		const summary = await details(owner, auto);
		expect(summary.repos.map((entry) => entry.repo).sort()).toEqual(['anna/neu', 'anna/roadmap']);
		expect(summary.auto).toMatchObject({ count: 2, added: ['anna/neu'], removed: [{ repo: 'anna/notes', reason: 'archived' }] });
		// The new repository starts with a base, no entry.
		expect((await itemsOf(owner, auto)).map((item) => item.title)).toEqual(['PR #2 in anna/roadmap: Neu nach der Basis']);

		fake.removeRepo('anna/neu');
		await cron(Date.now() + 6 * 60 * 60 * 1000);
		expect(await hint(auto)).toBe('Alle meine Repositorys: nicht mehr beobachtet anna/neu (nicht mehr da).');
	});

	it('lets single repositories be set on their own or excluded', async () => {
		await owner.pb.collection('connections').update(auto.id, {
			settings: { auto: true, repos: [{ repo: 'anna/roadmap', paths: ['CHANGELOG*'], events: { files: true, pulls: false, releases: false }, target: '' }] }
		});
		await run(owner, auto);
		let summary = await details(owner, auto);
		expect(summary.repos).toHaveLength(1);
		expect(summary.repos[0]).toMatchObject({ repo: 'anna/roadmap', auto: false, paths: ['CHANGELOG*'], events: { files: true, pulls: false, releases: false } });
		// Entering a watched repository is no removal: no hint.
		expect(await hint(auto)).toBe('');

		await owner.pb.collection('connections').update(auto.id, { settings: { auto: true, exclude: ['anna/roadmap'] } });
		await run(owner, auto);
		summary = await details(owner, auto);
		expect(summary.repos).toEqual([]);
		expect(summary.auto).toMatchObject({ count: 0, excluded: ['anna/roadmap'] });
		expect(await hint(auto)).toBe('');
		const list = await repos(owner, auto);
		expect(list.repos.find((entry) => entry.repo === 'anna/roadmap').state).toBe('excluded');
	});

	it('needs a token: without one only the entered repositories, with a neutral hint', async () => {
		fake.addRepo('anna/offen', { files: FILES });
		const conn = await connection(owner, { auto: true, repos: [{ repo: 'anna/offen' }] }, { secret_env: 'BYL_GITHUB_NONE' });
		fake.clear();
		expect(await run(owner, conn)).toMatchObject({ status: 'ok', error: '' });
		expect(await hint(conn)).toMatch(/^„Alle meine Repositorys“ braucht ein Token/);
		expect(fake.requests.some((request) => request.path.startsWith('/user'))).toBe(false);
		expect((await details(owner, conn)).repos.map((entry) => entry.repo)).toEqual(['anna/offen']);
	});

	it('refuses bad values of the option with their codes', async () => {
		const attempt = (settings) => owner.pb.collection('connections').update(auto.id, { settings });
		for (const [settings, code] of [
			[{ auto: 'ja' }, 'validation_github_auto'],
			[{ exclude: ['kein name'] }, 'validation_github_exclude']
		]) {
			await expect(attempt(settings), code).rejects.toMatchObject({ status: 400, response: { data: { settings: { code } } } });
		}
	});
});

describe('only reading, never the token', () => {
	it('sent GitHub nothing but GET and showed the token nowhere', async () => {
		expect(fake.methods()).toEqual(['GET']);
		const records = JSON.stringify(await superuser.collection('connections').getFullList());
		const items = JSON.stringify(await superuser.collection('inbox_items').getFullList());
		const logs = JSON.stringify(await writtenLogs(superuser));
		for (const text of [responses, records, items, logs, instance.output()]) {
			expect(text).not.toContain(TOKEN);
			expect(text).not.toContain(WRONG);
		}
	});
});
