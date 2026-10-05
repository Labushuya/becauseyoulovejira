// Tickets as sources of the open ticket (QT-1, ADR-0067): the tickets it stems from (shown in the
// section "Quellen" next to the entries of the inbox), the tickets that stem from it (section
// "Folge-Tickets") and every ticket further down, which the ticket picker of "Quelle hinzufügen →
// Ticket" leaves out (a circle). Loaded through the route for the ticket in the panel or the full
// view, so a ticket in the trash still shows with "(im Papierkorb)". Kept live (ADR-0007): a link of
// the open ticket made or removed elsewhere (another tab, the partner, "Folge-Ticket anlegen …"), and
// a change of a linked ticket (title, status, trash) load the origins again, quietly; so does a new
// connection. Adding and removing go through the routes, which answer the new origins. Before the
// migration the route answers 503: the store is not `available`, and the views offer nothing of it.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	onReconnect,
	subscribeTicketSources,
	subscribeTickets,
	type RecordChange,
	type Unsubscribe
} from '$lib/data/realtime';
import {
	addTicketSource,
	getTicketOrigins,
	removeTicketSource,
	type TicketSourceLink
} from '$lib/data/ticket-origins';
import type { TicketOrigin, TicketOrigins } from '$lib/domain/ticket-origins';
import type { TicketSummary } from '$lib/domain/ticket';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type HoldOptions } from './realtime';
import type { LoadState, SessionGuard } from './ticket-list.svelte';

/** Data access of the origins; tests pass a fake, the app binds the data layer to its client. */
export interface TicketOriginsData {
	load(ticketId: string, options: RequestOptions): Promise<TicketOrigins>;
	add(ticketId: string, sourceId: string): Promise<TicketOrigins>;
	remove(ticketId: string, sourceId: string): Promise<TicketOrigins>;
	/** The links of one ticket as follow-up or source. */
	links(
		ticketId: string,
		onChange: (change: RecordChange<TicketSourceLink>) => void
	): Promise<Unsubscribe>;
	/** Every visible ticket of the area (list fields): a linked ticket that changed. */
	tickets(onChange: (change: RecordChange<TicketSummary>) => void): Promise<Unsubscribe>;
	/** Called after a new connection that follows an interrupted one, or a change of the area. */
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function ticketOriginsData(pb: PocketBase): TicketOriginsData {
	return {
		load: (ticketId, options) => getTicketOrigins(pb, ticketId, options),
		add: (ticketId, sourceId) => addTicketSource(pb, ticketId, sourceId),
		remove: (ticketId, sourceId) => removeTicketSource(pb, ticketId, sourceId),
		links: (ticketId, onChange) => subscribeTicketSources(pb, ticketId, onChange),
		tickets: (onChange) => subscribeTickets(pb, onChange),
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

/** Outcome of adding or removing; a refusal carries its text (null for an abort or a lost session). */
export type OriginResult = { ok: true } | { ok: false; message: string | null };

/** The ticket whose sources change, by ID and key (for the flag). */
export interface OriginTarget {
	id: string;
	key: string;
}

export class TicketOriginsStore {
	readonly #data: TicketOriginsData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #hold: HoldOptions;
	/** Sources or follow-ups with a running request, by the ID of the other ticket. */
	readonly #pending = new SvelteSet<string>();
	#controller: AbortController | null = null;
	#stopLinks: (() => void) | null = null;

	#ticketId = $state<string | null>(null);
	#origins = $state.raw<TicketOrigins | null>(null);
	#state = $state<LoadState>('idle');
	#error = $state<string | null>(null);
	/** False before the migration (503) until a load succeeds. */
	#available = $state(true);

	constructor(
		data: TicketOriginsData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		holdOptions: HoldOptions = {}
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#hold = holdOptions;
	}

	/** Ticket whose origins are shown, null before the first one. */
	get ticketId(): string | null {
		return this.#ticketId;
	}

	get state(): LoadState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/** The server knows tickets as sources (after the migration). */
	get available(): boolean {
		return this.#available;
	}

	/** The origins of the open ticket once loaded, else null. */
	get origins(): TicketOrigins | null {
		return this.#origins;
	}

	/** Source tickets of the open ticket, oldest link first. */
	get sources(): readonly TicketOrigin[] {
		return this.#origins?.sources ?? [];
	}

	/** Direct follow-ups of the open ticket. */
	get followUps(): readonly TicketOrigin[] {
		return this.#origins?.followUps ?? [];
	}

	isPending(id: string): boolean {
		return this.#pending.has(id);
	}

	/** Shows the origins of a ticket and follows its links live. */
	open(ticketId: string): void {
		if (ticketId === this.#ticketId && this.#state !== 'error') return;
		this.#ticketId = ticketId;
		this.#origins = null;
		this.#follow(ticketId);
		void this.#load(ticketId, false);
	}

	/** Loads the origins again ("Erneut versuchen"). */
	async reload(): Promise<void> {
		if (this.#ticketId !== null) await this.#load(this.#ticketId, false);
	}

	/** Forgets the ticket (panel closed, session ended). */
	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#stopLinks?.();
		this.#stopLinks = null;
		this.#ticketId = null;
		this.#origins = null;
		this.#state = 'idle';
		this.#error = null;
	}

	/**
	 * "Quelle hinzufügen → Ticket": `ticket` stems from `source` from now on. The answer of the route
	 * replaces the origins; a refusal (a circle with its chain, another area, a ticket gone) comes back
	 * as text for the dialog. Success shows a flag.
	 */
	async add(ticket: OriginTarget, source: OriginTarget): Promise<OriginResult> {
		if (this.#pending.has(source.id) || !this.#session.ensureValid()) {
			return { ok: false, message: null };
		}
		this.#pending.add(source.id);
		try {
			const origins = await this.#data.add(ticket.id, source.id);
			this.#take(origins);
			this.#flags.show({ tone: 'success', title: `${ticket.key} stammt jetzt aus ${source.key}.` });
			return { ok: true };
		} catch (error) {
			return { ok: false, message: this.#failureMessage(error) };
		} finally {
			this.#pending.delete(source.id);
		}
	}

	/** Removes a source ticket of `ticket`; a failure is an error flag. */
	async remove(
		ticket: OriginTarget,
		source: Pick<TicketOrigin, 'id' | 'key'>
	): Promise<OriginResult> {
		if (this.#pending.has(source.id) || !this.#session.ensureValid()) {
			return { ok: false, message: null };
		}
		this.#pending.add(source.id);
		try {
			const origins = await this.#data.remove(ticket.id, source.id);
			this.#take(origins);
			this.#flags.show({
				tone: 'success',
				title: `${source.key} ist keine Quelle von ${ticket.key} mehr.`
			});
			return { ok: true };
		} catch (error) {
			const message = this.#failureMessage(error);
			if (message !== null) {
				this.#flags.show({
					tone: 'error',
					title: `${source.key} ließ sich nicht als Quelle entfernen.`,
					description: message
				});
			}
			return { ok: false, message };
		} finally {
			this.#pending.delete(source.id);
		}
	}

	/** The ticket is the open one or one of its links. */
	#concerns(id: string): boolean {
		if (id === this.#ticketId) return true;
		const origins = this.#origins;
		if (origins === null) return false;
		return (
			origins.sources.some((entry) => entry.id === id) ||
			origins.followUps.some((entry) => entry.id === id)
		);
	}

	#refresh(): void {
		if (this.#ticketId !== null && this.#available) void this.#load(this.#ticketId, true);
	}

	/**
	 * While a ticket is open (ADR-0007): its links, the tickets of the area (a change of a linked
	 * ticket or of the open one) and the connection load the origins again without a loading state.
	 */
	#follow(ticketId: string): void {
		this.#stopLinks?.();
		const refresh = () => this.#refresh();
		const options = { ...this.#hold, recovered: refresh };
		const stops = [
			hold((guard) => this.#data.links(ticketId, guard(refresh)), options),
			hold(
				(guard) =>
					this.#data.tickets(
						guard((change) => {
							const id = change.action === 'delete' ? change.id : change.record.id;
							if (this.#concerns(id)) refresh();
						})
					),
				options
			),
			hold((guard) => this.#data.reconnected(guard(refresh)), this.#hold)
		];
		this.#stopLinks = () => {
			for (const stop of stops) stop();
		};
	}

	/** Answers of the routes and loads for the open ticket replace what is shown. */
	#take(origins: TicketOrigins): void {
		if (origins.ticketId !== this.#ticketId) return;
		this.#origins = origins;
		this.#state = 'ready';
		this.#error = null;
		this.#available = true;
	}

	async #load(ticketId: string, quiet: boolean): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		if (!quiet) {
			this.#state = 'loading';
			this.#error = null;
		}
		try {
			const origins = await this.#data.load(ticketId, { signal: controller.signal });
			if (controller.signal.aborted || this.#ticketId !== ticketId) return;
			this.#take(origins);
		} catch (error) {
			if (controller.signal.aborted) return;
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'server' && failure.status === 503) {
				// Before the migration: nothing of tickets as sources is offered.
				this.#available = false;
				this.#state = 'ready';
				this.#origins = null;
				return;
			}
			const message = this.#failureMessage(error);
			if (message === null) return;
			if (quiet && this.#origins !== null) return;
			this.#state = 'error';
			this.#error = message;
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/** Message of a failure; null for an abort or a lost session (which leads to the login). */
	#failureMessage(error: unknown): string | null {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		return Object.values(failure.fields)[0]?.message ?? failure.message;
	}
}

const [getTicketOriginsStore, setTicketOriginsStore, hasTicketOriginsStore] =
	createContext<TicketOriginsStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findTicketOriginsStore(): TicketOriginsStore | null {
	return hasTicketOriginsStore() ? getTicketOriginsStore() : null;
}

export { getTicketOriginsStore, setTicketOriginsStore };
