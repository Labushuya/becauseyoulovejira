// Filter of the ticket list (E3 plan, T-6; ADR-0013 sections 1 and 3). Pure. The groups are
// combined with AND, each with at most one value (OF-E3-3). The chosen filter cards (FI-1,
// domain/filter-cards.ts) give their union (OR), which these groups narrow; the status filter
// "Erledigt" locks them (`appliedCards`, PL-1). The search is not part
// of this predicate: the server answers it as a set of IDs (T-1, T-15). Project and tag compare the
// stored relations (projectId, tagIds), the same fields the server expression of the done tickets
// uses.
// The source compares the family of `source` (ADR-0019 section 2); no source counts as "manual".
// A project takes its sub projects in (ADR-0034 section 6) unless the query switches them off.
// "Wiederkehrend" (plan OR-2) compares `recurring`, i.e. `recurrence != ""` on the server.

import { addDays, type CalendarDate } from './berlin-date';
import { appliedCards, matchesCards } from './filter-cards';
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
	'status' | 'priority' | 'due' | 'projectId' | 'tagIds' | 'source' | 'recurring'
>;

function matchesRecurring(ticket: FilterableTicket, filter: ListQuery['recurring']): boolean {
	if (filter === null) return true;
	return filter === 'recurring' ? ticket.recurring : !ticket.recurring;
}

function matchesDue(ticket: FilterableTicket, filter: ListQuery['due'], today: CalendarDate) {
	if (filter === null) return true;
	const bucket = dueBucket(ticket.due, today);
	// A done ticket is never overdue (E2 plan, T-14).
	if (filter === 'overdue') return bucket === 'overdue' && ticket.status !== 'done';
	return bucket === filter;
}

/** Sub project IDs of a project (ADR-0034); the catalog answers it in the app. */
export type SubProjectsOf = (projectId: string) => readonly string[];

/** Without a catalog no project has sub projects. */
export const NO_SUB_PROJECTS: SubProjectsOf = () => [];

function matchesProject(
	ticket: FilterableTicket,
	query: Pick<ListQuery, 'project' | 'subProjects'>,
	subProjectsOf: SubProjectsOf
): boolean {
	const filter = query.project;
	if (filter === null) return true;
	if (filter === NO_PROJECT) return ticket.projectId === null;
	if (ticket.projectId === filter) return true;
	// A project filter takes its sub projects in unless `unterprojekte=0` (ADR-0034 section 6),
	// like the server expression `project = p || project.parent = p`.
	return (
		query.subProjects &&
		ticket.projectId !== null &&
		subProjectsOf(filter).includes(ticket.projectId)
	);
}

/**
 * True if the ticket passes the cards and the filters of `query` at the given Berlin date: it
 * belongs to one of the applied cards (any ticket without one; none apply with the status filter
 * "Erledigt", PL-1) and to every filter group. The status filter compares the status only; which section shows done tickets decides the list (T-6). A
 * project filter takes the sub projects `subProjectsOf` names in, unless the query switches them off.
 */
export function matchesFilter(
	ticket: FilterableTicket,
	query: ListQuery,
	today: CalendarDate,
	subProjectsOf: SubProjectsOf = NO_SUB_PROJECTS
): boolean {
	return (
		matchesCards(ticket, appliedCards(query), today) &&
		(query.status === null || ticket.status === query.status) &&
		(query.priority === null || ticket.priority === query.priority) &&
		matchesDue(ticket, query.due, today) &&
		(query.source === null || sourceFamily(ticket.source) === query.source) &&
		matchesRecurring(ticket, query.recurring) &&
		matchesProject(ticket, query, subProjectsOf) &&
		(query.tag === null || ticket.tagIds.includes(query.tag))
	);
}
