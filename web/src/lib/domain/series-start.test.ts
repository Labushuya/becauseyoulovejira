import { describe, expect, it } from 'vitest';
import { berlinToday } from './berlin-date';
import {
	defaultFormValues,
	firstOccurrenceText,
	joinedSeries,
	keepStartText,
	seriesStartQuestion,
	seriesStartText,
	type RecurrenceFormValues
} from './recurrence-rule';
import { DEFAULT_SERIES_START, createDates, firstFromToday } from './series-start';

// WH-2 (ADR-0022 addendum 14): a series whose first date lies in the past begins from today, unless
// the user keeps the date. The mirror of the hook (series-start.ts; tests/unit/recurrence-examples
// compares it with the hook for random rules) and what the form says about it.

const weeklyOn = (weekday: string, anchor = '2024-03-12') => ({
	mode: 'calendar',
	freq: 'weekly',
	interval: 1,
	weekdays: [weekday],
	anchor,
	lead_days: 3
});

describe('the first date from today (firstFromToday)', () => {
	it('is the first regular date on or after today: weekdays, daily, intervals', () => {
		// "wöchentlich montags" on a Wednesday: the coming Monday.
		expect(firstFromToday(weeklyOn('MO'), '2026-10-07')).toBe('2026-10-12');
		// On the weekday itself: today.
		expect(firstFromToday(weeklyOn('MO'), '2026-10-05')).toBe('2026-10-05');
		// Several weekdays: the next of them.
		expect(firstFromToday({ ...weeklyOn('MO'), weekdays: ['MO', 'TH'] }, '2026-10-06')).toBe(
			'2026-10-08'
		);
		// Daily: today.
		const daily = { mode: 'calendar', freq: 'daily', anchor: '2024-03-12', lead_days: 3 };
		expect(firstFromToday(daily, '2026-09-25')).toBe('2026-09-25');
		// Every 3 days from 12.03.2024: the rhythm of the anchor holds (930 days to 28.09.2026).
		expect(firstFromToday({ ...daily, interval: 3 }, '2026-09-27')).toBe('2026-09-28');
		// Every two weeks: the week of 28.09.2026 is not in the rhythm of 12.03.2024, 05.10. is.
		expect(firstFromToday({ ...weeklyOn('TU'), interval: 2 }, '2026-09-25')).toBe('2026-10-06');
		// Never before the anchor.
		expect(firstFromToday(weeklyOn('MO', '2026-11-02'), '2026-10-07')).toBe('2026-11-02');
	});

	it('keeps the end of the month and the 29th of February', () => {
		const monthly = (month_day: number, anchor = '2024-01-31') => ({
			mode: 'calendar',
			freq: 'monthly',
			month_day,
			anchor,
			lead_days: 3
		});
		expect(firstFromToday(monthly(31), '2027-02-10')).toBe('2027-02-28');
		expect(firstFromToday(monthly(31), '2028-02-10')).toBe('2028-02-29');
		expect(firstFromToday(monthly(31), '2027-03-01')).toBe('2027-03-31');
		expect(firstFromToday(monthly(-1), '2026-09-25')).toBe('2026-09-30');
		const leap = { mode: 'calendar', freq: 'yearly', anchor: '2024-02-29', lead_days: 3 };
		expect(firstFromToday(leap, '2026-09-25')).toBe('2027-02-28');
		expect(firstFromToday(leap, '2027-03-01')).toBe('2028-02-29');
	});

	it('takes the Berlin day, also on both days of the clock change', () => {
		// 29.03.2026 00:30 (still winter time) is 28.03. 23:30 UTC; 25.10.2026 00:30 (still summer
		// time) is 24.10. 22:30 UTC: in UTC both are the day before, in Berlin the Sunday.
		const spring = berlinToday(Date.UTC(2026, 2, 28, 23, 30));
		const autumn = berlinToday(Date.UTC(2026, 9, 24, 22, 30));
		expect([spring, autumn]).toEqual(['2026-03-29', '2026-10-25']);
		const sundays = weeklyOn('SU');
		expect(firstFromToday(sundays, spring)).toBe('2026-03-29');
		expect(firstFromToday(sundays, autumn)).toBe('2026-10-25');
		// One hour earlier it is still Saturday in Berlin: the Sunday is the next day.
		expect(firstFromToday(sundays, berlinToday(Date.UTC(2026, 2, 28, 22, 30)))).toBe('2026-03-29');
	});

	it('is today after completion, or a later anchor; nothing for an invalid rule', () => {
		const completion = {
			mode: 'after_completion',
			freq: 'weekly',
			anchor: '2024-03-12',
			lead_days: 3
		};
		expect(firstFromToday(completion, '2026-09-25')).toBe('2026-09-25');
		expect(firstFromToday({ ...completion, anchor: '2026-10-01' }, '2026-09-25')).toBe(
			'2026-10-01'
		);
		expect(firstFromToday({ ...weeklyOn('MO'), freq: 'x' }, '2026-09-25')).toBeNull();
	});
});

describe('the dates of a new rule (createDates, mirror of the hook)', () => {
	const today = '2026-10-07';
	const rule = weeklyOn('MO');

	it('moves a ticket overdue since long ago to the first date from today, or keeps it', () => {
		const base = { rule, withTicket: true, ticketDue: '2024-03-11' as const, today };
		expect(createDates({ ...base, start: 'today' })).toEqual({
			nextDue: '2026-10-19',
			ticketDue: '2026-10-12'
		});
		// Kept, or a client from before WH-2 without `start`: the series goes on after its date.
		expect(createDates({ ...base, start: 'keep' })).toEqual({
			nextDue: '2024-03-18',
			ticketDue: null
		});
		expect(createDates(base)).toEqual({ nextDue: '2024-03-18', ticketDue: null });
	});

	it('gives a ticket without due date its first date, from today when that lies in the past', () => {
		const base = { rule, withTicket: true, ticketDue: '' as const, today };
		expect(createDates({ ...base, start: 'today' })).toEqual({
			nextDue: '2026-10-19',
			ticketDue: '2026-10-12'
		});
		expect(createDates({ ...base, start: 'keep' })).toEqual({
			nextDue: '2024-03-25',
			ticketDue: '2024-03-18'
		});
	});

	it('leaves a date from today on as it is', () => {
		for (const due of ['2026-10-07', '2026-10-12', '2026-11-30'] as const) {
			const dates = createDates({ rule, withTicket: true, ticketDue: due, today, start: 'today' });
			expect(dates?.ticketDue, due).toBeNull();
		}
	});

	it('after completion: today instead of the date in the past, next_due waits for the completion', () => {
		const completion = {
			mode: 'after_completion',
			freq: 'daily',
			interval: 2,
			anchor: '2024-03-11',
			lead_days: 0
		};
		const base = { rule: completion, withTicket: true, ticketDue: '2024-03-11' as const, today };
		expect(createDates({ ...base, start: 'today' })).toEqual({ nextDue: '', ticketDue: today });
		expect(createDates({ ...base, start: 'keep' })).toEqual({ nextDue: '', ticketDue: null });
		// Without due date the ticket keeps none.
		expect(createDates({ ...base, ticketDue: '', start: 'today' })).toEqual({
			nextDue: '',
			ticketDue: null
		});
	});

	it('begins a rule without a ticket from today anyway', () => {
		expect(createDates({ rule, withTicket: false, ticketDue: '', today })).toEqual({
			nextDue: '2026-10-12',
			ticketDue: null
		});
		expect(
			createDates({ rule: { ...rule, freq: 'x' }, withTicket: false, ticketDue: '', today })
		).toBeNull();
	});
});

describe('the hint of the form (seriesStartQuestion)', () => {
	const TODAY = '2026-09-25';
	const values = (overrides: Partial<RecurrenceFormValues> = {}) => ({
		...defaultFormValues('2024-03-12', TODAY),
		...overrides
	});

	it('asks for a ticket with a due date in the past and names both dates', () => {
		const question = seriesStartQuestion(values(), TODAY, { kind: 'ticket', due: '2024-03-12' });
		expect(question).toEqual({
			reason: 'due',
			past: '2024-03-12',
			first: '2026-09-29',
			choice: true
		});
		expect(seriesStartText(question!)).toBe(
			'Die Fälligkeit liegt in der Vergangenheit (12.03.2024).'
		);
		expect(firstOccurrenceText(question!, TODAY)).toBe('Erstes Vorkommen: Di 29.09.');
		expect(keepStartText(question!, TODAY)).toBe('Das Ticket bleibt „überfällig seit 12.03.2024“.');
		const daily = seriesStartQuestion(values({ freq: 'daily' }), TODAY, {
			kind: 'ticket',
			due: '2024-03-12'
		});
		expect(firstOccurrenceText(daily!, TODAY)).toBe('Erstes Vorkommen: Fr 25.09. (heute)');
		// Next year with the year.
		const yearly = seriesStartQuestion(values({ freq: 'yearly' }), TODAY, {
			kind: 'ticket',
			due: '2024-03-12'
		});
		expect(firstOccurrenceText(yearly!, TODAY)).toBe('Erstes Vorkommen: Fr 12.03.2027');
	});

	it('asks for a ticket without due date when its first date lies in the past', () => {
		const start = values({ anchor: '2026-09-07', weekdays: ['MO'] });
		const question = seriesStartQuestion(start, TODAY, { kind: 'ticket', due: null });
		expect(question).toEqual({
			reason: 'first',
			past: '2026-09-07',
			first: '2026-09-28',
			choice: true
		});
		expect(seriesStartText(question!)).toBe(
			'Der erste Termin liegt in der Vergangenheit (07.09.2026).'
		);
		expect(keepStartText(question!, TODAY)).toBe('Das Ticket bleibt „überfällig seit 07.09.“.');
		// The same for a caller without a context that says the ticket has no due date.
		expect(seriesStartQuestion(start, TODAY, undefined, true)).toEqual(question);
	});

	it('only informs for a new rule (no context): it begins from today anyway', () => {
		const question = seriesStartQuestion(values({ anchor: '2026-09-01' }), TODAY, undefined);
		expect(question).toEqual({
			reason: 'rule',
			past: '2026-09-01',
			first: '2026-09-29',
			choice: false
		});
		expect(seriesStartText(question!)).toBe(
			'„Beginnt am“ liegt in der Vergangenheit (01.09.2026).'
		);
		expect(seriesStartQuestion(values({ anchor: TODAY }), TODAY, undefined)).toBeNull();
	});

	it('asks nothing for today or later, while a rule is edited, or for invalid values', () => {
		expect(seriesStartQuestion(values(), TODAY, { kind: 'ticket', due: TODAY })).toBeNull();
		expect(seriesStartQuestion(values(), TODAY, { kind: 'ticket', due: '2026-10-01' })).toBeNull();
		expect(
			seriesStartQuestion(values(), TODAY, { kind: 'rule', nextDue: '2026-09-29', each: false })
		).toBeNull();
		expect(
			seriesStartQuestion(values({ interval: '0' }), TODAY, { kind: 'ticket', due: '2024-03-12' })
		).toBeNull();
		expect(seriesStartQuestion(values(), TODAY, { kind: 'ticket', due: 'kaputt' })).toBeNull();
		// After completion a ticket without due date keeps none.
		expect(
			seriesStartQuestion(values({ mode: 'after_completion' }), TODAY, {
				kind: 'ticket',
				due: null
			})
		).toBeNull();
	});
});

describe('the ticket after "Wiederholen…" (joinedSeries)', () => {
	const TODAY = '2026-09-25';
	const ticket = (due: string | null) => ({ due, recurring: false, recurrenceId: null });

	it('shows the date the server gives it: from today unless kept', () => {
		const values = defaultFormValues('2024-03-12', TODAY);
		expect(DEFAULT_SERIES_START).toBe('today');
		expect(joinedSeries(ticket('2024-03-12'), 'r1', values, TODAY)).toEqual({
			due: '2026-09-29',
			recurring: true,
			recurrenceId: 'r1'
		});
		expect(joinedSeries(ticket('2024-03-12'), 'r1', { ...values, start: 'keep' }, TODAY).due).toBe(
			'2024-03-12'
		);
		// A ticket without due date gets the first date; a later one stays.
		expect(joinedSeries(ticket(null), 'r1', defaultFormValues(null, TODAY), TODAY).due).toBe(TODAY);
		expect(joinedSeries(ticket('2026-10-06'), 'r1', values, TODAY).due).toBe('2026-10-06');
		// Invalid values change nothing but the series.
		expect(joinedSeries(ticket(null), 'r1', { ...values, interval: 'x' }, TODAY).due).toBeNull();
	});
});
