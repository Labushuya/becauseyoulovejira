// "Duplizieren …", "Folge-Ticket anlegen …" (ADR-0067) and "In den Papierkorb …" from the menu "•••"
// of a row of the ticket table (plan aktionsmenues, AM-2), for the (app) layout. A row only knows the
// summary of its ticket; the question of "Duplizieren …" needs the description, the sources (since
// QT-1 also the source tickets) and the number of comments (ADR-0045 §2), the one of "Folge-Ticket
// anlegen …" the whole ticket (tags, charm, description), the question of "In den Papierkorb …" the
// number of sources (ADR-0031, addendum B). A choice loads that first, then the table shows the dialog; meanwhile the row waits, and a
// second choice waits for the first. A failure to load is an error flag. Moving to the trash runs
// like in the panel (moveTicketToTrash): the row leaves the list, a flag offers "Rückgängig".

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { listComments } from '$lib/data/comments';
import { toDataError } from '$lib/data/errors';
import { listTicketSources } from '$lib/data/inbox';
import { getTicketOrigins } from '$lib/data/ticket-origins';
import { deleteTicket, getTicket, type TrashMove } from '$lib/data/tickets';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { TicketOrigin } from '$lib/domain/ticket-origins';
import type { SourceHandling } from '$lib/domain/sources';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { DUPLICATE_GONE } from './ticket-duplicate.svelte';
import type { SessionGuard } from './ticket-list.svelte';
import {
	moveTicketToTrash,
	type DeleteResult,
	type DeleteSources,
	type TrashMoveDeps,
	type TrashUndo
} from './trash-move';

export interface TicketRowActionsData {
	get(id: string): Promise<Ticket>;
	/** Sources of the ticket (inbox entries with `ticket = <id>`). */
	sources(ticketId: string): Promise<InboxItemSummary[]>;
	/** Source tickets of the ticket (ADR-0067); none before the migration. */
	ticketSources?(ticketId: string): Promise<TicketOrigin[]>;
	commentCount(ticketId: string): Promise<number>;
	/** The route "Ticket löschen" (ADR-0037); the move for "Rückgängig", null before it. */
	delete(id: string, sources: SourceHandling): Promise<TrashMove | null>;
}

export function ticketRowActionsData(pb: PocketBase): TicketRowActionsData {
	return {
		get: (id) => getTicket(pb, id),
		sources: (ticketId) => listTicketSources(pb, ticketId),
		ticketSources: async (ticketId) => {
			try {
				return (await getTicketOrigins(pb, ticketId)).sources;
			} catch (error) {
				// Before the migration (503) a ticket has no source tickets.
				if (toDataError(error).status === 503) return [];
				throw error;
			}
		},
		commentCount: async (ticketId) => (await listComments(pb, ticketId)).length,
		delete: (id, sources) => deleteTicket(pb, id, { sources })
	};
}

/** The dialog a row asked for, with what it needs. */
export type RowDialog =
	| {
			kind: 'duplicate';
			ticket: Ticket;
			sources: readonly InboxItemSummary[];
			/** Source tickets (ADR-0067), for "Kopie der Herkunft übernehmen". */
			ticketSources?: readonly TicketOrigin[];
			commentCount: number;
	  }
	| { kind: 'followup'; ticket: Ticket }
	| { kind: 'delete'; ticket: TicketSummary; sourceCount: number };

export class TicketRowActionsStore {
	readonly #data: TicketRowActionsData;
	readonly #session: SessionGuard;
	readonly #list: TrashMoveDeps['list'];
	readonly #trash: TrashUndo | null;
	/** "Link kopiert" of the menu and the failures of this store. */
	readonly flags: FlagSink;

	#dialog = $state.raw<RowDialog | null>(null);
	/** Ticket whose dialog is being prepared. */
	#preparing = $state<string | null>(null);

	constructor(
		data: TicketRowActionsData,
		session: SessionGuard,
		list: TrashMoveDeps['list'],
		trash: TrashUndo | null = null,
		flags: FlagSink = SILENT_FLAGS
	) {
		this.#data = data;
		this.#session = session;
		this.#list = list;
		this.#trash = trash;
		this.flags = flags;
	}

	/** The dialog to show, null without one. */
	get dialog(): RowDialog | null {
		return this.#dialog;
	}

	/** The row of this ticket waits for its dialog (aria-busy). */
	isPreparing(ticketId: string): boolean {
		return this.#preparing === ticketId;
	}

	/**
	 * Loads what the dialog of `kind` needs for `ticket` and shows it. False when nothing is shown:
	 * no session, another row still preparing, or loading failed (an error flag says why).
	 */
	async choose(kind: RowDialog['kind'], ticket: TicketSummary): Promise<boolean> {
		if (this.#preparing !== null || this.#dialog !== null) return false;
		if (!this.#session.ensureValid()) return false;
		this.#preparing = ticket.id;
		try {
			if (kind === 'delete') {
				const sources = await this.#data.sources(ticket.id);
				this.#dialog = { kind, ticket, sourceCount: sources.length };
			} else if (kind === 'followup') {
				this.#dialog = { kind, ticket: await this.#data.get(ticket.id) };
			} else {
				const [full, sources, ticketSources, commentCount] = await Promise.all([
					this.#data.get(ticket.id),
					this.#data.sources(ticket.id),
					this.#data.ticketSources?.(ticket.id) ?? Promise.resolve([]),
					this.#data.commentCount(ticket.id)
				]);
				this.#dialog = { kind, ticket: full, sources, ticketSources, commentCount };
			}
			return true;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted') {
				this.flags.show({
					tone: 'error',
					title: `${ticket.key} konnte nicht geladen werden.`,
					description: failure.kind === 'not_found' ? DUPLICATE_GONE : failure.message
				});
			}
			return false;
		} finally {
			this.#preparing = null;
		}
	}

	/** Cancel, or the dialog is done. */
	close(): void {
		this.#dialog = null;
	}

	/** Moves the ticket of the open question to the trash, the sources as chosen. */
	async deleteTicket(sources?: DeleteSources): Promise<DeleteResult> {
		const dialog = this.#dialog;
		if (dialog?.kind !== 'delete') return { ok: false, message: null };
		return moveTicketToTrash(
			{
				delete: (id, handling) => this.#data.delete(id, handling),
				session: this.#session,
				list: this.#list,
				trash: this.#trash
			},
			dialog.ticket,
			sources
		);
	}
}

const [getTicketRowActions, setTicketRowActions, hasTicketRowActions] =
	createContext<TicketRowActionsStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findTicketRowActions(): TicketRowActionsStore | null {
	return hasTicketRowActions() ? getTicketRowActions() : null;
}

export { setTicketRowActions };
