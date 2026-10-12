// Lists shown in pages (TD-1, ADR-0031 addendum L): the sources of a ticket, its source tickets and
// its follow-ups show at most PAGE_SIZE entries per page, so a ticket with many of them does not
// grow endlessly. Pure: which page shows and what the controls say. The entries are already loaded
// (up to SOURCES_LIMIT); the client only splits them, no request is added.

/** Entries per page. */
export const PAGE_SIZE = 5;

/** Name of the entries of a list, e.g. { one: 'Quelle', other: 'Quellen' }. */
export interface PagedNoun {
	one: string;
	other: string;
}

/** Number of pages of `total` entries; an empty list has one (empty) page. */
export function pageCount(total: number, size: number = PAGE_SIZE): number {
	return Math.max(1, Math.ceil(total / size));
}

/** Whether a list of `total` entries needs the controls at all. */
export function isPaged(total: number, size: number = PAGE_SIZE): boolean {
	return total > size;
}

/** The page (from 0) an entry at `index` stands on. */
export function pageOfIndex(index: number, size: number = PAGE_SIZE): number {
	return Math.floor(Math.max(0, index) / size);
}

/**
 * The page a list shows: the page of a held entry (`held` is its index, -1 for none), else the
 * chosen page, but never past the last one, so a page that became empty gives way to the one
 * before it.
 */
export function shownPage({
	total,
	chosen,
	held = -1,
	size = PAGE_SIZE
}: {
	total: number;
	chosen: number;
	held?: number;
	size?: number;
}): number {
	if (held >= 0 && held < total) return pageOfIndex(held, size);
	return Math.min(Math.max(0, chosen), pageCount(total, size) - 1);
}

/** The entries of `page`. */
export function pageSlice<T>(items: readonly T[], page: number, size: number = PAGE_SIZE): T[] {
	return items.slice(page * size, page * size + size);
}

/** "Seite 2 von 3" for the page `page` (from 0). */
export function pageText(page: number, count: number): string {
	return `Seite ${page + 1} von ${count}`;
}

/** "12 Quellen" or "1 Quelle". */
export function totalText(total: number, noun: PagedNoun): string {
	return `${total} ${total === 1 ? noun.one : noun.other}`;
}

/**
 * The hidden rest of the names of the two buttons, after their visible "Zurück" and "Weiter":
 * "zur vorherigen Seite der Quellen". The visible word starts the name (WCAG 2.5.3), the rest tells
 * the lists of one ticket apart.
 */
export function pageButtonRest(direction: 'previous' | 'next', noun: PagedNoun): string {
	return direction === 'previous'
		? `zur vorherigen Seite der ${noun.other}`
		: `zur nächsten Seite der ${noun.other}`;
}
