// Colors of projects and tickets (ADR-0052) in the building blocks: the choice as a group of radios
// with the visible name of every color and the inherited one first, the mark as a dot or stripe
// with its name, and the dot before the name of a project in the list and in the tiles.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { Project } from '$lib/domain/project';
import type { ProjectRow } from '$lib/domain/project-view';
import ColorChoice from './ColorChoice.svelte';
import ColorMark from './ColorMark.svelte';
import ProjectTable from './ProjectTable.svelte';
import ProjectTiles from './ProjectTiles.svelte';
import choiceSource from './ColorChoice.svelte?raw';
import markSource from './ColorMark.svelte?raw';

const T0 = '2026-09-24 08:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0,
	color: 'blau'
};
const GARDEN: Project = {
	id: 'proj00000000011',
	name: 'Garten',
	code: 'GART',
	archived: false,
	updated: T0,
	color: null,
	parentId: HOUSE.id,
	parent: { id: HOUSE.id, name: 'Haus', code: 'HAUS', color: 'blau' }
};
const CAR: Project = { ...HOUSE, id: 'proj00000000002', name: 'Auto', code: 'AUTO', color: null };

function choice(props: Record<string, unknown> = {}) {
	const onchoose = vi.fn();
	render(ColorChoice, {
		props: {
			value: null,
			inheritLabel: 'Wie Projekt (Blau)',
			inherited: 'blau',
			labelledby: 'color-label',
			errorId: 'color-error',
			onchoose,
			...props
		}
	});
	return { onchoose, group: screen.getByRole('radiogroup') };
}

describe('color choice (ADR-0052)', () => {
	it('is a group of native radios with the visible name of every color, the inherited one first', () => {
		const { group } = choice();
		const radios = within(group).getAllByRole<HTMLInputElement>('radio');
		expect(radios).toHaveLength(11);
		expect(radios.map((radio) => radio.labels?.[0]?.textContent?.trim())).toEqual([
			'Wie Projekt (Blau)',
			'Violett',
			'Indigo',
			'Blau',
			'Himmelblau',
			'Türkis',
			'Grün',
			'Oliv',
			'Senf',
			'Braun',
			'Grau'
		]);
		expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
		expect(radios[0]?.checked).toBe(true);
		expect(group.getAttribute('aria-labelledby')).toBe('color-label');
		// The swatches are decoration; the name says everything.
		for (const swatch of group.querySelectorAll('.swatch')) {
			expect(swatch.getAttribute('aria-hidden')).toBe('true');
		}
	});

	it('hands the key or null to the owner and marks the chosen one', async () => {
		const { onchoose, group } = choice({ value: 'senf' });
		expect(within(group).getByRole<HTMLInputElement>('radio', { name: 'Senf' }).checked).toBe(true);
		await fireEvent.click(within(group).getByRole('radio', { name: 'Grau' }));
		expect(onchoose).toHaveBeenLastCalledWith('grau');
		await fireEvent.click(within(group).getByRole('radio', { name: 'Wie Projekt (Blau)' }));
		expect(onchoose).toHaveBeenLastCalledWith(null);
	});

	it('shows a dashed swatch without an inherited color, an error linked to the group and "busy"', () => {
		const { group } = choice({
			inheritLabel: 'Keine',
			inherited: null,
			error: 'Ungültiger Wert.',
			describedby: 'color-hint',
			busy: true
		});
		expect(group.querySelector('.swatch.none')).not.toBeNull();
		expect(group.getAttribute('aria-describedby')).toBe('color-error color-hint');
		expect(group.getAttribute('aria-busy')).toBe('true');
		expect(document.getElementById('color-error')?.textContent).toContain('Ungültiger Wert.');
	});

	it('draws the swatches from the tokens and leaves the radios to base.css', () => {
		expect(choiceSource).toContain('colorVar(');
		expect(choiceSource).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
		expect(choiceSource).not.toMatch(/input[^{]*\{[^}]*(appearance|width|height)/);
	});
});

describe('color mark (ADR-0052)', () => {
	it('is a dot with the name as title and for screen readers', () => {
		render(ColorMark, { props: { shown: { color: 'gruen', origin: 'project', from: 'Garten' } } });
		const mark = document.querySelector<HTMLElement>('.color-mark') as HTMLElement;
		expect(mark.classList.contains('dot')).toBe(true);
		expect(mark.getAttribute('title')).toBe('Farbe Grün, vom Projekt „Garten“');
		expect(mark.textContent).toBe('Farbe Grün, vom Projekt „Garten“');
		expect(mark.getAttribute('aria-hidden')).toBeNull();
		expect(mark.style.getPropertyValue('--mark')).toBe('var(--project-color-gruen)');
	});

	it('is a stripe and hidden from screen readers when the owner names it', () => {
		render(ColorMark, {
			props: { shown: { color: 'braun', origin: 'own', from: null }, kind: 'stripe', named: false }
		});
		const mark = document.querySelector<HTMLElement>('.color-mark') as HTMLElement;
		expect(mark.classList.contains('stripe')).toBe(true);
		expect(mark.getAttribute('aria-hidden')).toBe('true');
		expect(mark.textContent).toBe('');
		expect(mark.getAttribute('title')).toBe('Farbe Braun');
	});

	it('never fills a surface: a small dot or a narrow stripe, the shape visible in forced colors', () => {
		expect(markSource).toMatch(/\.dot\s*\{[^}]*width:\s*0\.625rem/);
		expect(markSource).toMatch(/\.stripe\s*\{[^}]*width:\s*0\.25rem/);
		expect(markSource).toMatch(/border:\s*1px solid transparent/);
	});
});

const href = (project: Project) => `/projekte/${project.id}` as ResolvedPathname;

function rows(projects: Project[]): ProjectRow[] {
	return projects.map((project) => ({
		project,
		depth: project.parentId ? 1 : 0,
		context: false,
		childCount: projects.filter((other) => other.parentId === project.id).length,
		collapsed: false
	}));
}

describe('colors of projects in the list and in the tiles (ADR-0052)', () => {
	const numbers = {
		activeOf: () => 1,
		totalOf: () => 2,
		newOf: () => 0,
		hrefOf: href,
		menuOf: () => []
	};

	it('shows a dot before the name in the list, named after it; a sub project takes its parent', () => {
		render(ProjectTable, {
			props: { rows: rows([HOUSE, GARDEN, CAR]), onsort: vi.fn(), ...numbers }
		});
		const nameCell = (name: string) =>
			screen.getByRole('link', { name }).closest('th') as HTMLElement;
		const house = nameCell('Haus');
		expect(house.querySelector('.color-mark')?.getAttribute('title')).toBe('Farbe Blau');
		expect(house.querySelector('.color-mark')?.getAttribute('aria-hidden')).toBe('true');
		expect(within(house).getByText(', Farbe Blau')).toBeTruthy();
		const garden = nameCell('Garten');
		expect(garden.querySelector('.color-mark')?.getAttribute('title')).toBe(
			'Farbe Blau, vom Oberprojekt „Haus“'
		);
		expect(nameCell('Auto').querySelector('.color-mark')).toBeNull();
	});

	it('shows a dot before the name of a tile, named after the code', () => {
		render(ProjectTiles, { props: { rows: rows([HOUSE, CAR]), ...numbers } });
		const house = screen.getByRole('link', { name: /^Haus HAUS ?, Farbe Blau/ });
		expect(house.querySelector('.color-mark')?.getAttribute('title')).toBe('Farbe Blau');
		expect(
			screen.getByRole('link', { name: /^Auto AUTO/ }).querySelector('.color-mark')
		).toBeNull();
	});
});
