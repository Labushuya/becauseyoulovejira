// Ticket access (ADR-0006 sections 1 to 5). Stateless functions: the PocketBase instance is a
// parameter, so the root integration tests run them against the disposable instance. Filters
// always go through pb.filter().

import type PocketBase from 'pocketbase';
import { addDays, type CalendarDate } from '../domain/berlin-date';
import { isInboxChannel } from '../domain/inbox';
import { EMPTY_LIST_QUERY, NO_PROJECT, activeSearch, type ListQuery } from '../domain/list-query';
import { SOON_DAYS } from '../domain/ordering';
import { channelsOf, type SourceFamily } from '../domain/source';
import type { SourceHandling } from '../domain/sources';
import { isPriority, isStatus, type Status } from '../domain/status';
import {
	MANUAL_ORIGIN,
	REOPEN_STATUS,
	fromDueInput,
	toDueInput,
	type ParentRef,
	type Ticket,
	type TicketDraft,
	type TicketOrigin,
	type TicketPatch,
	type TicketSummary
} from '../domain/ticket';
import { DataError, withDataErrors } from './errors';
import { likeText } from './like';
import { toProjectRef, type ProjectRecord } from './projects';
import { toTagRef, type TagRecord } from './tags';
import { currentUserId, type RequestOptions } from './options';

const TICKETS = 'tickets';

/** Done tickets per page (ADR-0006 section 3). */
export const DONE_PAGE_SIZE = 50;

/**
 * Expanded relations of list and detail; also used by the realtime subscription (ADR-0007). The
 * parent of a sub-task (ADR-0033) comes with key and title for its path.
 */
export const TICKET_EXPAND = 'project,tags,parent';

/** Fields of the list, without the description (E2 plan, package 4). */
export const TICKET_LIST_FIELDS = [
	'id',
	'key',
	'title',
	'status',
	'priority',
	'due',
	'project',
	'tags',
	'recurrence',
	// Sub-tasks (ADR-0033): the parent and whether the sub-task blocks completing it.
	'parent',
	'blocks_parent',
	// Way the ticket came in (ADR-0014 section 2); unknown to the server before the migration.
	'source',
	'completed_at',
	'created',
	'updated',
	'expand.project.id',
	'expand.project.name',
	'expand.project.code',
	'expand.project.archived',
	'expand.tags.id',
	'expand.tags.name',
	'expand.parent.id',
	'expand.parent.key',
	'expand.parent.title'
].join(',');

/** Fields of the detail panel: the list fields plus the description and the inbox entry. */
export const TICKET_DETAIL_FIELDS = `${TICKET_LIST_FIELDS},description,source_item`;

/** Ticket record as the API returns it with the fields above. */
export interface TicketRecord {
	id: string;
	key: string;
	title: string;
	description?: string;
	status: string;
	priority: string;
	due: string;
	project: string;
	tags: string[];
	recurrence: string;
	/** Parent of a sub-task, '' for a top-level ticket (ADR-0033). */
	parent?: string;
	blocks_parent?: boolean;
	/** Missing before the migration 1790201210 (the server leaves unknown fields out). */
	source?: string;
	source_item?: string;
	completed_at: string;
	created: string;
	updated: string;
	expand?: { project?: ProjectRecord; tags?: TagRecord[]; parent?: ParentRef };
}

/** Maps a record of the list fields (API response or realtime event) to the domain type. */
export function toTicketSummary(record: TicketRecord): TicketSummary {
	if (!isStatus(record.status)) throw new RangeError(`Unknown status: ${record.status}`);
	if (!isPriority(record.priority)) throw new RangeError(`Unknown priority: ${record.priority}`);
	return {
		id: record.id,
		key: record.key,
		title: record.title,
		status: record.status,
		priority: record.priority,
		due: toDueInput(record.due) || null,
		projectId: record.project || null,
		tagIds: [...(record.tags ?? [])],
		project: record.expand?.project ? toProjectRef(record.expand.project) : null,
		tags: (record.expand?.tags ?? []).map(toTagRef),
		recurring: record.recurrence !== '',
		recurrenceId: record.recurrence || null,
		parentId: record.parent || null,
		// The schema default is true (set by the create hook), so a missing value blocks.
		blocksParent: record.blocks_parent ?? true,
		parentRef: record.expand?.parent
			? {
					id: record.expand.parent.id,
					key: record.expand.parent.key,
					title: record.expand.parent.title
				}
			: null,
		source: isInboxChannel(record.source) ? record.source : null,
		completedAt: record.completed_at || null,
		created: record.created,
		updated: record.updated
	};
}

export function toTicket(record: TicketRecord): Ticket {
	return {
		...toTicketSummary(record),
		description: record.description ?? '',
		sourceItem: record.source_item || null
	};
}

function dueBody(due: CalendarDate | null): string {
	return fromDueInput(due ?? '');
}

/** Request body of a patch: only the given fields (ADR-0006 section 5). */
function patchBody(patch: TicketPatch): Record<string, string | string[]> {
	const body: Record<string, string | string[]> = {};
	if (patch.title !== undefined) body.title = patch.title;
	if (patch.description !== undefined) body.description = patch.description;
	if (patch.status !== undefined) body.status = patch.status;
	if (patch.priority !== undefined) body.priority = patch.priority;
	if (patch.due !== undefined) body.due = dueBody(patch.due);
	// '' removes the project; the hook gives the ticket a key in the new number range.
	if (patch.project !== undefined) body.project = patch.project ?? '';
	// The whole list: PocketBase replaces the relation, the history hook records the difference.
	if (patch.tags !== undefined) body.tags = [...patch.tags];
	// '' releases a sub-task from its parent (ADR-0033).
	if (patch.parent !== undefined) body.parent = patch.parent ?? '';
	return body;
}

/** All tickets that are not done, unsorted; the list sorts them (ADR-0006 section 2). */
export function listOpenTickets(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<TicketSummary[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(TICKETS).getFullList<TicketRecord>({
			batch: 500,
			filter: pb.filter('status != {:done}', { done: 'done' satisfies Status }),
			fields: TICKET_LIST_FIELDS,
			expand: TICKET_EXPAND,
			signal
		});
		return records.map(toTicketSummary);
	});
}

/**
 * All sub-tasks, open and done, unsorted (ADR-0033): the progress of every parent and the section
 * "Unteraufgaben" come from them without a request per ticket.
 */
export function listSubtaskTickets(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<TicketSummary[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(TICKETS).getFullList<TicketRecord>({
			batch: 500,
			filter: pb.filter('parent != {:none}', { none: '' }),
			fields: TICKET_LIST_FIELDS,
			expand: TICKET_EXPAND,
			signal
		});
		return records.map(toTicketSummary);
	});
}

export interface DoneTicketPage {
	items: TicketSummary[];
	page: number;
	hasMore: boolean;
}

/** List filters of the section "Erledigt" (E3 plan, T-6): the query of the URL at a Berlin date. */
export interface DoneFilter {
	query: ListQuery;
	/** Berlin calendar date the due filters refer to. */
	today: CalendarDate;
}

/** Open tickets that match a search: title, description or key contain the text. */
const OPEN_SEARCH_FILTER = [
	'status != {:done}',
	'(title ~ {:q} || description ~ {:q} || key ~ {:q})'
].join(' && ');

/**
 * IDs of the open tickets that match the search (ADR-0013 section 2): the list intersects them
 * with its own filters, so the description is still not loaded into the list.
 */
export function searchOpenTicketIds(
	pb: PocketBase,
	search: string,
	{ signal }: RequestOptions = {}
): Promise<string[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(TICKETS).getFullList<{ id: string }>({
			batch: 500,
			filter: pb.filter(OPEN_SEARCH_FILTER, {
				done: 'done' satisfies Status,
				q: likeText(search)
			}),
			fields: 'id',
			signal
		});
		return records.map((record) => record.id);
	});
}

/** A ticket as choice of the ticket search ("Mit Ticket verknüpfen …", ADR-0031 section 7). */
export interface TicketChoice {
	id: string;
	key: string;
	title: string;
	status: Status;
}

/** Most tickets the ticket search offers at once. */
export const TICKET_SEARCH_LIMIT = 20;

/**
 * Tickets for the ticket search by number, key or title (ADR-0031 section 7), open ones first,
 * then the most recently changed; at most TICKET_SEARCH_LIMIT. An empty text gives none.
 */
export function searchTickets(
	pb: PocketBase,
	text: string,
	{ signal }: RequestOptions = {}
): Promise<TicketChoice[]> {
	return withDataErrors(signal, async () => {
		const search = text.trim();
		if (search === '') return [];
		const number = /^\d{1,9}$/.test(search) ? Number(search) : -1;
		const result = await pb
			.collection(TICKETS)
			.getList<{ id: string; key: string; title: string; status: string }>(1, TICKET_SEARCH_LIMIT, {
				// Any visible ticket, open or done; `{:number}` is -1 for a text that is no number.
				filter: pb.filter('key ~ {:q} || title ~ {:q} || number = {:number}', {
					q: likeText(search),
					number
				}),
				sort: '-updated,-id',
				fields: 'id,key,title,status',
				skipTotal: true,
				signal
			});
		const choices = result.items.map((record) => ({
			id: record.id,
			key: record.key,
			title: record.title,
			status: isStatus(record.status) ? record.status : 'open'
		}));
		return [
			...choices.filter((choice) => choice.status !== 'done'),
			...choices.filter((choice) => choice.status === 'done')
		];
	});
}

/** Without list filters: every done ticket. */
const NO_DONE_FILTER: DoneFilter = { query: EMPTY_LIST_QUERY, today: '' };

/**
 * Server form of `matchesFilter` (domain/filter.ts) for the done tickets (ADR-0013 section 3).
 * One fixed expression of fixed conditions joined with AND; each condition only applies when its
 * parameter selects it, so every value reaches the server as a parameter of pb.filter(). The
 * rules are those of the client: a done ticket is never overdue, "Bald" is tomorrow up to
 * today + SOON_DAYS, project and tag compare the stored relations. The search (ADR-0013 section
 * 2) is part of the expression, because the list does not load the description.
 * tests/integration/web-filter-parity.test.mjs keeps both forms equal.
 */
const DONE_FILTER = [
	'status = {:done}',
	'({:q} = "" || title ~ {:q} || description ~ {:q} || key ~ {:q})',
	'({:status} = "" || status = {:status})',
	'({:priority} = "" || priority = {:priority})',
	'({:due} != "overdue" || (due != "" && due < {:today} && status != {:done}))',
	'({:due} != "today" || due = {:today})',
	'({:due} != "soon" || (due >= {:tomorrow} && due <= {:horizon}))',
	'({:due} != "none" || due = "")',
	'({:project} = "" || {:project} = {:noProject} || project = {:project})',
	'({:project} != {:noProject} || project = "")',
	'({:tag} = "" || tags.id ?= {:tag})'
].join(' && ');

/**
 * Source family of the done tickets (ADR-0019 section 2): the channels of the family, and for
 * "manual" also an empty source (tickets before E4). A family has one to MAX_FAMILY_CHANNELS
 * channels; unused parameters repeat the first channel, since '' would match the tickets without
 * source, which only {:withEmpty} may take. The clause joins DONE_FILTER only when a source is
 * chosen: before the migration of E4 the server does not know the field, and the done list must
 * keep working until the next start.
 */
const DONE_SOURCE_FILTER = [
	'(source = {:s1} || source = {:s2} || source = {:s3} || ({:withEmpty} = "1" && source = ""))'
].join(' && ');

const MAX_FAMILY_CHANNELS = 3;

function sourceParams(family: SourceFamily): Record<string, string> {
	const channels = channelsOf(family);
	const first = channels[0];
	if (first === undefined || channels.length > MAX_FAMILY_CHANNELS) {
		throw new RangeError(`No filter for the source family ${family}`);
	}
	return {
		s1: first,
		s2: channels[1] ?? first,
		s3: channels[2] ?? first,
		withEmpty: family === 'manual' ? '1' : ''
	};
}

/** Expression of the done tickets: DONE_FILTER, and with a chosen source also its clause. */
function doneFilterExpression({ query }: DoneFilter): string {
	return query.source === null ? DONE_FILTER : `${DONE_FILTER} && ${DONE_SOURCE_FILTER}`;
}

/** Parameters of DONE_FILTER; an unset filter is '', which switches its conditions off. */
function doneFilterParams({ query, today }: DoneFilter): Record<string, string> {
	const dates =
		query.due === null
			? { today: '', tomorrow: '', horizon: '' }
			: {
					today: fromDueInput(today),
					tomorrow: fromDueInput(addDays(today, 1)),
					horizon: fromDueInput(addDays(today, SOON_DAYS))
				};
	return {
		done: 'done' satisfies Status,
		q: likeText(activeSearch(query) ?? ''),
		status: query.status ?? '',
		priority: query.priority ?? '',
		due: query.due ?? '',
		...dates,
		project: query.project ?? '',
		noProject: NO_PROJECT,
		tag: query.tag ?? '',
		...(query.source === null ? {} : sourceParams(query.source))
	};
}

/**
 * One page of done tickets, most recently completed first (ADR-0006 section 3), narrowed by the
 * list filters when given (E3 plan, package 10).
 */
export function listDoneTickets(
	pb: PocketBase,
	page: number,
	{
		signal,
		perPage = DONE_PAGE_SIZE,
		filter = NO_DONE_FILTER
	}: RequestOptions & { perPage?: number; filter?: DoneFilter } = {}
): Promise<DoneTicketPage> {
	return withDataErrors(signal, async () => {
		const result = await pb.collection(TICKETS).getList<TicketRecord>(page, perPage, {
			filter: pb.filter(doneFilterExpression(filter), doneFilterParams(filter)),
			sort: '-completed_at,-created,-id',
			fields: TICKET_LIST_FIELDS,
			expand: TICKET_EXPAND,
			signal
		});
		return {
			items: result.items.map(toTicketSummary),
			page: result.page,
			hasMore: result.page < result.totalPages
		};
	});
}

export function getTicket(pb: PocketBase, id: string, { signal }: RequestOptions = {}) {
	return withDataErrors(signal, async (): Promise<Ticket> => {
		const record = await pb.collection(TICKETS).getOne<TicketRecord>(id, {
			fields: TICKET_DETAIL_FIELDS,
			expand: TICKET_EXPAND,
			signal
		});
		return toTicket(record);
	});
}

/** Request fields of the origin: the source, or the inbox entry whose channel the hook takes. */
function originBody(origin: TicketOrigin): Record<string, string> {
	return 'sourceItem' in origin ? { source_item: origin.sourceItem } : { source: origin.source };
}

/**
 * Creates a private ticket of the signed-in user (E2 plan, T-8). Key, scope and number come
 * from the hook; `household` stays empty. `origin` is the form by default (source "manual");
 * with an inbox entry the hook converts the entry in the same transaction (ADR-0014 section 2).
 */
export function createTicket(
	pb: PocketBase,
	draft: TicketDraft,
	{ signal, origin = MANUAL_ORIGIN }: RequestOptions & { origin?: TicketOrigin } = {}
) {
	return withDataErrors(signal, async (): Promise<Ticket> => {
		const owner = currentUserId(pb.authStore.record);
		if (owner === null) throw new DataError('session');
		const record = await pb.collection(TICKETS).create<TicketRecord>(
			{
				...originBody(origin),
				owner,
				title: draft.title,
				description: draft.description,
				status: draft.status,
				priority: draft.priority,
				due: dueBody(draft.due),
				project: draft.project ?? '',
				tags: [...(draft.tags ?? [])],
				// A sub-task (ADR-0033); the hook checks level and scope of the parent.
				...(draft.parent ? { parent: draft.parent } : {})
			},
			{ fields: TICKET_DETAIL_FIELDS, expand: TICKET_EXPAND, signal }
		);
		return toTicket(record);
	});
}

/** Guard of an update against overwriting a newer description (ADR-0032 section 6). */
export interface DescriptionGuard {
	/**
	 * `updated` of the ticket the change is based on. The hook refuses the update with
	 * `validation_description_stale` if the stored ticket has another; the body field
	 * `expected_updated` is not stored.
	 */
	expectedUpdated?: string;
}

/** Sends only the changed fields; the answer of the server replaces the ticket. */
export function updateTicket(
	pb: PocketBase,
	id: string,
	patch: TicketPatch,
	{ signal, expectedUpdated }: RequestOptions & DescriptionGuard = {}
) {
	return withDataErrors(signal, async (): Promise<Ticket> => {
		const body: Record<string, string | string[]> = patchBody(patch);
		if (expectedUpdated !== undefined) body.expected_updated = expectedUpdated;
		const record = await pb.collection(TICKETS).update<TicketRecord>(id, body, {
			fields: TICKET_DETAIL_FIELDS,
			expand: TICKET_EXPAND,
			signal
		});
		return toTicket(record);
	});
}

/**
 * Check mark of the list (E2 plan, T-6): done sets the status "done", removing it sets
 * REOPEN_STATUS (OF-E2-3). The hook sets or clears `completed_at`.
 */
export function setTicketDone(
	pb: PocketBase,
	id: string,
	done: boolean,
	options: RequestOptions = {}
): Promise<Ticket> {
	return updateTicket(pb, id, { status: done ? 'done' : REOPEN_STATUS }, options);
}

/**
 * Deletes the ticket; PocketBase deletes its comments and history in the same transaction. Its
 * sources are never deleted (ADR-0031, addendum B): without `sources` the hook gives them back to
 * the inbox; with it the route "Ticket löschen mit Quellenbehandlung" settles them as chosen
 * ('inbox' or 'discard'), in the same transaction.
 */
export function deleteTicket(
	pb: PocketBase,
	id: string,
	{ signal, sources }: RequestOptions & { sources?: SourceHandling } = {}
): Promise<void> {
	return withDataErrors(signal, async () => {
		if (sources === undefined) {
			await pb.collection(TICKETS).delete(id, { signal });
			return;
		}
		await pb.send(`/api/byl/tickets/${encodeURIComponent(id)}/delete`, {
			method: 'POST',
			body: { sources },
			signal
		});
	});
}
