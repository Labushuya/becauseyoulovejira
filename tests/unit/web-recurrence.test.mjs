// Date calculation of the web app (web/src/lib/domain/recurrence.ts) against the hook module
// (app/pb_hooks/lib/recurrence.js): the shared table and at least 5 000 random rules and dates
// from a fixed seed give the same results, including the same errors (ADR-0021 section 3;
// E5 plan, package 1).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as web from '../../web/src/lib/domain/recurrence.ts';
import {
	CATCH_UP_ALL_HINT,
	CATCH_UP_ASK_HINT,
	EACH_MAX_PER_RUN,
	RECURRENCE_MESSAGES,
	backlogOf,
	SKIPPED_FIELD,
	SUBTASKS_FIELD,
	openInstanceMessage,
	parseSkipped,
	reopenOlderMessage
} from '../../web/src/lib/domain/recurrence-rule.ts';
import {
	DEFAULT_TEMPLATE_STATUS,
	TEMPLATE_STATUSES,
	TEMPLATE_SUBTASKS_MAX,
	templateStatusOf,
	templateSubtasksOf
} from '../../web/src/lib/domain/series-template.ts';
import { PRIORITIES } from '../../web/src/lib/domain/status.ts';

const hook = loadHookLib('recurrence.js');
const hookRules = loadHookLib('recurrence-rules.js');
const { cases } = JSON.parse(readFileSync(new URL('../fixtures/recurrence/cases.json', import.meta.url), 'utf8'));

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const WEB_FUNCTIONS = {
	normalize: web.normalizeRule,
	validate: web.validateRule,
	onOrAfter: web.onOrAfter,
	after: web.after,
	latestOnOrBefore: web.latestOnOrBefore,
	afterCompletion: web.afterCompletion,
	catchUp: web.catchUp,
	upcoming: web.upcoming
};

function callWeb(fn, rule, args) {
	if (fn === 'createOn') return web.createOn(...args);
	return WEB_FUNCTIONS[fn](rule, ...args);
}

function callHook(fn, rule, args) {
	if (fn === 'createOn') return hook.createOn(...args);
	return hook[fn](rule, ...args);
}

// Result or the kind of error, so that both modules also reject the same inputs.
function outcome(call) {
	try {
		return { value: call() };
	} catch (error) {
		return { error: error instanceof RangeError ? 'RangeError' : String(error) };
	}
}

function random(seed) {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}

const pick = (next, list) => list[Math.floor(next() * list.length)];
const dateOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const BASE_DAY = Date.parse('1990-01-01T00:00:00Z') / DAY_MS;
const SPAN_DAYS = Math.round(120 * 365.25);

// Mostly valid rules, some with values the hook and the form must reject in the same way.
function randomRule(next) {
	const rule = {
		mode: next() < 0.8 ? 'calendar' : pick(next, ['after_completion', 'after_completion', '']),
		freq: next() < 0.97 ? pick(next, ['daily', 'weekly', 'monthly', 'yearly']) : pick(next, ['', 'hourly']),
		interval: next() < 0.95 ? 1 + Math.floor(next() * (next() < 0.8 ? 6 : 365)) : pick(next, [0, 366, 2.5]),
		anchor: next() < 0.97 ? dateOf(BASE_DAY + Math.floor(next() * SPAN_DAYS)) : pick(next, ['', '2026-02-30']),
		lead_days: next() < 0.95 ? Math.floor(next() * 31) : pick(next, [31, -1, undefined])
	};
	if (rule.freq === 'weekly' || next() < 0.03) {
		rule.weekdays = WEEKDAYS.filter(() => next() < 0.3);
	}
	if (rule.freq === 'monthly' || next() < 0.03) {
		rule.month_day = next() < 0.15 ? -1 : next() < 0.1 ? 0 : 1 + Math.floor(next() * (next() < 0.97 ? 31 : 40));
	}
	return rule;
}

describe('recurrence: web app against the hooks', () => {
	it.each(cases)('$name', ({ fn, rule, args, expect: expected }) => {
		expect(callWeb(fn, rule, args)).toEqual(expected);
		expect(callHook(fn, rule, args)).toEqual(expected);
	});

	it('gives the same dates and errors for 5 000 random rules and dates', () => {
		const next = random(20260925);
		const functions = ['normalize', 'validate', 'onOrAfter', 'after', 'latestOnOrBefore', 'afterCompletion', 'catchUp', 'upcoming'];
		let compared = 0;
		let dates = 0;
		for (let round = 0; round < 5000; round++) {
			const rule = randomRule(next);
			const date = dateOf(BASE_DAY + Math.floor(next() * SPAN_DAYS));
			const today = dateOf(BASE_DAY + Math.floor(next() * SPAN_DAYS));
			for (const fn of functions) {
				const args = fn === 'catchUp' ? [date, today] : fn === 'upcoming' ? [date, 3] : fn === 'normalize' || fn === 'validate' ? [] : [date];
				const label = JSON.stringify({ fn, rule, args });
				const fromWeb = outcome(() => callWeb(fn, rule, args));
				expect(fromWeb, label).toEqual(outcome(() => callHook(fn, rule, args)));
				compared++;
				if (fromWeb.value !== undefined && fn !== 'normalize' && fn !== 'validate') dates++;
			}
			const lead = Math.floor(next() * 33) - 1;
			expect(outcome(() => web.createOn(date, lead))).toEqual(outcome(() => hook.createOn(date, lead)));
		}
		expect(compared).toBe(40000);
		// Most calls compute a date; the rest are rejected the same way.
		expect(dates).toBeGreaterThan(15000);
	});

	it('shares the lists, limits and codes', () => {
		expect([...web.RECURRENCE_MODES]).toEqual(hook.MODES);
		expect([...web.RECURRENCE_FREQS]).toEqual(hook.FREQS);
		expect([...web.WEEKDAYS]).toEqual(hook.WEEKDAYS);
		expect([web.INTERVAL_MIN, web.INTERVAL_MAX, web.LEAD_DAYS_MIN, web.LEAD_DAYS_MAX]).toEqual([
			hook.INTERVAL_MIN,
			hook.INTERVAL_MAX,
			hook.LEAD_DAYS_MIN,
			hook.LEAD_DAYS_MAX
		]);
		expect(web.DEFAULT_LEAD_DAYS).toBe(hook.DEFAULT_LEAD_DAYS);
		expect(web.LAST_DAY).toBe(hook.LAST_DAY);
		expect([web.ANCHOR_MIN_YEAR, web.ANCHOR_MAX_YEAR]).toEqual([hook.ANCHOR_MIN_YEAR, hook.ANCHOR_MAX_YEAR]);
		expect({ ...web.RECURRENCE_CODES }).toEqual(hook.CODES);
		for (const date of ['2026-09-28', '2026-10-04', '2000-02-29']) expect(web.weekdayOf(date)).toBe(hook.weekdayOf(date));
	});

	it('shows the same texts for the codes as the hook sends (package 4)', () => {
		const hookRecurrence = Object.fromEntries(
			Object.entries(hookRules.MESSAGES).filter(([code]) => code.startsWith('validation_recurrence_'))
		);
		expect({ ...RECURRENCE_MESSAGES }).toEqual(hookRecurrence);
		expect(openInstanceMessage('HAUS-12')).toBe(hookRules.openInstanceMessage('HAUS-12'));
		expect(reopenOlderMessage('HAUS-12')).toBe(hookRules.reopenOlderMessage('HAUS-12'));
	});

	it('reads the sub-tasks of a template like the hook stores them (plan WV-3)', () => {
		expect(TEMPLATE_SUBTASKS_MAX).toBe(hookRules.TEMPLATE_SUBTASKS_MAX);
		expect(SUBTASKS_FIELD).toBe(hookRules.SUBTASKS_FIELD);
		expect([...PRIORITIES]).toEqual(hookRules.SUBTASK_PRIORITIES);
		// What the hook stores, the SPA reads unchanged.
		const stored = hookRules.templateSubtasksCheck([{ title: ' A ', priority: 'high' }, { title: 'B' }]).value;
		expect(templateSubtasksOf(stored)).toEqual(stored);
	});

	it('offers the statuses for "Status beim Anlegen" the hook accepts, "Offen" by default (plan WV)', () => {
		expect([...TEMPLATE_STATUSES]).toEqual(hookRules.INITIAL_STATUSES);
		expect(DEFAULT_TEMPLATE_STATUS).toBe(hookRules.DEFAULT_INITIAL_STATUS);
		for (const value of ['backlog', 'open', 'in_progress', 'waiting', 'done', '', 'x']) {
			expect(templateStatusOf(value), value).toBe(hookRules.initialStatusOf(value));
		}
	});

	it('knows the hints and the backlog of a waiting rule like the hook (ADR-0022 addendum 5)', () => {
		expect(CATCH_UP_ASK_HINT).toBe(hookRules.CATCH_UP_ASK_HINT);
		expect(CATCH_UP_ALL_HINT).toBe(hookRules.CATCH_UP_ALL_HINT);
		const params = { mode: 'calendar', freq: 'weekly', weekdays: ['MO', 'FR'], interval: 2, anchor: '2026-09-30', lead_days: 3 };
		for (const [from, today] of [['2026-10-02', '2027-03-01'], ['2026-10-12', '2026-10-12'], ['2026-10-02', '2026-10-03']]) {
			const rule = { ...hook.normalize(params), next_due: from };
			const count = hookRules.backlogCount(rule, today, 10000, hook);
			expect(backlogOf(params, from, today)?.count ?? 0, `${from} ${today}`).toBe(count);
		}
	});

	it('reads the note about missed dates the way the hook writes it (ADR-0022 addendum 4)', () => {
		expect(SKIPPED_FIELD).toBe(hookRules.SKIPPED_FIELD);
		const rule = hook.normalize({ mode: 'calendar', freq: 'weekly', weekdays: ['MO'], anchor: '2026-10-05' });
		const value = JSON.stringify(hookRules.skippedDates(rule, '2026-10-12', '2026-10-26', hook));
		expect(parseSkipped(value)).toEqual({ count: 2, dates: ['2026-10-12', '2026-10-19'], more: false });
	});

	it('names the same limit per run for "Jeden Termin einzeln anlegen" as the hook (plan OR-5)', () => {
		expect(EACH_MAX_PER_RUN).toBe(hookRules.EACH_MAX_PER_RUN);
	});
});
