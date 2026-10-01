// Inbox access (ADR-0014; E4 plan, package 2; ADR-0006 sections 1 to 5). Stateless functions
// with the PocketBase instance as first parameter; filters always through pb.filter(). The hook
// sets scope, state and fingerprint and checks every change (app/pb_hooks/inbox.pb.js).

import type PocketBase from 'pocketbase';
import {
	duplicateMessage,
	isInboxChannel,
	isInboxKind,
	isInboxState,
	type InboxChannel,
	type InboxDraft,
	type InboxDuplicate,
	type InboxItem,
	type InboxItemSummary,
	type InboxState,
	type InboxTicketRef,
	type ListedView
} from '../domain/inbox';
import { DATA_ERROR_MESSAGES, DataError, isDataError, toDataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';

const INBOX = 'inbox_items';

/** Handled entries per page (T-4, as the done tickets in ADR-0006 section 3). */
export const HANDLED_PAGE_SIZE = 50;

/** Fields of the lists, without the text (up to 100 000 characters). */
export const INBOX_LIST_FIELDS = [
	'id',
	'channel',
	'kind',
	'title',
	'source_url',
	'source_ref',
	'source_date',
	'source_meta',
	'original',
	'state',
	'ticket',
	'handled_at',
	// Area of the entry: the ticket picker offers only tickets of the same area (ADR-0042).
	'scope',
	// The connection that brought the entry: panel and sources name it (ADR-0026, addendum KK-3).
	'connection',
	'created',
	'updated',
	// The ticket of a converted or linked entry (ADR-0031, addendum): key and title for the chip and
	// the panel, source_item tells whether the entry is its main source.
	'expand.ticket.id',
	'expand.ticket.key',
	'expand.ticket.title',
	'expand.ticket.source_item'
].join(',');

/** Expanded relation of lists, panel and realtime events (ADR-0031, addendum). */
export const INBOX_EXPAND = 'ticket';

/** Fields of the panel: the list fields plus the text. */
export const INBOX_DETAIL_FIELDS = `${INBOX_LIST_FIELDS},body`;

/** Record of inbox_items as the API returns it with the fields above. */
export interface InboxRecord {
	id: string;
	channel: string;
	kind: string;
	title: string;
	body?: string;
	source_url: string;
	source_ref: string;
	source_date: string;
	source_meta: unknown;
	original: string;
	state: string;
	ticket: string;
	handled_at: string;
	scope?: string;
	connection?: string;
	created: string;
	updated: string;
	expand?: { ticket?: InboxTicketRecord };
}

/** Expanded ticket of an entry with the fields above. */
export interface InboxTicketRecord {
	id: string;
	key: string;
	title: string;
	source_item?: string;
}

function ticketRefOf(record: InboxRecord): InboxTicketRef | null {
	const ticket = record.expand?.ticket;
	if (!record.ticket || ticket === undefined || ticket.id !== record.ticket) return null;
	return {
		id: ticket.id,
		key: ticket.key,
		title: ticket.title,
		primary: ticket.source_item === record.id
	};
}

function metaOf(value: unknown): Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? { ...(value as Record<string, unknown>) }
		: {};
}

/** Maps a record of the list fields (API response or realtime event) to the domain type. */
export function toInboxItemSummary(record: InboxRecord): InboxItemSummary {
	if (!isInboxChannel(record.channel)) throw new RangeError(`Unknown channel: ${record.channel}`);
	if (!isInboxKind(record.kind)) throw new RangeError(`Unknown kind: ${record.kind}`);
	if (!isInboxState(record.state)) throw new RangeError(`Unknown state: ${record.state}`);
	return {
		id: record.id,
		channel: record.channel,
		kind: record.kind,
		title: record.title,
		sourceUrl: record.source_url ?? '',
		sourceRef: record.source_ref ?? '',
		sourceDate: record.source_date || null,
		sourceMeta: metaOf(record.source_meta),
		original: record.original ?? '',
		state: record.state,
		ticketId: record.ticket || null,
		ticket: ticketRefOf(record),
		handledAt: record.handled_at || null,
		...(record.scope ? { scope: record.scope } : {}),
		...(record.connection ? { connectionId: record.connection } : {}),
		created: record.created,
		updated: record.updated
	};
}

export function toInboxItem(record: InboxRecord): InboxItem {
	return { ...toInboxItemSummary(record), body: record.body ?? '' };
}

/** Result of creating an entry: the new entry, or the answer that it exists already. */
export type CreateItemOutcome = { kind: 'created'; item: InboxItem } | InboxDuplicate;

/** Duplicate answer of the hook (validation_inbox_duplicate with params), else null. */
function duplicateOf(error: unknown): InboxDuplicate | null {
	if (!isDataError(error) || error.kind !== 'validation') return null;
	const field = error.fields.fingerprint;
	if (field?.code !== 'validation_inbox_duplicate') return null;
	const params = field.params ?? {};
	const text = (value: unknown) => (typeof value === 'string' ? value : '');
	const state: InboxState = isInboxState(params.state) ? params.state : 'new';
	const ticketKey = text(params.ticketKey);
	return {
		kind: 'duplicate',
		state,
		itemId: text(params.item),
		ticketId: text(params.ticket),
		ticketKey,
		message: duplicateMessage(state, ticketKey)
	};
}

/** Every new entry, newest first (T-4: loaded in full like the open tickets). */
export function listNewItems(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<InboxItemSummary[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(INBOX).getFullList<InboxRecord>({
			batch: 500,
			filter: pb.filter('state = {:state}', { state: 'new' satisfies InboxState }),
			sort: '-created,-id',
			fields: INBOX_LIST_FIELDS,
			signal
		});
		return records.map(toInboxItemSummary);
	});
}

export interface HandledItemPage {
	items: InboxItemSummary[];
	page: number;
	hasMore: boolean;
}

/**
 * Entries of one state (or of every state when `{:every}` is "1", view "Alle"), narrowed to the
 * channels of a source family when `{:all}` is not "1" (ADR-0019 section 6). A family has at most
 * MAX_FAMILY_CHANNELS channels; an unused parameter is '' and matches nothing, because every entry
 * has a channel.
 */
const HANDLED_FILTER = [
	'({:every} = "1" || state = {:state})',
	'({:all} = "1" || channel = {:c1} || channel = {:c2} || channel = {:c3})'
].join(' && ');

const MAX_FAMILY_CHANNELS = 3;

/**
 * One page of converted or discarded entries, most recently handled first, or of every entry
 * (view "Alle", ADR-0031 addendum C), newest first; with `channels` only those of these channels
 * (the chip "Quelle"), filtered by the server so the pages stay full.
 */
export function listHandledItems(
	pb: PocketBase,
	state: ListedView,
	page: number,
	{
		signal,
		perPage = HANDLED_PAGE_SIZE,
		channels = null
	}: RequestOptions & { perPage?: number; channels?: readonly InboxChannel[] | null } = {}
): Promise<HandledItemPage> {
	return withDataErrors(signal, async () => {
		if (channels !== null && channels.length > MAX_FAMILY_CHANNELS) {
			throw new RangeError('Too many channels for the filter');
		}
		const result = await pb.collection(INBOX).getList<InboxRecord>(page, perPage, {
			filter: pb.filter(HANDLED_FILTER, {
				every: state === 'all' ? '1' : '',
				state: state === 'all' ? '' : state,
				all: channels === null ? '1' : '',
				c1: channels?.[0] ?? '',
				c2: channels?.[1] ?? '',
				c3: channels?.[2] ?? ''
			}),
			sort: state === 'all' ? '-created,-id' : '-handled_at,-created,-id',
			fields: INBOX_LIST_FIELDS,
			expand: INBOX_EXPAND,
			signal
		});
		return {
			items: result.items.map(toInboxItemSummary),
			page: result.page,
			hasMore: result.page < result.totalPages
		};
	});
}

/** One entry with its text. */
export function getItem(pb: PocketBase, id: string, { signal }: RequestOptions = {}) {
	return withDataErrors(signal, async (): Promise<InboxItem> => {
		const record = await pb
			.collection(INBOX)
			.getOne<InboxRecord>(id, { fields: INBOX_DETAIL_FIELDS, expand: INBOX_EXPAND, signal });
		return toInboxItem(record);
	});
}

/** Request body of a draft; a file makes the SDK send multipart form data. */
function draftBody(owner: string, draft: InboxDraft): Record<string, unknown> {
	const body: Record<string, unknown> = {
		owner,
		channel: draft.channel,
		kind: draft.kind,
		title: draft.title
	};
	if (draft.body !== undefined) body.body = draft.body;
	if (draft.sourceUrl !== undefined) body.source_url = draft.sourceUrl;
	if (draft.sourceRef !== undefined) body.source_ref = draft.sourceRef;
	if (draft.sourceDate !== undefined) body.source_date = draft.sourceDate ?? '';
	if (draft.sourceMeta !== undefined) body.source_meta = draft.sourceMeta;
	if (draft.original !== undefined) body.original = draft.original;
	return body;
}

/**
 * Creates a private entry of the signed-in user. A duplicate is no failure but an outcome with
 * the state of the existing entry (ADR-0014 section 3); every other failure throws a DataError.
 */
export async function createItem(
	pb: PocketBase,
	draft: InboxDraft,
	{ signal }: RequestOptions = {}
): Promise<CreateItemOutcome> {
	try {
		return await withDataErrors(signal, async (): Promise<CreateItemOutcome> => {
			const owner = currentUserId(pb.authStore.record);
			if (owner === null) throw new DataError('session');
			const record = await pb
				.collection(INBOX)
				.create<InboxRecord>(draftBody(owner, draft), { fields: INBOX_DETAIL_FIELDS, signal });
			return { kind: 'created', item: toInboxItem(record) };
		});
	} catch (error) {
		const duplicate = duplicateOf(error);
		if (duplicate !== null) return duplicate;
		throw error;
	}
}

function updateItem(
	pb: PocketBase,
	id: string,
	body: Record<string, string>,
	signal: AbortSignal | undefined
): Promise<InboxItemSummary> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(INBOX)
			.update<InboxRecord>(id, body, { fields: INBOX_LIST_FIELDS, expand: INBOX_EXPAND, signal });
		return toInboxItemSummary(record);
	});
}

/** "Verwerfen": the entry stays as tombstone, so the same object does not come in again. */
export function discardItem(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<InboxItemSummary> {
	return updateItem(pb, id, { state: 'discarded' satisfies InboxState }, signal);
}

/** "Wiederherstellen": a discarded entry becomes new again. */
export function restoreItem(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<InboxItemSummary> {
	return updateItem(pb, id, { state: 'new' satisfies InboxState }, signal);
}

/**
 * Links the entry to an existing ticket of its scope ("Dem Ticket zuordnen", "Mit Ticket
 * verknüpfen …", "Quelle hinzufügen …"; ADR-0031 section 2): it becomes a source of the ticket.
 * The same update moves a linked entry directly to another ticket ("Anderem Ticket zuordnen …",
 * addendum to ADR-0031); the hook then writes the history of both tickets and refuses the main
 * source.
 */
export function assignToTicket(
	pb: PocketBase,
	id: string,
	ticketId: string,
	{ signal }: RequestOptions = {}
): Promise<InboxItemSummary> {
	return updateItem(pb, id, { state: 'converted' satisfies InboxState, ticket: ticketId }, signal);
}

/**
 * "Lösen": a linked entry goes back to the inbox as new (ADR-0031 section 2). The hook refuses the
 * main source of a ticket.
 */
export function releaseItem(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<InboxItemSummary> {
	return updateItem(pb, id, { state: 'new' satisfies InboxState, ticket: '' }, signal);
}

/** Most sources shown for one ticket; more are not expected (ADR-0031 section 1). */
export const SOURCES_LIMIT = 200;

/** The sources of a ticket: every entry with `ticket = <id>`, oldest first. */
export function listTicketSources(
	pb: PocketBase,
	ticketId: string,
	{ signal }: RequestOptions = {}
): Promise<InboxItemSummary[]> {
	return withDataErrors(signal, async () => {
		const result = await pb.collection(INBOX).getList<InboxRecord>(1, SOURCES_LIMIT, {
			filter: pb.filter('ticket = {:ticket}', { ticket: ticketId }),
			sort: 'created,id',
			fields: INBOX_LIST_FIELDS,
			expand: INBOX_EXPAND,
			skipTotal: true,
			signal
		});
		return result.items.map(toInboxItemSummary);
	});
}

/** Outcome of "Seiteninhalt sichern": the copy was saved, or the route refused with a reason. */
export type PageCopyOutcome =
	| { kind: 'saved'; title: string; size: number; truncated: boolean }
	| { kind: 'refused'; message: string };

/**
 * "Seiteninhalt sichern" (ADR-0031 section 6): the hook fetches the address of a web link once and
 * keeps the text of the page and the HTML. Refusals of the route (400 address not allowed, 409
 * saved already, 415 no HTML, 502 not reachable, 503 before the inbox exists) come back as outcome
 * with the message of the server; every other failure throws a DataError.
 */
export async function savePage(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<PageCopyOutcome> {
	try {
		const result = await pb.send<Record<string, unknown>>(
			`/api/byl/inbox/${encodeURIComponent(id)}/page`,
			{ method: 'POST', signal }
		);
		return {
			kind: 'saved',
			title: textOf(result.title),
			size: countOf(result.size),
			truncated: result.truncated === true
		};
	} catch (error) {
		const failure =
			typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
		const status = typeof failure.status === 'number' ? failure.status : 0;
		const response =
			typeof failure.response === 'object' && failure.response !== null
				? (failure.response as Record<string, unknown>)
				: {};
		if (!signal?.aborted && [400, 409, 415, 502, 503].includes(status)) {
			return { kind: 'refused', message: textOf(response.message) || DATA_ERROR_MESSAGES.server };
		}
		throw toDataError(error, signal);
	}
}

/**
 * Download address of the protected original file with a fresh file token (valid for a few
 * minutes), or null if the entry has none. The token is asked for per download, so it never goes stale in
 * the page.
 */
export function originalFileUrl(
	pb: PocketBase,
	item: Pick<InboxItemSummary, 'id' | 'original'>,
	{ signal }: RequestOptions = {}
): Promise<string | null> {
	return withDataErrors(signal, async () => {
		if (item.original === '') return null;
		const token = await pb.files.getToken({ signal });
		return pb.files.getURL({ id: item.id, collectionName: INBOX }, item.original, {
			token,
			download: true
		});
	});
}

/** Route of the hook that parses an .ics file (ADR-0017 section 1; E4 plan, packages 14 and 21). */
const CALENDAR_IMPORT_ROUTE = '/api/byl/inbox/ics';
const CALENDAR_PREVIEW_ROUTE = '/api/byl/inbox/ics/preview';
const LOOKUP_ROUTE = '/api/byl/inbox/lookup';
/** Most drafts per lookup request (the hook refuses more). */
export const LOOKUP_BATCH = 200;

/** One component of an .ics file in the selection view (E4 plan, package 21). */
export interface CalendarPreviewItem {
	index: number;
	kind: 'event' | 'todo';
	title: string;
	/** UTC in PocketBase format, null without a date. */
	sourceDate: string | null;
	allDay: boolean;
	series: boolean;
	location: string;
	/** Keyword of the user that matches, '' for none (ADR-0020). */
	keyword: string;
	/** State of the entry in the inbox already ('' for none) and its text, e.g. "Schon verworfen." */
	state: '' | 'new' | 'discarded' | 'converted';
	message: string;
}

export interface CalendarPreview {
	items: CalendarPreviewItem[];
	/** Cancelled events and cut-off components. */
	skipped: number;
}

/** Whether a draft is in the inbox already: the state ('' for not) and the text of the hook. */
export interface LookupState {
	state: '' | 'new' | 'discarded' | 'converted';
	message: string;
}

const STATES = ['', 'new', 'discarded', 'converted'] as const;

function stateOf(value: unknown): LookupState['state'] {
	return STATES.find((state) => state === value) ?? '';
}

function textOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/**
 * Sends an .ics file to the preview of the hook: its components with keyword and state, nothing is
 * saved. Before the migrations of E4 the route answers 503.
 */
export function previewCalendarFile(
	pb: PocketBase,
	file: File,
	{ signal }: RequestOptions = {}
): Promise<CalendarPreview> {
	return withDataErrors(signal, async () => {
		const body = new FormData();
		body.append('file', file);
		const result = await pb.send<Record<string, unknown>>(CALENDAR_PREVIEW_ROUTE, {
			method: 'POST',
			body,
			signal
		});
		const items = Array.isArray(result.items) ? result.items : [];
		return {
			skipped: countOf(result.skipped),
			items: items.map((raw: Record<string, unknown>) => ({
				index: countOf(raw.index),
				kind: raw.kind === 'todo' ? 'todo' : 'event',
				title: textOf(raw.title),
				sourceDate: textOf(raw.source_date) || null,
				allDay: raw.all_day === true,
				series: raw.series === true,
				location: textOf(raw.location),
				keyword: textOf(raw.keyword),
				state: stateOf(raw.state),
				message: textOf(raw.message)
			}))
		};
	});
}

/**
 * Whether drafts (mail files) are in the private inbox already, in batches of LOOKUP_BATCH; one
 * state per draft in the same order. Nothing is saved.
 */
export function lookupDrafts(
	pb: PocketBase,
	drafts: readonly InboxDraft[],
	{ signal }: RequestOptions = {}
): Promise<LookupState[]> {
	return withDataErrors(signal, async () => {
		const states: LookupState[] = [];
		for (let start = 0; start < drafts.length; start += LOOKUP_BATCH) {
			const items = drafts.slice(start, start + LOOKUP_BATCH).map((draft) => ({
				channel: draft.channel,
				kind: draft.kind,
				title: draft.title,
				source_url: draft.sourceUrl ?? '',
				source_ref: draft.sourceRef ?? '',
				source_date: draft.sourceDate ?? '',
				source_meta: draft.sourceMeta ?? {}
			}));
			const result = await pb.send<Record<string, unknown>>(LOOKUP_ROUTE, {
				method: 'POST',
				body: { items },
				signal
			});
			const answered = Array.isArray(result.items) ? result.items : [];
			for (let i = 0; i < items.length; i++) {
				const raw = (answered[i] ?? {}) as Record<string, unknown>;
				states.push({ state: stateOf(raw.state), message: textOf(raw.message) });
			}
		}
		return states;
	});
}

/** Counts of an .ics import: new, already there, skipped (cancelled) and failed entries. */
export interface CalendarImportSummary {
	created: number;
	duplicates: number;
	skipped: number;
	failed: number;
	/** ID of the only new entry, '' otherwise. */
	itemId: string;
}

function countOf(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Uploads an .ics file with the chosen components (indices of the preview); the hook creates one
 * private entry per chosen event or task of the signed-in user and answers with counts. Before
 * the migrations of E4 the route answers 503.
 */
export function importCalendarFile(
	pb: PocketBase,
	file: File,
	select: readonly number[],
	{ signal }: RequestOptions = {}
): Promise<CalendarImportSummary> {
	return withDataErrors(signal, async () => {
		const body = new FormData();
		body.append('file', file);
		body.append('select', JSON.stringify(select));
		const result = await pb.send<Record<string, unknown>>(CALENDAR_IMPORT_ROUTE, {
			method: 'POST',
			body,
			signal
		});
		return {
			created: countOf(result.created),
			duplicates: countOf(result.duplicates),
			skipped: countOf(result.skipped),
			failed: countOf(result.failed),
			itemId: typeof result.item === 'string' ? result.item : ''
		};
	});
}
