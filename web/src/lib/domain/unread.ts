// "Neu" per user (ADR-0015; E4 plan, T-6 and package 4). Pure: a ticket is new for a user if it
// was created at or after the user's base line, is not done and has no read row of that user. The
// base line is `users.unread_since`; empty counts as the user's `created`. Before the migration
// the field is missing and nothing counts as new.
//
// Since E7-5 (ADR-0068 §4) a ticket another member gave to the user counts as new again as well: the
// hook deletes his read row and notes the moment in `assigned_at`, so the assignment, not the creation,
// has to be at or after the base line.

import type { TicketSummary } from './ticket';

/** What "neu" looks at of a ticket; the assignee and the time of the assignment are optional. */
export type UnreadTicket = Pick<TicketSummary, 'id' | 'created' | 'status'> &
	Partial<Pick<TicketSummary, 'assignee' | 'assignedAt'>>;

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

/**
 * True if the ticket is new for the user (ADR-0015 section 2): created at or after the base line, or
 * since E7-5 given to `selfId` by someone else at or after it (ADR-0068 §4); never done, never read.
 */
export function isNew(
	ticket: UnreadTicket,
	readTickets: ReadonlySet<string>,
	unreadSince: string | null,
	selfId: string | null = null
): boolean {
	if (unreadSince === null || ticket.status === 'done') return false;
	const assigned =
		selfId !== null &&
		ticket.assignee === selfId &&
		typeof ticket.assignedAt === 'string' &&
		ticket.assignedAt >= unreadSince;
	if (ticket.created < unreadSince && !assigned) return false;
	return !readTickets.has(ticket.id);
}

/** New tickets in total and per project (project tiles and the switch "Projekte"). */
export function countNew(
	tickets: Iterable<UnreadTicket & Pick<TicketSummary, 'projectId'>>,
	readTickets: ReadonlySet<string>,
	unreadSince: string | null,
	selfId: string | null = null
): { total: number; byProject: Map<string, number> } {
	const byProject = new Map<string, number>();
	let total = 0;
	for (const ticket of tickets) {
		if (!isNew(ticket, readTickets, unreadSince, selfId)) continue;
		total += 1;
		if (ticket.projectId !== null) {
			byProject.set(ticket.projectId, (byProject.get(ticket.projectId) ?? 0) + 1);
		}
	}
	return { total, byProject };
}
