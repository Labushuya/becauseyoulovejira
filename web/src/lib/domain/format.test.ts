// German date display (CLAUDE.md section 7).

import { describe, expect, it } from 'vitest';
import { formatCalendarDate } from './format';

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
