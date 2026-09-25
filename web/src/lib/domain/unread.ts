// "Neu" per user (ADR-0015; E4 plan, T-6 and package 4). Pure: a ticket is new for a user if it
// was created at or after the user's base line, is not done and has no read row of that user. The
// base line is `users.unread_since`; empty counts as the user's `created`. Before the migration
// the field is missing and nothing counts as new.

import type { TicketSummary } from './ticket';

/**
 * Base line of the signed-in user from the auth record (PocketBase format, sortable as text);
 * null while the server does not know the field yet (before the migration), so nothing is new.
 */
export function unreadSinceOf(user: Readonly<Record<string, unknown>> | null): string | null {
	if (user === null || !('unread_since' in user)) return null;
	const value = user.unread_since;
	if (typeof value === 'string' && value !== '') return value;
	return typeof user.created === 'string' && user.created !== '' ? user.created : null;
}

/** True if the ticket is new for the user (ADR-0015 section 2). */
export function isNew(
	ticket: Pick<TicketSummary, 'id' | 'created' | 'status'>,
	readTickets: ReadonlySet<string>,
	unreadSince: string | null
): boolean {
	if (unreadSince === null || ticket.status === 'done') return false;
	if (ticket.created < unreadSince) return false;
	return !readTickets.has(ticket.id);
}

/** New tickets in total and per project (project tiles and the switch "Projekte"). */
export function countNew(
	tickets: Iterable<Pick<TicketSummary, 'id' | 'created' | 'status' | 'projectId'>>,
	readTickets: ReadonlySet<string>,
	unreadSince: string | null
): { total: number; byProject: Map<string, number> } {
	const byProject = new Map<string, number>();
	let total = 0;
	for (const ticket of tickets) {
		if (!isNew(ticket, readTickets, unreadSince)) continue;
		total += 1;
		if (ticket.projectId !== null) {
			byProject.set(ticket.projectId, (byProject.get(ticket.projectId) ?? 0) + 1);
		}
	}
	return { total, byProject };
}
