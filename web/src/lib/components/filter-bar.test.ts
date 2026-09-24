// Component tests for the filter bar (E3 plan, T-6 and package 10): chip groups as fieldset with
// radio inputs, project and tag selects from the catalog, "Zurücksetzen", and the state in the
// URL (each change navigates with the new query; view settings stay). SvelteKit navigation and
// page state are mocked; the catalog runs for real on a fake data layer.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import FilterBar from './FilterBar.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const UPDATED = '2026-09-01 10:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false,
	updated: UPDATED
};
const OLD: Project = {
	id: 'proj00000000002',
	name: 'Umzug',
	code: 'UMZ',
	archived: true,
	updated: UPDATED
};
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: UPDATED };

async function showBar(path = '/') {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => [HOUSE, OLD]),
			listTags: vi.fn(async () => [GARDEN]),
			createTag: vi.fn()
		},
		SESSION
	);
	await catalog.load();
	return render(FilterBar, { props: { catalog } });
}

/** Target of the last navigation as path plus query. */
function lastTarget(): string {
	const call = mocks.goto.mock.calls.at(-1) as unknown[] | undefined;
	return String(call?.[0]);
}

function group(name: string) {
	return screen.getByRole('group', { name });
}

beforeEach(() => {
	mocks.goto.mockClear();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('filter bar', () => {
	it('shows the chip groups as fieldsets with radio inputs, "Alle" chosen', async () => {
		await showBar();

		expect(screen.getByRole('region', { name: 'Filter' })).toBeTruthy();
		const status = within(group('Status'));
		expect(
			status.getAllByRole('radio').map((radio) => radio.parentElement?.textContent?.trim())
		).toEqual(['Alle', 'Backlog', 'Offen', 'In Arbeit', 'Wartet', 'Erledigt']);
		expect(status.getByRole('radio', { name: 'Alle' })).toHaveProperty('checked', true);
		expect(
			within(group('Priorität'))
				.getAllByRole('radio')
				.map((radio) => radio.parentElement?.textContent?.trim())
		).toEqual(['Alle', 'Dringend', 'Hoch', 'Mittel', 'Niedrig']);
		expect(
			within(group('Fällig'))
				.getAllByRole('radio')
				.map((radio) => radio.parentElement?.textContent?.trim())
		).toEqual(['Alle', 'Überfällig', 'Heute', 'Bald', 'Ohne Datum']);
	});

	it.each([
		['Status', 'In Arbeit', '/?status=in_progress'],
		['Status', 'Erledigt', '/?status=done'],
		['Priorität', 'Dringend', '/?prio=urgent'],
		['Fällig', 'Überfällig', '/?faellig=ueberfaellig'],
		['Fällig', 'Bald', '/?faellig=bald'],
		['Fällig', 'Ohne Datum', '/?faellig=ohne']
	])('group %s, chip %s sets %s', async (legend, chip, target) => {
		await showBar();

		await fireEvent.click(within(group(legend)).getByRole('radio', { name: chip }));

		expect(mocks.goto).toHaveBeenCalledOnce();
		expect(lastTarget()).toBe(target);
		expect(mocks.goto).toHaveBeenCalledWith(target, { keepFocus: true, noScroll: true });
	});

	it('marks the chosen chip and removes the parameter with "Alle"', async () => {
		await showBar('/?prio=high&faellig=heute');

		const priority = within(group('Priorität'));
		const high = priority.getByRole('radio', { name: 'Hoch' });
		expect(high).toHaveProperty('checked', true);
		expect(high.parentElement?.querySelector('svg')).not.toBeNull();

		await fireEvent.click(priority.getByRole('radio', { name: 'Alle' }));
		expect(lastTarget()).toBe('/?faellig=heute');
	});

	it('keeps the panel path and unknown parameters when filtering', async () => {
		await showBar('/tickets/abc123def456ghi?x=1&erledigte=1');

		await fireEvent.click(within(group('Status')).getByRole('radio', { name: 'Offen' }));

		expect(lastTarget()).toBe('/tickets/abc123def456ghi?x=1&status=open&erledigte=1');
	});

	it('offers the projects with "Ohne Projekt" and the archived ones in their own group', async () => {
		await showBar('/?projekt=ohne');

		const select = screen.getByRole('combobox', { name: 'Projekt' }) as HTMLSelectElement;
		expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
			'Alle',
			'Ohne Projekt',
			'Haushalt (HAUS)',
			'Umzug (UMZ)'
		]);
		expect(select.querySelector('optgroup')?.label).toBe('Archiviert');
		expect(select.value).toBe('ohne');

		await fireEvent.change(select, { target: { value: HOUSE.id } });
		expect(lastTarget()).toBe(`/?projekt=${HOUSE.id}`);
		await fireEvent.change(select, { target: { value: '' } });
		expect(lastTarget()).toBe('/');
	});

	it('sets the tag filter from the catalog', async () => {
		await showBar();

		const select = screen.getByRole('combobox', { name: 'Tag' }) as HTMLSelectElement;
		expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
			'Alle',
			'Garten'
		]);
		await fireEvent.change(select, { target: { value: GARDEN.id } });
		expect(lastTarget()).toBe(`/?tag=${GARDEN.id}`);
	});

	it('shows an unknown project or tag of the URL as chosen', async () => {
		await showBar('/?projekt=zzzzzzzzzzzzzzz&tag=yyyyyyyyyyyyyyy');

		const project = screen.getByRole('combobox', { name: 'Projekt' }) as HTMLSelectElement;
		const tag = screen.getByRole('combobox', { name: 'Tag' }) as HTMLSelectElement;
		expect(project.value).toBe('zzzzzzzzzzzzzzz');
		expect(project.selectedOptions[0]?.textContent?.trim()).toBe('Unbekannt');
		expect(tag.selectedOptions[0]?.textContent?.trim()).toBe('Unbekannt');
	});

	it('resets the filters but keeps sort, grouping and the switch', async () => {
		await showBar(
			`/?status=open&prio=urgent&faellig=heute&projekt=${HOUSE.id}&tag=${GARDEN.id}&sort=-titel&gruppe=prio&erledigte=1`
		);

		const reset = screen.getByRole('button', { name: 'Zurücksetzen' });
		expect(reset.getAttribute('aria-disabled')).toBeNull();
		await fireEvent.click(reset);

		expect(lastTarget()).toBe('/?sort=-titel&gruppe=prio&erledigte=1');
	});

	it('locks "Zurücksetzen" without a filter', async () => {
		await showBar('/?sort=titel');

		const reset = screen.getByRole('button', { name: 'Zurücksetzen' });
		expect(reset.getAttribute('aria-disabled')).toBe('true');
		expect(reset.getAttribute('aria-describedby')).toBeTruthy();
		expect(
			document.getElementById(String(reset.getAttribute('aria-describedby')))?.textContent
		).toBe('Kein Filter gesetzt.');
		await fireEvent.click(reset);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('moves within a chip group with the arrow keys of the radio inputs', async () => {
		await showBar();

		const radios = within(group('Status')).getAllByRole('radio') as HTMLInputElement[];
		// Native radio inputs of one name form one tab stop; the browser moves with the arrows.
		expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
		expect(radios.every((radio) => radio.type === 'radio' && radio.tabIndex === 0)).toBe(true);
		const names = new Set(
			(screen.getAllByRole('radio') as HTMLInputElement[]).map((radio) => radio.name)
		);
		expect(names.size).toBe(3);
	});
});
