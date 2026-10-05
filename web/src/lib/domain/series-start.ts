// Where a new series begins (WH-2, ADR-0022 addendum 14): a mirror of firstFromToday and createDates
// of app/pb_hooks/lib/recurrence-rules.js, with the same inputs and results. The server decides when
// a rule is created (body field `start`); the form names the same dates before (seriesStartQuestion
// in recurrence-rule.ts), and the panel shows the ticket as the server leaves it (joinedSeries).
// tests/unit/recurrence-examples.test.mjs compares both for random rules.

import type { CalendarDate } from './berlin-date';
import { after, onOrAfter, validRule, type RecurrenceParams } from './recurrence';

/**
 * Where a series begins whose first date lies in the past, sent as the body field `start`: "Serie ab
 * heute beginnen" ('today') or "Ursprüngliches Datum behalten" ('keep').
 */
export type SeriesStart = 'today' | 'keep';

/** "Serie ab heute beginnen" is chosen in advance. */
export const DEFAULT_SERIES_START: SeriesStart = 'today';

/**
 * firstFromToday of the hook: the first regular date of a fixed rhythm on or after `today` (never
 * before the anchor); after completion `today`, or the anchor when it lies later. Null for an invalid
 * rule.
 */
export function firstFromToday(rule: RecurrenceParams, today: CalendarDate): CalendarDate | null {
	const valid = validRule(rule);
	if (valid === null) return null;
	if (valid.mode === 'calendar') return onOrAfter(valid, today);
	return valid.anchor > today ? valid.anchor : today;
}

/** next_due of a new rule ('' for none) and the due date its ticket gets (null: unchanged). */
export interface CreateDates {
	nextDue: CalendarDate | '';
	ticketDue: CalendarDate | null;
}

/**
 * createDates of the hook (ADR-0023 section 1): with a ticket the series begins with its due date,
 * or with the first date of a fixed rhythm for a ticket without one; `start` 'today' moves a first
 * date before today to firstFromToday. A rule without a ticket begins from today anyway. Null for an
 * invalid rule.
 */
export function createDates(input: {
	rule: RecurrenceParams;
	withTicket: boolean;
	ticketDue: CalendarDate | '';
	today: CalendarDate;
	start?: SeriesStart;
}): CreateDates | null {
	const rule = validRule(input.rule);
	if (rule === null) return null;
	const { today } = input;
	const calendar = rule.mode === 'calendar';
	if (!input.withTicket) {
		if (calendar) return { nextDue: onOrAfter(rule, today), ticketDue: null };
		return { nextDue: rule.anchor > today ? rule.anchor : today, ticketDue: null };
	}
	const hasDue = input.ticketDue !== '';
	let first: CalendarDate | '' = hasDue
		? input.ticketDue
		: calendar
			? onOrAfter(rule, rule.anchor)
			: '';
	const moved = input.start === 'today' && first !== '' && first < today;
	if (moved) first = firstFromToday(rule, today) ?? first;
	return {
		nextDue: calendar && first !== '' ? after(rule, first) : '',
		ticketDue: first === '' || (hasDue && !moved) ? null : first
	};
}
