// Relative due labels (E3 plan, T-9 and package 1).

import { describe, expect, it } from 'vitest';
import { addDays } from './berlin-date';
import { NO_DUE_SPOKEN, NO_DUE_TEXT, relativeDue } from './due-label';
import { SOON_DAYS } from './ordering';

const TODAY = '2026-09-25';

describe('relativeDue', () => {
	it.each<[number, string, string]>([
		[-30, 'seit 30 Tagen überfällig', '26.08.2026'],
		[-2, 'seit 2 Tagen überfällig', '23.09.2026'],
		[-1, 'gestern', '24.09.2026'],
		[0, 'heute', '25.09.2026'],
		[1, 'morgen', '26.09.2026'],
		[2, 'in 2 Tagen', '27.09.2026'],
		[7, 'in 7 Tagen', '02.10.2026']
	])('%i days: %s', (days, text, date) => {
		const due = addDays(TODAY, days);
		expect(relativeDue(due, TODAY)).toEqual({
			text,
			date,
			datetime: due,
			spoken: `${text}, ${date}`,
			overdue: days < 0
		});
	});

	it(`shows the date from day ${SOON_DAYS + 1} on`, () => {
		expect(relativeDue(addDays(TODAY, 8), TODAY)).toEqual({
			text: '03.10.2026',
			date: '03.10.2026',
			datetime: '2026-10-03',
			spoken: '03.10.2026',
			overdue: false
		});
		expect(relativeDue('2027-05-01', TODAY).text).toBe('01.05.2027');
	});

	it('shows a dash and a text alternative without a due date', () => {
		expect(relativeDue(null, TODAY)).toEqual({
			text: NO_DUE_TEXT,
			date: null,
			datetime: null,
			spoken: NO_DUE_SPOKEN,
			overdue: false
		});
		expect(NO_DUE_TEXT).toBe('–');
		expect(NO_DUE_SPOKEN).toBe('keine Fälligkeit');
	});

	it.each<[string, string, string]>([
		['2027-01-01', '2026-12-31', 'morgen'],
		['2026-12-31', '2027-01-01', 'gestern'],
		['2027-01-03', '2026-12-29', 'in 5 Tagen'],
		['2026-12-20', '2027-01-02', 'seit 13 Tagen überfällig'],
		['2027-01-08', '2026-12-31', '08.01.2027'],
		['2028-03-01', '2028-02-28', 'in 2 Tagen'],
		['2026-03-30', '2026-03-28', 'in 2 Tagen'],
		['2026-10-24', '2026-10-26', 'seit 2 Tagen überfällig']
	])('%s at %s across year, leap day and clock change: %s', (due, today, text) => {
		expect(relativeDue(due, today).text).toBe(text);
	});

	it('rejects a value that is no calendar date', () => {
		expect(() => relativeDue('2026-02-30', TODAY)).toThrow(RangeError);
	});
});
