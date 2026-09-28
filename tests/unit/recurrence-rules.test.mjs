// Pure decisions of the recurrence rule hooks (app/pb_hooks/lib/recurrence-rules.js; ADR-0021
// section 1, ADR-0023 sections 1, 4 and 5; E5 plan package 2).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as reference from '../support/recurrence-reference.mjs';

const rules = loadHookLib('recurrence-rules.js');
const recurrence = loadHookLib('recurrence.js');

const weekly = (params = {}) =>
	recurrence.normalize({ mode: 'calendar', freq: 'weekly', weekdays: ['MO'], anchor: '2026-09-07', ...params });
const completion = (params = {}) =>
	recurrence.normalize({ mode: 'after_completion', freq: 'daily', interval: 3, anchor: '2026-09-01', ...params });

describe('dates of a rule record', () => {
	it('reads stored calendar dates and keeps anything else for the check', () => {
		expect(rules.calendarDateOf('2026-09-28 00:00:00.000Z')).toBe('2026-09-28');
		expect(rules.calendarDateOf('')).toBe('');
		expect(rules.calendarDateOf(null)).toBe('');
		expect(rules.calendarDateOf('2026-09-28 10:00:00.000Z')).toBe('2026-09-28 10:00:00.000Z');
		expect(rules.storedDateOf('2026-09-28')).toBe('2026-09-28 00:00:00.000Z');
		expect(rules.storedDateOf('')).toBe('');
	});
});

describe('checkParams', () => {
	it('normalizes a valid rule', () => {
		const { values, errors } = rules.checkParams(
			{ mode: 'calendar', freq: 'monthly', interval: 0, month_day: 0, anchor: '2026-01-31', lead_days: 3 },
			recurrence
		);
		expect(errors).toBeNull();
		expect(values).toMatchObject({ interval: 1, month_day: 31, weekdays: [] });
	});

	it('gives field errors with code and German message', () => {
		const { errors } = rules.checkParams(
			{ mode: 'calendar', freq: 'monthly', month_day: 32, anchor: 'x', lead_days: 31 },
			recurrence
		);
		expect(errors).toEqual({
			month_day: { code: 'validation_recurrence_month_day', message: rules.MESSAGES.validation_recurrence_month_day },
			anchor: { code: 'validation_recurrence_anchor', message: rules.MESSAGES.validation_recurrence_anchor },
			lead_days: { code: 'validation_recurrence_lead_days', message: rules.MESSAGES.validation_recurrence_lead_days }
		});
	});

	it('has a message for every code of recurrence.js', () => {
		for (const code of Object.values(recurrence.CODES)) {
			expect(rules.MESSAGES[code], code).toMatch(/\S/);
		}
	});
});

describe('the ticket a rule starts with', () => {
	it('must exist in the scope, be open and in no series', () => {
		const scope = 'u:a';
		expect(rules.ticketViolation(null, scope)).toBe('validation_recurrence_ticket_missing');
		expect(rules.ticketViolation({ scope: 'h:x', status: 'open', recurrence: '' }, scope)).toBe(
			'validation_recurrence_ticket_missing'
		);
		expect(rules.ticketViolation({ scope, status: 'done', recurrence: '' }, scope)).toBe(
			'validation_recurrence_ticket_done'
		);
		expect(rules.ticketViolation({ scope, status: 'waiting', recurrence: 'r1' }, scope)).toBe(
			'validation_recurrence_ticket_linked'
		);
		expect(rules.ticketViolation({ scope, status: 'backlog', recurrence: '' }, scope)).toBe('');
	});

	it('starts on its due date, otherwise today', () => {
		expect(rules.defaultAnchor('2026-10-01', '2026-09-25')).toBe('2026-10-01');
		expect(rules.defaultAnchor('', '2026-09-25')).toBe('2026-09-25');
	});
});

describe('createDates (ADR-0023 section 1)', () => {
	const today = '2026-09-25';

	it('calendar with a due ticket: the next one after its due date', () => {
		expect(
			rules.createDates({ rule: weekly(), withTicket: true, ticketDue: '2026-09-21', today }, recurrence)
		).toEqual({ nextDue: '2026-09-28', ticketDue: null });
	});

	it('calendar with a ticket without due date: the ticket gets the first occurrence', () => {
		expect(
			rules.createDates(
				{ rule: weekly({ anchor: '2026-09-25' }), withTicket: true, ticketDue: '', today },
				recurrence
			)
		).toEqual({ nextDue: '2026-10-05', ticketDue: '2026-09-28' });
	});

	it('calendar without a ticket: the first occurrence from today on', () => {
		expect(rules.createDates({ rule: weekly(), withTicket: false, ticketDue: '', today }, recurrence)).toEqual({
			nextDue: '2026-09-28',
			ticketDue: null
		});
	});

	it('after completion with a ticket: nothing is due before it is done', () => {
		expect(
			rules.createDates({ rule: completion(), withTicket: true, ticketDue: '2026-09-30', today }, recurrence)
		).toEqual({ nextDue: '', ticketDue: null });
	});

	it('after completion without a ticket: the anchor, but not before today', () => {
		expect(rules.createDates({ rule: completion(), withTicket: false, ticketDue: '', today }, recurrence)).toEqual({
			nextDue: today,
			ticketDue: null
		});
		expect(
			rules.createDates(
				{ rule: completion({ anchor: '2026-10-10' }), withTicket: false, ticketDue: '', today },
				recurrence
			)
		).toEqual({ nextDue: '2026-10-10', ticketDue: null });
	});
});

describe('nextDueAfterEdit (ADR-0023 sections 4 and 5)', () => {
	const today = '2026-09-25';
	const state = (rule, active, nextDue = '') => ({ ...rule, active, next_due: nextDue });

	it('keeps the date for a pause, the template and the lead time', () => {
		const before = state(weekly(), true, '2026-09-28');
		expect(rules.nextDueAfterEdit({ before, after: state(weekly(), false), openDue: null, today }, recurrence)).toBe(
			'2026-09-28'
		);
		expect(
			rules.nextDueAfterEdit({ before, after: state(weekly({ lead_days: 10 }), true), openDue: null, today }, recurrence)
		).toBe('2026-09-28');
	});

	it('recomputes a calendar rhythm after the open instance', () => {
		const before = state(weekly(), true, '2026-09-28');
		const after = state(weekly({ weekdays: ['TH'] }), true);
		expect(rules.nextDueAfterEdit({ before, after, openDue: '2026-09-21', today }, recurrence)).toBe('2026-10-01');
		// An open instance due later than today: the next one after it.
		expect(rules.nextDueAfterEdit({ before, after, openDue: '2026-10-01', today }, recurrence)).toBe('2026-10-08');
		// Without an instance: the first one from today on (today is a Friday, so Thursday next week).
		expect(rules.nextDueAfterEdit({ before, after, openDue: null, today }, recurrence)).toBe('2026-10-01');
		// Today itself counts without an instance, with one it is already covered.
		const friday = state(weekly({ weekdays: ['FR'] }), true);
		expect(rules.nextDueAfterEdit({ before, after: friday, openDue: null, today }, recurrence)).toBe(today);
		expect(rules.nextDueAfterEdit({ before, after: friday, openDue: '', today }, recurrence)).toBe(today);
	});

	it('recomputes an after-completion rhythm', () => {
		const before = state(weekly(), true, '2026-09-28');
		expect(rules.nextDueAfterEdit({ before, after: state(completion(), true), openDue: '2026-09-30', today }, recurrence)).toBe('');
		expect(rules.nextDueAfterEdit({ before, after: state(completion(), true), openDue: null, today }, recurrence)).toBe(today);
	});

	it('does not catch up a pause when resuming', () => {
		const before = state(weekly(), false, '2026-09-07');
		expect(rules.nextDueAfterEdit({ before, after: state(weekly(), true), openDue: null, today }, recurrence)).toBe(
			'2026-09-28'
		);
		const later = state(weekly(), false, '2026-10-12');
		expect(rules.nextDueAfterEdit({ before: later, after: state(weekly(), true), openDue: null, today }, recurrence)).toBe(
			'2026-10-12'
		);
		const pausedCompletion = state(completion(), false, '2026-09-10');
		expect(
			rules.nextDueAfterEdit({ before: pausedCompletion, after: state(completion(), true), openDue: null, today }, recurrence)
		).toBe(today);
		const waitingCompletion = state(completion(), false, '');
		expect(
			rules.nextDueAfterEdit({ before: waitingCompletion, after: state(completion(), true), openDue: '2026-09-30', today }, recurrence)
		).toBe('');
	});

	it('clears the hint when resuming or choosing a rhythm', () => {
		expect(rules.clearsHint(state(weekly(), false), state(weekly(), true))).toBe(true);
		expect(rules.clearsHint(state(weekly(), true), state(weekly({ weekdays: ['TU'] }), true))).toBe(true);
		expect(rules.clearsHint(state(weekly(), false), state(weekly({ lead_days: 1 }), false))).toBe(false);
		expect(rules.rhythmChanged(weekly(), weekly({ lead_days: 0 }))).toBe(false);
		expect(rules.rhythmChanged(weekly(), weekly({ anchor: '2026-09-14' }))).toBe(true);
	});
});

describe('generation (ADR-0022 sections 2 and 3; package 3)', () => {
	const running = (rule, nextDue, lead = 3) => ({ ...rule, lead_days: lead, active: true, next_due: nextDue });

	it('waits for the lead time, an active rule, a date and no open instance', () => {
		const rule = running(weekly(), '2026-09-28');
		expect(rules.generation({ rule, hasOpenInstance: false, today: '2026-09-24' }, recurrence)).toBeNull();
		expect(rules.generation({ rule, hasOpenInstance: false, today: '2026-09-25' }, recurrence)).toEqual({
			due: '2026-09-28',
			nextDue: '2026-10-05'
		});
		expect(rules.generation({ rule, hasOpenInstance: true, today: '2026-09-25' }, recurrence)).toBeNull();
		expect(rules.generation({ rule: { ...rule, active: false }, hasOpenInstance: false, today: '2026-09-28' }, recurrence)).toBeNull();
		expect(rules.generation({ rule: { ...rule, next_due: '' }, hasOpenInstance: false, today: '2026-09-28' }, recurrence)).toBeNull();
		const incomplete = { mode: 'calendar', freq: '', interval: 1, weekdays: [], month_day: null, anchor: '', lead_days: 3 };
		expect(rules.generation({ rule: running(incomplete, '2026-09-28'), hasOpenInstance: false, today: '2026-09-28' }, recurrence)).toBeNull();
	});

	it('takes the latest missed date of a calendar rule, never a stack', () => {
		const rule = running(weekly(), '2026-09-07', 0);
		expect(rules.generation({ rule, hasOpenInstance: false, today: '2026-09-23' }, recurrence)).toEqual({
			due: '2026-09-21',
			nextDue: '2026-09-28'
		});
	});

	it('creates the waiting ticket of an after-completion rule and then waits for the completion', () => {
		const rule = running(completion(), '2026-09-27');
		expect(rules.generation({ rule, hasOpenInstance: false, today: '2026-09-24' }, recurrence)).toEqual({
			due: '2026-09-27',
			nextDue: ''
		});
	});

	it('fixes the next date at completion and release only for after-completion rules', () => {
		expect(rules.nextDueOnCompletion(completion(), '2026-09-25', recurrence)).toBe('2026-09-28');
		expect(rules.nextDueOnCompletion(weekly(), '2026-09-25', recurrence)).toBeNull();
		expect(rules.nextDueOnRelease(completion(), '2026-09-25', recurrence)).toBe('2026-09-28');
		expect(rules.nextDueOnRelease(weekly(), '2026-09-25', recurrence)).toBeNull();
	});
});

describe('"Jeden Termin einzeln anlegen" (plan OR-5, ADR-0022 addendum 2)', () => {
	const monWedFri = (params = {}) =>
		recurrence.normalize({ mode: 'calendar', freq: 'weekly', weekdays: ['MO', 'WE', 'FR'], anchor: '2037-06-01', ...params });
	const running = (rule, nextDue, lead = 0) => ({ ...rule, lead_days: lead, active: true, next_due: nextDue, each: true });

	it('creates one ticket per date whose lead time is reached, open instances or not', () => {
		const rule = running(monWedFri(), '2037-06-01');
		expect(rules.generationEach({ rule, today: '2037-05-31' }, recurrence)).toBeNull();
		expect(rules.generationEach({ rule, today: '2037-06-01' }, recurrence)).toEqual({
			dues: ['2037-06-01'],
			nextDue: '2037-06-03',
			limited: false
		});
		// Saturday after a missed week: Monday, Wednesday and Friday, each once.
		expect(rules.generationEach({ rule, today: '2037-06-06' }, recurrence)).toEqual({
			dues: ['2037-06-01', '2037-06-03', '2037-06-05'],
			nextDue: '2037-06-08',
			limited: false
		});
		// Lead time 3: the dates up to three days ahead of today come as well.
		expect(rules.generationEach({ rule: running(monWedFri(), '2037-06-01', 3), today: '2037-06-01' }, recurrence)).toEqual({
			dues: ['2037-06-01', '2037-06-03'],
			nextDue: '2037-06-05',
			limited: false
		});
	});

	it('stops at the limit of a run and says that more are waiting', () => {
		const daily = running(recurrence.normalize({ mode: 'calendar', freq: 'daily', anchor: '2038-01-01' }), '2038-01-01');
		expect(rules.EACH_MAX_PER_RUN).toBe(20);
		const first = rules.generationEach({ rule: daily, today: '2038-01-26' }, recurrence);
		expect(first.dues).toHaveLength(20);
		expect(first.dues[0]).toBe('2038-01-01');
		expect(first.dues[19]).toBe('2038-01-20');
		expect(first).toMatchObject({ nextDue: '2038-01-21', limited: true });
		const second = rules.generationEach({ rule: { ...daily, next_due: first.nextDue }, today: '2038-01-26' }, recurrence);
		expect(second).toEqual({
			dues: ['2038-01-21', '2038-01-22', '2038-01-23', '2038-01-24', '2038-01-25', '2038-01-26'],
			nextDue: '2038-01-27',
			limited: false
		});
		expect(rules.generationEach({ rule: daily, today: '2038-01-26', limit: 3 }, recurrence).dues).toEqual([
			'2038-01-01',
			'2038-01-02',
			'2038-01-03'
		]);
		expect(rules.EACH_LIMIT_HINT).toBe(
			'Viele Termine auf einmal: 20 Tickets angelegt, die übrigen folgen beim nächsten Lauf (stündlich).'
		);
	});

	it('does nothing when paused, without a date, after completion or with an incomplete rule', () => {
		const rule = running(monWedFri(), '2037-06-01');
		expect(rules.generationEach({ rule: { ...rule, active: false }, today: '2037-06-06' }, recurrence)).toBeNull();
		expect(rules.generationEach({ rule: { ...rule, next_due: '' }, today: '2037-06-06' }, recurrence)).toBeNull();
		expect(rules.generationEach({ rule: running(completion(), '2037-06-01'), today: '2037-06-06' }, recurrence)).toBeNull();
		const incomplete = { mode: 'calendar', freq: '', interval: 1, weekdays: [], month_day: null, anchor: '', lead_days: 0 };
		expect(rules.generationEach({ rule: running(incomplete, '2037-06-01'), today: '2037-06-06' }, recurrence)).toBeNull();
	});

	it('gives every date of the series exactly once, like a day-by-day reference, for 200 random rules', () => {
		let seed = 20260928;
		const next = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
		for (let round = 0; round < 200; round++) {
			const freq = ['daily', 'weekly', 'weekly', 'monthly'][Math.floor(next() * 4)];
			const params = { mode: 'calendar', freq, interval: 1 + Math.floor(next() * 3), anchor: '2037-06-01' };
			if (freq === 'weekly') params.weekdays = [...new Set(WEEKDAYS.filter(() => next() < 0.5).concat(['MO']))];
			if (freq === 'monthly') params.month_day = next() < 0.3 ? -1 : 1 + Math.floor(next() * 31);
			const lead = Math.floor(next() * 8);
			const rule = recurrence.normalize({ ...params, lead_days: lead });
			// The runs happen only every `gap` days (the PC is off in between), for 120 days.
			const gap = 1 + Math.floor(next() * 30);
			let state = { ...rule, active: true, next_due: recurrence.onOrAfter(rule, '2037-06-01'), each: true };
			const made = [];
			let today = '2037-06-01';
			let last = today;
			const end = reference.dateOf(reference.dayNumber(today) + 120);
			while (today <= end) {
				// Several runs a day (hourly) until nothing is left.
				for (let run = 0; run < 30; run++) {
					const plan = rules.generationEach({ rule: state, today }, recurrence);
					if (plan === null) break;
					made.push(...plan.dues);
					state = { ...state, next_due: plan.nextDue };
				}
				last = today;
				today = reference.dateOf(reference.dayNumber(today) + gap);
			}
			// Reference: every occurrence from the start whose lead time was reached by the last run.
			const expected = [];
			for (let dayNumber = reference.dayNumber('2037-06-01'); ; dayNumber++) {
				if (reference.createOn(reference.dateOf(dayNumber), lead) > last) break;
				if (reference.isOccurrence(rule, dayNumber)) expected.push(reference.dateOf(dayNumber));
			}
			expect(made, JSON.stringify({ rule, gap })).toEqual(expected);
		}
	});

	it('refuses the switch after completion and clears the hint when it changes', () => {
		expect(rules.eachViolation('calendar', true)).toBe('');
		expect(rules.eachViolation('after_completion', true)).toBe('validation_recurrence_each_mode');
		expect(rules.eachViolation('after_completion', false)).toBe('');
		expect(rules.MESSAGES.validation_recurrence_each_mode).toBe(
			'„Jeden Termin einzeln anlegen“ gibt es nur bei einem festen Rhythmus.'
		);
		const before = { ...weekly(), active: true, each: true };
		expect(rules.clearsHint(before, { ...weekly(), active: true, each: false })).toBe(true);
		expect(rules.clearsHint(before, { ...weekly(), active: true, each: true })).toBe(false);
		expect(rules.clearsHint({ ...weekly(), active: true }, { ...weekly(), active: true, each: false })).toBe(false);
	});

	it('lets only a ticket of the same date stand against reopening, and every one with one instance', () => {
		const others = [
			{ id: 'b', occurrence: '2037-06-03 00:00:00.000Z' },
			{ id: 'a', occurrence: '' }
		];
		expect(rules.reopenConflicts(others, '2037-06-01 00:00:00.000Z', true)).toEqual([]);
		expect(rules.reopenConflicts(others, '', true)).toEqual([others[1]]);
		expect(rules.reopenConflicts(others, '2037-06-03 00:00:00.000Z', true)).toEqual([others[0]]);
		expect(rules.reopenConflicts(others, '2037-06-01 00:00:00.000Z', false)).toEqual(others);
		expect(rules.reopenConflicts([], '', false)).toEqual([]);
	});

	it('counts a violation of the index on recurrence and occurrence as "already there"', () => {
		expect(rules.isOpenInstanceConflict('occurrence: Value must be unique.; recurrence: Value must be unique.')).toBe(true);
		expect(rules.isOpenInstanceConflict('UNIQUE constraint failed: tickets.recurrence, tickets.occurrence')).toBe(true);
	});
});

describe('reopening an instance (ADR-0023 section 3; package 3)', () => {
	const completedAt = '2026-09-25 10:00:00.000Z';
	const followUp = (overrides = {}) => ({
		created: '2026-09-25 10:00:00.200Z',
		updated: '2026-09-25 10:00:00.200Z',
		comments: 0,
		...overrides
	});

	it('removes only an untouched follow-up', () => {
		expect(rules.isUntouched(followUp(), completedAt)).toBe(true);
		expect(rules.isUntouched(followUp({ created: completedAt, updated: completedAt }), completedAt)).toBe(true);
		expect(rules.isUntouched(followUp({ updated: '2026-09-25 10:01:00.000Z' }), completedAt)).toBe(false);
		expect(rules.isUntouched(followUp({ comments: 1 }), completedAt)).toBe(false);
		expect(rules.isUntouched(followUp({ created: '2026-09-24 09:00:00.000Z', updated: '2026-09-24 09:00:00.000Z' }), completedAt)).toBe(false);
		expect(rules.isUntouched(followUp(), '')).toBe(false);
	});

	it('restores next_due: the date of the removed follow-up, or empty after completion', () => {
		expect(rules.nextDueOnReopen(weekly(), true, '2026-10-05')).toBe('2026-10-05');
		expect(rules.nextDueOnReopen(weekly(), false, '')).toBeNull();
		expect(rules.nextDueOnReopen(completion(), true, '2026-10-05')).toBe('');
		expect(rules.nextDueOnReopen(completion(), false, '')).toBe('');
	});

	it('names the open ticket in the refusal', () => {
		expect(rules.openInstanceMessage('HAUS-12')).toBe(
			'Von dieser Serie ist schon HAUS-12 offen. Erledige es zuerst oder löse ein Ticket aus der Serie.'
		);
		expect(rules.reopenOlderMessage('HAUS-12')).toBe(
			'Von dieser Serie ist schon HAUS-12 offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).'
		);
	});

	// Recommendation 1 of the plan "Wiederholungen verständlich machen" (ADR-0023 addendum 4).
	it('removes the follow-up only for the direct predecessor, never for an older instance', () => {
		expect(rules.reopenOutcome({ conflicts: 0, untouched: false, direct: false })).toBe('free');
		expect(rules.reopenOutcome({ conflicts: 1, untouched: true, direct: true })).toBe('remove');
		expect(rules.reopenOutcome({ conflicts: 1, untouched: true, direct: false })).toBe('refuse_older');
		expect(rules.reopenOutcome({ conflicts: 1, untouched: false, direct: false })).toBe('refuse_older');
		expect(rules.reopenOutcome({ conflicts: 1, untouched: false, direct: true })).toBe('refuse_open');
		expect(rules.reopenOutcome({ conflicts: 2, untouched: true, direct: true })).toBe('refuse_open');
	});

	it('knows the direct predecessor by the latest completion', () => {
		expect(rules.isDirectPredecessor(completedAt, '')).toBe(true);
		expect(rules.isDirectPredecessor(completedAt, '2026-09-18 10:00:00.000Z')).toBe(true);
		expect(rules.isDirectPredecessor(completedAt, completedAt)).toBe(true);
		expect(rules.isDirectPredecessor(completedAt, '2026-09-25 10:00:00.001Z')).toBe(false);
	});
});

describe('missed dates made into one ticket (ADR-0022 addendum 4)', () => {
	it('names the skipped dates of a catch-up, without the date of the ticket itself', () => {
		// Every Monday: left from 12.10. until Tuesday 27.10., the ticket is due on 26.10.
		const rule = weekly({ anchor: '2026-10-05' });
		const due = rules.generation({ rule: { ...rule, active: true, next_due: '2026-10-12' }, hasOpenInstance: false, today: '2026-10-27' }, recurrence).due;
		expect(due).toBe('2026-10-26');
		expect(rules.skippedDates(rule, '2026-10-12', due, recurrence)).toEqual({
			count: 2,
			dates: ['2026-10-12', '2026-10-19'],
			more: false
		});
		expect(reference.catchUp(rule, '2026-10-12', '2026-10-27')).toBe('2026-10-26');
	});

	it('is empty without a gap and for after completion', () => {
		expect(rules.skippedDates(weekly(), '2026-10-12', '2026-10-12', recurrence)).toBeNull();
		expect(rules.skippedDates(weekly(), '', '2026-10-12', recurrence)).toBeNull();
		expect(rules.skippedDates(completion(), '2026-10-01', '2026-10-12', recurrence)).toBeNull();
	});

	it('lists at most five dates and stops counting at the cap', () => {
		const daily = recurrence.normalize({ mode: 'calendar', freq: 'daily', anchor: '2020-01-01' });
		const week = rules.skippedDates(daily, '2026-10-01', '2026-10-08', recurrence);
		expect(week).toEqual({
			count: 7,
			dates: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'],
			more: false
		});
		const years = rules.skippedDates(daily, '2020-01-01', '2026-10-08', recurrence);
		expect(years.count).toBe(rules.SKIPPED_COUNT_MAX);
		expect(years.more).toBe(true);
		expect(years.dates).toHaveLength(rules.SKIPPED_DATES_MAX);
	});
});

describe('hints of failed runs (ADR-0022 section 2; package 3)', () => {
	it('writes a neutral, cleaned and cut hint', () => {
		expect(rules.failureHint('GoError: Injected ticket insert failure.')).toBe(
			'Ticket nicht erzeugt: Injected ticket insert failure.'
		);
		expect(rules.failureHint('  zwei\n  Zeilen ')).toBe('Ticket nicht erzeugt: zwei Zeilen');
		expect(rules.failureHint('')).toBe('Ticket nicht erzeugt: unbekannter Fehler.');
		const long = rules.failureHint('x'.repeat(2000));
		expect(long).toHaveLength(rules.HINT_MAX_LENGTH);
		expect(long.endsWith('…')).toBe(true);
		expect(rules.ARCHIVED_HINT).toBe('Projekt archiviert – Regel pausiert.');
	});

	it('counts a violation of the partial index as "already there"', () => {
		expect(rules.isOpenInstanceConflict('recurrence: Value must be unique.')).toBe(true);
		expect(rules.isOpenInstanceConflict('UNIQUE constraint failed: tickets.recurrence')).toBe(true);
		expect(rules.isOpenInstanceConflict('UNIQUE constraint failed: tickets.scope, tickets.key')).toBe(false);
	});
});
