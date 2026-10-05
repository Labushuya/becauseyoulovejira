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
// The rows name the rhythm of recurring tickets (E5 plan, package 4).
vi.mock('$lib/stores/recurrence.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getRecurrenceStore: () => ({ textOf: () => '' })
}));

function renderLayout(path: string, id?: string, route = '/(app)/(tickets)/tickets/[id]') {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	mocks.page.params = id ? { id } : {};
	mocks.page.route = { id: id ? route : '/(app)/(tickets)' };
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

	// Since UI-8 the section bar with the switch comes first, as in the projects and the inbox; the
	// filter cards (FI-1, before the KPI tiles), the filter bar and with a chosen card the summary
	// follow it (ADR-0025 section 10).
	it('shows the section bar, the filter cards, the filter bar, the summary and the table, in this order', async () => {
		renderLayout('/?karte=heute&faellig=heute');
		await vi.waitFor(() =>
			expect(screen.getByRole('button', { name: 'Alle offenen: 0' })).toBeTruthy()
		);

		const heading = screen.getByRole('heading', { name: 'Aufgaben' });
		const views = screen.getByRole('navigation', { name: 'Ansicht' });
		const cards = screen.getByRole('group', { name: 'Filter-Karten' });
		const filters = screen.getByRole('region', { name: 'Filter' });
		const summary = screen.getByText('0 Tickets aus: Heute fällig – weitere Filter aktiv');
		const section = screen.getByRole('region', { name: 'Aufgaben' });
		const order = [heading, views, cards, filters, summary];
		for (const [index, element] of order.slice(1).entries()) {
			expect(
				(order[index] as HTMLElement).compareDocumentPosition(element) &
					Node.DOCUMENT_POSITION_FOLLOWING
			).toBeTruthy();
		}
		expect(section.firstElementChild?.classList.contains('section-bar')).toBe(true);
		expect(section.firstElementChild?.contains(views)).toBe(true);
		expect(
			screen.getByRole('button', { name: 'Heute fällig: 0' }).getAttribute('aria-pressed')
		).toBe('true');
		expect(
			screen.getByRole('button', { name: 'Alle offenen: 0' }).getAttribute('aria-pressed')
		).toBe('false');
	});

	it('shows done tickets when the URL says so (reload, back and forward)', () => {
		const { activate, store } = renderLayout(
			'/tickets/abc123def456ghi?erledigte=1',
			'abc123def456ghi'
		);

		expect(activate).toHaveBeenCalledExactlyOnceWith({ ...EMPTY_LIST_QUERY, showDone: true });
		expect(store.showDone).toBe(true);
	});

	// The full view replaces the panel (plan BI-1): the list keeps its full width behind the
	// modal, and the route content (the modal) still renders.
	it('shows no panel column while the full view is open', () => {
		renderLayout(
			'/tickets/abc123def456ghi/voll',
			'abc123def456ghi',
			'/(app)/(tickets)/tickets/[id]/voll'
		);
		const view = document.querySelector('.view');
		expect(view?.classList.contains('with-panel')).toBe(false);
		expect(view?.getAttribute('data-panel-mode')).toBeNull();
		expect(screen.getByText('Panel')).toBeTruthy();
	});

	it('shows the panel column for a ticket in the panel', () => {
		renderLayout('/tickets/abc123def456ghi', 'abc123def456ghi');
		const view = document.querySelector('.view');
		expect(view?.classList.contains('with-panel')).toBe(true);
		expect(view?.getAttribute('data-panel-mode')).toBe('embedded');
	});
});
