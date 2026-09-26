import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formErrors } from './recurrence-rule';
import {
	RRULE_NOTES,
	RRULE_REASONS,
	itemSuggestion,
	suggestRule,
	suggestionFormValues,
	type RruleSuggestion
} from './rrule';

// Suggestions from the RRULE of calendar events (ADR-0024 section 2; E5 plan, package 6). The RRULE
// lines are made up in the form Google, Outlook and Thunderbird write them, plus the lines of the
// fixtures under tests/fixtures/ics/.

const TODAY = '2026-09-25';
const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/ics');

function rule(suggestion: RruleSuggestion | null) {
	if (suggestion?.kind !== 'rule') throw new Error(`no rule: ${JSON.stringify(suggestion)}`);
	return suggestion;
}

function reasons(suggestion: RruleSuggestion | null): string[] {
	if (suggestion?.kind !== 'unsupported')
		throw new Error(`not unsupported: ${JSON.stringify(suggestion)}`);
	return suggestion.reasons;
}

describe('suggestRule: series the rules can express', () => {
	it.each([
		['FREQ=DAILY', '2026-10-01', 'daily', 1, [], 0, 'täglich'],
		['RRULE:FREQ=DAILY;INTERVAL=2', '2026-10-01', 'daily', 2, [], 0, 'alle 2 Tage'],
		['FREQ=WEEKLY;BYDAY=TU', '2026-10-06', 'weekly', 1, ['TU'], 0, 'jeden Dienstag'],
		['FREQ=WEEKLY', '2026-10-01', 'weekly', 1, ['TH'], 0, 'jeden Donnerstag'],
		[
			'FREQ=WEEKLY;BYDAY=TH,MO',
			'2026-10-01',
			'weekly',
			1,
			['MO', 'TH'],
			0,
			'jeden Montag und Donnerstag'
		],
		[
			'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
			'2026-10-01',
			'weekly',
			1,
			['MO', 'TU', 'WE', 'TH', 'FR'],
			0,
			'werktags'
		],
		[
			'FREQ=WEEKLY;WKST=SU;BYDAY=MO,WE',
			'2026-10-05',
			'weekly',
			1,
			['MO', 'WE'],
			0,
			'jeden Montag und Mittwoch'
		],
		[
			'FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=TU',
			'2026-10-06',
			'weekly',
			2,
			['TU'],
			0,
			'alle 2 Wochen am Dienstag'
		],
		[
			'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;WKST=MO',
			'2026-10-05',
			'weekly',
			2,
			['MO', 'FR'],
			0,
			'alle 2 Wochen am Montag und Freitag'
		],
		['FREQ=MONTHLY;BYMONTHDAY=15', '2026-10-15', 'monthly', 1, [], 15, 'monatlich am 15.'],
		['FREQ=MONTHLY', '2026-10-03', 'monthly', 1, [], 3, 'monatlich am 3.'],
		[
			'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=-1',
			'2026-10-31',
			'monthly',
			3,
			[],
			-1,
			'alle 3 Monate am letzten Tag'
		],
		['FREQ=YEARLY', '2026-12-24', 'yearly', 1, [], 0, 'jährlich am 24. Dezember'],
		[
			'FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=24',
			'2026-12-24',
			'yearly',
			1,
			[],
			0,
			'jährlich am 24. Dezember'
		],
		['freq=yearly;interval=2', '2026-12-24', 'yearly', 2, [], 0, 'alle 2 Jahre am 24. Dezember']
	])('%s from %s', (rrule, start, freq, interval, weekdays, monthDay, text) => {
		const suggestion = rule(suggestRule(rrule, start, TODAY));
		expect(suggestion.params).toEqual({
			mode: 'calendar',
			freq,
			interval,
			weekdays,
			month_day: monthDay,
			anchor: start,
			lead_days: 3
		});
		expect(suggestion.text).toBe(text);
		expect(suggestion.notes).toEqual([]);
	});

	it('names the clamping of days 29 to 31 and of 29 February', () => {
		expect(rule(suggestRule('FREQ=MONTHLY', '2026-10-31', TODAY)).notes).toEqual([
			RRULE_NOTES.shortMonths
		]);
		expect(rule(suggestRule('FREQ=MONTHLY;BYMONTHDAY=29', '2026-10-29', TODAY)).notes).toEqual([
			RRULE_NOTES.shortMonths
		]);
		expect(rule(suggestRule('FREQ=MONTHLY;BYMONTHDAY=28', '2026-10-28', TODAY)).notes).toEqual([]);
		expect(rule(suggestRule('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-10-31', TODAY)).notes).toEqual([]);
		expect(rule(suggestRule('FREQ=YEARLY', '2028-02-29', TODAY)).notes).toEqual([
			RRULE_NOTES.leapDay
		]);
	});

	it('starts a series that began in the past at its first date from today, in the same rhythm', () => {
		// Every other Monday from 7 September: 21 September, then 5 October (not 28 September).
		expect(
			rule(suggestRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-09-07', TODAY)).params.anchor
		).toBe('2026-10-05');
		expect(rule(suggestRule('FREQ=WEEKLY;BYDAY=MO', '2026-09-07', TODAY)).params.anchor).toBe(
			'2026-09-28'
		);
		expect(rule(suggestRule('FREQ=DAILY;INTERVAL=3', '2026-09-20', TODAY)).params.anchor).toBe(
			'2026-09-26'
		);
		// The 31st stays the 31st even when the first date from today is a clamped 30 September.
		const monthly = rule(suggestRule('FREQ=MONTHLY', '2026-01-31', TODAY)).params;
		expect(monthly).toMatchObject({ month_day: 31, anchor: '2026-09-30' });
		// A yearly rule takes its day from the anchor: 29 February waits for the next leap year.
		expect(rule(suggestRule('FREQ=YEARLY', '2024-02-29', TODAY)).params.anchor).toBe('2028-02-29');
		expect(rule(suggestRule('FREQ=YEARLY', '2020-12-24', TODAY)).params.anchor).toBe('2026-12-24');
		expect(rule(suggestRule('FREQ=DAILY', TODAY, TODAY)).params.anchor).toBe(TODAY);
	});

	it('gives values the form accepts without errors', () => {
		for (const [rrule, start] of [
			['FREQ=WEEKLY;BYDAY=MO,TH', '2026-10-01'],
			['FREQ=MONTHLY;BYMONTHDAY=-1', '2026-10-31'],
			['FREQ=MONTHLY;BYMONTHDAY=15', '2026-10-15'],
			['FREQ=YEARLY', '2028-02-29'],
			['FREQ=DAILY;INTERVAL=5', '2026-10-01']
		] as const) {
			const values = suggestionFormValues(rule(suggestRule(rrule, start, TODAY)).params);
			expect(formErrors(values), rrule).toEqual({});
		}
		expect(
			suggestionFormValues(
				rule(suggestRule('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-10-31', TODAY)).params
			)
		).toEqual({
			mode: 'calendar',
			freq: 'monthly',
			interval: '1',
			weekdays: ['SA'],
			monthDay: '31',
			lastDay: true,
			anchor: '2026-10-31',
			leadDays: '3'
		});
		expect(
			suggestionFormValues(rule(suggestRule('FREQ=WEEKLY;BYDAY=MO,TH', '2026-10-01', TODAY)).params)
		).toMatchObject({ freq: 'weekly', weekdays: ['MO', 'TH'], monthDay: '1', lastDay: false });
	});
});

describe('suggestRule: series the rules cannot express', () => {
	it.each([
		['FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T235959Z', RRULE_REASONS.end],
		['FREQ=DAILY;COUNT=10', RRULE_REASONS.end],
		['FREQ=MONTHLY;BYDAY=2MO', RRULE_REASONS.nthWeekday],
		['FREQ=MONTHLY;BYDAY=-1FR', RRULE_REASONS.nthWeekday],
		['FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO,TU,WE,TH,FR', RRULE_REASONS.nthWeekday],
		['FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', RRULE_REASONS.nthWeekday],
		['FREQ=HOURLY;INTERVAL=4', RRULE_REASONS.subDaily],
		['FREQ=MINUTELY', RRULE_REASONS.subDaily],
		['FREQ=DAILY;BYHOUR=9,17', RRULE_REASONS.subDaily],
		['FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', RRULE_REASONS.weekdays],
		['FREQ=MONTHLY;BYDAY=MO', RRULE_REASONS.weekdays],
		['FREQ=MONTHLY;BYMONTHDAY=1,15', RRULE_REASONS.monthDays],
		['FREQ=MONTHLY;BYMONTHDAY=-2', RRULE_REASONS.monthDays],
		['FREQ=WEEKLY;BYMONTHDAY=1', RRULE_REASONS.monthDayFreq],
		['FREQ=DAILY;BYMONTH=1,2', RRULE_REASONS.months],
		['FREQ=YEARLY;BYMONTH=3', RRULE_REASONS.yearlyOther],
		['FREQ=YEARLY;BYMONTHDAY=1', RRULE_REASONS.yearlyOther],
		['FREQ=YEARLY;BYYEARDAY=100', RRULE_REASONS.yearDay],
		['FREQ=YEARLY;BYWEEKNO=20', RRULE_REASONS.yearDay],
		['FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=MO,WE', RRULE_REASONS.weekStart],
		['FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=SU', RRULE_REASONS.weekStart],
		['FREQ=DAILY;INTERVAL=0', RRULE_REASONS.interval],
		['FREQ=DAILY;INTERVAL=366', RRULE_REASONS.interval],
		['FREQ=DAILY;X-NAME=1', RRULE_REASONS.unknown('X-NAME')],
		['FREQ=WEEKLY;BYDAY=XX', RRULE_REASONS.syntax],
		['FREQ=DAILY;INTERVAL=zwei', RRULE_REASONS.syntax],
		['FREQ=FORTNIGHTLY', RRULE_REASONS.syntax],
		['INTERVAL=2', RRULE_REASONS.syntax],
		['FREQ', RRULE_REASONS.syntax],
		['FREQ=', RRULE_REASONS.syntax],
		['FREQ=WEEKLY;FREQ=DAILY', RRULE_REASONS.syntax],
		['FREQ=MONTHLY;BYMONTHDAY=32', RRULE_REASONS.syntax],
		['FREQ=YEARLY;BYMONTH=13', RRULE_REASONS.syntax],
		['FREQ=WEEKLY;WKST=XY', RRULE_REASONS.syntax]
	])('%s', (rrule, reason) => {
		// Start on a Tuesday, 6 October 2026.
		const suggestion = suggestRule(rrule, '2026-10-06', TODAY);
		expect(reasons(suggestion)).toContain(reason);
		// Never a partial suggestion.
		expect(suggestion).not.toHaveProperty('params');
	});

	it('lists every reason once', () => {
		expect(
			reasons(suggestRule('FREQ=MONTHLY;BYDAY=2MO,-1MO;COUNT=5', '2026-10-12', TODAY))
		).toEqual([RRULE_REASONS.end, RRULE_REASONS.nthWeekday]);
	});

	it('refuses a start that is not a date', () => {
		expect(reasons(suggestRule('FREQ=DAILY', '2026-02-30', TODAY))).toEqual([RRULE_REASONS.syntax]);
	});

	it('gives null without an RRULE', () => {
		expect(suggestRule(undefined, '2026-10-06', TODAY)).toBeNull();
		expect(suggestRule(null, '2026-10-06', TODAY)).toBeNull();
		expect(suggestRule('  ', '2026-10-06', TODAY)).toBeNull();
	});
});

describe('suggestRule: the RRULE lines of the fixtures', () => {
	const lines = readdirSync(FIXTURES)
		.filter((file) => file.endsWith('.ics'))
		.flatMap((file) =>
			readFileSync(join(FIXTURES, file), 'utf8')
				.split(/\r?\n/)
				.filter((line) => line.startsWith('RRULE:'))
				.map((line) => [file, line] as const)
		);

	it('finds the lines', () => {
		expect(lines.length).toBeGreaterThanOrEqual(7);
	});

	it.each(lines)('%s: %s', (_file, line) => {
		const suggestion = suggestRule(line, '2026-09-07', TODAY);
		if (line === 'RRULE:FREQ=WEEKLY;BYDAY=MO') {
			expect(rule(suggestion).text).toBe('jeden Montag');
		} else {
			// The time zone rules ("last Sunday in March") are not a rule of this app.
			expect(reasons(suggestion)).toContain(RRULE_REASONS.nthWeekday);
		}
	});
});

describe('itemSuggestion', () => {
	const item = (
		sourceMeta: Record<string, unknown>,
		sourceDate: string | null = '2026-10-05 16:30:00.000Z'
	) => ({
		sourceDate,
		sourceMeta
	});

	it('takes the Berlin date of the date at the sender as the start', () => {
		// 18:30 in Berlin on Monday, 5 October.
		expect(rule(itemSuggestion(item({ rrule: 'FREQ=WEEKLY' }), TODAY)).params).toMatchObject({
			weekdays: ['MO'],
			anchor: '2026-10-05'
		});
		// An all-day event starts at midnight in Berlin (22:00 or 23:00 UTC the day before).
		expect(
			rule(
				itemSuggestion(
					item({ rrule: 'FREQ=YEARLY', all_day: true }, '2026-12-23 23:00:00.000Z'),
					TODAY
				)
			).params.anchor
		).toBe('2026-12-24');
	});

	it('gives nothing for a single changed occurrence, without an RRULE or without a date', () => {
		expect(
			itemSuggestion(item({ rrule: 'FREQ=WEEKLY', recurrence_id: '20260921T183000' }), TODAY)
		).toBeNull();
		expect(itemSuggestion(item({}), TODAY)).toBeNull();
		expect(itemSuggestion(item({ rrule: 42 }), TODAY)).toBeNull();
		expect(itemSuggestion(item({ rrule: 'FREQ=WEEKLY' }, null), TODAY)).toBeNull();
		expect(itemSuggestion(item({ rrule: 'FREQ=WEEKLY', recurrence_id: '' }), TODAY)?.kind).toBe(
			'rule'
		);
	});

	it('passes on an RRULE it cannot express', () => {
		expect(reasons(itemSuggestion(item({ rrule: 'FREQ=WEEKLY;COUNT=3' }), TODAY))).toEqual([
			RRULE_REASONS.end
		]);
	});
});
