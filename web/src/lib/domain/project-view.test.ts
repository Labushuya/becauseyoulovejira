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
	parseProjectViewQuery,
	projectSortDirection,
	projectSortOrderLabel,
	readStoredProjectLayout,
	replaceProjectViewQuery,
	serializeProjectViewQuery,
	sortProjects,
	writeStoredProjectLayout,
	type ProjectNumbers
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
