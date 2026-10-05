// The own pinned tickets (PIN-1, ADR-0064), one store for the whole app: the (app) layout loads the
// pins of the account once per session and follows them through realtime (another tab of the
// account, pins the server released when a ticket was completed or moved to the trash, a household
// left), and loads again after a reconnection or a subscription that failed first (ADR-0007 §3).
//
// `ticketIds` is the order of the section "Angeheftet" (oldest first) over every area; the views
// show the tickets their list store knows (the open tickets of the area of the tab), so the section,
// the pins of a project and a later daily plan read them the same way (`pinnedTickets` of
// domain/pins.ts). `toggle` pins or releases one ticket; a failure is an error flag. Before the
// migration of the pins the list fails and the store stays unavailable: no view offers pinning.
// Outside the layout (tests of single components) there is none.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { listPins, pinTicket, unpinTicket } from '$lib/data/pins';
import {
	onReconnect,
	subscribePins,
	type RecordChange,
	type Unsubscribe
} from '$lib/data/realtime';
import { pinFailedText, pinnedTicketIds, type TicketPin } from '$lib/domain/pins';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type HoldOptions } from './realtime';
import type { SessionGuard } from './ticket-list.svelte';

/** Data access of the pins; tests pass a fake, the app binds the data layer to its client. */
export interface PinData {
	list(options: RequestOptions): Promise<TicketPin[]>;
	/** The new pin, or null when it existed already. */
	pin(ticketId: string): Promise<TicketPin | null>;
	/** Releases a pin; one that is gone counts as success. */
	unpin(pinId: string): Promise<void>;
	subscribe(onChange: (change: RecordChange<TicketPin>) => void): Promise<Unsubscribe>;
	/** Called after a new connection that follows an interrupted one, or a change of the area. */
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function pinData(pb: PocketBase): PinData {
	return {
		list: (options) => listPins(pb, options),
		pin: (ticketId) => pinTicket(pb, ticketId),
		unpin: (pinId) => unpinTicket(pb, pinId),
		subscribe: (onChange) => subscribePins(pb, onChange),
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

/** What the store needs of a ticket to pin it and to name it in a flag. */
export interface PinTarget {
	id: string;
	key: string;
}

/** What the views need of the pins (the list store reads only the order). */
export interface PinnedSource {
	/** The pinned ticket IDs in the order of the section, oldest first. */
	readonly ticketIds: readonly string[];
}

export class PinStore implements PinnedSource {
	readonly #data: PinData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #hold: HoldOptions;
	/** The own pins by their ID. */
	readonly #pins = new SvelteMap<string, TicketPin>();
	/** Tickets with a running request of `toggle`. */
	readonly #pending = new SvelteSet<string>();
	#available = $state(false);
	#controller: AbortController | null = null;
	#ticketIds = $derived(pinnedTicketIds(this.#pins.values()));
	#pinned = $derived(new SvelteSet(this.#ticketIds));

	constructor(
		data: PinData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		holdOptions: HoldOptions = {}
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#hold = holdOptions;
	}

	/** The pins are loaded: the server knows them, so the views offer pinning. */
	get available(): boolean {
		return this.#available;
	}

	get ticketIds(): readonly string[] {
		return this.#ticketIds;
	}

	isPinned(ticketId: string): boolean {
		return this.#pinned.has(ticketId);
	}

	/** A request of `toggle` runs for this ticket. */
	isPending(ticketId: string): boolean {
		return this.#pending.has(ticketId);
	}

	/**
	 * Loads every own pin; a second call replaces a running one. A failure (before the migration, a
	 * passing error) leaves the pins as they were; a session that ended signs out.
	 */
	async load(): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		try {
			const pins = await this.#data.list({ signal: controller.signal });
			this.#pins.clear();
			for (const pin of pins) this.#pins.set(pin.id, pin);
			this.#available = true;
		} catch (error) {
			if (toDataError(error, controller.signal).kind === 'session') this.#session.logout();
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/**
	 * Pins the ticket, or releases it when it is pinned. No optimistic state: the toggle shows the
	 * answer of the server; a refusal (a done ticket) or a failure is an error flag with its reason.
	 * Resolves to true when the state changed as asked.
	 */
	async toggle(ticket: PinTarget): Promise<boolean> {
		if (!this.#available || this.#pending.has(ticket.id)) return false;
		if (!this.#session.ensureValid()) return false;
		const pinned = this.isPinned(ticket.id);
		this.#pending.add(ticket.id);
		try {
			if (pinned) {
				const own = [...this.#pins.values()].filter((pin) => pin.ticket === ticket.id);
				for (const pin of own) {
					await this.#data.unpin(pin.id);
					this.#pins.delete(pin.id);
				}
			} else {
				const pin = await this.#data.pin(ticket.id);
				if (pin === null) await this.load();
				else this.#pins.set(pin.id, pin);
			}
			return true;
		} catch (error) {
			this.#fail(error, ticket.key, pinned);
			return false;
		} finally {
			this.#pending.delete(ticket.id);
		}
	}

	/** Loads and follows the pins; the cleanup ends the subscriptions and empties the store. */
	start(): () => void {
		void this.load();
		const stopLive = hold((guard) => this.#data.subscribe(guard((change) => this.#apply(change))), {
			...this.#hold,
			recovered: () => void this.load()
		});
		const stopReconnect = hold(
			(guard) => this.#data.reconnected(guard(() => void this.load())),
			this.#hold
		);
		return () => {
			stopLive();
			stopReconnect();
			this.#controller?.abort();
			this.#controller = null;
			this.#pins.clear();
			this.#available = false;
		};
	}

	#apply(change: RecordChange<TicketPin>): void {
		if (change.action === 'delete') this.#pins.delete(change.id);
		else this.#pins.set(change.record.id, change.record);
	}

	#fail(error: unknown, key: string, pinned: boolean): void {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return;
		if (failure.kind === 'session') {
			this.#session.logout();
			return;
		}
		const reason = Object.values(failure.fields)[0]?.message ?? failure.message;
		this.#flags.show({ tone: 'error', title: pinFailedText(key, pinned), description: reason });
	}
}

const [getPinStore, setPinStore, hasPinStore] = createContext<PinStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findPinStore(): PinStore | null {
	return hasPinStore() ? getPinStore() : null;
}

export { setPinStore };
