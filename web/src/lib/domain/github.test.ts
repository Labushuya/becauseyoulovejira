// GitHub channel in the web app (ADR-0050 §2, §6 and §7): names and addresses of repositories,
// patterns, the form of a repository, the settings as the server reads and stores them, the details
// of the card and the answer of "Verbindung prüfen". The same rules as the hook are compared in
// tests/unit/web-github.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	EMPTY_GITHUB_SETTINGS,
	EVENTS_MESSAGE,
	GITHUB_DEFAULT_PATHS,
	GITHUB_DOCS_PATH,
	PATHS_EMPTY_MESSAGE,
	PATHS_MAX_MESSAGE,
	REPO_DUPLICATE_MESSAGE,
	REPO_MESSAGE,
	REPOS_MAX_MESSAGE,
	accessText,
	checkSummary,
	draftPaths,
	emptyRepoDraft,
	eventsText,
	filesText,
	githubCheckOf,
	githubDetailsOf,
	githubMetaText,
	githubSettingsOf,
	githubSettingsValue,
	intervalText,
	isPattern,
	lastChangeText,
	openPullsText,
	parseRepo,
	pathsError,
	rateText,
	releaseText,
	repoDraftErrors,
	repoDraftOf,
	repoFromDraft,
	withRepo,
	withoutRepo,
	type GitHubRepoSettings,
	type GitHubSettings
} from './github';

const HAUS = 'haus00000000001';

function repo(name: string, overrides: Partial<GitHubRepoSettings> = {}): GitHubRepoSettings {
	return {
		repo: name,
		paths: [...GITHUB_DEFAULT_PATHS],
		events: { files: true, pulls: true, releases: true },
		target: null,
		...overrides
	};
}

describe('names of repositories', () => {
	it('reads a name or an address of github.com', () => {
		expect(parseRepo('octo-org/roadmap')).toBe('octo-org/roadmap');
		expect(parseRepo('  octo-org/roadmap  ')).toBe('octo-org/roadmap');
		expect(parseRepo('https://github.com/octo-org/roadmap')).toBe('octo-org/roadmap');
		expect(parseRepo('github.com/octo-org/roadmap.git')).toBe('octo-org/roadmap');
		expect(parseRepo('https://www.github.com/octo-org/roadmap/blob/main/README.md')).toBe(
			'octo-org/roadmap'
		);
		expect(parseRepo('octo-org/roadmap.git')).toBe('octo-org/roadmap');
	});

	it('refuses anything else', () => {
		for (const input of [
			'',
			'roadmap',
			'octo/org/roadmap',
			'-octo/roadmap',
			'octo/..',
			'https://gitlab.com/octo/roadmap',
			'octo/road map'
		]) {
			expect(parseRepo(input), input).toBe('');
		}
	});
});

describe('patterns', () => {
	it('takes patterns from the root with * and whole ** segments', () => {
		for (const pattern of ['CHANGELOG*', 'docs/**/roadmap*', 'docs/**/*.md', 'a/b.txt']) {
			expect(isPattern(pattern), pattern).toBe(true);
		}
	});

	it('refuses absolute, parent, empty segments, classes and partial **', () => {
		for (const pattern of [
			'',
			'/README.md',
			'docs/../x',
			'docs//x',
			'docs/**x/y',
			'[ab].md',
			'{a,b}.md',
			'!README',
			' README',
			'x'.repeat(201)
		]) {
			expect(isPattern(pattern), pattern).toBe(false);
		}
	});
});

describe('the form of a repository', () => {
	it('starts with the paths of the spec, every event on and the docs pattern off', () => {
		const draft = emptyRepoDraft();
		expect(draft.pathsText.split('\n')).toEqual([
			'ROADMAP*',
			'CHANGELOG*',
			'README*',
			'docs/**/roadmap*'
		]);
		expect(draft.docs).toBe(false);
		expect(draft.events).toEqual({ files: true, pulls: true, releases: true });
		expect(draft.target).toBeNull();
	});

	it('reads one pattern per line and adds the docs pattern last', () => {
		expect(draftPaths({ pathsText: ' README* \n\n CHANGELOG*\r\n', docs: false })).toEqual([
			'README*',
			'CHANGELOG*'
		]);
		expect(draftPaths({ pathsText: 'README*\ndocs/**/*.MD', docs: true })).toEqual([
			'README*',
			GITHUB_DOCS_PATH
		]);
	});

	it('names the first wrong or doubled pattern', () => {
		const events = { files: true, pulls: true, releases: true };
		expect(pathsError({ pathsText: 'README*\n/abs', docs: false, events })).toMatch(/^„\/abs“: /);
		expect(pathsError({ pathsText: 'README*\nreadme*', docs: false, events })).toMatch(
			/^„readme\*“: Dieses Muster steht zweimal/
		);
		expect(
			pathsError({
				pathsText: Array.from({ length: 21 }, (_, index) => `f${index}`).join('\n'),
				docs: false,
				events
			})
		).toBe(PATHS_MAX_MESSAGE);
		expect(pathsError({ pathsText: '', docs: false, events })).toBe(PATHS_EMPTY_MESSAGE);
		expect(pathsError({ pathsText: '', docs: false, events: { ...events, files: false } })).toBe(
			null
		);
	});

	it('checks the name, duplicates, the number of repositories and the events', () => {
		const settings: GitHubSettings = { interval: 15, repos: [repo('octo-org/roadmap')] };
		expect(repoDraftErrors({ ...emptyRepoDraft(), input: 'nope' }, settings, null)).toEqual({
			repo: REPO_MESSAGE
		});
		expect(
			repoDraftErrors({ ...emptyRepoDraft(), input: 'Octo-Org/Roadmap' }, settings, null)
		).toEqual({ repo: REPO_DUPLICATE_MESSAGE });
		// Changing the repository itself is no duplicate.
		expect(repoDraftErrors(repoDraftOf(settings.repos[0]!), settings, 'octo-org/roadmap')).toEqual(
			{}
		);
		const full: GitHubSettings = {
			interval: 15,
			repos: Array.from({ length: 20 }, (_, index) => repo(`octo/r${index}`))
		};
		expect(repoDraftErrors({ ...emptyRepoDraft(), input: 'octo/new' }, full, null)).toEqual({
			repo: REPOS_MAX_MESSAGE
		});
		expect(
			repoDraftErrors(
				{
					...emptyRepoDraft(),
					input: 'octo/new',
					events: { files: false, pulls: false, releases: false }
				},
				settings,
				null
			)
		).toEqual({ events: EVENTS_MESSAGE });
	});

	it('turns a draft into settings and back', () => {
		const draft = {
			...emptyRepoDraft(),
			input: 'https://github.com/octo-org/roadmap',
			docs: true,
			target: HAUS
		};
		const settings = repoFromDraft(draft);
		expect(settings).toEqual({
			repo: 'octo-org/roadmap',
			paths: [...GITHUB_DEFAULT_PATHS, GITHUB_DOCS_PATH],
			events: { files: true, pulls: true, releases: true },
			target: HAUS
		});
		expect(repoDraftOf(settings)).toEqual({ ...draft, input: 'octo-org/roadmap' });
	});
});

describe('settings of a connection', () => {
	it('reads what the server stores, with defaults and without invalid repositories', () => {
		expect(githubSettingsOf(null)).toEqual(EMPTY_GITHUB_SETTINGS);
		expect(
			githubSettingsOf({
				interval: 30,
				repos: [
					{
						repo: 'octo-org/roadmap',
						paths: ['CHANGELOG*'],
						events: { pulls: false },
						target: HAUS
					},
					{ repo: 'octo-org/ROADMAP' },
					{ repo: 'bad' },
					{ repo: 'octo-org/site', paths: ['/abs'], target: 'Haus' }
				]
			})
		).toEqual({
			interval: 30,
			repos: [
				repo('octo-org/roadmap', {
					paths: ['CHANGELOG*'],
					events: { files: true, pulls: false, releases: true },
					target: HAUS
				}),
				repo('octo-org/site')
			]
		});
		expect(githubSettingsOf({ interval: 4 }).interval).toBe(15);
		expect(githubSettingsOf({ interval: 61 }).interval).toBe(15);
		expect(githubSettingsOf({ interval: 7.5 }).interval).toBe(15);
	});

	it('stores the target as an empty text without one', () => {
		expect(githubSettingsValue({ interval: 15, repos: [repo('octo/a')] })).toEqual({
			interval: 15,
			repos: [
				{
					repo: 'octo/a',
					paths: [...GITHUB_DEFAULT_PATHS],
					events: { files: true, pulls: true, releases: true },
					target: ''
				}
			]
		});
	});

	it('adds, replaces and removes a repository by its key', () => {
		const one = withRepo(EMPTY_GITHUB_SETTINGS, repo('octo/a'));
		const two = withRepo(one, repo('octo/b'));
		const changed = withRepo(two, repo('OCTO/A', { target: HAUS }));
		expect(changed.repos.map((entry) => entry.repo)).toEqual(['OCTO/A', 'octo/b']);
		expect(withoutRepo(changed, 'octo/a').repos.map((entry) => entry.repo)).toEqual(['octo/b']);
	});

	it('says events and intervals in words', () => {
		expect(eventsText({ files: true, pulls: false, releases: true })).toBe('Dateien, Releases');
		expect(eventsText({ files: false, pulls: false, releases: false })).toBe('keine');
		expect(intervalText(15)).toBe('alle 15 Minuten');
		expect(intervalText(60)).toBe('jede Stunde');
	});
});

describe('details of the card', () => {
	it('reads the answer of the server strictly', () => {
		const details = githubDetailsOf({
			authenticated: true,
			interval: 30,
			limit: { until: '2026-10-02T12:00:00.000Z', kind: 'secondary' },
			rate: { limit: 5000, remaining: 4321, reset: 1790000000000 },
			repos: [
				{
					repo: 'octo-org/roadmap',
					key: 'octo-org/roadmap',
					url: 'https://github.com/octo-org/roadmap',
					branch: 'main',
					private: true,
					paths: ['CHANGELOG*'],
					events: { files: true, pulls: true, releases: false },
					target: '',
					files: 2,
					filesMore: 0,
					truncated: false,
					lastChange: {
						path: 'CHANGELOG.md',
						action: 'changed',
						at: '2026-10-02 10:05:00.000Z',
						url: 'https://github.com/octo-org/roadmap/compare/a...b'
					},
					openPulls: 3,
					openPullsMore: false,
					lastRelease: { tag: 'v1.2.0', name: '', at: '', url: '', prerelease: true },
					checkedAt: '2026-10-02T10:05:00Z',
					okAt: '',
					error: ''
				},
				{ repo: 'not a repo' },
				{ repo: 'octo-org/site', url: 'javascript:alert(1)', openPulls: 'x' }
			]
		});
		expect(details.authenticated).toBe(true);
		expect(details.interval).toBe(30);
		expect(details.limit).toEqual({ until: '2026-10-02T12:00:00.000Z', kind: 'secondary' });
		expect(details.rate).toEqual({
			limit: 5000,
			remaining: 4321,
			reset: new Date(1790000000000).toISOString()
		});
		expect(details.repos).toHaveLength(2);
		const [first, second] = details.repos;
		expect(first).toMatchObject({
			private: true,
			files: 2,
			openPulls: 3,
			lastChange: { path: 'CHANGELOG.md', action: 'changed', at: '2026-10-02T10:05:00.000Z' },
			checkedAt: '2026-10-02T10:05:00.000Z',
			okAt: null
		});
		// A strange address becomes the address of the repository; no number is no number.
		expect(second?.url).toBe('https://github.com/octo-org/site');
		expect(second?.openPulls).toBeNull();
	});

	it('says the last change, the pull requests, the release and the files', () => {
		expect(lastChangeText(null)).toBe('noch keine');
		expect(
			lastChangeText({
				path: 'CHANGELOG.md',
				action: 'changed',
				at: '2026-10-02T12:05:00.000Z',
				url: ''
			})
		).toBe('CHANGELOG.md geändert, 02.10.2026 14:05');
		expect(openPullsText({ openPulls: null, openPullsMore: false })).toBe('noch nicht abgerufen');
		expect(openPullsText({ openPulls: 3, openPullsMore: false })).toBe('3');
		expect(openPullsText({ openPulls: 1000, openPullsMore: true })).toBe('mehr als 1000');
		expect(releaseText(null)).toBe('noch keins');
		expect(
			releaseText({
				tag: 'v1.2.0',
				name: '',
				at: '2026-10-01T08:00:00.000Z',
				url: '',
				prerelease: true
			})
		).toBe('v1.2.0 (Vorabversion), 01.10.2026 10:00');
		expect(filesText({ files: 1, filesMore: 0, truncated: false })).toBe('1 Datei');
		expect(filesText({ files: 300, filesMore: 12, truncated: true })).toBe(
			'300 Dateien (12 weitere nicht beobachtet); sehr großes Repository: gelöschte Dateien erkennt die App nicht'
		);
	});

	it('says the access and the rate limit', () => {
		expect(accessText(true, 'BYL_GITHUB_TOKEN')).toBe(
			'Token aus BYL_GITHUB_TOKEN, 5.000 Anfragen je Stunde'
		);
		expect(accessText(false, 'BYL_GITHUB_TOKEN')).toMatch(/^Ohne Token .*60 Anfragen je Stunde$/);
		expect(rateText({ rate: null, limit: null })).toBe('noch nicht bekannt');
		expect(rateText({ rate: { limit: 5000, remaining: 4321, reset: '' }, limit: null })).toBe(
			'4.321 von 5.000 Anfragen übrig'
		);
		expect(
			rateText({
				rate: null,
				limit: { until: '2026-10-02T12:00:00.000Z', kind: 'primary' }
			})
		).toBe('erreicht, nächster Abruf ab 02.10.2026 14:00');
	});
});

describe('"Verbindung prüfen"', () => {
	it('reads the answer and sums it up without red for a limit', () => {
		const check = githubCheckOf({
			status: 'ok',
			authenticated: true,
			login: 'octo',
			rate: { limit: 5000, remaining: 4990, reset: '2026-10-02T12:00:00.000Z' },
			repos: [
				{ repo: 'octo-org/roadmap', ok: true, name: 'octo-org/roadmap', private: true },
				{ repo: 'octo-org/gone', ok: false, message: 'Repository nicht gefunden.' }
			]
		});
		expect(check.repos).toEqual([
			{ repo: 'octo-org/roadmap', ok: true, name: 'octo-org/roadmap', private: true, message: '' },
			{
				repo: 'octo-org/gone',
				ok: false,
				name: 'octo-org/gone',
				private: false,
				message: 'Repository nicht gefunden.'
			}
		]);
		expect(checkSummary(check)).toEqual({
			tone: 'info',
			text: 'GitHub nimmt den Token von @octo an, 4.990 von 5.000 Anfragen übrig. 1 Repository ist nicht erreichbar.'
		});
		expect(checkSummary({ ...check, repos: [check.repos[0]!] })).toEqual({
			tone: 'success',
			text: 'GitHub nimmt den Token von @octo an, 4.990 von 5.000 Anfragen übrig. Das Repository ist erreichbar.'
		});
		expect(
			checkSummary(githubCheckOf({ status: 'limited', message: 'Anfragelimit erreicht.' }))
		).toEqual({ tone: 'info', text: 'Anfragelimit erreicht.' });
		expect(checkSummary(githubCheckOf({ status: 'weird', message: 'Kaputt.' }))).toEqual({
			tone: 'error',
			text: 'Kaputt.'
		});
	});
});

describe('details of an entry', () => {
	it('reads the repository and the file of an entry of GitHub', () => {
		const item = { sourceMeta: { github: { repo: 'octo-org/roadmap', path: 'CHANGELOG.md' } } };
		expect(githubMetaText(item, 'repo')).toBe('octo-org/roadmap');
		expect(githubMetaText(item, 'path')).toBe('CHANGELOG.md');
		expect(githubMetaText({ sourceMeta: {} }, 'repo')).toBe('');
		expect(githubMetaText({ sourceMeta: { github: { repo: 3 } } }, 'repo')).toBe('');
	});
});
