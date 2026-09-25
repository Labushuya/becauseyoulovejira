import { describe, expect, it } from 'vitest';
import { joinWords, recurrenceText, recurrenceTextInSentence, shortDate } from './recurrence-text';

// Rhythm in words (E5 plan, package 1).

const calendar = (params: Record<string, unknown>) => ({
	mode: 'calendar',
	anchor: '2026-09-24',
	...params
});
const completion = (freq: string, interval: number) => ({
	mode: 'after_completion',
	freq,
	interval,
	anchor: '2026-09-24'
});

describe('recurrenceText', () => {
	it.each([
		[calendar({ freq: 'daily' }), 'Täglich'],
		[calendar({ freq: 'daily', interval: 2 }), 'Alle 2 Tage'],
		[calendar({ freq: 'weekly', weekdays: ['TH', 'MO'] }), 'Jeden Montag und Donnerstag'],
		[
			calendar({ freq: 'weekly', weekdays: ['MO', 'WE', 'FR'] }),
			'Jeden Montag, Mittwoch und Freitag'
		],
		[calendar({ freq: 'weekly' }), 'Jeden Donnerstag'],
		[calendar({ freq: 'weekly', interval: 2, weekdays: ['MO'] }), 'Alle 2 Wochen am Montag'],
		[calendar({ freq: 'weekly', weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] }), 'Werktags'],
		[
			calendar({ freq: 'weekly', interval: 2, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] }),
			'Alle 2 Wochen werktags'
		],
		[calendar({ freq: 'monthly', month_day: 15 }), 'Monatlich am 15.'],
		[calendar({ freq: 'monthly', month_day: -1 }), 'Monatlich am letzten Tag'],
		[calendar({ freq: 'monthly', interval: 3, month_day: 1 }), 'Alle 3 Monate am 1.'],
		[calendar({ freq: 'yearly', anchor: '2024-02-29' }), 'Jährlich am 29. Februar'],
		[
			calendar({ freq: 'yearly', interval: 2, anchor: '2026-12-01' }),
			'Alle 2 Jahre am 1. Dezember'
		],
		[completion('daily', 3), '3 Tage nach Erledigung'],
		[completion('daily', 1), '1 Tag nach Erledigung'],
		[completion('weekly', 2), '2 Wochen nach Erledigung'],
		[completion('monthly', 1), '1 Monat nach Erledigung'],
		[completion('yearly', 1), '1 Jahr nach Erledigung']
	])('%o reads „%s“', (rule, text) => {
		expect(recurrenceText(rule)).toBe(text);
	});

	it('is empty for an invalid rule', () => {
		expect(recurrenceText({ mode: 'calendar', freq: 'daily', anchor: '' })).toBe('');
		expect(recurrenceText(null)).toBe('');
	});

	it('starts small in the middle of a sentence, except with a number', () => {
		expect(recurrenceTextInSentence(calendar({ freq: 'weekly', weekdays: ['MO'] }))).toBe(
			'jeden Montag'
		);
		expect(recurrenceTextInSentence(completion('daily', 3))).toBe('3 Tage nach Erledigung');
	});
});

describe('helpers', () => {
	it('joins words with commas and „und“', () => {
		expect(joinWords([])).toBe('');
		expect(joinWords(['Montag'])).toBe('Montag');
		expect(joinWords(['a', 'b', 'c'])).toBe('a, b und c');
	});

	it('writes short dates with the year only when it differs', () => {
		expect(shortDate('2026-09-28', '2026-09-25')).toBe('28.09.');
		expect(shortDate('2027-01-04', '2026-09-25')).toBe('04.01.2027');
	});
});
