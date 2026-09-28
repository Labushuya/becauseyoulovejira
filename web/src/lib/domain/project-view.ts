// State of the project view in the URL (user request after EH-4): layout ("Liste" is the default,
// "Kacheln" the second one), column sort, search by name or code and the switch "Archivierte
// anzeigen". Pure: the only module that reads and writes these parameters; invalid values count as
// not set, other parameters stay untouched. The chosen layout is also kept in localStorage
// (`byl-projects-view`), so it holds on the next visit; the URL wins when it names one. Sub projects
// (ADR-0034) stand as a tree below their parent (`projectRows`); which parents are folded is kept
// per tab in sessionStorage (`byl-projects-collapsed`), not in the URL.

import type { Project } from './project';
import { compareTitles } from './ordering';

export const PROJECT_LAYOUTS = ['liste', 'kacheln'] as const;
export type ProjectLayout = (typeof PROJECT_LAYOUTS)[number];

/** Layout without a choice in the URL or in the storage. */
export const DEFAULT_PROJECT_LAYOUT: ProjectLayout = 'liste';

/** Key of the remembered layout in localStorage; only the layout, nothing else. */
export const PROJECT_LAYOUT_STORAGE_KEY = 'byl-projects-view';

/** URL parameter names in their fixed order. */
export const PROJECT_VIEW_PARAMS = Object.freeze({
	search: 'q',
	sort: 'sort',
	showArchived: 'archiviert',
	layout: 'darstellung'
} as const);

/** Longest search text in the URL (like the ticket search, ADR-0013 section 4). */
export const PROJECT_SEARCH_MAX_LENGTH = 200;

export const PROJECT_SORT_KEYS = ['code', 'name', 'active', 'total', 'new', 'archived'] as const;
export type ProjectSortKey = (typeof PROJECT_SORT_KEYS)[number];

export interface ProjectSort {
	key: ProjectSortKey;
	/** Opposite of the natural direction (second click). */
	reversed: boolean;
}

export interface ProjectViewQuery {
	/** Layout named in the URL; null: the remembered one or the default. */
	layout: ProjectLayout | null;
	/** Column sort; null: by name, as the catalog delivers. */
	sort: ProjectSort | null;
	/** Trimmed search text, 1 to PROJECT_SEARCH_MAX_LENGTH characters. */
	search: string | null;
	/** Switch "Archivierte anzeigen" (since E3, package 14). */
	showArchived: boolean;
}

export const EMPTY_PROJECT_VIEW_QUERY: Readonly<ProjectViewQuery> = Object.freeze({
	layout: null,
	sort: null,
	search: null,
	showArchived: false
});

/** German URL values of the columns. */
const SORT_VALUES: Readonly<Record<ProjectSortKey, string>> = Object.freeze({
	code: 'code',
	name: 'name',
	active: 'aktiv',
	total: 'gesamt',
	new: 'neu',
	archived: 'archiviert'
});

/** Direction of the first click per column, as `aria-sort` names it. */
export const PROJECT_NATURAL_DIRECTION: Readonly<
	Record<ProjectSortKey, 'ascending' | 'descending'>
> = Object.freeze({
	code: 'ascending',
	name: 'ascending',
	// Most tickets first.
	active: 'descending',
	total: 'descending',
	new: 'descending',
	// Archived projects first; the default order mixes them in by name.
	archived: 'descending'
});

/** Column names for the sort buttons and the caption. */
export const PROJECT_COLUMN_LABELS: Readonly<Record<ProjectSortKey, string>> = Object.freeze({
	code: 'Code',
	name: 'Name',
	active: 'aktiv',
	total: 'gesamt',
	new: 'neu',
	archived: 'archiviert'
});

/** Order in words: natural direction (first click), then reversed. */
const SORT_ORDER_LABELS: Readonly<Record<ProjectSortKey, readonly [string, string]>> =
	Object.freeze({
		code: ['A bis Z', 'Z bis A'],
		name: ['A bis Z', 'Z bis A'],
		active: ['meiste zuerst', 'wenigste zuerst'],
		total: ['meiste zuerst', 'wenigste zuerst'],
		new: ['meiste zuerst', 'wenigste zuerst'],
		archived: ['archivierte zuerst', 'aktive zuerst']
	});

const REVERSED_PREFIX = '-';

/** The value of a parameter that occurs exactly once; doubled parameters count as not set. */
function single(params: URLSearchParams, name: string): string | null {
	const values = params.getAll(name);
	return values.length === 1 ? (values[0] ?? null) : null;
}

function parseLayout(value: string | null): ProjectLayout | null {
	return value !== null && (PROJECT_LAYOUTS as readonly string[]).includes(value)
		? (value as ProjectLayout)
		: null;
}

function parseSort(value: string | null): ProjectSort | null {
	if (value === null) return null;
	const reversed = value.startsWith(REVERSED_PREFIX);
	const name = reversed ? value.slice(REVERSED_PREFIX.length) : value;
	const key = PROJECT_SORT_KEYS.find((entry) => SORT_VALUES[entry] === name);
	return key === undefined ? null : { key, reversed };
}

function parseSearch(value: string | null): string | null {
	const text = value?.trim() ?? '';
	if (text === '' || text.length > PROJECT_SEARCH_MAX_LENGTH) return null;
	return text;
}

export function parseProjectViewQuery(params: URLSearchParams): ProjectViewQuery {
	return {
		layout: parseLayout(single(params, PROJECT_VIEW_PARAMS.layout)),
		sort: parseSort(single(params, PROJECT_VIEW_PARAMS.sort)),
		search: parseSearch(single(params, PROJECT_VIEW_PARAMS.search)),
		showArchived: single(params, PROJECT_VIEW_PARAMS.showArchived) === '1'
	};
}

/** The query as parameters in their fixed order; unset values are left out. */
function projectViewEntries(query: ProjectViewQuery): [string, string][] {
	const entries: [string, string][] = [];
	const search = parseSearch(query.search);
	if (search !== null) entries.push([PROJECT_VIEW_PARAMS.search, search]);
	if (query.sort !== null) {
		const value = SORT_VALUES[query.sort.key];
		entries.push([PROJECT_VIEW_PARAMS.sort, query.sort.reversed ? `-${value}` : value]);
	}
	if (query.showArchived) entries.push([PROJECT_VIEW_PARAMS.showArchived, '1']);
	if (query.layout !== null) entries.push([PROJECT_VIEW_PARAMS.layout, query.layout]);
	return entries;
}

/** Only the project view parameters, as "?…" or "" (links into and out of the panel). */
export function serializeProjectViewQuery(query: ProjectViewQuery): string {
	const search = new URLSearchParams(projectViewEntries(query)).toString();
	return search === '' ? '' : `?${search}`;
}

/** The search part of `params` with the project view query replaced; other parameters stay. */
export function replaceProjectViewQuery(params: URLSearchParams, query: ProjectViewQuery): string {
	const next = new URLSearchParams(params);
	for (const name of Object.values(PROJECT_VIEW_PARAMS)) next.delete(name);
	for (const [name, value] of projectViewEntries(query)) next.append(name, value);
	const search = next.toString();
	return search === '' ? '' : `?${search}`;
}

/** Actual direction of a column sort, for `aria-sort`. */
export function projectSortDirection(sort: ProjectSort): 'ascending' | 'descending' {
	const natural = PROJECT_NATURAL_DIRECTION[sort.key];
	if (!sort.reversed) return natural;
	return natural === 'ascending' ? 'descending' : 'ascending';
}

/** Click cycle of a column header: natural direction → reversed → default (by name). */
export function nextProjectSort(sort: ProjectSort | null, key: ProjectSortKey): ProjectSort | null {
	if (sort === null || sort.key !== key) return { key, reversed: false };
	return sort.reversed ? null : { key, reversed: true };
}

/** The order of a column sort in words, e.g. "meiste zuerst". */
export function projectSortOrderLabel(sort: ProjectSort): string {
	const [natural, reversed] = SORT_ORDER_LABELS[sort.key];
	return sort.reversed ? reversed : natural;
}

/** Projects whose name or code contains the search text, without case (null: all). */
export function filterProjects(
	projects: readonly Project[],
	search: string | null
): readonly Project[] {
	// toLowerCase, not a locale API (purity rule of the domain modules); umlauts fold all the same.
	const needle = search?.trim().toLowerCase() ?? '';
	if (needle === '') return projects;
	return projects.filter(
		(project) =>
			project.name.toLowerCase().includes(needle) || project.code.toLowerCase().includes(needle)
	);
}

/** Numbers per project; null while unknown (they then sort last in both directions). */
export interface ProjectNumbers {
	active: (project: Project) => number | null;
	total: (project: Project) => number | null;
	fresh: (project: Project) => number;
}

function numberOf(
	key: 'active' | 'total' | 'new' | 'archived',
	project: Project,
	numbers: ProjectNumbers
): number | null {
	if (key === 'active') return numbers.active(project);
	if (key === 'total') return numbers.total(project);
	if (key === 'new') return numbers.fresh(project);
	return project.archived ? 1 : 0;
}

/**
 * Projects in the chosen order; without a sort they keep the given order (by name). Equal values
 * fall back to the name, unknown numbers stand last in both directions.
 */
export function sortProjects(
	projects: readonly Project[],
	sort: ProjectSort | null,
	numbers: ProjectNumbers
): readonly Project[] {
	if (sort === null) return projects;
	const ascending = projectSortDirection(sort) === 'ascending';
	const byName = (a: Project, b: Project) => compareTitles(a.name, b.name);
	return [...projects].sort((a, b) => {
		if (sort.key === 'name' || sort.key === 'code') {
			const order =
				sort.key === 'name' ? byName(a, b) : compareTitles(a.code, b.code) || byName(a, b);
			return ascending ? order : -order;
		}
		const left = numberOf(sort.key, a, numbers);
		const right = numberOf(sort.key, b, numbers);
		if (left === null || right === null) {
			if (left === right) return byName(a, b);
			return left === null ? 1 : -1;
		}
		if (left === right) return byName(a, b);
		return ascending ? left - right : right - left;
	});
}

/** Key of the folded parents in sessionStorage (ADR-0034 section 6); only this tab, default open. */
export const PROJECT_COLLAPSED_STORAGE_KEY = 'byl-projects-collapsed';

/** One row of the project list or one tile, in tree order (ADR-0034 section 6). */
export interface ProjectRow {
	project: Project;
	/** 1 for a sub project below its parent, 0 otherwise. */
	depth: 0 | 1;
	/** The parent does not match the search and stands only as context of a sub project. */
	context: boolean;
	/** Sub projects shown below a parent (0 for every other row). */
	childCount: number;
	/** The sub projects of this parent are folded away. */
	collapsed: boolean;
}

/**
 * Rows of the project view as a tree (ADR-0034 section 6): the top-level projects in the chosen
 * order, each followed by its sub projects in the same order. With a search, a matching sub
 * project brings its parent along as context, and folding does not apply, so every match shows.
 * A sub project whose parent is not available (e.g. the switch hides it) stands like a top-level
 * project.
 */
export function projectRows(
	available: readonly Project[],
	search: string | null,
	sort: ProjectSort | null,
	numbers: ProjectNumbers,
	collapsed: ReadonlySet<string>
): ProjectRow[] {
	const ids = new Set(available.map((project) => project.id));
	const matches = new Set(filterProjects(available, search).map((project) => project.id));
	const searching = (search?.trim() ?? '') !== '';
	const roots: Project[] = [];
	const children = new Map<string, Project[]>();
	for (const project of available) {
		const parentId = project.parentId ?? null;
		if (parentId === null || parentId === project.id || !ids.has(parentId)) {
			roots.push(project);
		} else if (matches.has(project.id)) {
			const list = children.get(parentId);
			if (list === undefined) children.set(parentId, [project]);
			else list.push(project);
		}
	}
	const rows: ProjectRow[] = [];
	for (const root of sortProjects(roots, sort, numbers)) {
		const shownChildren = sortProjects(children.get(root.id) ?? [], sort, numbers);
		const hit = matches.has(root.id);
		if (!hit && shownChildren.length === 0) continue;
		const folded = !searching && shownChildren.length > 0 && collapsed.has(root.id);
		rows.push({
			project: root,
			depth: 0,
			context: !hit,
			childCount: shownChildren.length,
			collapsed: folded
		});
		if (folded) continue;
		for (const child of shownChildren) {
			rows.push({ project: child, depth: 1, context: false, childCount: 0, collapsed: false });
		}
	}
	return rows;
}

const RECORD_ID = /^[a-z0-9]{15}$/;

/** The folded parents of this tab; empty without a valid entry or with a blocked storage. */
export function readCollapsedProjects(storage: Pick<Storage, 'getItem'> | null): string[] {
	try {
		const value: unknown = JSON.parse(storage?.getItem(PROJECT_COLLAPSED_STORAGE_KEY) ?? '[]');
		return Array.isArray(value)
			? value.filter((id): id is string => typeof id === 'string' && RECORD_ID.test(id))
			: [];
	} catch {
		return [];
	}
}

/** Remembers the folded parents; none removes the key. A blocked storage only loses the memory. */
export function writeCollapsedProjects(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	ids: readonly string[]
): void {
	try {
		if (ids.length === 0) storage?.removeItem(PROJECT_COLLAPSED_STORAGE_KEY);
		else storage?.setItem(PROJECT_COLLAPSED_STORAGE_KEY, JSON.stringify([...ids].sort()));
	} catch {
		// Folding still holds for this page.
	}
}

/** The remembered layout; null without one, with an unknown value or a blocked storage. */
export function readStoredProjectLayout(
	storage: Pick<Storage, 'getItem'> | null
): ProjectLayout | null {
	try {
		return parseLayout(storage?.getItem(PROJECT_LAYOUT_STORAGE_KEY) ?? null);
	} catch {
		return null;
	}
}

/** Remembers the layout; a blocked or full storage only loses the memory, never the choice. */
export function writeStoredProjectLayout(
	storage: Pick<Storage, 'setItem'> | null,
	layout: ProjectLayout
): void {
	try {
		storage?.setItem(PROJECT_LAYOUT_STORAGE_KEY, layout);
	} catch {
		// The choice still holds for this page through the URL.
	}
}

/** Shown layout: the URL first, then the remembered one, then the default. */
export function effectiveProjectLayout(
	query: Pick<ProjectViewQuery, 'layout'>,
	stored: ProjectLayout | null
): ProjectLayout {
	return query.layout ?? stored ?? DEFAULT_PROJECT_LAYOUT;
}
