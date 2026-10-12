// Lists in pages (TD-1, ADR-0031 addendum L): pure rules of the page shown, the slice, the count and
// the names of the buttons.

import { describe, expect, it } from 'vitest';
import {
	PAGE_SIZE,
	isPaged,
	pageButtonRest,
	pageCount,
	pageOfIndex,
	pageSlice,
	pageText,
	shownPage,
	totalText
} from './paged-list';

const NOUN = { one: 'Quelle', other: 'Quellen' };
const numbers = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe('paged lists (TD-1)', () => {
	it('shows five per page and needs controls only above five', () => {
		expect(PAGE_SIZE).toBe(5);
		expect([0, 5, 6, 12].map((total) => pageCount(total))).toEqual([1, 1, 2, 3]);
		expect([0, 5, 6, 12].map((total) => isPaged(total))).toEqual([false, false, true, true]);
		expect(pageSlice(numbers(12), 0)).toEqual([1, 2, 3, 4, 5]);
		expect(pageSlice(numbers(12), 2)).toEqual([11, 12]);
		expect(pageSlice(numbers(6), 1)).toEqual([6]);
		expect(pageSlice([], 0)).toEqual([]);
	});

	it('keeps the chosen page, never past the last one, and follows a held entry', () => {
		expect(shownPage({ total: 12, chosen: 1 })).toBe(1);
		// The last page became empty: the one before it shows.
		expect(shownPage({ total: 10, chosen: 2 })).toBe(1);
		expect(shownPage({ total: 0, chosen: 3 })).toBe(0);
		expect(shownPage({ total: 12, chosen: -1 })).toBe(0);
		// A held entry keeps its page in view, wherever the chosen page is.
		expect(shownPage({ total: 12, chosen: 0, held: 7 })).toBe(1);
		expect(shownPage({ total: 12, chosen: 2, held: 0 })).toBe(0);
		// A held entry that is gone does not count.
		expect(shownPage({ total: 6, chosen: 1, held: 9 })).toBe(1);
		expect([0, 4, 5, 11].map((index) => pageOfIndex(index))).toEqual([0, 0, 1, 2]);
	});

	it('says the page and the total, and names the buttons after their visible word', () => {
		expect(pageText(1, 3)).toBe('Seite 2 von 3');
		expect(totalText(12, NOUN)).toBe('12 Quellen');
		expect(totalText(1, NOUN)).toBe('1 Quelle');
		expect(`Zurück ${pageButtonRest('previous', NOUN)}`).toBe(
			'Zurück zur vorherigen Seite der Quellen'
		);
		expect(
			`Weiter ${pageButtonRest('next', { one: 'Folge-Ticket', other: 'Folge-Tickets' })}`
		).toBe('Weiter zur nächsten Seite der Folge-Tickets');
	});
});
