// Component tests of a ticket next to the calendar (ADR-0053 §6): the same panel and full view as
// next to "Aufgaben", with the addresses of the calendar. Closing returns to the calendar with its
// view and filters, the full view gives the focus to the entry of the ticket, "Im Seitenpanel öffnen"
// stays in the calendar, a ticket that is gone leads "Zum Kalender", and the hosts name the entries
// of list and calendar. Navigation and page state are mocked; the stores run on fake data layers.

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
import CalendarTicketRouteHarness from '$lib/test/CalendarTicketRouteHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { CALENDAR_HOST, LIST_HOST } from '$lib/ticket-host';

const ID = 'abc123def456ghi';
const QUERY = '?ansicht=woche&prio=high';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	beforeNavigate: vi.fn(),
	page: {
		url: new URL('http://localhost:3000/kalender/tickets/abc123def456ghi?ansicht=woche&prio=high'),
		params: { id: 'abc123def456ghi' } as Record<string, string>,
		route: { id: '/(app)/kalender/tickets/[id]' }
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
	mocks.page.route = { id: '/(app)/kalender/tickets/[id]' };
	mocks.page.url = new URL(`http://localhost:3000/kalender/tickets/${ID}${QUERY}`);
	localStorage.clear();
});

describe('a ticket next to the calendar', () => {
	it('opens in the panel and closes back to the calendar with its view and filters', async () => {
		const store = detailStore();
		mocks.detail = store;
		render(CalendarTicketRouteHarness, { props: { entry: ID } });
		await vi.waitFor(() => expect(store.state).toBe('ready'));

		const full = await screen.findByRole('link', { name: 'Vollansicht öffnen' });
		expect(full.getAttribute('href')).toBe(`/kalender/tickets/${ID}/voll${QUERY}`);
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(mocks.goto).toHaveBeenCalledWith(`/kalender${QUERY}`);
	});

	it('leads "Zum Kalender" when the ticket is gone', async () => {
		mocks.detail = detailStore(async () => {
			throw new DataError('not_found');
		});
		render(CalendarTicketRouteHarness, { props: { entry: ID } });

		const back = await screen.findByRole('link', { name: 'Zum Kalender' });
		expect(back.getAttribute('href')).toBe(`/kalender${QUERY}`);
	});

	it('shows the full view over the calendar; closing gives the focus to the entry of the ticket', async () => {
		mocks.page.route = { id: '/(app)/kalender/tickets/[id]/voll' };
		mocks.page.url = new URL(`http://localhost:3000/kalender/tickets/${ID}/voll${QUERY}`);
		const store = detailStore();
		mocks.detail = store;
		const openMode = openModeStore('full');
		render(CalendarTicketRouteHarness, { props: { entry: ID, full: true, openMode } });
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		await tick();

		const dialog = screen.getByRole('dialog', { name: 'HAUS-3 · Dachrinne' });
		expect(screen.queryByRole('link', { name: 'Vollansicht öffnen' })).toBeNull();
		const panel = within(dialog).getByRole('link', { name: 'Im Seitenpanel öffnen' });
		expect(panel.getAttribute('href')).toBe(`/kalender/tickets/${ID}${QUERY}`);
		await fireEvent.click(within(dialog).getAllByRole('button', { name: 'Schließen' })[0]!);
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith(`/kalender${QUERY}`, { noScroll: true })
		);
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Eintrag im Kalender' }))
		);
	});
});

describe('hosts of the panel', () => {
	it('name the addresses of list and calendar and the element of a ticket in them', () => {
		const url = new URL(`http://localhost:3000/kalender${QUERY}`);
		expect(CALENDAR_HOST.view(url)).toBe(`/kalender${QUERY}`);
		expect(CALENDAR_HOST.panel(ID, url)).toBe(`/kalender/tickets/${ID}${QUERY}`);
		expect(CALENDAR_HOST.full(ID, url)).toBe(`/kalender/tickets/${ID}/voll${QUERY}`);
		expect(LIST_HOST.view(new URL('http://localhost:3000/tickets/x?status=open'))).toBe(
			'/?status=open'
		);
		expect(LIST_HOST.panel(ID, url)).toBe(`/tickets/${ID}${QUERY}`);
		document.body.innerHTML = `<table><tr data-ticket-id="${ID}"><td><a class="title-link" href="/">Zeile</a></td></tr></table><a data-calendar-ticket="${ID}" href="/">Eintrag</a>`;
		expect(LIST_HOST.entryOf(ID)?.textContent).toBe('Zeile');
		expect(CALENDAR_HOST.entryOf(ID)?.textContent).toBe('Eintrag');
		expect(CALENDAR_HOST.entryOf('other0000000000')).toBeNull();
		expect(LIST_HOST.backLabel).toBe('Zur Liste');
		expect(CALENDAR_HOST.backLabel).toBe('Zum Kalender');
	});
});
