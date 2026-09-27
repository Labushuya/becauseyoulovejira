// Tag names and suggestions of the tag picker (E3 plan, T-14 and package 8).

import { describe, expect, it } from 'vitest';
import {
	TAG_NAME_MAX_LENGTH,
	findTagByName,
	normalizeTagName,
	tagNameKey,
	planTagInput,
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

	it('puts the same name in any spelling before longer names starting with it', () => {
		const building = { id: 'tag000000000004', name: 'Hausbau' };
		const house = { id: 'tag000000000005', name: 'Haus' };
		expect(tagSuggestions([building, house], [], 'HAUS')).toEqual([house, building]);
	});
});

describe('planTagInput (tag input in the ticket)', () => {
	it('reuses existing tags regardless of case and creates the other names', () => {
		expect(planTagInput(TAGS, [], [' GARTEN ', 'Einkauf', 'anRUFEN'])).toEqual({
			steps: [
				{ kind: 'add', tag: GARDEN },
				{ kind: 'create', name: 'Einkauf' },
				{ kind: 'add', tag: CALL }
			],
			skipped: []
		});
	});

	it('skips empty names, chosen tags and repeated names regardless of case', () => {
		expect(
			planTagInput(TAGS, ['Garten'], ['garten', '', '  ', 'Neu', 'NEU', 'Dachgarten'])
		).toEqual({
			steps: [
				{ kind: 'create', name: 'Neu' },
				{ kind: 'add', tag: ROOF }
			],
			skipped: ['garten', 'NEU']
		});
	});

	it('leaves the length check to creating the tag', () => {
		const long = 'x'.repeat(TAG_NAME_MAX_LENGTH + 1);
		expect(planTagInput(TAGS, [], [long]).steps).toEqual([{ kind: 'create', name: long }]);
	});
});
