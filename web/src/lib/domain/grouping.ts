// Grouping of the open tickets (E3 plan, T-7; ADR-0013 section 1). Pure. Groups follow the
// order of the domain, not the alphabet; empty groups do not appear. Within a group the tickets
// keep the order they come in (the current sort).

import type { CalendarDate } from './berlin-date';
import { dueBucket, type DueBucket } from './filter';
import { PRIORITY_LABELS, STATUS_LABELS } from './labels';
import { NO_PROJECT, type Grouping } from './list-query';
import { compareTitles, type ResolveProject } from './ordering';
import { SOURCE_FAMILIES, SOURCE_FAMILY_LABELS, sourceFamily, type SourceFamily } from './source';
import { PRIORITIES, STATUSES } from './status';
import type { ProjectRef, TicketSummary } from './ticket';

// The groupings belong to the list state (list-query.ts, no import cycle); re-exported here.
export { GROUPINGS, type Grouping } from './list-query';

/** Short German names of the groupings, e.g. for "Gruppiert: Projekt". */
export const GROUPING_LABELS: Readonly<Record<Grouping, string>> = Object.freeze({
	status: 'Status',
	priority: 'Priorität',
	project: 'Projekt',
	due: 'Fälligkeit',
	source: 'Quelle'
});

/** Group of tickets without a project; always last. */
export const NO_PROJECT_LABEL = 'Ohne Projekt';

/** Due groups in their order (T-7). */
export const DUE_GROUP_LABELS: Readonly<Record<DueBucket, string>> = Object.freeze({
	overdue: 'Überfällig',
	today: 'Heute',
	soon: 'Nächste 7 Tage',
	later: 'Später',
	none: 'Ohne Datum'
});
const DUE_GROUP_ORDER: readonly DueBucket[] = ['overdue', 'today', 'soon', 'later', 'none'];

/** Status groups in the order of work; a just checked row (done) comes last. */
const STATUS_GROUP_ORDER = [...STATUSES];
/** Urgent first. */
const PRIORITY_GROUP_ORDER = [...PRIORITIES].reverse();

export interface TicketGroup<T> {
	/** Stable key: status, priority, due bucket, project ID or NO_PROJECT. */
	key: string;
	label: string;
	tickets: T[];
}

export type GroupableTicket = Pick<
	TicketSummary,
	'status' | 'priority' | 'due' | 'project' | 'source'
>;

/** Tickets per key in the input order. */
function collect<T>(tickets: readonly T[], keyOf: (ticket: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const ticket of tickets) {
		const key = keyOf(ticket);
		const group = groups.get(key);
		if (group === undefined) groups.set(key, [ticket]);
		else group.push(ticket);
	}
	return groups;
}

function inOrder<T>(
	groups: Map<string, T[]>,
	order: readonly string[],
	labelOf: (key: string) => string
): TicketGroup<T>[] {
	return order.flatMap((key) => {
		const tickets = groups.get(key);
		return tickets === undefined ? [] : [{ key, label: labelOf(key), tickets }];
	});
}

function projectGroups<T>(
	tickets: readonly T[],
	resolveProject: ResolveProject<T>
): TicketGroup<T>[] {
	const projects = new Map<string, ProjectRef>();
	const groups = collect(tickets, (ticket) => {
		const project = resolveProject(ticket);
		if (project === null) return NO_PROJECT;
		projects.set(project.id, project);
		return project.id;
	});
	// By name, then code and ID, so projects with the same name keep a fixed order.
	const named = [...projects.values()].sort(
		(a, b) =>
			compareTitles(a.name, b.name) || compareTitles(a.code, b.code) || (a.id < b.id ? -1 : 1)
	);
	return inOrder(groups, [...named.map((project) => project.id), NO_PROJECT], (key) =>
		key === NO_PROJECT ? NO_PROJECT_LABEL : (projects.get(key)?.name ?? key)
	);
}

/**
 * Splits already sorted tickets into groups (T-7): status in the order of work, priority urgent
 * first, project by name with "Ohne Projekt" last, due date overdue · today · next 7 days ·
 * later · without date, source in the order of the families (ADR-0019 section 3). `today` is the
 * Berlin calendar date.
 */
export function groupTickets<T extends GroupableTicket>(
	tickets: readonly T[],
	grouping: Grouping,
	today: CalendarDate,
	resolveProject: ResolveProject<T> = (ticket) => ticket.project
): TicketGroup<T>[] {
	switch (grouping) {
		case 'status':
			return inOrder(
				collect(tickets, (ticket) => ticket.status),
				STATUS_GROUP_ORDER,
				(key) => STATUS_LABELS[key as (typeof STATUSES)[number]]
			);
		case 'priority':
			return inOrder(
				collect(tickets, (ticket) => ticket.priority),
				PRIORITY_GROUP_ORDER,
				(key) => PRIORITY_LABELS[key as (typeof PRIORITIES)[number]]
			);
		case 'project':
			return projectGroups(tickets, resolveProject);
		case 'due':
			return inOrder(
				collect(tickets, (ticket) => dueBucket(ticket.due, today)),
				DUE_GROUP_ORDER,
				(key) => DUE_GROUP_LABELS[key as DueBucket]
			);
		case 'source':
			return inOrder(
				collect(tickets, (ticket) => sourceFamily(ticket.source)),
				SOURCE_FAMILIES,
				(key) => SOURCE_FAMILY_LABELS[key as SourceFamily]
			);
	}
}
