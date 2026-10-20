// Texts and helpers of the day plan in the SPA (TP-1, ADR-0065): the kind, the names of sources and
// modes, the title of a day, the progress, the hint at the other area and initials; since TP-4 the
// blocks of the plan, since TP-5 the order of a request of the order. The rules shared with the hook
// are compared in tests/unit/web-day-plan.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	DAY_PLAN_SOURCES,
	KIND_LABELS,
	MODE_LABELS,
	ONGOING_BADGE,
	SOURCE_LABELS,
	blockSize,
	blockStep,
	changedRange,
	dayTitle,
	initialsOf,
	isTicketKind,
	kindOf,
	movedBlock,
	otherAreaText,
	progressText,
	shortDayTitle,
	withOrder
} from './day-plan';

describe('blocks of the plan (TP-4)', () => {
	// q, its sub-task, p, its two sub-tasks, a: as nestedInOrder indents them.
	const ids = ['q', 'q1', 'p', 'p1', 'p2', 'a'];
	const nested = [false, true, false, true, true, false];

	it('takes a parent with the sub-tasks indented directly below it, every other entry alone', () => {
		expect(nested.map((_, index) => blockSize(nested, index))).toEqual([2, 1, 3, 1, 1, 1]);
		expect(blockSize(nested, -1)).toBe(1);
		expect(blockSize(nested, 6)).toBe(1);
		expect(blockSize([], 0)).toBe(1);
	});

	it('moves a block to a place among the other entries, clamped', () => {
		expect(movedBlock(ids, 2, 3, 0)).toEqual(['p', 'p1', 'p2', 'q', 'q1', 'a']);
		expect(movedBlock(ids, 2, 3, 3)).toEqual(['q', 'q1', 'a', 'p', 'p1', 'p2']);
		expect(movedBlock(ids, 2, 3, 99)).toEqual(['q', 'q1', 'a', 'p', 'p1', 'p2']);
		expect(movedBlock(ids, 2, 3, -1)).toEqual(['p', 'p1', 'p2', 'q', 'q1', 'a']);
		expect(movedBlock(ids, 5, 1, 1.6)).toEqual(['q', 'a', 'q1', 'p', 'p1', 'p2']);
	});

	it('steps a block past the whole neighbour above or below it; nothing at the edges', () => {
		expect(blockStep(nested, 2, 3, -1)).toBe(0);
		expect(blockStep(nested, 2, 3, 1)).toBe(3);
		expect(blockStep(nested, 0, 2, -1)).toBeNull();
		expect(blockStep(nested, 0, 2, 1)).toBe(3);
		expect(blockStep([false, true, false], 0, 2, 1)).toBe(1);
		expect(blockStep([false, false, true], 1, 2, 1)).toBeNull();
	});

	it('names the part of the plan that changed', () => {
		expect(changedRange(ids, movedBlock(ids, 2, 3, 0))).toEqual(['p', 'p1', 'p2', 'q', 'q1']);
		expect(changedRange(ids, movedBlock(ids, 2, 3, 3))).toEqual(['a', 'p', 'p1', 'p2']);
		expect(changedRange(['a', 'b'], ['b', 'a'])).toEqual(['b', 'a']);
		expect(changedRange(ids, ids)).toEqual([]);
	});
});

describe('the order of a request of the order in the list (TP-5)', () => {
	it('puts the named entries on the places they hold together; every other one keeps its place', () => {
		const current = ['a', 'b', 'c', 'd', 'e'];
		// The whole plan: the order named.
		expect(withOrder(current, ['e', 'd', 'c', 'b', 'a'])).toEqual(['e', 'd', 'c', 'b', 'a']);
		// A part: b and d swap, the rest stays.
		expect(withOrder(current, ['d', 'b'])).toEqual(['a', 'd', 'c', 'b', 'e']);
		// An entry added meanwhile (x) keeps its place; one removed meanwhile (z) is left out.
		expect(withOrder(['x', 'a', 'b'], ['b', 'z', 'a'])).toEqual(['x', 'b', 'a']);
		expect(withOrder(current, ['b', 'b', 'a'])).toEqual(['b', 'a', 'c', 'd', 'e']);
		expect(withOrder(current, [])).toEqual(current);
	});
});

describe('kind of a ticket', () => {
	it('is "Laufendes Vorhaben" only for ongoing, "Aufgabe" otherwise', () => {
		expect(kindOf('ongoing')).toBe('ongoing');
		expect(kindOf('')).toBe('task');
		expect(kindOf(undefined)).toBe('task');
		expect(isTicketKind('task')).toBe(true);
		expect(isTicketKind('ongoing')).toBe(true);
		expect(isTicketKind('projekt')).toBe(false);
		expect(KIND_LABELS).toEqual({ task: 'Aufgabe', ongoing: 'Laufendes Vorhaben' });
		expect(ONGOING_BADGE).toBe('Vorhaben');
	});
});

describe('names of the settings', () => {
	it('names the seven sources and the three modes in German', () => {
		expect(DAY_PLAN_SOURCES.map((source) => SOURCE_LABELS[source])).toEqual([
			'Laufende Vorhaben',
			'Heute fällig',
			'Überfällig',
			'Wiederholung von heute',
			'Übrig von gestern',
			'In Arbeit',
			'Mir zugewiesen'
		]);
		expect(MODE_LABELS).toEqual({
			off: 'Aus',
			suggest: 'Vorschlagen',
			auto: 'Automatisch übernehmen'
		});
	});
});

describe('texts of the page', () => {
	it('names today, tomorrow, yesterday and any other day with weekday and date', () => {
		expect(dayTitle('2031-05-14', '2031-05-14')).toBe('Heute, Mittwoch, 14. Mai 2031');
		expect(dayTitle('2031-05-15', '2031-05-14')).toBe('Morgen, Donnerstag, 15. Mai 2031');
		expect(dayTitle('2031-05-13', '2031-05-14')).toBe('Gestern, Dienstag, 13. Mai 2031');
		expect(dayTitle('2031-03-01', '2031-05-14')).toBe('Samstag, 1. März 2031');
		expect(dayTitle('2032-01-01', '2031-12-31')).toBe('Morgen, Donnerstag, 1. Januar 2032');
	});

	it('names the same days short for the head on a phone, the year only when it is another (MO-6b)', () => {
		expect(shortDayTitle('2026-10-20', '2026-10-20')).toBe('Heute, Di., 20. Okt.');
		expect(shortDayTitle('2026-10-21', '2026-10-20')).toBe('Morgen, Mi., 21. Okt.');
		expect(shortDayTitle('2026-10-19', '2026-10-20')).toBe('Gestern, Mo., 19. Okt.');
		expect(shortDayTitle('2026-10-15', '2026-10-20')).toBe('Do., 15. Okt.');
		expect(shortDayTitle('2031-05-14', '2031-05-14')).toBe('Heute, Mi., 14. Mai');
		expect(shortDayTitle('2031-03-01', '2031-05-14')).toBe('Sa., 1. März');
		expect(shortDayTitle('2031-09-07', '2031-09-08')).toBe('Gestern, So., 7. Sept.');
		expect(shortDayTitle('2032-01-01', '2031-12-31')).toBe('Morgen, Do., 1. Jan. 2032');
		expect(shortDayTitle('2030-12-30', '2031-01-02')).toBe('Mo., 30. Dez. 2030');
	});

	it('counts done entries, also for a screen reader', () => {
		expect(progressText(3, 7)).toEqual({
			text: '3/7 erledigt',
			spoken: '3 von 7 Einträgen erledigt'
		});
		expect(progressText(0, 1)).toEqual({
			text: '0/1 erledigt',
			spoken: '0 von 1 Eintrag erledigt'
		});
	});

	it('hints at the other area by the number of its entries only', () => {
		expect(otherAreaText('Im Haushalt', 3)).toBe('Im Haushalt: 3 Einträge für heute');
		expect(otherAreaText('Privat', 1)).toBe('Privat: 1 Eintrag für heute');
		expect(otherAreaText('Im Haushalt', 0)).toBe('Im Haushalt: 0 Einträge für heute');
	});

	it('takes the first and the last initial of a name', () => {
		expect(initialsOf('Anna Beispiel')).toBe('AB');
		expect(initialsOf('Bert')).toBe('B');
		expect(initialsOf('  anna  maria beispiel ')).toBe('AB');
		expect(initialsOf('')).toBe('');
	});
});
