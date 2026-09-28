// Grouping of the open tickets (E3 plan, T-7; ADR-0013 section 1). Pure. Groups follow the
// order of the domain, not the alphabet; empty groups do not appear. Within a group the tickets
// keep the order they come in (the current sort). Since plan OR-3 on up to two levels, with the
// folded groups of a tab in sessionStorage.

import type { CalendarDate } from './berlin-date';
import { dueBucket, type DueBucket } from './filter';
import { PRIORITY_LABELS, STATUS_LABELS } from './labels';
import { NO_PROJECT, RECURRING_FILTERS, type Grouping, type RecurringFilter } from './list-query';
import { compareProjectPaths, type ResolveProject } from './ordering';
import { projectPath } from './project-tree';
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
	source: 'Quelle',
	recurrence: 'Wiederholung'
});

/** Groups of "Nach Wiederholung" (plan OR-2): the tickets of a series first. */
export const RECURRENCE_GROUP_LABELS: Readonly<Record<RecurringFilter, string>> = Object.freeze({
	recurring: 'Wiederkehrend',
	once: 'Einmalig'
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
	'status' | 'priority' | 'due' | 'project' | 'source' | 'recurring'
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
	// Along the tree (ADR-0034): by name, sub projects right after their parent, one group each with
	// the path "Haus › Garten" as its title; code and ID keep equal names in a fixed order.
	const named = [...projects.values()].sort(compareProjectPaths);
	return inOrder(groups, [...named.map((project) => project.id), NO_PROJECT], (key) => {
		if (key === NO_PROJECT) return NO_PROJECT_LABEL;
		const project = projects.get(key);
		return project === undefined ? key : projectPath(project);
	});
}

/**
 * Splits already sorted tickets into groups (T-7): status in the order of work, priority urgent
 * first, project by name with "Ohne Projekt" last, due date overdue · today · next 7 days ·
 * later · without date, source in the order of the families (ADR-0019 section 3), recurrence
 * "Wiederkehrend" before "Einmalig" (plan OR-2). `today` is the Berlin calendar date.
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
		case 'recurrence':
			return inOrder(
				collect(tickets, (ticket): RecurringFilter => (ticket.recurring ? 'recurring' : 'once')),
				RECURRING_FILTERS,
				(key) => RECURRENCE_GROUP_LABELS[key as RecurringFilter]
			);
	}
}

// --- Two levels (plan OR-3, ADR-0013 addendum B) -----------------------------------------------

/** A group of the table with its second level. */
export interface GroupNode<T> extends TicketGroup<T> {
	/**
	 * Key for folding, unique in the table and stable across reloads: "status:open", below a first
	 * level "project:p00000000000001/status:open".
	 */
	path: string;
	/** Groups of the second level in their order, null with one level. */
	subgroups: GroupNode<T>[] | null;
}

/**
 * Groups on one or two levels (plan OR-3): the first level as `groupTickets` does it, each group
 * split again by the second level (same order rules, empty groups left out). With `subGrouping`
 * null or equal to the first level there is one level. The tickets keep their order (the sort).
 */
export function groupTicketLevels<T extends GroupableTicket>(
	tickets: readonly T[],
	grouping: Grouping,
	subGrouping: Grouping | null,
	today: CalendarDate,
	resolveProject: ResolveProject<T> = (ticket) => ticket.project
): GroupNode<T>[] {
	const second = subGrouping === grouping ? null : subGrouping;
	return groupTickets(tickets, grouping, today, resolveProject).map((group) => {
		const path = `${grouping}:${group.key}`;
		return {
			...group,
			path,
			subgroups:
				second === null
					? null
					: groupTickets(group.tickets, second, today, resolveProject).map((sub) => ({
							...sub,
							path: `${path}/${second}:${sub.key}`,
							subgroups: null
						}))
		};
	});
}

/** Folded groups per tab in sessionStorage (plan OR-3), default open; like the projects. */
export const GROUP_COLLAPSED_STORAGE_KEY = 'byl-groups-collapsed';

/** At most so many folded groups are kept; older entries of a long session fall away. */
export const GROUP_COLLAPSED_MAX = 200;

const GROUP_PATH = /^[a-z]+:[a-z0-9_]{1,32}(?:\/[a-z]+:[a-z0-9_]{1,32})?$/;

/** The folded groups of this tab; empty without a valid entry or with a blocked storage. */
export function readCollapsedGroups(storage: Pick<Storage, 'getItem'> | null): string[] {
	try {
		const value: unknown = JSON.parse(storage?.getItem(GROUP_COLLAPSED_STORAGE_KEY) ?? '[]');
		return Array.isArray(value)
			? value
					.filter((path): path is string => typeof path === 'string' && GROUP_PATH.test(path))
					.slice(-GROUP_COLLAPSED_MAX)
			: [];
	} catch {
		return [];
	}
}

/** Remembers the folded groups in their order; none removes the key. */
export function writeCollapsedGroups(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	paths: readonly string[]
): void {
	try {
		const kept = paths.filter((path) => GROUP_PATH.test(path)).slice(-GROUP_COLLAPSED_MAX);
		if (kept.length === 0) storage?.removeItem(GROUP_COLLAPSED_STORAGE_KEY);
		else storage?.setItem(GROUP_COLLAPSED_STORAGE_KEY, JSON.stringify(kept));
	} catch {
		// Folding still holds for this page.
	}
}
