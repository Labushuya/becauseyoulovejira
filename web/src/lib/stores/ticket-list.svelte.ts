// State of the ticket list (ADR-0006 sections 1 to 5; E2 plan, package 5; E3 plan, packages 5,
// 10, 11 and 13). Open tickets are loaded in full, filtered, sorted and grouped client side
// (ADR-0013 section 1); the search comes from the server as a set of IDs (section 2). Since ER-1
// (ADR-0066) "Aufgaben" shows only open work: done tickets have their own view with its own store
// (stores/done-list.svelte.ts); this one knows done ones only as sub-tasks (ADR-0033) and while a
// just checked row offers "Rückgängig". The store is created per app layout and handed out
// through a typed context, so a logout leaves no data behind. Own answers and realtime events (ADR-0007) go through the same
// idempotent `upsert` and `remove`; after a reconnection the store reconciles once with the
// server. The "new" mark (ADR-0015, E4 plan package 4) is derived from the own read rows and the
// base line of the user. Results of actions and failures of the check mark go out as flags
// (ADR-0025 section 8): a checked row leaves at once, "Rückgängig" stands in its flag.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { listReads, markAllRead, markRead, type TicketRead } from '$lib/data/reads';
import {
	createTicket,
	listOpenTickets,
	listSubtaskTickets,
	searchOpenTicketIds,
	setTicketDone,
	updateTicket,
	type DescriptionGuard
} from '$lib/data/tickets';
import { householdOfScope } from '$lib/domain/area';
import { berlinToday, msUntilNextBerlinMidnight, type CalendarDate } from '$lib/domain/berlin-date';
import { SERIES_MOVE_HINT } from '$lib/domain/calendar';
import { formatCalendarDate } from '$lib/domain/format';
import { NO_SUB_PROJECTS, matchesFilter, type SubProjectsOf } from '$lib/domain/filter';
import { chooseAllOpen, countCards, sameCards, type CardCounts } from '$lib/domain/filter-cards';
import { groupTicketLevels, type GroupNode } from '$lib/domain/grouping';
import {
	EMPTY_LIST_QUERY,
	FILTER_KEYS,
	activeSearch,
	type ListQuery
} from '$lib/domain/list-query';
import { columnOrder, ticketOrder, type ResolveProject } from '$lib/domain/ordering';
import { REOPEN_DETACHED_LABEL, REOPEN_REFUSALS } from '$lib/domain/recurrence-rule';
import { NO_SERIES, type SeriesChangeSink } from '$lib/domain/series-template';
import type { Status } from '$lib/domain/status';
import {
	compareSubtasks,
	openBlocking,
	subtaskCountText,
	subtaskProgress,
	type CompletionChoice,
	type SubtaskProgress
} from '$lib/domain/subtasks';
import {
	DEFAULT_PRIORITY,
	DEFAULT_STATUS,
	REOPEN_STATUS,
	type TicketDraft,
	type TicketPatch,
	type TicketSummary
} from '$lib/domain/ticket';
import { countNew, isNew, unreadSinceOf } from '$lib/domain/unread';
import { pinnedTickets } from '$lib/domain/pins';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { PinnedSource } from './pins.svelte';
import { hold, type LiveSource } from './realtime';

/** Delay after the Berlin midnight before "today" is computed again (E2 plan, T-3). */
export const MIDNIGHT_BUFFER_MS = 1000;

/**
 * Pause after the last change of the search text before it applies, and after the last ticket
 * event before the IDs of an active search are asked for again (E3 plan, T-15).
 */
export const SEARCH_DEBOUNCE_MS = 250;

/** idle: not requested; loading: first request running; ready: loaded; error: loading failed. */
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Data access of the list; tests pass a fake, the app binds the data layer to its client. */
export interface TicketListData {
	listOpen(options: RequestOptions): Promise<TicketSummary[]>;
	/**
	 * All sub-tasks, open and done (ADR-0033); without it the store knows only the sub-tasks that
	 * reach it as answers or events.
	 */
	listSubtasks?(options: RequestOptions): Promise<TicketSummary[]>;
	/**
	 * Creates a ticket ("Unteraufgabe hinzufügen", ADR-0033 section 4), in `household` ('' for
	 * "Privat") when given, else in the area of the client (E7-3).
	 */
	create?(draft: TicketDraft, household?: string): Promise<TicketSummary>;
	/** IDs of the open tickets whose title, description or key contain the search text. */
	searchOpen(search: string, options: RequestOptions): Promise<string[]>;
	/** `completion` answers the question about open blocking sub-tasks (ADR-0033 section 2). */
	setDone(id: string, done: boolean, completion?: CompletionChoice): Promise<TicketSummary>;
	/** `expectedUpdated` refuses the change if the ticket changed since (ADR-0032 section 6). */
	update(id: string, patch: TicketPatch, options?: DescriptionGuard): Promise<TicketSummary>;
}

/** Session checks before and after requests (ADR-0006 section 4); `auth` provides both. */
export interface SessionGuard {
	/** False if there is no valid session; an expired token ends it without a request. */
	ensureValid(): boolean;
	logout(): void;
}

export function ticketListData(pb: PocketBase): TicketListData {
	return {
		listOpen: (options) => listOpenTickets(pb, options),
		listSubtasks: (options) => listSubtaskTickets(pb, options),
		create: (draft, household) => createTicket(pb, draft, { household }),
		searchOpen: (search, options) => searchOpenTicketIds(pb, search, options),
		setDone: (id, done, completion) => setTicketDone(pb, id, done, { completion }),
		update: (id, patch, options) => updateTicket(pb, id, patch, options)
	};
}

/** Read rows and base line of the "new" mark (ADR-0015); tests pass a fake. */
export interface ReadsData {
	/** Base line of the signed-in user, null before the migration (nothing is new then). */
	unreadSince(): string | null;
	list(since: string, options: RequestOptions): Promise<TicketRead[]>;
	/** The own row, or null if it existed already. */
	markRead(ticketId: string): Promise<TicketRead | null>;
	/** Moves the base line to now and returns it. */
	markAllRead(): Promise<string>;
}

export function readsData(pb: PocketBase): ReadsData {
	return {
		unreadSince: () => unreadSinceOf(pb.authStore.record),
		list: (since, options) => listReads(pb, since, options),
		markRead: (ticketId) => markRead(pb, ticketId),
		markAllRead: () => markAllRead(pb)
	};
}

/** Outcome of "Unteraufgabe hinzufügen"; a failure carries a message unless nothing is to be shown. */
export type SubtaskResult =
	{ ok: true; ticket: TicketSummary } | { ok: false; message: string | null };

/** Key of a read row that is known only from the answer "already read" (no row ID). */
const LOCAL_READ = 'local:';

/** Code of the hook for a change based on an older `updated` (ADR-0032 section 6). */
const STALE_CODE = 'validation_description_stale';

/** A sub-task completed together with its parent, and its status before (ADR-0033 section 2). */
export interface CompletedChild {
	id: string;
	key: string;
	previousStatus: Status;
}

/** A just checked ticket whose flag offers "Rückgängig" (ADR-0025 section 8). */
interface Undoable {
	key: string;
	/** Status before "done", restored by "Rückgängig" (OF-E2-3). */
	previousStatus: Status;
	/** Sub-tasks completed with it; "Rückgängig" restores them as well. */
	children: readonly CompletedChild[];
	flagId: string;
}

/**
 * Question before completing a ticket whose open sub-tasks block it (ADR-0033 section 2): "N
 * Unteraufgaben sind noch offen – trotzdem erledigen?".
 */
export interface CompletionQuestion {
	id: string;
	key: string;
	/** Number of open blocking sub-tasks and (some of) their keys. */
	count: number;
	keys: readonly string[];
	/** Status of the ticket before "done", for "Rückgängig". */
	previousStatus: Status;
}

/** The sub-tasks a completion takes along, with their status before. */
export function completedChildren(
	blocking: readonly TicketSummary[],
	choice: CompletionChoice
): CompletedChild[] {
	if (choice !== 'complete_children') return [];
	return blocking.map((child) => ({ id: child.id, key: child.key, previousStatus: child.status }));
}

/** Count and keys of open blocking sub-tasks in a refusal of the hook, null for another error. */
export function openChildrenOf(error: unknown): { count: number; keys: string[] } | null {
	const status = toDataError(error).fields.status;
	if (status?.code !== 'validation_parent_open_children') return null;
	const count = typeof status.params?.count === 'number' ? status.params.count : 1;
	const raw = status.params?.keys;
	const keys = Array.isArray(raw)
		? raw.filter((key): key is string => typeof key === 'string')
		: [];
	return { count, keys };
}

/**
 * Text of a refused reopening of an instance (ADR-0023 section 3 and addendum 4): another ticket of
 * the series is open, and the ticket may come back as a normal one. Null for another error.
 */
export function reopenRefusalOf(error: unknown): string | null {
	const status = toDataError(error).fields.status;
	return status !== undefined && REOPEN_REFUSALS.includes(status.code) ? status.message : null;
}

/** The filters besides the search, which applies after a pause and announces on its own. */
const FILTERS_BESIDES_SEARCH = FILTER_KEYS.filter((key) => key !== 'search');

function sameFiltersBesidesSearch(a: ListQuery, b: ListQuery): boolean {
	return (
		FILTERS_BESIDES_SEARCH.every((key) => a[key] === b[key]) &&
		a.subProjects === b.subProjects &&
		sameCards(a.cards, b.cards)
	);
}

/** Text of the live region after a filter change (E3 plan, package 10). */
export function countMessage(count: number): string {
	if (count === 0) return 'Keine Tickets für diese Filter.';
	return count === 1 ? '1 Ticket.' : `${count} Tickets.`;
}

export interface TicketListOptions {
	/** Clock of "today"; tests pass a fixed one. */
	now?: () => number;
	/**
	 * Project of a ticket for the column sort "Projekt" (E3 plan, package 9): the app passes the
	 * catalog (`catalog.projectOf`), so a rename sorts again at once; default is `expand`.
	 */
	projectOf?: ResolveProject<TicketSummary>;
	/**
	 * Sub project IDs of a project (ADR-0034): a project filter takes them in. The app passes the
	 * catalog; without it no project has sub projects.
	 */
	subProjectsOf?: SubProjectsOf;
	/** Read rows and base line; without them nothing is marked as new. */
	reads?: ReadsData;
	/** Flags of the app (results, "Rückgängig", failures); without them nothing is shown. */
	flags?: FlagSink;
	/**
	 * The rules: a cell that changed an open ticket of a series offers the change for its template
	 * (plan WV); without them nothing is offered.
	 */
	series?: SeriesChangeSink;
	/**
	 * The own pins (ADR-0064): their open tickets stand in the section "Angeheftet" above the list,
	 * whatever the filters, and not again below; without them nothing is pinned.
	 */
	pins?: PinnedSource;
}

export class TicketListStore {
	readonly #data: TicketListData;
	readonly #session: SessionGuard;
	readonly #now: () => number;
	readonly #projectOf: ResolveProject<TicketSummary>;
	readonly #subProjectsOf: SubProjectsOf;

	readonly #open = new SvelteMap<string, TicketSummary>();
	/**
	 * Every sub-task, open and done (ADR-0033), for the section "Unteraufgaben" and the progress of
	 * the parents. Open ones stand in #open as well.
	 */
	readonly #subtasks = new SvelteMap<string, TicketSummary>();
	/** Just checked tickets whose flag still offers "Rückgängig", keyed by ticket ID. */
	readonly #undoable = new SvelteMap<string, Undoable>();
	/** Flags of moved due dates whose "Rückgängig" still stands, keyed by ticket ID. */
	readonly #movedDue = new SvelteMap<string, string>();
	readonly #flags: FlagSink;
	readonly #series: SeriesChangeSink;
	/** The own pins (ADR-0064), null without them. */
	readonly #pins: PinnedSource | null;
	/** Target state of running check mark requests, keyed by ticket ID. */
	readonly #pending = new SvelteMap<string, boolean>();
	/** Question before completing a ticket with open blocking sub-tasks (ADR-0033 section 2). */
	#completion = $state<CompletionQuestion | null>(null);
	#completing = $state(false);
	#completionError = $state<string | null>(null);
	/**
	 * IDs of deleted tickets: a late answer must not bring them back. Only the server brings one
	 * back, restored from the trash (ADR-0037): by a realtime update (`#arrive`) or in the snapshot
	 * of a reconciliation (`#revive`).
	 */
	readonly #deleted = new SvelteSet<string>();
	/**
	 * IDs changed by answers or events while a reconciliation runs: its older snapshot must not
	 * remove them (e.g. a ticket created in the meantime). Null while none runs.
	 */
	#touched: Set<string> | null = null;

	#openController: AbortController | null = null;
	#reconcileController: AbortController | null = null;
	/** Search the URL asks for (from SEARCH_MIN_LENGTH characters), applied or waiting for the pause. */
	#wantedSearch: string | null = null;
	#searchTimer: ReturnType<typeof setTimeout> | undefined;
	#searchRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	#searchController: AbortController | null = null;

	#today = $state<CalendarDate>('');
	#query = $state<ListQuery>(EMPTY_LIST_QUERY);
	#openState = $state<LoadState>('idle');
	#openError = $state<string | null>(null);
	#announcement = $state('');
	/** Search that narrows the list (after the pause), null without one. */
	#search = $state<string | null>(null);
	/**
	 * Open tickets that match the search. A newer search keeps the older IDs until its answer, so
	 * the table keeps its rows instead of flickering; null shows the list without search.
	 */
	#searchIds = $state<ReadonlySet<string> | null>(null);
	#searchBusy = $state(false);
	#searchError = $state<string | null>(null);

	#openList = $derived([...this.#open.values()].sort(ticketOrder(this.#today)));
	/** Visible open rows: filtered, narrowed by the search and in the column sort. */
	#visibleList = $derived.by(() => {
		const query = this.#query;
		const today = this.#today;
		const order = columnOrder(query.sort, today, this.#projectOf);
		const ids = this.#search === null ? null : this.#searchIds;
		const subProjectsOf = this.#subProjectsOf;
		return this.#openList
			.filter(
				(ticket) =>
					matchesFilter(ticket, query, today, subProjectsOf) && (ids === null || ids.has(ticket.id))
			)
			.sort(order);
	});
	/**
	 * Open pinned tickets of the area in the order of pinning (ADR-0064), whatever the filters and
	 * the search: the section "Angeheftet".
	 */
	#pinnedList = $derived.by(() => {
		const pins = this.#pins;
		return pins === null ? [] : pinnedTickets(pins.ticketIds, (id) => this.#open.get(id));
	});
	#pinnedIds = $derived(new SvelteSet(this.#pinnedList.map((ticket) => ticket.id)));
	/** The visible rows without the pinned ones, which stand in their own section above them. */
	#listedList = $derived.by(() => {
		const pinned = this.#pinnedIds;
		if (pinned.size === 0) return this.#visibleList;
		return this.#visibleList.filter((ticket) => !pinned.has(ticket.id));
	});
	#groupList = $derived.by((): GroupNode<TicketSummary>[] | null => {
		const { grouping, subGrouping } = this.#query;
		if (grouping === null) return null;
		return groupTicketLevels(this.#listedList, grouping, subGrouping, this.#today, this.#projectOf);
	});
	/**
	 * Numbers of the filter cards (FI-1): the open tickets that pass the detail filters and the
	 * search, without the cards, so each card counts its own tickets.
	 */
	#cardCounts = $derived.by(() => {
		const query = { ...this.#query, cards: chooseAllOpen() };
		const today = this.#today;
		const ids = this.#search === null ? null : this.#searchIds;
		const subProjectsOf = this.#subProjectsOf;
		return countCards(
			[...this.#open.values()].filter(
				(ticket) =>
					matchesFilter(ticket, query, today, subProjectsOf) && (ids === null || ids.has(ticket.id))
			),
			today
		);
	});
	/** Sub-tasks per parent in the order of the section: open ones first, then by creation. */
	#subtasksByParent = $derived.by(() => {
		const byParent: Record<string, TicketSummary[]> = {};
		for (const ticket of this.#subtasks.values()) {
			const parentId = ticket.parentId;
			if (!parentId) continue;
			(byParent[parentId] ??= []).push(ticket);
		}
		for (const children of Object.values(byParent)) children.sort(compareSubtasks);
		return byParent;
	});

	readonly #reads: ReadsData | null;
	/** Own read rows: row ID (or LOCAL_READ + ticket ID) to ticket ID. */
	readonly #readRows = new SvelteMap<string, string>();
	/** Tickets with a running request of `markRead`. */
	readonly #marking = new SvelteSet<string>();
	#readsController: AbortController | null = null;
	/** Base line of the user; null: nothing is new (no data or before the migration). */
	#unreadSince = $state<string | null>(null);
	/** The read rows are loaded; until then no ticket counts as new, so nothing flashes up. */
	#readsReady = $state(false);
	#readTickets = $derived(new SvelteSet(this.#readRows.values()));
	#newCounts = $derived(
		countNew(this.#open.values(), this.#readTickets, this.#readsReady ? this.#unreadSince : null)
	);

	constructor(
		data: TicketListData,
		session: SessionGuard,
		{
			now = Date.now,
			projectOf = (ticket) => ticket.project,
			subProjectsOf = NO_SUB_PROJECTS,
			reads,
			flags = SILENT_FLAGS,
			series = NO_SERIES,
			pins
		}: TicketListOptions = {}
	) {
		this.#data = data;
		this.#session = session;
		this.#now = now;
		this.#projectOf = projectOf;
		this.#subProjectsOf = subProjectsOf;
		this.#today = berlinToday(now());
		this.#pins = pins ?? null;
		this.#reads = reads ?? null;
		this.#flags = flags;
		this.#series = series;
	}

	/** True if the ticket is new for the signed-in user (ADR-0015 section 2). */
	isNew(ticket: Pick<TicketSummary, 'id' | 'created' | 'status'>): boolean {
		if (!this.#readsReady) return false;
		return isNew(ticket, this.#readTickets, this.#unreadSince);
	}

	/** New tickets that are not done (button "Alle als gelesen markieren"). */
	get newCount(): number {
		return this.#newCounts.total;
	}

	/** New tickets of a project (project tile, ADR-0015 section 5). */
	newInProject(projectId: string): number {
		return this.#newCounts.byProject.get(projectId) ?? 0;
	}

	/** New tickets that belong to a project (switch "Projekte"). */
	get newInProjects(): number {
		let sum = 0;
		for (const count of this.#newCounts.byProject.values()) sum += count;
		return sum;
	}

	/**
	 * Marks a ticket as read: opened in the panel or created one by one (ADR-0015 section 3).
	 * Costs a request only for a new ticket; a row that exists already counts as success, a failure
	 * leaves the mark (the next opening tries again).
	 */
	async markRead(ticket: Pick<TicketSummary, 'id' | 'created' | 'status'>): Promise<void> {
		const id = ticket.id;
		if (this.#reads === null || this.#marking.has(id) || !this.isNew(ticket)) return;
		if (!this.#session.ensureValid()) return;
		this.#marking.add(id);
		try {
			const row = await this.#reads.markRead(id);
			this.#readRows.set(row === null ? `${LOCAL_READ}${id}` : row.id, id);
		} catch (error) {
			this.#failureMessage(error);
		} finally {
			this.#marking.delete(id);
		}
	}

	/** "Alle als gelesen markieren" (ADR-0015 section 4): the base line moves to now. */
	async markAllRead(): Promise<void> {
		if (this.#reads === null || !this.#session.ensureValid()) return;
		try {
			this.#unreadSince = await this.#reads.markAllRead();
			this.#flags.show({ tone: 'success', title: 'Alle Tickets als gelesen markiert.' });
		} catch (error) {
			this.#fail(error, 'Die Tickets konnten nicht als gelesen markiert werden.');
		}
	}

	/** Open tickets in the default order (P-2). */
	get open(): readonly TicketSummary[] {
		return this.#openList;
	}

	/**
	 * Rows of the table above the section "Erledigt" (E3 plan, packages 5, 9 and 10): the open
	 * tickets that pass the filters of the URL, in its column sort (T-5; ties and no sort: the
	 * default order); none with the status filter "Erledigt". Pinned tickets stand in the section
	 * "Angeheftet" instead (ADR-0064), never twice.
	 */
	get visible(): readonly TicketSummary[] {
		return this.#listedList;
	}

	/**
	 * The section "Angeheftet" (ADR-0064): the open pinned tickets of the area in the order of
	 * pinning, oldest first, independent of filters, search and sort.
	 */
	get pinned(): readonly TicketSummary[] {
		return this.#pinnedList;
	}

	/** The pinned tickets that pass the filters and the search (the head checkbox takes them too). */
	get pinnedInFilter(): readonly TicketSummary[] {
		return this.#pinnedIds.size === 0
			? []
			: this.#visibleList.filter((ticket) => this.#pinnedIds.has(ticket.id));
	}

	/**
	 * The visible rows in groups (E3 plan, T-7 and package 13), null without a grouping. Groups
	 * follow the order of the domain, empty ones are left out, and each keeps the column sort.
	 * With a second level (plan OR-3) every group has its subgroups.
	 */
	get groups(): readonly GroupNode<TicketSummary>[] | null {
		return this.#groupList;
	}

	/** List state of the URL the store shows (set by `activate`). */
	get query(): ListQuery {
		return this.#query;
	}

	/**
	 * Number of shown tickets for the heading "Aufgaben" (package 10): the visible rows. The pinned
	 * ones above are not counted; the heading names them as "+ N angeheftet" (ADR-0064).
	 */
	get visibleCount(): number {
		return this.#listedList.length;
	}

	/** Number of tickets that are not done (header counter, T-18). */
	get openCount(): number {
		return this.#open.size;
	}

	/**
	 * Numbers of the filter cards (FI-1, ADR-0013 addendum C): each card counts the tickets that
	 * are not done in the area and pass the detail filters and the search, regardless of the other
	 * cards; "Alle offenen" counts all of them. A just checked row counts as done already, like in
	 * `openCount`. They follow realtime and the Berlin midnight.
	 */
	get cardCounts(): CardCounts {
		return this.#cardCounts;
	}

	/** Berlin calendar date the order is based on. */
	get today(): CalendarDate {
		return this.#today;
	}

	get openState(): LoadState {
		return this.#openState;
	}

	get openError(): string | null {
		return this.#openError;
	}

	/** Search that narrows the list (ADR-0013 section 2), null without one or during the pause. */
	get search(): string | null {
		return this.#search;
	}

	/** True while a changed search waits for its pause or its answer (aria-busy of the field). */
	get searchBusy(): boolean {
		return this.#searchBusy;
	}

	/** Failure of the search; the table then shows the list without search. */
	get searchError(): string | null {
		return this.#searchError;
	}

	/** Asks for the IDs of the search again ("Erneut versuchen"). */
	retrySearch(): void {
		if (this.#search !== null) void this.#loadSearch(true);
	}

	/**
	 * Polite status message of the list for screen readers (aria-live): the number of tickets after
	 * a filter change or a search. Results of actions go out as flags.
	 */
	get announcement(): string {
		return this.#announcement;
	}

	/** Open ticket of the list (or a loaded sub-task, open or done), null if it is not loaded. */
	find(id: string): TicketSummary | null {
		return this.#open.get(id) ?? this.#subtasks.get(id) ?? null;
	}

	/** Sub-tasks of a ticket, open ones first, then by creation (ADR-0033 section 4). */
	subtasksOf(parentId: string): readonly TicketSummary[] {
		return Object.hasOwn(this.#subtasksByParent, parentId)
			? (this.#subtasksByParent[parentId] ?? [])
			: [];
	}

	/** Done and all sub-tasks of a ticket; total 0 without sub-tasks. */
	progressOf(parentId: string): SubtaskProgress {
		return subtaskProgress(this.subtasksOf(parentId));
	}

	/** Open sub-tasks that block completing the ticket (ADR-0033 section 2). */
	openBlockingOf(parentId: string): TicketSummary[] {
		return openBlocking(this.subtasksOf(parentId));
	}

	/** The question before completing a ticket with open blocking sub-tasks, null without one. */
	get completion(): CompletionQuestion | null {
		return this.#completion;
	}

	/** True while the answer to the question is being saved. */
	get completing(): boolean {
		return this.#completing;
	}

	/** Why the answer could not be saved; it stays in the question. */
	get completionError(): string | null {
		return this.#completionError;
	}

	/**
	 * Answers the question (ADR-0033 section 2): completes the ticket anyway (`force`) or with its
	 * blocking sub-tasks (`complete_children`, atomically in the hook). The flag offers
	 * "Rückgängig" for both, which also reopens the sub-tasks completed along.
	 */
	async confirmCompletion(choice: CompletionChoice): Promise<void> {
		const question = this.#completion;
		if (question === null || this.#completing || !this.#session.ensureValid()) return;
		const children = completedChildren(this.openBlockingOf(question.id), choice);
		this.#completing = true;
		this.#completionError = null;
		this.#pending.set(question.id, true);
		try {
			const saved = await this.#data.setDone(question.id, true, choice);
			this.#completion = null;
			this.completed(saved, question.previousStatus, children);
		} catch (error) {
			const message = this.#failureMessage(error);
			if (message !== null) this.#completionError = message;
		} finally {
			this.#completing = false;
			this.#pending.delete(question.id);
		}
	}

	/** "Abbrechen" of the question: the ticket stays as it is. */
	cancelCompletion(): void {
		if (this.#completing) return;
		this.#completion = null;
		this.#completionError = null;
	}

	/** Opens the question for a ticket; `count` and `keys` of the store or of the hook. */
	#askCompletion(ticket: TicketSummary, count: number, keys: readonly string[]): void {
		this.#completion = {
			id: ticket.id,
			key: ticket.key,
			count,
			keys: [...keys],
			previousStatus: ticket.status
		};
		this.#completionError = null;
	}

	/**
	 * "Unteraufgabe hinzufügen" (ADR-0033 section 4): a sub-task of `parent` with the title, in the
	 * project and with the tags of the parent, status and priority by default. It joins the list at
	 * once and counts as read, like every ticket created one by one (ADR-0015 section 3). For an open
	 * ticket of a series the rules offer to add it to the template as well (plan WV-3). A failure
	 * comes back with the message of the field that failed.
	 */
	async addSubtask(parent: TicketSummary, title: string): Promise<SubtaskResult> {
		const text = title.trim();
		if (text === '' || this.#data.create === undefined || !this.#session.ensureValid()) {
			return { ok: false, message: null };
		}
		try {
			const draft: TicketDraft = {
				title: text,
				description: '',
				status: DEFAULT_STATUS,
				priority: DEFAULT_PRIORITY,
				due: null,
				project: parent.projectId,
				tags: [...parent.tagIds],
				parent: parent.id
			};
			// In the area of the parent (E7-3), whatever area the tab shows meanwhile.
			const ticket = parent.scope
				? await this.#data.create(draft, householdOfScope(parent.scope))
				: await this.#data.create(draft);
			this.upsert(ticket);
			void this.markRead(ticket);
			this.#series.offerSubtask(parent, { title: ticket.title, priority: ticket.priority });
			return { ok: true, ticket };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind === 'session' || failure.kind === 'aborted') {
				return { ok: false, message: null };
			}
			const field = Object.values(failure.fields)[0];
			return { ok: false, message: field?.message ?? failure.message };
		}
	}

	/** State the check mark shows: the requested one while a request runs. */
	isChecked(ticket: TicketSummary): boolean {
		return this.#pending.get(ticket.id) ?? ticket.status === 'done';
	}

	isPending(id: string): boolean {
		return this.#pending.has(id);
	}

	/**
	 * Starts the clock of "today" (E2 plan, T-3): after every Berlin midnight the order is
	 * computed again without a reload. Returns the cleanup, which also empties the store.
	 */
	start(): () => void {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const schedule = () => {
			timer = setTimeout(
				() => {
					this.#today = berlinToday(this.#now());
					schedule();
				},
				msUntilNextBerlinMidnight(this.#now()) + MIDNIGHT_BUFFER_MS
			);
		};
		this.#today = berlinToday(this.#now());
		schedule();
		return () => {
			clearTimeout(timer);
			this.reset();
		};
	}

	/**
	 * Shows the list for the state of the URL: filters and search (E3 plan, packages 10 and 11).
	 * Loads the open tickets once; they are only filtered, never loaded again. A filter change
	 * announces the new number of tickets, a search announces it when its answer arrives.
	 */
	activate(query: ListQuery): void {
		const first = this.#openState === 'idle';
		if (first) void this.#loadOpen();
		const filtersChanged = !sameFiltersBesidesSearch(this.#query, query);
		this.#query = query;
		// A search from the URL of a fresh page applies at once, typing waits for the pause.
		this.#followSearch(activeSearch(query), first);
		if (!filtersChanged || this.#openState !== 'ready') return;
		this.#announcement = countMessage(this.visibleCount);
	}

	/**
	 * Loads the open tickets once without showing the list: the project view counts its "aktiv"
	 * numbers from them (E3 plan, package 14), even when the app starts there.
	 */
	loadOpen(): void {
		if (this.#openState === 'idle') void this.#loadOpen();
	}

	/** Loads the open tickets again ("Erneut versuchen"). */
	async reload(): Promise<void> {
		await this.#loadOpen();
	}

	/**
	 * Inserts or replaces a ticket (own answer or realtime event). An older `updated` than the
	 * one in the store is ignored, so a late event does not overwrite a newer answer. A done ticket
	 * leaves the list; the view "Erledigte" shows it (ADR-0066).
	 */
	upsert(ticket: TicketSummary): void {
		if (this.#deleted.has(ticket.id)) return;
		this.#touched?.add(ticket.id);
		const existing = this.find(ticket.id);
		if (existing !== null && existing.updated > ticket.updated) return;
		// Sub-tasks, open or done; a ticket released from its parent leaves them (ADR-0033).
		if (ticket.parentId) this.#subtasks.set(ticket.id, ticket);
		else this.#subtasks.delete(ticket.id);
		if (ticket.status !== 'done') {
			// Open again by another way: "Rückgängig" has nothing left to do.
			this.#dropUndo(ticket.id);
			this.#open.set(ticket.id, ticket);
			return;
		}
		this.#open.delete(ticket.id);
	}

	/**
	 * A created or updated ticket from a realtime event. The server sends its events in order, so
	 * an update after the event that removed a ticket means it is visible again: restored from the
	 * trash (ADR-0037), here or in another tab. It returns to the list; late answers of requests
	 * still stay out (`upsert`). An open ticket that comes back by an update also brings its read
	 * row back, which the rules hid while it lay in the trash, and no event reports that: the read
	 * rows are loaded again, so it does not show as "neu" (plan papierkorb §6).
	 */
	#arrive(action: 'create' | 'update', ticket: TicketSummary): void {
		const returning =
			action === 'update' && (this.#deleted.delete(ticket.id) || this.find(ticket.id) === null);
		this.upsert(ticket);
		if (returning && ticket.status !== 'done') void this.#loadReads();
	}

	/** Removes a ticket from every part of the list (deleted or no longer visible). */
	remove(id: string): void {
		this.#touched?.add(id);
		this.#deleted.add(id);
		this.#open.delete(id);
		this.#subtasks.delete(id);
		this.#dropUndo(id);
		this.#pending.delete(id);
	}

	/**
	 * A ticket was just completed with the given previous status (check mark, or the status
	 * select of the panel): the row leaves the open list at once, and a flag offers "Rückgängig"
	 * for FLAG_DURATION_MS (paused while the user points at it, ADR-0025 section 8). `children` are
	 * the sub-tasks completed along (ADR-0033 section 2); the flag names them, and "Rückgängig"
	 * reopens them as well.
	 */
	completed(
		ticket: TicketSummary,
		previousStatus: Status,
		children: readonly CompletedChild[] = []
	): void {
		if (ticket.status !== 'done' || previousStatus === 'done') {
			this.upsert(ticket);
			return;
		}
		const existing = this.find(ticket.id);
		if (existing !== null && existing.updated > ticket.updated) return;
		this.upsert(ticket);
		this.#dropUndo(ticket.id);
		const id = ticket.id;
		const flagId = this.#flags.show({
			tone: 'success',
			title:
				children.length === 0
					? `${ticket.key} erledigt.`
					: `${ticket.key} und ${subtaskCountText(children.length)} erledigt.`,
			action: { label: 'Rückgängig', run: () => void this.undo(id) },
			onclose: () => {
				if (this.#undoable.get(id)?.flagId === flagId) this.#undoable.delete(id);
			}
		});
		this.#undoable.set(id, { key: ticket.key, previousStatus, children, flagId });
	}

	/**
	 * Check mark (E2 plan, T-6): checking sets "done", unchecking sets REOPEN_STATUS. The check
	 * mark shows the new state at once, is locked during the request and springs back on failure.
	 * A ticket with open blocking sub-tasks is not sent at once: the question "N Unteraufgaben sind
	 * noch offen – trotzdem erledigen?" comes first (ADR-0033 section 2), also when the hook
	 * refuses because another tab reopened a sub-task meanwhile.
	 */
	async setDone(id: string, done: boolean): Promise<void> {
		const ticket = this.find(id);
		if (ticket === null || this.#pending.has(id) || (ticket.status === 'done') === done) return;
		if (!this.#session.ensureValid()) return;
		const blocking = done ? this.openBlockingOf(id) : [];
		if (blocking.length > 0) {
			this.#askCompletion(
				ticket,
				blocking.length,
				blocking.map((child) => child.key)
			);
			return;
		}
		this.#pending.set(id, done);
		try {
			const saved = await this.#data.setDone(id, done);
			if (done) {
				this.completed(saved, ticket.status);
			} else {
				this.upsert(saved);
				this.#flags.show({ tone: 'success', title: `${saved.key} wieder offen.` });
			}
		} catch (error) {
			const open = done ? openChildrenOf(error) : null;
			if (open !== null) this.#askCompletion(ticket, open.count, open.keys);
			else
				this.#fail(
					error,
					`${ticket.key} konnte nicht geändert werden.`,
					done ? undefined : { id, status: REOPEN_STATUS }
				);
		} finally {
			this.#pending.delete(id);
		}
	}

	/**
	 * A cell of the table edited in place (plan BI-3, ADR-0036 §6): the same Record API as the panel,
	 * so the hook decides as there (a new key on another project, the history, a series). The row
	 * shows the answer of the server; there is no optimistic value, because key, completion and the
	 * next ticket of a series come from the server. "Erledigt" goes through `setDone` and its
	 * question about open sub-tasks (ADR-0033 section 2), with "Rückgängig" in the flag. A refusal
	 * comes as an error flag with the reason, the cell keeps its value. Resolves to true when saved.
	 * A changed priority, project or tags of an open ticket of a series brings the flag "Nur dieses
	 * Ticket geändert." with "Auch für künftige Tickets übernehmen" (plan WV), as in the panel.
	 */
	async changeField(id: string, patch: TicketPatch): Promise<boolean> {
		const ticket = this.find(id);
		if (ticket === null || this.#pending.has(id) || !this.#session.ensureValid()) return false;
		if (patch.status === 'done' && ticket.status !== 'done' && Object.keys(patch).length === 1) {
			await this.setDone(id, true);
			return true;
		}
		this.#pending.set(id, ticket.status === 'done');
		try {
			const saved = await this.#data.update(id, patch);
			this.upsert(saved);
			this.#series.offerTemplate([{ before: ticket, after: saved }]);
			return true;
		} catch (error) {
			const failure = toDataError(error);
			const field = Object.values(failure.fields)[0];
			if (patch.status !== undefined && reopenRefusalOf(error) !== null) {
				this.#fail(error, `${ticket.key} konnte nicht geändert werden.`, {
					id,
					status: patch.status
				});
			} else if (field !== undefined && failure.kind === 'validation') {
				this.#flags.show({
					tone: 'error',
					title: `${ticket.key} konnte nicht geändert werden. ${field.message}`
				});
			} else {
				this.#fail(error, `${ticket.key} konnte nicht geändert werden.`);
			}
			return false;
		} finally {
			this.#pending.delete(id);
		}
	}

	/**
	 * Moves the due date of an open ticket (calendar, ADR-0053 §12): the same Record API as the
	 * panel, sent with `expected_updated`, so a ticket changed meanwhile (another tab, the rules) is
	 * not overwritten; an error flag says so, and realtime brings the newer state. There is no
	 * optimistic value: the entry moves with the answer. Saved, the flag "Fälligkeit von KEY auf
	 * TT.MM.JJJJ gesetzt." offers "Rückgängig", which restores the date before, again with
	 * `expected_updated`; for a ticket of a series it adds that the series does not move. A second
	 * move of the ticket closes the flag of the first. Resolves to true when saved.
	 */
	async moveDue(id: string, due: CalendarDate): Promise<boolean> {
		const ticket = this.find(id);
		if (ticket === null || ticket.status === 'done' || ticket.due === due) return false;
		if (this.#pending.has(id) || !this.#session.ensureValid()) return false;
		const saved = await this.#saveDue(ticket, due, 'gesetzt');
		if (saved === null) return false;
		this.#dropMovedDue(id);
		const previous = ticket.due;
		const flagId = this.#flags.show({
			tone: 'success',
			title: `Fälligkeit von ${saved.key} auf ${formatCalendarDate(due)} gesetzt.`,
			...(saved.recurring && { description: SERIES_MOVE_HINT }),
			action: { label: 'Rückgängig', run: () => void this.#undoDue(saved, previous) },
			onclose: () => {
				if (this.#movedDue.get(id) === flagId) this.#movedDue.delete(id);
			}
		});
		this.#movedDue.set(id, flagId);
		return true;
	}

	/** "Rückgängig" of a moved due date: the date before, unless the ticket changed since. */
	async #undoDue(saved: TicketSummary, previous: CalendarDate | null): Promise<void> {
		this.#movedDue.delete(saved.id);
		if (this.#pending.has(saved.id) || !this.#session.ensureValid()) return;
		const restored = await this.#saveDue(saved, previous, 'zurückgesetzt');
		if (restored === null) return;
		this.#flags.show({
			tone: 'success',
			title:
				previous === null
					? `Fälligkeit von ${restored.key} wieder entfernt.`
					: `Fälligkeit von ${restored.key} wieder auf ${formatCalendarDate(previous)} gesetzt.`
		});
	}

	/**
	 * Saves a due date based on `ticket` (its `updated` as `expected_updated`); the answer replaces
	 * the ticket. A refusal comes as an error flag and resolves to null.
	 */
	async #saveDue(
		ticket: TicketSummary,
		due: CalendarDate | null,
		verb: 'gesetzt' | 'zurückgesetzt'
	): Promise<TicketSummary | null> {
		const id = ticket.id;
		this.#pending.set(id, false);
		try {
			const saved = await this.#data.update(id, { due }, { expectedUpdated: ticket.updated });
			this.upsert(saved);
			return saved;
		} catch (error) {
			const failure = toDataError(error);
			const fields = Object.values(failure.fields);
			const field = fields[0];
			if (fields.some((entry) => entry.code === STALE_CODE)) {
				this.#flags.show({
					tone: 'error',
					title: `Fälligkeit von ${ticket.key} nicht ${verb}: Das Ticket wurde inzwischen geändert.`
				});
			} else if (failure.kind === 'validation' && field !== undefined) {
				this.#flags.show({
					tone: 'error',
					title: `Fälligkeit von ${ticket.key} konnte nicht ${verb} werden. ${field.message}`
				});
			} else {
				this.#fail(error, `Fälligkeit von ${ticket.key} konnte nicht ${verb} werden.`);
			}
			return null;
		} finally {
			this.#pending.delete(id);
		}
	}

	/** Closes the flag of a moved due date, whose "Rückgängig" would now be refused. */
	#dropMovedDue(id: string): void {
		const flagId = this.#movedDue.get(id);
		if (flagId === undefined) return;
		this.#movedDue.delete(id);
		this.#flags.dismiss(flagId);
	}

	/**
	 * "Rückgängig" of the flag after checking: restores the exact previous status (OF-E2-3), then
	 * that of every sub-task completed along (ADR-0033 section 2), one after another. A sub-task that
	 * fails is named in an error flag; the others are restored.
	 */
	async undo(id: string): Promise<void> {
		const undoable = this.#undoable.get(id);
		if (undoable === undefined || this.#pending.has(id)) return;
		if (!this.#session.ensureValid()) return;
		this.#undoable.delete(id);
		this.#pending.set(id, false);
		let saved: TicketSummary;
		try {
			saved = await this.#data.update(id, { status: undoable.previousStatus });
			this.upsert(saved);
		} catch (error) {
			this.#fail(error, `${undoable.key} konnte nicht zurückgesetzt werden.`, {
				id,
				status: undoable.previousStatus
			});
			return;
		} finally {
			this.#pending.delete(id);
		}
		const failed: string[] = [];
		for (const child of undoable.children) {
			try {
				this.upsert(await this.#data.update(child.id, { status: child.previousStatus }));
			} catch (error) {
				if (this.#failureMessage(error) !== null) failed.push(child.key);
			}
		}
		const restored = undoable.children.length - failed.length;
		this.#flags.show({
			tone: 'success',
			title:
				restored === 0
					? `${saved.key} ist wieder offen.`
					: `${saved.key} und ${subtaskCountText(restored)} sind wieder offen.`
		});
		if (failed.length > 0) {
			this.#flags.show({
				tone: 'error',
				title: `${failed.join(', ')} ${failed.length === 1 ? 'konnte' : 'konnten'} nicht zurückgesetzt werden.`
			});
		}
	}

	/** True while the flag of a just checked ticket offers "Rückgängig". */
	canUndo(id: string): boolean {
		return this.#undoable.has(id);
	}

	/** Result of an action in another view (panel, "Neues Ticket") as a success flag. */
	announce(message: string): void {
		this.#flags.show({ tone: 'success', title: message });
	}

	/**
	 * Keeps the list live (ADR-0007 sections 2 and 3): created and updated tickets go through
	 * `upsert`, deleted ones through `remove`, and after a reconnection or a subscription that
	 * came only after failed attempts the store reconciles once. Returns the cleanup, which ends
	 * both subscriptions and a running reconciliation.
	 */
	connect(live: LiveSource): () => void {
		const reconcile = () => void this.reconcile();
		const stops = [
			hold(
				(guard) =>
					live.tickets(
						guard((change) => {
							if (change.action === 'delete') {
								this.remove(change.id);
								return;
							}
							this.#arrive(change.action, change.record);
							// Title, description or key may have changed: ask for the IDs again.
							this.#refreshSearch();
						})
					),
				{ recovered: reconcile }
			),
			hold((guard) => live.reconnected(guard(reconcile)), { recovered: reconcile })
		];
		// Read rows and base line only where the server knows them (after the migration).
		const reads = this.#reads;
		if (reads !== null && reads.unreadSince() !== null) {
			stops.push(
				hold(
					(guard) =>
						live.reads(
							guard((change) => {
								if (change.action === 'baseline') this.#unreadSince = change.unreadSince;
								else if (change.action === 'delete') this.#readRows.delete(change.id);
								else this.#readRows.set(change.read.id, change.read.ticket);
							})
						),
					{ recovered: () => void this.#loadReads() }
				)
			);
		}
		return () => {
			for (const stop of stops) stop();
			this.#reconcileController?.abort();
			this.#reconcileController = null;
		};
	}

	/**
	 * Reconciles with the server after events may have been lost (ADR-0007 section 3): loads the
	 * open tickets and the sub-tasks again and merges them into the store (insert, replace,
	 * remove) without a loading state, so nothing flickers. Rows that stand
	 * with "Rückgängig" stay. A second call aborts a running one. A list that failed to load is
	 * simply loaded again.
	 */
	async reconcile(): Promise<void> {
		this.#reconcileController?.abort();
		this.#reconcileController = null;
		if (this.#openState === 'error') {
			await this.reload();
			return;
		}
		if (this.#openState !== 'ready' || !this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#reconcileController = controller;
		const touched = new SvelteSet<string>();
		this.#touched = touched;
		const options = { signal: controller.signal };
		try {
			const [open, subtasks] = await Promise.all([
				this.#data.listOpen(options),
				this.#data.listSubtasks?.(options) ?? null
			]);
			if (controller.signal.aborted) return;
			this.#touched = null;
			this.#mergeOpen(open, touched);
			if (subtasks !== null) this.#mergeSubtasks(subtasks, touched);
			this.#refreshSearch();
			void this.#loadReads();
		} catch (error) {
			if (controller.signal.aborted) return;
			// Nothing to show: the list stays as it is, the next reconnection tries again.
			this.#failureMessage(error);
		} finally {
			if (this.#touched === touched) this.#touched = null;
			if (this.#reconcileController === controller) this.#reconcileController = null;
		}
	}

	/**
	 * The area of the tab changed (E7-3, ADR-0059 §2): the tickets of the old area go at once (also
	 * their "Rückgängig"), and a list that was shown loads those of the new area for the same query.
	 * The view usually changes the address as well and so drops the filters of the old area.
	 */
	rescope(): void {
		const shown = this.#openState !== 'idle';
		const query = this.#query;
		this.reset();
		if (shown) this.activate(query);
	}

	/** Aborts all requests and timers and empties the store. */
	reset(): void {
		this.#openController?.abort();
		this.#reconcileController?.abort();
		this.#openController = null;
		this.#reconcileController = null;
		this.#completion = null;
		this.#completionError = null;
		this.#touched = null;
		this.#deleted.clear();
		for (const id of [...this.#undoable.keys()]) this.#dropUndo(id);
		for (const id of [...this.#movedDue.keys()]) this.#dropMovedDue(id);
		this.#open.clear();
		this.#subtasks.clear();
		this.#pending.clear();
		clearTimeout(this.#searchTimer);
		clearTimeout(this.#searchRefreshTimer);
		this.#searchController?.abort();
		this.#searchController = null;
		this.#wantedSearch = null;
		this.#search = null;
		this.#searchIds = null;
		this.#searchBusy = false;
		this.#searchError = null;
		this.#query = EMPTY_LIST_QUERY;
		this.#openState = 'idle';
		this.#openError = null;
		this.#announcement = '';
		this.#readsController?.abort();
		this.#readsController = null;
		this.#readRows.clear();
		this.#marking.clear();
		this.#readsReady = false;
		this.#unreadSince = null;
	}

	/**
	 * Loads the own read rows of the tickets that can still be new (ADR-0015 section 6) and adds
	 * them; rows go only with their ticket, so none is removed. Without a base line (before the
	 * migration) nothing is loaded and nothing is new. A failure leaves the marks off rather than
	 * showing every ticket as new.
	 */
	async #loadReads(): Promise<void> {
		const reads = this.#reads;
		if (reads === null) return;
		const since = this.#unreadSince ?? reads.unreadSince();
		if (since === null) return;
		this.#readsController?.abort();
		const controller = new AbortController();
		this.#readsController = controller;
		try {
			const rows = await reads.list(since, { signal: controller.signal });
			if (controller.signal.aborted) return;
			for (const row of rows) this.#readRows.set(row.id, row.ticket);
			this.#unreadSince ??= since;
			this.#readsReady = true;
		} catch (error) {
			if (!controller.signal.aborted) this.#failureMessage(error);
		} finally {
			if (this.#readsController === controller) this.#readsController = null;
		}
	}

	async #loadOpen(): Promise<void> {
		this.#openController?.abort();
		this.#openController = null;
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#openController = controller;
		this.#openState = 'loading';
		this.#openError = null;
		try {
			const options = { signal: controller.signal };
			const [tickets, subtasks] = await Promise.all([
				this.#data.listOpen(options),
				this.#data.listSubtasks?.(options) ?? []
			]);
			if (controller.signal.aborted) return;
			this.#open.clear();
			// A just checked ticket may still be open in an answer that started before the check.
			for (const ticket of tickets) {
				if (!this.#undoable.has(ticket.id)) this.#open.set(ticket.id, ticket);
			}
			this.#subtasks.clear();
			for (const ticket of subtasks) this.#subtasks.set(ticket.id, ticket);
			this.#openState = 'ready';
			void this.#loadReads();
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null) return;
			this.#openError = message;
			this.#openState = 'error';
		} finally {
			if (this.#openController === controller) this.#openController = null;
		}
	}

	/**
	 * A removed ticket in the snapshot of a reconciliation is visible again (restored from the
	 * trash during a gap, ADR-0037), unless it was removed while the reconciliation ran: then the
	 * snapshot may be older than the removal.
	 */
	#revive(id: string, touched: ReadonlySet<string>): void {
		if (!touched.has(id)) this.#deleted.delete(id);
	}

	#mergeOpen(open: readonly TicketSummary[], touched: ReadonlySet<string>): void {
		const ids = new SvelteSet(open.map((ticket) => ticket.id));
		for (const id of [...this.#open.keys()]) {
			if (!ids.has(id) && !touched.has(id)) this.#open.delete(id);
		}
		// A just checked ticket may still be open in a snapshot that started before the check.
		for (const ticket of open) {
			if (this.#undoable.has(ticket.id)) continue;
			this.#revive(ticket.id, touched);
			this.upsert(ticket);
		}
	}

	/**
	 * Sub-tasks of a reconciliation (ADR-0033): gone ones leave unless changed meanwhile; the others
	 * replace older versions. A done one only updates the index of the sub-tasks.
	 */
	#mergeSubtasks(subtasks: readonly TicketSummary[], touched: ReadonlySet<string>): void {
		const ids = new SvelteSet(subtasks.map((ticket) => ticket.id));
		for (const id of [...this.#subtasks.keys()]) {
			if (!ids.has(id) && !touched.has(id)) this.#subtasks.delete(id);
		}
		for (const ticket of subtasks) {
			this.#revive(ticket.id, touched);
			if (this.#deleted.has(ticket.id) || touched.has(ticket.id)) continue;
			const existing = this.#subtasks.get(ticket.id);
			if (existing === undefined || existing.updated <= ticket.updated) {
				this.#subtasks.set(ticket.id, ticket);
			}
		}
	}

	/**
	 * Follows the search the URL asks for: none or a shorter one applies at once, a new text after
	 * the pause SEARCH_DEBOUNCE_MS (or at once for a fresh page), so fast typing costs one request.
	 */
	#followSearch(wanted: string | null, immediately: boolean): void {
		if (wanted === this.#wantedSearch) return;
		this.#wantedSearch = wanted;
		clearTimeout(this.#searchTimer);
		if (wanted === null || immediately) {
			this.#applySearch(wanted);
			return;
		}
		this.#searchBusy = true;
		this.#searchTimer = setTimeout(() => this.#applySearch(wanted), SEARCH_DEBOUNCE_MS);
	}

	/** Applies a search to the list; null shows it without search. */
	#applySearch(search: string | null): void {
		const changed = search !== this.#search;
		this.#search = search;
		this.#searchError = null;
		if (search === null) {
			this.#searchController?.abort();
			this.#searchController = null;
			clearTimeout(this.#searchRefreshTimer);
			this.#searchIds = null;
			this.#searchBusy = false;
		} else {
			void this.#loadSearch(true);
		}
		if (changed && search === null && this.#openState === 'ready') {
			this.#announcement = countMessage(this.visibleCount);
		}
	}

	/** Asks for the IDs of the search again after the pause (ticket events, reconnection). */
	#refreshSearch(): void {
		if (this.#search === null) return;
		clearTimeout(this.#searchRefreshTimer);
		this.#searchRefreshTimer = setTimeout(() => void this.#loadSearch(false), SEARCH_DEBOUNCE_MS);
	}

	/**
	 * Loads the IDs of the open tickets that match the search; a newer request aborts an older one
	 * and a stale answer is dropped. `announce` (a new search) marks the field as busy and announces
	 * the new number.
	 */
	async #loadSearch(announce: boolean): Promise<void> {
		const search = this.#search;
		if (search === null) return;
		this.#searchController?.abort();
		this.#searchController = null;
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#searchController = controller;
		if (announce) this.#searchBusy = true;
		try {
			const ids = await this.#data.searchOpen(search, { signal: controller.signal });
			if (controller.signal.aborted || search !== this.#search) return;
			this.#searchIds = new SvelteSet(ids);
			this.#searchError = null;
			if (announce && this.#openState === 'ready') {
				this.#announcement = countMessage(this.visibleCount);
			}
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null) return;
			this.#searchError = message;
			this.#searchIds = null;
		} finally {
			if (this.#searchController === controller) {
				this.#searchController = null;
				this.#searchBusy = false;
			}
		}
	}

	/** Ends the chance of "Rückgängig" for a ticket and closes its flag. */
	#dropUndo(id: string): void {
		const undoable = this.#undoable.get(id);
		if (undoable === undefined) return;
		this.#undoable.delete(id);
		this.#flags.dismiss(undoable.flagId);
	}

	/**
	 * German message of a failed request, or null if nothing is to be shown: an aborted request
	 * is no error, and an ended session leads to the login (ADR-0006 section 4).
	 */
	#failureMessage(error: unknown): string | null {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		return failure.message;
	}

	/**
	 * A failed check mark or "Rückgängig" as an error flag; it stays until it is closed. A refused
	 * reopening of an instance (ADR-0023 section 3 and addendum 4) names the open ticket of the
	 * series, and with `reopen` the flag offers to reopen the ticket as a normal one instead.
	 */
	#fail(error: unknown, prefix: string, reopen?: { id: string; status: Status }): void {
		const refusal = reopenRefusalOf(error);
		const message = refusal ?? this.#failureMessage(error);
		if (message === null) return;
		this.#flags.show({
			tone: 'error',
			title: `${prefix} ${message}`,
			...(refusal !== null &&
				reopen !== undefined && {
					action: {
						label: REOPEN_DETACHED_LABEL,
						run: () => void this.reopenDetached(reopen.id, reopen.status)
					}
				})
		});
	}

	/**
	 * "Als normales Ticket wieder öffnen (aus der Serie lösen)" after a refused reopening: the status
	 * and leaving the series in one request (ADR-0023 addendum 4). Resolves to true when saved.
	 */
	async reopenDetached(id: string, status: Status): Promise<boolean> {
		const ticket = this.find(id);
		if (ticket === null || this.#pending.has(id) || !this.#session.ensureValid()) return false;
		this.#pending.set(id, false);
		try {
			const saved = await this.#data.update(id, { status, detachSeries: true });
			this.upsert(saved);
			this.#flags.show({
				tone: 'success',
				title: `${saved.key} ist wieder offen, als normales Ticket.`
			});
			return true;
		} catch (error) {
			this.#fail(error, `${ticket.key} konnte nicht geändert werden.`);
			return false;
		} finally {
			this.#pending.delete(id);
		}
	}
}

const [getTicketListStore, setTicketListStore] = createContext<TicketListStore>();

/** Store of the list, set by the app layout and read by the ticket views. */
export { getTicketListStore, setTicketListStore };
