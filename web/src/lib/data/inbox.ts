// Inbox access (ADR-0014; E4 plan, package 2; ADR-0006 sections 1 to 5). Stateless functions
// with the PocketBase instance as first parameter; filters always through pb.filter(). The hook
// sets scope, state and fingerprint and checks every change (app/pb_hooks/inbox.pb.js).

import type PocketBase from 'pocketbase';
import {
	duplicateMessage,
	isInboxChannel,
	isInboxKind,
	isInboxState,
	type HandledState,
	type InboxChannel,
	type InboxDraft,
	type InboxDuplicate,
	type InboxItem,
	type InboxItemSummary,
	type InboxState
} from '../domain/inbox';
import { DataError, isDataError, withDataErrors } from './errors';
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
	'created',
	'updated'
].join(',');

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
	created: string;
	updated: string;
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
		handledAt: record.handled_at || null,
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
 * Handled entries of one state, narrowed to the channels of a source family when `{:all}` is not
 * "1" (ADR-0019 section 6). A family has at most MAX_FAMILY_CHANNELS channels; an unused
 * parameter is '' and matches nothing, because every entry has a channel.
 */
const HANDLED_FILTER = [
	'state = {:state}',
	'({:all} = "1" || channel = {:c1} || channel = {:c2} || channel = {:c3})'
].join(' && ');

const MAX_FAMILY_CHANNELS = 3;

/**
 * One page of converted or discarded entries, most recently handled first; with `channels` only
 * those of these channels (the chip "Quelle"), filtered by the server so the pages stay full.
 */
export function listHandledItems(
	pb: PocketBase,
	state: HandledState,
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
				state,
				all: channels === null ? '1' : '',
				c1: channels?.[0] ?? '',
				c2: channels?.[1] ?? '',
				c3: channels?.[2] ?? ''
			}),
			sort: '-handled_at,-created,-id',
			fields: INBOX_LIST_FIELDS,
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
			.getOne<InboxRecord>(id, { fields: INBOX_DETAIL_FIELDS, signal });
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
			.update<InboxRecord>(id, body, { fields: INBOX_LIST_FIELDS, signal });
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

/** "Dem Ticket zuordnen": the entry counts as converted into an existing ticket of its scope. */
export function assignToTicket(
	pb: PocketBase,
	id: string,
	ticketId: string,
	{ signal }: RequestOptions = {}
): Promise<InboxItemSummary> {
	return updateItem(pb, id, { state: 'converted' satisfies InboxState, ticket: ticketId }, signal);
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
