// Examples of the help "Wiederholungen" (plan "Wiederholungen verständlich machen", part A). No
// date is written by hand: a small simulation plays each scenario day by day with the decisions
// of the generation (the engine) and reports what the server would do. The SPA uses the mirror
// in recurrence-generation.ts and the dates of recurrence.ts; the parity test
// (tests/unit/web-recurrence.test.mjs) plays the same scenarios with the functions of the hook
// (lib/recurrence-rules.js and lib/recurrence.js) and expects the same result, and it checks the
// dates the help names against the story of the spec.

import { addDays, type CalendarDate } from './berlin-date';
import { afterCompletion, onOrAfter, upcoming, type RecurrenceParams } from './recurrence';
import * as mirror from './recurrence-generation';
import type {
	EachPlan,
	GenerationPlan,
	GenerationRule,
	SkippedPlan
} from './recurrence-generation';
import {
	CATCH_UP_ASK_HINT,
	formParams,
	formPreview,
	type RecurrenceFormValues
} from './recurrence-rule';
import { dayLabel } from './recurrence-text';

/** The decisions and dates a simulation needs: the SPA mirror or, in the parity test, the hook. */
export interface GenerationEngine {
	generation(input: {
		rule: GenerationRule;
		hasOpenInstance: boolean;
		today: CalendarDate;
	}): GenerationPlan;
	generationEach(input: { rule: GenerationRule; today: CalendarDate; hint: string }): EachPlan;
	backlogDecision(input: { rule: GenerationRule; choice: 'all' | 'today'; today: CalendarDate }): {
		nextDue: CalendarDate | '';
		hint: string;
	};
	nextDueOnCompletion(rule: GenerationRule, completedDate: CalendarDate): CalendarDate | null;
	skippedDates(
		rule: GenerationRule,
		pendingDue: CalendarDate | '',
		due: CalendarDate
	): SkippedPlan | null;
	upcoming(rule: RecurrenceParams, from: CalendarDate, count: number): CalendarDate[];
	onOrAfter(rule: RecurrenceParams, date: CalendarDate): CalendarDate;
}

export const SPA_ENGINE: GenerationEngine = {
	generation: mirror.generation,
	generationEach: mirror.generationEach,
	backlogDecision: mirror.backlogDecision,
	nextDueOnCompletion: mirror.nextDueOnCompletion,
	skippedDates: mirror.skippedDates,
	upcoming,
	onOrAfter
};

/** A ticket of a simulated series. */
export interface SimTicket {
	due: CalendarDate;
	/** The day it was made. */
	appeared: CalendarDate;
	done: CalendarDate | null;
	/** The missed dates it stands for (without "Jeden Termin einzeln anlegen"). */
	skipped: SkippedPlan | null;
}

/**
 * A series played by the day. `run` is one run of the generation (materialize of the hook: cron,
 * start, or right after a completion); `complete` fixes the next date of an after-completion rule
 * and runs; `decide` answers the question about a large backlog and runs.
 */
export class SeriesSimulation {
	readonly tickets: SimTicket[] = [];
	readonly #engine: GenerationEngine;
	readonly #each: boolean;
	#rule: GenerationRule;
	#hint = '';

	constructor(
		engine: GenerationEngine,
		params: RecurrenceParams,
		options: { nextDue: CalendarDate | ''; each?: boolean; open?: readonly SimTicket[] }
	) {
		this.#engine = engine;
		this.#each = options.each === true;
		this.#rule = { ...params, active: true, next_due: options.nextDue };
		this.tickets.push(...(options.open ?? []).map((ticket) => ({ ...ticket })));
	}

	get nextDue(): CalendarDate | '' {
		return this.#rule.next_due;
	}

	/** The rule waits for the choice about a large backlog (ADR-0022 addendum 5). */
	get waiting(): boolean {
		return this.#hint === CATCH_UP_ASK_HINT;
	}

	open(): SimTicket[] {
		return this.tickets.filter((ticket) => ticket.done === null);
	}

	run(day: CalendarDate): SimTicket[] {
		const made: SimTicket[] = [];
		if (this.#each) {
			const plan = this.#engine.generationEach({ rule: this.#rule, today: day, hint: this.#hint });
			if (plan === null) return made;
			if ('ask' in plan) {
				this.#hint = CATCH_UP_ASK_HINT;
				return made;
			}
			for (const due of plan.dues) {
				if (this.open().some((ticket) => ticket.due === due)) continue;
				made.push({ due, appeared: day, done: null, skipped: null });
			}
			this.tickets.push(...made);
			this.#rule = { ...this.#rule, next_due: plan.nextDue };
			this.#hint = plan.hint;
			return made;
		}
		const plan = this.#engine.generation({
			rule: this.#rule,
			hasOpenInstance: this.open().length > 0,
			today: day
		});
		if (plan === null) return made;
		const skipped = this.#engine.skippedDates(this.#rule, this.#rule.next_due, plan.due);
		made.push({ due: plan.due, appeared: day, done: null, skipped });
		this.tickets.push(...made);
		this.#rule = { ...this.#rule, next_due: plan.nextDue };
		this.#hint = '';
		return made;
	}

	/** One run per day from `from` to `to`, both included (the first run of each day). */
	days(from: CalendarDate, to: CalendarDate): SimTicket[] {
		const made: SimTicket[] = [];
		for (let day = from; day <= to; day = addDays(day, 1)) made.push(...this.run(day));
		return made;
	}

	complete(ticket: SimTicket, day: CalendarDate): SimTicket[] {
		ticket.done = day;
		const next = this.#engine.nextDueOnCompletion(this.#rule, day);
		if (next !== null) this.#rule = { ...this.#rule, next_due: next };
		return this.run(day);
	}

	decide(choice: 'all' | 'today', day: CalendarDate): SimTicket[] {
		const decided = this.#engine.backlogDecision({ rule: this.#rule, choice, today: day });
		this.#rule = { ...this.#rule, next_due: decided.nextDue };
		this.#hint = decided.hint;
		return this.run(day);
	}
}

// --- The examples of the help -------------------------------------------------------------------

/** The Monday the examples start on; the weekdays matter, the year is never shown. */
export const EXAMPLE_MONDAY: CalendarDate = '2026-10-05';

/** A completion and the ticket that follows it. */
export interface CompletionStep {
	done: CalendarDate;
	next: SimTicket;
}

export interface FixedExample {
	lead: number;
	/** The ticket for the first Monday. */
	first: SimTicket;
	onTime: CompletionStep;
	early: CompletionStep;
	/** Late, but before the next ticket's day to appear: nothing changes. */
	lateWithinLead: CompletionStep;
	/** Later than that: the next ticket appears only now, its due date stays. */
	late: CompletionStep;
	/** Left for three weeks: one ticket for the latest Monday, then as usual. */
	leftLong: CompletionStep & { after: SimTicket };
	/** The first ticket with lead time 0. */
	leadZero: SimTicket;
}

export interface CompletionExample {
	weeks: number;
	lead: number;
	first: SimTicket;
	onTime: CompletionStep;
	early: CompletionStep;
	late: CompletionStep;
	/** Every 2 days with lead time 3: the next one comes at once. */
	leadOverInterval: CompletionStep & { days: number; lead: number };
	/** Monthly, each done on its due day, from the 31st on: the day wanders. */
	monthly: CalendarDate[];
}

export interface SwitchExample {
	/** Days without completing anything. */
	days: number;
	openWithout: number;
	openWith: number;
	/** The open ticket done after those days: without the switch one new one for today. */
	doneWithout: SimTicket;
	madeWith: number;
	/** The app off for this many days. */
	offDays: number;
	offWithout: SimTicket;
	offWaiting: boolean;
	offAllFirst: number;
	offAllSecond: number;
	offToday: SimTicket[];
	offTodaySkipped: number;
	limit: number;
}

export interface CalendarExample {
	day31: CalendarDate[];
	day31Leap: CalendarDate;
	feb29: CalendarDate[];
	monFri: CalendarDate[];
	monFriStart: CalendarDate;
}

export interface HelpExamples {
	fixed: FixedExample;
	completion: CompletionExample;
	switch: SwitchExample;
	calendar: CalendarExample;
}

const MONDAY = EXAMPLE_MONDAY;

function nth<T>(list: readonly T[], index: number): T {
	const item = list[index];
	if (item === undefined) throw new RangeError(`The example has no item ${index}.`);
	return item;
}

/** A series whose open ticket is completed on `doneOn`; one run per day until `until`. */
function played(
	engine: GenerationEngine,
	params: RecurrenceParams,
	start: { nextDue: CalendarDate | ''; open?: SimTicket[]; from: CalendarDate },
	doneOn: CalendarDate,
	until: CalendarDate
): SeriesSimulation {
	const series = new SeriesSimulation(engine, params, start);
	for (let day = start.from; day <= until; day = addDays(day, 1)) {
		series.run(day);
		if (day === doneOn) series.complete(nth(series.open(), 0), day);
	}
	return series;
}

function fixedExample(engine: GenerationEngine): FixedExample {
	const lead = 3;
	const weekly: RecurrenceParams = {
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['MO'],
		anchor: MONDAY,
		lead_days: lead
	};
	const start = { nextDue: MONDAY, from: addDays(MONDAY, -7) };
	const step = (doneOn: CalendarDate, until: CalendarDate): CompletionStep => {
		const series = played(engine, weekly, start, doneOn, until);
		return { done: doneOn, next: nth(series.tickets, 1) };
	};
	const onTime = played(engine, weekly, start, MONDAY, addDays(MONDAY, 7));
	// Left for three weeks and done on Tuesday; the catch-up ticket is done the same day.
	const leftDone = addDays(MONDAY, 22);
	const left = new SeriesSimulation(engine, weekly, start);
	for (let day = start.from; day <= addDays(MONDAY, 28); day = addDays(day, 1)) {
		left.run(day);
		if (day === leftDone) {
			left.complete(nth(left.open(), 0), day);
			left.complete(nth(left.open(), 0), day);
		}
	}
	const zero = new SeriesSimulation(engine, { ...weekly, lead_days: 0 }, start);
	zero.days(start.from, MONDAY);
	return {
		lead,
		first: nth(onTime.tickets, 0),
		onTime: { done: MONDAY, next: nth(onTime.tickets, 1) },
		early: step(addDays(MONDAY, -2), addDays(MONDAY, 7)),
		lateWithinLead: step(addDays(MONDAY, 2), addDays(MONDAY, 7)),
		late: step(addDays(MONDAY, 5), addDays(MONDAY, 7)),
		leftLong: {
			done: leftDone,
			next: nth(left.tickets, 1),
			after: nth(left.tickets, 2)
		},
		leadZero: nth(zero.tickets, 0)
	};
}

function completionExample(engine: GenerationEngine): CompletionExample {
	const lead = 3;
	const weeks = 2;
	const twoWeeks: RecurrenceParams = {
		mode: 'after_completion',
		freq: 'weekly',
		interval: weeks,
		anchor: MONDAY,
		lead_days: lead
	};
	const first: SimTicket = {
		due: MONDAY,
		appeared: addDays(MONDAY, -lead),
		done: null,
		skipped: null
	};
	const start = { nextDue: '' as const, open: [first], from: addDays(MONDAY, -7) };
	const step = (
		params: RecurrenceParams,
		doneOn: CalendarDate,
		until: CalendarDate
	): CompletionStep => {
		const series = played(engine, params, start, doneOn, until);
		return { done: doneOn, next: nth(series.tickets, 1) };
	};
	const days = 2;
	const everyTwoDays: RecurrenceParams = {
		mode: 'after_completion',
		freq: 'daily',
		interval: days,
		anchor: MONDAY,
		lead_days: lead
	};

	// Monthly from the 31st, each ticket done on its due day.
	const monthlyStart: CalendarDate = '2027-01-31';
	const monthly = new SeriesSimulation(
		engine,
		{ mode: 'after_completion', freq: 'monthly', interval: 1, anchor: monthlyStart, lead_days: 0 },
		{
			nextDue: '',
			open: [{ due: monthlyStart, appeared: monthlyStart, done: null, skipped: null }]
		}
	);
	for (let round = 0; round < 3; round++) {
		const open = nth(monthly.open(), 0);
		monthly.complete(open, open.due);
		// Lead time 0: the next one is made on its due day.
		if (monthly.nextDue !== '') monthly.run(monthly.nextDue);
	}

	return {
		weeks,
		lead,
		first,
		onTime: step(twoWeeks, MONDAY, addDays(MONDAY, 21)),
		early: step(twoWeeks, addDays(MONDAY, -5), addDays(MONDAY, 21)),
		late: step(twoWeeks, addDays(MONDAY, 17), addDays(MONDAY, 35)),
		leadOverInterval: { ...step(everyTwoDays, MONDAY, MONDAY), days, lead },
		monthly: monthly.tickets.map((ticket) => ticket.due)
	};
}

function switchExample(engine: GenerationEngine): SwitchExample {
	const daily: RecurrenceParams = {
		mode: 'calendar',
		freq: 'daily',
		interval: 1,
		anchor: MONDAY,
		lead_days: 0
	};
	const days = 5;
	const lastDay = addDays(MONDAY, days - 1);
	const series = (each: boolean) => new SeriesSimulation(engine, daily, { nextDue: MONDAY, each });

	const without = series(false);
	without.days(MONDAY, lastDay);
	const openWithout = without.open().length;
	const doneWithout = nth(without.complete(nth(without.open(), 0), lastDay), 0);

	const withSwitch = series(true);
	withSwitch.days(MONDAY, lastDay);
	const openWith = withSwitch.open().length;
	const madeWith = withSwitch.complete(nth(withSwitch.open(), 0), lastDay).length;

	// The first ticket done on the first day, then the app is off until `back`.
	const offDays = 26;
	const back = addDays(MONDAY, offDays);
	const afterBreak = (each: boolean) => {
		const off = series(each);
		off.run(MONDAY);
		off.complete(nth(off.open(), 0), MONDAY);
		off.run(back);
		return off;
	};
	const offWithout = nth(afterBreak(false).open(), 0);
	const waiting = afterBreak(true);
	const all = afterBreak(true);
	const offAllFirst = all.decide('all', back).length;
	const offAllSecond = all.run(back).length;
	const today = afterBreak(true);
	const offToday = today.decide('today', back);

	return {
		days,
		openWithout,
		openWith,
		doneWithout,
		madeWith,
		offDays,
		offWithout,
		offWaiting: waiting.waiting,
		offAllFirst,
		offAllSecond,
		offToday,
		// Daily: every day of the break but the last is a date that "Nur ab heute" skips.
		offTodaySkipped: offDays - offToday.length,
		limit: offAllFirst
	};
}

function calendarExample(engine: GenerationEngine): CalendarExample {
	const day31: RecurrenceParams = {
		mode: 'calendar',
		freq: 'monthly',
		interval: 1,
		month_day: 31,
		anchor: '2027-01-31',
		lead_days: 3
	};
	const feb29: RecurrenceParams = {
		mode: 'calendar',
		freq: 'yearly',
		interval: 1,
		anchor: '2028-02-29',
		lead_days: 3
	};
	const monFriStart: CalendarDate = '2026-09-30';
	const monFri: RecurrenceParams = {
		mode: 'calendar',
		freq: 'weekly',
		interval: 2,
		weekdays: ['MO', 'FR'],
		anchor: monFriStart,
		lead_days: 3
	};
	return {
		day31: engine.upcoming(day31, '2027-01-01', 4),
		day31Leap: engine.onOrAfter(day31, '2028-02-01'),
		feb29: engine.upcoming(feb29, '2028-01-01', 2),
		monFri: engine.upcoming(monFri, monFriStart, 4),
		monFriStart
	};
}

// --- The example sentence of "So funktioniert’s" in the form ----------------------------------

/** "erscheint heute", "erscheint sofort" or "erscheint am Fr 02.10." inside a sentence. */
function appearsPhrase(appears: CalendarDate, today: CalendarDate): string {
	if (appears < today) return 'erscheint sofort';
	if (appears === today) return 'erscheint heute';
	return `erscheint am ${dayLabel(appears, today)}`;
}

/** A sentence ends with one full stop, also after a date like "02.10.". */
function sentence(text: string): string {
	return text.endsWith('.') ? text : `${text}.`;
}

/** Days of the later completion in the example of "Nach Erledigung". */
export const LATER_DAYS = 3;

/**
 * The example sentence of the current values (plan "Wiederholungen verständlich machen",
 * recommendation 1 of part A): what these settings do with the next dates, from the same dates as
 * the preview. Null while the values are invalid.
 */
export function liveExample(values: RecurrenceFormValues, today: CalendarDate): string | null {
	const preview = formPreview(values, today);
	const [first, second] = preview.rows;
	if (first === undefined) return null;
	if (values.mode === 'after_completion') {
		const params = formParams(values);
		const later = addDays(today, LATER_DAYS);
		const laterDue = afterCompletion(params, later);
		// A lead time as long as the interval: the next ticket comes with the completion.
		const appears =
			first.appears <= today
				? 'erscheint sofort beim Erledigen'
				: appearsPhrase(first.appears, today);
		return [
			'Mit diesen Einstellungen:',
			`Erledigst du es heute (${dayLabel(today, today)}), ist das nächste`,
			`${dayLabel(first.due, today)} fällig und ${sentence(appears)}`,
			`Erledigst du es ${LATER_DAYS} Tage später (${dayLabel(later, today)}), verschiebt sich`,
			`das nächste auf ${sentence(dayLabel(laterDue, today))}`
		].join(' ');
	}
	if (second === undefined) return null;
	const start = [
		'Mit diesen Einstellungen:',
		`Das Ticket für ${dayLabel(first.due, today)} ${sentence(appearsPhrase(first.appears, today))}`,
		`Das nächste ist ${dayLabel(second.due, today)} fällig und`,
		`${appearsPhrase(second.appears, today)}, egal wann du das erste erledigst.`
	].join(' ');
	return values.eachOccurrence === true
		? `${start} Es kommt auch, wenn das erste dann noch offen ist.`
		: `${start} Ist das erste dann noch offen, erscheint es erst, wenn du es erledigst.`;
}

/** Every example of the help, played with `engine` (the SPA mirror by default). */
export function helpExamples(engine: GenerationEngine = SPA_ENGINE): HelpExamples {
	return {
		fixed: fixedExample(engine),
		completion: completionExample(engine),
		switch: switchExample(engine),
		calendar: calendarExample(engine)
	};
}
