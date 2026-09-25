// Pure decisions of the recurrence rule hooks (app/pb_hooks/lib/recurrence-rules.js; ADR-0021
// section 1, ADR-0023 sections 1, 4 and 5; E5 plan package 2).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

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
