// Moving one ticket to the trash (ADR-0037; ADR-0031, addendum B), shared by the panel and the
// full view (TicketDetailStore) and the rows of the table (TicketRowActionsStore, plan
// aktionsmenues AM-2): one request through the route, the sources as chosen. On success the
// ticket leaves the list and a flag says so, with "Rückgängig" when the server answered the move
// (before the migration of the trash the server deletes for good and the list only announces it).
// A ticket that is already gone (404) counts as moved. Any other failure keeps the ticket.

import { toDataError } from '$lib/data/errors';
import type { TrashMove } from '$lib/data/tickets';
import { deletedWithSourcesText, type SourceHandling } from '$lib/domain/sources';
import type { SessionGuard } from './ticket-list.svelte';

/** What the move needs of the trash: the flag with "Rückgängig" after a move (ADR-0037 §7). */
export interface TrashUndo {
	offerUndo(move: TrashMove, title: string): void;
}

/** Sources of the ticket to delete and what happens to them (ADR-0031, addendum B). */
export interface DeleteSources {
	count: number;
	handling: SourceHandling;
}

/** Outcome of deleting the ticket; a failure carries a message unless nothing is to be shown. */
export type DeleteResult = { ok: true; key: string } | { ok: false; message: string | null };

export interface TrashMoveDeps {
	/** The route "Ticket löschen"; the move for "Rückgängig", null before the migration. */
	delete(id: string, sources: SourceHandling): Promise<TrashMove | null>;
	session: SessionGuard;
	list: { remove(id: string): void; announce(message: string): void };
	trash: TrashUndo | null;
}

export async function moveTicketToTrash(
	deps: TrashMoveDeps,
	ticket: { id: string; key: string },
	sources?: DeleteSources
): Promise<DeleteResult> {
	if (!deps.session.ensureValid()) return { ok: false, message: null };
	let move: TrashMove | null = null;
	try {
		move = await deps.delete(ticket.id, sources?.handling ?? 'inbox');
	} catch (error) {
		const failure = toDataError(error);
		if (failure.kind === 'session') deps.session.logout();
		if (failure.kind === 'session' || failure.kind === 'aborted') {
			return { ok: false, message: null };
		}
		if (failure.kind !== 'not_found') return { ok: false, message: failure.message };
	}
	deps.list.remove(ticket.id);
	const text = deletedWithSourcesText(
		ticket.key,
		sources?.count ?? 0,
		sources?.handling ?? 'inbox',
		move !== null
	);
	if (move !== null && deps.trash !== null) deps.trash.offerUndo(move, text);
	else deps.list.announce(text);
	return { ok: true, key: ticket.key };
}
