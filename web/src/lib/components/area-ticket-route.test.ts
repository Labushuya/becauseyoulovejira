// Component tests of a ticket in the areas projects, inbox and rules (ADR-0054): the same panel
// and full view as next to "Aufgaben", with the addresses of the area. The ticket replaces the
// panel it was opened from (`von`); × and the full view lead back there, else to the view, with
// the state of the view; the full view gives the focus to the link that opened the ticket (in the
// panel it came from, else in the view); a ticket that is gone leads back to the area; "Im
// Seitenpanel öffnen" stays in the area. Navigation and page state are mocked; the stores run on
// fake data layers.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
import { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import AreaTicketRouteHarness from '$lib/test/AreaTicketRouteHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import type { TicketArea } from '$lib/ticket-links';

const ID = 'abc123def456ghi';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	beforeNavigate: vi.fn(),
	page: {
		url: new URL('http://localhost:3000/'),
		params: { id: 'abc123def456ghi' } as Record<string, string>,
		route: { id: '' }
	},
	detail: null as unknown,
	activity: null as unknown,
	catalog: null as unknown,
	tickets: {
		markRead: vi.fn(async () => undefined),
		today: '2026-10-02',
		open: [] as unknown[],
		upsert: vi.fn(),
		find: () => null,
		subtasksOf: () => [],
		progressOf: () => ({ done: 0, total: 0 }),
		isChecked: () => false,
		isPending: () => false,
		setDone: vi.fn(async () => undefined),
		addSubtask: vi.fn(async () => ({ ok: false as const, message: null }))
	}
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto, beforeNavigate: mocks.beforeNavigate }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/stores/ticket-detail.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketDetailStore: () => mocks.detail
}));
vi.mock('$lib/stores/ticket-activity.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketActivityStore: () => mocks.activity
}));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => mocks.tickets
}));
vi.mock('$lib/stores/recurrence.svelte', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/stores/recurrence.svelte')>();
	const store = new original.RecurrenceStore(
		{
			listRules: async () => [],
			createRule: vi.fn(),
			updateRule: vi.fn(),
			setActive: vi.fn(),
			deleteRule: vi.fn(),
			detachTicket: vi.fn()
		},
		{ ensureValid: () => true, logout: vi.fn() }
	);
	return { ...original, getRecurrenceStore: () => store };
});
vi.mock('$lib/stores/ticket-sources.svelte', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/stores/ticket-sources.svelte')>();
	const store = new original.TicketSourcesStore(
		{ list: async () => [], link: vi.fn(), release: vi.fn(), originalUrl: async () => null },
		{ ensureValid: () => true, logout: vi.fn() }
	);
	return { ...original, getTicketSourcesStore: () => store };
});
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => ({ newItems: [] })
}));

useOverlayStubs();

/** Per area: the state of its view in the address, the panel a ticket replaced and the ways back. */
const AREAS: readonly {
	area: TicketArea;
	state: string;
	origin: string;
	back: string;
	view: string;
	label: string;
}[] = [
	{
		area: 'projekte',
		state: 'darstellung=kacheln',
		origin: 'proj00000000001',
		back: '/projekte/proj00000000001?darstellung=kacheln',
		view: '/projekte?darstellung=kacheln',
		label: 'Zu den Projekten'
	},
	{
		area: 'eingang',
		state: 'zustand=verworfen',
		origin: 'item00000000001',
		back: '/eingang/item00000000001?zustand=verworfen',
		view: '/eingang?zustand=verworfen',
		label: 'Zum Eingang'
	},
	{
		area: 'wiederholungen',
		state: '',
		origin: 'rule00000000001',
		back: '/wiederholungen/rule00000000001',
		view: '/wiederholungen',
		label: 'Zu den Wiederholungen'
	}
];

function ticket(): Ticket {
	return {
		id: ID,
		key: 'HAUS-3',
		title: 'Dachrinne',
		description: '',
		sourceItem: null,
		status: 'open',
		priority: 'high',
		due: '2026-10-07',
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-02 12:30:00.000Z'
	};
}

function detailStore(get: () => Promise<Ticket> = async () => ticket()) {
	const data = {
		get: vi.fn(get),
		update: vi.fn(),
		create: vi.fn(),
		delete: vi.fn()
	} satisfies TicketDetailData;
	const listTickets = new SvelteMap<string, TicketSummary>();
	const list = {
		find: (id: string) => listTickets.get(id) ?? null,
		upsert: vi.fn(),
		completed: vi.fn(),
		remove: vi.fn(),
		announce: vi.fn()
	} satisfies TicketListSync;
	return new TicketDetailStore(data, { ensureValid: () => true, logout: vi.fn() }, list);
}

function openModeStore(stored: string | null) {
	if (stored === null) localStorage.removeItem('byl-ticket-open');
	else localStorage.setItem('byl-ticket-open', stored);
	const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
	const win = {
		localStorage,
		matchMedia: () => media,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as Window;
	return new TicketOpenModeStore(win);
}

/** Query of a ticket of the area: the state of the view, then `von` with an origin. */
function query(state: string, origin: string | null): string {
	const parts = [state, origin === null ? '' : `von=${origin}`].filter((part) => part !== '');
	return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

/** Sets the address of the panel (or the full view) of the ticket in `area`. */
function at(area: TicketArea, search: string, full = false) {
	const path = `/${area}/tickets/${ID}${full ? '/voll' : ''}`;
	mocks.page.url = new URL(`http://localhost:3000${path}${search}`);
	mocks.page.route = { id: `/(app)/${area}/tickets/[id]${full ? '/voll' : ''}` };
}

beforeEach(() => {
	mocks.goto.mockClear();
	mocks.catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		{ ensureValid: () => true, logout: vi.fn() }
	);
	mocks.activity = new TicketActivityStore(
		{
			listComments: vi.fn(async () => []),
			createComment: vi.fn(),
			updateComment: vi.fn(),
			deleteComment: vi.fn(),
			listHistory: vi.fn(async () => [])
		},
		{ ensureValid: () => true, logout: vi.fn() },
		() => 'me'
	);
});

afterEach(() => {
	localStorage.clear();
});

describe.each(AREAS)('a ticket in the area $area (ADR-0054)', (entry) => {
	const { area, state, origin, back, view, label } = entry;

	it('replaces the panel it came from; × leads back there with the state of the view', async () => {
		at(area, query(state, origin));
		const store = detailStore();
		mocks.detail = store;
		render(AreaTicketRouteHarness, { props: { area, entry: ID } });
		await vi.waitFor(() => expect(store.state).toBe('ready'));

		const full = await screen.findByRole('link', { name: 'Vollansicht öffnen' });
		expect(full.getAttribute('href')).toBe(`/${area}/tickets/${ID}/voll${query(state, origin)}`);
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(mocks.goto).toHaveBeenCalledWith(back);
	});

	it('leads to the view without a panel it came from (a deep link)', async () => {
		at(area, query(state, null));
		const store = detailStore();
		mocks.detail = store;
		render(AreaTicketRouteHarness, { props: { area, entry: ID } });
		await vi.waitFor(() => expect(store.state).toBe('ready'));

		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(mocks.goto).toHaveBeenCalledWith(view);
	});

	it(`leads "${label}" when the ticket is gone`, async () => {
		at(area, query(state, origin));
		mocks.detail = detailStore(async () => {
			throw new DataError('not_found');
		});
		render(AreaTicketRouteHarness, { props: { area, entry: ID } });

		const link = await screen.findByRole('link', { name: label });
		expect(link.getAttribute('href')).toBe(back);
	});

	it('shows the full view in the area; closing gives the focus to the link in the panel', async () => {
		at(area, query(state, origin), true);
		const store = detailStore();
		mocks.detail = store;
		const openMode = openModeStore('full');
		render(AreaTicketRouteHarness, {
			props: { area, entry: ID, full: true, openMode, inPanel: true }
		});
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		await tick();

		const dialog = screen.getByRole('dialog', { name: 'HAUS-3 · Dachrinne' });
		expect(screen.queryByRole('link', { name: 'Vollansicht öffnen' })).toBeNull();
		const panel = within(dialog).getByRole('link', { name: 'Im Seitenpanel öffnen' });
		expect(panel.getAttribute('href')).toBe(`/${area}/tickets/${ID}${query(state, origin)}`);
		await fireEvent.click(within(dialog).getAllByRole('button', { name: 'Schließen' })[0]!);
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(back, { noScroll: true }));
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Link im Panel' }))
		);
	});

	it('closing the full view of a deep link gives the focus to the link in the view', async () => {
		at(area, query(state, null), true);
		const store = detailStore();
		mocks.detail = store;
		const openMode = openModeStore('full');
		render(AreaTicketRouteHarness, {
			props: { area, entry: ID, full: true, openMode, inPanel: true }
		});
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		await tick();

		const dialog = screen.getByRole('dialog', { name: 'HAUS-3 · Dachrinne' });
		await fireEvent.click(within(dialog).getAllByRole('button', { name: 'Schließen' })[0]!);
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith(view, { noScroll: true }));
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Link in der Ansicht' }))
		);
	});
});
