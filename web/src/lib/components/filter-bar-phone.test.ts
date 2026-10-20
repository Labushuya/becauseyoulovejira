// The parts of the filter bar and of "Gruppieren" for the phone frame (MO-3, ADR-0073 addendum MO-3):
// the search alone for the row of the view, the chip groups and choices without search and
// "Zurücksetzen" for the filter sheet, "Gruppieren" without its button inside the sheet. Same state,
// same rules: every choice navigates as on the PC. The bar of the PC ("bar") keeps its tests in
// filter-bar.test.ts and group-popover.test.ts.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import FilterBar from './FilterBar.svelte';
import GroupPopover from './GroupPopover.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const UPDATED = '2026-09-01 10:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false,
	updated: UPDATED
};
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: UPDATED };

async function showPart(part: 'search' | 'filters', path = '/', searchError: string | null = null) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => [HOUSE]),
			listTags: vi.fn(async () => [GARDEN]),
			createTag: vi.fn()
		},
		SESSION
	);
	await catalog.load();
	return render(FilterBar, { props: { catalog, part, searchError } });
}

beforeEach(() => {
	mocks.goto.mockClear();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('filter bar in parts for the phone frame (MO-3)', () => {
	it('shows only the search for the row of the view, with the same rules', async () => {
		const { container } = await showPart('search', '/?prio=high');

		expect(container.querySelector('.list-search')).not.toBeNull();
		expect(container.querySelector('.filter-bar')).toBeNull();
		expect(screen.queryAllByRole('group')).toHaveLength(0);
		expect(screen.queryByRole('button', { name: /^Projekt:/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Zurücksetzen' })).toBeNull();

		const field = screen.getByRole('searchbox', { name: 'Suche' });
		expect(field.getAttribute('enterkeyhint')).toBe('search');
		await fireEvent.input(field, { target: { value: 'Fenster' } });
		expect(mocks.goto).toHaveBeenCalledWith('/?prio=high&q=Fenster', {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	});

	it('names the failure of the search below the field', async () => {
		await showPart('search', '/?q=Fenster', 'Keine Verbindung.');

		const alert = screen.getByRole('alert');
		expect(alert.textContent).toContain('Die Suche ist fehlgeschlagen. Keine Verbindung.');
		expect(
			screen.getByRole('searchbox', { name: 'Suche' }).getAttribute('aria-describedby')
		).toContain(alert.id);
	});

	it('shows the chip groups and the choices for the filter sheet, without search and "Zurücksetzen"', async () => {
		const { container } = await showPart('filters');

		expect(container.querySelector('.filter-fields')).not.toBeNull();
		expect(container.querySelector('[data-tour]')).toBeNull();
		expect(screen.queryByRole('searchbox')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Zurücksetzen' })).toBeNull();
		for (const name of ['Status', 'Priorität', 'Fällig', 'Quelle', 'Wiederkehrend', 'Art']) {
			expect(screen.getByRole('group', { name })).toBeTruthy();
		}
		expect(screen.getByRole('button', { name: /^Projekt:/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^Tag:/ })).toBeTruthy();

		await fireEvent.click(
			within(screen.getByRole('group', { name: 'Priorität' })).getByRole('radio', { name: 'Hoch' })
		);
		expect(mocks.goto).toHaveBeenCalledWith('/?prio=high', { keepFocus: true, noScroll: true });
	});
});

describe('"Gruppieren" inside the filter sheet (MO-3)', () => {
	it('shows both levels without the button and the popover; a choice navigates', async () => {
		mocks.page.url = new URL('/?gruppe=prio', 'http://localhost:3000');
		const { container } = render(GroupPopover, { props: { inline: true } });

		expect(container.querySelector('[popover]')).toBeNull();
		expect(screen.queryByRole('button')).toBeNull();
		const first = screen.getByRole('group', { name: 'Gruppieren' });
		expect(within(first).getByRole('radio', { name: 'Nach Priorität' })).toHaveProperty(
			'checked',
			true
		);
		const second = screen.getByRole('group', { name: 'Danach gruppieren' });
		expect(second).toHaveProperty('disabled', false);

		await fireEvent.click(within(first).getByRole('radio', { name: 'Nach Projekt' }));
		expect(mocks.goto).toHaveBeenCalledWith('/?gruppe=projekt', {
			keepFocus: true,
			noScroll: true
		});
	});
});
