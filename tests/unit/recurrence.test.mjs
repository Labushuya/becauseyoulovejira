// Date calculation of recurring tasks in the hooks (app/pb_hooks/lib/recurrence.js; CLAUDE.md
// section 6, ADR-0021 sections 2 and 3, E5 plan package 1): the shared table, the required cases
// (month ends, leap years, daylight saving through berlin-time.js, long gaps), a comparison with a
// day-by-day enumeration of the definition, validation and running time.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const recurrence = loadHookLib('recurrence.js');
const berlin = loadHookLib('berlin-time.js');
const { cases } = JSON.parse(readFileSync(new URL('../fixtures/recurrence/cases.json', import.meta.url), 'utf8'));

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function call(fn, rule, args) {
	if (fn === 'createOn') return recurrence.createOn(...args);
	return recurrence[fn](rule, ...args);
}

// --- Reference: the definition of ADR-0021 section 2, checked day by day -----------------------

const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dateOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const weekdayIndex = (day) => (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

function isOccurrence(rule, day) {
	const anchor = dayNumber(rule.anchor);
	if (day < anchor) return false;
	const date = new Date(day * DAY_MS);
	const anchorDate = new Date(anchor * DAY_MS);
	const step = rule.interval;
	switch (rule.freq) {
		case 'daily':
			return (day - anchor) % step === 0;
		case 'weekly': {
			const weeks = (day - weekdayIndex(day) - (anchor - weekdayIndex(anchor))) / 7;
			return weeks % step === 0 && rule.weekdays.includes(WEEKDAYS[weekdayIndex(day)]);
		}
		case 'monthly': {
			const months =
				(date.getUTCFullYear() - anchorDate.getUTCFullYear()) * 12 + date.getUTCMonth() - anchorDate.getUTCMonth();
			const last = lastDayOfMonth(date.getUTCFullYear(), date.getUTCMonth());
			const target = rule.month_day === -1 ? last : Math.min(rule.month_day, last);
			return months % step === 0 && date.getUTCDate() === target;
		}
		default: {
			const years = date.getUTCFullYear() - anchorDate.getUTCFullYear();
			const last = lastDayOfMonth(date.getUTCFullYear(), anchorDate.getUTCMonth());
			return (
				years % step === 0 &&
				date.getUTCMonth() === anchorDate.getUTCMonth() &&
				date.getUTCDate() === Math.min(anchorDate.getUTCDate(), last)
			);
		}
	}
}

function random(seed) {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}

function randomRule(next) {
	const freq = ['daily', 'weekly', 'monthly', 'yearly'][Math.floor(next() * 4)];
	const anchor = dateOf(dayNumber('2023-01-01') + Math.floor(next() * 1500));
	const rule = { mode: 'calendar', freq, interval: 1 + Math.floor(next() * (freq === 'yearly' ? 3 : 5)), anchor, lead_days: 3 };
	if (freq === 'weekly') rule.weekdays = WEEKDAYS.filter(() => next() < 0.35);
	if (freq === 'weekly' && rule.weekdays.length === 0) rule.weekdays = [WEEKDAYS[Math.floor(next() * 7)]];
	if (freq === 'monthly') rule.month_day = next() < 0.2 ? -1 : 1 + Math.floor(next() * 31);
	return rule;
}

describe('recurrence.js: shared table', () => {
	it.each(cases)('$name', ({ fn, rule, args, expect: expected }) => {
		expect(call(fn, rule, args)).toEqual(expected);
	});
});

describe('recurrence.js: against the definition, day by day', () => {
	it('finds the same occurrences as a day-by-day check for 400 random rules', () => {
		const next = random(20260925);
		for (let round = 0; round < 400; round++) {
			const rule = randomRule(next);
			const anchor = dayNumber(rule.anchor);
			const from = anchor - 40 + Math.floor(next() * 400);
			let expectedNext = Math.max(from, anchor);
			while (!isOccurrence(rule, expectedNext)) expectedNext++;
			let expectedLast = from;
			while (expectedLast >= anchor && !isOccurrence(rule, expectedLast)) expectedLast--;
			const label = JSON.stringify({ rule, from: dateOf(from) });
			expect(recurrence.onOrAfter(rule, dateOf(from)), label).toBe(dateOf(expectedNext));
			expect(recurrence.latestOnOrBefore(rule, dateOf(from)), label).toBe(
				expectedLast >= anchor ? dateOf(expectedLast) : null
			);
			let expectedAfter = Math.max(from + 1, anchor);
			while (!isOccurrence(rule, expectedAfter)) expectedAfter++;
			expect(recurrence.after(rule, dateOf(from)), label).toBe(dateOf(expectedAfter));
		}
	});
});

describe('recurrence.js: required cases (CLAUDE.md section 6)', () => {
	it('clamps month ends in every month of two years', () => {
		const rule = { mode: 'calendar', freq: 'monthly', interval: 1, month_day: 31, anchor: '2027-01-31' };
		const dates = recurrence.upcoming(rule, '2027-01-01', 24);
		expect(dates.slice(0, 4)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
		expect(dates[13]).toBe('2028-02-29');
		for (const date of dates) {
			const [year, month, day] = date.split('-').map(Number);
			expect(day).toBe(lastDayOfMonth(year, month - 1));
		}
	});

	it('counts the ticket day in Berlin at both clock changes (21:59, 22:00, 22:59, 23:00 UTC)', () => {
		const rule = { mode: 'calendar', freq: 'daily', interval: 1, anchor: '2026-01-01', lead_days: 0 };
		// Start of summer time on 29 March 2026: the next Berlin day starts at 22:00 UTC.
		// End of summer time on 25 October 2026: the next Berlin day starts at 23:00 UTC.
		const moments = [
			['2026-03-29T21:59:00Z', '2026-03-29'],
			['2026-03-29T22:00:00Z', '2026-03-30'],
			['2026-03-29T22:59:00Z', '2026-03-30'],
			['2026-03-29T23:00:00Z', '2026-03-30'],
			['2026-10-25T21:59:00Z', '2026-10-25'],
			['2026-10-25T22:00:00Z', '2026-10-25'],
			['2026-10-25T22:59:00Z', '2026-10-25'],
			['2026-10-25T23:00:00Z', '2026-10-26']
		];
		for (const [instant, today] of moments) {
			const berlinToday = berlin.berlinToday(Date.parse(instant));
			expect(berlinToday, instant).toBe(today);
			// The ticket due tomorrow with lead time 0 is created exactly from the Berlin midnight on.
			const due = berlin.addDays(berlinToday, 1);
			expect(recurrence.createOn(due, 0) <= berlinToday, instant).toBe(false);
			expect(recurrence.createOn(berlinToday, 0) <= berlinToday, instant).toBe(true);
			expect(recurrence.catchUp(rule, '2026-01-01', berlinToday), instant).toBe(today);
		}
	});

	it.each([
		['daily', { freq: 'daily', interval: 1 }],
		['every 3 days', { freq: 'daily', interval: 3 }],
		['every Monday', { freq: 'weekly', interval: 1, weekdays: ['MO'] }],
		['every 2 weeks on workdays', { freq: 'weekly', interval: 2, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] }],
		['monthly on the 31st', { freq: 'monthly', interval: 1, month_day: 31 }],
		['every 2 months on the last day', { freq: 'monthly', interval: 2, month_day: -1 }],
		['yearly on 29 February', { freq: 'yearly', interval: 1, anchorDate: '2024-02-29' }]
	])('catches up after gaps of 1, 3 and 10 years: %s', (_, params) => {
		const { anchorDate, ...rest } = params;
		const rule = { mode: 'calendar', anchor: anchorDate ?? '2026-01-31', ...rest };
		const pending = recurrence.onOrAfter(rule, rule.anchor);
		for (const years of [1, 3, 10]) {
			const today = berlin.addDays(pending, Math.round(years * 365.25) + 17);
			const due = recurrence.catchUp(rule, pending, today);
			// The latest occurrence up to today, never earlier than the pending one, and the next one
			// lies after today: exactly one ticket, no stack.
			expect(due <= today).toBe(true);
			expect(due >= pending).toBe(true);
			expect(due).toBe(recurrence.latestOnOrBefore(rule, today));
			expect(recurrence.after(rule, due) > today).toBe(true);
		}
	});

	it('never goes back before the pending date', () => {
		const rule = { mode: 'calendar', freq: 'weekly', interval: 1, weekdays: ['MO'], anchor: '2026-09-07' };
		expect(recurrence.catchUp(rule, '2026-10-05', '2026-09-25')).toBe('2026-10-05');
		expect(recurrence.catchUp(rule, '2026-09-14', '2026-09-14')).toBe('2026-09-14');
	});

	it('computes a date of a 10-year series in well under 1 ms', () => {
		const rules = [
			{ mode: 'calendar', freq: 'daily', interval: 1, anchor: '2026-01-01' },
			{ mode: 'calendar', freq: 'weekly', interval: 2, weekdays: ['MO', 'TH'], anchor: '2026-01-01' },
			{ mode: 'calendar', freq: 'monthly', interval: 1, month_day: -1, anchor: '2026-01-01' },
			{ mode: 'calendar', freq: 'yearly', interval: 1, anchor: '2024-02-29' }
		];
		const calls = 2000;
		const started = performance.now();
		for (let i = 0; i < calls; i++) {
			const rule = rules[i % rules.length];
			recurrence.onOrAfter(rule, '2036-06-15');
			recurrence.catchUp(rule, rule.anchor, '2036-06-15');
		}
		const perCall = (performance.now() - started) / (calls * 2);
		expect(perCall).toBeLessThan(1);
	});
});

describe('recurrence.js: rules and errors', () => {
	it('fills defaults from the anchor and keeps lead time 0', () => {
		expect(recurrence.normalize({ mode: 'calendar', freq: 'monthly', anchor: '2026-01-31' })).toMatchObject({
			interval: 1,
			month_day: 31,
			lead_days: recurrence.DEFAULT_LEAD_DAYS
		});
		expect(recurrence.DEFAULT_LEAD_DAYS).toBe(3);
		expect(recurrence.normalize({ mode: 'calendar', freq: 'daily', anchor: '2026-01-31', lead_days: 0 }).lead_days).toBe(0);
		expect(recurrence.normalize(null)).toMatchObject({ mode: '', freq: '', anchor: '' });
	});

	it('refuses dates of invalid rules and rules of the wrong mode', () => {
		const calendar = { mode: 'calendar', freq: 'daily', interval: 1, anchor: '2026-01-01' };
		const completion = { mode: 'after_completion', freq: 'daily', interval: 1, anchor: '2026-01-01' };
		expect(() => recurrence.onOrAfter({ ...calendar, interval: 400 }, '2026-01-01')).toThrow(RangeError);
		expect(() => recurrence.onOrAfter(completion, '2026-01-01')).toThrow(RangeError);
		expect(() => recurrence.afterCompletion(calendar, '2026-01-01')).toThrow(RangeError);
		expect(() => recurrence.onOrAfter(calendar, '2026-02-30')).toThrow(RangeError);
		expect(() => recurrence.createOn('2026-01-01', 31)).toThrow(RangeError);
		expect(recurrence.isValid(calendar)).toBe(false);
		expect(recurrence.isValid(recurrence.normalize(calendar))).toBe(true);
		expect(recurrence.weekdayOf('2026-09-28')).toBe('MO');
	});

	it('accepts anchors only between 1900 and 2999', () => {
		const rule = { mode: 'calendar', freq: 'daily', interval: 1, lead_days: 3 };
		expect(recurrence.validate({ ...rule, anchor: '1899-12-31' })).toEqual({ anchor: 'validation_recurrence_anchor' });
		expect(recurrence.validate({ ...rule, anchor: '1900-01-01' })).toEqual({});
		expect(recurrence.validate({ ...rule, anchor: '2999-12-31' })).toEqual({});
		expect(recurrence.validate({ ...rule, anchor: '3000-01-01' })).toEqual({ anchor: 'validation_recurrence_anchor' });
	});

	it('reports several errors at once', () => {
		expect(recurrence.validate({})).toEqual({
			mode: 'validation_recurrence_mode',
			freq: 'validation_recurrence_freq',
			interval: 'validation_recurrence_interval',
			anchor: 'validation_recurrence_anchor',
			lead_days: 'validation_recurrence_lead_days'
		});
	});
});
