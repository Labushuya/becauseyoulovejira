// Decisions of the generation in the SPA (ADR-0022 with addenda 2, 4, 5 and 13): a mirror of the
// pure functions of app/pb_hooks/lib/recurrence-rules.js that the server runs before it creates
// tickets (generation, generationEach, backlogCount, backlogDecision, nextDueAfterDay,
// nextDueOnCompletion, skippedDates), with the same inputs and results. The SPA creates no tickets with them: the help page and the
// explanation in the form play their examples through them (recurrence-examples.ts), so every
// date they name is what the server would do. tests/unit/web-recurrence.test.mjs runs the same
// examples with the functions of the hook and compares every result.

import type { CalendarDate } from './berlin-date';
import {
	after,
	afterCompletion,
	catchUp,
	createOn,
	onOrAfter,
	validRule,
	type RecurrenceParams
} from './recurrence';
import { CATCH_UP_ALL_HINT, EACH_LIMIT_HINT, EACH_MAX_PER_RUN } from './recurrence-rule';

/**
 * A rule as the generation sees it: parameters, `active`, the stored `next_due` and `each`
 * ("Verpasste Termine nachholen"; absent counts as off).
 */
export interface GenerationRule extends RecurrenceParams {
	active: boolean;
	next_due: CalendarDate | '';
	each?: boolean;
}

export type GenerationPlan = { due: CalendarDate; nextDue: CalendarDate | '' } | null;

export type EachPlan =
	| { ask: true }
	| { dues: CalendarDate[]; nextDue: CalendarDate; limited: boolean; hint: string }
	| null;

export interface SkippedPlan {
	count: number;
	dates: CalendarDate[];
	more: boolean;
}

const SKIPPED_DATES_MAX = 5;
const SKIPPED_COUNT_MAX = 1000;

/** generation of the hook: the next ticket without "Jeden Termin einzeln anlegen", or null. */
export function generation(input: {
	rule: GenerationRule;
	hasOpenInstance: boolean;
	today: CalendarDate;
}): GenerationPlan {
	const { rule, today } = input;
	const valid = validRule(rule);
	if (!rule.active || rule.next_due === '' || input.hasOpenInstance || valid === null) return null;
	if (today < createOn(rule.next_due, valid.lead_days)) return null;
	if (valid.mode === 'calendar') {
		const due = catchUp(valid, rule.next_due, today);
		return { due, nextDue: after(valid, due) };
	}
	return { due: rule.next_due, nextDue: '' };
}

/** backlogCount of the hook: dates from next_due before today, up to `cap`. */
export function backlogCount(rule: GenerationRule, today: CalendarDate, cap: number): number {
	const valid = validRule(rule);
	if (valid === null || valid.mode !== 'calendar' || rule.next_due === '') return 0;
	let count = 0;
	let date = rule.next_due;
	while (date < today && count < cap) {
		count += 1;
		date = after(valid, date);
	}
	return count;
}

/** generationEach of the hook: the tickets of "Jeden Termin einzeln anlegen". */
export function generationEach(input: {
	rule: GenerationRule;
	today: CalendarDate;
	hint?: string;
	limit?: number;
}): EachPlan {
	const { rule, today } = input;
	const valid = validRule(rule);
	if (!rule.active || rule.next_due === '' || valid === null || valid.mode !== 'calendar')
		return null;
	const limit = input.limit !== undefined && input.limit > 0 ? input.limit : EACH_MAX_PER_RUN;
	const catchingUp = input.hint === CATCH_UP_ALL_HINT;
	if (!catchingUp && backlogCount(rule, today, limit + 1) > limit) return { ask: true };
	let due: CalendarDate = rule.next_due;
	const dues: CalendarDate[] = [];
	while (dues.length < limit && createOn(due, valid.lead_days) <= today) {
		dues.push(due);
		due = after(valid, due);
	}
	if (dues.length === 0) return null;
	const limited = createOn(due, valid.lead_days) <= today;
	return {
		dues,
		nextDue: due,
		limited,
		hint: !limited ? '' : catchingUp ? CATCH_UP_ALL_HINT : EACH_LIMIT_HINT
	};
}

/** backlogDecision of the hook: "Alle nachholen" or "Nur ab heute". */
export function backlogDecision(input: {
	rule: GenerationRule;
	choice: 'all' | 'today';
	today: CalendarDate;
}): { nextDue: CalendarDate | ''; hint: string } {
	const { rule, today } = input;
	if (input.choice === 'today') {
		const upcoming = onOrAfter(rule, today);
		return {
			nextDue: rule.next_due === '' || rule.next_due < upcoming ? upcoming : rule.next_due,
			hint: ''
		};
	}
	return {
		nextDue: rule.next_due,
		hint: backlogCount(rule, today, 1) > 0 ? CATCH_UP_ALL_HINT : ''
	};
}

/**
 * nextDueAfterDay of the hook (WH-1): a fixed rhythm without "Verpasste Termine nachholen" goes on
 * with the first date after `day` unless next_due lies later; else unchanged (null).
 */
export function nextDueAfterDay(rule: GenerationRule, day: CalendarDate): CalendarDate | null {
	const valid = validRule(rule);
	if (valid === null || valid.mode !== 'calendar' || rule.each === true) return null;
	const next = after(valid, day);
	return rule.next_due !== '' && rule.next_due >= next ? null : next;
}

/**
 * nextDueOnCompletion of the hook: after completion the date plus the interval; a fixed rhythm
 * without the switch the first date after the day of the completion (nextDueAfterDay).
 */
export function nextDueOnCompletion(
	rule: GenerationRule,
	completedDate: CalendarDate
): CalendarDate | null {
	const valid = validRule(rule);
	if (valid === null) return null;
	return valid.mode === 'after_completion'
		? afterCompletion(valid, completedDate)
		: nextDueAfterDay(rule, completedDate);
}

/** skippedDates of the hook: the missed dates a catch-up ticket stands for. */
export function skippedDates(
	rule: GenerationRule,
	pendingDue: CalendarDate | '',
	due: CalendarDate
): SkippedPlan | null {
	const valid = validRule(rule);
	if (valid === null || valid.mode !== 'calendar' || pendingDue === '' || !(pendingDue < due)) {
		return null;
	}
	const dates: CalendarDate[] = [];
	let count = 0;
	let date = pendingDue;
	while (date < due && count < SKIPPED_COUNT_MAX) {
		if (dates.length < SKIPPED_DATES_MAX) dates.push(date);
		count += 1;
		date = after(valid, date);
	}
	return { count, dates, more: date < due };
}
