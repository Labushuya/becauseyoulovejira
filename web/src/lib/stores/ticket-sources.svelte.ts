// Sources of a ticket (ADR-0031 sections 1, 2 and 7): the inbox items with `ticket = <id>`, loaded
// for the ticket open in the panel or the full view and kept live through the realtime events of
// inbox_items (ADR-0007). The same store links items to a ticket, both from the inbox ("Mit Ticket
// verknüpfen …", one or several) and from the ticket ("Quelle hinzufügen …"), and releases them:
// each item on its own through the record API, whose hook writes the history in the same
// transaction. The same way moves a linked item to another ticket ("Anderem Ticket zuordnen …").
// Failures stay per item; one flag sums up. Changed items also go to the inbox store
// (`onchange`), so the inbox follows at once, before the realtime event.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import { assignToTicket, listTicketSources, originalFileUrl, releaseItem } from '$lib/data/inbox';
import type { RequestOptions } from '$lib/data/options';
import { searchTickets, type TicketChoice } from '$lib/data/tickets';
import type { InboxItemSummary } from '$lib/domain/inbox';
import { linkSummary, orderSources, type LinkOutcome } from '$lib/domain/sources';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type LiveSource } from './realtime';
import type { LoadState, SessionGuard } from './ticket-list.svelte';

export type { TicketChoice };

export interface TicketSourcesData {
	list(ticketId: string, options: RequestOptions): Promise<InboxItemSummary[]>;
	link(id: string, ticketId: string): Promise<InboxItemSummary>;
	release(id: string): Promise<InboxItemSummary>;
	search(text: string, options: RequestOptions): Promise<TicketChoice[]>;
	originalUrl(item: Pick<InboxItemSummary, 'id' | 'original'>): Promise<string | null>;
}

export function ticketSourcesData(pb: PocketBase): TicketSourcesData {
	return {
		list: (ticketId, options) => listTicketSources(pb, ticketId, options),
		link: (id, ticketId) => assignToTicket(pb, id, ticketId),
		release: (id) => releaseItem(pb, id),
		search: (text, options) => searchTickets(pb, text, options),
		originalUrl: (item) => originalFileUrl(pb, item)
	};
}

/** Outcome of releasing a source or asking for its file. */
export type SourceActionResult<T> = { ok: true; value: T } | { ok: false; message: string | null };

export class TicketSourcesStore {
	readonly #data: TicketSourcesData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #onchange: (item: InboxItemSummary) => void;

	readonly #items = new SvelteMap<string, InboxItemSummary>();
	readonly #pending = new SvelteSet<string>();
	#controller: AbortController | null = null;

	#ticketId = $state<string | null>(null);
	#mainSource = $state<string | null>(null);
	#state = $state<LoadState>('idle');
	#error = $state<string | null>(null);

	#sorted = $derived(orderSources([...this.#items.values()], this.#mainSource));

	constructor(
		data: TicketSourcesData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		onchange: (item: InboxItemSummary) => void = () => undefined
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#onchange = onchange;
	}

	/** Ticket whose sources are shown, null before the first one. */
	get ticketId(): string | null {
		return this.#ticketId;
	}

	/** Sources of the open ticket: the main source first. */
	get items(): readonly InboxItemSummary[] {
		return this.#sorted;
	}

	get state(): LoadState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/** True for the main source of the open ticket (tickets.source_item); it is never released. */
	isMain(id: string): boolean {
		return id === this.#mainSource;
	}

	isPending(id: string): boolean {
		return this.#pending.has(id);
	}

	/** Shows the sources of a ticket; its main source is `mainSource` (tickets.source_item). */
	open(ticketId: string, mainSource: string | null): void {
		this.#mainSource = mainSource;
		if (ticketId === this.#ticketId && this.#state !== 'error') return;
		this.#ticketId = ticketId;
		this.#items.clear();
		void this.#load(ticketId, false);
	}

	/** Loads the sources again ("Erneut versuchen"). */
	async reload(): Promise<void> {
		if (this.#ticketId !== null) await this.#load(this.#ticketId, false);
	}

	/** Forgets the ticket (panel closed, session ended). */
	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#ticketId = null;
		this.#mainSource = null;
		this.#items.clear();
		this.#state = 'idle';
		this.#error = null;
	}

	/**
	 * Follows the inbox live (ADR-0007): an item that points to the open ticket joins its sources,
	 * one that no longer does leaves them. After a reconnection the sources are loaded again
	 * without a loading state. Returns the cleanup.
	 */
	connect(live: LiveSource): () => void {
		const stops = [
			hold(
				live.inbox((change) => {
					if (change.action === 'delete') this.#items.delete(change.id);
					else this.upsert(change.record);
				})
			),
			hold(
				live.reconnected(() => {
					if (this.#ticketId !== null) void this.#load(this.#ticketId, true);
				})
			)
		];
		return () => {
			for (const stop of stops) stop();
		};
	}

	/** An item of the inbox changed (own answer or event): in or out of the open ticket. */
	upsert(item: InboxItemSummary): void {
		if (this.#ticketId !== null && item.ticketId === this.#ticketId) {
			const known = this.#items.get(item.id);
			if (known === undefined || known.updated <= item.updated) this.#items.set(item.id, item);
		} else {
			this.#items.delete(item.id);
		}
	}

	/** Tickets for the ticket search by number, key or title. */
	search(text: string, options: RequestOptions = {}): Promise<TicketChoice[]> {
		return this.#data.search(text, options);
	}

	/**
	 * Links the items one after the other to `ticket` (ADR-0031 section 2); each is atomic on its
	 * own. Failures stay with their reason, one flag names how many were linked.
	 */
	async link(
		items: readonly Pick<InboxItemSummary, 'id' | 'title'>[],
		ticket: Pick<TicketChoice, 'id' | 'key'>
	): Promise<LinkOutcome> {
		const outcome: LinkOutcome = { linked: [], failures: [] };
		for (const item of items) {
			if (!this.#session.ensureValid()) break;
			if (this.#pending.has(item.id)) continue;
			this.#pending.add(item.id);
			try {
				const linked = await this.#data.link(item.id, ticket.id);
				this.upsert(linked);
				this.#onchange(linked);
				outcome.linked.push(linked);
			} catch (error) {
				const message = this.#failureMessage(error);
				if (message === null) break;
				outcome.failures.push({ id: item.id, title: item.title, message });
			} finally {
				this.#pending.delete(item.id);
			}
		}
		if (outcome.linked.length > 0) {
			this.#flags.show({
				tone: outcome.failures.length > 0 ? 'info' : 'success',
				title: linkSummary(outcome.linked.length, ticket.key)
			});
		}
		return outcome;
	}

	/**
	 * "Anderem Ticket zuordnen …" (ADR-0031, addendum): a linked item changes directly to `ticket`;
	 * the hook writes the history of both tickets in one transaction. Never the main source. The
	 * failure message stays with the dialog; success shows a flag.
	 */
	async move(
		item: Pick<InboxItemSummary, 'id' | 'title'>,
		ticket: Pick<TicketChoice, 'id' | 'key'>
	): Promise<SourceActionResult<InboxItemSummary>> {
		if (this.#pending.has(item.id) || !this.#session.ensureValid()) {
			return { ok: false, message: null };
		}
		this.#pending.add(item.id);
		try {
			const moved = await this.#data.link(item.id, ticket.id);
			this.upsert(moved);
			this.#onchange(moved);
			this.#flags.show({
				tone: 'success',
				title: `„${item.title}“ gehört jetzt zu ${ticket.key}.`
			});
			return { ok: true, value: moved };
		} catch (error) {
			return { ok: false, message: this.#failureMessage(error) };
		} finally {
			this.#pending.delete(item.id);
		}
	}

	/** "Lösen": the item goes back to the inbox as new; never the main source. */
	async release(item: InboxItemSummary): Promise<SourceActionResult<InboxItemSummary>> {
		if (this.#pending.has(item.id) || !this.#session.ensureValid()) {
			return { ok: false, message: null };
		}
		this.#pending.add(item.id);
		try {
			const released = await this.#data.release(item.id);
			this.upsert(released);
			this.#onchange(released);
			this.#flags.show({ tone: 'success', title: `„${item.title}“ ist wieder im Eingang.` });
			return { ok: true, value: released };
		} catch (error) {
			const message = this.#failureMessage(error);
			if (message !== null) {
				this.#flags.show({
					tone: 'error',
					title: `„${item.title}“ ließ sich nicht lösen: ${message}`
				});
			}
			return { ok: false, message };
		} finally {
			this.#pending.delete(item.id);
		}
	}

	/** Download address of the original file with a fresh file token. */
	async originalUrl(item: InboxItemSummary): Promise<SourceActionResult<string>> {
		if (!this.#session.ensureValid()) return { ok: false, message: null };
		try {
			const url = await this.#data.originalUrl(item);
			return url === null
				? { ok: false, message: 'Dieser Eintrag hat keine Originaldatei.' }
				: { ok: true, value: url };
		} catch (error) {
			return { ok: false, message: this.#failureMessage(error) };
		}
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
			const items = await this.#data.list(ticketId, { signal: controller.signal });
			if (controller.signal.aborted || this.#ticketId !== ticketId) return;
			this.#items.clear();
			for (const item of items) this.#items.set(item.id, item);
			this.#state = 'ready';
			this.#error = null;
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null) return;
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

const [getTicketSourcesStore, setTicketSourcesStore] = createContext<TicketSourcesStore>();

/** Sources of the open ticket and the linking of inbox items, set by the app layout. */
export { getTicketSourcesStore, setTicketSourcesStore };
