// Berlin calendar date without runtime time zone data (ADR-0005, E2 plan package 3).

import { describe, expect, it } from 'vitest';
import {
	addDays,
	berlinOffsetHours,
	berlinWallClockToUtc,
	berlinToday,
	isCalendarDate,
	isTimeOfDay,
	msUntilNextBerlinMidnight,
	parseCalendarDate
} from './berlin-date';

const HOUR_MS = 60 * 60 * 1000;
const at = (iso: string) => Date.parse(iso);

describe('berlinToday', () => {
	it.each([
		// Start of summer time: Sunday 29 March 2026, 01:00 UTC (02:00 CET -> 03:00 CEST)
		['2026-03-28T22:59:00Z', '2026-03-28'],
		['2026-03-28T23:00:00Z', '2026-03-29'],
		['2026-03-29T00:59:00Z', '2026-03-29'],
		['2026-03-29T01:00:00Z', '2026-03-29'],
		['2026-03-29T01:01:00Z', '2026-03-29'],
		['2026-03-29T21:59:00Z', '2026-03-29'],
		['2026-03-29T22:00:00Z', '2026-03-30'],
		['2026-03-29T22:59:00Z', '2026-03-30'],
		['2026-03-29T23:00:00Z', '2026-03-30'],
		['2026-03-30T00:59:00Z', '2026-03-30'],
		['2026-03-30T01:00:00Z', '2026-03-30'],
		['2026-03-30T01:01:00Z', '2026-03-30'],
		['2026-03-30T21:59:00Z', '2026-03-30'],
		['2026-03-30T22:00:00Z', '2026-03-31'],
		// End of summer time: Sunday 25 October 2026, 01:00 UTC (03:00 CEST -> 02:00 CET)
		['2026-10-24T21:59:00Z', '2026-10-24'],
		['2026-10-24T22:00:00Z', '2026-10-25'],
		['2026-10-25T00:59:00Z', '2026-10-25'],
		['2026-10-25T01:00:00Z', '2026-10-25'],
		['2026-10-25T01:01:00Z', '2026-10-25'],
		['2026-10-25T22:59:00Z', '2026-10-25'],
		['2026-10-25T23:00:00Z', '2026-10-26'],
		['2026-10-26T00:59:00Z', '2026-10-26'],
		['2026-10-26T01:00:00Z', '2026-10-26'],
		['2026-10-26T01:01:00Z', '2026-10-26'],
		['2026-10-26T22:59:00Z', '2026-10-26'],
		['2026-10-26T23:00:00Z', '2026-10-27'],
		// Turn of the year (winter time)
		['2026-12-31T22:59:00Z', '2026-12-31'],
		['2026-12-31T23:00:00Z', '2027-01-01'],
		// Leap day 2028
		['2028-02-28T22:59:00Z', '2028-02-28'],
		['2028-02-28T23:00:00Z', '2028-02-29'],
		['2028-02-29T22:59:00Z', '2028-02-29'],
		['2028-02-29T23:00:00Z', '2028-03-01']
	])('%s is %s in Berlin', (instant, expected) => {
		expect(berlinToday(new Date(instant))).toBe(expected);
		expect(berlinToday(at(instant))).toBe(expected);
	});

	it('matches the time zone data of the test runtime for 2026 to 2030', () => {
		// Intl serves only as the reference here; the module itself does not use it.
		const reference = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/Berlin',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		});
		const mismatches: string[] = [];
		const check = (ms: number) => {
			if (berlinToday(ms) !== reference.format(ms)) mismatches.push(new Date(ms).toISOString());
		};
		// Every 3 hours over five years, every 5 minutes around each transition day.
		for (let ms = at('2026-01-01T00:00:00Z'); ms < at('2031-01-01T00:00:00Z'); ms += 3 * HOUR_MS) {
			check(ms);
		}
		for (let year = 2026; year <= 2030; year += 1) {
			for (const month of ['03', '10']) {
				for (let day = 24; day <= 31; day += 1) {
					const start = at(`${year}-${month}-${day}T00:00:00Z`) - 2 * HOUR_MS;
					for (let ms = start; ms < start + 28 * HOUR_MS; ms += 5 * 60 * 1000) check(ms);
				}
			}
		}
		expect(mismatches).toEqual([]);
	});

	it('rejects an invalid point in time', () => {
		expect(() => berlinToday(new Date('invalid'))).toThrow(RangeError);
		expect(() => berlinToday(Number.NaN)).toThrow(RangeError);
	});
});

describe('berlinOffsetHours', () => {
	it.each([
		['2026-03-29T00:59:59Z', 1],
		['2026-03-29T01:00:00Z', 2],
		['2026-10-25T00:59:59Z', 2],
		['2026-10-25T01:00:00Z', 1],
		['2027-03-28T01:00:00Z', 2],
		['2027-01-15T12:00:00Z', 1],
		['2027-07-15T12:00:00Z', 2]
	])('%s is UTC+%i', (instant, offset) => {
		expect(berlinOffsetHours(at(instant))).toBe(offset);
	});
});

describe('addDays', () => {
	it.each([
		['2026-09-24', 1, '2026-09-25'],
		['2026-09-24', 7, '2026-10-01'],
		['2026-09-24', 0, '2026-09-24'],
		['2026-09-24', -24, '2026-08-31'],
		['2026-01-31', 1, '2026-02-01'],
		['2026-02-28', 1, '2026-03-01'],
		['2028-02-28', 1, '2028-02-29'],
		['2028-02-29', 1, '2028-03-01'],
		['2026-12-31', 1, '2027-01-01'],
		['2027-01-01', -1, '2026-12-31'],
		['2026-03-28', 2, '2026-03-30'],
		['2026-10-24', 2, '2026-10-26']
	])('%s plus %i days is %s', (date, days, expected) => {
		expect(addDays(date, days)).toBe(expected);
	});

	it.each(['2026-02-30', '2026-13-01', '26-09-24', '2026-9-24', '', '2026-09-24 00:00'])(
		'rejects the invalid date "%s"',
		(date) => {
			expect(() => addDays(date, 1)).toThrow(RangeError);
		}
	);

	it('rejects fractions of days', () => {
		expect(() => addDays('2026-09-24', 0.5)).toThrow(RangeError);
	});
});

describe('calendar date parsing', () => {
	it('accepts real dates only', () => {
		expect(isCalendarDate('2028-02-29')).toBe(true);
		expect(isCalendarDate('2027-02-29')).toBe(false);
		expect(parseCalendarDate('2026-09-24')).toBe(at('2026-09-24T00:00:00Z'));
	});
});

describe('msUntilNextBerlinMidnight', () => {
	it.each([
		['2026-09-24T10:00:00Z', 12 * HOUR_MS],
		['2026-09-24T21:59:59Z', 1000],
		// Exactly at midnight the next one is a full day away.
		['2026-09-24T22:00:00Z', 24 * HOUR_MS],
		['2026-01-15T23:00:00Z', 24 * HOUR_MS],
		// The night into summer time is one hour shorter, the one out of it one hour longer.
		['2026-03-28T23:00:00Z', 23 * HOUR_MS],
		['2026-03-29T00:30:00Z', 21.5 * HOUR_MS],
		['2026-10-24T22:00:00Z', 25 * HOUR_MS],
		['2026-10-24T22:30:00Z', 24.5 * HOUR_MS],
		['2026-12-31T22:59:00Z', 60 * 1000]
	])('from %s it is %i ms', (instant, expected) => {
		expect(msUntilNextBerlinMidnight(at(instant))).toBe(expected);
	});

	it('ends exactly where the Berlin date changes', () => {
		for (let ms = at('2026-03-20T00:00:00Z'); ms < at('2026-11-05T00:00:00Z'); ms += 7 * HOUR_MS) {
			const wait = msUntilNextBerlinMidnight(ms);
			expect(wait).toBeGreaterThan(0);
			expect(berlinToday(ms + wait - 1)).toBe(berlinToday(ms));
			expect(berlinToday(ms + wait)).toBe(addDays(berlinToday(ms), 1));
		}
	});
});

describe('berlinWallClockToUtc (E4 plan, package 5)', () => {
	it.each([
		['2026-01-15', '09:00', '2026-01-15T08:00:00.000Z'],
		['2026-07-01', '14:30', '2026-07-01T12:30:00.000Z'],
		['2026-12-24', '00:00', '2026-12-23T23:00:00.000Z'],
		// Spring change on 2026-03-29: 01:59 is winter time, 03:00 summer time.
		['2026-03-29', '01:59', '2026-03-29T00:59:00.000Z'],
		['2026-03-29', '03:00', '2026-03-29T01:00:00.000Z'],
		// The skipped hour comes out one hour later, as a clock would show it.
		['2026-03-29', '02:30', '2026-03-29T01:30:00.000Z'],
		// Autumn change on 2026-10-25: the doubled hour is taken as summer time.
		['2026-10-25', '02:30', '2026-10-25T00:30:00.000Z'],
		['2026-10-25', '03:00', '2026-10-25T02:00:00.000Z']
	])('reads %s %s in Berlin as %s', (date, time, iso) => {
		expect(new Date(berlinWallClockToUtc(date, time)).toISOString()).toBe(iso);
	});

	it('takes midnight without a time and refuses other values', () => {
		expect(new Date(berlinWallClockToUtc('2026-06-01')).toISOString()).toBe(
			'2026-05-31T22:00:00.000Z'
		);
		expect(() => berlinWallClockToUtc('2026-06-01', '24:00')).toThrow(RangeError);
		expect(() => berlinWallClockToUtc('2026-02-30', '10:00')).toThrow(RangeError);
	});

	it('knows a time of day', () => {
		expect(['00:00', '09:05', '23:59'].every(isTimeOfDay)).toBe(true);
		expect(['24:00', '9:05', '12:60', '', '12:00:00'].some(isTimeOfDay)).toBe(false);
	});
});
