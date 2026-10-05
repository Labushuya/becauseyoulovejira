// Texts and helpers of the day plan in the SPA (TP-1, ADR-0065): the kind, the names of sources and
// modes, the title of a day, the progress, the hint at the other area and initials. The rules shared
// with the hook are compared in tests/unit/web-day-plan.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	DAY_PLAN_SOURCES,
	KIND_LABELS,
	MODE_LABELS,
	ONGOING_BADGE,
	SOURCE_LABELS,
	dayTitle,
	initialsOf,
	isTicketKind,
	kindOf,
	otherAreaText,
	progressText
} from './day-plan';

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
	it('names the six sources and the three modes in German', () => {
		expect(DAY_PLAN_SOURCES.map((source) => SOURCE_LABELS[source])).toEqual([
			'Laufende Vorhaben',
			'Heute fällig',
			'Überfällig',
			'Wiederholung von heute',
			'Übrig von gestern',
			'In Arbeit'
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
