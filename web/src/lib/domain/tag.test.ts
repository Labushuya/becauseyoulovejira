// Tag names and suggestions of the tag picker (E3 plan, T-14 and package 8).

import { describe, expect, it } from 'vitest';
import {
	TAG_NAME_MAX_LENGTH,
	findTagByName,
	normalizeTagName,
	tagNameKey,
	tagNameProblem,
	tagSuggestions
} from './tag';

const GARDEN = { id: 'tag000000000001', name: 'Garten' };
const CALL = { id: 'tag000000000002', name: 'anrufen' };
const ROOF = { id: 'tag000000000003', name: 'Dachgarten' };
const TAGS = [CALL, ROOF, GARDEN];

describe('tag names', () => {
	it('trims names and compares them regardless of case', () => {
		expect(normalizeTagName('  Garten und Hof ')).toBe('Garten und Hof');
		expect(tagNameKey(' GARTEN ')).toBe('garten');
		expect(tagNameKey('Äpfel')).toBe(tagNameKey('äPFEL'));
	});

	it('finds an existing tag in another spelling', () => {
		expect(findTagByName(TAGS, '  garten ')).toBe(GARDEN);
		expect(findTagByName(TAGS, 'ANRUFEN')).toBe(CALL);
		expect(findTagByName(TAGS, 'Gart')).toBeNull();
	});

	it.each([
		['', 'Der Name darf nicht leer sein.'],
		['   ', 'Der Name darf nicht leer sein.'],
		['x'.repeat(TAG_NAME_MAX_LENGTH + 1), `Höchstens ${TAG_NAME_MAX_LENGTH} Zeichen.`],
		[` ${'x'.repeat(TAG_NAME_MAX_LENGTH)} `, null],
		['Garten', null]
	])('checks the name "%s"', (name, problem) => {
		expect(tagNameProblem(name)).toBe(problem);
	});
});

describe('tagSuggestions', () => {
	it('offers every tag not yet chosen for an empty input, in the given order', () => {
		expect(tagSuggestions(TAGS, [ROOF.id], '  ')).toEqual([CALL, GARDEN]);
	});

	it('puts names starting with the input first, then names containing it', () => {
		expect(tagSuggestions(TAGS, [], 'gar')).toEqual([GARDEN, ROOF]);
		expect(tagSuggestions(TAGS, [], 'GARTEN')).toEqual([GARDEN, ROOF]);
	});

	it('leaves out chosen tags and names without the input', () => {
		expect(tagSuggestions(TAGS, [GARDEN.id], 'gar')).toEqual([ROOF]);
		expect(tagSuggestions(TAGS, [], 'xyz')).toEqual([]);
	});
});
