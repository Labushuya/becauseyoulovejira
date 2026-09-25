// Component tests for the project tiles (E3 plan, T-12 and package 14; package UI-8): name, code
// and "N aktiv · M gesamt" in one link to the project panel, the current project marked, archived
// projects in words, "–" while a number is unknown.

import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { Project } from '$lib/domain/project';
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

function show(
	projects: Project[] = [HOUSE, OLD],
	activeOf: (project: Project) => number | null = (project) => (project.id === HOUSE.id ? 3 : 0),
	totalOf: (project: Project) => number | null = (project) => (project.id === HOUSE.id ? 7 : 2),
	activeId: string | null = null
) {
	render(ProjectTiles, { props: { projects, activeOf, totalOf, hrefOf, activeId } });
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
				projects: [HOUSE, OLD],
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
