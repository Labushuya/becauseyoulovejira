// Short syntax of the quick entry (CLAUDE.md section 7; E4 plan, T-10 and package 6): tokens at
// the start, in the middle and at the end, doubled tokens, archived projects, case, unknown
// tokens staying in the title, and the preview.

import { describe, expect, it } from 'vitest';
import {
	PRIORITY_NUMBERS,
	PRIORITY_WORDS,
	describeQuickEntry,
	parseQuickEntry,
	withProjectToken
} from './quick-syntax';
import type { ProjectRef, TagRef } from './ticket';

const HOUSE: ProjectRef = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false
};
const CAR: ProjectRef = { id: 'proj00000000002', name: 'Auto', code: 'AUTO', archived: false };
const OLD: ProjectRef = { id: 'proj00000000003', name: 'Altbau', code: 'ALT', archived: true };
const CALL: TagRef = { id: 'tag000000000001', name: 'Anruf' };
const PROJECTS = [HOUSE, CAR, OLD];
const TAGS = [CALL];

const parse = (text: string) => parseQuickEntry(text, PROJECTS, TAGS);

describe('parseQuickEntry', () => {
	it('resolves "Titel @CODE !hoch #tag"', () => {
		expect(parse('Zahnarzt anrufen @HAUS !hoch #anruf')).toEqual({
			title: 'Zahnarzt anrufen',
			project: HOUSE,
			priority: 'high',
			tags: [{ name: 'Anruf', existing: CALL }],
			hints: []
		});
	});

	it.each([
		['!niedrig', 'low'],
		['!Mittel', 'medium'],
		['!HOCH', 'high'],
		['!dringend', 'urgent'],
		['!1', 'low'],
		['!2', 'medium'],
		['!3', 'high'],
		['!4', 'urgent']
	])('reads the priority %s', (token, priority) => {
		expect(parse(`A ${token}`)).toMatchObject({ title: 'A', priority });
	});

	it('takes the code of a sub project like any other (ADR-0034)', () => {
		const garden: ProjectRef = {
			id: 'proj00000000011',
			name: 'Garten',
			code: 'GART',
			archived: false,
			parent: { id: HOUSE.id, name: HOUSE.name, code: HOUSE.code }
		};
		expect(parseQuickEntry('Beet umgraben @gart', [...PROJECTS, garden], TAGS)).toMatchObject({
			title: 'Beet umgraben',
			project: garden,
			hints: []
		});
		expect(describeQuickEntry(parseQuickEntry('Beet @GART', [...PROJECTS, garden], TAGS))).toEqual([
			'Projekt: Haushalt › Garten (GART)'
		]);
	});

	it('keeps the value lists of words and numbers in the same order', () => {
		expect(Object.values(PRIORITY_WORDS)).toEqual(Object.values(PRIORITY_NUMBERS));
	});

	it('reads tokens at the start, in the middle and at the end', () => {
		expect(parse('@auto !1 Reifen #Winter wechseln')).toMatchObject({
			title: 'Reifen wechseln',
			project: CAR,
			priority: 'low',
			tags: [{ name: 'Winter', existing: null }]
		});
	});

	it('takes the first project and priority and keeps further ones in the title', () => {
		expect(parse('Plan @HAUS @AUTO !hoch !niedrig')).toMatchObject({
			title: 'Plan @AUTO !niedrig',
			project: HOUSE,
			priority: 'high'
		});
	});

	it('takes every tag once regardless of case', () => {
		expect(parse('A #neu #Neu #anruf #ANRUF').tags).toEqual([
			{ name: 'neu', existing: null },
			{ name: 'Anruf', existing: CALL }
		]);
	});

	it('leaves unknown tokens in the title', () => {
		expect(parse('Mail an a@b.de @XYZ !sofort #  C# lernen 100% !')).toMatchObject({
			title: 'Mail an a@b.de @XYZ !sofort # C# lernen 100% !',
			project: null,
			priority: null,
			tags: []
		});
	});

	it('keeps an archived project in the title with a hint instead of an error', () => {
		expect(parse('Dach @ALT')).toEqual({
			title: 'Dach @ALT',
			project: null,
			priority: null,
			tags: [],
			hints: ['Das Projekt ALT ist archiviert und wird nicht gesetzt.']
		});
	});

	it('leaves over-long tag names in the title and cuts the title to 200 characters', () => {
		const long = `#${'x'.repeat(51)}`;
		expect(parse(`A ${long}`)).toMatchObject({ title: `A ${long}`, tags: [] });
		expect(parse('y'.repeat(250)).title).toHaveLength(200);
	});

	it('gives an empty title for tokens only', () => {
		expect(parse('  @HAUS  !hoch ').title).toBe('');
		expect(parse('').title).toBe('');
	});
});

describe('describeQuickEntry', () => {
	it('names project, priority and tags, new tags marked', () => {
		expect(describeQuickEntry(parse('A @HAUS !4 #anruf #Garten'))).toEqual([
			'Projekt: Haushalt (HAUS)',
			'Priorität: Dringend',
			'Tags: Anruf, Garten (neu)'
		]);
		expect(describeQuickEntry(parse('Nur Text'))).toEqual([]);
	});
});

describe('withProjectToken (ADR-0042)', () => {
	const choose = (text: string, code: string | null) => withProjectToken(text, code, PROJECTS);

	it('appends @CODE of the chosen project, also to an empty line', () => {
		expect(choose('Zahnarzt anrufen !hoch', 'AUTO')).toBe('Zahnarzt anrufen !hoch @AUTO');
		expect(choose('Zahnarzt anrufen ', 'AUTO')).toBe('Zahnarzt anrufen @AUTO');
		expect(choose('', 'HAUS')).toBe('@HAUS');
		expect(parse(choose('Reifen wechseln', 'AUTO')).project).toEqual(CAR);
	});

	it('replaces the token that set the project, wherever it stands', () => {
		expect(choose('@haus Zahnarzt anrufen', 'AUTO')).toBe('Zahnarzt anrufen @AUTO');
		expect(choose('Zahnarzt @HAUS anrufen', 'AUTO')).toBe('Zahnarzt anrufen @AUTO');
		expect(choose('Zahnarzt @HAUS', 'HAUS')).toBe('Zahnarzt @HAUS');
		expect(parse(choose('Zahnarzt @HAUS anrufen', 'AUTO')).project).toEqual(CAR);
	});

	it('removes the token for "Kein Projekt" and keeps tokens that set no project', () => {
		expect(choose('Zahnarzt @HAUS anrufen', null)).toBe('Zahnarzt anrufen');
		// Archived and unknown codes are part of the title; they stay.
		expect(choose('Umbau @ALT planen', null)).toBe('Umbau @ALT planen');
		expect(choose('Mail an @XY', 'HAUS')).toBe('Mail an @XY @HAUS');
		expect(parse(choose('Umbau @ALT planen', 'HAUS')).project).toEqual(HOUSE);
	});
});
