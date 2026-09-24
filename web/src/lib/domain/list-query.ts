// State of the ticket list in the URL (E3 plan, T-2; ADR-0013 section 4). Pure: the only module
// that reads and writes the list parameters. Invalid values count as not set; parameters this
// module does not know stay untouched when writing.

import { SORT_KEYS, type SortKey, type SortSpec } from './ordering';
import { PRIORITIES, STATUSES, type Priority, type Status } from './status';

/** Due filter (T-6): overdue, today, soon (tomorrow to today + SOON_DAYS), without a date. */
export const DUE_FILTERS = ['overdue', 'today', 'soon', 'none'] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

/** Groupings of the table (T-7); domain/grouping.ts groups by them. */
export const GROUPINGS = ['status', 'priority', 'project', 'due'] as const;
export type Grouping = (typeof GROUPINGS)[number];

/** Value of the project filter for tickets without a project. */
export const NO_PROJECT = 'ohne';

/** Longest search text in the URL (ADR-0013 section 4). */
export const SEARCH_MAX_LENGTH = 200;

/** Shortest search text that is sent to the server (E3 plan, T-15); shorter ones are ignored. */
export const SEARCH_MIN_LENGTH = 2;

/**
 * Record IDs of PocketBase (default id field: 15 characters a-z and 0-9). A well-formed but
 * unknown ID stays set and simply matches nothing (ADR-0013 section 4).
 */
const RECORD_ID = /^[a-z0-9]{15}$/;

export interface ListQuery {
	/** One status (OF-E3-3); null: every status that is not done. */
	status: Status | null;
	priority: Priority | null;
	due: DueFilter | null;
	/** Project record ID or NO_PROJECT. */
	project: string | null;
	/** Tag record ID. */
	tag: string | null;
	/** Trimmed search text, 1 to SEARCH_MAX_LENGTH characters. */
	search: string | null;
	/** Column sort; null: default order. */
	sort: SortSpec | null;
	grouping: Grouping | null;
	/** Switch "Erledigte anzeigen" (since E2). */
	showDone: boolean;
}

/** The filters "Zurücksetzen" clears (T-6); sort, grouping and the switch are view settings. */
export const FILTER_KEYS = ['status', 'priority', 'due', 'project', 'tag', 'search'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const EMPTY_LIST_QUERY: Readonly<ListQuery> = Object.freeze({
	status: null,
	priority: null,
	due: null,
	project: null,
	tag: null,
	search: null,
	sort: null,
	grouping: null,
	showDone: false
});

/** URL parameter names in their fixed order (same filters, same URL). */
export const LIST_PARAMS = Object.freeze({
	status: 'status',
	priority: 'prio',
	due: 'faellig',
	project: 'projekt',
	tag: 'tag',
	search: 'q',
	sort: 'sort',
	grouping: 'gruppe',
	showDone: 'erledigte'
} as const);

const PARAM_ORDER = Object.values(LIST_PARAMS) as readonly string[];

/** German URL values (ADR-0013 section 4); status and priority use their identifiers. */
const DUE_VALUES: Readonly<Record<DueFilter, string>> = Object.freeze({
	overdue: 'ueberfaellig',
	today: 'heute',
	soon: 'bald',
	none: 'ohne'
});

const SORT_VALUES: Readonly<Record<SortKey, string>> = Object.freeze({
	key: 'key',
	priority: 'prio',
	status: 'status',
	title: 'titel',
	project: 'projekt',
	due: 'faellig',
	created: 'erstellt'
});

const GROUPING_VALUES: Readonly<Record<Grouping, string>> = Object.freeze({
	status: 'status',
	priority: 'prio',
	project: 'projekt',
	due: 'faellig'
});

/** Prefix of a sort value for the opposite of the natural direction. */
const REVERSED_PREFIX = '-';

/** Key of `values` whose URL value is `value`, null for anything else. */
function keyOf<K extends string>(
	keys: readonly K[],
	values: Readonly<Record<K, string>>,
	value: string | null
): K | null {
	if (value === null) return null;
	return keys.find((key) => values[key] === value) ?? null;
}

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | null {
	return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** The value of a parameter that occurs exactly once; doubled parameters count as not set. */
function single(params: URLSearchParams, name: string): string | null {
	const values = params.getAll(name);
	return values.length === 1 ? (values[0] ?? null) : null;
}

function parseSearch(value: string | null): string | null {
	const text = value?.trim() ?? '';
	return text === '' || text.length > SEARCH_MAX_LENGTH ? null : text;
}

function parseSort(value: string | null): SortSpec | null {
	if (value === null) return null;
	const reversed = value.startsWith(REVERSED_PREFIX);
	const key = keyOf(SORT_KEYS, SORT_VALUES, reversed ? value.slice(1) : value);
	return key === null ? null : { key, reversed };
}

function parseRecordId(value: string | null): string | null {
	return value !== null && RECORD_ID.test(value) ? value : null;
}

/** Reads the list state from URL parameters; every input gives a valid query. */
export function parseListQuery(params: URLSearchParams): ListQuery {
	const project = single(params, LIST_PARAMS.project);
	return {
		status: oneOf(STATUSES, single(params, LIST_PARAMS.status)),
		priority: oneOf(PRIORITIES, single(params, LIST_PARAMS.priority)),
		due: keyOf(DUE_FILTERS, DUE_VALUES, single(params, LIST_PARAMS.due)),
		project: project === NO_PROJECT ? NO_PROJECT : parseRecordId(project),
		tag: parseRecordId(single(params, LIST_PARAMS.tag)),
		search: parseSearch(single(params, LIST_PARAMS.search)),
		sort: parseSort(single(params, LIST_PARAMS.sort)),
		grouping: keyOf(GROUPINGS, GROUPING_VALUES, single(params, LIST_PARAMS.grouping)),
		showDone: single(params, LIST_PARAMS.showDone) === '1'
	};
}

/** URL values of a query in the fixed parameter order; unset parts are left out. */
function queryEntries(query: ListQuery): [string, string][] {
	const search = parseSearch(query.search);
	const entries: [string, string | null][] = [
		[LIST_PARAMS.status, query.status],
		[LIST_PARAMS.priority, query.priority],
		[LIST_PARAMS.due, query.due === null ? null : DUE_VALUES[query.due]],
		[LIST_PARAMS.project, query.project],
		[LIST_PARAMS.tag, query.tag],
		[LIST_PARAMS.search, search],
		[
			LIST_PARAMS.sort,
			query.sort === null
				? null
				: `${query.sort.reversed ? REVERSED_PREFIX : ''}${SORT_VALUES[query.sort.key]}`
		],
		[LIST_PARAMS.grouping, query.grouping === null ? null : GROUPING_VALUES[query.grouping]],
		[LIST_PARAMS.showDone, query.showDone ? '1' : null]
	];
	return entries.filter((entry): entry is [string, string] => entry[1] !== null);
}

/**
 * Writes the query as URL search (`?…`, '' when empty). Parameters of `base` that this module
 * does not know stay in their order in front; the list parameters follow in a fixed order.
 */
export function serializeListQuery(
	query: ListQuery,
	base: URLSearchParams = new URLSearchParams()
): string {
	const params = new URLSearchParams();
	for (const [name, value] of base) {
		if (!PARAM_ORDER.includes(name)) params.append(name, value);
	}
	for (const [name, value] of queryEntries(query)) params.append(name, value);
	const search = params.toString();
	return search === '' ? '' : `?${search}`;
}

/** The query with one filter set; null means "Alle" for that filter. */
export function withFilter<K extends FilterKey>(
	query: ListQuery,
	key: K,
	value: ListQuery[K]
): ListQuery {
	return { ...query, [key]: value };
}

/** "Zurücksetzen" (T-6): clears every filter and the search, keeps sort, grouping and switch. */
export function resetFilters(query: ListQuery): ListQuery {
	return {
		...query,
		status: null,
		priority: null,
		due: null,
		project: null,
		tag: null,
		search: null
	};
}

/** True if a filter or the search is set (otherwise "Zurücksetzen" is locked). */
export function hasFilters(query: ListQuery): boolean {
	return FILTER_KEYS.some((key) => query[key] !== null);
}

/**
 * Search text that applies (E3 plan, T-15): the search of the query from SEARCH_MIN_LENGTH
 * characters on, else null. A shorter one stays in the URL but narrows nothing.
 */
export function activeSearch(query: Pick<ListQuery, 'search'>): string | null {
	return query.search !== null && query.search.length >= SEARCH_MIN_LENGTH ? query.search : null;
}
