// State of the ticket list (ADR-0006 sections 1 to 5; E2 plan, package 5; E3 plan, packages 5,
// 10, 11 and 13). Open tickets are loaded in full, filtered, sorted and grouped client side
// (ADR-0013 section 1); the search comes from the server as a set of IDs (section 2); done
// tickets are loaded page by page in the server order and filtered by the server (section 3). The store is created per app layout and handed out through a typed context, so a logout
// leaves no data behind. Own answers and realtime events (ADR-0007) go through the same
// idempotent `upsert` and `remove`; after a reconnection the store reconciles once with the
// server.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	listDoneTickets,
	listOpenTickets,
	searchOpenTicketIds,
	setTicketDone,
	updateTicket,
	type DoneFilter,
	type DoneTicketPage
} from '$lib/data/tickets';
import { berlinToday, msUntilNextBerlinMidnight, type CalendarDate } from '$lib/domain/berlin-date';
import { matchesFilter } from '$lib/domain/filter';
import { groupTickets, type TicketGroup } from '$lib/domain/grouping';
import { countKpis, type Kpis } from '$lib/domain/kpis';
import {
	EMPTY_LIST_QUERY,
	FILTER_KEYS,
	activeSearch,
	type ListQuery
} from '$lib/domain/list-query';
import { columnOrder, ticketOrder, type ResolveProject } from '$lib/domain/ordering';
import type { Status } from '$lib/domain/status';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { hold, type LiveSource } from './realtime';

/**
 * How long a checked row stays in place, struck through and with "Rückgängig" (OF-E2-2,
 * recommendation until decided).
 */
export const UNDO_WINDOW_MS = 5000;

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
	/** One page of done tickets narrowed by `filter` (the list filters at the Berlin date). */
	listDone(page: number, options: RequestOptions & { filter: DoneFilter }): Promise<DoneTicketPage>;
	/** IDs of the open tickets whose title, description or key contain the search text. */
	searchOpen(search: string, options: RequestOptions): Promise<string[]>;
	setDone(id: string, done: boolean): Promise<TicketSummary>;
	update(id: string, patch: TicketPatch): Promise<TicketSummary>;
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
		listDone: (page, options) => listDoneTickets(pb, page, options),
		searchOpen: (search, options) => searchOpenTicketIds(pb, search, options),
		setDone: (id, done) => setTicketDone(pb, id, done),
		update: (id, patch) => updateTicket(pb, id, patch)
	};
}

interface Lingering {
	ticket: TicketSummary;
	/** Status before "done", restored by "Rückgängig". */
	previousStatus: Status;
	/** Ends the undo window. */
	timer: ReturnType<typeof setTimeout>;
}

/**
 * True if the section "Erledigt" is shown (T-6): the status filter "Erledigt" shows only this
 * section, another status hides it, without a status the switch "Erledigte anzeigen" decides.
 */
export function showsDoneSection(query: ListQuery): boolean {
	return query.status === null ? query.showDone : query.status === 'done';
}

/** The filters besides the search, which applies after a pause and announces on its own. */
const FILTERS_BESIDES_SEARCH = FILTER_KEYS.filter((key) => key !== 'search');

function sameFiltersBesidesSearch(a: ListQuery, b: ListQuery): boolean {
	return FILTERS_BESIDES_SEARCH.every((key) => a[key] === b[key]);
}

/** Text of the live region after a filter change (E3 plan, package 10). */
export function countMessage(count: number, more = false): string {
	if (more) return `Mehr als ${count} Tickets.`;
	if (count === 0) return 'Keine Tickets für diese Filter.';
	return count === 1 ? '1 Ticket.' : `${count} Tickets.`;
}

/** Server order of done tickets: `-completed_at,-created,-id`. */
function compareDone(a: TicketSummary, b: TicketSummary): number {
	const keys: [string, string][] = [
		[b.completedAt ?? '', a.completedAt ?? ''],
		[b.created, a.created],
		[b.id, a.id]
	];
	for (const [left, right] of keys) {
		if (left !== right) return left < right ? -1 : 1;
	}
	return 0;
}

export interface TicketListOptions {
	/** Clock of "today"; tests pass a fixed one. */
	now?: () => number;
	/**
	 * Project of a ticket for the column sort "Projekt" (E3 plan, package 9): the app passes the
	 * catalog (`catalog.projectOf`), so a rename sorts again at once; default is `expand`.
	 */
	projectOf?: ResolveProject<TicketSummary>;
}

export class TicketListStore {
	readonly #data: TicketListData;
	readonly #session: SessionGuard;
	readonly #now: () => number;
	readonly #projectOf: ResolveProject<TicketSummary>;

	readonly #open = new SvelteMap<string, TicketSummary>();
	readonly #done = new SvelteMap<string, TicketSummary>();
	readonly #lingering = new SvelteMap<string, Lingering>();
	/** Target state of running check mark requests, keyed by ticket ID. */
	readonly #pending = new SvelteMap<string, boolean>();
	/**
	 * IDs of deleted tickets: a late event or answer must not bring them back. Record IDs are
	 * never reused, so the set only grows until the store is reset.
	 */
	readonly #deleted = new SvelteSet<string>();
	/**
	 * IDs changed by answers or events while a reconciliation runs: its older snapshot must not
	 * remove them (e.g. a ticket created in the meantime). Null while none runs.
	 */
	#touched: Set<string> | null = null;

	#openController: AbortController | null = null;
	#doneController: AbortController | null = null;
	#reconcileController: AbortController | null = null;
	#donePage = 0;
	/**
	 * Filter the loaded done pages belong to (filters and, with a due filter, the date as one key),
	 * null while the section is hidden; a different key loads the section again.
	 */
	#doneKey: string | null = null;
	/** Filters changed while the section "Erledigt" alone is shown: announce after loading. */
	#announceDone = false;
	/** Search the URL asks for (from SEARCH_MIN_LENGTH characters), applied or waiting for the pause. */
	#wantedSearch: string | null = null;
	/** Search the IDs in #searchIds belong to. */
	#searchIdsFor: string | null = null;
	#searchTimer: ReturnType<typeof setTimeout> | undefined;
	#searchRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	#searchController: AbortController | null = null;

	#today = $state<CalendarDate>('');
	#query = $state<ListQuery>(EMPTY_LIST_QUERY);
	#openState = $state<LoadState>('idle');
	#openError = $state<string | null>(null);
	#showDone = $state(false);
	#doneState = $state<LoadState>('idle');
	#doneError = $state<string | null>(null);
	#doneHasMore = $state(false);
	#loadingMoreDone = $state(false);
	#notice = $state<string | null>(null);
	#announcement = $state('');
	/** Search that narrows the list and the done section (after the pause), null without one. */
	#search = $state<string | null>(null);
	/**
	 * Open tickets that match the search. A newer search keeps the older IDs until its answer, so
	 * the table keeps its rows instead of flickering; null shows the list without search.
	 */
	#searchIds = $state<ReadonlySet<string> | null>(null);
	#searchBusy = $state(false);
	#searchError = $state<string | null>(null);

	#openList = $derived.by(() => {
		const lingering = [...this.#lingering.values()].map((entry) => entry.ticket);
		return [...this.#open.values(), ...lingering].sort(ticketOrder(this.#today));
	});
	/**
	 * Visible open rows with the ticket they are filtered, sorted and grouped as (`subject`): a
	 * just checked row stays in place with "Rückgängig", so it counts with the status it had
	 * before.
	 */
	#visibleEntries = $derived.by(() => {
		const query = this.#query;
		if (query.status === 'done') return [];
		const today = this.#today;
		const order = columnOrder(query.sort, today, this.#projectOf);
		const ids = this.#search === null ? null : this.#searchIds;
		return this.#openList
			.map((ticket) => {
				const previousStatus = this.#lingering.get(ticket.id)?.previousStatus;
				return { ticket, subject: previousStatus ? { ...ticket, status: previousStatus } : ticket };
			})
			.filter(
				({ ticket, subject }) =>
					matchesFilter(subject, query, today) && (ids === null || ids.has(ticket.id))
			)
			.sort((a, b) => order(a.subject, b.subject));
	});
	#visibleList = $derived(this.#visibleEntries.map(({ ticket }) => ticket));
	#groupList = $derived.by((): TicketGroup<TicketSummary>[] | null => {
		const grouping = this.#query.grouping;
		if (grouping === null) return null;
		const entries = this.#visibleEntries;
		// Rows are keyed by ID: a just checked row is grouped as its copy with the previous status.
		const ticketOf = Object.fromEntries(entries.map(({ ticket }) => [ticket.id, ticket]));
		return groupTickets(
			entries.map(({ subject }) => subject),
			grouping,
			this.#today,
			this.#projectOf
		).map((group) => ({
			...group,
			tickets: group.tickets.map((subject) => ticketOf[subject.id] ?? subject)
		}));
	});
	#doneList = $derived.by(() => {
		const query = this.#query;
		const today = this.#today;
		// With the status filter "Erledigt" there is no other place for a just checked row.
		const onlyDone = query.status === 'done';
		return [...this.#done.values()]
			.filter((ticket) => onlyDone || !this.#lingering.has(ticket.id))
			.filter((ticket) => matchesFilter(ticket, query, today))
			.sort(compareDone);
	});
	#kpis = $derived(countKpis(this.#open.values(), this.#today));

	constructor(
		data: TicketListData,
		session: SessionGuard,
		{ now = Date.now, projectOf = (ticket) => ticket.project }: TicketListOptions = {}
	) {
		this.#data = data;
		this.#session = session;
		this.#now = now;
		this.#projectOf = projectOf;
		this.#today = berlinToday(now());
	}

	/** Open tickets in the default order (P-2), including rows that were just checked. */
	get open(): readonly TicketSummary[] {
		return this.#openList;
	}

	/**
	 * Rows of the table above the section "Erledigt" (E3 plan, packages 5, 9 and 10): the open
	 * tickets that pass the filters of the URL, in its column sort (T-5; ties and no sort: the
	 * default order); none with the status filter "Erledigt".
	 */
	get visible(): readonly TicketSummary[] {
		return this.#visibleList;
	}

	/**
	 * The visible rows in groups (E3 plan, T-7 and package 13), null without a grouping. Groups
	 * follow the order of the domain, empty ones are left out, and each keeps the column sort. A
	 * just checked row stays for UNDO_WINDOW_MS in the group of its previous status.
	 */
	get groups(): readonly TicketGroup<TicketSummary>[] | null {
		return this.#groupList;
	}

	/** List state of the URL the store shows (set by `activate`). */
	get query(): ListQuery {
		return this.#query;
	}

	/**
	 * Number of shown tickets for the heading "Aufgaben" (package 10): the visible rows that are
	 * not done, or with the status filter "Erledigt" the loaded done rows (`visibleCountMore`).
	 */
	get visibleCount(): number {
		if (this.#query.status === 'done') return this.#doneList.length;
		return this.#visibleList.filter((ticket) => ticket.status !== 'done').length;
	}

	/** True if more tickets match than `visibleCount` says (further pages of done tickets). */
	get visibleCountMore(): boolean {
		return this.#query.status === 'done' && this.#doneHasMore;
	}

	/** Number of tickets that are not done (header counter, T-18); just checked rows count as done. */
	get openCount(): number {
		return this.#open.size;
	}

	/**
	 * Numbers of the KPI tiles (E3 plan, T-10 and package 12): every ticket that is not done,
	 * independent of filters and search, with the same boundary as `openCount` (just checked rows
	 * count as done). They follow realtime and the Berlin midnight.
	 */
	get kpis(): Kpis {
		return this.#kpis;
	}

	/** Loaded done tickets that pass the filters, most recently completed first (OF-E2-4). */
	get done(): readonly TicketSummary[] {
		return this.#doneList;
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

	/** True if the section "Erledigt" is shown (`showsDoneSection` of the current query). */
	get showDone(): boolean {
		return this.#showDone;
	}

	get doneState(): LoadState {
		return this.#doneState;
	}

	get doneError(): string | null {
		return this.#doneError;
	}

	get doneHasMore(): boolean {
		return this.#doneHasMore;
	}

	get loadingMoreDone(): boolean {
		return this.#loadingMoreDone;
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

	/** Error of the last check mark or undo action, null without one. */
	get notice(): string | null {
		return this.#notice;
	}

	/** Polite status message for screen readers (aria-live). */
	get announcement(): string {
		return this.#announcement;
	}

	/** Ticket from the list, null if it is not loaded. */
	find(id: string): TicketSummary | null {
		return this.#open.get(id) ?? this.#lingering.get(id)?.ticket ?? this.#done.get(id) ?? null;
	}

	/** State the check mark shows: the requested one while a request runs. */
	isChecked(ticket: TicketSummary): boolean {
		return this.#pending.get(ticket.id) ?? ticket.status === 'done';
	}

	isPending(id: string): boolean {
		return this.#pending.has(id);
	}

	/** True while a just checked row still stands with "Rückgängig". */
	isLingering(id: string): boolean {
		return this.#lingering.has(id);
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
					// Due filters of the done section refer to the date: load them for the new day.
					this.#syncDone();
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
	 * Shows the list for the state of the URL: filters, search and the switch "Erledigte anzeigen"
	 * (E3 plan, packages 10 and 11). Loads the open tickets once; they are only filtered, never
	 * loaded again. The section "Erledigt" is loaded, loaded again for other filters, or dropped; a
	 * request that became stale is aborted. A filter change announces the new number of tickets, a
	 * search announces it when its answer arrives.
	 */
	activate(query: ListQuery): void {
		const first = this.#openState === 'idle';
		if (first) void this.#loadOpen();
		const filtersChanged = !sameFiltersBesidesSearch(this.#query, query);
		this.#query = query;
		// A search from the URL of a fresh page applies at once, typing waits for the pause.
		this.#followSearch(activeSearch(query), first);
		this.#syncDone();
		if (!filtersChanged || this.#openState !== 'ready') return;
		if (query.status === 'done') this.#announceDone = true;
		else this.#announcement = countMessage(this.visibleCount);
	}

	/**
	 * Loads the open tickets once without showing the list: the project view counts its "aktiv"
	 * numbers from them (E3 plan, package 14), even when the app starts there.
	 */
	loadOpen(): void {
		if (this.#openState === 'idle') void this.#loadOpen();
	}

	/** Loads everything shown again ("Erneut versuchen"). */
	async reload(): Promise<void> {
		await Promise.all([this.#loadOpen(), this.#showDone ? this.#loadDone(1) : undefined]);
	}

	/** Next page of done tickets ("Weitere laden"). */
	async loadMoreDone(): Promise<void> {
		if (!this.#showDone || !this.#doneHasMore || this.#doneController !== null) return;
		await this.#loadDone(this.#donePage + 1);
	}

	/**
	 * Inserts or replaces a ticket (own answer or realtime event). An older `updated` than the
	 * one in the store is ignored, so a late event does not overwrite a newer answer.
	 */
	upsert(ticket: TicketSummary): void {
		if (this.#deleted.has(ticket.id)) return;
		this.#touched?.add(ticket.id);
		const existing = this.find(ticket.id);
		if (existing !== null && existing.updated > ticket.updated) return;
		const lingering = this.#lingering.get(ticket.id);
		if (ticket.status !== 'done') {
			if (lingering) this.#stopLingering(ticket.id);
			this.#done.delete(ticket.id);
			this.#open.set(ticket.id, ticket);
			return;
		}
		this.#open.delete(ticket.id);
		if (lingering) this.#lingering.set(ticket.id, { ...lingering, ticket });
		if (this.#belongsToLoadedDone(ticket)) this.#done.set(ticket.id, ticket);
		else this.#done.delete(ticket.id);
	}

	/** Removes a ticket from every part of the list (deleted or no longer visible). */
	remove(id: string): void {
		this.#deleted.add(id);
		this.#open.delete(id);
		this.#done.delete(id);
		this.#stopLingering(id);
		this.#pending.delete(id);
	}

	/**
	 * A ticket was just completed with the given previous status (check mark, or the status
	 * select of the panel): the row stays in place with "Rückgängig" for UNDO_WINDOW_MS.
	 */
	completed(ticket: TicketSummary, previousStatus: Status): void {
		if (ticket.status !== 'done' || previousStatus === 'done') {
			this.upsert(ticket);
			return;
		}
		this.#stopLingering(ticket.id);
		const existing = this.find(ticket.id);
		if (existing !== null && existing.updated > ticket.updated) return;
		const timer = setTimeout(() => this.#expire(ticket.id), UNDO_WINDOW_MS);
		this.#lingering.set(ticket.id, { ticket, previousStatus, timer });
		this.upsert(ticket);
	}

	/**
	 * Check mark (E2 plan, T-6): checking sets "done", unchecking sets REOPEN_STATUS. The check
	 * mark shows the new state at once, is locked during the request and springs back on failure.
	 */
	async setDone(id: string, done: boolean): Promise<void> {
		const ticket = this.find(id);
		if (ticket === null || this.#pending.has(id) || (ticket.status === 'done') === done) return;
		if (!this.#session.ensureValid()) return;
		this.#pending.set(id, done);
		this.#notice = null;
		try {
			const saved = await this.#data.setDone(id, done);
			if (done) this.completed(saved, ticket.status);
			else this.upsert(saved);
			this.#announcement = done
				? `${saved.key} erledigt. Rückgängig ist kurz möglich.`
				: `${saved.key} wieder offen.`;
		} catch (error) {
			this.#fail(error, `${ticket.key} konnte nicht geändert werden.`);
		} finally {
			this.#pending.delete(id);
		}
	}

	/** "Rückgängig" right after checking: restores the exact previous status (OF-E2-3). */
	async undo(id: string): Promise<void> {
		const lingering = this.#lingering.get(id);
		if (!lingering || this.#pending.has(id)) return;
		if (!this.#session.ensureValid()) return;
		this.#pending.set(id, false);
		this.#notice = null;
		try {
			const saved = await this.#data.update(id, { status: lingering.previousStatus });
			this.upsert(saved);
			this.#announcement = `${saved.key} ist wieder offen.`;
		} catch (error) {
			this.#fail(error, `${lingering.ticket.key} konnte nicht zurückgesetzt werden.`);
		} finally {
			this.#pending.delete(id);
		}
	}

	/** Polite status message (aria-live), e.g. after the panel deleted a ticket. */
	announce(message: string): void {
		this.#announcement = message;
	}

	dismissNotice(): void {
		this.#notice = null;
	}

	/**
	 * Keeps the list live (ADR-0007 sections 2 and 3): created and updated tickets go through
	 * `upsert`, deleted ones through `remove`, and after a reconnection the store reconciles
	 * once. Returns the cleanup, which ends both subscriptions and a running reconciliation.
	 */
	connect(live: LiveSource): () => void {
		const stops = [
			hold(
				live.tickets((change) => {
					if (change.action === 'delete') {
						this.remove(change.id);
						return;
					}
					this.upsert(change.record);
					// Title, description or key may have changed: ask for the IDs again.
					this.#refreshSearch();
				})
			),
			hold(live.reconnected(() => void this.reconcile()))
		];
		return () => {
			for (const stop of stops) stop();
			this.#reconcileController?.abort();
			this.#reconcileController = null;
		};
	}

	/**
	 * Reconciles with the server after events may have been lost (ADR-0007 section 3): loads the
	 * open tickets and the loaded pages of done tickets again and merges them into the store
	 * (insert, replace, remove) without a loading state, so nothing flickers. Rows that stand
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
		const doneLoaded = this.#showDone && this.#doneState === 'ready' ? this.#donePage : 0;
		const doneKey = this.#doneKey;
		const filter = this.#doneFilter();
		try {
			const open = await this.#data.listOpen(options);
			const pages: DoneTicketPage[] = [];
			for (let page = 1; page <= doneLoaded; page += 1) {
				pages.push(await this.#data.listDone(page, { ...options, filter }));
			}
			if (controller.signal.aborted) return;
			this.#touched = null;
			this.#mergeOpen(open, touched);
			// The done pages only count if the section still shows the same filters and pages.
			const sameDone = this.#donePage === doneLoaded && this.#doneKey === doneKey;
			if (doneLoaded > 0 && this.#showDone && sameDone) this.#mergeDone(pages, touched);
			this.#refreshSearch();
		} catch (error) {
			if (controller.signal.aborted) return;
			// Nothing to show: the list stays as it is, the next reconnection tries again.
			this.#failureMessage(error);
		} finally {
			if (this.#touched === touched) this.#touched = null;
			if (this.#reconcileController === controller) this.#reconcileController = null;
		}
	}

	/** Aborts all requests and timers and empties the store. */
	reset(): void {
		this.#openController?.abort();
		this.#doneController?.abort();
		this.#reconcileController?.abort();
		this.#openController = null;
		this.#doneController = null;
		this.#reconcileController = null;
		this.#touched = null;
		this.#deleted.clear();
		for (const { timer } of this.#lingering.values()) clearTimeout(timer);
		this.#open.clear();
		this.#done.clear();
		this.#lingering.clear();
		this.#pending.clear();
		this.#donePage = 0;
		this.#doneKey = null;
		this.#announceDone = false;
		clearTimeout(this.#searchTimer);
		clearTimeout(this.#searchRefreshTimer);
		this.#searchController?.abort();
		this.#searchController = null;
		this.#wantedSearch = null;
		this.#searchIdsFor = null;
		this.#search = null;
		this.#searchIds = null;
		this.#searchBusy = false;
		this.#searchError = null;
		this.#query = EMPTY_LIST_QUERY;
		this.#openState = 'idle';
		this.#openError = null;
		this.#showDone = false;
		this.#doneState = 'idle';
		this.#doneError = null;
		this.#doneHasMore = false;
		this.#loadingMoreDone = false;
		this.#notice = null;
		this.#announcement = '';
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
			const tickets = await this.#data.listOpen({ signal: controller.signal });
			if (controller.signal.aborted) return;
			this.#open.clear();
			for (const ticket of tickets) {
				if (!this.#lingering.has(ticket.id)) this.#open.set(ticket.id, ticket);
			}
			this.#openState = 'ready';
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

	async #loadDone(page: number): Promise<void> {
		this.#doneController?.abort();
		this.#doneController = null;
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#doneController = controller;
		const first = page === 1;
		if (first) this.#doneState = 'loading';
		else this.#loadingMoreDone = true;
		this.#doneError = null;
		try {
			const result = await this.#data.listDone(page, {
				signal: controller.signal,
				filter: this.#doneFilter()
			});
			if (controller.signal.aborted) return;
			if (first) this.#done.clear();
			for (const ticket of result.items) {
				const existing = this.#done.get(ticket.id);
				if (!existing || existing.updated <= ticket.updated) this.#done.set(ticket.id, ticket);
			}
			this.#donePage = result.page;
			this.#doneHasMore = result.hasMore;
			this.#doneState = 'ready';
			if (first && this.#announceDone) {
				this.#announceDone = false;
				this.#announcement = countMessage(this.#doneList.length, result.hasMore);
			}
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null) return;
			this.#doneError = message;
			if (first) this.#doneState = 'error';
		} finally {
			if (this.#doneController === controller) {
				this.#doneController = null;
				this.#loadingMoreDone = false;
			}
		}
	}

	#mergeOpen(open: readonly TicketSummary[], touched: ReadonlySet<string>): void {
		const ids = new SvelteSet(open.map((ticket) => ticket.id));
		for (const id of [...this.#open.keys()]) {
			if (!ids.has(id) && !touched.has(id)) this.#open.delete(id);
		}
		for (const ticket of open) this.upsert(ticket);
	}

	#mergeDone(pages: readonly DoneTicketPage[], touched: ReadonlySet<string>): void {
		const items = pages.flatMap((page) => page.items);
		const ids = new SvelteSet(items.map((ticket) => ticket.id));
		for (const id of [...this.#done.keys()]) {
			if (!ids.has(id) && !touched.has(id)) this.#done.delete(id);
		}
		for (const ticket of items) {
			if (this.#deleted.has(ticket.id) || touched.has(ticket.id)) continue;
			const existing = this.#done.get(ticket.id);
			if (existing === undefined || existing.updated <= ticket.updated) {
				this.#open.delete(ticket.id);
				this.#done.set(ticket.id, ticket);
			}
		}
		this.#doneHasMore = pages.at(-1)?.hasMore ?? false;
	}

	/**
	 * A done ticket joins the loaded done tickets only where the loaded pages cover it, so
	 * "Weitere laden" keeps the server order.
	 */
	#belongsToLoadedDone(ticket: TicketSummary): boolean {
		if (!this.#showDone || this.#doneState !== 'ready') return false;
		if (!matchesFilter(ticket, this.#query, this.#today)) return false;
		// An active search knows only the loaded rows and the IDs it found while they were open.
		if (this.#search !== null && !this.#done.has(ticket.id) && !this.#searchIds?.has(ticket.id)) {
			return false;
		}
		if (this.#done.has(ticket.id) || !this.#doneHasMore) return true;
		const last = this.#doneList.at(-1);
		return last === undefined || compareDone(ticket, last) < 0;
	}

	/** Filter of the done section for the server: the query at the current Berlin date. */
	#doneFilter(): DoneFilter {
		return { query: { ...this.#query, search: this.#search }, today: this.#today };
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

	/** Applies a search to the list and the done section; null shows both without search. */
	#applySearch(search: string | null): void {
		const changed = search !== this.#search;
		this.#search = search;
		this.#searchError = null;
		if (search === null) {
			this.#searchController?.abort();
			this.#searchController = null;
			clearTimeout(this.#searchRefreshTimer);
			this.#searchIds = null;
			this.#searchIdsFor = null;
			this.#searchBusy = false;
		} else {
			void this.#loadSearch(true);
		}
		if (!changed) return;
		const ready = this.#openState === 'ready';
		if (ready && this.#query.status === 'done') this.#announceDone = true;
		this.#syncDone();
		if (search === null && ready && this.#query.status !== 'done') {
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
	 * and a stale answer is dropped. A just checked row keeps its place: its ID stays while it
	 * stands with "Rückgängig", although the server no longer counts it as open. `announce` (a new
	 * search) marks the field as busy and announces the new number.
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
			const previous = this.#searchIdsFor === search ? this.#searchIds : null;
			const kept = [...this.#lingering.keys()].filter((id) => previous?.has(id) === true);
			this.#searchIds = new SvelteSet([...ids, ...kept]);
			this.#searchIdsFor = search;
			this.#searchError = null;
			if (announce && this.#openState === 'ready' && this.#query.status !== 'done') {
				this.#announcement = countMessage(this.visibleCount);
			}
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null) return;
			this.#searchError = message;
			this.#searchIds = null;
			this.#searchIdsFor = null;
		} finally {
			if (this.#searchController === controller) {
				this.#searchController = null;
				this.#searchBusy = false;
			}
		}
	}

	/**
	 * Brings the section "Erledigt" in line with the query and the date: shows and loads it, loads
	 * it again for other filters (old rows stay until the answer, as far as they still pass), or
	 * drops it. The date only counts while a due filter is set.
	 */
	#syncDone(): void {
		// The done section follows the applied search, not every typed character.
		const query = { ...this.#query, search: this.#search };
		const show = showsDoneSection(query);
		const key = show
			? JSON.stringify([
					...FILTER_KEYS.map((name) => query[name]),
					query.due === null ? '' : this.#today
				])
			: null;
		if (key === this.#doneKey) return;
		this.#doneKey = key;
		this.#showDone = show;
		if (show) {
			void this.#loadDone(1);
			return;
		}
		this.#doneController?.abort();
		this.#doneController = null;
		this.#done.clear();
		this.#donePage = 0;
		this.#doneHasMore = false;
		this.#loadingMoreDone = false;
		this.#doneState = 'idle';
		this.#doneError = null;
		this.#announceDone = false;
	}

	#expire(id: string): void {
		const lingering = this.#lingering.get(id);
		if (!lingering) return;
		// A request for this row is still running: keep it until the answer arrives.
		if (this.#pending.has(id)) {
			const timer = setTimeout(() => this.#expire(id), UNDO_WINDOW_MS);
			this.#lingering.set(id, { ...lingering, timer });
			return;
		}
		this.#lingering.delete(id);
	}

	#stopLingering(id: string): void {
		clearTimeout(this.#lingering.get(id)?.timer);
		this.#lingering.delete(id);
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

	#fail(error: unknown, prefix: string): void {
		const message = this.#failureMessage(error);
		if (message !== null) this.#notice = `${prefix} ${message}`;
	}
}

const [getTicketListStore, setTicketListStore] = createContext<TicketListStore>();

/** Store of the list, set by the app layout and read by the ticket views. */
export { getTicketListStore, setTicketListStore };
