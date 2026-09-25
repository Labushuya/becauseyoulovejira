// Realtime for the stores (ADR-0007 sections 2 to 4; E3 plan, T-16): the subscriptions the
// stores need, as an interface they can be tested with (fake) and bound to the app client
// (`liveSource`). `hold` turns the asynchronous subscription into a synchronous stop for
// cleanups.

import type PocketBase from 'pocketbase';
import {
	onReconnect,
	subscribeComments,
	subscribeHistory,
	subscribeInboxItems,
	subscribeProjects,
	subscribeTags,
	subscribeTicket,
	subscribeTickets,
	type RecordChange,
	type Unsubscribe
} from '$lib/data/realtime';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { Comment, HistoryEntry, Ticket, TicketSummary } from '$lib/domain/ticket';

export type { RecordChange, Unsubscribe };

export interface LiveSource {
	/** All visible tickets (list fields). */
	tickets(onChange: (change: RecordChange<TicketSummary>) => void): Promise<Unsubscribe>;
	/** One ticket with its description (detail panel). */
	ticket(id: string, onChange: (change: RecordChange<Ticket>) => void): Promise<Unsubscribe>;
	comments(
		ticketId: string,
		onChange: (change: RecordChange<Comment>) => void
	): Promise<Unsubscribe>;
	history(
		ticketId: string,
		onChange: (change: RecordChange<HistoryEntry>) => void
	): Promise<Unsubscribe>;
	/** All visible projects, archived ones included (catalog, E3 plan T-16). */
	projects(onChange: (change: RecordChange<Project>) => void): Promise<Unsubscribe>;
	/** All visible tags (catalog). */
	tags(onChange: (change: RecordChange<Tag>) => void): Promise<Unsubscribe>;
	/** All visible inbox entries (E4 plan, T-4). */
	inbox(onChange: (change: RecordChange<InboxItemSummary>) => void): Promise<Unsubscribe>;
	/** Called after a new connection that follows an interrupted one. */
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function liveSource(pb: PocketBase): LiveSource {
	return {
		tickets: (onChange) => subscribeTickets(pb, onChange),
		ticket: (id, onChange) => subscribeTicket(pb, id, onChange),
		comments: (ticketId, onChange) => subscribeComments(pb, ticketId, onChange),
		history: (ticketId, onChange) => subscribeHistory(pb, ticketId, onChange),
		projects: (onChange) => subscribeProjects(pb, onChange),
		tags: (onChange) => subscribeTags(pb, onChange),
		inbox: (onChange) => subscribeInboxItems(pb, onChange),
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

/**
 * Holds a subscription that is still being set up. The returned stop works at once: if the
 * subscription is not ready yet, it ends as soon as it is. A failed subscription leaves nothing
 * to stop; the data stays usable without live updates (reloading the page subscribes again).
 * A failure while unsubscribing changes nothing for the caller and is ignored.
 */
export function hold(start: Promise<Unsubscribe>): () => void {
	let stopped = false;
	let unsubscribe: Unsubscribe | null = null;
	start.then(
		(stop) => {
			if (stopped) void stop().catch(() => undefined);
			else unsubscribe = stop;
		},
		() => undefined
	);
	return () => {
		if (stopped) return;
		stopped = true;
		void unsubscribe?.().catch(() => undefined);
		unsubscribe = null;
	};
}
