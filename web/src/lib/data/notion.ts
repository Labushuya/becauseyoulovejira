// Notion import (ADR-0041; ADR-0006 sections 1 to 5): the routes under
// /api/byl/connections/{id}/notion/… of app/pb_hooks/notion.pb.js. Stateless functions with the
// PocketBase instance as first parameter. The token never reaches the browser: the hook asks Notion
// and answers with results. Missing access data, a paused connection and errors of Notion come as
// an outcome with the German message of the server; a refused request (400) and a missing server
// route (503 before the restart) too; everything else is a DataError.

import type PocketBase from 'pocketbase';
import {
	NOTION_DEFAULT_LIMITS,
	isNotionSourceType,
	type NotionCheck,
	type NotionImportCounts,
	type NotionImportRequest,
	type NotionImportResult,
	type NotionImportedSource,
	type NotionLimits,
	type NotionOutcome,
	type NotionPreview,
	type NotionPreviewItem,
	type NotionSource,
	type NotionSourceList
} from '../domain/notion';
import { DATA_ERROR_MESSAGES, toDataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';

const IMPORT_STATUSES = ['created', 'duplicate', 'skipped', 'failed'] as const;
const INBOX_STATES = ['new', 'converted', 'discarded'] as const;

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

/**
 * Runs a call of a Notion route: "missing", "disabled" and "error" of the answer, a refusal (400)
 * and a server without the route (503) become an outcome with the message of the server; every
 * other failure (session, not found, network) is a DataError.
 */
async function notionCall<T>(
	signal: AbortSignal | undefined,
	call: () => Promise<Record<string, unknown>>,
	map: (result: Record<string, unknown>) => T
): Promise<NotionOutcome<T>> {
	let result: Record<string, unknown>;
	try {
		result = await call();
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted && (status === 400 || status === 503)) {
			return {
				kind: 'error',
				message: textOf(response.message) || DATA_ERROR_MESSAGES.server,
				reason: ''
			};
		}
		throw toDataError(error, signal);
	}
	const status = result.status;
	if (status === 'missing' || status === 'disabled' || status === 'error') {
		const reason =
			result.reason === 'connection' || result.reason === 'source' ? result.reason : '';
		return { kind: status, message: textOf(result.message), reason };
	}
	return { kind: 'ok', value: map(result) };
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
		() => pb.send<Record<string, unknown>>(routeOf(id, 'check'), { method: 'POST', signal }),
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
		() =>
			pb.send<Record<string, unknown>>(routeOf(id, 'sources'), {
				method: 'GET',
				query: trimmed === '' ? {} : { q: trimmed },
				signal
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
					copyContent: raw.copy_content === true
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
		treeBlocks: count(raw.tree_blocks) || NOTION_DEFAULT_LIMITS.treeBlocks
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
		state: INBOX_STATES.find((value) => value === raw.state) ?? '',
		message: textOf(raw.message)
	};
}

/** The entries of one source with their state in the inbox; saves nothing. */
export function previewNotion(
	pb: PocketBase,
	id: string,
	source: NotionImportRequest['source'],
	dateProperty: string | null,
	{ signal }: RequestOptions = {}
): Promise<NotionOutcome<NotionPreview>> {
	const body: Record<string, unknown> = { source };
	if (dateProperty !== null) body.date_property = dateProperty;
	return notionCall(
		signal,
		() =>
			pb.send<Record<string, unknown>>(routeOf(id, 'preview'), { method: 'POST', body, signal }),
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
				limits: toLimits(result.limits)
			};
		}
	);
}

/** Result of one import request: per entry and the counts. */
export interface NotionImportBatch {
	items: NotionImportResult[];
	counts: NotionImportCounts;
}

/**
 * Takes chosen entries of one source into the inbox (at most the batch limit of the server per
 * call). An error of Notion on the way answers as outcome "error"; what was taken before stays.
 */
export function importNotion(
	pb: PocketBase,
	id: string,
	request: NotionImportRequest,
	{ signal }: RequestOptions = {}
): Promise<NotionOutcome<NotionImportBatch>> {
	const body: Record<string, unknown> = {
		source: request.source,
		refs: [...request.refs],
		skip_done: request.skipDone,
		copy_content: request.copyContent
	};
	if (request.dateProperty !== null) body.date_property = request.dateProperty;
	return notionCall(
		signal,
		() => pb.send<Record<string, unknown>>(routeOf(id, 'import'), { method: 'POST', body, signal }),
		(result) => {
			const items = (Array.isArray(result.items) ? result.items : [])
				.filter(isRecord)
				.map((raw) => ({
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
				}
			};
		}
	);
}
