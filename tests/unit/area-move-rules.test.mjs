// Pure rules of moving between the areas and dissolving a household (E7-4, ADR-0061;
// app/pb_hooks/lib/area-move-rules.js) and their mirror in the web app
// (web/src/lib/domain/area-move.ts): the input of the routes read strictly, who may move what, the
// codes of moved projects with the suffix of a dissolved household, tags by name, the history entry,
// the name that confirms deleting and the same texts on both sides.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as domain from '../../web/src/lib/domain/area-move.ts';

const rules = loadHookLib('area-move-rules.js');

const ID = 'abcdefghijklmno';
const OTHER = 'onmlkjihgfedcba';

describe('the input of POST /api/byl/area/move', () => {
	it('reads kind, records, direction and the choices', () => {
		expect(
			rules.moveInput({
				kind: 'project',
				ids: [ID, ID, OTHER],
				to: 'household',
				preview: true,
				project: '',
				dependencies: 'take',
				codes: { [ID]: ' ha us ' }
			})
		).toEqual({
			kind: 'project',
			ids: [ID, OTHER],
			to: 'household',
			preview: true,
			project: '',
			dependencies: 'take',
			codes: { [ID]: 'HAUS' },
			series: false,
			series_done: false
		});
		expect(rules.moveInput({ kind: 'item', ids: [ID], to: 'private' })).toEqual({
			kind: 'item',
			ids: [ID],
			to: 'private',
			preview: false,
			project: undefined,
			dependencies: undefined,
			codes: {},
			series: false,
			series_done: false
		});
	});

	it('reads whole series and their done occurrences as switches, off when not sent (MV-2)', () => {
		const base = { kind: 'rule', ids: [ID], to: 'household' };
		expect(rules.moveInput({ ...base, series: true, series_done: true })).toMatchObject({ series: true, series_done: true });
		expect(rules.moveInput({ ...base, series: true, series_done: false })).toMatchObject({ series: true, series_done: false });
		expect(rules.moveInput({ ...base, series: null })).toMatchObject({ series: false, series_done: false });
		for (const flags of [{ series: 'true' }, { series: 1 }, { series_done: 'ja' }]) {
			expect(rules.moveInput({ ...base, ...flags }), JSON.stringify(flags)).toEqual({ problem: 'format' });
		}
	});

	it('refuses anything else', () => {
		for (const body of [
			null,
			{},
			{ kind: 'epic', ids: [ID], to: 'household' },
			{ kind: 'ticket', ids: [], to: 'household' },
			{ kind: 'ticket', ids: ['kurz'], to: 'household' },
			{ kind: 'ticket', ids: [ID], to: 'nowhere' },
			{ kind: 'ticket', ids: [ID], to: 'household', project: 'kein-id' },
			{ kind: 'ticket', ids: [ID], to: 'household', dependencies: 'all' },
			{ kind: 'ticket', ids: [ID], to: 'household', codes: [] },
			{ kind: 'ticket', ids: [ID], to: 'household', codes: { x: 'AB' } }
		]) {
			expect(rules.moveInput(body), JSON.stringify(body)).toEqual({ problem: 'format' });
		}
		const many = Array.from({ length: rules.MAX_ROOTS + 1 }, () => ID);
		expect(rules.moveInput({ kind: 'ticket', ids: many, to: 'household' })).toEqual({ problem: 'too-many' });
	});
});

describe('rights (ADR-0061 §4)', () => {
	it('moves into the household only own private records', () => {
		expect(rules.mayMove('household', { owner: ID, household: '' }, ID, false)).toBe(true);
		expect(rules.mayMove('household', { owner: OTHER, household: '' }, ID, true)).toBe(false);
		expect(rules.mayMove('household', { owner: ID, household: 'h' }, ID, true)).toBe(false);
	});

	it('moves into the private area what the actor created, or anything with "move_out"', () => {
		expect(rules.mayMove('private', { owner: ID, household: 'h' }, ID, false)).toBe(true);
		expect(rules.mayMove('private', { owner: OTHER, household: 'h' }, ID, false)).toBe(false);
		expect(rules.mayMove('private', { owner: OTHER, household: 'h' }, ID, true)).toBe(true);
		expect(rules.mayMove('private', { owner: ID, household: '' }, ID, true)).toBe(false);
	});
});

describe('codes of moved projects', () => {
	it('accepts 2 to 6 capitals that the target does not have, never TASK', () => {
		expect(rules.codeProblem('HAUS', ['GART'])).toBe('');
		for (const code of ['HAUS', 'H', 'HAUSHAL', 'TASK', 'haus', 'HA-1', undefined]) {
			expect(rules.codeProblem(code, ['HAUS']), String(code)).toBe('code');
		}
	});

	it('finds a free code with a suffix when a household is dissolved', () => {
		expect(rules.suffixedCode('HAUS', ['HAUS'])).toBe('HAUSH');
		expect(rules.suffixedCode('HAUS', ['HAUS', 'HAUSH'])).toBe('HAUSA');
		expect(rules.suffixedCode('GARTEN', ['GARTEN'])).toBe('GARTEH');
		const all = 'HABCDEFGIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `AB${letter}`);
		expect(rules.suffixedCode('AB', ['AB', ...all])).toBe('ABHH');
	});
});

describe('tags by name', () => {
	it('reuses a name the target has (any case) and creates the others once', () => {
		expect(rules.tagMapping(['Einkauf', 'garten', 'GARTEN', ''], ['einkauf'])).toEqual({
			reused: ['Einkauf'],
			created: ['garten']
		});
	});
});

describe('the history entry of a moved ticket', () => {
	it('keeps only what changed and reads like the web app says it', () => {
		const value = rules.historyValue({
			to: 'household',
			key: 'HAUS-3',
			project: { from: 'Haus', to: '' },
			parent: 'PRIV-7',
			series: true,
			dissolved: false
		});
		expect(JSON.parse(value)).toEqual({
			to: 'household',
			key: 'HAUS-3',
			project: { from: 'Haus', to: '' },
			parent: 'PRIV-7',
			series: true
		});
		expect(domain.areaMoveHistoryText('PRIV-12', value)).toBe(
			'In den Haushalt verschoben (vorher PRIV-12); Projekt: Haus → –; übergeordnetes Ticket PRIV-7 blieb zurück; aus der Wiederholung gelöst'
		);
		expect(JSON.parse(rules.historyValue({ to: 'private', key: 'TASK-1', dissolved: true }))).toEqual({
			to: 'private',
			key: 'TASK-1',
			dissolved: true
		});
		expect(rules.HISTORY_FIELD).toBe('area_move');
	});
});

describe('targets of repositories and folders (E7-4b)', () => {
	const P1 = 'proj00000000001';
	const P2 = 'proj00000000002';
	const moved = (target) => target === P1;

	it('clears the target of every repository or folder the rule names, and nothing else', () => {
		const github = {
			interval: 15,
			auto: true,
			repos: [
				{ repo: 'octo/a', paths: ['CHANGELOG*'], target: P1 },
				{ repo: 'octo/b', target: P2 },
				{ repo: 'octo/c' },
				{ repo: 'octo/d', target: P1, events: { files: true, pulls: false, releases: true } }
			]
		};
		const result = rules.clearedUnitTargets('github', github, moved);
		expect(result.cleared).toBe(2);
		expect(result.settings).toEqual({
			interval: 15,
			auto: true,
			repos: [
				{ repo: 'octo/a', paths: ['CHANGELOG*'], target: '' },
				{ repo: 'octo/b', target: P2 },
				{ repo: 'octo/c' },
				{ repo: 'octo/d', target: '', events: { files: true, pulls: false, releases: true } }
			]
		});
		// The settings given stay as they were (the service saves the copy).
		expect(github.repos[0].target).toBe(P1);

		const folder = { interval: 5, folders: [{ path: 'C:\\Daten\\Rechnungen', target: P1, subfolders: true }] };
		expect(rules.clearedUnitTargets('folder', folder, moved)).toEqual({
			settings: { interval: 5, folders: [{ path: 'C:\\Daten\\Rechnungen', target: '', subfolders: true }] },
			cleared: 1
		});
	});

	it('changes nothing without such a target, for other kinds and for settings of another shape', () => {
		const none = { repos: [{ repo: 'octo/b', target: P2 }, { repo: 'octo/c', target: '' }] };
		expect(rules.clearedUnitTargets('github', none, moved)).toEqual({ settings: null, cleared: 0 });
		expect(rules.clearedUnitTargets('mail', { repos: [{ target: P1 }] }, moved)).toEqual({ settings: null, cleared: 0 });
		expect(rules.clearedUnitTargets('folder', { folders: 'C:\\Daten' }, moved)).toEqual({ settings: null, cleared: 0 });
		expect(rules.clearedUnitTargets('github', null, moved)).toEqual({ settings: null, cleared: 0 });
		expect(rules.clearedUnitTargets('github', { repos: [null, 'octo/a'] }, moved)).toEqual({ settings: null, cleared: 0 });
	});
});

describe('dissolving a household', () => {
	it('reads the way and confirms deleting only with the name', () => {
		expect(rules.dissolveInput({ mode: 'adopt', preview: true })).toEqual({ mode: 'adopt', preview: true, name: '' });
		expect(rules.dissolveInput({ mode: 'delete', name: 'Haus' })).toEqual({ mode: 'delete', preview: false, name: 'Haus' });
		expect(rules.dissolveInput({ mode: 'both' })).toEqual({ problem: 'mode' });
		for (const [typed, name, expected] of [
			[' Haus Beispiel ', 'Haus Beispiel', true],
			['haus beispiel', 'Haus Beispiel', false],
			['', '', false]
		]) {
			expect(rules.nameConfirmed(typed, name)).toBe(expected);
			expect(domain.nameConfirmed(typed, name)).toBe(expected);
		}
	});
});

describe('answers and texts', () => {
	it('answers refusals with their status', () => {
		expect(rules.problemBody('right', { label: 'HAUS-2' })).toEqual({
			status: 403,
			body: { status: 403, message: rules.PROBLEMS.right, reason: 'invalid', problem: 'right', params: { label: 'HAUS-2' } }
		});
		expect(rules.problemBody('missing').status).toBe(404);
		expect(rules.problemBody('linked').status).toBe(409);
		expect(rules.problemBody('code').status).toBe(400);
		expect(rules.problemBody('unbekannt').body.problem).toBe('format');
	});

	it('has the same texts and limits in the web app', () => {
		expect(domain.AREA_MOVE_PROBLEMS).toEqual(rules.PROBLEMS);
		expect(domain.MOVE_MAX).toBe(rules.MAX_ROOTS);
		expect(domain.normalizeCode(' ha us ')).toBe(rules.normalizeCode(' ha us '));
	});
});
