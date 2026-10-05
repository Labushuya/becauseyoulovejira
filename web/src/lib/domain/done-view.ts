// View "Erledigte" (ER-1, ADR-0066). Pure: the state of its address (search, project with or
// without sub projects, tag, charm), the client form of its filter, the order of the done tickets
// and their groups by the Berlin day of completion. The search is not part of the predicate: the
// list does not load the description, so the server answers it (data/tickets.ts
// `listCompletedTickets`, tests/integration/web-filter-parity.test.mjs keeps both forms equal).
// Addresses of "Aufgaben" that asked for done tickets before ER-1 (the switch `erledigte=1`, the
// status filter "Erledigt") lead here with the filters both views know (`doneQueryOf`).
// "Zuständig" (E7-5, ADR-0068 §3) is one of them: an account or "Niemand", only in a household.

import { matchesAssignee } from './assignee';
import { addDays, type CalendarDate } from './berlin-date';
import { mondayOf, monthStart } from './calendar';
import { isCharmKey } from './charms';
import { NO_SUB_PROJECTS, matchesProject, type SubProjectsOf } from './filter';
import { berlinDateOf, formatBerlinDateTime } from './format';
import {
	EMPTY_LIST_QUERY,
	activeSearch,
	parseListQuery,
	serializeListQuery,
	type ListQuery
} from './list-query';
import { MONTH_NAMES } from './recurrence-text';
import type { TicketSummary } from './ticket';

export interface DoneQuery {
	/** Trimmed search text (title, description or key), as in "Aufgaben". */
	search: string | null;
	/** Project record ID or NO_PROJECT. */
	project: string | null;
	/** A project takes its sub projects in (ADR-0034), false only with `unterprojekte=0`. */
	subProjects: boolean;
	/** Tag record ID. */
	tag: string | null;
	/** Key of the charm catalog (ADR-0062). */
	charm: string | null;
	/** "Zuständig" (ADR-0068): an account record ID or NOBODY. */
	assignee: string | null;
}

export const EMPTY_DONE_QUERY: Readonly<DoneQuery> = Object.freeze({
	search: null,
	project: null,
	subProjects: true,
	tag: null,
	charm: null,
	assignee: null
});

/** Parameter of the charm; project, sub projects, tag and search are those of "Aufgaben". */
export const DONE_CHARM_PARAM = 'charm';

/**
 * Parameter of the switch "Erledigte anzeigen" of "Aufgaben" before ER-1; an address with it is
 * led here or loses it (`legacyDoneTarget`).
 */
export const LEGACY_DONE_PARAM = 'erledigte';

/** The filters "Aufgaben" and "Erledigte" share: project, sub projects, tag, assignee and search. */
export function doneQueryOf(
	query: Pick<ListQuery, 'project' | 'subProjects' | 'tag' | 'search'> &
		Partial<Pick<ListQuery, 'assignee'>>
): DoneQuery {
	return {
		search: query.search,
		project: query.project,
		subProjects: query.subProjects,
		tag: query.tag,
		charm: null,
		assignee: query.assignee ?? null
	};
}

/**
 * What an address of "Aufgaben" from before ER-1 becomes (ADR-0066 §5). With the status filter
 * "Erledigt", or with the switch `erledigte=1` and no status, it asked for done tickets: it goes to
 * "Erledigte" with the filters both views know. With the switch next to another status, which hid
 * the done tickets anyway, it only loses the switch (`search` is the rest, `?…` or ''). Null for
 * every other address.
 */
export type LegacyDoneTarget =
	{ kind: 'done'; query: DoneQuery } | { kind: 'strip'; search: string } | null;

export function legacyDoneTarget(params: URLSearchParams): LegacyDoneTarget {
	const list = parseListQuery(params);
	const switched = params.has(LEGACY_DONE_PARAM);
	const values = params.getAll(LEGACY_DONE_PARAM);
	const showDone = values.length === 1 && values[0] === '1';
	const asked = list.status === 'done' || (list.status === null && showDone);
	if (asked) return { kind: 'done', query: doneQueryOf(list) };
	if (!switched) return null;
	const rest = new URLSearchParams(params);
	rest.delete(LEGACY_DONE_PARAM);
	const search = rest.toString();
	return { kind: 'strip', search: search === '' ? '' : `?${search}` };
}

/** Reads the state of the view from URL parameters; every input gives a valid query. */
export function parseDoneQuery(params: URLSearchParams): DoneQuery {
	const charms = params.getAll(DONE_CHARM_PARAM);
	const charm = charms.length === 1 ? (charms[0] ?? null) : null;
	return { ...doneQueryOf(parseListQuery(params)), charm: isCharmKey(charm) ? charm : null };
}

/** Writes the state as URL search (`?…`, '' when empty), in the order of "Aufgaben", then the charm. */
export function serializeDoneQuery(query: DoneQuery): string {
	const list = serializeListQuery({
		...EMPTY_LIST_QUERY,
		project: query.project,
		subProjects: query.subProjects,
		tag: query.tag,
		assignee: query.assignee,
		search: query.search
	});
	const params = new URLSearchParams(list);
	if (query.charm !== null && isCharmKey(query.charm)) params.append(DONE_CHARM_PARAM, query.charm);
	const search = params.toString();
	return search === '' ? '' : `?${search}`;
}

/** True if a filter or the search is set (otherwise "Zurücksetzen" is locked). */
export function hasDoneFilters(query: DoneQuery): boolean {
	return (
		query.search !== null ||
		query.project !== null ||
		query.tag !== null ||
		query.charm !== null ||
		query.assignee !== null
	);
}

/** "Zurücksetzen": no filter and no search. */
export function resetDoneFilters(): DoneQuery {
	return { ...EMPTY_DONE_QUERY };
}

/** The search that applies (from two characters, as in "Aufgaben"), else null. */
export function activeDoneSearch(query: Pick<DoneQuery, 'search'>): string | null {
	return activeSearch(query);
}

export type DoneFilterableTicket = Pick<
	TicketSummary,
	'status' | 'projectId' | 'tagIds' | 'charm'
> &
	Partial<Pick<TicketSummary, 'assignee'>>;

/**
 * True if a done ticket passes project, tag, charm and assignee of `query`; the search is the server's (see
 * above). A ticket that is not done never passes. A project takes the sub projects `subProjectsOf`
 * names in, unless the query switches them off.
 */
export function matchesDoneQuery(
	ticket: DoneFilterableTicket,
	query: DoneQuery,
	subProjectsOf: SubProjectsOf = NO_SUB_PROJECTS
): boolean {
	return (
		ticket.status === 'done' &&
		matchesProject(ticket, query, subProjectsOf) &&
		(query.tag === null || ticket.tagIds.includes(query.tag)) &&
		(query.charm === null || ticket.charm === query.charm) &&
		matchesAssignee(ticket, query.assignee)
	);
}

/**
 * Point in time a ticket was completed: `completed_at`, which the hook sets with every change to
 * "done" and clears when it leaves it (CLAUDE.md §5). Its last change stands in for a value that is
 * missing in spite of that.
 */
export function completedAtOf(ticket: Pick<TicketSummary, 'completedAt' | 'updated'>): string {
	return ticket.completedAt ?? ticket.updated;
}

/** Server order of the view: `-completed_at,-created,-id`, the most recently completed first. */
export function compareCompleted(
	a: Pick<TicketSummary, 'completedAt' | 'created' | 'id'>,
	b: Pick<TicketSummary, 'completedAt' | 'created' | 'id'>
): number {
	const keys: [string, string][] = [
		[b.completedAt ?? '', a.completedAt ?? ''],
		[b.created, a.created],
		[b.id, a.id]
	];
	for (const [left, right] of keys) {
		if (left !== right) return left < right ? -1 : 1;
	}
	return 0;
}

/**
 * Group of a Berlin day of completion relative to `today` (ADR-0066 §2): today (also a later day,
 * which only a wrong clock can give), yesterday, the rest of the week from Monday, the rest of the
 * month, then one group per earlier month (`month:YYYY-MM`). Yesterday wins over the week, so on a
 * Monday "Gestern" is the Sunday before; a week that began in the month before takes its days.
 */
export function doneGroupKey(date: CalendarDate, today: CalendarDate): string {
	if (date >= today) return 'today';
	if (date === addDays(today, -1)) return 'yesterday';
	if (date >= mondayOf(today)) return 'week';
	if (date >= monthStart(today)) return 'month';
	return `month:${date.slice(0, 7)}`;
}

const GROUP_LABELS: Readonly<Record<string, string>> = Object.freeze({
	today: 'Heute',
	yesterday: 'Gestern',
	week: 'Diese Woche',
	month: 'Diesen Monat'
});

/** Heading of a group: "Heute", …, "September 2026". */
export function doneGroupLabel(key: string): string {
	const fixed = Object.hasOwn(GROUP_LABELS, key) ? GROUP_LABELS[key] : undefined;
	if (fixed !== undefined) return fixed;
	const year = key.slice(6, 10);
	const month = Number(key.slice(11, 13));
	return `${MONTH_NAMES[month - 1] ?? ''} ${year}`;
}

/** One group of the view. */
export interface DoneGroup {
	key: string;
	label: string;
	tickets: TicketSummary[];
}

/** Berlin calendar day of the completion of a ticket. */
export function completedDayOf(
	ticket: Pick<TicketSummary, 'completedAt' | 'updated'>
): CalendarDate {
	return berlinDateOf(completedAtOf(ticket));
}

/**
 * The done tickets in their groups, newest first: `tickets` in the order of `compareCompleted`,
 * groups in the order of their first ticket, empty ones left out.
 */
export function groupDone(tickets: readonly TicketSummary[], today: CalendarDate): DoneGroup[] {
	const groups = new Map<string, DoneGroup>();
	for (const ticket of [...tickets].sort(compareCompleted)) {
		const key = doneGroupKey(completedDayOf(ticket), today);
		const group = groups.get(key);
		if (group === undefined)
			groups.set(key, { key, label: doneGroupLabel(key), tickets: [ticket] });
		else group.tickets.push(ticket);
	}
	return [...groups.values()];
}

/** "1 erledigtes Ticket", "12 erledigte Tickets". */
export function doneCountText(count: number): string {
	return count === 1 ? '1 erledigtes Ticket' : `${count} erledigte Tickets`;
}

/**
 * Short time of completion for an entry: the Berlin time of day today and yesterday ("14:05"),
 * else the date ("12.09.2026"); `formatBerlinDateTime` gives the full text for screen readers.
 */
export function doneTimeLabel(timestamp: string, today: CalendarDate): string {
	const full = formatBerlinDateTime(timestamp);
	return berlinDateOf(timestamp) >= addDays(today, -1) ? full.slice(-5) : full.slice(0, 10);
}
