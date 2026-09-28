// Unit tests for the state of the project view (user request after EH-4): parameters of the URL,
// click cycle of the columns, filter by name or code, order with unknown numbers last, and the
// remembered layout in localStorage with a blocked storage.

import { describe, expect, it } from 'vitest';
import type { Project } from './project';
import {
	EMPTY_PROJECT_VIEW_QUERY,
	PROJECT_LAYOUT_STORAGE_KEY,
	effectiveProjectLayout,
	filterProjects,
	nextProjectSort,
	PROJECT_COLLAPSED_STORAGE_KEY,
	parseProjectViewQuery,
	projectRows,
	projectSortDirection,
	projectSortOrderLabel,
	readCollapsedProjects,
	readStoredProjectLayout,
	replaceProjectViewQuery,
	serializeProjectViewQuery,
	sortProjects,
	writeCollapsedProjects,
	writeStoredProjectLayout,
	type ProjectNumbers,
	type ProjectRow
} from './project-view';

const T0 = '2026-09-24 08:00:00.000Z';

function project(id: string, name: string, code: string, archived = false): Project {
	return { id, name, code, archived, updated: T0 };
}

const HOUSE = project('p1', 'Haus', 'HAUS');
const CAR = project('p2', 'Auto', 'AUTO');
const OFFICE = project('p3', 'Büro', 'BUERO', true);
const GARDEN = project('p4', 'garten', 'GAR');

const params = (search: string) => new URLSearchParams(search);

describe('project view query', () => {
	it('reads layout, sort, search and the switch; unknown values count as not set', () => {
		expect(parseProjectViewQuery(params(''))).toEqual(EMPTY_PROJECT_VIEW_QUERY);
		expect(
			parseProjectViewQuery(params('q=%20Haus%20&sort=-aktiv&archiviert=1&darstellung=kacheln'))
		).toEqual({
			search: 'Haus',
			sort: { key: 'active', reversed: true },
			showArchived: true,
			layout: 'kacheln'
		});
		expect(parseProjectViewQuery(params('q=&sort=titel&archiviert=0&darstellung=raster'))).toEqual(
			EMPTY_PROJECT_VIEW_QUERY
		);
		expect(parseProjectViewQuery(params('darstellung=liste&darstellung=liste')).layout).toBeNull();
		expect(parseProjectViewQuery(params(`q=${'x'.repeat(201)}`)).search).toBeNull();
	});

	it('writes the parameters in a fixed order and keeps other ones', () => {
		const query = {
			layout: 'kacheln' as const,
			sort: { key: 'code' as const, reversed: false },
			search: 'Haus',
			showArchived: true
		};
		expect(serializeProjectViewQuery(query)).toBe(
			'?q=Haus&sort=code&archiviert=1&darstellung=kacheln'
		);
		expect(serializeProjectViewQuery(EMPTY_PROJECT_VIEW_QUERY)).toBe('');
		expect(replaceProjectViewQuery(params('x=1&sort=name'), { ...query, search: null })).toBe(
			'?x=1&sort=code&archiviert=1&darstellung=kacheln'
		);
		expect(replaceProjectViewQuery(params('q=a'), EMPTY_PROJECT_VIEW_QUERY)).toBe('');
	});
});

describe('column sort', () => {
	it('cycles natural direction, reversed and the default', () => {
		expect(nextProjectSort(null, 'name')).toEqual({ key: 'name', reversed: false });
		expect(nextProjectSort({ key: 'name', reversed: false }, 'name')).toEqual({
			key: 'name',
			reversed: true
		});
		expect(nextProjectSort({ key: 'name', reversed: true }, 'name')).toBeNull();
		expect(nextProjectSort({ key: 'name', reversed: true }, 'total')).toEqual({
			key: 'total',
			reversed: false
		});
	});

	it('names the direction: text A to Z, numbers most first, archived first', () => {
		expect(projectSortDirection({ key: 'code', reversed: false })).toBe('ascending');
		expect(projectSortDirection({ key: 'active', reversed: false })).toBe('descending');
		expect(projectSortDirection({ key: 'active', reversed: true })).toBe('ascending');
		expect(projectSortOrderLabel({ key: 'new', reversed: false })).toBe('meiste zuerst');
		expect(projectSortOrderLabel({ key: 'archived', reversed: true })).toBe('aktive zuerst');
	});

	it('orders by the column, equal values by name, unknown numbers last', () => {
		const active = new Map<string, number | null>([
			['p1', 2],
			['p2', 5],
			['p3', 2],
			['p4', null]
		]);
		const numbers: ProjectNumbers = {
			active: (entry) => active.get(entry.id) ?? null,
			total: () => null,
			fresh: (entry) => (entry.id === 'p4' ? 1 : 0)
		};
		const all = [CAR, OFFICE, GARDEN, HOUSE];
		const names = (list: readonly Project[]) => list.map((entry) => entry.name);

		expect(sortProjects(all, null, numbers)).toBe(all);
		expect(names(sortProjects(all, { key: 'active', reversed: false }, numbers))).toEqual([
			'Auto',
			'Büro',
			'Haus',
			'garten'
		]);
		expect(names(sortProjects(all, { key: 'active', reversed: true }, numbers))).toEqual([
			'Büro',
			'Haus',
			'Auto',
			'garten'
		]);
		expect(names(sortProjects(all, { key: 'name', reversed: false }, numbers))).toEqual([
			'Auto',
			'Büro',
			'garten',
			'Haus'
		]);
		expect(names(sortProjects(all, { key: 'code', reversed: true }, numbers))).toEqual([
			'Haus',
			'garten',
			'Büro',
			'Auto'
		]);
		expect(names(sortProjects(all, { key: 'new', reversed: false }, numbers))[0]).toBe('garten');
		expect(names(sortProjects(all, { key: 'archived', reversed: false }, numbers))[0]).toBe('Büro');
	});
});

describe('search', () => {
	it('finds projects by a part of the name or the code, without case', () => {
		const all = [CAR, OFFICE, GARDEN, HOUSE];
		expect(filterProjects(all, null)).toBe(all);
		expect(filterProjects(all, '  ')).toBe(all);
		expect(filterProjects(all, 'AU').map((entry) => entry.id)).toEqual(['p2', 'p1']);
		expect(filterProjects(all, 'buero').map((entry) => entry.id)).toEqual(['p3']);
		expect(filterProjects(all, 'büro').map((entry) => entry.id)).toEqual(['p3']);
		expect(filterProjects(all, 'Garten').map((entry) => entry.id)).toEqual(['p4']);
		expect(filterProjects(all, 'xyz')).toEqual([]);
	});
});

describe('remembered layout', () => {
	it('reads and writes only the layout under its key', () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value)
		};
		expect(readStoredProjectLayout(storage)).toBeNull();
		writeStoredProjectLayout(storage, 'kacheln');
		expect(values.get(PROJECT_LAYOUT_STORAGE_KEY)).toBe('kacheln');
		expect(readStoredProjectLayout(storage)).toBe('kacheln');
		values.set(PROJECT_LAYOUT_STORAGE_KEY, 'raster');
		expect(readStoredProjectLayout(storage)).toBeNull();
	});

	it('survives a blocked or missing storage', () => {
		const blocked = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('full');
			}
		};
		expect(readStoredProjectLayout(blocked)).toBeNull();
		expect(() => writeStoredProjectLayout(blocked, 'liste')).not.toThrow();
		expect(readStoredProjectLayout(null)).toBeNull();
	});

	it('shows the layout of the URL first, then the remembered one, then the list', () => {
		expect(effectiveProjectLayout({ layout: 'liste' }, 'kacheln')).toBe('liste');
		expect(effectiveProjectLayout({ layout: null }, 'kacheln')).toBe('kacheln');
		expect(effectiveProjectLayout({ layout: null }, null)).toBe('liste');
	});
});

describe('tree of the project view (ADR-0034)', () => {
	const home = project('home00000000001', 'Haus', 'HAUS');
	const yard = { ...project('yard00000000001', 'Garten', 'GART'), parentId: home.id };
	const roof = { ...project('roof00000000001', 'Dach', 'DACH'), parentId: home.id };
	const car = project('car000000000001', 'Auto', 'AUTO');
	// By name, as the catalog delivers them.
	const all = [car, roof, yard, home];
	const counts: Record<string, number> = { [car.id]: 1, [home.id]: 2, [roof.id]: 9, [yard.id]: 0 };
	const numbers: ProjectNumbers = {
		active: (entry) => counts[entry.id] ?? 0,
		total: (entry) => counts[entry.id] ?? 0,
		fresh: () => 0
	};
	const shape = (rows: ProjectRow[]) =>
		rows.map(
			(row) =>
				`${'  '.repeat(row.depth)}${row.project.name}${row.context ? ' (Kontext)' : ''}${
					row.childCount > 0 ? ` [${row.childCount}${row.collapsed ? ', zu' : ''}]` : ''
				}`
		);

	it('puts the sub projects below their parent, both in the chosen order', () => {
		expect(shape(projectRows(all, null, null, numbers, new Set()))).toEqual([
			'Auto',
			'Haus [2]',
			'  Dach',
			'  Garten'
		]);
		// Most active first: the parents are sorted, then the sub projects within their parent.
		expect(
			shape(projectRows(all, null, { key: 'active', reversed: false }, numbers, new Set()))
		).toEqual(['Haus [2]', '  Dach', '  Garten', 'Auto']);
	});

	it('folds the sub projects of a parent away', () => {
		expect(shape(projectRows(all, null, null, numbers, new Set([home.id])))).toEqual([
			'Auto',
			'Haus [2, zu]'
		]);
	});

	it('shows a matching sub project with its parent as context and ignores folding while searching', () => {
		expect(shape(projectRows(all, 'gart', null, numbers, new Set([home.id])))).toEqual([
			'Haus (Kontext) [1]',
			'  Garten'
		]);
		// A matching parent shows without its sub projects that do not match.
		expect(shape(projectRows(all, 'haus', null, numbers, new Set()))).toEqual(['Haus']);
		expect(projectRows(all, 'xyz', null, numbers, new Set())).toEqual([]);
	});

	it('shows a sub project whose parent is not available like a top-level project', () => {
		expect(shape(projectRows([car, yard], null, null, numbers, new Set()))).toEqual([
			'Auto',
			'Garten'
		]);
	});

	it('keeps the folded parents per tab, and survives a blocked storage', () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value),
			removeItem: (key: string) => void values.delete(key)
		};
		expect(readCollapsedProjects(storage)).toEqual([]);
		writeCollapsedProjects(storage, ['yard00000000001', 'home00000000001']);
		expect(values.get(PROJECT_COLLAPSED_STORAGE_KEY)).toBe('["home00000000001","yard00000000001"]');
		expect(readCollapsedProjects(storage)).toEqual(['home00000000001', 'yard00000000001']);
		writeCollapsedProjects(storage, []);
		expect(values.has(PROJECT_COLLAPSED_STORAGE_KEY)).toBe(false);
		values.set(PROJECT_COLLAPSED_STORAGE_KEY, '{"x":1}');
		expect(readCollapsedProjects(storage)).toEqual([]);
		values.set(PROJECT_COLLAPSED_STORAGE_KEY, '["kurz", 5, "home00000000001"]');
		expect(readCollapsedProjects(storage)).toEqual(['home00000000001']);
		values.set(PROJECT_COLLAPSED_STORAGE_KEY, 'kaputt');
		expect(readCollapsedProjects(storage)).toEqual([]);

		const blocked = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('full');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		expect(readCollapsedProjects(blocked)).toEqual([]);
		expect(() => writeCollapsedProjects(blocked, ['home00000000001'])).not.toThrow();
		expect(readCollapsedProjects(null)).toEqual([]);
	});
});
