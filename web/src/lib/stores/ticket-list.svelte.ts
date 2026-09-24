// State of the ticket list (ADR-0006 sections 1 to 5, E2 plan package 5). Open tickets are loaded
// in full and sorted client side; done tickets are loaded page by page in the server order. The
// store is created per app layout and handed out through a typed context, so a logout leaves no
// data behind. Own answers and (from package 12) realtime events go through the same idempotent
// `upsert` and `remove`.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	listDoneTickets,
	listOpenTickets,
	setTicketDone,
	updateTicket,
	type DoneTicketPage
} from '$lib/data/tickets';
import { berlinToday, msUntilNextBerlinMidnight, type CalendarDate } from '$lib/domain/berlin-date';
import { ticketOrder } from '$lib/domain/ordering';
import type { Status } from '$lib/domain/status';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';

/**
 * How long a checked row stays in place, struck through and with "Rückgängig" (OF-E2-2,
 * recommendation until decided).
 */
export const UNDO_WINDOW_MS = 5000;

/** Delay after the Berlin midnight before "today" is computed again (E2 plan, T-3). */
export const MIDNIGHT_BUFFER_MS = 1000;

/** idle: not requested; loading: first request running; ready: loaded; error: loading failed. */
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Data access of the list; tests pass a fake, the app binds the data layer to its client. */
export interface TicketListData {
	listOpen(options: RequestOptions): Promise<TicketSummary[]>;
	listDone(page: number, options: RequestOptions): Promise<DoneTicketPage>;
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

export class TicketListStore {
	readonly #data: TicketListData;
	readonly #session: SessionGuard;
	readonly #now: () => number;

	readonly #open = new SvelteMap<string, TicketSummary>();
	readonly #done = new SvelteMap<string, TicketSummary>();
	readonly #lingering = new SvelteMap<string, Lingering>();
	/** Target state of running check mark requests, keyed by ticket ID. */
	readonly #pending = new SvelteMap<string, boolean>();

	#openController: AbortController | null = null;
	#doneController: AbortController | null = null;
	#donePage = 0;

	#today = $state<CalendarDate>('');
	#openState = $state<LoadState>('idle');
	#openError = $state<string | null>(null);
	#showDone = $state(false);
	#doneState = $state<LoadState>('idle');
	#doneError = $state<string | null>(null);
	#doneHasMore = $state(false);
	#loadingMoreDone = $state(false);
	#notice = $state<string | null>(null);
	#announcement = $state('');

	#openList = $derived.by(() => {
		const lingering = [...this.#lingering.values()].map((entry) => entry.ticket);
		return [...this.#open.values(), ...lingering].sort(ticketOrder(this.#today));
	});
	#doneList = $derived(
		[...this.#done.values()].filter((ticket) => !this.#lingering.has(ticket.id)).sort(compareDone)
	);

	constructor(data: TicketListData, session: SessionGuard, now: () => number = Date.now) {
		this.#data = data;
		this.#session = session;
		this.#now = now;
		this.#today = berlinToday(now());
	}

	/** Open tickets in the default order (P-2), including rows that were just checked. */
	get open(): readonly TicketSummary[] {
		return this.#openList;
	}

	/** Loaded done tickets, most recently completed first (OF-E2-4). */
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
	 * Shows the list with or without done tickets (switch from the URL). Loads the open tickets
	 * once; switching loads or drops the done tickets and aborts a request that became stale.
	 */
	activate(showDone: boolean): void {
		if (this.#openState === 'idle') void this.#loadOpen();
		if (showDone === this.#showDone) return;
		this.#showDone = showDone;
		if (showDone) {
			void this.#loadDone(1);
		} else {
			this.#doneController?.abort();
			this.#doneController = null;
			this.#done.clear();
			this.#donePage = 0;
			this.#doneHasMore = false;
			this.#loadingMoreDone = false;
			this.#doneState = 'idle';
			this.#doneError = null;
		}
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
	}

	/** Removes a ticket from every part of the list (deleted or no longer visible). */
	remove(id: string): void {
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

	/** Aborts all requests and timers and empties the store. */
	reset(): void {
		this.#openController?.abort();
		this.#doneController?.abort();
		this.#openController = null;
		this.#doneController = null;
		for (const { timer } of this.#lingering.values()) clearTimeout(timer);
		this.#open.clear();
		this.#done.clear();
		this.#lingering.clear();
		this.#pending.clear();
		this.#donePage = 0;
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
			const result = await this.#data.listDone(page, { signal: controller.signal });
			if (controller.signal.aborted) return;
			if (first) this.#done.clear();
			for (const ticket of result.items) {
				const existing = this.#done.get(ticket.id);
				if (!existing || existing.updated <= ticket.updated) this.#done.set(ticket.id, ticket);
			}
			this.#donePage = result.page;
			this.#doneHasMore = result.hasMore;
			this.#doneState = 'ready';
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

	/**
	 * A done ticket joins the loaded done tickets only where the loaded pages cover it, so
	 * "Weitere laden" keeps the server order.
	 */
	#belongsToLoadedDone(ticket: TicketSummary): boolean {
		if (!this.#showDone || this.#doneState !== 'ready') return false;
		if (this.#done.has(ticket.id) || !this.#doneHasMore) return true;
		const last = this.#doneList.at(-1);
		return last === undefined || compareDone(ticket, last) < 0;
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
