// Order of a list by time, "Neueste zuerst" or "Älteste zuerst" (ADR-0044 §1 for the comments,
// ADR-0031 addendum M for the sources of a ticket). Pure. Both lists share the choice, its labels,
// the stored value (only "oldest", the default removes the key) and the comparison of timestamps,
// so the switch looks and behaves the same in both places.

export type ListOrder = 'newest' | 'oldest';

/** The default: the newest entry first, as in Jira. */
export const DEFAULT_LIST_ORDER: ListOrder = 'newest';

/** The choices of the switch, in its order. */
export const LIST_ORDERS: readonly ListOrder[] = Object.freeze(['newest', 'oldest']);

/** Labels of the switch. */
export const LIST_ORDER_LABELS: Readonly<Record<ListOrder, string>> = Object.freeze({
	newest: 'Neueste zuerst',
	oldest: 'Älteste zuerst'
});

/** The stored value read strictly: only "oldest" counts, anything else is the default. */
export function parseListOrder(raw: string | null | undefined): ListOrder {
	return raw === 'oldest' ? 'oldest' : DEFAULT_LIST_ORDER;
}

/** The value to store, or null to remove the key (default). */
export function serializeListOrder(order: ListOrder): string | null {
	return order === 'oldest' ? 'oldest' : null;
}

/** Milliseconds of a timestamp of PocketBase (also with `T`); an unreadable one counts as oldest. */
function instantOf(timestamp: string): number {
	const ms = Date.parse(timestamp.replace(' ', 'T'));
	return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * Compares two timestamps of PocketBase as points in time, oldest first. Not as text: the server
 * writes `…00.000Z`, other ways `…00Z` or a `T`, and the text would order these wrongly.
 */
export function compareTimestamps(a: string, b: string): number {
	const [left, right] = [instantOf(a), instantOf(b)];
	return left < right ? -1 : left > right ? 1 : 0;
}

/** Compares two IDs by their characters, independent of the language of the browser. */
export function compareIds(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
