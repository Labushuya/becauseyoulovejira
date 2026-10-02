// Route test of the calendar (ADR-0053, plan kalender, K-1): the calendar under /kalender, the panel
// of a ticket next to it under /kalender/tickets/<id> (embedded like next to "Aufgaben"), the links of
// the entries that stay in the calendar, the question of "In den Papierkorb …" from the menu of an
// entry as a dialog of the layout, which closes the panel of that ticket, and the done tickets that
// load only while their layer is on. Navigation, page state and the data layers are fakes; the
// stores are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import {
	TicketRowActionsStore,
	type TicketRowActionsData
} from '$lib/stores/ticket-row-actions.svelte';
import CalendarRouteHarness from '$lib/test/CalendarRouteHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useResizeObserverStub } from '$lib/test/resize-observer-stub';

const T0 = '2026-09-24 08:00:00.000Z';
const NOW = Date.parse('2026-10-02T10:00:00Z');
const ID = 't00000000000001';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: {
		url: new URL('http://localhost:3000/kalender'),
		params: {} as Record<string, string>,
		route: { id: '/(app)/kalender' }
	},
	catalog: null as unknown,
	tickets: null as unknown,
	listDone: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/auth.svelte', () => ({ auth: { ensureValid: () => true, logout: vi.fn() } }));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => mocks.tickets
}));
vi.mock('$lib/stores/recurrence.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getRecurrenceStore: () => ({ rules: [] })
}));
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => ({ newItems: [], newCount: 0 })
}));
vi.mock('$lib/stores/calendar.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	calendarDoneData: () => ({ listDone: mocks.listDone })
}));
vi.mock('$lib/stores/realtime', async (importOriginal) => ({
	...(await importOriginal<object>()),
	liveSource: () => new Proxy({}, { get: () => async () => async () => undefined })
}));

useOverlayStubs();
useResizeObserverStub();

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: ID,
		key: 'HAUS-1',
		title: 'Dach',
		status: 'open',
		priority: 'medium',
		due: '2026-10-07',
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: T0,
		updated: T0,
		...overrides
	};
}

interface Setup {
	open?: TicketSummary[];
	rowData?: TicketRowActionsData | null;
}

async function show(path: string, { open = [ticket()], rowData = null }: Setup = {}) {
	const url = new URL(path, 'http://localhost:3000');
	mocks.page.url = url;
	const id = /^\/kalender\/tickets\/([a-z0-9]{15})$/.exec(url.pathname)?.[1];
	mocks.page.params = id ? { id } : {};
	mocks.page.route = { id: id ? '/(app)/kalender/tickets/[id]' : '/(app)/kalender' };
	const session = { ensureValid: () => true, logout: vi.fn() };
	const catalog = new CatalogStore(
		{ listProjects: async () => [], listTags: async () => [], createTag: vi.fn() },
		session
	);
	await catalog.load();
	const tickets = new TicketListStore(
		{
			listOpen: async () => open,
			listDone: async (page: number) => ({ items: [], page, hasMore: false }),
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(),
			update: vi.fn()
		},
		session,
		{ now: () => NOW }
	);
	mocks.catalog = catalog;
	mocks.tickets = tickets;
	const rowActions =
		rowData === null ? null : new TicketRowActionsStore(rowData, session, tickets, null);
	render(CalendarRouteHarness, { props: { panel: id !== undefined, rowActions } });
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { tickets };
}

const entryLink = () =>
	within(screen.getByRole('grid')).getByRole('link', { name: /^HAUS-1 Dach/ });

beforeEach(() => {
	mocks.goto.mockClear();
	mocks.listDone.mockReset();
	mocks.listDone.mockResolvedValue({ items: [], hasMore: false });
	document.body.innerHTML = '';
	localStorage.clear();
});

describe('calendar route', () => {
	it('shows the calendar without a panel, its tickets leading to their panel next to it', async () => {
		await show('/kalender?ansicht=monat');

		expect(screen.getByRole('heading', { level: 2, name: 'Kalender' })).toBeTruthy();
		expect(document.querySelector('.view')?.hasAttribute('data-panel-mode')).toBe(false);
		expect(entryLink().getAttribute('href')).toBe(`/kalender/tickets/${ID}?ansicht=monat`);
		const nav = screen.getByRole('navigation', { name: 'Ansicht' });
		expect(within(nav).getByRole('link', { name: 'Kalender' }).getAttribute('aria-current')).toBe(
			'page'
		);
		expect(mocks.listDone).not.toHaveBeenCalled();
	});

	it('opens the panel of a ticket next to the calendar and marks its entry', async () => {
		await show(`/kalender/tickets/${ID}`);

		expect(document.querySelector('.view')?.getAttribute('data-panel-mode')).toBe('embedded');
		expect(screen.getByRole('complementary', { name: 'Panel des Tickets' })).toBeTruthy();
		expect(entryLink().getAttribute('aria-current')).toBe('true');
	});

	it('asks "In den Papierkorb …" of an entry as a dialog and closes the panel of that ticket', async () => {
		const rowData: TicketRowActionsData = {
			get: vi.fn<TicketRowActionsData['get']>(),
			sources: vi.fn(async () => []),
			commentCount: vi.fn(async () => 0),
			delete: vi.fn(async () => null)
		};
		await show(`/kalender/tickets/${ID}?prio=medium`, { rowData });
		const button = within(entryLink().closest('li')!).getByRole('button', {
			hidden: true,
			name: 'Weitere Aktionen für HAUS-1'
		});
		await fireEvent.click(button);
		const menu = document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
		await fireEvent.click(
			within(menu).getByRole('menuitem', { name: 'In den Papierkorb …', hidden: true })
		);

		const dialog = await screen.findByRole('dialog', {
			name: 'HAUS-1 in den Papierkorb verschieben?'
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'In den Papierkorb' }));
		await vi.waitFor(() => expect(rowData.delete).toHaveBeenCalledExactlyOnceWith(ID, 'inbox'));
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/kalender?prio=medium'));
	});

	it('loads the done tickets of the period once their layer is on', async () => {
		localStorage.setItem('byl-calendar-layers', 'offen,erledigt');
		await show('/kalender');

		await vi.waitFor(() =>
			expect(mocks.listDone).toHaveBeenCalledWith(
				{ from: '2026-09-28', to: '2026-11-01' },
				1,
				expect.anything()
			)
		);
	});
});
