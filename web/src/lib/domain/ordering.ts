// Default order of the ticket list (E2 plan P-2 in the reading T-2, ADR-0006 section 2) and the
// column sort of the table (E3 plan, T-5; ADR-0013 section 1). Pure; the list store sorts client
// side because PocketBase cannot express these orders.
//
// Group 1 "urgent by date": due <= today + SOON_DAYS (overdue included), by due date, then
// priority, then newest first. Group 2 "the rest": by priority; within the same priority tickets
// with a due date (ascending) before those without; then newest first. Last tie: id.

import { addDays, type CalendarDate } from './berlin-date';
import type { Priority, Status } from './status';
import type { ProjectRef, TicketSummary } from './ticket';

/** "Soon due" horizon in days after today (OF-E2-1, confirmed by the user as P-5 of E3). */
export const SOON_DAYS = 7;

/**
 * Sortable columns of the table (E3 plan, T-5); tags and actions are not sortable. "Zuständig" since
 * E7-5 (ADR-0068 §3), by the name of the assignee, tickets without one last.
 */
export const SORT_KEYS = [
	'key',
	'priority',
	'status',
	'title',
	'project',
	'due',
	'created',
	'assignee'
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

/** Status in the order of work (T-5); a just checked row (done) comes last. */
export const STATUS_RANK: Readonly<Record<Status, number>> = Object.freeze({
	backlog: 0,
	open: 1,
	in_progress: 2,
	waiting: 3,
	done: 4
});

/** Direction of the first click per column (T-5), as `aria-sort` names it. */
export const NATURAL_DIRECTION: Readonly<Record<SortKey, 'ascending' | 'descending'>> =
	Object.freeze({
		key: 'ascending',
		// Urgent first: from the highest priority down.
		priority: 'descending',
		status: 'ascending',
		title: 'ascending',
		project: 'ascending',
		due: 'ascending',
		// Newest first.
		created: 'descending',
		// By name, A to Z.
		assignee: 'ascending'
	});

/** Actual direction of a column sort, for `aria-sort` on the sorted column header. */
export function sortDirection(spec: SortSpec): 'ascending' | 'descending' {
	const natural = NATURAL_DIRECTION[spec.key];
	if (!spec.reversed) return natural;
	return natural === 'ascending' ? 'descending' : 'ascending';
}

/**
 * Click cycle of a column header (T-5): default → natural direction → reversed → default. A
 * click on another column starts there with its natural direction.
 */
export function nextSort(spec: SortSpec | null, key: SortKey): SortSpec | null {
	if (spec === null || spec.key !== key) return { key, reversed: false };
	return spec.reversed ? null : { key, reversed: true };
}

/**
 * German order for text (T-5): case and accents do not count ("Äpfel" next to "Apfel"), digits
 * count as numbers ("Ticket 2" before "Ticket 10").
 */
const textCollator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

export function compareTitles(a: string, b: string): number {
	return textCollator.compare(a, b);
}

export type SortableTicket = Pick<
	TicketSummary,
	'id' | 'key' | 'title' | 'status' | 'priority' | 'due' | 'project' | 'created'
> &
	Partial<Pick<TicketSummary, 'assignee'>>;

/** Project shown for a ticket; the catalog resolves it, the expanded relation is the fallback. */
export type ResolveProject<T> = (ticket: T) => ProjectRef | null;

/** Name of an account for the sort "Zuständig" (ADR-0068); without one its ID. */
export type AssigneeNameOf = (id: string) => string;

type PathProject = Pick<ProjectRef, 'id' | 'name' | 'code' | 'parent'>;

function compareIds(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

/**
 * Order of projects along the tree (ADR-0034; column sort "Projekt", groups "Nach Projekt"): by
 * the name of the top-level project first, so sub projects stand with their parent, then the
 * parent before its sub projects, then by the own name. Codes and IDs break ties, so equal names
 * keep a fixed order. Without sub projects this is the order by name, code and ID.
 */
export function compareProjectPaths(a: PathProject, b: PathProject): number {
	const topA = a.parent ?? a;
	const topB = b.parent ?? b;
	const top =
		compareTitles(topA.name, topB.name) ||
		compareTitles(topA.code, topB.code) ||
		compareIds(topA.id, topB.id);
	if (top !== 0) return top;
	const depth = (a.parent ? 1 : 0) - (b.parent ? 1 : 0);
	if (depth !== 0) return depth;
	return compareTitles(a.name, b.name) || compareTitles(a.code, b.code) || compareIds(a.id, b.id);
}

/**
 * Names along the path only (column sort "Projekt", ADR-0034): the top-level name, the parent
 * before its sub projects, then the own name. Equal names tie, so the default order decides, as
 * before sub projects.
 */
function comparePathNames(
	a: Pick<ProjectRef, 'name' | 'parent'>,
	b: Pick<ProjectRef, 'name' | 'parent'>
): number {
	const top = compareTitles((a.parent ?? a).name, (b.parent ?? b).name);
	if (top !== 0) return top;
	const depth = (a.parent ? 1 : 0) - (b.parent ? 1 : 0);
	if (depth !== 0) return depth;
	return a.parent ? compareTitles(a.name, b.name) : 0;
}

const KEY_PATTERN = /^([A-Z]+)-(\d+)$/;

/** Key order (T-5): code as text (TASK like any code), then the number as a number. */
export function compareKeys(a: string, b: string): number {
	const left = KEY_PATTERN.exec(a);
	const right = KEY_PATTERN.exec(b);
	if (left === null || right === null) return compareText(a, b);
	return compareText(left[1] ?? '', right[1] ?? '') || Number(left[2]) - Number(right[2]);
}

/**
 * A column in its natural direction. `isEmpty` marks tickets without a value (no project, no
 * due date); they stay last in both directions and are compared only among themselves.
 */
interface Column<T> {
	compare: (a: T, b: T) => number;
	isEmpty?: (ticket: T) => boolean;
}

function column<T extends SortableTicket>(
	key: SortKey,
	resolveProject: ResolveProject<T>,
	assigneeName: AssigneeNameOf
): Column<T> {
	switch (key) {
		case 'key':
			return { compare: (a, b) => compareKeys(a.key, b.key) };
		case 'priority':
			return { compare: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] };
		case 'status':
			return { compare: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] };
		case 'title':
			return { compare: (a, b) => compareTitles(a.title, b.title) };
		case 'project':
			// Along the path "Haus › Garten" (ADR-0034), so sub projects stand with their parent.
			return {
				compare: (a, b) => {
					const left = resolveProject(a);
					const right = resolveProject(b);
					return left === null || right === null ? 0 : comparePathNames(left, right);
				},
				isEmpty: (ticket) => resolveProject(ticket) === null
			};
		case 'due':
			return {
				compare: (a, b) => compareDue(a.due, b.due),
				isEmpty: (ticket) => ticket.due === null
			};
		case 'created':
			// Newest first.
			return { compare: (a, b) => compareText(b.created, a.created) };
		case 'assignee':
			// By the name of the assignee (ADR-0068); tickets without one last.
			return {
				compare: (a, b) =>
					compareTitles(assigneeName(a.assignee ?? ''), assigneeName(b.assignee ?? '')),
				isEmpty: (ticket) => !ticket.assignee
			};
	}
}

/**
 * Comparator of a column sort at the given Berlin date (T-5): the column in its natural or
 * reversed direction, empty values (no project, no due date) last in both directions, ties in
 * the default order (`ticketOrder(today)`), so the result does not depend on the input order.
 * Without a spec it is the default order.
 */
export function columnOrder<T extends SortableTicket>(
	spec: SortSpec | null,
	today: CalendarDate,
	resolveProject: ResolveProject<T> = (ticket) => ticket.project,
	assigneeName: AssigneeNameOf = (id) => id
): (a: T, b: T) => number {
	const fallback = ticketOrder(today);
	if (spec === null) return fallback;
	const { compare, isEmpty } = column(spec.key, resolveProject, assigneeName);
	const sign = spec.reversed ? -1 : 1;
	return (a, b) => {
		if (isEmpty !== undefined) {
			const emptyA = isEmpty(a);
			if (emptyA !== isEmpty(b)) return emptyA ? 1 : -1;
			if (emptyA) return fallback(a, b);
		}
		return sign * compare(a, b) || fallback(a, b);
	};
}
