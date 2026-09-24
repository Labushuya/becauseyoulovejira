// Conversion of the due date between storage and date input (CLAUDE.md section 5).

import { describe, expect, it } from 'vitest';
import { fromDueInput, toDueInput } from './ticket';

describe('due date conversion', () => {
	it.each(['2026-09-24', '2028-02-29', '2026-12-31', '2027-01-01'])('round-trips %s', (date) => {
		const stored = fromDueInput(date);

		expect(stored).toBe(`${date} 00:00:00.000Z`);
		expect(toDueInput(stored)).toBe(date);
	});

	it('keeps an empty value empty in both directions', () => {
		expect(toDueInput('')).toBe('');
		expect(fromDueInput('')).toBe('');
	});

	it('also reads the stored format without milliseconds', () => {
		expect(toDueInput('2026-09-24 00:00:00Z')).toBe('2026-09-24');
	});

	it.each([
		'2026-09-24 10:00:00.000Z',
		'2026-02-30 00:00:00.000Z',
		'2026-09-24T00:00:00.000Z',
		'2026-09-24',
		'garbage'
	])('rejects the unexpected stored value "%s"', (stored) => {
		expect(() => toDueInput(stored)).toThrow(RangeError);
	});

	it.each(['24.09.2026', '2026-9-24', '2027-02-29', '2026-09-24 00:00:00.000Z', ' '])(
		'rejects the invalid input "%s"',
		(input) => {
			expect(() => fromDueInput(input)).toThrow(RangeError);
		}
	);
});
