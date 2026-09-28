// Both date calculations of recurring tasks against an independent day-by-day reference (plan
// "Offene Reste", OR-1; ADR-0021 sections 2 and 3): app/pb_hooks/lib/recurrence.js and
// web/src/lib/domain/recurrence.ts must give what tests/support/recurrence-reference.mjs finds by
// walking the calendar one day at a time. The shared table is checked against it as well, so its
// expected dates are not only equal in both modules but also right. The focus lies on weekly rules
// with several weekdays: every set of weekdays, intervals 1 to 3, anchors on every weekday, turns
// of the month and the year, both clock changes, lead times 0 to 30 and after completion.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as reference from '../support/recurrence-reference.mjs';
import * as web from '../../web/src/lib/domain/recurrence.ts';

const hook = loadHookLib('recurrence.js');
const { cases } = JSON.parse(readFileSync(new URL('../fixtures/recurrence/cases.json', import.meta.url), 'utf8'));
const { WEEKDAYS, dateOf, dayNumber } = reference;

/** The functions of both modules under the names of the table. */
const MODULES = {
	hook: {
		onOrAfter: hook.onOrAfter,
		after: hook.after,
		latestOnOrBefore: hook.latestOnOrBefore,
		catchUp: hook.catchUp,
		upcoming: hook.upcoming,
		afterCompletion: hook.afterCompletion,
		createOn: hook.createOn,
		normalize: hook.normalize
	},
	web: {
		onOrAfter: web.onOrAfter,
		after: web.after,
		latestOnOrBefore: web.latestOnOrBefore,
		catchUp: web.catchUp,
		upcoming: web.upcoming,
		afterCompletion: web.afterCompletion,
		createOn: web.createOn,
		normalize: web.normalizeRule
	}
};

const DATE_FUNCTIONS = ['onOrAfter', 'after', 'latestOnOrBefore', 'catchUp', 'upcoming', 'afterCompletion'];

function random(seed) {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}

/** Every non-empty set of weekdays in week order (127 sets). */
const WEEKDAY_SETS = Array.from({ length: 127 }, (_, bits) =>
	WEEKDAYS.filter((_, index) => ((bits + 1) >> index) & 1)
);

/** Monday 2026-09-21 and the six days after it: anchors on every weekday. */
const ANCHORS = Array.from({ length: 7 }, (_, offset) => dateOf(dayNumber('2026-09-21') + offset));

/** Dates the checks start from: turns of the month and year, both clock changes (Berlin). */
const CHECK_DATES = ['2026-09-30', '2026-10-23', '2026-10-25', '2026-12-30', '2027-01-01', '2027-03-26', '2027-03-28'];

describe('recurrence reference: the shared table is right', () => {
	const checked = cases.filter((testCase) => DATE_FUNCTIONS.includes(testCase.fn) || testCase.fn === 'createOn');

	it('covers the date cases of the table', () => {
		expect(checked.length).toBeGreaterThan(60);
	});

	it.each(checked)('$name', ({ fn, rule, args, expect: expected }) => {
		if (fn === 'createOn') {
			expect(reference.createOn(...args)).toBe(expected);
			return;
		}
		expect(reference[fn](hook.normalize(rule), ...args)).toEqual(expected);
	});
});

describe('recurrence reference: several weekdays in both modules', () => {
	it.each(Object.keys(MODULES))(
		'%s: every set of weekdays, every weekday as anchor, intervals 1 to 3',
		(name) => {
			const module = MODULES[name];
			let compared = 0;
			for (const weekdays of WEEKDAY_SETS) {
				for (const interval of [1, 2, 3]) {
					// One anchor per set and interval, turning through the week.
					const anchor = ANCHORS[(weekdays.length + interval) % ANCHORS.length];
					const rule = module.normalize({ mode: 'calendar', freq: 'weekly', interval, weekdays, anchor, lead_days: 0 });
					const label = JSON.stringify(rule);
					for (const date of CHECK_DATES) {
						expect(module.onOrAfter(rule, date), label).toBe(reference.onOrAfter(rule, date));
						expect(module.after(rule, date), label).toBe(reference.after(rule, date));
						expect(module.latestOnOrBefore(rule, date), label).toBe(reference.latestOnOrBefore(rule, date));
						compared += 3;
					}
					expect(module.upcoming(rule, anchor, 8), label).toEqual(reference.upcoming(rule, anchor, 8));
					const pending = reference.onOrAfter(rule, anchor);
					const today = dateOf(dayNumber(pending) + 40);
					expect(module.catchUp(rule, pending, today), label).toBe(reference.catchUp(rule, pending, today));
					compared += 2;
				}
			}
			expect(compared).toBe(WEEKDAY_SETS.length * 3 * (CHECK_DATES.length * 3 + 2));
		}
	);

	it.each(Object.keys(MODULES))('%s: lead times 0 to 30 before every date of Mon, Wed, Fri', (name) => {
		const module = MODULES[name];
		const rule = module.normalize({ mode: 'calendar', freq: 'weekly', interval: 1, weekdays: ['MO', 'WE', 'FR'], anchor: '2026-09-23' });
		for (const due of reference.upcoming(rule, '2026-12-01', 60)) {
			for (let lead = 0; lead <= 30; lead++) {
				expect(module.createOn(due, lead), `${due} - ${lead}`).toBe(reference.createOn(due, lead));
			}
		}
	});
});

describe('recurrence reference: random rules in both modules', () => {
	function randomRule(next) {
		const freq = ['daily', 'weekly', 'weekly', 'weekly', 'monthly', 'yearly'][Math.floor(next() * 6)];
		const mode = next() < 0.85 ? 'calendar' : 'after_completion';
		const rule = {
			mode,
			freq,
			interval: 1 + Math.floor(next() * (freq === 'yearly' ? 3 : 4)),
			anchor: dateOf(dayNumber('2024-01-01') + Math.floor(next() * 1500)),
			lead_days: Math.floor(next() * 31)
		};
		if (mode === 'calendar' && freq === 'weekly') {
			rule.weekdays = WEEKDAY_SETS[Math.floor(next() * WEEKDAY_SETS.length)];
		}
		if (mode === 'calendar' && freq === 'monthly') {
			rule.month_day = next() < 0.2 ? -1 : 1 + Math.floor(next() * 31);
		}
		return rule;
	}

	it.each(Object.keys(MODULES))('%s: 1 500 rules, every function', (name) => {
		const module = MODULES[name];
		const next = random(20260928);
		let dates = 0;
		for (let round = 0; round < 1500; round++) {
			const rule = module.normalize(randomRule(next));
			const date = dateOf(dayNumber(rule.anchor) - 30 + Math.floor(next() * 800));
			const label = JSON.stringify({ rule, date });
			if (rule.mode === 'after_completion') {
				expect(module.afterCompletion(rule, date), label).toBe(reference.afterCompletion(rule, date));
				expect(module.catchUp(rule, date, dateOf(dayNumber(date) + 400)), label).toBe(date);
				dates += 1;
			} else {
				expect(module.onOrAfter(rule, date), label).toBe(reference.onOrAfter(rule, date));
				expect(module.after(rule, date), label).toBe(reference.after(rule, date));
				expect(module.latestOnOrBefore(rule, date), label).toBe(reference.latestOnOrBefore(rule, date));
				expect(module.upcoming(rule, date, 4), label).toEqual(reference.upcoming(rule, date, 4));
				const pending = reference.onOrAfter(rule, date);
				const today = dateOf(dayNumber(pending) + Math.floor(next() * 500));
				expect(module.catchUp(rule, pending, today), label).toBe(reference.catchUp(rule, pending, today));
				dates += 5;
			}
			const due = dateOf(dayNumber(date) + 5);
			expect(module.createOn(due, rule.lead_days), label).toBe(reference.createOn(due, rule.lead_days));
		}
		expect(dates).toBeGreaterThan(5000);
	});
});
