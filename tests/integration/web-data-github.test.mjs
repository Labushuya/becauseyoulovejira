// Data layer of the GitHub channel (web/src/lib/data/connections.ts, data/github.ts and the field
// watch of data/inbox.ts; ADR-0050 §7, plan beobachtete-quellen GH-2) against a disposable
// PocketBase in the test mode and the fake of the GitHub API (tests/support/fake-github.mjs,
// invented repositories): a user creates the connection with its first repository, adds one with
// its own target project, changes the interval, runs it, reads the details and checks it, all in
// the shapes of the SPA; refusals of the hook come as field errors with the texts of the
// interface; an entry of a watched file carries its status into the inbox and the sources of a
// ticket; a rate limit comes as "limited" with its hint.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeGitHub } from '../support/fake-github.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';
import {
	createConnection,
	getConnection,
	runConnection,
	saveGitHubSettings
} from '../../web/src/lib/data/connections.ts';
import { DataError } from '../../web/src/lib/data/errors.ts';
import { checkGitHub, getGitHubDetails, listGitHubRepos } from '../../web/src/lib/data/github.ts';
import { listNewItems } from '../../web/src/lib/data/inbox.ts';
import { emptyConnectionDraft } from '../../web/src/lib/domain/connections.ts';
import {
	EMPTY_GITHUB_SETTINGS,
	GITHUB_DEFAULT_PATHS,
	GITHUB_MESSAGES,
	githubSettingsOf
} from '../../web/src/lib/domain/github.ts';
import { TARGET_MESSAGES } from '../../web/src/lib/domain/target-project.ts';

// An invented token, built from parts so no scanner takes it for a real one.
const TOKEN = 'github' + '_pat_' + '11FAKE0ERFUNDEN0' + 'NurFuerTests_' + 'c'.repeat(50);
const RUN_MS = scaled(8_000);

const FILES = {
	'README.md': '# Roadmap-Projekt\n',
	'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n- Start\n',
	'src/app.js': 'console.log(1);\n'
};

let fake;
let instance;
let pb;
let ownerId;
let connection;

function repo(name, overrides = {}) {
	return {
		repo: name,
		paths: [...GITHUB_DEFAULT_PATHS],
		events: { files: true, pulls: true, releases: true },
		target: null,
		...overrides
	};
}

/** Settings of a connection: the defaults with `value` (interval, repos, auto, exclude). */
function settings(value) {
	return { ...EMPTY_GITHUB_SETTINGS, ...value };
}

beforeAll(async () => {
	fake = await startFakeGitHub({ token: TOKEN });
	fake.addRepo('octo/roadmap', { files: FILES, private: true });
	fake.addRepo('octo/site', { files: FILES });
	instance = await startPocketBase({
		env: {
			BYL_TEST_GITHUB_PORT: String(fake.port),
			BYL_TEST_GITHUB_TIMING: String(RUN_MS),
			BYL_GITHUB_TOKEN: TOKEN
		}
	});
	const superuser = new PocketBase(instance.url);
	superuser.autoCancellation(false);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const user = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	ownerId = user.id;
	pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	await pb.collection('users').authWithPassword(email, password);
});

afterAll(async () => {
	await fake?.close();
	await instance?.stop();
});

describe('data layer of the GitHub channel', () => {
	it('creates the connection with its first repository and the default interval', async () => {
		connection = await createConnection(pb, {
			...emptyConnectionDraft('github'),
			label: 'Roadmaps',
			githubRepo: repo('octo/roadmap')
		});
		expect(connection).toMatchObject({
			type: 'github',
			label: 'Roadmaps',
			secretEnv: 'BYL_GITHUB_TOKEN',
			keywords: [],
			enabled: true,
			github: { interval: 15, repos: [repo('octo/roadmap')] }
		});
	});

	it('adds a repository with its own target project and another interval', async () => {
		const project = await pb.collection('projects').create({ owner: ownerId, name: 'Haus', code: 'HAUS' });
		const saved = await saveGitHubSettings(pb, connection.id, settings({
			interval: 30,
			repos: [repo('octo/roadmap'), repo('octo/site', { paths: ['CHANGELOG*'], target: project.id })]
		}));
		expect(saved.github).toEqual(settings({
			interval: 30,
			repos: [repo('octo/roadmap'), repo('octo/site', { paths: ['CHANGELOG*'], target: project.id })]
		}));
		// What the server stores reads back the same.
		const stored = await pb.collection('connections').getOne(connection.id);
		expect(githubSettingsOf(stored.settings)).toEqual(saved.github);
		expect((await getConnection(pb, connection.id)).github).toEqual(saved.github);
	});

	it('says refusals of the hook with the texts of the interface', async () => {
		const archived = await pb.collection('projects').create({ owner: ownerId, name: 'Alt', code: 'ALT' });
		await pb.collection('projects').update(archived.id, { archived: true });
		const refusal = (value) =>
			saveGitHubSettings(pb, connection.id, settings(value)).then(
				() => null,
				(error) => error
			);
		const archivedTarget = await refusal({
			interval: 30,
			repos: [repo('octo/roadmap', { target: archived.id })]
		});
		expect(archivedTarget).toBeInstanceOf(DataError);
		expect(archivedTarget.fields.settings).toMatchObject({
			code: 'validation_target_project_archived',
			message: TARGET_MESSAGES.validation_target_project_archived
		});
		const badPath = await refusal({ interval: 30, repos: [repo('octo/roadmap', { paths: ['/abs'] })] });
		expect(badPath.fields.settings).toMatchObject({
			code: 'validation_github_paths',
			message: GITHUB_MESSAGES.validation_github_paths
		});
		const badInterval = await refusal({ interval: 3, repos: [] });
		expect(badInterval.fields.settings.message).toBe(GITHUB_MESSAGES.validation_github_interval);
	});

	it('runs, then reads the details and the check of the card', async () => {
		const result = await runConnection(pb, connection.id);
		expect(result).toMatchObject({ status: 'ok', error: '' });
		const details = await getGitHubDetails(pb, connection.id);
		expect(details).toMatchObject({ authenticated: true, interval: 30, limit: null });
		expect(details.rate).toMatchObject({ limit: 5000 });
		expect(details.repos.map((entry) => [entry.repo, entry.private, entry.files])).toEqual([
			['octo/roadmap', true, 2],
			['octo/site', false, 1]
		]);
		expect(details.repos[0]).toMatchObject({
			url: 'https://github.com/octo/roadmap',
			branch: 'main',
			lastChange: null,
			openPulls: 0,
			lastRelease: null,
			error: ''
		});
		expect(details.repos[0].checkedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

		const check = await checkGitHub(pb, connection.id);
		expect(check).toMatchObject({ status: 'ok', authenticated: true, message: '' });
		expect(check.repos.map((entry) => [entry.repo, entry.ok, entry.private])).toEqual([
			['octo/roadmap', true, true],
			['octo/site', true, false]
		]);
		// GitHub is only read.
		expect(fake.methods()).toEqual(['GET']);
	});

	it('brings the status of a watched file into the inbox and the details', async () => {
		fake.commit('octo/roadmap', {
			files: { 'CHANGELOG.md': '# Changelog\n\n## 1.1.0\n- Karten\n\n## 1.0.0\n- Start\n' },
			message: 'Notiere 1.1.0'
		});
		expect(await runConnection(pb, connection.id)).toMatchObject({ status: 'ok', created: 1 });
		const [entry] = (await listNewItems(pb)).filter((item) => item.connectionId === connection.id);
		expect(entry).toMatchObject({
			channel: 'github',
			kind: 'change',
			title: 'CHANGELOG.md in octo/roadmap geändert',
			watch: { kind: 'file', state: 'current', since: null }
		});
		fake.commit('octo/roadmap', {
			files: { 'CHANGELOG.md': '# Changelog\n\n## 1.2.0\n- Mehr\n' },
			message: 'Notiere 1.2.0'
		});
		await runConnection(pb, connection.id);
		const items = (await listNewItems(pb)).filter((item) => item.connectionId === connection.id);
		const first = items.find((item) => item.id === entry.id);
		expect(first?.watch).toMatchObject({ kind: 'file', state: 'changed' });
		expect(first?.watch?.since).toMatch(/Z$/);
		const details = await getGitHubDetails(pb, connection.id);
		expect(details.repos[0].lastChange).toMatchObject({ path: 'CHANGELOG.md', action: 'changed' });
	});

	it('comes back "limited" with the hint of the server at the rate limit', async () => {
		const reset = Math.floor(Date.now() / 1000) + 600;
		fake.setRate('token', 0, reset);
		fake.commit('octo/site', { files: { 'CHANGELOG.md': '# neu\n' } });
		const result = await runConnection(pb, connection.id);
		expect(result.status).toBe('limited');
		expect(result.hint).toMatch(/^GitHub-Anfragelimit erreicht\./);
		expect((await getGitHubDetails(pb, connection.id)).limit).toMatchObject({ kind: 'primary' });
		fake.setRate('token', 5000, reset + 3600);
	});

	it('knows no details of a connection of another kind', async () => {
		const calendar = await createConnection(pb, {
			...emptyConnectionDraft('calendar'),
			secretEnv: 'BYL_GOOGLE_CALENDAR_URL'
		});
		await expect(getGitHubDetails(pb, calendar.id)).rejects.toMatchObject({ kind: 'not_found' });
		await expect(checkGitHub(pb, calendar.id)).rejects.toMatchObject({ kind: 'not_found' });
		await expect(listGitHubRepos(pb, calendar.id)).rejects.toMatchObject({ kind: 'not_found' });
	});

	it('lists the repositories of the token and watches all own ones (addendum of 2026-10-02)', async () => {
		fake.addRepo('anna/notizen', { files: FILES });
		fake.addRepo('anna/archiv', { files: FILES, archived: true });
		const auto = await createConnection(pb, {
			...emptyConnectionDraft('github'),
			label: 'Alle',
			secretEnv: 'BYL_GITHUB_TOKEN',
			githubRepo: null,
			githubAuto: true
		});
		expect(auto.github).toEqual(settings({ auto: true }));
		const list = await listGitHubRepos(pb, auto.id);
		expect(list).toMatchObject({ status: 'ok', login: 'anna', more: false });
		expect(list.at).toMatch(/Z$/);
		const byName = new Map(list.repos.map((choice) => [choice.repo, choice]));
		expect(byName.get('anna/notizen')).toMatchObject({ own: true, archived: false, state: 'auto' });
		expect(byName.get('anna/archiv')).toMatchObject({ own: true, archived: true, state: '' });
		expect(byName.get('octo/roadmap')).toMatchObject({ own: false, private: true, state: '' });
		expect((await listGitHubRepos(pb, auto.id, { refresh: true })).repos).toHaveLength(list.repos.length);

		expect(await runConnection(pb, auto.id)).toMatchObject({ status: 'ok', created: 0 });
		const details = await getGitHubDetails(pb, auto.id);
		expect(details.repos.map((entry) => [entry.repo, entry.auto])).toEqual([['anna/notizen', true]]);
		expect(details.auto).toMatchObject({ enabled: true, login: 'anna', count: 1, added: ['anna/notizen'] });

		const saved = await saveGitHubSettings(pb, auto.id, settings({ auto: true, exclude: ['anna/notizen'] }));
		expect(saved.github).toEqual(settings({ auto: true, exclude: ['anna/notizen'] }));
		expect((await listGitHubRepos(pb, auto.id)).repos.find((choice) => choice.repo === 'anna/notizen')?.state).toBe('excluded');
		const refused = await saveGitHubSettings(pb, auto.id, settings({ exclude: ['kein name'] })).catch((error) => error);
		expect(refused.fields.settings.message).toBe(GITHUB_MESSAGES.validation_github_exclude);
	});
});
