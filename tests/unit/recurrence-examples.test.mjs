// Examples of the help "Wiederholungen" (plan "Wiederholungen verständlich machen", part A): the SPA
// plays them through its mirror of the generation (web/src/lib/domain/recurrence-generation.ts and
// recurrence-examples.ts). Here the same scenarios run with the pure functions of the hook
// (app/pb_hooks/lib/recurrence-rules.js and recurrence.js); both must tell the same, and what they
// tell must be the story the user approved: catch-up, after completion with a lead time as long as
// the interval and the wandering day of the month, the switch with the batch of 20 and the
// decision, the 31st, the 29th of February and Monday plus Friday every two weeks.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as reference from '../support/recurrence-reference.mjs';
import {
	EXAMPLE_MONDAY,
	SPA_ENGINE,
	SeriesSimulation,
	helpExamples
} from '../../web/src/lib/domain/recurrence-examples.ts';
import * as mirror from '../../web/src/lib/domain/recurrence-generation.ts';
import { CATCH_UP_ALL_HINT, CATCH_UP_ASK_HINT, EACH_LIMIT_HINT } from '../../web/src/lib/domain/recurrence-rule.ts';

const hook = loadHookLib('recurrence.js');
const hookRules = loadHookLib('recurrence-rules.js');

/** A rule of the simulation as the hook reads it: normalized, with its state. */
const hookRule = (rule) => ({ ...hook.normalize(rule), active: rule.active, next_due: rule.next_due });

const HOOK_ENGINE = {
	generation: (input) => hookRules.generation({ ...input, rule: hookRule(input.rule) }, hook),
	generationEach: (input) => hookRules.generationEach({ ...input, rule: hookRule(input.rule) }, hook),
	backlogDecision: (input) => hookRules.backlogDecision({ ...input, rule: hookRule(input.rule) }, hook),
	nextDueOnCompletion: (rule, date) => hookRules.nextDueOnCompletion(hookRule(rule), date, hook),
	skippedDates: (rule, pending, due) => hookRules.skippedDates(hookRule(rule), pending, due, hook),
	upcoming: (rule, from, count) => hook.upcoming(rule, from, count),
	onOrAfter: (rule, date) => hook.onOrAfter(rule, date)
};

const ticket = (due, appeared, skipped = null) => ({ due, appeared, done: null, skipped });

describe('examples of the help (plan "Wiederholungen verständlich machen")', () => {
	const examples = helpExamples(SPA_ENGINE);

	it('tells the same with the functions of the hook as with the mirror of the SPA', () => {
		expect(helpExamples(HOOK_ENGINE)).toEqual(examples);
		expect(EACH_LIMIT_HINT).toBe(hookRules.EACH_LIMIT_HINT);
		expect(CATCH_UP_ASK_HINT).toBe(hookRules.CATCH_UP_ASK_HINT);
		expect(CATCH_UP_ALL_HINT).toBe(hookRules.CATCH_UP_ALL_HINT);
	});

	it('starts on a Monday, so the weekdays of the story hold', () => {
		expect(hook.weekdayOf(EXAMPLE_MONDAY)).toBe('MO');
		expect(hook.weekdayOf(examples.calendar.monFriStart)).toBe('WE');
	});

	it('fixed rhythm: every Monday with lead time 3, on time, early, late and left for three weeks', () => {
		const { fixed } = examples;
		expect(fixed.first).toMatchObject({ due: '2026-10-05', appeared: '2026-10-02' });
		expect(fixed.onTime.next).toMatchObject({ due: '2026-10-12', appeared: '2026-10-09' });
		// Done early (Saturday) or a little late (Wednesday): nothing changes.
		expect(fixed.early).toMatchObject({ done: '2026-10-03', next: { due: '2026-10-12', appeared: '2026-10-09' } });
		expect(fixed.lateWithinLead).toMatchObject({ done: '2026-10-07', next: { due: '2026-10-12', appeared: '2026-10-09' } });
		// Done after the day the next one would appear: it appears only now, still due on Monday.
		expect(fixed.late).toMatchObject({ done: '2026-10-10', next: { due: '2026-10-12', appeared: '2026-10-10' } });
		// Three weeks: one ticket for 26.10., one day overdue; 12.10. and 19.10. skipped; then 02.11.
		expect(fixed.leftLong).toEqual({
			done: '2026-10-27',
			next: { ...ticket('2026-10-26', '2026-10-27', { count: 2, dates: ['2026-10-12', '2026-10-19'], more: false }), done: '2026-10-27' },
			after: ticket('2026-11-02', '2026-10-30')
		});
		expect(fixed.leadZero).toMatchObject({ due: '2026-10-05', appeared: '2026-10-05' });
		// The day-by-day reference of ADR-0021 section 2 agrees.
		const monday = hook.normalize({ mode: 'calendar', freq: 'weekly', interval: 1, weekdays: ['MO'], anchor: EXAMPLE_MONDAY, lead_days: 3 });
		expect(reference.catchUp(monday, '2026-10-12', '2026-10-27')).toBe('2026-10-26');
	});

	it('after completion: every two weeks, early, late, a lead time as long as the interval, the wandering day', () => {
		const { completion } = examples;
		expect(completion.onTime.next).toMatchObject({ due: '2026-10-19', appeared: '2026-10-16' });
		expect(completion.early).toMatchObject({ done: '2026-09-30', next: { due: '2026-10-14', appeared: '2026-10-11' } });
		expect(completion.late).toMatchObject({ done: '2026-10-22', next: { due: '2026-11-05', appeared: '2026-11-02' } });
		// Every 2 days with lead time 3: the next one at once.
		expect(completion.leadOverInterval).toMatchObject({
			days: 2,
			lead: 3,
			done: '2026-10-05',
			next: { due: '2026-10-07', appeared: '2026-10-05' }
		});
		expect(completion.monthly).toEqual(['2027-01-31', '2027-02-28', '2027-03-28', '2027-04-28']);
	});

	it('the switch: five days, the open ticket done, the app off for 26 days with the batch and the decision', () => {
		const { switch: each } = examples;
		expect(each).toMatchObject({ days: 5, openWithout: 1, openWith: 5, madeWith: 0, offDays: 26 });
		expect(each.doneWithout).toMatchObject({ due: '2026-10-09', appeared: '2026-10-09', skipped: { count: 3 } });
		expect(each.offWithout).toMatchObject({ due: '2026-10-31', appeared: '2026-10-31', skipped: { count: 25 } });
		expect(each).toMatchObject({ offWaiting: true, offAllFirst: 20, offAllSecond: 6, offTodaySkipped: 25, limit: 20 });
		expect(each.offToday).toEqual([ticket('2026-10-31', '2026-10-31')]);
	});

	it('special dates: the 31st, the 29th of February, Monday and Friday every two weeks from a Wednesday', () => {
		expect(examples.calendar).toEqual({
			day31: ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'],
			day31Leap: '2028-02-29',
			feb29: ['2028-02-29', '2029-02-28'],
			monFri: ['2026-10-02', '2026-10-12', '2026-10-16', '2026-10-26'],
			monFriStart: '2026-09-30'
		});
	});
});

describe('mirror of the generation in the SPA (recurrence-generation.ts)', () => {
	it('decides like the hook for random rules, dates and hints', () => {
		let seed = 20260928;
		const next = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		const pick = (list) => list[Math.floor(next() * list.length)];
		const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
		const day = (offset) => reference.dateOf(reference.dayNumber('2026-06-01') + offset);
		for (let round = 0; round < 600; round++) {
			const calendar = next() < 0.7;
			const freq = pick(['daily', 'weekly', 'monthly', 'yearly']);
			const params = {
				mode: calendar ? 'calendar' : 'after_completion',
				freq,
				interval: 1 + Math.floor(next() * 3),
				anchor: day(Math.floor(next() * 60)),
				lead_days: Math.floor(next() * 8)
			};
			if (calendar && freq === 'weekly') params.weekdays = [...new Set(WEEKDAYS.filter(() => next() < 0.4).concat([pick(WEEKDAYS)]))];
			if (calendar && freq === 'monthly') params.month_day = next() < 0.2 ? -1 : 1 + Math.floor(next() * 31);
			const today = day(Math.floor(next() * 200));
			const nextDue = calendar ? hook.onOrAfter(params, day(Math.floor(next() * 150))) : pick(['', day(Math.floor(next() * 150))]);
			const rule = { ...params, active: next() < 0.9, next_due: nextDue };
			const label = JSON.stringify({ rule, today });
			const hasOpenInstance = next() < 0.3;
			expect(mirror.generation({ rule, hasOpenInstance, today }), label).toEqual(HOOK_ENGINE.generation({ rule, hasOpenInstance, today }));
			if (calendar) {
				const hint = pick(['', EACH_LIMIT_HINT, CATCH_UP_ASK_HINT, CATCH_UP_ALL_HINT]);
				expect(mirror.generationEach({ rule, today, hint }), label).toEqual(HOOK_ENGINE.generationEach({ rule, today, hint }));
				for (const choice of ['all', 'today']) {
					expect(mirror.backlogDecision({ rule, choice, today }), label).toEqual(HOOK_ENGINE.backlogDecision({ rule, choice, today }));
				}
				expect(mirror.skippedDates(rule, nextDue, today), label).toEqual(HOOK_ENGINE.skippedDates(rule, nextDue, today));
			} else {
				expect(mirror.nextDueOnCompletion(rule, today), label).toEqual(HOOK_ENGINE.nextDueOnCompletion(rule, today));
			}
		}
	});

	it('plays a series like the hook step by step', () => {
		const params = { mode: 'calendar', freq: 'daily', interval: 1, anchor: EXAMPLE_MONDAY, lead_days: 0 };
		const play = (engine) => {
			const series = new SeriesSimulation(engine, params, { nextDue: EXAMPLE_MONDAY, each: true });
			const made = [series.days(EXAMPLE_MONDAY, '2026-10-08').length];
			made.push(series.run('2026-11-30').length, series.waiting);
			made.push(series.decide('all', '2026-11-30').length, series.run('2026-11-30').length, series.run('2026-11-30').length);
			return { made, tickets: series.tickets.length, nextDue: series.nextDue };
		};
		expect(play(SPA_ENGINE)).toEqual(play(HOOK_ENGINE));
		// 52 dates before 30.11. and the one of that day: 20, 20 and 13.
		expect(play(SPA_ENGINE)).toEqual({ made: [4, 0, true, 20, 20, 13], tickets: 57, nextDue: '2026-12-01' });
	});
});
