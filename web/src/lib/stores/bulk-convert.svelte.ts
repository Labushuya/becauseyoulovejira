// "Gesammelt umwandeln" (E4 plan, T-2 and package 3; ADR-0014 section 4): the chosen inbox entries
// become tickets one after the other with the same default values; each entry gets its own result,
// a failure stops nothing, and converted entries stay converted. No batch API: it would have to be
// switched on by a migration and aborts everything on the first failure (ADR-0014).

import type PocketBase from 'pocketbase';
import { toDataError } from '$lib/data/errors';
import { getItem } from '$lib/data/inbox';
import type { RequestOptions } from '$lib/data/options';
import { createTicket } from '$lib/data/tickets';
import { ticketPrefill, type InboxItem, type InboxItemSummary } from '$lib/domain/inbox';
import type { Priority, Status } from '$lib/domain/status';
import type { Ticket, TicketDraft, TicketOrigin, TicketSummary } from '$lib/domain/ticket';
import type { SessionGuard } from './ticket-list.svelte';

export interface BulkConvertData {
	get(id: string, options: RequestOptions): Promise<InboxItem>;
	createTicket(draft: TicketDraft, origin: TicketOrigin): Promise<Ticket>;
}

export function bulkConvertData(pb: PocketBase): BulkConvertData {
	return {
		get: (id, options) => getItem(pb, id, options),
		createTicket: (draft, origin) => createTicket(pb, draft, { origin })
	};
}

/** Values the dialog asks for once; title and description come from each entry (T-5). */
export interface BulkDefaults {
	status: Status;
	priority: Priority;
	project: string | null;
	tags: string[];
}

export type BulkResult =
	| { id: string; title: string; ok: true; key: string; ticketId: string }
	| { id: string; title: string; ok: false; message: string };

/** Where results go at once: the ticket list and the inbox (before their realtime events). */
export interface BulkSinks {
	upsertTicket(ticket: TicketSummary): void;
	markConverted(itemId: string, ticketId: string, at: string): void;
}

export class BulkConverter {
	readonly #data: BulkConvertData;
	readonly #session: SessionGuard;
	readonly #sinks: BulkSinks;

	#running = $state(false);
	#stopRequested = false;
	#total = $state(0);
	#results = $state<BulkResult[]>([]);

	constructor(data: BulkConvertData, session: SessionGuard, sinks: BulkSinks) {
		this.#data = data;
		this.#session = session;
		this.#sinks = sinks;
	}

	get running(): boolean {
		return this.#running;
	}

	/** Entries of the running or last run. */
	get total(): number {
		return this.#total;
	}

	/** Entries handled so far, in the order of the run. */
	get results(): readonly BulkResult[] {
		return this.#results;
	}

	get converted(): number {
		return this.#results.filter((result) => result.ok).length;
	}

	get failed(): readonly BulkResult[] {
		return this.#results.filter((result) => !result.ok);
	}

	/**
	 * Converts the entries one after the other. The text of each entry is loaded for the
	 * description; a failure is kept with its reason and the run goes on. An ended session stops
	 * the run (the login follows), `stop()` after the current entry.
	 */
	async run(items: readonly Pick<InboxItemSummary, 'id' | 'title'>[], defaults: BulkDefaults) {
		if (this.#running) return;
		this.#running = true;
		this.#stopRequested = false;
		this.#total = items.length;
		this.#results = [];
		try {
			for (const entry of items) {
				if (this.#stopRequested || !this.#session.ensureValid()) break;
				const result = await this.#convert(entry, defaults);
				if (result === null) break;
				this.#results = [...this.#results, result];
			}
		} finally {
			this.#running = false;
		}
	}

	/** Ends the run after the entry being converted. */
	stop(): void {
		this.#stopRequested = true;
	}

	async #convert(
		entry: Pick<InboxItemSummary, 'id' | 'title'>,
		defaults: BulkDefaults
	): Promise<BulkResult | null> {
		try {
			const item = await this.#data.get(entry.id, {});
			const prefill = ticketPrefill(item);
			const ticket = await this.#data.createTicket(
				{
					title: prefill.title,
					description: prefill.description,
					status: defaults.status,
					priority: defaults.priority,
					due: null,
					project: defaults.project,
					tags: [...defaults.tags]
				},
				{ sourceItem: entry.id }
			);
			this.#sinks.upsertTicket(ticket);
			this.#sinks.markConverted(entry.id, ticket.id, ticket.created);
			return { id: entry.id, title: entry.title, ok: true, key: ticket.key, ticketId: ticket.id };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			const field = Object.values(failure.fields)[0]?.message;
			return { id: entry.id, title: entry.title, ok: false, message: field ?? failure.message };
		}
	}
}
