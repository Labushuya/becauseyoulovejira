// Long lists of chips (ADR-0026, addendum KL): the keywords in the details of the channel cards
// and in the keyword editor. Pure: which entries a list shows, folded or filtered. A short list
// shows everything; a longer one first CHIP_LIST_SHOWN entries and "+ N weitere"; a very long one
// also gets a filter field, which compares like the ticket picker (ADR-0042): without case,
// accents and umlaut dots, several words must all occur.

import { normalizeSearch, searchWords } from './ticket-picker';

/** Entries a folded list shows. */
export const CHIP_LIST_SHOWN = 8;

/** A list folds only above this many entries, so the button always hides at least three. */
export const CHIP_LIST_FOLD_ABOVE = 10;

/** A filter field appears above this many entries. */
export const CHIP_LIST_FILTER_ABOVE = 20;

/** What a list shows now. */
export interface ChipListView {
	/** The entries shown, in their order. */
	shown: string[];
	/** Entries folded away (0 while unfolded, filtered or short). */
	hidden: number;
	/** The list offers "+ N weitere" / "Weniger anzeigen" (not while filtering). */
	foldable: boolean;
	/** The list offers a filter field. */
	filterable: boolean;
	/** A filter text narrows the list. */
	filtering: boolean;
}

/** The entries a list of `items` shows, unfolded or not, with the filter text `query`. */
export function chipListView(
	items: readonly string[],
	{ expanded, query }: { expanded: boolean; query: string }
): ChipListView {
	const filterable = items.length > CHIP_LIST_FILTER_ABOVE;
	const words = filterable ? searchWords(query) : [];
	if (words.length > 0) {
		const shown = items.filter((item) => {
			const text = normalizeSearch(item);
			return words.every((word) => text.includes(word));
		});
		return { shown, hidden: 0, foldable: false, filterable, filtering: true };
	}
	const foldable = items.length > CHIP_LIST_FOLD_ABOVE;
	const shown = foldable && !expanded ? items.slice(0, CHIP_LIST_SHOWN) : [...items];
	return { shown, hidden: items.length - shown.length, foldable, filterable, filtering: false };
}

/** Visible text of the button of a folded list, e.g. "+ 5 weitere". */
export function moreLabel(hidden: number): string {
	return `+ ${hidden} weitere`;
}

/** What the filter found, e.g. "3 von 24" or "Keine Treffer"; '' without a filter text. */
export function chipListStatus(view: ChipListView, total: number): string {
	if (!view.filtering) return '';
	return view.shown.length === 0 ? 'Keine Treffer' : `${view.shown.length} von ${total}`;
}
