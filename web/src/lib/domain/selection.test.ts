// Selection of rows in the ticket table (plan BI-2, ADR-0036 §2): click, Shift range, head
// checkbox and filter changes.

import { describe, expect, it } from 'vitest';
import {
	EMPTY_SELECTION,
	clickRow,
	headState,
	keepShown,
	toggleAll,
	type Selection
} from './selection';

const ORDER = ['a', 'b', 'c', 'd', 'e'];

describe('clickRow', () => {
	it('chooses and clears single rows and moves the anchor', () => {
		let selection = clickRow(EMPTY_SELECTION, 'b', true, ORDER);
		expect(selection).toEqual({ ids: ['b'], anchor: 'b' });
		selection = clickRow(selection, 'd', true, ORDER);
		expect(selection).toEqual({ ids: ['b', 'd'], anchor: 'd' });
		selection = clickRow(selection, 'b', false, ORDER);
		expect(selection).toEqual({ ids: ['d'], anchor: 'b' });
	});

	it('chooses a range with Shift from the anchor, in both directions', () => {
		const start = clickRow(EMPTY_SELECTION, 'b', true, ORDER);
		expect(clickRow(start, 'd', true, ORDER, true)).toEqual({ ids: ['b', 'c', 'd'], anchor: 'b' });
		const down = clickRow(EMPTY_SELECTION, 'd', true, ORDER);
		expect(clickRow(down, 'a', true, ORDER, true)).toEqual({
			ids: ['d', 'a', 'b', 'c'],
			anchor: 'd'
		});
	});

	it('keeps the start of a range for a second Shift+click', () => {
		let selection = clickRow(EMPTY_SELECTION, 'b', true, ORDER);
		selection = clickRow(selection, 'e', true, ORDER, true);
		selection = clickRow(selection, 'c', false, ORDER, true);
		// Clearing the range b..c keeps d and e.
		expect(selection).toEqual({ ids: ['d', 'e'], anchor: 'b' });
	});

	it('clears a range with Shift when the clicked row goes off', () => {
		const all: Selection = { ids: [...ORDER], anchor: 'a' };
		expect(clickRow(all, 'c', false, ORDER, true)).toEqual({ ids: ['d', 'e'], anchor: 'a' });
	});

	it('treats Shift without a shown anchor like a plain click', () => {
		expect(clickRow(EMPTY_SELECTION, 'c', true, ORDER, true)).toEqual({ ids: ['c'], anchor: 'c' });
		const gone: Selection = { ids: ['x'], anchor: 'x' };
		expect(clickRow(gone, 'c', true, ORDER, true)).toEqual({ ids: ['x', 'c'], anchor: 'c' });
	});
});

describe('head checkbox', () => {
	it('is none, some (indeterminate) or all over the shown rows', () => {
		expect(headState(EMPTY_SELECTION, ORDER)).toBe('none');
		expect(headState({ ids: ['a', 'x'], anchor: null }, ORDER)).toBe('some');
		expect(headState({ ids: [...ORDER], anchor: null }, ORDER)).toBe('all');
		expect(headState(EMPTY_SELECTION, [])).toBe('none');
	});

	it('chooses every shown row, and clears them once all are chosen', () => {
		const some: Selection = { ids: ['c'], anchor: 'c' };
		const all = toggleAll(some, ORDER);
		expect([...all.ids].sort()).toEqual(ORDER);
		expect(all.anchor).toBeNull();
		expect(toggleAll(all, ORDER)).toEqual({ ids: [], anchor: null });
	});

	it('does nothing without shown rows', () => {
		expect(toggleAll(EMPTY_SELECTION, [])).toBe(EMPTY_SELECTION);
	});
});

describe('keepShown', () => {
	it('keeps only rows that are still shown and drops a vanished anchor', () => {
		const selection: Selection = { ids: ['a', 'c', 'e'], anchor: 'e' };
		expect(keepShown(selection, ['a', 'b', 'c'])).toEqual({ ids: ['a', 'c'], anchor: null });
		expect(keepShown(selection, ['b'])).toEqual({ ids: [], anchor: null });
	});

	it('returns the same object when nothing changes', () => {
		const selection: Selection = { ids: ['a'], anchor: 'a' };
		expect(keepShown(selection, ORDER)).toBe(selection);
	});
});
