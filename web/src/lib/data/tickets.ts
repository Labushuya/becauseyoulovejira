// Ticket access (ADR-0006 sections 1 to 5). Stateless functions: the PocketBase instance is a
// parameter, so the root integration tests run them against the disposable instance. Filters
// always go through pb.filter().

import type PocketBase from 'pocketbase';
import { addDays, type CalendarDate } from '../domain/berlin-date';
import { EMPTY_LIST_QUERY, NO_PROJECT, activeSearch, type ListQuery } from '../domain/list-query';
import { SOON_DAYS } from '../domain/ordering';
import { isPriority, isStatus, type Status } from '../domain/status';
import {
	REOPEN_STATUS,
	fromDueInput,
	toDueInput,
	type Ticket,
	type TicketDraft,
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

/** Expanded relations of list and detail; also used by the realtime subscription (ADR-0007). */
export const TICKET_EXPAND = 'project,tags';

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
	'completed_at',
	'created',
	'updated',
	'expand.project.id',
	'expand.project.name',
	'expand.project.code',
	'expand.project.archived',
	'expand.tags.id',
	'expand.tags.name'
].join(',');

/** Fields of the detail panel: the list fields plus the description. */
export const TICKET_DETAIL_FIELDS = `${TICKET_LIST_FIELDS},description`;

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
	completed_at: string;
	created: string;
	updated: string;
	expand?: { project?: ProjectRecord; tags?: TagRecord[] };
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
		completedAt: record.completed_at || null,
		created: record.created,
		updated: record.updated
	};
}

export function toTicket(record: TicketRecord): Ticket {
	return { ...toTicketSummary(record), description: record.description ?? '' };
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
		tag: query.tag ?? ''
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
			filter: pb.filter(DONE_FILTER, doneFilterParams(filter)),
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

/**
 * Creates a private ticket of the signed-in user (E2 plan, T-8). Key, scope and number come
 * from the hook; `household` stays empty.
 */
export function createTicket(pb: PocketBase, draft: TicketDraft, { signal }: RequestOptions = {}) {
	return withDataErrors(signal, async (): Promise<Ticket> => {
		const owner = currentUserId(pb.authStore.record);
		if (owner === null) throw new DataError('session');
		const record = await pb.collection(TICKETS).create<TicketRecord>(
			{
				owner,
				title: draft.title,
				description: draft.description,
				status: draft.status,
				priority: draft.priority,
				due: dueBody(draft.due),
				project: draft.project ?? '',
				tags: [...(draft.tags ?? [])]
			},
			{ fields: TICKET_DETAIL_FIELDS, expand: TICKET_EXPAND, signal }
		);
		return toTicket(record);
	});
}

/** Sends only the changed fields; the answer of the server replaces the ticket. */
export function updateTicket(
	pb: PocketBase,
	id: string,
	patch: TicketPatch,
	{ signal }: RequestOptions = {}
) {
	return withDataErrors(signal, async (): Promise<Ticket> => {
		const record = await pb.collection(TICKETS).update<TicketRecord>(id, patchBody(patch), {
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

/** Deletes the ticket; PocketBase deletes its comments and history in the same transaction. */
export function deleteTicket(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<void> {
	return withDataErrors(signal, async () => {
		await pb.collection(TICKETS).delete(id, { signal });
	});
}
