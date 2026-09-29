// Notion import (ADR-0041, plan notion-import NI-2): types of the answers of the routes under
// /api/byl/connections/{id}/notion/… and the pure rules of the dialog, the card and "Erneut
// abrufen": what may be chosen, what is chosen at first, the batches of an import and the texts of
// results. Notion is only read; entries are copies in the inbox.

import { formatCount } from './connections';
import type { InboxItemSummary, InboxState } from './inbox';

export const NOTION_SOURCE_TYPES = ['data_source', 'page'] as const;
export type NotionSourceType = (typeof NOTION_SOURCE_TYPES)[number];

export const NOTION_SOURCE_TYPE_LABELS: Readonly<Record<NotionSourceType, string>> = Object.freeze({
	data_source: 'Datenbank',
	page: 'Seite'
});

export function isNotionSourceType(value: unknown): value is NotionSourceType {
	return typeof value === 'string' && (NOTION_SOURCE_TYPES as readonly string[]).includes(value);
}

/** A shared data source or page of the search. */
export interface NotionSource {
	id: string;
	type: NotionSourceType;
	title: string;
	/** Address of the page or database in Notion. */
	url: string;
	/** Last edit in Notion (ISO), null if unknown. */
	edited: string | null;
}

export interface NotionSourceList {
	sources: NotionSource[];
	/** More shared sources than the list holds; the search narrows by title. */
	truncated: boolean;
}

/** A source taken over before, with what the inbox knows about it. */
export interface NotionImportedSource {
	id: string;
	type: NotionSourceType;
	title: string;
	url: string;
	/** Entries in the inbox (new, linked or discarded within the last 30 days). */
	count: number;
	/** Arrival of the newest entry (PocketBase date), null if unknown. */
	last: string | null;
	/** Date property of the last import ('' for none or for a page). */
	dateProperty: string;
	/** Whether the last import copied the page content of rows. */
	copyContent: boolean;
}

/** Limits of the server that the dialog names. */
export interface NotionLimits {
	maxRows: number;
	importBatch: number;
	contentBlocks: number;
	contentChars: number;
	/** Blocks read of a page with lists. */
	treeBlocks: number;
}

export const NOTION_DEFAULT_LIMITS: Readonly<NotionLimits> = Object.freeze({
	maxRows: 1000,
	importBatch: 100,
	contentBlocks: 500,
	contentChars: 50_000,
	treeBlocks: 5000
});

/** One entry of the preview: a row of a database or a point of a list. */
export interface NotionPreviewItem {
	/** Notion ID of the page or block. */
	ref: string;
	kind: 'task' | 'todo';
	title: string;
	/** Date of the entry (UTC, PocketBase format), null without one. */
	sourceDate: string | null;
	allDay: boolean;
	excerpt: string;
	/** Heading or toggle above a point, '' without one. */
	section: string;
	done: boolean;
	url: string;
	/** State of the entry in the inbox, '' if it is not there. */
	state: InboxState | '';
	/** "Schon im Eingang." and the like, '' if it is not there. */
	message: string;
}

export interface NotionPreview {
	source: Omit<NotionSource, 'edited'>;
	/** Date properties of a database in the order of its schema; [] for a page. */
	dateProperties: string[];
	/** The date property of the preview, '' for none. */
	dateProperty: string;
	items: NotionPreviewItem[];
	/** The source holds more than the server reads (rows or blocks). */
	truncated: boolean;
	/** Points without text on a page, left out. */
	blankPoints: number;
	limits: NotionLimits;
}

export type NotionImportStatus = 'created' | 'duplicate' | 'skipped' | 'failed';

export interface NotionImportResult {
	ref: string;
	status: NotionImportStatus;
	message: string;
}

export interface NotionImportCounts {
	created: number;
	duplicates: number;
	skipped: number;
	failed: number;
}

export const NO_COUNTS: Readonly<NotionImportCounts> = Object.freeze({
	created: 0,
	duplicates: 0,
	skipped: 0,
	failed: 0
});

/** Answer of "Verbindung prüfen". */
export interface NotionCheck {
	workspace: string;
	bot: string;
	/** Whether the integration sees at least one page or database. */
	shared: boolean;
}

/**
 * Answer of a route: the value, missing access data, a paused connection, or an error of Notion
 * with its message; `reason` "connection" (token, rights) or "source" (this page or database).
 */
export type NotionOutcome<T> =
	| { kind: 'ok'; value: T }
	| {
			kind: 'missing' | 'disabled' | 'error';
			message: string;
			reason: 'connection' | 'source' | '';
	  };

/** What an import sends; the server reads the source itself and takes only the IDs. */
export interface NotionImportRequest {
	source: { type: NotionSourceType; id: string };
	refs: readonly string[];
	skipDone: boolean;
	copyContent: boolean;
	/** null: the server takes the first date property; '': none. */
	dateProperty: string | null;
}

/** Why an entry cannot be chosen: it is in the inbox already, or done and skipped; else ''. */
export function blockedReason(
	item: Pick<NotionPreviewItem, 'state' | 'message' | 'done'>,
	skipDone: boolean
): string {
	if (item.state !== '') return item.message || 'Schon im Eingang.';
	return skipDone && item.done ? 'Erledigt, wird übersprungen.' : '';
}

/** Chosen at first: every entry that is not in the inbox (and not done while done ones are skipped). */
export function preselectedRefs(items: readonly NotionPreviewItem[], skipDone: boolean): string[] {
	return items.filter((item) => blockedReason(item, skipDone) === '').map((item) => item.ref);
}

/**
 * Entries per import request: the limit of the server, but at most 10 while the page content comes
 * along, because each row may then take up to 40 requests to Notion at about 3 per second.
 */
export function importBatchSize(
	limits: Pick<NotionLimits, 'importBatch'>,
	withContent: boolean
): number {
	return withContent ? Math.min(10, limits.importBatch) : limits.importBatch;
}

/** `list` in parts of at most `size` (at least 1). */
export function batches<T>(list: readonly T[], size: number): T[][] {
	const step = Math.max(1, Math.floor(size));
	const result: T[][] = [];
	for (let start = 0; start < list.length; start += step)
		result.push(list.slice(start, start + step));
	return result;
}

export function addCounts(a: NotionImportCounts, b: NotionImportCounts): NotionImportCounts {
	return {
		created: a.created + b.created,
		duplicates: a.duplicates + b.duplicates,
		skipped: a.skipped + b.skipped,
		failed: a.failed + b.failed
	};
}

/** Counts as text, e.g. "3 angelegt, 2 schon vorhanden, 1 übersprungen, 1 mit Fehler". */
export function countsText(counts: NotionImportCounts): string {
	const parts = [`${formatCount(counts.created)} angelegt`];
	if (counts.duplicates > 0) parts.push(`${formatCount(counts.duplicates)} schon vorhanden`);
	if (counts.skipped > 0) parts.push(`${formatCount(counts.skipped)} übersprungen`);
	if (counts.failed > 0) parts.push(`${formatCount(counts.failed)} mit Fehler`);
	return parts.join(', ');
}

/**
 * Flag after "Erneut abrufen" of a source: the new entries in the title; an error only when
 * nothing came in and entries failed (ADR-0009).
 */
export function refetchText(
	title: string,
	counts: NotionImportCounts
): { text: string; tone: 'success' | 'info' | 'error' } {
	const name = `„${title}“`;
	if (counts.created === 0 && counts.failed > 0) {
		return { text: `${name}: ${countsText(counts)}.`, tone: 'error' };
	}
	if (counts.created === 0) {
		return { text: `${name}: keine neuen Einträge.`, tone: 'info' };
	}
	return { text: `${name}: ${countsText(counts)}.`, tone: 'success' };
}

/** The limits as one sentence for the dialog. */
export function limitsText(limits: NotionLimits): string {
	return `Seiteninhalt höchstens ${formatCount(limits.contentBlocks)} Blöcke und ${formatCount(limits.contentChars)} Zeichen je Seite, sonst gekürzt mit Hinweis; höchstens ${formatCount(limits.maxRows)} Zeilen je Datenbank.`;
}

/** Why a preview shows only the start of its source. */
export function truncatedText(limits: NotionLimits, type: NotionSourceType): string {
	const limit =
		type === 'data_source'
			? `${formatCount(limits.maxRows)} Zeilen je Datenbank`
			: `${formatCount(limits.treeBlocks)} Blöcke je Seite`;
	return `Die Quelle ist größer als die Grenze der App (höchstens ${limit}); gezeigt ist der Anfang.`;
}

/** Line "Übernommen" of the card, e.g. "12 Einträge aus 2 Quellen". */
export function importedSummary(imports: readonly NotionImportedSource[]): string {
	if (imports.length === 0) return 'noch nichts';
	const entries = imports.reduce((sum, entry) => sum + entry.count, 0);
	const entryText = entries === 1 ? '1 Eintrag' : `${formatCount(entries)} Einträge`;
	const sourceText = imports.length === 1 ? '1 Quelle' : `${imports.length} Quellen`;
	return `${entryText} aus ${sourceText}`;
}

/** Result of "Verbindung prüfen" as text of a section message. */
export function checkText(check: NotionCheck): string {
	const where =
		check.workspace === ''
			? 'Verbunden mit Notion'
			: `Verbunden mit dem Arbeitsbereich „${check.workspace}“`;
	const who = check.bot === '' ? '' : ` als „${check.bot}“`;
	return check.shared
		? `${where}${who}. Die Integration sieht freigegebene Seiten.`
		: `${where}${who}. Sie sieht aber noch keine Seite: in Notion eine Seite oder Datenbank freigeben.`;
}

/** Where a Notion entry of the inbox came from, e.g. "Wochenplan (Seite), Abschnitt „Einkauf“". */
export function notionOriginText(item: Pick<InboxItemSummary, 'channel' | 'sourceMeta'>): string {
	if (item.channel !== 'notion') return '';
	const notion = item.sourceMeta.notion;
	if (typeof notion !== 'object' || notion === null || Array.isArray(notion)) return '';
	const meta = notion as Record<string, unknown>;
	const title = typeof meta.source_title === 'string' ? meta.source_title.trim() : '';
	if (title === '') return '';
	const type = isNotionSourceType(meta.source_type)
		? ` (${NOTION_SOURCE_TYPE_LABELS[meta.source_type]})`
		: '';
	const section =
		typeof meta.section === 'string' && meta.section.trim() !== ''
			? `, Abschnitt „${meta.section.trim()}“`
			: '';
	return `${title}${type}${section}`;
}

/** What the copy of a Notion entry holds (ADR-0041 §5): complete, properties only, or cut. */
export type NotionContent = 'complete' | 'properties' | 'truncated';

export function notionContentOf(
	item: Pick<InboxItemSummary, 'channel' | 'sourceMeta'>
): NotionContent | null {
	if (item.channel !== 'notion') return null;
	const notion = item.sourceMeta.notion;
	if (typeof notion !== 'object' || notion === null || Array.isArray(notion)) return null;
	const content = (notion as Record<string, unknown>).content;
	return content === 'complete' || content === 'properties' || content === 'truncated'
		? content
		: null;
}
