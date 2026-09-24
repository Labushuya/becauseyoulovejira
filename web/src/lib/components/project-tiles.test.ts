// Component tests for the project tiles (E3 plan, T-12 and package 14): name, code and
// "N aktiv · M gesamt", the link to the tickets of the project, "Bearbeiten" next to the link,
// archived projects in words, "–" while a number is unknown.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
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
	totalOf: (project: Project) => number | null = (project) => (project.id === HOUSE.id ? 7 : 2)
) {
	const onedit = vi.fn();
	render(ProjectTiles, { props: { projects, activeOf, totalOf, onedit } });
	return { onedit };
}

function tileOf(name: string): HTMLElement {
	const link = screen.getByRole('link', { name: new RegExp(`^${name}`) });
	const tile = link.closest('li');
	if (!(tile instanceof HTMLElement)) throw new Error(`No tile for ${name}`);
	return tile;
}

describe('project tiles', () => {
	it('shows name, code and "N aktiv · M gesamt" in a link to the tickets of the project', () => {
		show();

		const link = screen.getByRole('link', { name: /^Haus/ });
		expect(link.getAttribute('href')).toBe('/?projekt=proj00000000001');
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

	it('has "Bearbeiten" next to the link, not in it, and passes the button along', async () => {
		const { onedit } = show();

		const button = screen.getByRole('button', { name: 'Projekt Haus bearbeiten' });
		expect(screen.getByRole('link', { name: /^Haus/ }).contains(button)).toBe(false);
		expect(tileOf('Haus').contains(button)).toBe(true);
		await fireEvent.click(button);

		expect(onedit).toHaveBeenCalledExactlyOnceWith(HOUSE, button);
	});

	it('uses no error colour and no shadows (ADR-0010 section 3)', () => {
		expect(source).not.toMatch(/danger|box-shadow|gradient|backdrop-filter/);
	});
});
