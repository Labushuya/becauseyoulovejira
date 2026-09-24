// Projects (E3 plan, T-11 and package 3).

import { describe, expect, it } from 'vitest';
import { isValidProjectCode, RESERVED_CODE, suggestProjectCode } from './project';

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
