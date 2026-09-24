// German date display (CLAUDE.md section 7).

import { describe, expect, it } from 'vitest';
import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from './format';

describe('formatCalendarDate', () => {
	it.each([
		['2026-09-24', '24.09.2026'],
		['2028-02-29', '29.02.2028'],
		['2027-01-01', '01.01.2027']
	])('formats %s as %s', (date, text) => {
		expect(formatCalendarDate(date)).toBe(text);
	});

	it.each(['2026-02-30', '24.09.2026', ''])('rejects "%s"', (date) => {
		expect(() => formatCalendarDate(date)).toThrow(RangeError);
	});
});

describe('formatBerlinDateTime', () => {
	it.each([
		['2026-09-24 10:05:00.000Z', '24.09.2026 12:05'],
		['2026-12-31 23:30:00.000Z', '01.01.2027 00:30'],
		['2026-03-29 00:59:59.999Z', '29.03.2026 01:59'],
		['2026-03-29 01:00:00.000Z', '29.03.2026 03:00'],
		['2026-10-25 00:59:00.000Z', '25.10.2026 02:59'],
		['2026-10-25 01:00:00.000Z', '25.10.2026 02:00'],
		['2026-09-24T22:00:00Z', '25.09.2026 00:00']
	])('shows %s as %s', (timestamp, text) => {
		expect(formatBerlinDateTime(timestamp)).toBe(text);
	});

	it.each(['', '2026-09-24', '2026-09-24 10:00:00', 'garbage'])('rejects "%s"', (timestamp) => {
		expect(() => formatBerlinDateTime(timestamp)).toThrow(RangeError);
	});
});

describe('berlinDateOf', () => {
	it.each([
		['2026-09-24 10:05:00.000Z', '2026-09-24'],
		['2026-09-24 21:59:59.999Z', '2026-09-24'],
		['2026-09-24 22:00:00.000Z', '2026-09-25'],
		['2026-12-31 23:30:00.000Z', '2027-01-01'],
		['2026-01-15 22:59:00.000Z', '2026-01-15']
	])('takes the Berlin date of %s: %s', (timestamp, date) => {
		expect(berlinDateOf(timestamp)).toBe(date);
	});

	it('rejects what is not a timestamp', () => {
		expect(() => berlinDateOf('2026-09-24')).toThrow(RangeError);
	});
});
