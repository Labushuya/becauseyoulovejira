// Tree of the projects (ADR-0034, package UP-2): parents, order, path, choices and the set a
// project filter takes in.

import { describe, expect, it } from 'vitest';
import {
	compareProjectPaths,
	parentChoices,
	projectChoiceLabel,
	projectFamily,
	projectPath,
	resolveParents,
	subProjectsOf,
	treeOrder,
	type TreeProject
} from './project-tree';

function project(id: string, name: string, overrides: Partial<TreeProject> = {}): TreeProject {
	return { id, name, code: name.slice(0, 4).toUpperCase(), archived: false, ...overrides };
}

const HOUSE = project('house0000000001', 'Haus');
const GARDEN = project('garden000000001', 'Garten', { code: 'GART', parentId: HOUSE.id });
const ROOF = project('roof00000000001', 'Dach', { parentId: HOUSE.id });
const CAR = project('car000000000001', 'Auto');
const OLD = project('old000000000001', 'Büro', { archived: true });
/** A sub project whose parent is not visible (deleted or not loaded). */
const ORPHAN = project('orphan000000001', 'Keller', { parentId: 'gone00000000001' });

// By name, as the catalog delivers them.
const BY_NAME = [CAR, OLD, ROOF, GARDEN, HOUSE, ORPHAN];

describe('resolveParents', () => {
	it('resolves the parent of a sub project from the list', () => {
		const resolved = resolveParents(BY_NAME);
		expect(resolved.find((entry) => entry.id === GARDEN.id)?.parent).toEqual({
			id: HOUSE.id,
			name: 'Haus',
			code: 'HAUS'
		});
		// A top-level project stays the same object.
		expect(resolved.find((entry) => entry.id === HOUSE.id)).toBe(HOUSE);
		expect(resolved.find((entry) => entry.id === HOUSE.id)?.parent).toBeUndefined();
	});

	it('treats an unknown parent and a self reference as top-level', () => {
		const self = project('self00000000001', 'Selbst', { parentId: 'self00000000001' });
		const resolved = resolveParents([ORPHAN, self]);
		expect(resolved).toEqual([ORPHAN, self]);
		expect(resolved.map((entry) => entry.parent ?? null)).toEqual([null, null]);
	});

	it('keeps the order and the other fields', () => {
		const resolved = resolveParents(BY_NAME);
		expect(resolved.map((entry) => entry.id)).toEqual(BY_NAME.map((entry) => entry.id));
		expect(resolved[1]).toMatchObject({ name: 'Büro', archived: true });
	});
});

describe('treeOrder', () => {
	it('puts the sub projects right after their parent, each in the given order', () => {
		expect(treeOrder(BY_NAME).map((entry) => entry.name)).toEqual([
			'Auto',
			'Büro',
			'Haus',
			'Dach',
			'Garten',
			'Keller'
		]);
	});

	it('keeps a sub project without its parent in the list at its own place', () => {
		expect(treeOrder([GARDEN, CAR]).map((entry) => entry.name)).toEqual(['Garten', 'Auto']);
	});

	it('follows any order of the input, e.g. a column sort', () => {
		expect(treeOrder([HOUSE, GARDEN, ROOF, CAR]).map((entry) => entry.name)).toEqual([
			'Haus',
			'Garten',
			'Dach',
			'Auto'
		]);
	});
});

describe('subProjectsOf and projectFamily', () => {
	it('finds the sub projects of a parent, archived ones included', () => {
		const archivedChild = project('cellar000000001', 'Keller', {
			parentId: HOUSE.id,
			archived: true
		});
		expect(subProjectsOf([...BY_NAME, archivedChild], HOUSE.id).map((entry) => entry.name)).toEqual(
			['Dach', 'Garten', 'Keller']
		);
		expect(subProjectsOf(BY_NAME, CAR.id)).toEqual([]);
	});

	it('takes the sub projects into a project filter unless they are switched off', () => {
		expect(projectFamily(BY_NAME, HOUSE.id, true)).toEqual([HOUSE.id, ROOF.id, GARDEN.id]);
		expect(projectFamily(BY_NAME, HOUSE.id, false)).toEqual([HOUSE.id]);
		expect(projectFamily(BY_NAME, GARDEN.id, true)).toEqual([GARDEN.id]);
		expect(projectFamily(BY_NAME, 'unknown00000000', true)).toEqual(['unknown00000000']);
	});
});

describe('projectPath and projectChoiceLabel', () => {
	const [garden] = resolveParents([GARDEN, HOUSE]);

	it('names the path "Haus › Garten"', () => {
		expect(projectPath(garden!)).toBe('Haus › Garten');
		expect(projectPath({ name: 'Haus' })).toBe('Haus');
		expect(projectPath({ name: 'Haus', parent: null })).toBe('Haus');
	});

	it('labels a choice with path and code', () => {
		expect(projectChoiceLabel(garden!)).toBe('Haus › Garten (GART)');
		expect(projectChoiceLabel({ name: 'Auto', code: 'AUTO' })).toBe('Auto (AUTO)');
	});
});

describe('compareProjectPaths', () => {
	it('sorts sub projects with their parent, the parent first', () => {
		const resolved = resolveParents([GARDEN, CAR, ROOF, HOUSE, OLD]);
		expect([...resolved].sort(compareProjectPaths).map((entry) => entry.name)).toEqual([
			'Auto',
			'Büro',
			'Haus',
			'Dach',
			'Garten'
		]);
	});

	it('keeps parents of the same name apart by code and ID', () => {
		const first = project('same00000000001', 'Haus', { code: 'HAUSA' });
		const second = project('same00000000002', 'Haus', { code: 'HAUSB' });
		const childOfSecond = project('child0000000001', 'Anbau', { parentId: second.id });
		const childOfFirst = project('child0000000002', 'Zaun', { parentId: first.id });
		const resolved = resolveParents([childOfSecond, second, childOfFirst, first]);
		expect([...resolved].sort(compareProjectPaths).map((entry) => entry.id)).toEqual([
			first.id,
			childOfFirst.id,
			second.id,
			childOfSecond.id
		]);
	});
});

describe('parentChoices', () => {
	it('offers active top-level projects other than the project itself', () => {
		// "Keller" has a stored parent the list does not know; the hook would refuse it as nested.
		expect(parentChoices(BY_NAME, CAR).map((entry) => entry.name)).toEqual(['Haus']);
		expect(parentChoices(BY_NAME, null).map((entry) => entry.name)).toEqual(['Auto', 'Haus']);
	});

	it('offers nothing to a project that has sub projects', () => {
		expect(parentChoices(BY_NAME, HOUSE)).toEqual([]);
	});
});
