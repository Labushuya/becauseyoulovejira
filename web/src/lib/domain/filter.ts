// Filter of the ticket list (E3 plan, T-6; ADR-0013 sections 1 and 3). Pure. The groups are
// combined with AND, each with at most one value (OF-E3-3). The search is not part of this
// predicate: the server answers it as a set of IDs (T-1, T-15). Project and tag compare the stored
// relations (projectId, tagIds), the same fields the server expression of the done tickets uses.
// The source compares the family of `source` (ADR-0019 section 2); no source counts as "manual".

import { addDays, type CalendarDate } from './berlin-date';
import { NO_PROJECT, type ListQuery } from './list-query';
import { SOON_DAYS } from './ordering';
import { sourceFamily } from './source';
import type { TicketSummary } from './ticket';

/**
 * Position of a due date relative to today (both Berlin calendar dates): overdue, today, soon
 * (tomorrow up to today + SOON_DAYS), later, or none without a due date.
 */
export type DueBucket = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export function dueBucket(due: CalendarDate | null, today: CalendarDate): DueBucket {
	if (due === null) return 'none';
	if (due < today) return 'overdue';
	if (due === today) return 'today';
	return due <= addDays(today, SOON_DAYS) ? 'soon' : 'later';
}

export type FilterableTicket = Pick<
	TicketSummary,
	'status' | 'priority' | 'due' | 'projectId' | 'tagIds' | 'source'
>;

function matchesDue(ticket: FilterableTicket, filter: ListQuery['due'], today: CalendarDate) {
	if (filter === null) return true;
	const bucket = dueBucket(ticket.due, today);
	// A done ticket is never overdue (E2 plan, T-14).
	if (filter === 'overdue') return bucket === 'overdue' && ticket.status !== 'done';
	return bucket === filter;
}

function matchesProject(ticket: FilterableTicket, filter: string | null): boolean {
	if (filter === null) return true;
	if (filter === NO_PROJECT) return ticket.projectId === null;
	return ticket.projectId === filter;
}

/**
 * True if the ticket passes the filters of `query` at the given Berlin date. The status filter
 * compares the status only; which section shows done tickets decides the list (T-6).
 */
export function matchesFilter(
	ticket: FilterableTicket,
	query: ListQuery,
	today: CalendarDate
): boolean {
	return (
		(query.status === null || ticket.status === query.status) &&
		(query.priority === null || ticket.priority === query.priority) &&
		matchesDue(ticket, query.due, today) &&
		(query.source === null || sourceFamily(ticket.source) === query.source) &&
		matchesProject(ticket, query.project) &&
		(query.tag === null || ticket.tagIds.includes(query.tag))
	);
}
