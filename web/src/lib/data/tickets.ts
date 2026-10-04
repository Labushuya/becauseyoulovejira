// Ticket access (ADR-0006 sections 1 to 5). Stateless functions: the PocketBase instance is a
// parameter, so the root integration tests run them against the disposable instance. Filters
// always go through pb.filter().

import type PocketBase from 'pocketbase';
import { addDays, type CalendarDate } from '../domain/berlin-date';
import { colorOf } from '../domain/colors';
import {
	duplicateRequestBody,
	toDuplicateOutcome,
	type DuplicateOutcome,
	type DuplicateRequest
} from '../domain/duplicate';
import { isInboxChannel } from '../domain/inbox';
import { EMPTY_LIST_QUERY, NO_PROJECT, activeSearch, type ListQuery } from '../domain/list-query';
import { SOON_DAYS } from '../domain/ordering';
import { channelsOf, type SourceFamily } from '../domain/source';
import type { SourceHandling } from '../domain/sources';
import type { CompletionChoice } from '../domain/subtasks';
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
import { areaFilter, clientHousehold } from './area';
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
	// Area of the ticket, for the rules of the ticket picker (ADR-0042).
	'scope',
	// Who created it: moving it into the private area is offered to the creator (ADR-0061 §4).
	'owner',
	// Own color (ADR-0052); unknown to the server before the migration 1790203400.
	'color',
	'completed_at',
	'created',
	'updated',
	'expand.project.id',
	'expand.project.name',
	'expand.project.code',
	'expand.project.archived',
	'expand.project.color',
	'expand.tags.id',
	'expand.tags.name',
	'expand.parent.id',
	'expand.parent.key',
	'expand.parent.title'
].join(',');

/**
 * Fields of the detail panel: the list fields plus the description, the inbox entry and the pinned
 * comment (ADR-0044; unknown to the server before the migration 1790202600).
 */
export const TICKET_DETAIL_FIELDS = `${TICKET_LIST_FIELDS},description,source_item,pinned_comment`;

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
	/** Pinned comment, '' without one; missing before the migration 1790202600 (ADR-0044). */
	pinned_comment?: string;
	scope?: string;
	owner?: string;
	/** Own color, '' for "wie Projekt"; missing before the migration 1790203400 (ADR-0052). */
	color?: string;
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
		...(record.scope ? { scope: record.scope } : {}),
		...(record.owner ? { owner: record.owner } : {}),
		// Left out while the server does not know the field yet (before the restart, ADR-0052).
		...(record.color !== undefined ? { color: colorOf(record.color) } : {}),
		completedAt: record.completed_at || null,
		created: record.created,
		updated: record.updated
	};
}

export function toTicket(record: TicketRecord): Ticket {
	return {
		...toTicketSummary(record),
		description: record.description ?? '',
		sourceItem: record.source_item || null,
		// Left out while the server does not know the field yet (before the restart).
		...(record.pinned_comment !== undefined ? { pinnedComment: record.pinned_comment || null } : {})
	};
}

function dueBody(due: CalendarDate | null): string {
	return fromDueInput(due ?? '');
}

/** Request body of an update. */
type PatchBody = Record<string, string | string[] | boolean>;

/** Request body of a patch: only the given fields (ADR-0006 section 5). */
function patchBody(patch: TicketPatch): PatchBody {
	const body: PatchBody = {};
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
	if (patch.blocksParent !== undefined) body.blocks_parent = patch.blocksParent;
	// Pins a comment of the ticket, '' releases the pin (ADR-0044); the hook checks the comment.
	if (patch.pinnedComment !== undefined) body.pinned_comment = patch.pinnedComment ?? '';
	// '' is "wie Projekt" (ADR-0052); PocketBase checks the key of the palette.
	if (patch.color !== undefined) body.color = patch.color ?? '';
	// The only change a client may make to the series: leaving it (ADR-0023 section 1).
	if (patch.detachSeries === true) body.recurrence = '';
	return body;
}

/**
 * All tickets that are not done, unsorted; the list sorts them (ADR-0006 section 2). Like every list
 * here only those of the area of the client (E7-3, data/area.ts).
 */
export function listOpenTickets(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<TicketSummary[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(TICKETS).getFullList<TicketRecord>({
			batch: 500,
			filter: areaFilter(pb, 'status != {:done}', { done: 'done' satisfies Status }),
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
			filter: areaFilter(pb, 'parent != {:none}', { none: '' }),
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
	/**
	 * The chosen project has sub projects and the query takes them in (ADR-0034 section 6): the
	 * expression then asks `project.parent` as well. Only set when the catalog knows sub projects,
	 * so a server before the migration never gets the unknown field.
	 */
	withSubProjects?: boolean;
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
			filter: areaFilter(pb, OPEN_SEARCH_FILTER, {
				done: 'done' satisfies Status,
				q: likeText(search)
			}),
			fields: 'id',
			signal
		});
		return records.map((record) => record.id);
	});
}

/** Done tickets per page of the ticket picker (ADR-0042 section 4). */
export const PICKER_DONE_PAGE_SIZE = 20;

/** What the ticket picker asks the server for when it shows done tickets. */
export interface DoneChoiceQuery {
	/**
	 * Loose LIKE patterns of the search words (`loosePattern` in domain/ticket-picker.ts), at most
	 * PICKER_SERVER_WORDS; each must match key or title. The picker narrows the answer exactly.
	 */
	patterns: readonly string[];
	/** Chosen project: its ID, NO_PROJECT for tickets without one, null for all. */
	project: string | null;
	/**
	 * The chosen project has sub projects (the catalog knows them, ADR-0034): the expression then
	 * takes their tickets in through `project.parent`; never set before the migration.
	 */
	withSubProjects?: boolean;
}

/** One page of done tickets for the ticket picker. */
export interface TicketChoicePage {
	items: TicketSummary[];
	/** True if a further page may hold more (the page was full). */
	hasMore: boolean;
}

/**
 * Done tickets of the ticket picker (ADR-0042 section 4): up to five loose patterns (unused ones
 * are '' and off), each on key or title, and the project filter of the list. The project clause
 * with sub projects is DONE_FAMILY_FILTER, as for the list.
 */
const DONE_CHOICE_FILTER = [
	'status = {:done}',
	'({:w1} = "" || key ~ {:w1} || title ~ {:w1})',
	'({:w2} = "" || key ~ {:w2} || title ~ {:w2})',
	'({:w3} = "" || key ~ {:w3} || title ~ {:w3})',
	'({:w4} = "" || key ~ {:w4} || title ~ {:w4})',
	'({:w5} = "" || key ~ {:w5} || title ~ {:w5})',
	'({:project} = "" || {:project} = {:noProject} || project = {:project})',
	'({:project} != {:noProject} || project = "")'
].join(' && ');

/** Expression of the done choices: DONE_CHOICE_FILTER, with sub projects also their clause. */
function doneChoiceExpression(query: DoneChoiceQuery): string {
	const parts = [DONE_CHOICE_FILTER];
	if (query.withSubProjects === true && query.project !== null) parts.push(DONE_FAMILY_FILTER);
	return parts.join(' && ');
}

/** Parameters of DONE_CHOICE_FILTER (and DONE_FAMILY_FILTER); an unset value is '' and off. */
function doneChoiceParams(query: DoneChoiceQuery): Record<string, string> {
	const family = query.withSubProjects === true && query.project !== null;
	const [w1 = '', w2 = '', w3 = '', w4 = '', w5 = ''] = query.patterns;
	return {
		done: 'done' satisfies Status,
		w1,
		w2,
		w3,
		w4,
		w5,
		project: family ? '' : (query.project ?? ''),
		noProject: NO_PROJECT,
		...(family ? { family: query.project ?? '' } : {})
	};
}

/**
 * One page of done tickets for the ticket picker, most recently changed first (ADR-0042 section 4).
 * Tickets in the trash never come back: the API rules hide them (ADR-0037 section 3).
 */
export function listDoneTicketChoices(
	pb: PocketBase,
	query: DoneChoiceQuery,
	page: number,
	{ signal }: RequestOptions = {}
): Promise<TicketChoicePage> {
	return withDataErrors(signal, async () => {
		const result = await pb.collection(TICKETS).getList<TicketRecord>(page, PICKER_DONE_PAGE_SIZE, {
			filter: areaFilter(pb, doneChoiceExpression(query), doneChoiceParams(query)),
			sort: '-updated,-id',
			fields: TICKET_LIST_FIELDS,
			expand: TICKET_EXPAND,
			skipTotal: true,
			signal
		});
		return {
			items: result.items.map(toTicketSummary),
			hasMore: result.items.length === PICKER_DONE_PAGE_SIZE
		};
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
 * 2) is part of the expression, because the list does not load the description. "Wiederkehrend"
 * (plan OR-2) compares `recurrence`: a ticket of a series has it set.
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
	'({:tag} = "" || tags.id ?= {:tag})',
	'({:recurring} != "recurring" || recurrence != "")',
	'({:recurring} != "once" || recurrence = "")'
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
	'(source = {:s1} || source = {:s2} || source = {:s3} || source = {:s4} || ({:withEmpty} = "1" && source = ""))'
].join(' && ');

// Four since the own inbox (ADR-0038): "Manuell" holds manual, quick, clipboard and api.
const MAX_FAMILY_CHANNELS = 4;

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
		s4: channels[3] ?? first,
		withEmpty: family === 'manual' ? '1' : ''
	};
}

/**
 * A project with its sub projects (ADR-0034 section 6): the tickets of the project and of every
 * project whose parent it is. Joins DONE_FILTER only then (see DoneFilter.withSubProjects); the
 * project clause of DONE_FILTER is switched off meanwhile.
 */
const DONE_FAMILY_FILTER = [
	'({:family} != "" && (project = {:family} || project.parent = {:family}))'
].join(' && ');

/** Whether the expression takes the sub projects of the chosen project in. */
function takesSubProjects({ query, withSubProjects }: DoneFilter): boolean {
	return (
		withSubProjects === true &&
		query.subProjects &&
		query.project !== null &&
		query.project !== NO_PROJECT
	);
}

/**
 * Expression of the done tickets: DONE_FILTER, with a chosen source also its clause, and with sub
 * projects the clause of the project family.
 */
function doneFilterExpression(done: DoneFilter): string {
	const parts = [DONE_FILTER];
	if (done.query.source !== null) parts.push(DONE_SOURCE_FILTER);
	if (takesSubProjects(done)) parts.push(DONE_FAMILY_FILTER);
	return parts.join(' && ');
}

/**
 * Parameters of DONE_FILTER; an unset filter is '', which switches its conditions off. With sub
 * projects the project goes to DONE_FAMILY_FILTER instead of the plain project clause.
 */
function doneFilterParams(done: DoneFilter): Record<string, string> {
	const { query, today } = done;
	const family = takesSubProjects(done);
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
		project: family ? '' : (query.project ?? ''),
		noProject: NO_PROJECT,
		tag: query.tag ?? '',
		recurring: query.recurring ?? '',
		...(query.source === null ? {} : sourceParams(query.source)),
		...(family ? { family: query.project ?? '' } : {})
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
			filter: areaFilter(pb, doneFilterExpression(filter), doneFilterParams(filter)),
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

/** Done tickets of the calendar per page (ADR-0053 §5). */
export const CALENDAR_DONE_PAGE_SIZE = 200;

/** Days of the calendar: the first and the last one shown, both included. */
export interface DueRange {
	from: CalendarDate;
	to: CalendarDate;
}

/** Done tickets due within a range of days, both included. */
const DONE_DUE_RANGE_FILTER = [
	'status = {:doneStatus}',
	'due >= {:firstDayOfPeriod}',
	'due <= {:lastDayOfPeriod}'
].join(' && ');

/**
 * One page of the done tickets due in the shown period of the calendar (ADR-0053 §5), by due date,
 * then most recently completed. Without the filters of the list: the calendar filters them in the
 * client like the open tickets, so a change of a filter needs no request. `hasMore` is true when the
 * page was full.
 */
export function listDoneTicketsDue(
	pb: PocketBase,
	range: DueRange,
	page: number,
	{ signal }: RequestOptions = {}
): Promise<TicketChoicePage> {
	return withDataErrors(signal, async () => {
		const result = await pb
			.collection(TICKETS)
			.getList<TicketRecord>(page, CALENDAR_DONE_PAGE_SIZE, {
				filter: areaFilter(pb, DONE_DUE_RANGE_FILTER, {
					doneStatus: 'done' satisfies Status,
					firstDayOfPeriod: fromDueInput(range.from),
					lastDayOfPeriod: fromDueInput(range.to)
				}),
				sort: 'due,-completed_at,-id',
				fields: TICKET_LIST_FIELDS,
				expand: TICKET_EXPAND,
				skipTotal: true,
				signal
			});
		return {
			items: result.items.map(toTicketSummary),
			hasMore: result.items.length === CALENDAR_DONE_PAGE_SIZE
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
 * Creates a ticket of the signed-in user (E2 plan, T-8) in the area of the client (E7-3), or in
 * `household` ('' for "Privat") when it belongs to a record of a known area (a sub-task, an entry of
 * the inbox). Key, scope and number come from the hook. `origin` is the form by default (source
 * "manual"); with an inbox entry the hook converts the entry in the same transaction (ADR-0014
 * section 2).
 */
export function createTicket(
	pb: PocketBase,
	draft: TicketDraft,
	{
		signal,
		origin = MANUAL_ORIGIN,
		household
	}: RequestOptions & { origin?: TicketOrigin; household?: string } = {}
) {
	return withDataErrors(signal, async (): Promise<Ticket> => {
		const owner = currentUserId(pb.authStore.record);
		if (owner === null) throw new DataError('session');
		const area = household ?? clientHousehold(pb);
		const record = await pb.collection(TICKETS).create<TicketRecord>(
			{
				...originBody(origin),
				owner,
				// Only in a household; a private ticket sends no field, as before E7-3.
				...(area !== '' ? { household: area } : {}),
				title: draft.title,
				description: draft.description,
				status: draft.status,
				priority: draft.priority,
				due: dueBody(draft.due),
				project: draft.project ?? '',
				tags: [...(draft.tags ?? [])],
				// A sub-task (ADR-0033); the hook checks level and scope of the parent.
				...(draft.parent ? { parent: draft.parent } : {}),
				// An own color (ADR-0052); without one the ticket shows the color of its project.
				...(draft.color ? { color: draft.color } : {})
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

/**
 * Completing a ticket with open sub-tasks that block it (ADR-0033 section 2): `force` completes it
 * anyway, `complete_children` completes those sub-tasks with it, atomically in the hook. Neither
 * body field is stored.
 */
export interface CompletionOptions {
	completion?: CompletionChoice;
}

/** Options of an update besides the request options. */
export type UpdateOptions = DescriptionGuard & CompletionOptions;

/** Sends only the changed fields; the answer of the server replaces the ticket. */
export function updateTicket(
	pb: PocketBase,
	id: string,
	patch: TicketPatch,
	{ signal, expectedUpdated, completion }: RequestOptions & UpdateOptions = {}
) {
	return withDataErrors(signal, async (): Promise<Ticket> => {
		const body = patchBody(patch);
		if (expectedUpdated !== undefined) body.expected_updated = expectedUpdated;
		if (completion !== undefined) body[completion] = true;
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
 * REOPEN_STATUS (OF-E2-3). The hook sets or clears `completed_at`. `completion` answers the
 * question about open blocking sub-tasks (ADR-0033 section 2).
 */
export function setTicketDone(
	pb: PocketBase,
	id: string,
	done: boolean,
	options: RequestOptions & CompletionOptions = {}
): Promise<Ticket> {
	return updateTicket(pb, id, { status: done ? 'done' : REOPEN_STATUS }, options);
}

/** Answer of moving a ticket to the trash (ADR-0037 §7): `updated` is the base of "Rückgängig". */
export interface TrashMove {
	id: string;
	updated: string;
	tickets: { id: string; key: string; updated: string }[];
}

function toTrashMove(value: unknown): TrashMove | null {
	if (typeof value !== 'object' || value === null) return null;
	const { id, updated, tickets } = value as Record<string, unknown>;
	if (typeof id !== 'string' || typeof updated !== 'string' || !Array.isArray(tickets)) return null;
	const list: TrashMove['tickets'] = [];
	for (const entry of tickets as unknown[]) {
		if (typeof entry !== 'object' || entry === null) return null;
		const { id: ticketId, key, updated: ticketUpdated } = entry as Record<string, unknown>;
		if (
			typeof ticketId !== 'string' ||
			typeof key !== 'string' ||
			typeof ticketUpdated !== 'string'
		)
			return null;
		list.push({ id: ticketId, key, updated: ticketUpdated });
	}
	return { id, updated, tickets: list };
}

/**
 * Deletes the ticket: since the trash (ADR-0037) it moves there with its sub-tasks. Its sources
 * are never deleted (ADR-0031, addendum B): without `sources` the hook gives them back to the
 * inbox; with it the route "Ticket löschen mit Quellenbehandlung" settles them as chosen ('inbox'
 * or 'discard'), in the same transaction, and answers the move for "Rückgängig" (null before the
 * migration of the trash and without `sources`).
 */
export function deleteTicket(
	pb: PocketBase,
	id: string,
	{ signal, sources }: RequestOptions & { sources?: SourceHandling } = {}
): Promise<TrashMove | null> {
	return withDataErrors(signal, async () => {
		if (sources === undefined) {
			await pb.collection(TICKETS).delete(id, { signal });
			return null;
		}
		const answer: unknown = await pb.send(`/api/byl/tickets/${encodeURIComponent(id)}/delete`, {
			method: 'POST',
			body: { sources },
			signal
		});
		return toTrashMove(answer);
	});
}

/**
 * "Ticket duplizieren" (ADR-0045): the route creates the duplicate with everything chosen (new
 * sub-tasks, copied comments, the copy of the main source) in one transaction, or nothing. A ticket
 * the user may not see, also one in the trash, is not found; refusals come per field (title,
 * status, project, source).
 */
export function duplicateTicket(
	pb: PocketBase,
	id: string,
	request: DuplicateRequest,
	{ signal }: RequestOptions = {}
): Promise<DuplicateOutcome> {
	return withDataErrors(signal, async () => {
		const answer: unknown = await pb.send(`/api/byl/tickets/${encodeURIComponent(id)}/duplicate`, {
			method: 'POST',
			body: duplicateRequestBody(request),
			signal
		});
		const outcome = toDuplicateOutcome(answer);
		if (outcome === null) throw new DataError('server');
		return outcome;
	});
}
