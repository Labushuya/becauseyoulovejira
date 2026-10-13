// Sorting the plan of a day (TP-5, ADR-0065 addendum TP-5): a view, never a rewrite. "Manuell" shows
// the order the plan stores (`position`), the other choices sort it for this device like a column of
// "Aufgaben" (ADR-0013), and the stored order stays untouched until "Als manuelle Reihenfolge
// übernehmen". Pure.
//
// The rules of a sorted plan:
// - Two sections: open entries first, entries checked for today or whose ticket is done last; each
//   section sorted by the same criterion.
// - Within a section a parent and its sub-tasks of the same section are a unit: the unit sorts by the
//   parent, the sub-tasks follow it indented, sorted among each other (arrangeBy, like the table,
//   ADR-0033 §5). A sub-task without its parent in the section sorts on its own and shows its line of
//   context.
// - Ties keep the manual order; entries without a visible ticket stand last in their section.

import {
	NATURAL_DIRECTION,
	columnSort,
	type AssigneeNameOf,
	type ResolveProject,
	type SortableTicket
} from './ordering';
import { arrangeBy, nestedInOrder, type ArrangedTicket } from './subtasks';

/** The choices of the control "Sortierung", in the order of the menu. */
export const DAY_PLAN_SORT_KEYS = [
	'manual',
	'priority',
	'status',
	'due',
	'title',
	'project',
	'assignee'
] as const;
export type DayPlanSortKey = (typeof DAY_PLAN_SORT_KEYS)[number];

/** A sorted choice, every one except "Manuell". */
export type DayPlanSortColumn = Exclude<DayPlanSortKey, 'manual'>;

export type SortDirection = 'ascending' | 'descending';

export const SORT_DIRECTIONS: readonly SortDirection[] = Object.freeze(['ascending', 'descending']);

/** The sort of the plan; "Manuell" has no direction (its value is ignored). */
export interface DayPlanSort {
	key: DayPlanSortKey;
	direction: SortDirection;
}

export const MANUAL_SORT: DayPlanSort = Object.freeze({ key: 'manual', direction: 'ascending' });

/** Key in localStorage (CLAUDE.md §7: preferences of a device start with `byl-`). */
export const DAY_PLAN_SORT_STORAGE_KEY = 'byl-dayplan-sort';

export const DAY_PLAN_SORT_LABELS: Readonly<Record<DayPlanSortKey, string>> = Object.freeze({
	manual: 'Manuell',
	priority: 'Priorität',
	status: 'Status',
	due: 'Fälligkeit',
	title: 'Titel',
	project: 'Projekt',
	assignee: 'Zuständigkeit'
});

export const SORT_DIRECTION_LABELS: Readonly<Record<SortDirection, string>> = Object.freeze({
	ascending: 'Aufsteigend',
	descending: 'Absteigend'
});

/** What a direction means for a criterion, for the tooltip and the hint below the controls. */
const DIRECTION_HINTS: Readonly<Record<DayPlanSortColumn, Record<SortDirection, string>>> =
	Object.freeze({
		priority: { descending: 'Dringende zuerst', ascending: 'Niedrige zuerst' },
		status: { ascending: 'Backlog zuerst', descending: 'Wartet zuerst' },
		due: {
			ascending: 'Früheste zuerst, ohne Fälligkeit zuletzt',
			descending: 'Späteste zuerst, ohne Fälligkeit zuletzt'
		},
		title: { ascending: 'A bis Z', descending: 'Z bis A' },
		project: {
			ascending: 'Projekte A bis Z, ohne Projekt zuletzt',
			descending: 'Projekte Z bis A, ohne Projekt zuletzt'
		},
		assignee: {
			ascending: 'Namen A bis Z, ohne Zuständigkeit zuletzt',
			descending: 'Namen Z bis A, ohne Zuständigkeit zuletzt'
		}
	});

/** "Zuständigkeit" only in the household (ADR-0068): privately nobody is assigned. */
export function sortKeysFor(household: boolean): DayPlanSortKey[] {
	return DAY_PLAN_SORT_KEYS.filter((key) => household || key !== 'assignee');
}

/** The direction of a criterion at first, the same as the first click on its column in "Aufgaben". */
export function defaultDirection(key: DayPlanSortKey): SortDirection {
	return key === 'manual' ? 'ascending' : NATURAL_DIRECTION[key];
}

/** A criterion with its first direction. */
export function sortBy(key: DayPlanSortKey): DayPlanSort {
	return key === 'manual' ? MANUAL_SORT : { key, direction: defaultDirection(key) };
}

function isSortKey(value: string): value is DayPlanSortKey {
	return (DAY_PLAN_SORT_KEYS as readonly string[]).includes(value);
}

/**
 * The stored sort: "priority:descending" (criterion and direction); a criterion alone takes its first
 * direction. Anything else, also nothing, is "Manuell".
 */
export function parseDayPlanSort(raw: string | null | undefined): DayPlanSort {
	if (typeof raw !== 'string') return MANUAL_SORT;
	const [key = '', direction, ...rest] = raw.split(':');
	if (rest.length > 0 || !isSortKey(key) || key === 'manual') return MANUAL_SORT;
	if (direction === undefined) return sortBy(key);
	if (direction !== 'ascending' && direction !== 'descending') return MANUAL_SORT;
	return { key, direction };
}

/** The value to store; null for "Manuell", which removes the key. */
export function serializeDayPlanSort(sort: DayPlanSort): string | null {
	return sort.key === 'manual' ? null : `${sort.key}:${sort.direction}`;
}

/** The sort that applies: "Zuständigkeit" outside the household is "Manuell" (the choice stays). */
export function effectiveSort(sort: DayPlanSort, household: boolean): DayPlanSort {
	return sort.key === 'assignee' && !household ? MANUAL_SORT : sort;
}

export function sameSort(a: DayPlanSort, b: DayPlanSort): boolean {
	if (a.key !== b.key) return false;
	return a.key === 'manual' || a.direction === b.direction;
}

/** "Dringende zuerst" for priority descending; '' for "Manuell". */
export function directionHint(key: DayPlanSortKey, direction: SortDirection): string {
	return key === 'manual' ? '' : DIRECTION_HINTS[key][direction];
}

/** Visible text of the button "Sortierung": "Sortierung: Priorität". */
export function sortButtonText(sort: DayPlanSort): string {
	return `Sortierung: ${DAY_PLAN_SORT_LABELS[sort.key]}`;
}

/** The hint below the controls of a sorted plan: "Sortiert nach Priorität (Dringende zuerst). …". */
export function sortedText(sort: DayPlanSort): string {
	if (sort.key === 'manual') return '';
	return `Sortiert nach ${DAY_PLAN_SORT_LABELS[sort.key]} (${directionHint(sort.key, sort.direction)}). Abgehaktes steht am Ende.`;
}

/** What screen readers hear after a change of the sort. */
export function sortAnnouncement(sort: DayPlanSort): string {
	if (sort.key === 'manual') return 'Manuelle Reihenfolge.';
	return `Sortiert nach ${DAY_PLAN_SORT_LABELS[sort.key]}, ${SORT_DIRECTION_LABELS[sort.direction].toLowerCase()}: ${directionHint(sort.key, sort.direction)}.`;
}

/** Hint of a sorted plan that can change: the order changes only in "Manuell" (S3). */
export const SORTED_MOVE_HINT = 'Zum Verschieben auf „Manuell“ umstellen.';

/** An entry as the plan shows it: indented below its parent or not. */
export interface ShownEntry<E> {
	entry: E;
	nested: boolean;
}

/** What sorting needs of an entry of the plan. */
export interface PlanEntryAccess<E, T> {
	/** The ticket of the entry, null while it is not visible. */
	ticketOf: (entry: E) => T | null;
	/** Checked for today or its ticket is done. */
	doneOf: (entry: E) => boolean;
}

/** Stands in for a ticket that is not visible: never a parent, never a sub-task. */
const NO_TICKET: ArrangedTicket = Object.freeze({ id: '', parentId: null });

/**
 * The entries of a plan, given in their manual order, as the sort shows them. "Manuell" keeps the
 * order and indents a sub-task directly below its parent or an indented sibling (nestedInOrder,
 * TP-3); every other sort follows the rules at the top of this module.
 */
export function sortPlanEntries<E, T extends SortableTicket & ArrangedTicket>(
	entries: readonly E[],
	sort: DayPlanSort,
	access: PlanEntryAccess<E, T>,
	resolveProject: ResolveProject<T> = (ticket) => ticket.project,
	assigneeName: AssigneeNameOf = (id) => id
): ShownEntry<E>[] {
	if (sort.key === 'manual') {
		const nested = nestedInOrder(entries.map(access.ticketOf));
		return entries.map((entry, index) => ({ entry, nested: nested[index] === true }));
	}
	const manual = new Map<T, number>();
	entries.forEach((entry, index) => {
		const ticket = access.ticketOf(entry);
		if (ticket !== null) manual.set(ticket, index);
	});
	const spec = { key: sort.key, reversed: sort.direction !== NATURAL_DIRECTION[sort.key] };
	const compare = columnSort<T>(
		spec,
		(a, b) => (manual.get(a) ?? 0) - (manual.get(b) ?? 0),
		resolveProject,
		assigneeName
	);
	const section = (done: boolean): ShownEntry<E>[] => {
		const own = entries.filter((entry) => access.doneOf(entry) === done);
		const visible = own
			.flatMap((entry) => {
				const ticket = access.ticketOf(entry);
				return ticket === null ? [] : [{ entry, ticket }];
			})
			.sort((a, b) => compare(a.ticket, b.ticket))
			.map(({ entry }) => entry);
		const hidden = own.filter((entry) => access.ticketOf(entry) === null);
		return arrangeBy(
			[...visible, ...hidden],
			(entry) => access.ticketOf(entry) ?? NO_TICKET,
			true,
			() => null
		).map(({ entry, nested }) => ({ entry, nested }));
	};
	return [...section(false), ...section(true)];
}
