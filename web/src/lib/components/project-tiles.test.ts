// Component tests for the project tiles (E3 plan, T-12 and package 14; package UI-8): name, code
// and "N aktiv · M gesamt" in one link to the project panel, the current project marked, archived
// projects in words, "–" while a number is unknown. Sub projects (ADR-0034, UP-3): a parent with
// its sub projects in a section with a fold button, the sub projects indented with "in Haus".

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { Project } from '$lib/domain/project';
import type { ProjectRow } from '$lib/domain/project-view';
import ProjectTiles from './ProjectTiles.svelte';
import source from './ProjectTiles.svelte?raw';

const T0 = '2026-09-24 08:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0
};
const OLD: Project = {
	id: 'proj00000000002',
	name: 'Büro',
	code: 'BUERO',
	archived: true,
	updated: T0
};
const GARDEN: Project = {
	id: 'proj00000000011',
	name: 'Garten',
	code: 'GART',
	archived: false,
	updated: T0,
	parentId: HOUSE.id,
	parent: { id: HOUSE.id, name: 'Haus', code: 'HAUS' }
};

/** Top-level rows as the view builds them without sub projects. */
function rowsOf(projects: Project[]): ProjectRow[] {
	return projects.map((project) => ({
		project,
		depth: 0,
		context: false,
		childCount: 0,
		collapsed: false
	}));
}

function show(
	projects: Project[] = [HOUSE, OLD],
	activeOf: (project: Project) => number | null = (project) => (project.id === HOUSE.id ? 3 : 0),
	totalOf: (project: Project) => number | null = (project) => (project.id === HOUSE.id ? 7 : 2),
	activeId: string | null = null
) {
	render(ProjectTiles, { props: { rows: rowsOf(projects), activeOf, totalOf, hrefOf, activeId } });
}

const hrefOf = (project: Project) => `/projekte/${project.id}` as ResolvedPathname;

function tileOf(name: string): HTMLElement {
	const link = screen.getByRole('link', { name: new RegExp(`^${name}`) });
	const tile = link.closest('li');
	if (!(tile instanceof HTMLElement)) throw new Error(`No tile for ${name}`);
	return tile;
}

describe('project tiles', () => {
	it('shows name, code and "N aktiv · M gesamt" in one link to the project panel', () => {
		show();

		const link = screen.getByRole('link', { name: /^Haus/ });
		expect(link.getAttribute('href')).toBe('/projekte/proj00000000001');
		expect(within(tileOf('Haus')).queryByRole('button')).toBeNull();
		expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe('Haus HAUS 3 aktiv · 7 gesamt');
		expect(link.querySelector('.code')?.textContent).toBe('HAUS');
		expect(screen.getAllByRole('listitem')).toHaveLength(2);
	});

	it('keeps the order it gets (by name from the catalog)', () => {
		show([OLD, HOUSE]);

		expect(
			screen.getAllByRole('link').map((link) => link.querySelector('.name')?.textContent)
		).toEqual(['Büro', 'Haus']);
	});

	it('says in words that a project is archived', () => {
		show();

		expect(within(tileOf('Büro')).getByText('Archiviert')).toBeTruthy();
		expect(within(tileOf('Haus')).queryByText('Archiviert')).toBeNull();
	});

	it('shows "–" while a number is not known', () => {
		show(
			[HOUSE],
			() => null,
			() => null
		);

		expect(screen.getByRole('link').textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Haus HAUS – aktiv · – gesamt'
		);
	});

	it('marks the project of the panel as current (UI-8)', () => {
		show(undefined, undefined, undefined, HOUSE.id);

		expect(screen.getByRole('link', { name: /^Haus/ }).getAttribute('aria-current')).toBe('page');
		expect(screen.getByRole('link', { name: /^Büro/ }).hasAttribute('aria-current')).toBe(false);
		expect(tileOf('Haus').classList.contains('current')).toBe(true);
	});

	it('uses the surface radius like the KPI tiles', () => {
		expect(source).toMatch(/\.tile \{[^}]*border-radius: var\(--radius-surface\)/);
	});

	it('uses no error colour and no shadows (ADR-0010 section 3)', () => {
		expect(source).not.toMatch(/danger|box-shadow|gradient|backdrop-filter/);
	});
});

describe('project tiles: new (E4 plan, package 4)', () => {
	it('adds "N neu" as text when a project has new tickets', () => {
		render(ProjectTiles, {
			props: {
				rows: rowsOf([HOUSE, OLD]),
				activeOf: () => 1,
				totalOf: () => 2,
				newOf: (project: Project) => (project.id === HOUSE.id ? 2 : 0),
				hrefOf
			}
		});
		expect(tileOf(HOUSE.name).textContent?.replace(/\s+/g, ' ')).toContain('2 neu');
		expect(tileOf(OLD.name).textContent).not.toContain('neu');
	});
});

describe('project tiles: sub projects (ADR-0034)', () => {
	function showTree(collapsed = false, activeId: string | null = null) {
		const ontoggle = vi.fn();
		const rows: ProjectRow[] = [
			{ project: OLD, depth: 0, context: false, childCount: 0, collapsed: false },
			{ project: HOUSE, depth: 0, context: false, childCount: 1, collapsed },
			...(collapsed
				? []
				: [{ project: GARDEN, depth: 1 as const, context: false, childCount: 0, collapsed: false }])
		];
		render(ProjectTiles, {
			props: { rows, activeOf: () => 1, totalOf: () => 2, hrefOf, activeId, ontoggle }
		});
		return { ontoggle };
	}

	it('shows the sub projects indented below their parent, with "in Haus"', () => {
		showTree(false, GARDEN.id);

		const list = screen.getByRole('list', { name: 'Unterprojekte von Haus' });
		const garden = within(list).getByRole('link', { name: /Garten/ });
		expect(garden.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'in Haus Garten GART 1 aktiv · 2 gesamt'
		);
		expect(garden.getAttribute('aria-current')).toBe('page');
		expect(garden.closest('li')?.classList.contains('current')).toBe(true);
		// The family of "Haus" holds its tile, the button and the list.
		const family = screen.getByRole('link', { name: /^Haus/ }).closest('li.family');
		expect(family?.contains(list)).toBe(true);
	});

	it('folds the sub projects with a disclosure button that names the count', async () => {
		const { ontoggle } = showTree();
		const button = screen.getByRole('button', { name: '1 Unterprojekt von Haus' });
		expect(button.getAttribute('aria-expanded')).toBe('true');
		await fireEvent.click(button);
		expect(ontoggle).toHaveBeenCalledWith(HOUSE);
	});

	it('hides the sub projects of a folded parent', () => {
		showTree(true);
		expect(
			screen.getByRole('button', { name: '1 Unterprojekt von Haus' }).getAttribute('aria-expanded')
		).toBe('false');
		expect(screen.queryByRole('link', { name: /Garten/ })).toBeNull();
		expect(screen.queryByRole('list', { name: 'Unterprojekte von Haus' })).toBeNull();
	});
});
