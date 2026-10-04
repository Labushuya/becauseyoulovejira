// Notion import (ADR-0041; ADR-0006 sections 1 to 5): the routes under
// /api/byl/connections/{id}/notion/… of app/pb_hooks/notion.pb.js. Stateless functions with the
// PocketBase instance as first parameter. The token never reaches the browser: the hook asks Notion
// and answers with results. Missing access data, a paused connection and errors of Notion come as
// an outcome with the German message of the server; a refused request (400), a missing server
// route (503 before the restart) and no answer within NOTION_REQUEST_TIMEOUT_MS too; everything
// else is a DataError.

import type PocketBase from 'pocketbase';
import {
	NOTION_DEFAULT_LIMITS,
	NOTION_REQUEST_TIMEOUT_MS,
	NOTION_TIMEOUT_MESSAGE,
	isNotionSourceType,
	type NotionCheck,
	type NotionImportBatch,
	type NotionImportOutcome,
	type NotionImportRequest,
	type NotionImportedSource,
	type NotionLimits,
	type NotionOutcome,
	type NotionPreview,
	type NotionPreviewItem,
	type NotionPreviewRequest,
	type NotionSource,
	type NotionSourceList
} from '../domain/notion';
import { isDuplicateState } from '../domain/inbox';
import { DATA_ERROR_MESSAGES, toDataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';

const IMPORT_STATUSES = ['created', 'duplicate', 'skipped', 'failed'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function routeOf(id: string, name: string): string {
	return `/api/byl/connections/${encodeURIComponent(id)}/notion/${name}`;
}

type NotionFailure = Exclude<NotionOutcome<never>, { kind: 'ok' }>;

/**
 * Asks a Notion route: the answer, or its failure when it says "missing", "disabled" or "error",
 * refuses the request (400), lacks the route (503) or does not come within
 * NOTION_REQUEST_TIMEOUT_MS; every other failure (session, not found, network, `signal` aborted)
 * is a DataError. `call` gets the signal to pass on.
 */
async function ask(
	signal: AbortSignal | undefined,
	call: (signal: AbortSignal) => Promise<Record<string, unknown>>
): Promise<{ result: Record<string, unknown>; failure: NotionFailure | null }> {
	const limit = new AbortController();
	const abort = () => limit.abort();
	const timer = setTimeout(abort, NOTION_REQUEST_TIMEOUT_MS);
	if (signal?.aborted) abort();
	signal?.addEventListener('abort', abort, { once: true });
	let result: Record<string, unknown>;
	try {
		result = await call(limit.signal);
	} catch (error) {
		if (limit.signal.aborted && !signal?.aborted) {
			return {
				result: {},
				failure: { kind: 'error', message: NOTION_TIMEOUT_MESSAGE, reason: '' }
			};
		}
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted && (status === 400 || status === 503)) {
			const message = textOf(response.message) || DATA_ERROR_MESSAGES.server;
			return { result: {}, failure: { kind: 'error', message, reason: '' } };
		}
		throw toDataError(error, signal);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', abort);
	}
	const status = result.status;
	if (status === 'missing' || status === 'disabled' || status === 'error') {
		const reason =
			result.reason === 'connection' || result.reason === 'source' ? result.reason : '';
		return { result, failure: { kind: status, message: textOf(result.message), reason } };
	}
	return { result, failure: null };
}

/** A call of a Notion route as outcome: the mapped answer or its failure (see `ask`). */
async function notionCall<T>(
	signal: AbortSignal | undefined,
	call: (signal: AbortSignal) => Promise<Record<string, unknown>>,
	map: (result: Record<string, unknown>) => T
): Promise<NotionOutcome<T>> {
	const { result, failure } = await ask(signal, call);
	return failure ?? { kind: 'ok', value: map(result) };
}

function toSource(raw: Record<string, unknown>): NotionSource | null {
	const id = textOf(raw.id);
	if (id === '' || !isNotionSourceType(raw.type)) return null;
	return {
		id,
		type: raw.type,
		title: textOf(raw.title),
		url: textOf(raw.url),
		edited: textOf(raw.edited) || null
	};
}

/** "Verbindung prüfen": the bot user of the token and whether anything is shared. */
export function checkNotion(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<NotionOutcome<NotionCheck>> {
	return notionCall(
		signal,
		(limit) =>
			pb.send<Record<string, unknown>>(routeOf(id, 'check'), { method: 'POST', signal: limit }),
		(result) => ({
			workspace: textOf(result.workspace),
			bot: textOf(result.bot),
			shared: result.shared === true
		})
	);
}

/** Shared data sources and pages, last edited first; `query` narrows by title. */
export function listNotionSources(
	pb: PocketBase,
	id: string,
	query: string,
	{ signal }: RequestOptions = {}
): Promise<NotionOutcome<NotionSourceList>> {
	const trimmed = query.trim();
	return notionCall(
		signal,
		(limit) =>
			pb.send<Record<string, unknown>>(routeOf(id, 'sources'), {
				method: 'GET',
				query: trimmed === '' ? {} : { q: trimmed },
				signal: limit
			}),
		(result) => ({
			sources: (Array.isArray(result.sources) ? result.sources : [])
				.filter(isRecord)
				.map(toSource)
				.filter((source): source is NotionSource => source !== null),
			truncated: result.truncated === true
		})
	);
}

/** Sources taken from this connection so far (from the inbox; no request to Notion). */
export function listNotionImports(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<NotionImportedSource[]> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<Record<string, unknown>>(routeOf(id, 'imports'), {
			method: 'GET',
			signal
		});
		const list = Array.isArray(result.imports) ? result.imports.filter(isRecord) : [];
		return list.flatMap((raw): NotionImportedSource[] => {
			const sourceId = textOf(raw.id);
			if (sourceId === '' || !isNotionSourceType(raw.type)) return [];
			return [
				{
					id: sourceId,
					type: raw.type,
					title: textOf(raw.title),
					url: textOf(raw.url),
					count: count(raw.count),
					last: textOf(raw.last) || null,
					dateProperty: textOf(raw.date_property),
					copyContent: raw.copy_content === true,
					subpages: raw.subpages === true
				}
			];
		});
	});
}

function toLimits(raw: unknown): NotionLimits {
	if (!isRecord(raw)) return { ...NOTION_DEFAULT_LIMITS };
	return {
		maxRows: count(raw.max_rows) || NOTION_DEFAULT_LIMITS.maxRows,
		importBatch: count(raw.import_batch) || NOTION_DEFAULT_LIMITS.importBatch,
		contentBlocks: count(raw.content_blocks) || NOTION_DEFAULT_LIMITS.contentBlocks,
		contentChars: count(raw.content_chars) || NOTION_DEFAULT_LIMITS.contentChars,
		treeBlocks: count(raw.tree_blocks) || NOTION_DEFAULT_LIMITS.treeBlocks,
		subpages: count(raw.subpages) || NOTION_DEFAULT_LIMITS.subpages,
		subpageDepth: count(raw.subpage_depth) || NOTION_DEFAULT_LIMITS.subpageDepth
	};
}

function toPreviewItem(raw: Record<string, unknown>): NotionPreviewItem | null {
	const ref = textOf(raw.ref);
	if (ref === '') return null;
	return {
		ref,
		kind: raw.kind === 'todo' ? 'todo' : 'task',
		title: textOf(raw.title),
		sourceDate: textOf(raw.source_date) || null,
		allDay: raw.all_day === true,
		excerpt: textOf(raw.excerpt),
		section: textOf(raw.section),
		done: raw.done === true,
		url: textOf(raw.url),
		state: isDuplicateState(raw.state) ? raw.state : '',
		message: textOf(raw.message)
	};
}

/**
 * The entries of one source with their state in the inbox; saves nothing. A page with `subpages`
 * brings the points of its sub-pages as well (ADR-0041, addendum of 2026-10-01).
 */
export function previewNotion(
	pb: PocketBase,
	id: string,
	{ source, dateProperty, subpages }: NotionPreviewRequest,
	{ signal }: RequestOptions = {}
): Promise<NotionOutcome<NotionPreview>> {
	const body: Record<string, unknown> = { source };
	if (dateProperty !== null) body.date_property = dateProperty;
	if (subpages) body.subpages = true;
	return notionCall(
		signal,
		(limit) =>
			pb.send<Record<string, unknown>>(routeOf(id, 'preview'), {
				method: 'POST',
				body,
				signal: limit
			}),
		(result) => {
			const raw = isRecord(result.source) ? result.source : {};
			return {
				source: {
					id: textOf(raw.id) || source.id,
					type: isNotionSourceType(raw.type) ? raw.type : source.type,
					title: textOf(raw.title),
					url: textOf(raw.url)
				},
				dateProperties: (Array.isArray(result.date_properties)
					? result.date_properties
					: []
				).filter((name): name is string => typeof name === 'string'),
				dateProperty: textOf(result.date_property),
				items: (Array.isArray(result.items) ? result.items : [])
					.filter(isRecord)
					.map(toPreviewItem)
					.filter((item): item is NotionPreviewItem => item !== null),
				truncated: result.truncated === true,
				blankPoints: count(result.empty),
				subpages: count(result.subpages),
				hiddenSubpages: count(result.subpages_hidden),
				limits: toLimits(result.limits)
			};
		}
	);
}

function toBatch(result: Record<string, unknown>): NotionImportBatch {
	const items = (Array.isArray(result.items) ? result.items : []).filter(isRecord).map((raw) => ({
		ref: textOf(raw.ref),
		status: IMPORT_STATUSES.find((value) => value === raw.status) ?? 'failed',
		message: textOf(raw.message)
	}));
	const counts = isRecord(result.counts) ? result.counts : {};
	return {
		items,
		counts: {
			created: count(counts.created),
			duplicates: count(counts.duplicates),
			skipped: count(counts.skipped),
			failed: count(counts.failed)
		},
		pending: (Array.isArray(result.pending) ? result.pending : []).filter(
			(ref): ref is string => typeof ref === 'string' && ref !== ''
		)
	};
}

/**
 * Takes chosen entries of one source into the inbox (at most the batch limit of the server per
 * call). Entries the server had no time for come back in `pending`. An error of Notion on the way
 * answers as outcome "error" with what was taken before it in `partial`.
 */
export async function importNotion(
	pb: PocketBase,
	id: string,
	request: NotionImportRequest,
	{ signal }: RequestOptions = {}
): Promise<NotionImportOutcome> {
	const body: Record<string, unknown> = {
		source: request.source,
		refs: [...request.refs],
		skip_done: request.skipDone,
		copy_content: request.copyContent
	};
	if (request.dateProperty !== null) body.date_property = request.dateProperty;
	if (request.subpages) body.subpages = true;
	const { result, failure } = await ask(signal, (limit) =>
		pb.send<Record<string, unknown>>(routeOf(id, 'import'), {
			method: 'POST',
			body,
			signal: limit
		})
	);
	if (failure === null) return { kind: 'ok', value: toBatch(result) };
	const partial = Array.isArray(result.items) && result.items.length > 0 ? toBatch(result) : null;
	return { ...failure, partial };
}
