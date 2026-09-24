// Default order of the ticket list (E2 plan P-2 in the reading T-2, ADR-0006 section 2). Pure;
// the list store sorts client side because PocketBase cannot express this order.
//
// Group 1 "urgent by date": due <= today + SOON_DAYS (overdue included), by due date, then
// priority, then newest first. Group 2 "the rest": by priority; within the same priority tickets
// with a due date (ascending) before those without; then newest first. Last tie: id.

import { addDays, type CalendarDate } from './berlin-date';
import type { Priority } from './status';
import type { TicketSummary } from './ticket';

/** "Soon due" horizon in days after today (OF-E2-1, confirmed by the user as P-5 of E3). */
export const SOON_DAYS = 7;

/** Sortable columns of the table (E3 plan, T-5); tags and actions are not sortable. */
export const SORT_KEYS = [
	'key',
	'priority',
	'status',
	'title',
	'project',
	'due',
	'created'
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/**
 * Column sort: `reversed` false is the natural direction of the column (first click), true the
 * opposite one (second click). No sort spec means the default order.
 */
export interface SortSpec {
	key: SortKey;
	reversed: boolean;
}

/** Lower rank sorts first. */
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = Object.freeze({
	urgent: 0,
	high: 1,
	medium: 2,
	low: 3
});

export type DueState = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later' | 'none';

/** Position of a due date relative to today (both Berlin calendar dates). */
export function dueState(due: CalendarDate | null, today: CalendarDate): DueState {
	if (due === null) return 'none';
	if (due < today) return 'overdue';
	if (due === today) return 'today';
	if (due === addDays(today, 1)) return 'tomorrow';
	if (due <= addDays(today, SOON_DAYS)) return 'soon';
	return 'later';
}

export type OrderedTicket = Pick<TicketSummary, 'id' | 'due' | 'priority' | 'created'>;

function compareText(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

function compareDue(a: CalendarDate | null, b: CalendarDate | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return compareText(a, b);
}

function compareInGroup(a: OrderedTicket, b: OrderedTicket, byDateFirst: boolean): number {
	const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
	const byDue = compareDue(a.due, b.due);
	const primary = byDateFirst ? byDue || byPriority : byPriority || byDue;
	// Newest first: created descending.
	return primary || compareText(b.created, a.created) || compareText(a.id, b.id);
}

/**
 * Comparator for the default order at the given Berlin date. Build it once per sort; the
 * horizon of group 1 is computed here instead of per comparison.
 */
export function ticketOrder(today: CalendarDate): (a: OrderedTicket, b: OrderedTicket) => number {
	const horizon = addDays(today, SOON_DAYS);
	const isUrgent = (ticket: OrderedTicket) => ticket.due !== null && ticket.due <= horizon;
	return (a, b) => {
		const urgentA = isUrgent(a);
		const urgentB = isUrgent(b);
		if (urgentA !== urgentB) return urgentA ? -1 : 1;
		return compareInGroup(a, b, urgentA);
	};
}

/** Default order of two tickets at the given Berlin date (negative: `a` first). */
export function compareTickets(a: OrderedTicket, b: OrderedTicket, today: CalendarDate): number {
	return ticketOrder(today)(a, b);
}
