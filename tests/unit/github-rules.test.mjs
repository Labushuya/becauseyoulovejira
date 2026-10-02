// Pure rules of the GitHub channel (ADR-0050): app/pb_hooks/lib/github-rules.js with berlin-time.js
// passed in, as the service does. Checked: the fixed API and its test mode, names of repositories,
// the watched paths as globs, the settings, the interval of the cron, rate limits, links of pages,
// messages of failures, which watched files changed (blob SHA), the entries (changed file with
// copy and short diff, pull request, release) and the status a watched source shows.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('github-rules.js');
const berlin = loadHookLib('berlin-time.js');

const SHA = (n) => String(n).padStart(40, '0').replace(/^0/, 'a');
const header = (values) => (name) => values[name] ?? '';

describe('API and test mode', () => {
	it('talks to api.github.com in version 2022-11-28 and links to github.com', () => {
		expect(rules.API_BASE).toBe('https://api.github.com');
		expect(rules.WEB_BASE).toBe('https://github.com');
		expect(rules.API_VERSION).toBe('2022-11-28');
		expect(rules.DEFAULT_SECRET_ENV).toBe('BYL_GITHUB_TOKEN');
	});

	it('takes the fake port only in the test mode and only on 127.0.0.1', () => {
		expect(rules.apiBase(true, '4567')).toBe('http://127.0.0.1:4567');
		expect(rules.apiBase(false, '4567')).toBe(rules.API_BASE);
		for (const value of ['', '0', '65536', '08080', '4567x', 'evil.example:80', '-1']) {
			expect(rules.apiBase(true, value), value).toBe(rules.API_BASE);
		}
		const harness = readFileSync(new URL('../support/pocketbase-harness.mjs', import.meta.url), 'utf8');
		expect(harness).toContain(`${rules.TEST_PORT_ENV}: '9'`);
	});

	it('shortens a run only in the test mode', () => {
		expect(rules.runMsOf(false, '500')).toBe(60_000);
		expect(rules.runMsOf(true, '500')).toBe(500);
		expect(rules.runMsOf(true, '0')).toBe(60_000);
		expect(rules.runMsOf(true, '600000')).toBe(60_000);
		expect(rules.runMsOf(true, 'x')).toBe(60_000);
	});

	it('gives every request at most 20 seconds and none after the deadline', () => {
		expect(rules.attemptSeconds(100_000, 0)).toBe(20);
		expect(rules.attemptSeconds(5_500, 0)).toBe(5);
		expect(rules.attemptSeconds(900, 0)).toBe(0);
		expect(rules.attemptSeconds(0, 10)).toBe(0);
	});
});

describe('names of repositories', () => {
	it('accepts owner/name only', () => {
		for (const name of ['octo-org/roadmap', 'Anna/dot.files', 'a/b', 'o-1/repo_name-2.x']) {
			expect(rules.isRepoName(name), name).toBe(true);
		}
		for (const name of ['', 'octo', 'a/b/c', '-a/b', 'a/.', 'a/..', 'a/b.git', 'a b/c', `${'a'.repeat(40)}/b`, `a/${'b'.repeat(101)}`, null, 7]) {
			expect(rules.isRepoName(name), String(name)).toBe(false);
		}
	});

	it('reads names and addresses of github.com', () => {
		expect(rules.parseRepo(' octo-org/roadmap ')).toBe('octo-org/roadmap');
		expect(rules.parseRepo('https://github.com/octo-org/roadmap')).toBe('octo-org/roadmap');
		expect(rules.parseRepo('https://github.com/octo-org/roadmap.git')).toBe('octo-org/roadmap');
		expect(rules.parseRepo('github.com/octo-org/roadmap/tree/main/docs')).toBe('octo-org/roadmap');
		expect(rules.parseRepo('https://www.github.com/octo-org/roadmap/')).toBe('octo-org/roadmap');
		expect(rules.parseRepo('http://github.com/octo-org/roadmap?tab=readme')).toBe('octo-org/roadmap');
		for (const value of ['', 'https://gitlab.com/a/b', 'https://github.com/a', 'https://evil.example/github.com/a/b', 'a/b/c']) {
			expect(rules.parseRepo(value), value).toBe('');
		}
		expect(rules.repoKey('Octo-Org/Roadmap')).toBe('octo-org/roadmap');
	});
});

describe('watched paths (globs)', () => {
	const matches = (pattern, path) => rules.patternRegExp(pattern).test(path);

	it('starts a pattern at the root; * stays within a name, ** spans folders', () => {
		expect(matches('CHANGELOG*', 'CHANGELOG.md')).toBe(true);
		expect(matches('CHANGELOG*', 'changelog.md')).toBe(true);
		expect(matches('CHANGELOG*', 'docs/CHANGELOG.md')).toBe(false);
		expect(matches('README*', 'README')).toBe(true);
		expect(matches('docs/**/roadmap*', 'docs/roadmap.md')).toBe(true);
		expect(matches('docs/**/roadmap*', 'docs/plan/2027/Roadmap.md')).toBe(true);
		expect(matches('docs/**/roadmap*', 'docs/roadmap/plan.md')).toBe(false);
		expect(matches('docs/**/*.md', 'docs/a/b.md')).toBe(true);
		expect(matches('docs/**/*.md', 'docs/a/b.mdx')).toBe(false);
		expect(matches('**/README*', 'packages/web/README.md')).toBe(true);
		expect(matches('**/README*', 'README.md')).toBe(true);
		expect(matches('docs/**', 'docs/a/b.txt')).toBe(true);
		expect(matches('v?.md', 'v1.md')).toBe(true);
		expect(matches('v?.md', 'v10.md')).toBe(false);
		expect(matches('a.b', 'aXb')).toBe(false);
		expect(matches('a+(b)', 'a+(b)')).toBe(true);
	});

	it('takes only patterns it can read', () => {
		for (const pattern of [...rules.DEFAULT_PATHS, ...rules.OPTIONAL_PATHS, 'a/b/c.txt', '**']) {
			expect(rules.isPattern(pattern), pattern).toBe(true);
		}
		for (const pattern of ['', ' x', 'x ', '/abs', 'a//b', 'a/../b', './a', 'a/**b', 'a\\b', 'a[bc]', '{a,b}', '!a', 'a\tb', 'x'.repeat(201)]) {
			expect(rules.isPattern(pattern), JSON.stringify(pattern)).toBe(false);
		}
		expect(rules.pathsViolation([])).toBe('');
		expect(rules.pathsViolation(['README*', 'readme*'])).toBe('validation_github_paths');
		expect(rules.pathsViolation(Array.from({ length: 21 }, (_, i) => `f${i}`))).toBe('validation_github_paths');
		expect(rules.pathsViolation('README*')).toBe('validation_github_paths');
	});

	it('gives a signature independent of order and case', () => {
		expect(rules.pathsSignature(['B*', 'a*'])).toBe(rules.pathsSignature(['A*', 'b*']));
		expect(rules.pathsSignature(['a*'])).not.toBe(rules.pathsSignature(['a*', 'b*']));
	});
});

describe('settings of a connection', () => {
	const repo = (name, extra = {}) => ({ repo: name, ...extra });

	it('accepts the interval and repositories with paths, events and target', () => {
		expect(rules.settingsViolation(null)).toBe('');
		expect(rules.settingsViolation({})).toBe('');
		expect(
			rules.settingsViolation({
				interval: 30,
				repos: [repo('octo-org/roadmap', { paths: ['CHANGELOG*'], events: { files: true, pulls: false }, target: 'abcdefghijklmno' }), repo('anna/notes', { target: '' })]
			})
		).toBe('');
	});

	it('refuses everything else with a code of its own', () => {
		const code = (settings) => rules.settingsViolation(settings)?.code ?? '';
		expect(code({ keywords: ['x'] })).toBe('validation_github_settings');
		expect(code('x')).toBe('validation_github_settings');
		for (const interval of [4, 61, 7.5, '15', null]) expect(code({ interval }), String(interval)).toBe('validation_github_interval');
		expect(code({ repos: 'x' })).toBe('validation_github_settings');
		expect(code({ repos: Array.from({ length: 21 }, (_, i) => repo(`o/r${i}`)) })).toBe('validation_github_repos_max');
		expect(code({ repos: [repo('octo')] })).toBe('validation_github_repo');
		expect(code({ repos: [repo('https://github.com/a/b')] })).toBe('validation_github_repo');
		expect(code({ repos: [repo('a/b'), repo('A/B')] })).toBe('validation_github_repo_duplicate');
		expect(code({ repos: [repo('a/b', { paths: ['/x'] })] })).toBe('validation_github_paths');
		expect(code({ repos: [repo('a/b', { events: { issues: true } })] })).toBe('validation_github_events');
		expect(code({ repos: [repo('a/b', { events: { files: 'yes' } })] })).toBe('validation_github_events');
		expect(code({ repos: [repo('a/b', { target: 'nope' })] })).toBe('validation_github_target');
		expect(code({ repos: [repo('a/b', { extra: 1 })] })).toBe('validation_github_settings');
		expect(rules.settingsViolation({ interval: 3 }).message).toBe(rules.MESSAGES.validation_github_interval);
	});

	it('reads the settings with defaults: paths of the spec, every event on, 15 minutes', () => {
		const read = rules.settingsOf({ repos: [repo('Octo-Org/Roadmap'), repo('bad name'), repo('a/b', { paths: ['X*'], events: { pulls: false }, target: 'abcdefghijklmno' })] });
		expect(read.interval).toBe(15);
		expect(read.repos).toEqual([
			{ repo: 'Octo-Org/Roadmap', key: 'octo-org/roadmap', paths: ['ROADMAP*', 'CHANGELOG*', 'README*', 'docs/**/roadmap*'], events: { files: true, pulls: true, releases: true }, target: '' },
			{ repo: 'a/b', key: 'a/b', paths: ['X*'], events: { files: true, pulls: false, releases: true }, target: 'abcdefghijklmno' }
		]);
		expect(rules.settingsOf({ interval: 60 }).interval).toBe(60);
		expect(rules.settingsOf({ interval: 99 }).interval).toBe(15);
		expect(rules.settingsOf(null)).toEqual({ interval: 15, repos: [], auto: false, exclude: [] });
	});

	it('takes "Alle meine Repositorys" and its exclusions (addendum of 2026-10-02)', () => {
		const code = (settings) => rules.settingsViolation(settings)?.code ?? '';
		expect(code({ auto: true, exclude: ['anna/alt', 'Anna/Notes'] })).toBe('');
		expect(code({ auto: false, exclude: [] })).toBe('');
		for (const auto of ['true', 1, null]) expect(code({ auto }), String(auto)).toBe('validation_github_auto');
		expect(code({ exclude: 'anna/alt' })).toBe('validation_github_exclude');
		expect(code({ exclude: ['anna'] })).toBe('validation_github_exclude');
		expect(code({ exclude: ['anna/alt', 'ANNA/ALT'] })).toBe('validation_github_exclude');
		expect(code({ exclude: Array.from({ length: 101 }, (_, i) => `anna/r${i}`) })).toBe('validation_github_exclude');
		expect(rules.settingsViolation({ auto: 'x' }).message).toBe(rules.MESSAGES.validation_github_auto);
		expect(rules.settingsOf({ auto: true, exclude: ['anna/alt', 'bad', 'Anna/Alt', 'anna/b'] })).toMatchObject({
			auto: true,
			exclude: ['anna/alt', 'anna/b']
		});
		expect(rules.settingsOf({ auto: 'yes' }).auto).toBe(false);
	});

	it('names the repositories whose target is new', () => {
		const before = { repos: [repo('a/b', { target: 'aaaaaaaaaaaaaaa' }), repo('c/d')] };
		const after = { repos: [repo('A/B', { target: 'aaaaaaaaaaaaaaa' }), repo('c/d', { target: 'bbbbbbbbbbbbbbb' }), repo('e/f', { target: 'ccccccccccccccc' }), repo('g/h')] };
		expect(rules.changedTargets(before, after).map((entry) => entry.key)).toEqual(['c/d', 'e/f']);
		expect(rules.changedTargets(null, before).map((entry) => entry.key)).toEqual(['a/b']);
	});
});

describe('when the cron runs a connection', () => {
	const now = Date.parse('2026-10-02T10:15:00Z');

	it('runs a connection never run, and one whose interval passed (a minute early counts)', () => {
		expect(rules.isDue('', 15, now, 0)).toBe(true);
		expect(rules.isDue('2026-10-02 10:00:05.000Z', 15, now, 0)).toBe(true);
		expect(rules.isDue('2026-10-02 10:01:30.000Z', 15, now, 0)).toBe(false);
		expect(rules.isDue('2026-10-02 10:05:00.000Z', 5, now, 0)).toBe(true);
		expect(rules.isDue('2026-10-02 09:20:00.000Z', 60, now, 0)).toBe(false);
	});

	it('waits while a rate limit holds', () => {
		expect(rules.isDue('', 15, now, now + 1000)).toBe(false);
		expect(rules.isDue('', 15, now, now - 1000)).toBe(true);
	});
});

describe('rate limits (ADR-0050 §6)', () => {
	const now = 1_000_000;

	it('reads the headers of an answer', () => {
		expect(rules.rateOf(header({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '2000' }))).toEqual({ limit: 5000, remaining: 4999, reset: 2_000_000, retryAfter: -1 });
		expect(rules.rateOf(header({}))).toEqual({ limit: -1, remaining: -1, reset: 0, retryAfter: -1 });
		expect(rules.rateOf(header({ 'retry-after': '30' })).retryAfter).toBe(30);
	});

	it('tells primary and secondary limits from missing rights', () => {
		const rate = (values) => rules.rateOf(header(values));
		expect(rules.limitOf(403, rate({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1500' }), 'API rate limit exceeded', now, 0)).toEqual({ kind: 'primary', until: 1_501_000 });
		expect(rules.limitOf(429, rate({ 'retry-after': '30' }), '', now, 0)).toEqual({ kind: 'secondary', until: now + 30_000 });
		expect(rules.limitOf(403, rate({ 'x-ratelimit-remaining': '12' }), 'You have exceeded a secondary rate limit', now, 0)).toEqual({ kind: 'secondary', until: now + 60_000 });
		expect(rules.limitOf(429, rate({}), '', now, 2)).toEqual({ kind: 'secondary', until: now + 240_000 });
		expect(rules.limitOf(429, rate({}), '', now, 8)).toEqual({ kind: 'secondary', until: now + 900_000 });
		expect(rules.limitOf(403, rate({ 'x-ratelimit-remaining': '4000' }), 'Resource not accessible by personal access token', now, 0)).toBeNull();
		expect(rules.limitOf(404, rate({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1500' }), '', now, 0)).toBeNull();
	});

	it('stops before a request once nothing is left until the reset', () => {
		expect(rules.exhaustedUntil({ remaining: 0, reset: 2_000_000 }, now)).toBe(2_001_000);
		expect(rules.exhaustedUntil({ remaining: 0, reset: 500_000 }, now)).toBe(0);
		expect(rules.exhaustedUntil({ remaining: 3, reset: 2_000_000 }, now)).toBe(0);
		expect(rules.exhaustedUntil({ remaining: -1, reset: 0 }, now)).toBe(0);
	});

	it('says it neutrally, with the time of the next run in Berlin time', () => {
		const until = Date.parse('2026-10-02T12:05:00Z');
		expect(rules.limitHint({ kind: 'primary', until }, true, berlin)).toBe('GitHub-Anfragelimit erreicht. Nächster Abruf ab 02.10.2026, 14:05.');
		expect(rules.limitHint({ kind: 'primary', until }, false, berlin)).toContain('ohne Token erreicht (60 Anfragen je Stunde)');
		expect(rules.limitHint({ kind: 'secondary', until }, true, berlin)).toBe('GitHub bremst gerade die Anfragen. Nächster Abruf ab 02.10.2026, 14:05.');
	});
});

describe('pages and addresses', () => {
	it('follows rel="next" only on the host of the API', () => {
		const base = 'https://api.github.com';
		const link = '<https://api.github.com/repos/a/b/pulls?page=2&per_page=100>; rel="next", <https://api.github.com/repos/a/b/pulls?page=5>; rel="last"';
		expect(rules.nextLink(link)).toBe('https://api.github.com/repos/a/b/pulls?page=2&per_page=100');
		expect(rules.pathOfLink(rules.nextLink(link), base)).toBe('/repos/a/b/pulls?page=2&per_page=100');
		expect(rules.nextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBe('');
		expect(rules.pathOfLink('https://evil.example/repos/a/b', base)).toBe('');
		expect(rules.pathOfLink('https://api.github.com.evil.example/x', base)).toBe('');
	});

	it('encodes segments and builds links to github.com', () => {
		expect(rules.encodePath('docs/a b/ä#.md')).toBe('docs/a%20b/%C3%A4%23.md');
		expect(rules.webUrl('Octo/Repo', 'pull/12')).toBe('https://github.com/Octo/Repo/pull/12');
	});
});

describe('messages of failures', () => {
	it('names token, rights, missing repositories and outages in German, never the token', () => {
		expect(rules.failureOf(401, '', 'BYL_GITHUB_TOKEN')).toEqual({ message: expect.stringContaining('BYL_GITHUB_TOKEN'), connection: true });
		expect(rules.failureOf(0, '', 'X').connection).toBe(true);
		expect(rules.failureOf(0, 'timeout', 'X')).toEqual({ message: expect.stringContaining('Zeitüberschreitung'), connection: false });
		expect(rules.failureOf(403, '', 'X')).toEqual({ message: expect.stringContaining('„Read-only“'), connection: false });
		expect(rules.failureOf(404, '', 'X').message).toContain('nicht gefunden');
		expect(rules.failureOf(409, '', 'X').message).toContain('leer');
		expect(rules.failureOf(503, '', 'X')).toEqual({ message: expect.stringContaining('HTTP 503'), connection: false });
		expect(rules.failureOf(418, '', 'X').message).toBe('GitHub lehnt die Anfrage ab (HTTP 418).');
	});
});

describe('watched files and their changes (blob SHA)', () => {
	const tree = [
		{ path: 'README.md', type: 'blob', sha: SHA(1), size: 10 },
		{ path: 'CHANGELOG.md', type: 'blob', sha: SHA(2), size: 20 },
		{ path: 'docs', type: 'tree', sha: SHA(3) },
		{ path: 'docs/roadmap.md', type: 'blob', sha: SHA(4), size: 30 },
		{ path: 'docs/guide.md', type: 'blob', sha: SHA(5), size: 40 },
		{ path: 'src/index.js', type: 'blob', sha: SHA(6), size: 50 },
		{ path: 'broken', type: 'blob', sha: 'nope' }
	];

	it('picks the blobs that match a pattern, in the order of their paths', () => {
		const watched = rules.watchedFiles(tree, rules.DEFAULT_PATHS, 'a/b');
		expect(Object.keys(watched.files)).toEqual(['CHANGELOG.md', 'README.md', 'docs/roadmap.md']);
		expect(watched.files['README.md']).toEqual({ sha: SHA(1), size: 10 });
		expect(watched).toMatchObject({ count: 3, more: 0, skipped: 0 });
		expect(Object.keys(rules.watchedFiles(tree, ['docs/**/*.md'], 'a/b').files)).toEqual(['docs/guide.md', 'docs/roadmap.md']);
	});

	it('watches at most 300 files and skips paths too long for a reference', () => {
		const many = Array.from({ length: 305 }, (_, i) => ({ path: `docs/f${String(i).padStart(3, '0')}.md`, type: 'blob', sha: SHA(i + 10), size: 1 }));
		const watched = rules.watchedFiles(many, ['docs/**/*.md'], 'a/b');
		expect(watched.count).toBe(300);
		expect(watched.more).toBe(5);
		const long = [{ path: `docs/${'x'.repeat(490)}.md`, type: 'blob', sha: SHA(1), size: 1 }];
		expect(rules.watchedFiles(long, ['docs/**/*.md'], 'a/b')).toMatchObject({ count: 0, skipped: 1 });
		expect(rules.fileRef('a/b', 'README.md')).toBe('file:a/b:README.md');
	});

	it('finds changed, new and removed files; new patterns and unknown files bring no entry', () => {
		const before = { 'A.md': { sha: SHA(1) }, 'B.md': { sha: SHA(2) }, 'C.md': { sha: SHA(3) }, 'D.md': { sha: SHA(4) }, 'E.md': { sha: SHA(5) } };
		const after = { 'A.md': { sha: SHA(1) }, 'B.md': { sha: SHA(9) }, 'N.md': { sha: SHA(7) }, 'P.md': { sha: SHA(8) } };
		const present = (path) => ({ 'C.md': false, 'D.md': true, 'E.md': null })[path];
		const fresh = (path) => path === 'P.md';
		expect(rules.fileChanges(before, after, present, fresh)).toEqual({
			changed: ['B.md'],
			added: ['N.md'],
			removed: ['C.md'],
			baseline: ['P.md'],
			kept: ['E.md']
		});
		const old = rules.matcherOf(['CHANGELOG*', 'bad/../x']);
		expect(old('CHANGELOG.md')).toBe(true);
		expect(old('README.md')).toBe(false);
	});
});

describe('entries of the inbox', () => {
	const commits = [
		{ sha: SHA(91), message: 'Add *Roadmap* 2027\n\nlong text', author: 'Anna Beispiel', date: '2026-10-02T12:05:00Z' },
		{ sha: SHA(92), message: 'Typo', author: 'Ben [Bot]', date: '2026-10-01T08:00:00Z' }
	];
	const input = (extra = {}) => ({
		repo: 'Octo/Roadmap',
		key: 'octo/roadmap',
		branch: 'main',
		path: 'docs/CHANGELOG.md',
		action: 'changed',
		sha: SHA(20),
		oldSha: SHA(10),
		head: SHA(200),
		headDate: '2026-10-02T12:06:00Z',
		base: SHA(100),
		stats: { additions: 12, deletions: 3 },
		patch: '@@ -1,2 +1,3 @@\n # Changelog\n+## 1.2.0\n',
		commits,
		commitsMore: false,
		content: { text: '# Changelog\n\n## 1.2.0\n- Neu', truncated: false },
		copy: 'complete',
		size: 30,
		detectedAt: '2026-10-02T12:10:00Z',
		...extra
	});

	it('describes a changed file with commits, authors, lines, compare link, short diff and copy', () => {
		const draft = rules.fileDraft(input(), berlin);
		expect(draft).toMatchObject({
			channel: 'github',
			kind: 'change',
			title: 'docs/CHANGELOG.md in Octo/Roadmap geändert',
			source_url: `https://github.com/Octo/Roadmap/blob/${SHA(200)}/docs/CHANGELOG.md`,
			source_ref: 'file:octo/roadmap:docs/CHANGELOG.md',
			source_date: '2026-10-02T12:05:00.000Z',
			fileName: 'CHANGELOG.md',
			watch: { kind: 'file', state: 'current' }
		});
		expect(draft.meta.github).toMatchObject({ kind: 'file', repo: 'Octo/Roadmap', path: 'docs/CHANGELOG.md', action: 'changed', version: SHA(20), sha: SHA(20), additions: 12, deletions: 3, commits: 2, copy: 'complete' });
		expect(draft.body).toContain('- Zeilen: +12 / −3');
		expect(draft.body).toContain('- Autoren: Anna Beispiel, Ben \\[Bot\\]');
		expect(draft.body).toContain('Add \\*Roadmap\\* 2027 – Anna Beispiel, 02.10.2026, 14:05');
		expect(draft.body).toContain(`(https://github.com/Octo/Roadmap/compare/${SHA(100).slice(0, 12)}...${SHA(200).slice(0, 12)})`);
		expect(draft.body).toContain('```diff\n@@ -1,2 +1,3 @@\n # Changelog\n+## 1.2.0\n```');
		expect(draft.body).toContain('**Neuer Inhalt:**\n\n# Changelog\n\n## 1.2.0\n- Neu');
		expect(draft.body).not.toContain('long text');
	});

	it('puts other files into a code block and says what was not copied', () => {
		const text = rules.fileDraft(input({ path: 'README.txt', content: { text: 'a ``` b', truncated: true } }), berlin).body;
		expect(text).toContain('````\na ``` b\n````');
		expect(text).toContain('_Inhalt gekürzt.');
		expect(rules.fileDraft(input({ copy: 'too_large', content: null, size: 3 * 1024 * 1024 }), berlin).body).toContain('größer als 2 MB (3072 KB)');
		expect(rules.fileDraft(input({ copy: 'binary', content: null }), berlin).body).toContain('keine Textdatei');
		expect(rules.fileDraft(input({ copy: 'later', content: null, commits: [] }), berlin).body).toContain('zu viele Änderungen auf einmal');
	});

	it('names a new and a removed file; a removed one has no copy and no status of its own', () => {
		expect(rules.fileDraft(input({ action: 'added' }), berlin).title).toBe('docs/CHANGELOG.md in Octo/Roadmap neu');
		const removed = rules.fileDraft(input({ action: 'removed', sha: '', content: null, copy: 'none' }), berlin);
		expect(removed.title).toBe('docs/CHANGELOG.md in Octo/Roadmap gelöscht');
		expect(removed.meta.github.version).toBe(`removed-${SHA(10)}`);
		expect(removed.watch).toBeNull();
		expect(removed.body).not.toContain('Neuer Inhalt');
		expect(removed.source_url).toContain('/compare/');
	});

	it('keeps the short diff within 40 lines and 4 000 characters', () => {
		const long = Array.from({ length: 100 }, (_, i) => `+line ${i}`).join('\n');
		const excerpt = rules.diffExcerpt(long);
		expect(excerpt.truncated).toBe(true);
		expect(excerpt.text.split('\n')).toHaveLength(40);
		expect(rules.diffExcerpt('x'.repeat(5000)).text).toBe('');
		expect(rules.diffExcerpt('')).toEqual({ text: '', truncated: false });
		expect(rules.fileDraft(input({ patch: long }), berlin).body).toContain('(gekürzt, vollständig im Vergleich)');
	});

	it('keeps the whole entry within the 100 000 characters of the body', () => {
		const draft = rules.fileDraft(input({ content: { text: 'x'.repeat(100_000), truncated: false } }), berlin);
		expect(draft.body.length).toBeLessThanOrEqual(100_000);
		expect(draft.body).toContain('_Inhalt gekürzt.');
	});

	it('describes a pull request with its state at the time it came in', () => {
		const pull = {
			number: 12,
			node_id: 'PR_kwDOAbc123',
			title: '  Roadmap\n2027  ',
			state: 'closed',
			merged_at: '2026-10-02T09:00:00Z',
			closed_at: '2026-10-02T09:00:00Z',
			created_at: '2026-10-01T08:00:00Z',
			draft: false,
			user: { login: 'anna' },
			head: { ref: 'feature/roadmap' },
			base: { ref: 'main' },
			body: 'Bitte **prüfen**.'
		};
		const draft = rules.pullDraft(pull, 'Octo/Roadmap', 'octo/roadmap', berlin);
		expect(draft).toMatchObject({
			kind: 'pull_request',
			title: 'PR #12 in Octo/Roadmap: Roadmap 2027',
			source_url: 'https://github.com/Octo/Roadmap/pull/12',
			source_ref: 'PR_kwDOAbc123',
			source_date: '2026-10-01T08:00:00.000Z',
			watch: { kind: 'pull', state: 'merged', since: '2026-10-02T09:00:00.000Z' }
		});
		expect(draft.body).toContain('- Zustand beim Eintreffen: gemergt am 02.10.2026, 11:00');
		expect(draft.body).toContain('---\n\nBitte **prüfen**.');
		expect(rules.pullDraft({ ...pull, node_id: '' }, 'Octo/Roadmap', 'octo/roadmap', berlin).source_ref).toBe('pull:octo/roadmap#12');
	});

	it('follows the state of a pull request: open, merged, closed', () => {
		expect(rules.pullWatch({ state: 'open' })).toEqual({ kind: 'pull', state: 'open' });
		expect(rules.pullWatch({ state: 'closed', merged_at: null, closed_at: '2026-10-02T09:00:00Z' })).toEqual({ kind: 'pull', state: 'closed', since: '2026-10-02T09:00:00.000Z' });
		expect(rules.pullWatch({ state: 'closed', merged_at: '2026-10-02T09:00:00Z' }).state).toBe('merged');
	});

	it('describes a release', () => {
		const draft = rules.releaseDraft(
			{ id: 7, node_id: 'RE_kwDOAbc', tag_name: 'v1.2.0', name: 'Herbst', prerelease: true, published_at: '2026-10-02T10:00:00Z', author: { login: 'anna' }, body: 'Notizen' },
			'Octo/Roadmap',
			'octo/roadmap',
			berlin
		);
		expect(draft).toMatchObject({
			kind: 'release',
			title: 'Release v1.2.0 in Octo/Roadmap: Herbst',
			source_url: 'https://github.com/Octo/Roadmap/releases/tag/v1.2.0',
			source_ref: 'RE_kwDOAbc',
			watch: null
		});
		expect(draft.body).toContain('- Vorabversion: ja');
		expect(draft.body).toContain('Notizen');
	});
});

describe('status of a watched source (ADR-0050 §5)', () => {
	it('says whether a version is current, changed since or gone', () => {
		expect(rules.fileWatch(SHA(1), SHA(1), 'T', null)).toEqual({ kind: 'file', state: 'current' });
		expect(rules.fileWatch(SHA(1), SHA(2), '2026-10-02T10:00:00.000Z', null)).toEqual({ kind: 'file', state: 'changed', since: '2026-10-02T10:00:00.000Z' });
		expect(rules.fileWatch(SHA(1), '', 'T2', null)).toEqual({ kind: 'file', state: 'gone', since: 'T2' });
		expect(rules.fileWatch(SHA(1), '', 'T3', { state: 'gone', since: 'T2' })).toEqual({ kind: 'file', state: 'gone', since: 'T2' });
		expect(rules.sameWatch({ kind: 'file', state: 'current' }, { kind: 'file', state: 'current' })).toBe(true);
		expect(rules.sameWatch(null, { kind: 'file', state: 'current' })).toBe(false);
	});

	it('compares instants of GitHub', () => {
		expect(rules.isAfter('2026-10-02T10:00:01Z', '2026-10-02T10:00:00Z')).toBe(true);
		expect(rules.isAfter('2026-10-02T10:00:00Z', '2026-10-02T10:00:00Z')).toBe(false);
		expect(rules.notBefore('2026-10-02T10:00:00Z', '2026-10-02T10:00:00Z')).toBe(true);
		expect(rules.isAfter('2026-10-02T10:00:00Z', '')).toBe(true);
		expect(rules.later('2026-10-02T10:00:00Z', '2026-10-01T10:00:00Z')).toBe('2026-10-02T10:00:00.000Z');
		expect(rules.later('', 'x')).toBe('');
	});
});

describe('state of the channel and details of the card', () => {
	it('reads the stored state safely', () => {
		expect(rules.stateOf('')).toEqual({ repos: {}, limit: null, list: null, auto: null });
		expect(rules.stateOf('{broken')).toEqual({ repos: {}, limit: null, list: null, auto: null });
		expect(rules.stateOf({ repos: { 'a/b': { head: 'x' }, bad: 3 }, limit: { until: 5, kind: 'primary' } })).toEqual({
			repos: { 'a/b': { head: 'x' } },
			limit: { until: 5, kind: 'primary' },
			list: null,
			auto: null
		});
		expect(rules.limitUntil({ limit: { until: 50 } }, 10)).toBe(50);
		expect(rules.limitUntil({ limit: { until: 5 } }, 10)).toBe(0);
	});

	it('sums up a repository for its card', () => {
		const config = rules.settingsOf({ repos: [{ repo: 'octo/roadmap' }] }).repos[0];
		expect(rules.repoSummary(config, undefined)).toMatchObject({ repo: 'octo/roadmap', auto: false, url: 'https://github.com/octo/roadmap', files: 0, openPulls: null, lastRelease: null, error: '' });
		expect(rules.repoSummary(rules.autoConfig('anna/notes'), undefined)).toMatchObject({ repo: 'anna/notes', auto: true, target: '' });
		const summary = rules.repoSummary(config, {
			name: 'Octo/Roadmap',
			branch: 'main',
			private: true,
			files: { 'README.md': { sha: SHA(1) } },
			open_pulls: 3,
			last_release: { tag: 'v1' },
			last_change: { path: 'README.md' },
			checked_at: 'T',
			error: 'x'
		});
		expect(summary).toMatchObject({ repo: 'Octo/Roadmap', url: 'https://github.com/Octo/Roadmap', branch: 'main', private: true, files: 1, openPulls: 3, lastRelease: { tag: 'v1' }, lastChange: { path: 'README.md' }, checkedAt: 'T', error: 'x' });
	});

	it('writes Berlin time', () => {
		expect(rules.berlinText('2026-07-01T10:30:00Z', berlin)).toBe('01.07.2026, 12:30');
		expect(rules.berlinText('2026-01-15 10:30:00.000Z', berlin)).toBe('15.01.2026, 11:30');
		expect(rules.berlinDay('2026-01-15T23:30:00Z', berlin)).toBe('16.01.2026');
		expect(rules.berlinText('', berlin)).toBe('');
	});

	it('keeps Markdown signs of GitHub texts out of the lines of an entry', () => {
		expect(rules.inline('a *b* [c](d) <e> `f` #1 ~g~ |h| !i\nj')).toBe('a \\*b\\* \\[c\\](d) \\<e\\> \\`f\\` \\#1 \\~g\\~ \\|h\\| \\!i j');
		expect(rules.inline('x'.repeat(10), 5)).toBe('xxxx…');
		expect(rules.fileNameOf('docs/Plan 2027 (neu).md')).toBe('Plan_2027__neu_.md');
		expect(rules.fileNameOf('..')).toBe('datei.txt');
		expect(rules.isMarkdownName('a/README.markdown')).toBe(true);
		expect(rules.isMarkdownName('README')).toBe(false);
		expect(rules.looksBinary('ab\u0000c')).toBe(true);
	});
});

describe('repositories of the token and "Alle meine Repositorys" (addendum of 2026-10-02)', () => {
	const json = (full_name, { type = 'User', archived = false, fork = false, priv = false, pushed = '2026-10-01T10:00:00Z' } = {}) => ({
		full_name,
		owner: { login: full_name.split('/')[0], type },
		private: priv,
		archived,
		fork,
		pushed_at: pushed
	});
	const listOf = (entries, login = 'anna') =>
		rules.listOf({
			at: '2026-10-02T10:00:00.000Z',
			login,
			etag_user: 'W/"u"',
			pages: [{ etag: 'W/"1"', next: '', repos: entries.map((entry) => rules.listEntryOf(entry)) }],
			more: false
		});
	const settings = (value) => rules.settingsOf(value);

	it('reads an entry of GET /user/repos and a stored list safely', () => {
		expect(rules.listEntryOf(json('anna/notes', { priv: true }))).toEqual({
			name: 'anna/notes',
			owner: 'anna',
			org: false,
			private: true,
			archived: false,
			fork: false,
			pushed: '2026-10-01T10:00:00.000Z'
		});
		expect(rules.listEntryOf(json('octo-org/site', { type: 'Organization' })).org).toBe(true);
		expect(rules.listEntryOf({ full_name: 'bad name' })).toBeNull();
		expect(rules.listEntryOf(null)).toBeNull();
		expect(rules.listOf(null)).toBeNull();
		expect(rules.listOf({ at: 'x', pages: [] })).toBeNull();
		expect(rules.listOf({ at: '2026-10-02T10:00:00Z', pages: [{ repos: 'x' }] })).toBeNull();
		const list = rules.listOf({ at: '2026-10-02T10:00:00Z', login: 'anna', pages: [{ etag: 'e', next: '/user/repos?page=2', repos: [{ name: 'anna/a' }, { name: 'bad' }] }] });
		expect(list).toMatchObject({ at: '2026-10-02T10:00:00.000Z', login: 'anna', more: false, pages: [{ etag: 'e', next: '/user/repos?page=2' }] });
		expect(list.pages[0].repos.map((entry) => entry.name)).toEqual(['anna/a']);
	});

	it('reads the list again after an hour, on request at most once a minute', () => {
		const list = listOf([]);
		const at = Date.parse('2026-10-02T10:00:00Z');
		expect(rules.listDue(null, at)).toBe(true);
		expect(rules.listDue(list, at + 59 * 60 * 1000)).toBe(false);
		expect(rules.listDue(list, at + 60 * 60 * 1000)).toBe(true);
		expect(rules.listDue(list, at - 1000)).toBe(true);
		expect(rules.listRefreshable(list, at + 30 * 1000)).toBe(false);
		expect(rules.listRefreshable(list, at + 60 * 1000)).toBe(true);
		expect(rules.listRefreshable(null, at)).toBe(true);
	});

	it('watches own repositories only: no organization, no other account, no fork, nothing archived', () => {
		expect(rules.autoReason(rules.listEntryOf(json('anna/a')), 'anna')).toBe('');
		expect(rules.autoReason(rules.listEntryOf(json('Anna/b')), 'ANNA')).toBe('');
		expect(rules.autoReason(rules.listEntryOf(json('anna/c', { archived: true })), 'anna')).toBe('archived');
		expect(rules.autoReason(rules.listEntryOf(json('anna/d', { fork: true })), 'anna')).toBe('fork');
		expect(rules.autoReason(rules.listEntryOf(json('octo-org/e', { type: 'Organization' })), 'anna')).toBe('other');
		expect(rules.autoReason(rules.listEntryOf(json('ben/f')), 'anna')).toBe('other');
		expect(rules.autoReason(rules.listEntryOf(json('anna/g')), '')).toBe('other');
	});

	it('watches the entered repositories, then the own ones with the defaults, most recently pushed first', () => {
		const list = listOf([
			json('anna/alt', { pushed: '2026-01-01T00:00:00Z' }),
			json('anna/neu', { pushed: '2026-10-01T00:00:00Z' }),
			json('anna/eingetragen'),
			json('anna/raus'),
			json('anna/archiv', { archived: true }),
			json('anna/fork', { fork: true }),
			json('octo-org/site', { type: 'Organization' })
		]);
		const value = settings({ auto: true, exclude: ['Anna/Raus'], repos: [{ repo: 'anna/eingetragen', paths: ['X*'] }, { repo: 'octo/fremd' }] });
		const effective = rules.effectiveRepos(value, list);
		expect(effective.repos.map((config) => [config.repo, config.auto === true])).toEqual([
			['anna/eingetragen', false],
			['octo/fremd', false],
			['anna/neu', true],
			['anna/alt', true]
		]);
		expect(effective.repos[0].paths).toEqual(['X*']);
		expect(effective.repos[2]).toEqual({ repo: 'anna/neu', key: 'anna/neu', paths: ['ROADMAP*', 'CHANGELOG*', 'README*', 'docs/**/roadmap*'], events: { files: true, pulls: true, releases: true }, target: '', auto: true });
		expect(effective.auto).toEqual(['anna/neu', 'anna/alt']);
		expect(effective.more).toBe(0);
		// Off, or without a list: only the entered ones.
		expect(rules.effectiveRepos(settings({ ...value, auto: false }), list).repos).toHaveLength(2);
		expect(rules.effectiveRepos(value, null).repos).toHaveLength(2);
	});

	it('takes at most 50 automatically and counts the rest', () => {
		const list = listOf(Array.from({ length: 53 }, (_, i) => json(`anna/r${String(i).padStart(2, '0')}`, { pushed: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` })));
		const effective = rules.effectiveRepos(settings({ auto: true }), list);
		expect(effective.auto).toHaveLength(50);
		expect(effective.more).toBe(3);
		expect(rules.LIMITS.autoRepos).toBe(50);
	});

	it('names what changed and why a repository left: archived, excluded, gone, entered is no removal', () => {
		const list = listOf([json('anna/a'), json('anna/b', { archived: true }), json('anna/c'), json('anna/e')]);
		const value = settings({ auto: true, exclude: ['anna/c'], repos: [{ repo: 'anna/e' }] });
		const after = rules.effectiveRepos(value, list).auto;
		expect(after).toEqual(['anna/a']);
		const changes = rules.autoChanges(['anna/b', 'anna/c', 'anna/d', 'anna/e', 'anna/f'], after, value, list);
		expect(changes).toEqual({
			added: ['anna/a'],
			removed: [
				{ repo: 'anna/b', reason: 'archived' },
				{ repo: 'anna/c', reason: 'excluded' },
				{ repo: 'anna/d', reason: 'gone' },
				{ repo: 'anna/f', reason: 'gone' }
			]
		});
		expect(rules.autoHint(changes, false)).toBe(
			'Alle meine Repositorys: neu beobachtet anna/a; nicht mehr beobachtet anna/b (archiviert), anna/c (ausgeschlossen), anna/d (nicht mehr da), anna/f (nicht mehr da).'
		);
		expect(rules.autoHint({ added: [], removed: [] }, false)).toBe('');
		expect(rules.autoHint({ added: ['anna/a', 'anna/b'], removed: [] }, true)).toBe('Alle meine Repositorys: 2 Repositorys werden jetzt beobachtet.');
		expect(rules.autoHint({ added: [], removed: [] }, true)).toMatch(/^Alle meine Repositorys: Das Token nennt keine eigenen Repositorys/);
		const many = Array.from({ length: 7 }, (_, i) => `anna/n${i}`);
		expect(rules.autoHint({ added: many, removed: [] }, false)).toBe('Alle meine Repositorys: neu beobachtet anna/n0, anna/n1, anna/n2, anna/n3, anna/n4 und 2 weitere.');
	});

	it('marks the choices of the list: entered, automatic, excluded, own', () => {
		const list = listOf([json('anna/a'), json('anna/b'), json('anna/c'), json('octo-org/d', { type: 'Organization', priv: true }), json('anna/e', { fork: true })]);
		const choices = rules.listChoices(list, settings({ auto: true, exclude: ['anna/c'], repos: [{ repo: 'anna/b' }] }));
		expect(choices.map((choice) => [choice.repo, choice.state, choice.own])).toEqual([
			['anna/a', 'auto', true],
			['anna/b', 'entered', true],
			['anna/c', 'excluded', true],
			['octo-org/d', '', false],
			['anna/e', '', true]
		]);
		expect(choices[3]).toMatchObject({ org: true, private: true, fork: false, archived: false });
		expect(rules.listChoices(list, settings({}))[0].state).toBe('');
	});

	it('reads the state of the automatic set safely', () => {
		expect(rules.autoStateOf(null)).toBeNull();
		expect(rules.autoStateOf({ names: ['anna/a', 'bad'], at: '2026-10-02T10:00:00Z', added: ['anna/a', 3], removed: [{ repo: 'anna/b', reason: 'archived' }, { repo: 'anna/c', reason: 'nope' }], error: 'x' })).toEqual({
			names: ['anna/a'],
			at: '2026-10-02T10:00:00.000Z',
			added: ['anna/a'],
			removed: [{ repo: 'anna/b', reason: 'archived' }],
			error: 'x'
		});
		const stored = rules.stateOf({ list: { at: '2026-10-02T10:00:00Z', login: 'anna', pages: [] }, auto: { names: [] } });
		expect(stored.list).toMatchObject({ login: 'anna', pages: [] });
		expect(stored.auto).toMatchObject({ names: [] });
	});
});
