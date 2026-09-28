// Selection of rows in the ticket table (plan BI-2, ADR-0036 §2): pure rules for a click, a
// Shift+click range, the head checkbox and filter changes. The table keeps the chosen IDs and the
// anchor of the last plain click; `order` is the order of the rows as shown (open, then done).

export interface Selection {
	/** Chosen ticket IDs, in the order they were chosen. */
	readonly ids: readonly string[];
	/** Row of the last click without Shift: the start of a range. */
	readonly anchor: string | null;
}

export const EMPTY_SELECTION: Selection = Object.freeze({ ids: [], anchor: null });

/** State of the head checkbox over `shown` rows: none, some (indeterminate) or all chosen. */
export type HeadState = 'none' | 'some' | 'all';

/**
 * A click on the checkbox of row `id`, which then shows `on`. With `range` (Shift) and an anchor
 * that is still shown, every row between anchor and `id` takes the state `on`; otherwise only this
 * row, and it becomes the new anchor.
 */
export function clickRow(
	selection: Selection,
	id: string,
	on: boolean,
	order: readonly string[],
	range = false
): Selection {
	const anchor = selection.anchor;
	const from = anchor === null ? -1 : order.indexOf(anchor);
	const to = order.indexOf(id);
	const affected =
		range && from >= 0 && to >= 0 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
	const ids = on
		? [...selection.ids, ...affected.filter((entry) => !selection.ids.includes(entry))]
		: selection.ids.filter((entry) => !affected.includes(entry));
	// A range keeps its start, so a second Shift+click moves only the end.
	return { ids, anchor: range && from >= 0 && to >= 0 ? anchor : id };
}

/** State of the head checkbox for the rows `shown`. */
export function headState(selection: Selection, shown: readonly string[]): HeadState {
	const chosen = shown.filter((id) => selection.ids.includes(id)).length;
	if (chosen === 0) return 'none';
	return chosen === shown.length ? 'all' : 'some';
}

/**
 * The head checkbox: with every shown row chosen it clears them, otherwise it chooses all shown
 * rows. Chosen rows that are not shown stay out (see `keepShown`).
 */
export function toggleAll(selection: Selection, shown: readonly string[]): Selection {
	if (shown.length === 0) return selection;
	if (headState(selection, shown) === 'all') {
		return { ids: selection.ids.filter((id) => !shown.includes(id)), anchor: null };
	}
	return {
		ids: [...selection.ids, ...shown.filter((id) => !selection.ids.includes(id))],
		anchor: null
	};
}

/**
 * After a filter change, a new sort or rows leaving the list: only rows that are still shown
 * stay chosen, and an anchor that is gone is dropped. Returns the same object when nothing
 * changes, so a caller can compare.
 */
export function keepShown(selection: Selection, shown: readonly string[]): Selection {
	const ids = selection.ids.filter((id) => shown.includes(id));
	const anchor =
		selection.anchor !== null && shown.includes(selection.anchor) ? selection.anchor : null;
	if (ids.length === selection.ids.length && anchor === selection.anchor) return selection;
	return { ids, anchor };
}
