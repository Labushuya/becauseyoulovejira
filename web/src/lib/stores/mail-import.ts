// Import of dropped or chosen files (E4 plan, packages 8, 14, 16 and 21; ADR-0020). In two steps:
// prepareDroppedFiles reads every file (mail files in the browser, calendar files through the
// preview of the hook, WhatsApp exports for their own selection view), marks what is in the
// inbox already and what a keyword of the user matches; saveFileSelection then takes only the
// chosen mails and events into the inbox. A file that cannot be read keeps its reason and the
// others go on; a lost session stops the rest. Without runes; the layout passes the data access.

import { CALENDAR_TOO_LARGE_MESSAGE, ICS_MAX_BYTES, isCalendarFile } from '$lib/calendar-file';
import type { CalendarPreview, LookupState } from '$lib/data/inbox';
import { DATA_ERROR_MESSAGES, toDataError } from '$lib/data/errors';
import type { InboxDraft } from '$lib/domain/inbox';
import { restartNeeded } from '$lib/guidance/texts';
import {
	EMPTY_IMPORT_KEYWORDS,
	mailKeywordTexts,
	matchKeyword,
	type ImportKeywords,
	type ImportKind
} from '$lib/domain/keywords';
import type { MailFileResult } from '$lib/mail-file';
import { isWhatsAppFile, type WhatsAppFileResult } from '$lib/whatsapp-file';
import type { CalendarImportResult, InboxCreateResult } from './inbox.svelte';

export type FileImportResult =
	| { name: string; kind: 'created'; itemId: string; title: string }
	| { name: string; kind: 'duplicate'; message: string; itemId: string; ticketId: string }
	| {
			name: string;
			kind: 'calendar';
			created: number;
			duplicates: number;
			skipped: number;
			failed: number;
			/** The only new entry, '' otherwise. */
			itemId: string;
	  }
	| { name: string; kind: 'error'; message: string };

/** One mail or event of the selection view. */
export interface SelectionEntry {
	/** "m:<n>" for a mail, "c:<file>:<index>" for a component of a calendar file. */
	key: string;
	kind: 'mail' | 'event' | 'todo';
	fileName: string;
	title: string;
	/** UTC in PocketBase format or ISO 8601, null without a date. */
	sourceDate: string | null;
	allDay: boolean;
	/** Sender of a mail, or place and "Serie" of an event. */
	detail: string;
	/** Keyword of the user that matches (ADR-0020), '' for none. */
	keyword: string;
	/** Text of the entry in the inbox already ("Schon verworfen."), '' if it is not there. */
	blocked: string;
}

/** What the selection view offers and what saving needs. */
export interface FileSelection {
	entries: SelectionEntry[];
	/** Draft per mail key, with the matching keyword in source_meta. */
	mails: ReadonlyMap<string, { draft: InboxDraft; fileName: string }>;
	/** File and component index per calendar key. */
	calendars: ReadonlyMap<string, { file: File; index: number }>;
	/** Kinds among the entries whose keyword list is empty (nothing of them is chosen at first). */
	withoutKeywords: ImportKind[];
	/** False before the migration of the keyword lists: nothing is chosen at first. */
	keywordsAvailable: boolean;
}

/** A readable chat export waiting for the selection view (E4 plan, package 16). */
export type ChatSelection = Extract<WhatsAppFileResult, { ok: true }>;

export const ONE_CHAT_AT_A_TIME =
	'Nur ein WhatsApp-Chat auf einmal; diesen bitte danach übernehmen.';

/** Shown for a calendar file before the migrations of E4 (answer 503 of the hook). */
const INBOX_UNAVAILABLE = restartNeeded('Der Eingang ist');

export interface PrepareDeps {
	read(file: File): Promise<MailFileResult>;
	readChat(file: File): Promise<WhatsAppFileResult>;
	/** Preview of an .ics file; throws on failure (data layer). */
	previewCalendar(file: File): Promise<CalendarPreview>;
	/** Whether mail drafts are in the inbox already; throws on failure (data layer). */
	lookup(drafts: readonly InboxDraft[]): Promise<LookupState[]>;
	/** Keyword lists of the user, null before their migration; throws on failure. */
	keywords(): Promise<ImportKeywords | null>;
	/** Called when the session is lost (the layout logs out). */
	onSessionLost(): void;
}

export interface PreparedFiles {
	/** Files that could not be read, with their reason. */
	results: FileImportResult[];
	/** Mails and events to choose from, null if there is none. */
	selection: FileSelection | null;
	chat: ChatSelection | null;
	keywords: ImportKeywords;
}

class SessionLost extends Error {}

/** Text of a failure of the data layer; a lost session stops the whole preparation. */
function failureMessage(error: unknown): string {
	const failure = toDataError(error);
	if (failure.kind === 'session') throw new SessionLost();
	if (failure.status === 503) return INBOX_UNAVAILABLE;
	return failure.message;
}

function withKeyword(draft: InboxDraft, keyword: string): InboxDraft {
	if (keyword === '') return draft;
	return { ...draft, sourceMeta: { ...(draft.sourceMeta ?? {}), keyword } };
}

function senderOf(draft: InboxDraft): string {
	const from = draft.sourceMeta?.from;
	return typeof from === 'string' ? from : '';
}

/**
 * Reads dropped or chosen files for the selection views. WhatsApp exports (.txt, .zip): only the
 * first one, for its own view. Calendar files over 20 MB and files that are no mail are refused
 * with their reason. What is in the inbox already stays visible but cannot be chosen.
 */
export async function prepareDroppedFiles(
	files: readonly File[],
	deps: PrepareDeps
): Promise<PreparedFiles> {
	const results: FileImportResult[] = [];
	const entries: SelectionEntry[] = [];
	const mails = new Map<string, { draft: InboxDraft; fileName: string }>();
	const calendars = new Map<string, { file: File; index: number }>();
	let chat: ChatSelection | null = null;
	let keywords: ImportKeywords = EMPTY_IMPORT_KEYWORDS;
	let keywordsAvailable = true;
	let current = '';

	try {
		try {
			const loaded = await deps.keywords();
			if (loaded === null) keywordsAvailable = false;
			else keywords = loaded;
		} catch (error) {
			// Without the lists nothing is chosen at first; the files can still be chosen by hand.
			failureMessage(error);
			keywordsAvailable = false;
		}

		const mailEntries: { entry: SelectionEntry; draft: InboxDraft }[] = [];
		let fileNo = 0;
		for (const file of files) {
			fileNo += 1;
			const name = file.name;
			current = name;
			if (isWhatsAppFile(file)) {
				if (chat !== null) {
					results.push({ name, kind: 'error', message: ONE_CHAT_AT_A_TIME });
					continue;
				}
				const read = await deps.readChat(file);
				if (read.ok) chat = read;
				else results.push({ name, kind: 'error', message: read.message });
				continue;
			}
			if (isCalendarFile(file)) {
				if (file.size > ICS_MAX_BYTES) {
					results.push({ name, kind: 'error', message: CALENDAR_TOO_LARGE_MESSAGE });
					continue;
				}
				let preview: CalendarPreview;
				try {
					preview = await deps.previewCalendar(file);
				} catch (error) {
					results.push({ name, kind: 'error', message: failureMessage(error) });
					continue;
				}
				if (preview.items.length === 0) {
					results.push({
						name,
						kind: 'calendar',
						created: 0,
						duplicates: 0,
						skipped: preview.skipped,
						failed: 0,
						itemId: ''
					});
					continue;
				}
				for (const item of preview.items) {
					const key = `c:${fileNo}:${item.index}`;
					calendars.set(key, { file, index: item.index });
					entries.push({
						key,
						kind: item.kind,
						fileName: name,
						title: item.title,
						sourceDate: item.sourceDate,
						allDay: item.allDay,
						detail: [item.location, item.series ? 'Serie' : ''].filter(Boolean).join(' · '),
						keyword: keywordsAvailable ? item.keyword : '',
						blocked: item.state === '' ? '' : item.message
					});
				}
				continue;
			}
			const read = await deps.read(file);
			if (!read.ok) {
				results.push({ name, kind: 'error', message: read.message });
				continue;
			}
			const keyword = matchKeyword(
				keywords.eml.keywords,
				mailKeywordTexts(read.draft.title, read.draft.body ?? '', keywords.eml.matchBody)
			);
			const key = `m:${fileNo}`;
			const draft = withKeyword(read.draft, keyword);
			const entry: SelectionEntry = {
				key,
				kind: 'mail',
				fileName: name,
				title: draft.title,
				sourceDate: draft.sourceDate ?? null,
				allDay: false,
				detail: senderOf(draft),
				keyword,
				blocked: ''
			};
			mails.set(key, { draft, fileName: name });
			mailEntries.push({ entry, draft });
			entries.push(entry);
		}

		if (mailEntries.length > 0) {
			try {
				const states = await deps.lookup(mailEntries.map((mail) => mail.draft));
				mailEntries.forEach(({ entry }, i) => {
					const state = states[i];
					if (state !== undefined && state.state !== '') entry.blocked = state.message;
				});
			} catch (error) {
				// Unknown: saving reports a duplicate as "schon vorhanden".
				failureMessage(error);
			}
		}
	} catch (error) {
		if (!(error instanceof SessionLost)) throw error;
		deps.onSessionLost();
		return {
			results: [
				...results,
				{ name: current || 'Dateien', kind: 'error', message: DATA_ERROR_MESSAGES.session }
			],
			selection: null,
			chat: null,
			keywords
		};
	}

	const kinds = new Set<ImportKind>();
	for (const entry of entries) kinds.add(entry.kind === 'mail' ? 'eml' : 'ics');
	const withoutKeywords = [...kinds].filter((kind) => keywords[kind].keywords.length === 0);
	return {
		results,
		selection:
			entries.length === 0
				? null
				: { entries, mails, calendars, withoutKeywords, keywordsAvailable },
		chat,
		keywords
	};
}

/** Keys of the entries chosen at first: keyword matches that are not in the inbox yet. */
export function preselectedKeys(selection: FileSelection): string[] {
	return selection.entries
		.filter((entry) => entry.keyword !== '' && entry.blocked === '')
		.map((entry) => entry.key);
}

export interface SaveDeps {
	createItem(draft: InboxDraft): Promise<InboxCreateResult>;
	importCalendar(file: File, select: readonly number[]): Promise<CalendarImportResult>;
}

/**
 * Saves the chosen entries: each mail as its own entry, the chosen components of each calendar
 * file in one request. One result per mail and per calendar file; a lost session stops the rest.
 */
export async function saveFileSelection(
	selection: FileSelection,
	chosen: ReadonlySet<string>,
	deps: SaveDeps
): Promise<FileImportResult[]> {
	const results: FileImportResult[] = [];
	const perFile = new Map<File, number[]>();
	for (const entry of selection.entries) {
		if (!chosen.has(entry.key) || entry.blocked !== '') continue;
		const calendar = selection.calendars.get(entry.key);
		if (calendar !== undefined) {
			perFile.set(calendar.file, [...(perFile.get(calendar.file) ?? []), calendar.index]);
			continue;
		}
		const mail = selection.mails.get(entry.key);
		if (mail === undefined) continue;
		const name = mail.fileName;
		const saved = await deps.createItem(mail.draft);
		if (saved.kind === 'created') {
			results.push({ name, kind: 'created', itemId: saved.item.id, title: saved.item.title });
		} else if (saved.kind === 'duplicate') {
			results.push({
				name,
				kind: 'duplicate',
				message: saved.message,
				itemId: saved.itemId,
				ticketId: saved.ticketId
			});
		} else {
			const fields = Object.values(saved.fields);
			const message = saved.message ?? (fields.length > 0 ? fields.join(' ') : null);
			if (message === null) {
				results.push({ name, kind: 'error', message: DATA_ERROR_MESSAGES.session });
				return results;
			}
			results.push({ name, kind: 'error', message });
		}
	}
	for (const [file, select] of perFile) {
		const outcome = await deps.importCalendar(file, select);
		if (outcome.kind === 'error') {
			if (outcome.message === null) {
				results.push({ name: file.name, kind: 'error', message: DATA_ERROR_MESSAGES.session });
				return results;
			}
			results.push({ name: file.name, kind: 'error', message: outcome.message });
			continue;
		}
		const { created, duplicates, skipped, failed, itemId } = outcome;
		results.push({
			name: file.name,
			kind: 'calendar',
			created,
			duplicates,
			skipped,
			failed,
			itemId
		});
	}
	return results;
}

type Counts = Pick<
	Extract<FileImportResult, { kind: 'calendar' }>,
	'created' | 'duplicates' | 'skipped' | 'failed'
>;

/** "3 neu, 1 schon vorhanden, 1 übersprungen" (E4 plan, package 14); zero counts are left out. */
export function importCounts({ created, duplicates, skipped, failed }: Counts): string {
	const parts = [`${created} neu`];
	if (duplicates > 0) parts.push(`${duplicates} schon vorhanden`);
	if (skipped > 0) parts.push(`${skipped} übersprungen`);
	if (failed > 0) parts.push(`${failed} mit Fehler`);
	return parts.join(', ');
}

/**
 * Text for the live region, e.g. "2 neu, 1 schon vorhanden, 1 mit Fehler." A calendar file adds
 * its entries to the counts and its skipped (cancelled) events as "übersprungen".
 */
export function importSummary(results: readonly FileImportResult[]): string {
	const counts: Counts = { created: 0, duplicates: 0, skipped: 0, failed: 0 };
	for (const result of results) {
		if (result.kind === 'created') counts.created += 1;
		else if (result.kind === 'duplicate') counts.duplicates += 1;
		else if (result.kind === 'error') counts.failed += 1;
		else {
			counts.created += result.created;
			counts.duplicates += result.duplicates;
			counts.skipped += result.skipped;
			counts.failed += result.failed;
		}
	}
	return `${importCounts(counts)}.`;
}
