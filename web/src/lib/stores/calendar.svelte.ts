// Done tickets of the calendar (ADR-0053 §5): only on demand, while the layer "Erledigte Tickets"
// (or the status filter "Erledigt") shows them, and only for the shown period, page by page up to
// CALENDAR_DONE_MAX_PAGES. The open tickets come from the list store, which keeps all of them live;
// done ones grow without end, so the calendar asks per period like the section "Erledigt" of the
// list asks per page (ADR-0013 section 3). The filters apply in the client, as for the open tickets,
// so changing one needs no request. Realtime keeps the loaded period current: a ticket completed,
// reopened, moved to another day or into the trash comes or goes without loading again; after a
// reconnection the period loads again (ADR-0007 section 3). One store per calendar layout.

import type PocketBase from 'pocketbase';
import { SvelteMap } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { listDoneTicketsDue, type DueRange, type TicketChoicePage } from '$lib/data/tickets';
import type { TicketSummary } from '$lib/domain/ticket';
import { hold, type LiveSource } from './realtime';
import type { LoadState, SessionGuard } from './ticket-list.svelte';

/** Pages of done tickets at most per period: 1000 tickets with the page size of the data layer. */
export const CALENDAR_DONE_MAX_PAGES = 5;

/** Data access of the done tickets; tests pass a fake, the app binds the data layer. */
export interface CalendarDoneData {
	listDone(range: DueRange, page: number, options: RequestOptions): Promise<TicketChoicePage>;
}

export function calendarDoneData(pb: PocketBase): CalendarDoneData {
	return {
		listDone: (range, page, options) => listDoneTicketsDue(pb, range, page, options)
	};
}

function sameRange(a: DueRange | null, b: DueRange | null): boolean {
	return a === b || (a !== null && b !== null && a.from === b.from && a.to === b.to);
}

export class CalendarDoneStore {
	readonly #data: CalendarDoneData;
	readonly #session: SessionGuard;
	readonly #done = new SvelteMap<string, TicketSummary>();
	#range = $state.raw<DueRange | null>(null);
	#state = $state<LoadState>('idle');
	#error = $state<string | null>(null);
	/** False when the period holds more done tickets than the pages loaded. */
	#complete = $state(true);
	#controller: AbortController | null = null;
	/**
	 * Tickets changed by events while a period loads (null: removed): the older snapshot of the
	 * answer must not undo them. Null while nothing loads.
	 */
	#touched: Map<string, TicketSummary | null> | null = null;
	#list = $derived([...this.#done.values()]);

	constructor(data: CalendarDoneData, session: SessionGuard) {
		this.#data = data;
		this.#session = session;
	}

	/** The loaded done tickets of the period, unsorted (the calendar sorts each day). */
	get done(): readonly TicketSummary[] {
		return this.#list;
	}

	get state(): LoadState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/** True unless the period holds more done tickets than CALENDAR_DONE_MAX_PAGES pages. */
	get complete(): boolean {
		return this.#complete;
	}

	/**
	 * Shows the done tickets of `range`, or none (null: their layer is off). The same range keeps
	 * what is loaded; another one aborts a running request and loads anew.
	 */
	follow(range: DueRange | null): void {
		if (sameRange(range, this.#range)) return;
		this.#range = range;
		if (range === null) {
			this.#abort();
			this.#done.clear();
			this.#state = 'idle';
			this.#error = null;
			this.#complete = true;
			return;
		}
		void this.#load(range);
	}

	/** Loads the period again ("Erneut versuchen", after a reconnection). */
	async reload(): Promise<void> {
		if (this.#range !== null) await this.#load(this.#range);
	}

	/**
	 * A ticket from an answer or a realtime event: a done one due in the period is shown, any other
	 * leaves (reopened, moved to another day). An older `updated` than the shown one is ignored.
	 */
	upsert(ticket: TicketSummary): void {
		if (this.#range === null) return;
		this.#touched?.set(ticket.id, ticket);
		this.#apply(ticket);
	}

	remove(id: string): void {
		this.#touched?.set(id, null);
		this.#done.delete(id);
	}

	#apply(ticket: TicketSummary): void {
		const range = this.#range;
		if (range === null) return;
		const existing = this.#done.get(ticket.id);
		if (existing !== undefined && existing.updated > ticket.updated) return;
		const inRange = ticket.due !== null && ticket.due >= range.from && ticket.due <= range.to;
		if (ticket.status === 'done' && inRange) this.#done.set(ticket.id, ticket);
		else this.#done.delete(ticket.id);
	}

	/** Follows the tickets live; returns the cleanup, which also empties the store. */
	connect(live: LiveSource): () => void {
		const reload = () => void this.reload();
		const stops = [
			hold(
				(guard) =>
					live.tickets(
						guard((change) => {
							if (change.action === 'delete') this.remove(change.id);
							else this.upsert(change.record);
						})
					),
				{ recovered: reload }
			),
			hold((guard) => live.reconnected(guard(reload)), { recovered: reload })
		];
		return () => {
			for (const stop of stops) stop();
			this.follow(null);
		};
	}

	#abort(): void {
		this.#controller?.abort();
		this.#controller = null;
	}

	async #load(range: DueRange): Promise<void> {
		this.#abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		const touched = new SvelteMap<string, TicketSummary | null>();
		this.#controller = controller;
		this.#touched = touched;
		this.#state = 'loading';
		this.#error = null;
		try {
			const loaded: TicketSummary[] = [];
			let more = true;
			let page = 1;
			while (more && page <= CALENDAR_DONE_MAX_PAGES) {
				const result = await this.#data.listDone(range, page, { signal: controller.signal });
				if (controller.signal.aborted) return;
				loaded.push(...result.items);
				more = result.hasMore;
				page += 1;
			}
			this.#done.clear();
			for (const ticket of loaded) this.#done.set(ticket.id, ticket);
			for (const [id, ticket] of touched) {
				if (ticket === null) this.#done.delete(id);
				else this.#apply(ticket);
			}
			this.#complete = !more;
			this.#state = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			const failure = toDataError(error);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			this.#error = failure.message;
			this.#state = 'error';
		} finally {
			if (this.#controller === controller) this.#controller = null;
			if (this.#touched === touched) this.#touched = null;
		}
	}
}
