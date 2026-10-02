// Route test of the calendar (ADR-0053, plan kalender, K-1): the calendar under /kalender, the panel
// of a ticket next to it under /kalender/tickets/<id> (embedded like next to "Aufgaben"), the links of
// the entries that stay in the calendar, the question of "In den Papierkorb …" from the menu of an
// entry as a dialog of the layout, which closes the panel of that ticket, and the done tickets that
// load only while their layer is on. A planned date opens its rule and a date of the inbox its entry
// next to the calendar as well (/kalender/wiederholungen/<id>, /kalender/eingang/<id>, ADR-0054 §8):
// marked in the calendar, their tickets in place of them, × back to the calendar with its state.
// Navigation, page state and the data layers are fakes; the stores are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItem } from '$lib/domain/inbox';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import { RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import {
	TicketRowActionsStore,
	type TicketRowActionsData
} from '$lib/stores/ticket-row-actions.svelte';
import CalendarRouteHarness from '$lib/test/CalendarRouteHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useResizeObserverStub } from '$lib/test/resize-observer-stub';
import { CALENDAR_HOST, CALENDAR_ITEM_ROUTE, CALENDAR_RULE_ROUTE } from '$lib/ticket-host';

const T0 = '2026-09-24 08:00:00.000Z';
const NOW = Date.parse('2026-10-02T10:00:00Z');
const ID = 't00000000000001';
const RULE = 'rule00000000001';
const ITEM = 'item00000000001';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: {
		url: new URL('http://localhost:3000/kalender'),
		params: {} as Record<string, string>,
		route: { id: '/(app)/kalender' }
	},
	catalog: null as unknown,
	tickets: null as unknown,
	rules: null as unknown,
	inbox: null as unknown,
	listDone: vi.fn()
}));

// The way back from a ticket (ADR-0054) and the question of the rule panel follow navigations.
vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));
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
	getRecurrenceStore: () => mocks.rules
}));
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => mocks.inbox
}));
vi.mock('$lib/stores/ticket-sources.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketSourcesStore: () => null
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

/** A rule with a ticket due on Monday, 5 October, and planned dates on the Mondays after it. */
function rule(): RecurrenceRule {
	return {
		id: RULE,
		title: 'Müll rausbringen',
		description: '',
		projectId: null,
		tagIds: [],
		priority: 'medium',
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['MO'],
		monthDay: null,
		anchor: '2026-09-07',
		leadDays: 3,
		nextDue: '2026-10-12',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		created: T0,
		updated: T0
	};
}

/** The open ticket of the rule. */
const INSTANCE = ticket({
	id: 't00000000000002',
	key: 'HAUS-2',
	title: 'Müll rausbringen',
	due: '2026-10-05',
	recurring: true,
	recurrenceId: RULE
});

/** An appointment of a calendar file in the inbox, on Thursday, 8 October. */
function appointment(): InboxItem {
	return {
		id: ITEM,
		channel: 'ics',
		kind: 'event',
		title: 'Zahnarzt',
		body: '',
		sourceUrl: '',
		sourceRef: '',
		sourceDate: '2026-10-08 07:00:00.000Z',
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: T0,
		updated: T0
	};
}

type Child = 'ticket' | 'rule' | 'item';
const CHILD_OF: Record<string, Child> = {
	tickets: 'ticket',
	wiederholungen: 'rule',
	eingang: 'item'
};
const CHILD_ROUTES: Record<Child, string> = {
	ticket: CALENDAR_HOST.panelRoute,
	rule: CALENDAR_RULE_ROUTE,
	item: CALENDAR_ITEM_ROUTE
};

interface Setup {
	open?: TicketSummary[];
	rowData?: TicketRowActionsData | null;
}

async function show(path: string, { open = [ticket()], rowData = null }: Setup = {}) {
	const url = new URL(path, 'http://localhost:3000');
	mocks.page.url = url;
	const match = /^\/kalender\/(tickets|wiederholungen|eingang)\/([a-z0-9]{15})$/.exec(url.pathname);
	const child = match === null ? null : (CHILD_OF[match[1] ?? ''] ?? null);
	mocks.page.params = match === null ? {} : { id: match[2] ?? '' };
	mocks.page.route = { id: child === null ? '/(app)/kalender' : CHILD_ROUTES[child] };
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
	const ruleData = {
		listRules: vi.fn(async () => [rule()]),
		createRule: vi.fn<RecurrenceData['createRule']>(),
		updateRule: vi.fn<RecurrenceData['updateRule']>(),
		setActive: vi.fn<RecurrenceData['setActive']>(),
		deleteRule: vi.fn<RecurrenceData['deleteRule']>(),
		detachTicket: vi.fn<RecurrenceData['detachTicket']>()
	} satisfies RecurrenceData;
	const rules = new RecurrenceStore(ruleData, session, new FlagStore());
	await rules.load();
	const inboxData = {
		listNew: vi.fn<InboxData['listNew']>(async () => [appointment()]),
		listHandled: vi.fn<InboxData['listHandled']>(async (_state, page) => ({
			items: [],
			page,
			hasMore: false
		})),
		get: vi.fn<InboxData['get']>(async () => appointment()),
		create: vi.fn<InboxData['create']>(),
		discard: vi.fn<InboxData['discard']>(),
		restore: vi.fn<InboxData['restore']>(),
		assign: vi.fn<InboxData['assign']>(),
		originalUrl: vi.fn<InboxData['originalUrl']>(),
		importCalendar: vi.fn<InboxData['importCalendar']>(),
		savePage: vi.fn<InboxData['savePage']>()
	} satisfies InboxData;
	const inbox = new InboxStore(inboxData, session);
	await inbox.load();
	mocks.catalog = catalog;
	mocks.tickets = tickets;
	mocks.rules = rules;
	mocks.inbox = inbox;
	const rowActions =
		rowData === null ? null : new TicketRowActionsStore(rowData, session, tickets, null);
	render(CalendarRouteHarness, { props: { child, rowActions } });
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { tickets };
}

const grid = () => within(screen.getByRole('grid'));
const entryLink = () => grid().getByRole('link', { name: /^HAUS-1 Dach/ });
/** The first planned date of the rule, Monday, 12 October. */
const plannedLink = () => grid().getAllByRole('link', { name: /^Geplant: Müll rausbringen/ })[0]!;
const dateLink = () => grid().getByRole('link', { name: /^Termin im Eingang: Zahnarzt/ });

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

describe('calendar route: rules and inbox entries next to it (ADR-0054 §8)', () => {
	it('opens a planned date and a date of the inbox next to the calendar with its state', async () => {
		await show('/kalender?ansicht=monat');

		expect(plannedLink().getAttribute('href')).toBe(
			`/kalender/wiederholungen/${RULE}?ansicht=monat`
		);
		expect(dateLink().getAttribute('href')).toBe(`/kalender/eingang/${ITEM}?ansicht=monat`);
	});

	it('shows the rule next to the calendar, its tickets in place of it, × back to the calendar', async () => {
		await show(`/kalender/wiederholungen/${RULE}?ansicht=monat`, {
			open: [ticket(), INSTANCE]
		});

		const panel = screen.getByRole('complementary', { name: 'Müll rausbringen' });
		expect(document.querySelector('.view')?.getAttribute('data-panel-mode')).toBe('embedded');
		expect(plannedLink().getAttribute('aria-current')).toBe('true');
		expect(entryLink().getAttribute('aria-current')).toBeNull();
		expect(document.title).toBe('Müll rausbringen · Kalender · becauseyoulovejira');
		expect(within(panel).getByRole('link', { name: 'HAUS-2' }).getAttribute('href')).toBe(
			`/kalender/tickets/${INSTANCE.id}?ansicht=monat&von=regel-${RULE}`
		);

		await fireEvent.click(within(panel).getByRole('button', { name: 'Panel schließen' }));
		expect(mocks.goto).toHaveBeenCalledWith('/kalender?ansicht=monat');
	});

	it('shows the entry of the inbox next to the calendar and × leads back to the calendar', async () => {
		await show(`/kalender/eingang/${ITEM}?ansicht=monat`);

		const heading = await screen.findByRole('heading', { name: 'Zahnarzt' });
		const panel = heading.closest('aside') as HTMLElement;
		expect(document.querySelector('.view')?.getAttribute('data-panel-mode')).toBe('embedded');
		expect(dateLink().getAttribute('aria-current')).toBe('true');
		expect(plannedLink().getAttribute('aria-current')).toBeNull();
		expect(document.title).toBe('Zahnarzt · Kalender · becauseyoulovejira');

		await fireEvent.click(within(panel).getByRole('button', { name: 'Panel schließen' }));
		expect(mocks.goto).toHaveBeenCalledWith('/kalender?ansicht=monat');
	});
});
