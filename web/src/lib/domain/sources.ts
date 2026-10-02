// Sources of a ticket and what their copy holds (ADR-0031 sections 1, 5 and 7). Pure: the inbox
// items with `ticket = <id>` are the sources, the main source is `tickets.source_item`; the copy
// status says what of the original is stored with the item.

import {
	CHANNEL_LABELS,
	metaText,
	sourceDateText,
	type InboxChannel,
	type InboxItemSummary
} from './inbox';
import { formatBerlinDateTime } from './format';
import { notionContentOf } from './notion';

/**
 * What the copy of a source holds (ADR-0031 section 5); a file of a watched folder is a reference,
 * no copy (ADR-0031, addendum J).
 */
export type CopyCompleteness = 'complete' | 'text' | 'address' | 'too_large' | 'reference';

export const COPY_LABELS: Readonly<Record<CopyCompleteness, string>> = Object.freeze({
	complete: 'Vollständig',
	text: 'Nur Text',
	address: 'Nur Adresse',
	too_large: 'Ohne Originaldatei (zu groß)',
	reference: 'Verweis'
});

/** Channels whose item is the original itself: typed or pasted by the user. */
const TYPED_CHANNELS: readonly InboxChannel[] = ['manual', 'quick', 'clipboard'];

/**
 * Value of `source_meta.original_omitted` for a mail over the limit of the original file (ADR-0031
 * section 4; 25 MB since addendum D, 10 MB before).
 */
export const ORIGINAL_OMITTED_TOO_LARGE = 'too_large';

/**
 * What of the source is stored: the original file (or the typed text itself), only the text (chat
 * messages, mails and events without their file), only the address (a web link without a copy of
 * the page) or a mail without its file because it was larger than the limit of the file. A Notion
 * entry is complete only with its whole content (ADR-0041 §5): a row without its page content or
 * a content cut at a limit is "Nur Text", although the entry keeps what Notion delivered as file.
 */
export function copyCompleteness(
	item: Pick<InboxItemSummary, 'channel' | 'original' | 'sourceMeta'>
): CopyCompleteness {
	if (item.channel === 'folder') return 'reference';
	if (item.sourceMeta.original_omitted === ORIGINAL_OMITTED_TOO_LARGE) return 'too_large';
	const notion = notionContentOf(item);
	if (notion !== null && notion !== 'complete') return 'text';
	if (item.original !== '' || TYPED_CHANNELS.includes(item.channel)) return 'complete';
	return item.channel === 'link' ? 'address' : 'text';
}

/** Size in MB with one decimal, German style ("12,4 MB"); '' without a size. */
function sizeText(value: unknown): string {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
	return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Text of the hint in the panel of an item whose copy is not complete (ADR-0031 section 5), null
 * for a complete copy. Neutral: nothing of it is an error.
 */
export function copyNote(
	item: Pick<InboxItemSummary, 'channel' | 'original' | 'sourceMeta'>
): string | null {
	const notion = notionContentOf(item);
	switch (copyCompleteness(item)) {
		case 'complete':
			return null;
		case 'reference':
			return 'Verweis auf die Datei im Ordner, keine Kopie: „Ansehen“ öffnet ihre aktuelle Fassung. Gespeichert sind nur Name, Pfad, Größe, Zeit, Typ und Prüfsumme.';
		case 'too_large': {
			const size = sizeText(item.sourceMeta.original_size);
			if (notion !== null) {
				return `Was Notion lieferte, war zu groß für die Originaldatei${size === '' ? '' : ` (${size})`}. Gespeichert sind Titel, Datum und Text.`;
			}
			// Neutral about the limit: entries from before addendum D were cut at 10 MB, newer at 25 MB.
			return `Die Mail war zu groß für die Originaldatei${size === '' ? '' : ` (${size})`}. Gespeichert sind Absender, Betreff, Datum und der Anfang des Textes, die Originaldatei nicht.`;
		}
		case 'address':
			return 'Gespeichert sind nur Adresse, Titel und Auszug. Der Inhalt der Seite steht nur unter der Adresse.';
		case 'text':
			if (notion === 'properties') {
				return 'Übernommen sind Titel, Datum und Eigenschaften der Zeile. Den Inhalt ihrer Seite zeigt der Link zu Notion.';
			}
			if (notion === 'truncated') {
				return 'Der Inhalt ist nur bis zur Grenze je Seite übernommen. Vollständig steht er in Notion.';
			}
			if (item.channel === 'github') {
				// ADR-0050 §3 and §4: a pull request or release is its text; a file without a copy was too
				// large, no text or one of too many changes at once.
				return 'Gespeichert ist der Text des Eintrags. Den vollständigen Stand zeigt der Link zu GitHub.';
			}
			return 'Gespeichert ist nur der Text. Bilder, Dateien und Anhänge der Quelle sind nicht Teil der Kopie.';
	}
}

/**
 * Whether "Seiteninhalt sichern" applies (ADR-0031 section 6): a web link of which only the address
 * is stored, in any state. The route refuses anything else; panel and menu "•••" of the inbox row
 * offer it alike.
 */
export function canSavePage(
	item: Pick<InboxItemSummary, 'channel' | 'original' | 'sourceMeta'>
): boolean {
	return copyCompleteness(item) === 'address';
}

/**
 * Whether the entry is the main source of its ticket (tickets.source_item, ADR-0031 section 1), as
 * the ticket loaded with it says (`expand=ticket`); null while that ticket is not known.
 */
export function isMainSource(item: Pick<InboxItemSummary, 'ticketId' | 'ticket'>): boolean | null {
	if (item.ticketId === null || item.ticket?.id !== item.ticketId) return null;
	return item.ticket.primary;
}

/**
 * Whether a linked entry may leave its ticket: "Anderem Ticket zuordnen …" and "Lösen" (ADR-0031
 * section 2 and addendum A). Only a linked entry (converted, with a ticket) known not to be the
 * main source of that ticket (`main` false): the main source stays with the ticket made from it,
 * and while that is unknown (`main` null) neither is offered, because the hook refuses the main
 * source. Section "Quellen" of a ticket, panel and menu "•••" of an inbox row share this rule.
 */
export function canLeaveTicket(
	item: Pick<InboxItemSummary, 'state' | 'ticketId'>,
	main: boolean | null
): boolean {
	return item.state === 'converted' && item.ticketId !== null && main === false;
}

/**
 * When the page of a web link was saved (source_meta.page of the hook, ADR-0031 section 6), as
 * "27.09.2026 21:30" and ", auf 2 MB gekürzt" for a cut page; '' without a page copy.
 */
export function pageCopyText(item: Pick<InboxItemSummary, 'sourceMeta'>): string {
	const page = item.sourceMeta.page;
	if (typeof page !== 'object' || page === null || Array.isArray(page)) return '';
	const { fetched_at: fetchedAt, truncated } = page as Record<string, unknown>;
	if (typeof fetchedAt !== 'string') return '';
	try {
		return `${formatBerlinDateTime(fetchedAt)}${truncated === true ? ', auf 2 MB gekürzt' : ''}`;
	} catch {
		return '';
	}
}

/** Who or where the source came from: sender, chat or address, '' without one. */
export function sourceOrigin(item: Pick<InboxItemSummary, 'sourceMeta' | 'sourceUrl'>): string {
	return (
		metaText(item, 'from') || metaText(item, 'sender') || metaText(item, 'chat') || item.sourceUrl
	);
}

/** Date of a source for the list: the date at the sender, else the arrival in the inbox. */
export function sourceWhen(
	item: Pick<InboxItemSummary, 'sourceDate' | 'sourceMeta' | 'created'>
): string {
	return item.sourceDate === null ? formatBerlinDateTime(item.created) : sourceDateText(item);
}

/** Label of the channel of a source ("Mail-Datei", "Telegram", …). */
export function sourceChannelLabel(item: Pick<InboxItemSummary, 'channel'>): string {
	return CHANNEL_LABELS[item.channel];
}

/**
 * The sources of a ticket in their order: the main source first, then the others as they were
 * linked (oldest first; equal times by ID).
 */
export function orderSources(
	items: readonly InboxItemSummary[],
	mainSource: string | null
): InboxItemSummary[] {
	const when = (item: InboxItemSummary) => item.handledAt ?? item.created;
	return [...items].sort((a, b) => {
		if (a.id === mainSource) return -1;
		if (b.id === mainSource) return 1;
		const byTime = when(a).localeCompare(when(b));
		return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
	});
}

/** Result of linking several items to one ticket: linked ones and failures with their reason. */
export interface LinkOutcome {
	linked: InboxItemSummary[];
	failures: { id: string; title: string; message: string }[];
}

/**
 * What happens to the sources of a ticket that is deleted (ADR-0031, addendum B). They are never
 * deleted with it; "inbox" is the default of every way to delete.
 */
export type SourceHandling = 'inbox' | 'discard';

export const SOURCE_HANDLINGS: readonly SourceHandling[] = Object.freeze(['inbox', 'discard']);

export const SOURCE_HANDLING_LABELS: Readonly<Record<SourceHandling, string>> = Object.freeze({
	inbox: 'Quellen zurück in den Eingang',
	discard: 'Quellen verwerfen'
});

/**
 * What each choice means since the trash (ADR-0037 §6): back to the inbox at once, or along with
 * the ticket into the trash, discarded only when the ticket is deleted for good.
 */
export const SOURCE_HANDLING_HINTS: Readonly<Record<SourceHandling, string>> = Object.freeze({
	inbox: 'Sie stehen sofort wieder als neu im Eingang, mit dem Hinweis auf das gelöschte Ticket.',
	discard:
		'Sie kommen mit in den Papierkorb und mit dem Ticket zurück. Erst beim endgültigen Löschen werden sie verworfen; dieselbe Mail oder Nachricht kommt dann nicht noch einmal herein.'
});

/** "Zu diesem Ticket gehört 1 Quelle." / "… gehören 3 Quellen." */
export function sourceCountText(count: number): string {
	return count === 1
		? 'Zu diesem Ticket gehört 1 Quelle.'
		: `Zu diesem Ticket gehören ${count} Quellen.`;
}

/**
 * Message after deleting a ticket with sources. In the trash (ADR-0037): "HAUS-12 in den
 * Papierkorb verschoben. 2 Quellen sind wieder im Eingang." / "… bleiben beim Ticket.". Before
 * the migration of the trash (`trashed` false): "HAUS-12 wurde gelöscht. …".
 */
export function deletedWithSourcesText(
	key: string,
	count: number,
	handling: SourceHandling,
	trashed = true
): string {
	const moved = trashed ? `${key} in den Papierkorb verschoben.` : `${key} wurde gelöscht.`;
	if (count === 0) return moved;
	if (handling === 'discard') {
		const kept = count === 1 ? '1 Quelle bleibt' : `${count} Quellen bleiben`;
		return trashed
			? `${moved} ${kept} beim Ticket.`
			: `${moved} ${count === 1 ? '1 Quelle ist' : `${count} Quellen sind`} verworfen.`;
	}
	const sources = count === 1 ? '1 Quelle ist' : `${count} Quellen sind`;
	return `${moved} ${sources} wieder im Eingang.`;
}

/**
 * Hint of an entry whose ticket was deleted (source_meta.ticket_deleted of the hook or of the
 * migration 1790201900, ADR-0031 addendum B); null while it belongs to a ticket or without one.
 */
export function deletedTicketNote(
	item: Pick<InboxItemSummary, 'state' | 'sourceMeta'>
): string | null {
	if (item.state === 'converted') return null;
	const note = item.sourceMeta.ticket_deleted;
	if (typeof note !== 'object' || note === null || Array.isArray(note)) return null;
	const { key } = note as Record<string, unknown>;
	const ticket = typeof key === 'string' && key !== '' ? `Ticket ${key}` : 'Das Ticket';
	return item.state === 'discarded'
		? `${ticket} wurde gelöscht; dieser Eintrag war eine Quelle und wurde dabei verworfen.`
		: `${ticket} wurde gelöscht; dieser Eintrag war eine Quelle und ist wieder im Eingang.`;
}

/**
 * ID of the deleted ticket of an entry (source_meta.ticket_deleted.ticket, since the trash,
 * ADR-0037), so the panel can point to the trash; null without one or while it belongs to one.
 */
export function deletedTicketId(
	item: Pick<InboxItemSummary, 'state' | 'sourceMeta'>
): string | null {
	if (item.state === 'converted') return null;
	const note = item.sourceMeta.ticket_deleted;
	if (typeof note !== 'object' || note === null || Array.isArray(note)) return null;
	const { ticket } = note as Record<string, unknown>;
	return typeof ticket === 'string' && /^[a-z0-9]{15}$/.test(ticket) ? ticket : null;
}

/**
 * The ticket a copied source came from (`source_meta.copy_of` of "Kopie der Herkunft übernehmen",
 * ADR-0031 addendum F): its key and, when it is a record ID, its ID for a link; null for any other
 * entry.
 */
export function copiedFrom(
	item: Pick<InboxItemSummary, 'sourceMeta'>
): { key: string; ticket: string | null } | null {
	const note = item.sourceMeta.copy_of;
	if (typeof note !== 'object' || note === null || Array.isArray(note)) return null;
	const { key, ticket } = note as Record<string, unknown>;
	if (typeof key !== 'string' || key === '') return null;
	return {
		key,
		ticket: typeof ticket === 'string' && /^[a-z0-9]{15}$/.test(ticket) ? ticket : null
	};
}

/** Text of the flag after linking: "3 Einträge mit TASK-4 verknüpft." */
export function linkSummary(count: number, ticketKey: string): string {
	return count === 1
		? `1 Eintrag mit ${ticketKey} verknüpft.`
		: `${count} Einträge mit ${ticketKey} verknüpft.`;
}
