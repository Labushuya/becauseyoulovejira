// Component test for the tickets layout (E2 plan, T-4 and T-5; E3 plan, package 5): the table
// follows the switch in the URL, and the panel area renders the child page next to it.

import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import Layout from './+layout.svelte';

const mocks = vi.hoisted(() => ({
	page: {
		url: new URL('http://localhost:3000/'),
		params: {} as Record<string, string>,
		route: { id: '/(app)/(tickets)' }
	},
	store: null as unknown,
	catalog: null as unknown
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => mocks.store
}));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
// The switch shows the number of new inbox entries (E4 plan, package 3).
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => ({ newCount: 2 })
}));

function renderLayout(path: string, id?: string) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	mocks.page.params = id ? { id } : {};
	mocks.page.route = { id: id ? '/(app)/(tickets)/tickets/[id]' : '/(app)/(tickets)' };
	const store = new TicketListStore(
		{
			listOpen: vi.fn(async () => []),
			listDone: vi.fn(async (page: number) => ({ items: [], page, hasMore: false })),
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(),
			update: vi.fn()
		},
		{ ensureValid: () => true, logout: vi.fn() }
	);
	const activate = vi.spyOn(store, 'activate');
	mocks.store = store;
	mocks.catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		{ ensureValid: () => true, logout: vi.fn() }
	);
	const children = createRawSnippet(() => ({ render: () => '<p>Panel</p>' }));
	render(Layout, { props: { children } });
	return { store, activate };
}

describe('tickets layout', () => {
	it('loads the list without done tickets by default', () => {
		const { activate } = renderLayout('/');

		expect(activate).toHaveBeenCalledExactlyOnceWith(EMPTY_LIST_QUERY);
		expect(screen.getByRole('heading', { name: 'Aufgaben' })).toBeTruthy();
		expect(screen.getByText('Panel')).toBeTruthy();
	});

	it('shows the KPI tiles and the filter bar above the table, in this order', async () => {
		renderLayout('/?faellig=heute');
		await vi.waitFor(() =>
			expect(screen.getByRole('button', { name: '0 nicht erledigt' })).toBeTruthy()
		);

		const tiles = screen.getByRole('group', { name: 'Kennzahlen' });
		const filters = screen.getByRole('region', { name: 'Filter' });
		const heading = screen.getByRole('heading', { name: 'Aufgaben' });
		expect(tiles.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(
			filters.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			screen.getByRole('button', { name: '0 heute fällig' }).getAttribute('aria-pressed')
		).toBe('true');
	});

	it('shows done tickets when the URL says so (reload, back and forward)', () => {
		const { activate, store } = renderLayout(
			'/tickets/abc123def456ghi?erledigte=1',
			'abc123def456ghi'
		);

		expect(activate).toHaveBeenCalledExactlyOnceWith({ ...EMPTY_LIST_QUERY, showDone: true });
		expect(store.showDone).toBe(true);
	});
});
