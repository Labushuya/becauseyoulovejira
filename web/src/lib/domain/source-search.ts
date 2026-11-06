// The search over sources (QS-2, ADR-0031 addendum N): the section "Quellen" of a ticket and the
// choice of new entries of the inbox (InboxEntryChoice, in "Quelle hinzufügen …" and "Neues
// Ticket"). Pure. It compares like the ticket picker (ADR-0042, `normalizeSearch` and
// `searchWords`): without case, accents and umlaut dots, "ß" as "ss", and every word must occur,
// each in any field. An entry of the inbox is found by what its row shows and what it says about
// who or where it came from; a source ticket by key and title (`matchesWords` of the picker). The
// text of an entry (`body`) is not loaded for lists and is not searched. Both lists are complete
// in the client (the sources of a ticket up to SOURCES_LIMIT, the new entries in full), so the
// search filters them there and adds no request.
//
// Since EG-2 (ADR-0014 addendum EG-2) the search of the inbox itself uses the same text, plus key
// and title of the ticket a linked entry shows ("→ HAUS-12"): what the row shows is found. The new
// entries are complete in the client; the paged views ask the server with loose patterns
// (`loosePattern`, ADR-0042 §4) for a superset and narrow it exactly here. A word goes to the server
// only if no text that only the client builds can hold it (`inboxServerWords`).

import { withConnectionName } from './connections';
import { CHANNEL_LABELS, linkedTicketOf, metaText, type InboxItemSummary } from './inbox';
import { isPaged } from './paged-list';
import { copiedFrom, sourceChannelLabel, sourceWhen } from './sources';
import { PICKER_SERVER_WORDS, loosePattern, normalizeSearch } from './ticket-picker';

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

/** The fields of an entry the search of the inbox reads (EG-2): those of a source and its ticket. */
export type SearchableInboxItem = SearchableSource &
	Pick<InboxItemSummary, 'state' | 'ticketId' | 'ticket'>;

/**
 * The text of an entry as the search of the inbox compares it (EG-2): the text of a source
 * (`sourceSearchText`) and key and title of the ticket its row shows (`linkedTicketOf`). The text of
 * the entry (`body`) is not searched (decision E1).
 */
export function inboxSearchText(item: SearchableInboxItem, connectionName: string | null): string {
	const text = sourceSearchText(item, connectionName);
	const ticket = linkedTicketOf(item);
	return ticket === null ? text : `${text} ${normalizeSearch(`${ticket.key} ${ticket.title}`)}`;
}

/** True if every word occurs in the text of the entry in the inbox (no words: every entry). */
export function matchesInboxWords(
	item: SearchableInboxItem,
	words: readonly string[],
	connectionName: string | null
): boolean {
	if (words.length === 0) return true;
	const text = inboxSearchText(item, connectionName);
	return words.every((word) => text.includes(word));
}

/**
 * Texts of the search that only the client builds (EG-2): the label of every channel, alone and with
 * the name of every known connection ("Postfach · Gmail Arbeit"), normalised. The server stores
 * neither; the date the row shows is the other such text (see `inboxServerWords`).
 */
export function inboxClientOnlyTexts(connectionNames: readonly string[]): string[] {
	const texts = new Set<string>();
	for (const label of Object.values(CHANNEL_LABELS)) {
		texts.add(normalizeSearch(label));
		for (const name of connectionNames) texts.add(normalizeSearch(withConnectionName(label, name)));
	}
	return [...texts];
}

/**
 * A word that may stand in the date of a row ("24.09.2026 10:30"): it has a digit, or it is made of
 * dots and colons only.
 */
const DATE_WORD = /\d|^[.:]+$/;

/**
 * Printable ASCII only: SQLite LIKE folds the case of ASCII letters only, and `loosePattern` knows
 * the accented forms of ASCII letters only. A word with another character ("øl") stays in the client.
 */
const ASCII_WORD = /^[!-~]+$/;

/**
 * Length of the loose patterns of one request at most. PocketBase refuses a filter longer than 3500
 * characters; `pb.filter` writes each pattern once per field of the search (data/inbox.ts), so the
 * request stays well below that with every other part of the filter.
 */
export const INBOX_PATTERN_BUDGET = 200;

/** Characters a pattern takes in the filter: `pb.filter` writes `'` as `\'`. */
function patternLength(pattern: string): number {
	return pattern.length + (pattern.match(/'/g)?.length ?? 0);
}

/**
 * The words of a search that go to the server as loose patterns (EG-2, ADR-0014 addendum EG-2).
 * Invariant: the server answers a superset of the entries the client finds, so a word goes there
 * only if it cannot match through a text that only the client builds: no word found in a channel
 * label or connection name (`clientOnlyTexts`, from `inboxClientOnlyTexts`), no word that may stand
 * in a date (a digit, or dots and colons only), only ASCII, at most PICKER_SERVER_WORDS words and
 * INBOX_PATTERN_BUDGET characters of patterns. Every other word narrows in the client only; leaving
 * a word out only widens the answer of the server.
 */
export function inboxServerWords(
	words: readonly string[],
	clientOnlyTexts: readonly string[]
): string[] {
	const chosen: string[] = [];
	let room = INBOX_PATTERN_BUDGET;
	for (const word of words) {
		if (chosen.length >= PICKER_SERVER_WORDS) break;
		if (chosen.includes(word) || DATE_WORD.test(word) || !ASCII_WORD.test(word)) continue;
		if (clientOnlyTexts.some((text) => text.includes(word))) continue;
		const length = patternLength(loosePattern(word));
		if (length > room) continue;
		chosen.push(word);
		room -= length;
	}
	return chosen;
}

/**
 * What a search found, next to its field and said aloud: "3 von 12"; with `more` (a paged view of the
 * inbox with further pages, EG-2) "3 von 12+".
 */
export function searchHitsText(hits: number, total: number, more = false): string {
	return `${hits} von ${total}${more ? '+' : ''}`;
}

/** Heading of the empty state of the section: "Keine Quelle passt zu „Rechnung“". */
export function noSourceMatchText(query: string): string {
	return `Keine Quelle passt zu „${query.trim()}“`;
}

/** The choice of new entries without a hit: "Kein Eintrag passt zu „Rechnung“." */
export function noEntryMatchText(query: string): string {
	return `Kein Eintrag passt zu „${query.trim()}“.`;
}

/**
 * Heading of the empty state of the inbox without a hit (EG-2), without a full stop like every
 * heading of an empty state: "Kein Eintrag passt zu „Rechnung“".
 */
export function noEntryMatchTitle(query: string): string {
	return `Kein Eintrag passt zu „${query.trim()}“`;
}
