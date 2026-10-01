// Notion import (ADR-0041, plan notion-import NI-2): types of the answers of the routes under
// /api/byl/connections/{id}/notion/… and the pure rules of the dialog, the card and "Erneut
// abrufen": what may be chosen, what is chosen at first, the batches of an import and the texts of
// results. Notion is only read; entries are copies in the inbox.

import { formatCount } from './connections';
import type { InboxItemSummary, InboxState } from './inbox';
import { serializeInboxQuery } from './inbox-query';

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
	/** Whether the last import of a page read its sub-pages ("Unterseiten einbeziehen"). */
	subpages: boolean;
}

/** Limits of the server that the dialog names. */
export interface NotionLimits {
	maxRows: number;
	importBatch: number;
	contentBlocks: number;
	contentChars: number;
	/** Blocks read of a page with lists. */
	treeBlocks: number;
	/** Sub-pages read at most with "Unterseiten einbeziehen", and down to which level. */
	subpages: number;
	subpageDepth: number;
}

export const NOTION_DEFAULT_LIMITS: Readonly<NotionLimits> = Object.freeze({
	maxRows: 1000,
	importBatch: 100,
	contentBlocks: 500,
	contentChars: 50_000,
	treeBlocks: 5000,
	subpages: 50,
	subpageDepth: 3
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
	/** Sub-pages read with "Unterseiten einbeziehen", and those the integration does not see. */
	subpages: number;
	hiddenSubpages: number;
	limits: NotionLimits;
}

/** What a preview asks for: the source and its options. */
export interface NotionPreviewRequest {
	source: { type: NotionSourceType; id: string };
	/** null: the server takes the first date property; '': none. */
	dateProperty: string | null;
	/** Pages only: read the sub-pages as well (ADR-0041, addendum of 2026-10-01). */
	subpages: boolean;
}

export type NotionImportStatus = 'created' | 'duplicate' | 'skipped' | 'failed';

export interface NotionImportResult {
	ref: string;
	status: NotionImportStatus;
	message: string;
}

/**
 * Answer of one import request: per entry and the counts, and the entries the server handed back
 * because its time for new entries was over (they come again in the next request).
 */
export interface NotionImportBatch {
	items: NotionImportResult[];
	counts: NotionImportCounts;
	pending: string[];
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

/**
 * Answer of an import request: like every route, but an error on the way (the token refused while
 * page contents are read, Notion too slow) keeps what was taken before it in `partial`.
 */
export type NotionImportOutcome =
	| { kind: 'ok'; value: NotionImportBatch }
	| {
			kind: 'missing' | 'disabled' | 'error';
			message: string;
			reason: 'connection' | 'source' | '';
			partial: NotionImportBatch | null;
	  };

/**
 * How long the browser waits for a route of the Notion import. The server ends every request after
 * about 90 s (LIMITS.routeSeconds in app/pb_hooks/lib/notion-rules.js: no request to Notion starts
 * later, an import hands the rest back after 30 s); 150 s leave room for one last request to Notion
 * and stay below the 5 minutes after which PocketBase (WriteTimeout) and Firefox give up.
 */
export const NOTION_REQUEST_TIMEOUT_MS = 150_000;

export const NOTION_TIMEOUT_MESSAGE =
	'Der Server hat nicht innerhalb von 2,5 Minuten geantwortet (Zeitüberschreitung). Was schon übernommen ist, bleibt im Eingang; ein neuer Versuch erkennt es als „schon vorhanden“.';

/** A request that answered without any result and without an error; the run stops instead of looping. */
export const NOTION_NO_PROGRESS_MESSAGE =
	'Der Server hat keinen der Einträge bearbeitet. Bitte erneut versuchen.';

/** What an import sends; the server reads the source itself and takes only the IDs. */
export interface NotionImportRequest {
	source: { type: NotionSourceType; id: string };
	refs: readonly string[];
	skipDone: boolean;
	copyContent: boolean;
	/** null: the server takes the first date property; '': none. */
	dateProperty: string | null;
	/** Pages only: the sub-pages count to the source (ADR-0041, addendum of 2026-10-01). */
	subpages: boolean;
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
 * Entries per import request (a block), so the dialog shows real progress (fix 2026-09-30):
 *
 * - Without page content 10 per 100 entries of the source, at least 10, at most the limit of the
 *   server. Each request reads the source anew (1 request to Notion plus 1 per 100 rows, 350 ms
 *   apart); this keeps that reading at about one request to Notion per 10 entries. 45 rows go in 5
 *   blocks of about a second each, 1,000 rows in 10 blocks of 100.
 * - With page content 5: every row needs at least one more request to Notion, up to 40.
 *
 * The server hands back what it could not take within its time (`pending`), so a block never runs
 * into a time limit.
 */
export function importBatchSize(
	limits: Pick<NotionLimits, 'importBatch'>,
	withContent: boolean,
	entries: number
): number {
	if (withContent) return Math.max(1, Math.min(5, limits.importBatch));
	const scaled = 10 * Math.max(1, Math.ceil(entries / 100));
	return Math.max(1, Math.min(scaled, limits.importBatch));
}

/** The counts of `results`. */
export function countsOf(results: readonly NotionImportResult[]): NotionImportCounts {
	const counts = { ...NO_COUNTS };
	for (const result of results) {
		if (result.status === 'created') counts.created += 1;
		else if (result.status === 'duplicate') counts.duplicates += 1;
		else if (result.status === 'skipped') counts.skipped += 1;
		else counts.failed += 1;
	}
	return counts;
}

/** "1 Eintrag", "45 Einträge". */
export function entriesText(count: number): string {
	return count === 1 ? '1 Eintrag' : `${formatCount(count)} Einträge`;
}

/** Text of the import button while it runs: "45 Einträge werden übernommen …". */
export function runningText(total: number): string {
	return total === 1 ? '1 Eintrag wird übernommen …' : `${entriesText(total)} werden übernommen …`;
}

/** Progress line of the dialog: "20 von 45 bearbeitet …". */
export function progressText(handled: number, total: number): string {
	return `${formatCount(handled)} von ${formatCount(total)} bearbeitet …`;
}

/** Query of the inbox with the chip "Notion": the new entries, or all when none was created. */
export function notionInboxQuery(counts: NotionImportCounts): string {
	return serializeInboxQuery({ source: 'notion', state: counts.created > 0 ? 'new' : 'all' });
}

/** What an import run ended with, as the dialog shows it. */
export interface NotionRunOutcome {
	counts: NotionImportCounts;
	/** Message of the error that stopped the run, null without one. */
	error: string | null;
	/** Stopped on request ("Nach diesem Block anhalten"). */
	stopped: boolean;
	/** Chosen entries without a result (not sent after an error or the stop). */
	open: number;
	/**
	 * Sources of a run over several that ended with an error of their own while the others went on
	 * (ADR-0041, addendum of 2026-10-01); 0 or missing for none.
	 */
	failedSources?: number;
}

/**
 * Title, text and tone of the result (ADR-0009: red only when a request failed, or when nothing
 * came in and entries or sources failed; a stop is neutral).
 */
export function runSummary(run: NotionRunOutcome): {
	tone: 'success' | 'info' | 'error';
	title: string;
	text: string;
} {
	const counts = `${countsText(run.counts)}.`;
	const rest =
		run.open === 0
			? ''
			: ` ${entriesText(run.open)} noch nicht übernommen; sie bleiben ausgewählt, ein neuer Versuch erkennt Übernommenes als „schon vorhanden“.`;
	const failedSources = run.failedSources ?? 0;
	const sources =
		failedSources === 0
			? ''
			: ` ${failedSources === 1 ? 'Eine Quelle' : `${failedSources} Quellen`} mit Fehler; der Grund steht bei der Quelle.`;
	if (run.error !== null) {
		return {
			tone: 'error',
			title: 'Übernahme unterbrochen',
			text: `${counts} ${run.error}${sources}${rest}`
		};
	}
	if (run.stopped) return { tone: 'info', title: 'Angehalten', text: `${counts}${sources}${rest}` };
	const failed =
		run.counts.failed === 0
			? ''
			: ' Einträge mit Fehler bleiben ausgewählt; der Grund steht darunter.';
	const problems = run.counts.failed > 0 || failedSources > 0;
	const tone =
		run.counts.created > 0 ? (failedSources > 0 ? 'info' : 'success') : problems ? 'error' : 'info';
	return { tone, title: 'In den Eingang übernommen', text: `${counts}${sources}${failed}${rest}` };
}

/**
 * Result of one source in a run over several sources or in "Alle erneut abrufen" (ADR-0041,
 * addendum of 2026-10-01).
 */
export interface NotionSourceResult {
	id: string;
	title: string;
	counts: NotionImportCounts;
	/** Message of the error that ended this source, null without one. */
	error: string | null;
	/** Chosen entries of this source without a result (not sent after a stop or an error). */
	open: number;
}

/**
 * Line of one source: "3 angelegt, 1 schon vorhanden." plus what is left and the error; a source
 * that failed before anything came of it (its preview) names only the error.
 */
export function sourceResultText(
	result: Pick<NotionSourceResult, 'counts' | 'error' | 'open'>
): string {
	const { created, duplicates, skipped, failed } = result.counts;
	if (result.error !== null && created + duplicates + skipped + failed + result.open === 0) {
		return result.error;
	}
	const left = result.open === 0 ? '' : `, ${entriesText(result.open)} noch nicht übernommen`;
	const text = `${countsText(result.counts)}${left}.`;
	return result.error === null ? text : `${text} ${result.error}`;
}

/** The line of the card while "Alle erneut abrufen" runs. */
export function refetchProgressText(index: number, total: number, title: string): string {
	return `Erneut abrufen: Quelle ${formatCount(index)} von ${formatCount(total)} („${title}“) …`;
}

/**
 * Flag after "Alle erneut abrufen": the sources, the counts of all of them, how many failed and
 * whether it was stopped. Red only when nothing came in and a source failed (ADR-0009).
 */
export function refetchAllText(
	results: readonly NotionSourceResult[],
	stopped: boolean
): { text: string; tone: 'success' | 'info' | 'error' } {
	const counts = results.reduce((sum, result) => addCounts(sum, result.counts), { ...NO_COUNTS });
	const failed = results.filter((result) => result.error !== null).length;
	const sourcesText = (count: number) =>
		count === 1 ? '1 Quelle' : `${formatCount(count)} Quellen`;
	const parts = [`${sourcesText(results.length)} erneut abgerufen: ${countsText(counts)}`];
	if (failed > 0) parts.push(`${sourcesText(failed)} mit Fehler`);
	if (stopped) parts.push('angehalten');
	const tone = counts.created > 0 ? 'success' : failed > 0 ? 'error' : 'info';
	return { text: `${parts.join('; ')}.`, tone };
}

/** Hint of the option "Unterseiten einbeziehen" with its limits. */
export function subpagesHint(limits: Pick<NotionLimits, 'subpages' | 'subpageDepth'>): string {
	return `Liest bei Seiten auch ihre Unterseiten, soweit die Integration sie sieht: höchstens ${formatCount(limits.subpages)} Unterseiten, bis ${formatCount(limits.subpageDepth)} Ebenen tief. Ihre Punkte stehen unter „Unterseite › Abschnitt“.`;
}

/** What the preview of a page says about its sub-pages, '' without any. */
export function subpagesOverview(
	preview: Pick<NotionPreview, 'subpages' | 'hiddenSubpages'>
): string {
	const parts: string[] = [];
	if (preview.subpages > 0) {
		parts.push(
			preview.subpages === 1
				? '1 Unterseite gelesen'
				: `${formatCount(preview.subpages)} Unterseiten gelesen`
		);
	}
	if (preview.hiddenSubpages > 0) {
		parts.push(
			preview.hiddenSubpages === 1
				? '1 Unterseite nicht sichtbar'
				: `${formatCount(preview.hiddenSubpages)} Unterseiten nicht sichtbar`
		);
	}
	return parts.length === 0 ? '' : `${parts.join(', ')}.`;
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
