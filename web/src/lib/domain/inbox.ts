// Domain of the inbox (ADR-0014; E4 plan, package 2). Pure: the data layer maps the records of
// inbox_items to these types. The value lists mirror app/pb_hooks/lib/source.js
// (tests/unit/source.test.mjs keeps them equal).

import { isCalendarDate, type CalendarDate } from './berlin-date';
import { berlinDateOf, formatBerlinDateTime, formatCalendarDate } from './format';
import { isPriority, type Priority } from './status';
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH, type TicketSummary } from './ticket';

/** Ways into the inbox; also the values of `tickets.source`. */
export const INBOX_CHANNELS = [
	'manual',
	'quick',
	'clipboard',
	'link',
	'eml',
	'mail',
	'ics',
	'calendar',
	'whatsapp',
	'telegram',
	'notion'
] as const;
export type InboxChannel = (typeof INBOX_CHANNELS)[number];

/** Kind of object: steers presets and the symbol only, never a ticket type (ADR-0012). */
export const INBOX_KINDS = [
	'todo',
	'task',
	'project_task',
	'mail',
	'event',
	'message',
	'link'
] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const INBOX_STATES = ['new', 'converted', 'discarded'] as const;
export type InboxState = (typeof INBOX_STATES)[number];

/** States of the entries that were decided on; they are loaded page by page (T-4). */
export type HandledState = Exclude<InboxState, 'new'>;

/** Length limits of the schema (1790201200_create_inbox_items.js). */
export const INBOX_TITLE_MAX_LENGTH = 200;
export const INBOX_BODY_MAX_LENGTH = 100_000;
export const INBOX_SOURCE_URL_MAX_LENGTH = 2000;

/**
 * Days a discarded entry keeps its content (OF-E4-6, E4 plan package 24); mirrors
 * DISCARDED_RETENTION_DAYS of app/pb_hooks/lib/inbox-cleanup.js (tests/unit/inbox-cleanup.test.mjs).
 */
export const DISCARDED_RETENTION_DAYS = 30;

/** Neutral note in the panel of a discarded entry. */
export const DISCARDED_CONTENT_NOTE = `Verworfene Einträge behalten ihren Inhalt ${DISCARDED_RETENTION_DAYS} Tage. Danach bleiben nur ein gekürzter Titel, Quelle, Datum und das Duplikatmerkmal, damit derselbe Eintrag nicht wiederkommt. Wiederherstellen geht auch dann.`;

/**
 * The address as a link of a source may keep it (ADR-0011 section 2, like the hook in
 * app/pb_hooks/lib/inbox-rules.js): http or https, no whitespace, a host, at most
 * INBOX_SOURCE_URL_MAX_LENGTH characters; trimmed. Null for anything else (javascript:, data:,
 * file:, relative addresses).
 */
export function httpUrlOf(value: string): string | null {
	const url = value.trim();
	if (url.length > INBOX_SOURCE_URL_MAX_LENGTH || !/^https?:\/\/[^\s]+$/i.test(url)) return null;
	try {
		const parsed = new URL(url);
		return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== ''
			? url
			: null;
	} catch {
		return null;
	}
}

export const CHANNEL_LABELS: Readonly<Record<InboxChannel, string>> = Object.freeze({
	manual: 'Formular',
	quick: 'Schnellerfassung',
	clipboard: 'Zwischenablage',
	link: 'Web-Link',
	eml: 'Mail-Datei',
	mail: 'Postfach',
	ics: 'Kalenderdatei',
	calendar: 'Google Calendar',
	whatsapp: 'WhatsApp',
	telegram: 'Telegram',
	notion: 'Notion'
});

export const KIND_LABELS: Readonly<Record<InboxKind, string>> = Object.freeze({
	todo: 'To-do',
	task: 'Aufgabe',
	project_task: 'Projektaufgabe',
	mail: 'Mail',
	event: 'Termin',
	message: 'Nachricht',
	link: 'Web-Link'
});

export const STATE_LABELS: Readonly<Record<InboxState, string>> = Object.freeze({
	new: 'Neu',
	converted: 'Umgewandelt',
	discarded: 'Verworfen'
});

export function isInboxChannel(value: unknown): value is InboxChannel {
	return typeof value === 'string' && (INBOX_CHANNELS as readonly string[]).includes(value);
}

export function isInboxKind(value: unknown): value is InboxKind {
	return typeof value === 'string' && (INBOX_KINDS as readonly string[]).includes(value);
}

export function isInboxState(value: unknown): value is InboxState {
	return typeof value === 'string' && (INBOX_STATES as readonly string[]).includes(value);
}

/** Entry of the inbox as lists show it (without the text). */
export interface InboxItemSummary {
	id: string;
	channel: InboxChannel;
	kind: InboxKind;
	title: string;
	/** http(s) link of the source, '' without one. */
	sourceUrl: string;
	/** Stable ID at the sender (Message-ID, UID, chat and message ID), '' without one. */
	sourceRef: string;
	/** Time at the sender (UTC, PocketBase format), null without one. Never the due date (P-5). */
	sourceDate: string | null;
	/** Channel details without their own field: sender, place, end, chat name (ADR-0014). */
	sourceMeta: Readonly<Record<string, unknown>>;
	/** File name of the protected original, '' without one. */
	original: string;
	state: InboxState;
	/** Ticket the entry became or was assigned to; null otherwise or after the ticket was deleted. */
	ticketId: string | null;
	/** Time of converting or discarding, null while new. */
	handledAt: string | null;
	created: string;
	updated: string;
}

/** Entry with its text (panel, prefill of the ticket). */
export interface InboxItem extends InboxItemSummary {
	/** Plain text or Markdown; shown sanitised only (ADR-0008). */
	body: string;
}

/** What a way into the inbox sends; the hook sets scope, state and fingerprint. */
export interface InboxDraft {
	channel: InboxChannel;
	kind: InboxKind;
	title: string;
	body?: string;
	sourceUrl?: string;
	sourceRef?: string;
	/** UTC in PocketBase format or ISO 8601. */
	sourceDate?: string | null;
	sourceMeta?: Record<string, unknown>;
	/** Original file (.eml, .ics excerpt), at most 10 MB. */
	original?: Blob & { name?: string };
}

/**
 * Answer of the server that the object is in the inbox already (ADR-0014 section 3), with the
 * state of the existing entry and the key of its ticket: "schon im Eingang", "schon verworfen",
 * "schon Ticket HAUS-12".
 */
export interface InboxDuplicate {
	kind: 'duplicate';
	state: InboxState;
	/** ID of the existing entry, '' if the server did not name it. */
	itemId: string;
	/** Ticket of the existing entry, '' without one. */
	ticketId: string;
	ticketKey: string;
	/** German text, from duplicateMessage(). */
	message: string;
}

/**
 * Text of a duplicate (ADR-0014 section 3), the same as the hook writes
 * (app/pb_hooks/lib/inbox-rules.js): "Schon im Eingang.", "Schon verworfen.",
 * "Schon Ticket HAUS-12." and without the ticket "Schon umgewandelt.".
 */
export function duplicateMessage(state: InboxState, ticketKey: string): string {
	if (state === 'discarded') return 'Schon verworfen.';
	if (state === 'converted') {
		return ticketKey === '' ? 'Schon umgewandelt.' : `Schon Ticket ${ticketKey}.`;
	}
	return 'Schon im Eingang.';
}

/**
 * Title as the soft duplicate check compares it (ADR-0014 section 3): trimmed, lower case,
 * whitespace runs as one space. Umlauts stay what they are ("Äpfel" and "Apfel" differ).
 */
export function normalizeTitle(title: string): string {
	return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Possible duplicates of an entry: open tickets and other new entries with the same title. */
export interface SoftDuplicates {
	tickets: TicketSummary[];
	items: InboxItemSummary[];
}

/**
 * Soft duplicate check in the client (ADR-0014 section 3): open tickets and other new entries
 * whose normalised title equals the one of `item`. Done tickets and handled entries do not
 * count; the entry itself is left out. An empty title matches nothing.
 */
export function findSoftDuplicates(
	item: Pick<InboxItemSummary, 'id' | 'title'>,
	openTickets: readonly TicketSummary[],
	newItems: readonly InboxItemSummary[]
): SoftDuplicates {
	const title = normalizeTitle(item.title);
	if (title === '') return { tickets: [], items: [] };
	return {
		tickets: openTickets.filter(
			(ticket) => ticket.status !== 'done' && normalizeTitle(ticket.title) === title
		),
		items: newItems.filter(
			(other) =>
				other.id !== item.id && other.state === 'new' && normalizeTitle(other.title) === title
		)
	};
}

/** Newest first, then by ID, so equal times keep a fixed order (T-4: newest first). */
export function compareNewest(a: InboxItemSummary, b: InboxItemSummary): number {
	if (a.created !== b.created) return a.created < b.created ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Server order of handled entries: most recently handled first (`-handled_at,-created,-id`).
 */
export function compareHandled(a: InboxItemSummary, b: InboxItemSummary): number {
	const keys: [string, string][] = [
		[b.handledAt ?? '', a.handledAt ?? ''],
		[b.created, a.created],
		[b.id, a.id]
	];
	for (const [left, right] of keys) {
		if (left !== right) return left < right ? -1 : 1;
	}
	return 0;
}

/** Text of a detail in `sourceMeta` (sender, place, chat), '' if missing or not text. */
export function metaText(item: Pick<InboxItemSummary, 'sourceMeta'>, key: string): string {
	const value = item.sourceMeta[key];
	return typeof value === 'string' ? value.trim() : '';
}

/**
 * Date at the sender as text: an all-day date (`source_meta.all_day`, e.g. an all-day event of an
 * .ics file) without a time, everything else as Berlin date and time; '' without a date.
 */
export function sourceDateText(item: Pick<InboxItemSummary, 'sourceDate' | 'sourceMeta'>): string {
	if (item.sourceDate === null) return '';
	return item.sourceMeta.all_day === true
		? formatCalendarDate(berlinDateOf(item.sourceDate))
		: formatBerlinDateTime(item.sourceDate);
}

/** Markdown characters of a value from a source, escaped so they show as typed. */
export function escapeMarkdown(value: string): string {
	return value.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, (character) => `\\${character}`);
}

/** Header lines of the description per kind (T-5): sender and date of a mail and so on. */
function headerLines(item: InboxItem): string[] {
	const date = sourceDateText(item);
	const from = (key: string) => escapeMarkdown(metaText(item, key));
	const lines: [string, string][] =
		item.kind === 'mail'
			? [
					['Von', from('from')],
					['Datum', date]
				]
			: item.kind === 'event'
				? [
						['Beginn', date],
						['Ort', from('location')]
					]
				: item.kind === 'message'
					? [
							['Von', from('sender')],
							['Chat', from('chat')],
							['Zeit', date]
						]
					: [];
	const header = lines
		.filter(([, value]) => value !== '')
		.map(([label, value]) => `- **${label}:** ${value}`);
	if (item.sourceUrl !== '') header.push(`- **Link:** <${item.sourceUrl}>`);
	return header;
}

/**
 * Key in `sourceMeta` under which an entry typed in by the user (capture form, quick entry) keeps
 * the ticket values chosen there: project, tags, priority and due date. Converting the entry
 * offers them again (E4 plan, T-5: project and tags from the template).
 */
export const PRESET_META_KEY = 'preset';

/** Ticket values chosen when an entry was typed in; empty for every other entry. */
export interface TicketPreset {
	project: string | null;
	tagIds: string[];
	priority: Priority | null;
	/** Due date the user typed in; never a date at the sender (P-5). */
	due: CalendarDate | null;
}

export const EMPTY_PRESET: Readonly<TicketPreset> = Object.freeze({
	project: null,
	tagIds: [],
	priority: null,
	due: null
});

/** Channels whose entries the user typed in; only they carry a preset. */
const PRESET_CHANNELS: readonly InboxChannel[] = ['manual', 'quick'];

const RECORD_ID = /^[a-z0-9]{15}$/;

/** `sourceMeta` value of a preset; empty parts are left out. */
export function presetMeta(preset: TicketPreset): Record<string, unknown> {
	const meta: Record<string, unknown> = {};
	if (preset.project !== null) meta.project = preset.project;
	if (preset.tagIds.length > 0) meta.tags = [...preset.tagIds];
	if (preset.priority !== null) meta.priority = preset.priority;
	if (preset.due !== null) meta.due = preset.due;
	return meta;
}

/**
 * Preset of an entry the user typed in (channels manual and quick). Values that are no record ID,
 * priority or calendar date are dropped, so a changed or foreign value never reaches the form.
 */
export function presetOf(item: Pick<InboxItemSummary, 'channel' | 'sourceMeta'>): TicketPreset {
	const raw = item.sourceMeta[PRESET_META_KEY];
	if (!PRESET_CHANNELS.includes(item.channel) || typeof raw !== 'object' || raw === null) {
		return { ...EMPTY_PRESET, tagIds: [] };
	}
	const value = raw as Record<string, unknown>;
	const id = (entry: unknown) => typeof entry === 'string' && RECORD_ID.test(entry);
	return {
		project: id(value.project) ? (value.project as string) : null,
		tagIds: Array.isArray(value.tags) ? [...new Set(value.tags.filter(id) as string[])] : [],
		priority: isPriority(value.priority) ? value.priority : null,
		due: typeof value.due === 'string' && isCalendarDate(value.due) ? value.due : null
	};
}

/** Values of the form "Neues Ticket" taken from an inbox entry (E4 plan, T-5). */
export interface TicketPrefill {
	title: string;
	/** Header lines of the source, then the text of the entry (Markdown). */
	description: string;
	/**
	 * Time at the sender. It is only a hint with "Als Fälligkeit übernehmen": the source date never
	 * becomes the due date by itself (P-5).
	 */
	sourceDate: string | null;
	/** Values the user chose when typing the entry in; empty for entries from a source. */
	preset: TicketPreset;
}

/**
 * Prefill of a ticket from an inbox entry (T-5): the title, and as description the header of the
 * source (mail: "Von", "Datum"; event: "Beginn", "Ort"; message: "Von", "Chat", "Zeit"; a link of
 * the source) followed by the text, cut to the limits of the ticket. Status and priority stay
 * with the defaults of the form unless the user chose them when typing the entry in (preset).
 */
export function ticketPrefill(item: InboxItem): TicketPrefill {
	const header = headerLines(item);
	const body = item.body.trim();
	const parts = [header.join('\n'), body].filter((part) => part !== '');
	return {
		title: item.title.slice(0, TITLE_MAX_LENGTH),
		description: parts.join('\n\n').slice(0, DESCRIPTION_MAX_LENGTH),
		sourceDate: item.sourceDate,
		preset: presetOf(item)
	};
}
