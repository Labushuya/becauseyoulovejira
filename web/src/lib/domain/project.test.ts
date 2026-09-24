// Projects (E3 plan, T-11 and package 3).

import { describe, expect, it } from 'vitest';
import {
	countActiveByProject,
	isValidProjectCode,
	normalizeProjectCode,
	PROJECT_NAME_MAX_LENGTH,
	projectCodeProblem,
	projectNameProblem,
	RESERVED_CODE,
	suggestProjectCode
} from './project';

describe('isValidProjectCode', () => {
	it.each(['AB', 'HAUS', 'ABCDEF', 'TASKS', 'TAS'])('accepts %s', (code) => {
		expect(isValidProjectCode(code)).toBe(true);
	});

	it.each(['', 'A', 'ABCDEFG', 'haus', 'Haus', 'HA1', 'HA-US', 'ÄB', ' AB', 'AB ', RESERVED_CODE])(
		'rejects "%s"',
		(code) => {
			expect(isValidProjectCode(code)).toBe(false);
		}
	);

	it('reserves TASK', () => {
		expect(RESERVED_CODE).toBe('TASK');
	});
});

describe('suggestProjectCode', () => {
	it.each([
		['Haus', 'HAUS'],
		['Haushalt', 'HAUS'],
		['Garten und Haus', 'GUH'],
		['Büro', 'BUER'],
		['Übungen', 'UEBU'],
		['Öl und Ärger', 'OUA'],
		['Straße', 'STRA'],
		['Fuß Ball', 'FB'],
		['Élan vital', 'EV'],
		['Café', 'CAFE'],
		['  auto  ', 'AUTO'],
		['Projekt 2026', 'PROJ'],
		['a b c d e f g h', 'ABCDEF'],
		['Auto & Co.', 'AC'],
		['Ab', 'AB']
	])('%s → %s', (name, code) => {
		expect(suggestProjectCode(name)).toBe(code);
		expect(isValidProjectCode(suggestProjectCode(name))).toBe(true);
	});

	it.each(['', '   ', 'X', '42', '!!', 'Task', 'task', 'T.A.S.K.'])(
		'suggests nothing for "%s"',
		(name) => {
			expect(suggestProjectCode(name)).toBe('');
		}
	);
});

describe('project form rules (E3 plan, package 14)', () => {
	it('normalizes a typed code to trimmed capitals', () => {
		expect(normalizeProjectCode(' haus ')).toBe('HAUS');
		expect(normalizeProjectCode('Büro')).toBe('BÜRO');
	});

	it.each([
		['', 'Bitte einen Code eingeben.'],
		['TASK', 'Der Code TASK ist reserviert.'],
		['A', 'Nur 2 bis 6 Großbuchstaben (A–Z).'],
		['ABCDEFG', 'Nur 2 bis 6 Großbuchstaben (A–Z).'],
		['BÜRO', 'Nur 2 bis 6 Großbuchstaben (A–Z).'],
		['HA1', 'Nur 2 bis 6 Großbuchstaben (A–Z).'],
		['HAUS', null],
		['TASKS', null]
	])('code "%s": %s', (code, problem) => {
		expect(projectCodeProblem(code)).toBe(problem);
	});

	it('checks the name: not empty after trimming, at most the schema length', () => {
		expect(projectNameProblem('   ')).toBe('Der Name darf nicht leer sein.');
		expect(projectNameProblem('x'.repeat(PROJECT_NAME_MAX_LENGTH))).toBeNull();
		expect(projectNameProblem(` ${'x'.repeat(PROJECT_NAME_MAX_LENGTH)} `)).toBeNull();
		expect(projectNameProblem('x'.repeat(PROJECT_NAME_MAX_LENGTH + 1))).toBe(
			'Höchstens 100 Zeichen.'
		);
	});
});

describe('countActiveByProject', () => {
	it('counts the tickets that are not done per project, without "no project"', () => {
		const counts = countActiveByProject([
			{ projectId: 'p1', status: 'open' },
			{ projectId: 'p1', status: 'waiting' },
			{ projectId: 'p1', status: 'done' },
			{ projectId: 'p2', status: 'backlog' },
			{ projectId: null, status: 'open' }
		]);

		expect([...counts]).toEqual([
			['p1', 2],
			['p2', 1]
		]);
		expect(counts.get('p3')).toBeUndefined();
	});
});
