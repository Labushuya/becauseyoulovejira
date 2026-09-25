// Berlin calendar date in the hooks (ADR-0005 sections 2 and 3, E4 plan package 14): the required
// cases around both clock changes, the turn of the year, the leap day and the day boundary at
// 22:00/23:00 UTC, and a comparison with the frontend module web/src/lib/domain/berlin-date.ts.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as frontend from '../../web/src/lib/domain/berlin-date.ts';

const hook = loadHookLib('berlin-time.js');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const at = (iso) => Date.parse(iso);

describe('berlin-time.js: berlinToday', () => {
	it.each([
		// Start of summer time: Sunday 29 March 2026, 01:00 UTC; one minute before and after.
		['2026-03-29T00:59:00Z', '2026-03-29', 1],
		['2026-03-29T01:00:00Z', '2026-03-29', 2],
		['2026-03-29T01:01:00Z', '2026-03-29', 2],
		// End of summer time: Sunday 25 October 2026, 01:00 UTC.
		['2026-10-25T00:59:00Z', '2026-10-25', 2],
		['2026-10-25T01:00:00Z', '2026-10-25', 1],
		['2026-10-25T01:01:00Z', '2026-10-25', 1],
		// Day boundary: 23:00 UTC in winter, 22:00 UTC in summer.
		['2026-01-15T22:59:00Z', '2026-01-15', 1],
		['2026-01-15T23:00:00Z', '2026-01-16', 1],
		['2026-07-15T21:59:00Z', '2026-07-15', 2],
		['2026-07-15T22:00:00Z', '2026-07-16', 2],
		// Turn of the year.
		['2026-12-31T22:59:00Z', '2026-12-31', 1],
		['2026-12-31T23:00:00Z', '2027-01-01', 1],
		// Leap day 2028.
		['2028-02-28T23:00:00Z', '2028-02-29', 1],
		['2028-02-29T22:59:00Z', '2028-02-29', 1],
		['2028-02-29T23:00:00Z', '2028-03-01', 1]
	])('%s is %s in Berlin (UTC+%i)', (instant, expected, offset) => {
		expect(hook.berlinToday(at(instant))).toBe(expected);
		expect(hook.berlinToday(new Date(instant))).toBe(expected);
		expect(hook.berlinOffsetHours(at(instant))).toBe(offset);
	});

	it('rejects invalid points in time', () => {
		expect(() => hook.berlinToday(NaN)).toThrow(RangeError);
		expect(() => hook.berlinToday('2026-01-01')).toThrow(RangeError);
		expect(() => hook.berlinToday(new Date('x'))).toThrow(RangeError);
	});
});

describe('berlin-time.js: wall clock and calendar dates', () => {
	it.each([
		['2026-01-15', '09:30', '2026-01-15T08:30:00.000Z'],
		['2026-07-15', '09:30', '2026-07-15T07:30:00.000Z'],
		['2026-07-15', '09:30:45', '2026-07-15T07:30:45.000Z'],
		// Spring change: 02:30 does not exist and comes out one hour later (03:30 CEST).
		['2026-03-29', '01:59', '2026-03-29T00:59:00.000Z'],
		['2026-03-29', '02:30', '2026-03-29T01:30:00.000Z'],
		['2026-03-29', '03:00', '2026-03-29T01:00:00.000Z'],
		// Autumn change: 02:30 exists twice, the summer time is taken.
		['2026-10-25', '01:59', '2026-10-24T23:59:00.000Z'],
		['2026-10-25', '02:30', '2026-10-25T00:30:00.000Z'],
		['2026-10-25', '03:00', '2026-10-25T02:00:00.000Z'],
		['2026-12-31', '23:59', '2026-12-31T22:59:00.000Z'],
		['2028-02-29', '00:00', '2028-02-28T23:00:00.000Z']
	])('%s %s in Berlin is %s', (date, time, expected) => {
		expect(new Date(hook.berlinWallClockToUtc(date, time)).toISOString()).toBe(expected);
	});

	it('takes midnight without a time and rejects invalid input', () => {
		expect(hook.berlinWallClockToUtc('2026-07-15')).toBe(at('2026-07-14T22:00:00Z'));
		expect(hook.berlinMidnight('2026-01-15')).toBe(at('2026-01-14T23:00:00Z'));
		expect(() => hook.berlinWallClockToUtc('2026-02-30', '10:00')).toThrow(RangeError);
		expect(() => hook.berlinWallClockToUtc('2026-02-10', '24:00')).toThrow(RangeError);
		expect(() => hook.berlinWallClockToUtc('2026-02-10', '9:00')).toThrow(RangeError);
	});

	it('adds days across months, years and the leap day', () => {
		expect(hook.addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(hook.addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(hook.addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(hook.addDays('2026-09-25', 30)).toBe('2026-10-25');
		expect(() => hook.addDays('2026-09-25', 1.5)).toThrow(RangeError);
		expect(hook.isCalendarDate('2026-02-29')).toBe(false);
		expect(hook.isCalendarDate('2028-02-29')).toBe(true);
	});

	it('formats dates as PocketBase stores them', () => {
		expect(hook.toPocketBaseDate(at('2026-03-29T01:30:05.007Z'))).toBe('2026-03-29 01:30:05.007Z');
	});
});

describe('berlin-time.js against berlin-date.ts', () => {
	// Every 37 minutes over two years (both changes twice), plus the minutes around each change.
	const samples = [];
	for (let ms = at('2026-01-01T00:00:00Z'); ms < at('2028-01-01T00:00:00Z'); ms += 37 * MINUTE_MS) {
		samples.push(ms);
	}
	for (const change of ['2026-03-29T01:00:00Z', '2026-10-25T01:00:00Z', '2027-03-28T01:00:00Z', '2027-10-31T01:00:00Z']) {
		for (let delta = -3 * HOUR_MS; delta <= 3 * HOUR_MS; delta += MINUTE_MS) samples.push(at(change) + delta);
	}

	it('gives the same date and offset at every sample', () => {
		const different = samples.filter(
			(ms) =>
				hook.berlinToday(ms) !== frontend.berlinToday(ms) ||
				hook.berlinOffsetHours(ms) !== frontend.berlinOffsetHours(ms)
		);
		expect(different).toEqual([]);
	});

	it('gives the same instant for every wall-clock time around the changes', () => {
		const different = [];
		for (const date of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-24', '2026-10-25', '2026-10-26']) {
			for (let minutes = 0; minutes < 24 * 60; minutes += 10) {
				const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
				if (hook.berlinWallClockToUtc(date, time) !== frontend.berlinWallClockToUtc(date, time)) {
					different.push(`${date} ${time}`);
				}
			}
		}
		expect(different).toEqual([]);
	});

	it('adds days like the frontend', () => {
		for (const [date, days] of [['2026-12-31', 1], ['2028-02-28', 2], ['2026-03-31', -31]]) {
			expect(hook.addDays(date, days)).toBe(frontend.addDays(date, days));
		}
	});
});
