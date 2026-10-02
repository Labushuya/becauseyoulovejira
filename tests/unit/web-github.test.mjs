// The GitHub channel of the web app (web/src/lib/domain/github.ts) against the hook module
// (app/pb_hooks/lib/github-rules.js, ADR-0050): the same defaults, events, limits and texts of the
// codes, the same reading of names, addresses and patterns, and the same settings read from what
// the server stores, so the form refuses what the hook refuses and the card shows what the server
// runs.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	AUTO_NO_TOKEN,
	AUTO_REASONS,
	GITHUB_DEFAULT_PATHS,
	GITHUB_DOCS_PATH,
	GITHUB_EVENTS,
	GITHUB_LIMITS,
	GITHUB_MESSAGES,
	GITHUB_SECRET_NAME,
	githubSettingsOf,
	githubSettingsValue,
	isPattern,
	isRepoName,
	parseRepo,
	repoKey
} from '../../web/src/lib/domain/github.ts';

const rules = loadHookLib('github-rules.js');

const HAUS = 'haus00000000001';

describe('web GitHub against the hooks', () => {
	it('knows the same defaults, events, limits and variable', () => {
		expect([...GITHUB_DEFAULT_PATHS]).toEqual(rules.DEFAULT_PATHS);
		expect([GITHUB_DOCS_PATH]).toEqual(rules.OPTIONAL_PATHS);
		expect([...GITHUB_EVENTS]).toEqual(rules.EVENTS);
		for (const key of ['repos', 'paths', 'pathLength', 'intervalDefault', 'intervalMin', 'intervalMax', 'autoRepos', 'excludes']) {
			expect(GITHUB_LIMITS[key], key).toBe(rules.LIMITS[key]);
		}
		expect(GITHUB_SECRET_NAME).toBe(rules.DEFAULT_SECRET_ENV);
	});

	it('words the codes of the hook the same', () => {
		expect(GITHUB_MESSAGES).toEqual(rules.MESSAGES);
	});

	it('words "Alle meine Repositorys" the same (addendum of 2026-10-02)', () => {
		expect(AUTO_NO_TOKEN).toBe(rules.AUTO_NO_TOKEN);
		expect(AUTO_REASONS).toEqual(rules.AUTO_REASONS);
	});

	it('reads names and addresses of repositories the same', () => {
		for (const input of [
			'octo-org/roadmap',
			'  octo-org/roadmap ',
			'Octo-Org/Road.Map_1',
			'https://github.com/octo-org/roadmap',
			'http://www.github.com/octo-org/roadmap.git',
			'github.com/octo-org/roadmap/tree/main/docs',
			'https://github.com/octo-org/roadmap?tab=readme',
			'octo-org/roadmap.git',
			'octo-org',
			'octo/org/roadmap',
			'-octo/roadmap',
			`${'a'.repeat(40)}/x`,
			'octo/..',
			'octo/.',
			'octo/road map',
			'https://gitlab.com/octo/roadmap',
			'',
			42
		]) {
			if (typeof input === 'string') expect(parseRepo(input), input).toBe(rules.parseRepo(input));
			expect(isRepoName(input), String(input)).toBe(rules.isRepoName(input));
		}
		expect(repoKey('Octo-Org/RoadMap')).toBe(rules.repoKey('Octo-Org/RoadMap'));
	});

	it('takes and refuses the same patterns', () => {
		for (const pattern of [
			'CHANGELOG*',
			'docs/**/roadmap*',
			'docs/**/*.md',
			'**',
			'a/b/c.txt',
			'',
			'/README',
			'docs/../x',
			'docs/./x',
			'docs//x',
			'docs/**x/y',
			'x**/y',
			'[ab]',
			'{a,b}',
			'!x',
			'a\\b',
			' x',
			'x ',
			'a\u0001',
			'x'.repeat(200),
			'x'.repeat(201),
			7
		]) {
			expect(isPattern(pattern), JSON.stringify(pattern)).toBe(rules.isPattern(pattern));
		}
	});

	it('reads stored settings the same, and stores what the hook accepts', () => {
		const samples = [
			null,
			{},
			[],
			{ interval: 30 },
			{ interval: 4 },
			{ interval: 61 },
			{ interval: 7.5 },
			{ interval: '15' },
			{
				interval: 5,
				repos: [
					{ repo: 'octo-org/roadmap', paths: ['CHANGELOG*'], events: { pulls: false }, target: HAUS },
					{ repo: 'OCTO-ORG/roadmap' },
					{ repo: 'bad' },
					{ repo: 'octo-org/site', paths: ['/abs'], target: 'Haus' },
					{ repo: 'octo-org/docs', paths: 'README*', events: 'all' },
					'octo-org/x'
				]
			},
			{ repos: Array.from({ length: 25 }, (_, index) => ({ repo: `octo/r${index}` })) },
			{ auto: true, exclude: ['anna/alt', 'ANNA/ALT', 'bad', 'anna/b'] },
			{ auto: 'ja', exclude: 'anna/alt' },
			{ auto: false, exclude: Array.from({ length: 105 }, (_, index) => `anna/r${index}`) }
		];
		for (const value of samples) {
			const web = githubSettingsOf(value);
			const hook = rules.settingsOf(value);
			expect(web.interval, JSON.stringify(value)).toBe(hook.interval);
			expect(web.auto, JSON.stringify(value)).toBe(hook.auto);
			expect([...web.exclude], JSON.stringify(value)).toEqual(hook.exclude);
			expect(
				web.repos.map((entry) => ({ ...entry, key: repoKey(entry.repo), target: entry.target ?? '' })),
				JSON.stringify(value)
			).toEqual(hook.repos);
			// What the web app stores passes the hook unchanged.
			const stored = githubSettingsValue(web);
			expect(rules.settingsViolation(stored), JSON.stringify(value)).toBe('');
			expect(githubSettingsOf(stored)).toEqual(web);
		}
	});
});
