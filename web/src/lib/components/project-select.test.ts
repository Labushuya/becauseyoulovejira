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

function show(props: Partial<{ value: string; current: ProjectRef | null }> = {}) {
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

		await fireEvent.change(select, { target: { value: GARDEN.id } });
		expect(onchoose).toHaveBeenCalledWith(GARDEN.id);
	});
});
