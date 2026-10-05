// State of the view "Erledigte" (ER-1, ADR-0066): the done tickets of the area of the tab that pass
// the filters of its address, most recently completed first, page by page from the server (50 each,
// ADR-0006 section 3) with their number on all pages, in groups by the Berlin day of completion.
// The server filters (domain/done-view.ts and data/tickets.ts keep both forms equal); a realtime
// event is checked in the client against project, tag and charm, with a search by one request for
// that ticket. A ticket completed elsewhere joins at the top, a reopened one leaves at once, and a
// deleted, trashed or moved one leaves with its "delete". "Wieder öffnen" sends the reopen status at
// once and offers "Rückgängig" in its flag, which completes the ticket again (UI-5); a refused
// reopening of an instance offers to reopen it as a normal ticket (ADR-0023 addendum 4). The store
// lives with the layout of the view, so leaving it drops the loaded pages.

import type PocketBase from 'pocketbase';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	completedTicketMatches,
	countCompletedTickets,
	listCompletedTickets,
	setTicketDone,
	updateTicket,
	type CompletedFilter,
	type CompletedTicketPage
} from '$lib/data/tickets';
import type { CalendarDate } from '$lib/domain/berlin-date';
import {
	EMPTY_DONE_QUERY,
	activeDoneSearch,
	compareCompleted,
	doneCountText,
	groupDone,
	matchesDoneQuery,
	type DoneGroup,
	type DoneQuery
} from '$lib/domain/done-view';
import { NO_SUB_PROJECTS, type SubProjectsOf } from '$lib/domain/filter';
import { NO_PROJECT } from '$lib/domain/list-query';
import { REOPEN_DETACHED_LABEL } from '$lib/domain/recurrence-rule';
import { REOPEN_STATUS, type TicketPatch, type TicketSummary } from '$lib/domain/ticket';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type LiveSource } from './realtime';
import {
	SEARCH_DEBOUNCE_MS,
	reopenRefusalOf,
	type LoadState,
	type SessionGuard
} from './ticket-list.svelte';

/** Data access of the view; tests pass a fake, the app binds the data layer to its client. */
export interface DoneListData {
	list(
		page: number,
		options: RequestOptions & { filter: CompletedFilter }
	): Promise<CompletedTicketPage>;
	/** Whether the done ticket passes the filters with the search (one request for one ticket). */
	matches(id: string, filter: CompletedFilter, options: RequestOptions): Promise<boolean>;
	/** Number of the done tickets that pass the filters. */
	count(filter: CompletedFilter, options: RequestOptions): Promise<number>;
	/** false: "Wieder öffnen" (REOPEN_STATUS); true: "Rückgängig" completes it again. */
	setDone(id: string, done: boolean): Promise<TicketSummary>;
	/** "Als normales Ticket wieder öffnen (aus der Serie lösen)". */
	update(id: string, patch: TicketPatch): Promise<TicketSummary>;
}

export function doneListData(pb: PocketBase): DoneListData {
	return {
		list: (page, options) => listCompletedTickets(pb, page, options),
		matches: (id, filter, options) => completedTicketMatches(pb, id, filter, options),
		count: (filter, options) => countCompletedTickets(pb, filter, options),
		setDone: (id, done) => setTicketDone(pb, id, done),
		update: (id, patch) => updateTicket(pb, id, patch)
	};
}

/** The list of the open tickets: a reopened ticket joins it at once, its event follows. */
export interface OpenTicketSink {
	upsert(ticket: TicketSummary): void;
}

export interface DoneListOptions {
	/** Berlin date of the groups; the app passes the clock of the list store (midnight). */
	today: () => CalendarDate;
	/** Sub project IDs of a project (ADR-0034); the app passes the catalog. */
	subProjectsOf?: SubProjectsOf;
	/** Results and "Rückgängig"; without them nothing is shown. */
	flags?: FlagSink;
	open?: OpenTicketSink;
}

/** Text of the live region after the filters changed or more were loaded. */
export function doneAnnouncement(total: number): string {
	return total === 0 ? 'Keine erledigten Tickets für diese Filter.' : `${doneCountText(total)}.`;
}

export class DoneListStore {
	readonly #data: DoneListData;
	readonly #session: SessionGuard;
	readonly #today: () => CalendarDate;
	readonly #subProjectsOf: SubProjectsOf;
	readonly #flags: FlagSink;
	readonly #open: OpenTicketSink | null;

	readonly #tickets = new SvelteMap<string, TicketSummary>();
	/** Tickets whose reopening or completing again runs. */
	readonly #pending = new SvelteSet<string>();
	/** Flags whose "Rückgängig" still stands, keyed by ticket ID. */
	readonly #undoable = new SvelteMap<string, string>();
	/** Running checks of the search for tickets of realtime events, keyed by ticket ID. */
	readonly #checks = new SvelteMap<string, AbortController>();

	#query = $state<DoneQuery>(EMPTY_DONE_QUERY);
	/** The filters the loaded pages belong to; another key loads page 1 again. */
	#key: string | null = null;
	#page = 0;
	#controller: AbortController | null = null;
	#reconcileController: AbortController | null = null;
	#countController: AbortController | null = null;
	#searchTimer: ReturnType<typeof setTimeout> | undefined;
	#countTimer: ReturnType<typeof setTimeout> | undefined;

	#state = $state<LoadState>('idle');
	#error = $state<string | null>(null);
	#moreError = $state<string | null>(null);
	#hasMore = $state(false);
	#loadingMore = $state(false);
	#total = $state<number | null>(null);
	#announcement = $state('');

	#list = $derived([...this.#tickets.values()].sort(compareCompleted));
	#groups = $derived(groupDone(this.#list, this.#todayOf()));

	constructor(
		data: DoneListData,
		session: SessionGuard,
		{ today, subProjectsOf = NO_SUB_PROJECTS, flags = SILENT_FLAGS, open }: DoneListOptions
	) {
		this.#data = data;
		this.#session = session;
		this.#today = today;
		this.#subProjectsOf = subProjectsOf;
		this.#flags = flags;
		this.#open = open ?? null;
	}

	#todayOf(): CalendarDate {
		return this.#today();
	}

	/** Berlin date the groups refer to. */
	get today(): CalendarDate {
		return this.#today();
	}

	/** The loaded done tickets, most recently completed first. */
	get tickets(): readonly TicketSummary[] {
		return this.#list;
	}

	/** The loaded tickets in their groups: "Heute", "Gestern", …, one per earlier month. */
	get groups(): readonly DoneGroup[] {
		return this.#groups;
	}

	/** The state of the address the store shows. */
	get query(): DoneQuery {
		return this.#query;
	}

	/** idle before the first `show`, loading until the first page is there. */
	get state(): LoadState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/** Failure of "Mehr laden"; the loaded pages stay. */
	get moreError(): string | null {
		return this.#moreError;
	}

	get hasMore(): boolean {
		return this.#hasMore;
	}

	get loadingMore(): boolean {
		return this.#loadingMore;
	}

	/** Done tickets that pass the filters, on all pages; null until the first page. */
	get total(): number | null {
		return this.#total;
	}

	/** Polite status message for screen readers (aria-live). */
	get announcement(): string {
		return this.#announcement;
	}

	isPending(id: string): boolean {
		return this.#pending.has(id);
	}

	/** A loaded done ticket, or null. */
	find(id: string): TicketSummary | null {
		return this.#tickets.get(id) ?? null;
	}

	/**
	 * Shows the done tickets for the state of the address. The first call and changed filters load
	 * page 1 (the rows shown stay until the answer); a changed search waits for the pause after the
	 * last key, like in "Aufgaben".
	 */
	show(query: DoneQuery): void {
		const first = this.#state === 'idle';
		const before = this.#query;
		this.#query = query;
		const key = this.#keyOf(query);
		if (key === this.#key) return;
		this.#key = key;
		clearTimeout(this.#searchTimer);
		const onlySearch = this.#keyOf({ ...query, search: before.search }) === this.#keyOf(before);
		const typing = !first && onlySearch && activeDoneSearch(query) !== null;
		if (typing) {
			this.#searchTimer = setTimeout(() => void this.#load(1, true), SEARCH_DEBOUNCE_MS);
			return;
		}
		void this.#load(1, !first);
	}

	/** The sub projects of the chosen project changed (catalog loaded, one added; ADR-0034). */
	followSubProjects(): void {
		if (this.#state === 'idle') return;
		this.show(this.#query);
	}

	/** "Erneut versuchen": page 1 again. */
	async reload(): Promise<void> {
		await this.#load(1, false);
	}

	/** "Mehr laden" and the end of the list in view: the next page, once at a time. */
	async loadMore(): Promise<void> {
		if (!this.#hasMore || this.#controller !== null || this.#state !== 'ready') return;
		await this.#load(this.#page + 1, false);
	}

	/** The area of the tab changed (ADR-0059): its done tickets replace the shown ones. */
	rescope(): void {
		const shown = this.#state !== 'idle';
		const query = this.#query;
		this.reset();
		if (shown) this.show(query);
	}

	/** Aborts every request and timer and empties the store. */
	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#reconcileController?.abort();
		this.#reconcileController = null;
		this.#countController?.abort();
		this.#countController = null;
		for (const controller of this.#checks.values()) controller.abort();
		this.#checks.clear();
		clearTimeout(this.#searchTimer);
		clearTimeout(this.#countTimer);
		for (const flagId of this.#undoable.values()) this.#flags.dismiss(flagId);
		this.#undoable.clear();
		this.#tickets.clear();
		this.#pending.clear();
		this.#query = EMPTY_DONE_QUERY;
		this.#key = null;
		this.#page = 0;
		this.#state = 'idle';
		this.#error = null;
		this.#moreError = null;
		this.#hasMore = false;
		this.#loadingMore = false;
		this.#total = null;
		this.#announcement = '';
	}

	/**
	 * Keeps the view live (ADR-0007): ticket events of the area and, after a reconnection or a
	 * subscription that came only after failed attempts, one reconciliation. Returns the cleanup.
	 */
	connect(live: LiveSource): () => void {
		const reconcile = () => void this.reconcile();
		const stops = [
			hold(
				(guard) =>
					live.tickets(
						guard((change) => {
							if (change.action === 'delete') this.remove(change.id);
							else this.arrive(change.record);
						})
					),
				{ recovered: reconcile }
			),
			hold((guard) => live.reconnected(guard(reconcile)), { recovered: reconcile })
		];
		return () => {
			for (const stop of stops) stop();
			this.#reconcileController?.abort();
			this.#reconcileController = null;
			this.#countController?.abort();
			this.#countController = null;
			clearTimeout(this.#countTimer);
		};
	}

	/**
	 * A ticket of an answer or a realtime event: one that is no longer done leaves; a done one that
	 * passes the filters stays or joins where the loaded pages cover it (a newer one at the top), one
	 * that does not leaves. With a search the server decides for it. An older version is ignored. A
	 * ticket done again by another way ends the "Rückgängig" of its reopening.
	 */
	arrive(ticket: TicketSummary): void {
		const existing = this.#tickets.get(ticket.id);
		if (existing !== undefined && existing.updated > ticket.updated) return;
		if (ticket.status === 'done') this.#dropUndo(ticket.id);
		if (ticket.status !== 'done' || !matchesDoneQuery(ticket, this.#query, this.#subProjectsOf)) {
			this.#drop(ticket.id);
			return;
		}
		if (this.#state !== 'ready' && this.#state !== 'loading') return;
		if (activeDoneSearch(this.#query) === null) {
			this.#take(ticket);
			return;
		}
		void this.#checkSearch(ticket);
	}

	/** A deleted ticket, one in the trash or one moved into another area leaves. */
	remove(id: string): void {
		this.#checks.get(id)?.abort();
		this.#checks.delete(id);
		this.#dropUndo(id);
		this.#drop(id);
	}

	/**
	 * "Wieder öffnen": the reopen status at once; the ticket leaves the view and joins the open
	 * list, the flag "KEY wieder offen." offers "Rückgängig". A refused reopening of an instance
	 * names the open ticket of its series and offers to reopen it as a normal ticket.
	 */
	async reopen(id: string): Promise<void> {
		const ticket = this.#tickets.get(id);
		if (ticket === undefined || this.#pending.has(id) || !this.#session.ensureValid()) return;
		this.#pending.add(id);
		try {
			const saved = await this.#data.setDone(id, false);
			this.#drop(id);
			this.#open?.upsert(saved);
			this.#offerUndo(saved);
		} catch (error) {
			this.#fail(error, `${ticket.key} konnte nicht wieder geöffnet werden.`, id);
		} finally {
			this.#pending.delete(id);
		}
	}

	/** "Als normales Ticket wieder öffnen (aus der Serie lösen)" after a refused reopening. */
	async reopenDetached(id: string): Promise<void> {
		const ticket = this.#tickets.get(id);
		if (ticket === undefined || this.#pending.has(id) || !this.#session.ensureValid()) return;
		this.#pending.add(id);
		try {
			const saved = await this.#data.update(id, { status: REOPEN_STATUS, detachSeries: true });
			this.#drop(id);
			this.#open?.upsert(saved);
			this.#flags.show({
				tone: 'success',
				title: `${saved.key} ist wieder offen, als normales Ticket.`
			});
		} catch (error) {
			this.#fail(error, `${ticket.key} konnte nicht wieder geöffnet werden.`);
		} finally {
			this.#pending.delete(id);
		}
	}

	/**
	 * Loads the pages shown so far again and merges them (ADR-0007 section 3) without a loading
	 * state; a second call aborts a running one. A view that failed to load simply loads again.
	 */
	async reconcile(): Promise<void> {
		this.#reconcileController?.abort();
		this.#reconcileController = null;
		if (this.#state === 'error') {
			await this.reload();
			return;
		}
		if (this.#state !== 'ready' || !this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#reconcileController = controller;
		const pages = this.#page;
		const key = this.#key;
		const filter = this.#filter();
		try {
			const loaded: CompletedTicketPage[] = [];
			for (let page = 1; page <= pages; page += 1) {
				loaded.push(await this.#data.list(page, { signal: controller.signal, filter }));
			}
			if (controller.signal.aborted || key !== this.#key || pages !== this.#page) return;
			const items = loaded.flatMap((page) => page.items);
			const ids = new SvelteSet(items.map((ticket) => ticket.id));
			for (const id of [...this.#tickets.keys()]) {
				if (!ids.has(id) && !this.#pending.has(id)) this.#tickets.delete(id);
			}
			for (const ticket of items) {
				const existing = this.#tickets.get(ticket.id);
				if (existing === undefined || existing.updated <= ticket.updated) {
					this.#tickets.set(ticket.id, ticket);
				}
			}
			const last = loaded.at(-1);
			this.#hasMore = last?.hasMore ?? false;
			this.#total = last?.total ?? this.#total;
		} catch (error) {
			if (!controller.signal.aborted) this.#failureMessage(error);
		} finally {
			if (this.#reconcileController === controller) this.#reconcileController = null;
		}
	}

	/** Key of the filters a page belongs to, with the sub projects the project takes in. */
	#keyOf(query: DoneQuery): string {
		return JSON.stringify([
			activeDoneSearch(query),
			query.project,
			query.subProjects,
			query.tag,
			query.charm,
			this.#subProjectIds(query)
		]);
	}

	#subProjectIds(query: DoneQuery): readonly string[] {
		const { project, subProjects } = query;
		if (project === null || project === NO_PROJECT || !subProjects) return [];
		return this.#subProjectsOf(project);
	}

	#filter(): CompletedFilter {
		const filter: CompletedFilter = { query: this.#query };
		if (this.#subProjectIds(this.#query).length > 0) filter.withSubProjects = true;
		return filter;
	}

	/** Loads a page; page 1 replaces the loaded ones, `announce` says the new number. */
	async #load(page: number, announce: boolean): Promise<void> {
		this.#controller?.abort();
		this.#controller = null;
		clearTimeout(this.#searchTimer);
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		const first = page === 1;
		if (first) {
			this.#state = 'loading';
			this.#error = null;
		} else {
			this.#loadingMore = true;
		}
		this.#moreError = null;
		try {
			const result = await this.#data.list(page, {
				signal: controller.signal,
				filter: this.#filter()
			});
			if (controller.signal.aborted) return;
			if (first) this.#tickets.clear();
			for (const ticket of result.items) {
				const existing = this.#tickets.get(ticket.id);
				if (existing === undefined || existing.updated <= ticket.updated) {
					this.#tickets.set(ticket.id, ticket);
				}
			}
			this.#page = result.page;
			this.#hasMore = result.hasMore;
			this.#total = result.total;
			this.#state = 'ready';
			if (first && announce) this.#announcement = doneAnnouncement(result.total);
			if (!first) {
				this.#announcement = `${result.items.length} weitere geladen, ${this.#list.length} von ${result.total} angezeigt.`;
			}
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null) return;
			if (first) {
				this.#error = message;
				this.#state = 'error';
			} else {
				this.#moreError = message;
			}
		} finally {
			if (this.#controller === controller) {
				this.#controller = null;
				this.#loadingMore = false;
			}
		}
	}

	/**
	 * Takes a done ticket that passes the filters, where the loaded pages cover it: newer than the
	 * last loaded one, or every page is loaded. Such a ticket was not among them before, so it was
	 * completed or changed into the filters just now and counts once more. One beyond the loaded
	 * pages (an older ticket that was changed) stays for "Mehr laden"; whether it counted before
	 * only the server knows, so it is asked for the number.
	 */
	#take(ticket: TicketSummary): void {
		if (this.#tickets.has(ticket.id)) {
			this.#tickets.set(ticket.id, ticket);
			return;
		}
		const last = this.#list.at(-1);
		const covered = !this.#hasMore || last === undefined || compareCompleted(ticket, last) < 0;
		if (!covered) {
			this.#refreshTotal();
			return;
		}
		this.#tickets.set(ticket.id, ticket);
		if (this.#total !== null) this.#total += 1;
	}

	/** Asks the server for the number after the pause of a burst of events. */
	#refreshTotal(): void {
		clearTimeout(this.#countTimer);
		this.#countTimer = setTimeout(() => void this.#loadTotal(), SEARCH_DEBOUNCE_MS);
	}

	async #loadTotal(): Promise<void> {
		this.#countController?.abort();
		if (this.#state !== 'ready' || !this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#countController = controller;
		const key = this.#key;
		try {
			const total = await this.#data.count(this.#filter(), { signal: controller.signal });
			if (!controller.signal.aborted && key === this.#key) this.#total = total;
		} catch (error) {
			if (!controller.signal.aborted) this.#failureMessage(error);
		} finally {
			if (this.#countController === controller) this.#countController = null;
		}
	}

	/** Removes a loaded ticket and counts it out. */
	#drop(id: string): void {
		if (!this.#tickets.delete(id)) return;
		if (this.#total !== null && this.#total > 0) this.#total -= 1;
	}

	/** With a search the server decides whether a ticket of an event belongs to the view. */
	async #checkSearch(ticket: TicketSummary): Promise<void> {
		this.#checks.get(ticket.id)?.abort();
		const controller = new AbortController();
		this.#checks.set(ticket.id, controller);
		const key = this.#key;
		try {
			const matches = await this.#data.matches(ticket.id, this.#filter(), {
				signal: controller.signal
			});
			if (controller.signal.aborted || key !== this.#key) return;
			const existing = this.#tickets.get(ticket.id);
			if (existing !== undefined && existing.updated > ticket.updated) return;
			if (matches) this.#take(ticket);
			else this.#drop(ticket.id);
		} catch (error) {
			if (!controller.signal.aborted) this.#failureMessage(error);
		} finally {
			if (this.#checks.get(ticket.id) === controller) this.#checks.delete(ticket.id);
		}
	}

	/** The flag of a reopened ticket with "Rückgängig" (UI-5). */
	#offerUndo(saved: TicketSummary): void {
		this.#dropUndo(saved.id);
		const id = saved.id;
		const flagId = this.#flags.show({
			tone: 'success',
			title: `${saved.key} wieder offen.`,
			action: { label: 'Rückgängig', run: () => void this.#undo(saved) },
			onclose: () => {
				if (this.#undoable.get(id) === flagId) this.#undoable.delete(id);
			}
		});
		this.#undoable.set(id, flagId);
	}

	/**
	 * "Rückgängig" of "Wieder öffnen": completes the ticket again. The server sets the time of
	 * completion, so it stands as completed now (ADR-0066 §4).
	 */
	async #undo(reopened: TicketSummary): Promise<void> {
		const id = reopened.id;
		this.#undoable.delete(id);
		if (this.#pending.has(id) || !this.#session.ensureValid()) return;
		this.#pending.add(id);
		try {
			const saved = await this.#data.setDone(id, true);
			this.#open?.upsert(saved);
			this.arrive(saved);
			this.#flags.show({ tone: 'success', title: `${saved.key} wieder erledigt.` });
		} catch (error) {
			this.#fail(error, `${reopened.key} konnte nicht wieder erledigt werden.`);
		} finally {
			this.#pending.delete(id);
		}
	}

	/** Ends the chance of "Rückgängig" for a ticket and closes its flag. */
	#dropUndo(id: string): void {
		const flagId = this.#undoable.get(id);
		if (flagId === undefined) return;
		this.#undoable.delete(id);
		this.#flags.dismiss(flagId);
	}

	/**
	 * A failed action as an error flag; a refused reopening of an instance (ADR-0023 addendum 4)
	 * names the open ticket of the series and, with `detach`, offers to reopen it as a normal one.
	 */
	#fail(error: unknown, prefix: string, detach?: string): void {
		const refusal = reopenRefusalOf(error);
		const message = refusal ?? this.#failureMessage(error);
		if (message === null) return;
		this.#flags.show({
			tone: 'error',
			title: `${prefix} ${message}`,
			...(refusal !== null &&
				detach !== undefined && {
					action: { label: REOPEN_DETACHED_LABEL, run: () => void this.reopenDetached(detach) }
				})
		});
	}

	/** German message of a failure, or null: aborted is none, an ended session leads to the login. */
	#failureMessage(error: unknown): string | null {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		return failure.message;
	}
}
