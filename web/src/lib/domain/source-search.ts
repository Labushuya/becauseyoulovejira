// The search over sources (QS-2, ADR-0031 addendum N): the section "Quellen" of a ticket and the
// choice of new entries of the inbox (InboxEntryChoice, in "Quelle hinzufügen …" and "Neues
// Ticket"). Pure. It compares like the ticket picker (ADR-0042, `normalizeSearch` and
// `searchWords`): without case, accents and umlaut dots, "ß" as "ss", and every word must occur,
// each in any field. An entry of the inbox is found by what its row shows and what it says about
// who or where it came from; a source ticket by key and title (`matchesWords` of the picker). The
// text of an entry (`body`) is not loaded for lists and is not searched. Both lists are complete
// in the client (the sources of a ticket up to SOURCES_LIMIT, the new entries in full), so the
// search filters them there and adds no request.

import { withConnectionName } from './connections';
import { metaText, type InboxItemSummary } from './inbox';
import { isPaged } from './paged-list';
import { copiedFrom, sourceChannelLabel, sourceWhen } from './sources';
import { normalizeSearch } from './ticket-picker';

/** The fields of an entry the search reads. */
export type SearchableSource = Pick<
	InboxItemSummary,
	'title' | 'channel' | 'sourceDate' | 'sourceMeta' | 'sourceUrl' | 'created'
>;

/**
 * Whether the section "Quellen" offers its search: only once there is more than one page of
 * sources (PAGE_SIZE), entries and source tickets counted together like for the switch of the
 * order.
 */
export function hasSourceSearch(total: number): boolean {
	return isPaged(total);
}

/** Who or where an entry came from; its row shows the first of them (`sourceOrigin`). */
const ORIGIN_KEYS = ['from', 'sender', 'chat'] as const;

/**
 * The text of an entry as the search compares it: title, channel with the name of its connection
 * ("Postfach · Gmail Arbeit"), the date the row shows, sender, chat and address, and the key of the
 * ticket a copy came from ("Kopie aus HAUS-12"). `connectionName` is null without one.
 */
export function sourceSearchText(item: SearchableSource, connectionName: string | null): string {
	return normalizeSearch(
		[
			item.title,
			withConnectionName(sourceChannelLabel(item), connectionName),
			sourceWhen(item),
			...ORIGIN_KEYS.map((key) => metaText(item, key)),
			item.sourceUrl,
			copiedFrom(item)?.key ?? ''
		].join(' ')
	);
}

/** True if every word occurs in the text of the entry (no words: every entry). */
export function matchesSourceWords(
	item: SearchableSource,
	words: readonly string[],
	connectionName: string | null
): boolean {
	if (words.length === 0) return true;
	const text = sourceSearchText(item, connectionName);
	return words.every((word) => text.includes(word));
}

/** What a search found, next to its field and said aloud: "3 von 12". */
export function searchHitsText(hits: number, total: number): string {
	return `${hits} von ${total}`;
}

/** Heading of the empty state of the section: "Keine Quelle passt zu „Rechnung“". */
export function noSourceMatchText(query: string): string {
	return `Keine Quelle passt zu „${query.trim()}“`;
}

/** The choice of new entries without a hit: "Kein Eintrag passt zu „Rechnung“." */
export function noEntryMatchText(query: string): string {
	return `Kein Eintrag passt zu „${query.trim()}“.`;
}
