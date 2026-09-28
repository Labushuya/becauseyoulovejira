// Project choice of a ticket (E3 plan, T-13) with sub projects (ADR-0034, UP-5): the native select
// in tree order, sub projects as "Haus › Garten (GART)", an archived current project kept visible.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectRef } from '$lib/domain/ticket';
import ProjectSelect from './ProjectSelect.svelte';

const HOUSE: ProjectRef = { id: 'proj00000000001', name: 'Haus', code: 'HAUS', archived: false };
const GARDEN: ProjectRef = {
	id: 'proj00000000011',
	name: 'Garten',
	code: 'GART',
	archived: false,
	parent: { id: HOUSE.id, name: 'Haus', code: 'HAUS' }
};
const CAR: ProjectRef = { id: 'proj00000000002', name: 'Auto', code: 'AUTO', archived: false };

function show(props: Partial<{ value: string; current: ProjectRef | null; hint: string }> = {}) {
	const onchoose = vi.fn();
	render(ProjectSelect, {
		props: {
			id: 'project',
			value: '',
			// As the catalog delivers the choosable projects: in tree order.
			projects: [CAR, HOUSE, GARDEN],
			errorId: 'project-error',
			hintId: 'project-hint',
			onchoose,
			...props
		}
	});
	return { onchoose, select: screen.getByRole<HTMLSelectElement>('combobox') };
}

describe('project select with sub projects (ADR-0034)', () => {
	it('names a sub project with its path and keeps the tree order', () => {
		const { select } = show({ value: GARDEN.id });
		expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
			'Kein Projekt',
			'Auto (AUTO)',
			'Haus (HAUS)',
			'Haus › Garten (GART)'
		]);
		expect(select.value).toBe(GARDEN.id);
	});

	it('keeps an archived current sub project visible with its path', async () => {
		const archived: ProjectRef = {
			...GARDEN,
			id: 'proj00000000012',
			name: 'Dach',
			code: 'DACH',
			archived: true
		};
		const { select, onchoose } = show({ value: archived.id, current: archived });
		expect(select.selectedOptions[0]?.textContent?.trim()).toBe('Haus › Dach (DACH, archiviert)');

		expect(select.title).toBe('Haus › Dach (DACH, archiviert)');

		await fireEvent.change(select, { target: { value: GARDEN.id } });
		expect(onchoose).toHaveBeenCalledWith(GARDEN.id);
	});

	// A long label may end in an ellipsis (base.css, docs/plan/layout-ueberlauf.md); the title
	// shows it whole, and the value of the select keeps it whole for screen readers.
	it('shows the whole label of the chosen project as title, none for "Kein Projekt"', () => {
		const { select } = show({ value: GARDEN.id });
		expect(select.title).toBe('Haus › Garten (GART)');
		expect(select.selectedOptions[0]?.textContent?.trim()).toBe(select.title);
	});

	it('has no title while no project is chosen', () => {
		const { select } = show();
		expect(select.hasAttribute('title')).toBe(false);
	});
});

// A caller with its own words passes them as `hint`; a second hint of its own with `hintId` would
// double the ID, and `aria-describedby` would name only one of the two.
describe('hint of the project select', () => {
	it('renders one hint with the given text and points aria-describedby at it', () => {
		const { select } = show({ hint: 'Der alte Key bleibt im Verlauf.' });
		expect(document.querySelectorAll('#project-hint')).toHaveLength(1);
		expect(select.getAttribute('aria-describedby')).toBe('project-hint');
		expect(document.getElementById('project-hint')?.textContent).toBe(
			'Der alte Key bleibt im Verlauf.'
		);
		expect(screen.queryByText('Beim Wechsel bekommt das Ticket einen neuen Key.')).toBeNull();
	});

	it('says by default that a change gives the ticket a new key', () => {
		show();
		expect(document.getElementById('project-hint')?.textContent).toBe(
			'Beim Wechsel bekommt das Ticket einen neuen Key.'
		);
	});
});
