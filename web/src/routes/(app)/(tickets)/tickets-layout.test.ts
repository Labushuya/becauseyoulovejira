// Component test for the tickets layout (E2 plan, T-4 and T-5; E3 plan, package 5): the table
// follows the list state in the URL, and the panel area renders the child page next to it. Since
// ER-1 (ADR-0066) "Aufgaben" shows only open work: the link "Erledigte ansehen →" takes the
// filters both views know along, and +layout.ts leads old addresses that asked for done tickets to
// "Erledigte".

import { isRedirect } from '@sveltejs/kit';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import Layout from './+layout.svelte';
import { load } from './+layout';

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

const PROJECT = 'proj00000000001';
const TAG = 'tag000000000001';

/** The address the load of the layout leads to, null where it lets the address be. */
function redirectOf(path: string): string | null {
	try {
		void load({ url: new URL(path, 'http://localhost:3000') } as Parameters<typeof load>[0]);
		return null;
	} catch (error) {
		if (isRedirect(error)) return error.location;
		throw error;
	}
}

describe('tickets layout', () => {
	it('loads the list of open tickets by default', () => {
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

	it('shows only open work and links to "Erledigte" with the filters both views know', async () => {
		renderLayout(`/?prio=high&projekt=${PROJECT}&tag=${TAG}&q=Miete&gruppe=prio`);

		expect(screen.queryByRole('switch', { name: 'Erledigte anzeigen' })).toBeNull();
		const link = screen.getByRole('link', { name: 'Erledigte ansehen' });
		expect(link.getAttribute('href')).toBe(`/erledigt?projekt=${PROJECT}&tag=${TAG}&q=Miete`);
		// The status "Erledigt" is no filter of "Aufgaben" any more.
		const status = screen.getByRole('group', { name: 'Status' });
		expect(status.textContent).not.toContain('Erledigt');
	});

	it('leads old addresses that asked for done tickets to "Erledigte" (ADR-0066 §5)', () => {
		expect(redirectOf(`/?erledigte=1&projekt=${PROJECT}&sort=titel`)).toBe(
			`/erledigt?projekt=${PROJECT}`
		);
		expect(redirectOf(`/tickets/abc123def456ghi?status=done&tag=${TAG}`)).toBe(
			`/erledigt/tickets/abc123def456ghi?tag=${TAG}`
		);
		expect(redirectOf('/tickets/abc123def456ghi/voll?erledigte=1')).toBe(
			'/erledigt/tickets/abc123def456ghi/voll'
		);
		expect(redirectOf('/?status=open&erledigte=1')).toBe('/?status=open');
		expect(redirectOf('/?status=open&gruppe=prio')).toBeNull();
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
