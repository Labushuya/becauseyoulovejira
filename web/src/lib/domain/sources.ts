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

/** What the copy of a source holds (ADR-0031 section 5). */
export type CopyCompleteness = 'complete' | 'text' | 'address' | 'too_large';

export const COPY_LABELS: Readonly<Record<CopyCompleteness, string>> = Object.freeze({
	complete: 'Vollständig',
	text: 'Nur Text',
	address: 'Nur Adresse',
	too_large: 'Ohne Originaldatei (zu groß)'
});

/** Channels whose item is the original itself: typed or pasted by the user. */
const TYPED_CHANNELS: readonly InboxChannel[] = ['manual', 'quick', 'clipboard'];

/** Value of `source_meta.original_omitted` for a mail over 10 MB (ADR-0031 section 4). */
export const ORIGINAL_OMITTED_TOO_LARGE = 'too_large';

/**
 * What of the source is stored: the original file (or the typed text itself), only the text (chat
 * messages, mails and events without their file), only the address (a web link without a copy of
 * the page) or a mail without its file because it was larger than 10 MB.
 */
export function copyCompleteness(
	item: Pick<InboxItemSummary, 'channel' | 'original' | 'sourceMeta'>
): CopyCompleteness {
	if (item.sourceMeta.original_omitted === ORIGINAL_OMITTED_TOO_LARGE) return 'too_large';
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
	switch (copyCompleteness(item)) {
		case 'complete':
			return null;
		case 'too_large': {
			const size = sizeText(item.sourceMeta.original_size);
			return `Die Mail war größer als 10 MB${size === '' ? '' : ` (${size})`}. Gespeichert sind Absender, Betreff, Datum und der Anfang des Textes, die Originaldatei nicht.`;
		}
		case 'address':
			return 'Gespeichert sind nur Adresse, Titel und Auszug. Der Inhalt der Seite steht nur unter der Adresse.';
		case 'text':
			return 'Gespeichert ist nur der Text. Bilder, Dateien und Anhänge der Quelle sind nicht Teil der Kopie.';
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

/** Text of the flag after linking: "3 Einträge mit TASK-4 verknüpft." */
export function linkSummary(count: number, ticketKey: string): string {
	return count === 1
		? `1 Eintrag mit ${ticketKey} verknüpft.`
		: `${count} Einträge mit ${ticketKey} verknüpft.`;
}
