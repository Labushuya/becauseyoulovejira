// Component tests of the calendar (ADR-0053, plan kalender, K-1): the month as an APG grid with ISO
// weeks and full dates, the entries of the layers with project, color and "überfällig", "+N
// weitere", the keyboard of the grid, the views and the period in the URL, the layers remembered on
// this device, the filters of "Aufgaben", the agenda with "Überfällig", a narrow month as marks, the
// menu "•••" of a ticket with right click and Shift+F10, the focus after the panel closed, and a
// month with 2 000 open tickets. Navigation and page state are mocked; the stores run with fakes.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CALENDAR_LAYERS_STORAGE_KEY,
	CALENDAR_VIEW_STORAGE_KEY,
	MONTH_DAY_LIMIT
} from '$lib/domain/calendar';
import type { InboxItemSummary } from '$lib/domain/inbox';
import type { Project } from '$lib/domain/project';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { CalendarDoneStore, type CalendarDoneData } from '$lib/stores/calendar.svelte';
import { CalendarPrefsStore } from '$lib/stores/calendar-prefs.svelte';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import type { InboxStore } from '$lib/stores/inbox.svelte';
import type { RecurrenceStore } from '$lib/stores/recurrence.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import {
	TicketRowActionsStore,
	type TicketRowActionsData
} from '$lib/stores/ticket-row-actions.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { resize, useResizeObserverStub } from '$lib/test/resize-observer-stub';
import CalendarView from './CalendarView.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/kalender') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();
useResizeObserverStub();

/** Friday, 2 October 2026, at noon in Berlin. */
const NOW = Date.parse('2026-10-02T10:00:00Z');
const TODAY = '2026-10-02';
const T0 = '2026-09-24 08:00:00.000Z';
const SESSION = { ensureValid: () => true, logout: vi.fn() };
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	color: 'blau',
	updated: T0
};
const GARDEN: Project = {
	id: 'proj00000000011',
	name: 'Garten',
	code: 'GART',
	archived: false,
	parentId: HOUSE.id,
	updated: T0
};
const OFFICE: Project = {
	id: 'proj00000000002',
	name: 'Büro',
	code: 'BUER',
	archived: false,
	updated: T0
};

let sequence = 0;

function ticket(due: string | null, overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `HAUS-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'open',
		priority: 'medium',
		due,
		projectId: HOUSE.id,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		recurrenceId: null,
		source: null,
		completedAt: null,
		created: T0,
		updated: T0,
		...overrides
	};
}

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: 'rule00000000001',
		title: 'Müll rausbringen',
		description: '',
		projectId: OFFICE.id,
		tagIds: [],
		priority: null,
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['MO'],
		monthDay: null,
		anchor: '2026-09-07',
		leadDays: 3,
		nextDue: '2026-10-05',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		created: T0,
		updated: T0,
		...overrides
	};
}

function item(sourceDate: string, overrides: Partial<InboxItemSummary> = {}): InboxItemSummary {
	sequence += 1;
	return {
		id: `i${String(sequence).padStart(14, '0')}`,
		channel: 'ics',
		kind: 'event',
		title: 'Zahnarzt',
		sourceUrl: '',
		sourceRef: '',
		sourceDate,
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		targetProjectId: null,
		created: T0,
		updated: T0,
		...overrides
	};
}

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
	localStorage.clear();
});

interface Setup {
	open?: TicketSummary[];
	done?: TicketSummary[];
	rules?: RecurrenceRule[];
	inbox?: InboxItemSummary[];
	withMenu?: boolean;
	activeId?: string | null;
}

async function show(path = '/kalender', setup: Setup = {}) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const catalog = new CatalogStore(
		{
			listProjects: async () => [HOUSE, GARDEN, OFFICE],
			listTags: async () => [],
			createTag: vi.fn()
		} satisfies CatalogData,
		SESSION
	);
	const listData: TicketListData = {
		listOpen: vi.fn(async () => setup.open ?? []),
		listDone: async (page) => ({ items: [], page, hasMore: false }),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const tickets = new TicketListStore(listData, SESSION, { now: () => NOW });
	const doneData: CalendarDoneData = {
		listDone: vi.fn(async () => ({ items: setup.done ?? [], hasMore: false }))
	};
	const done = new CalendarDoneStore(doneData, SESSION);
	const prefs = new CalendarPrefsStore(window);
	const rules = { rules: setup.rules ?? [] } as unknown as RecurrenceStore;
	const inbox = { newItems: setup.inbox ?? [] } as unknown as InboxStore;
	const rowData: TicketRowActionsData = {
		get: vi.fn(async (): Promise<Ticket> => ({
			...(setup.open ?? [])[0]!,
			description: '',
			sourceItem: null
		})),
		sources: vi.fn(async () => []),
		commentCount: vi.fn(async () => 0),
		delete: vi.fn(async () => null)
	};
	const rowActions = setup.withMenu
		? new TicketRowActionsStore(rowData, SESSION, tickets, null, new FlagStore())
		: null;
	await catalog.load();
	tickets.loadOpen();
	const view = render(CalendarView, {
		props: {
			tickets,
			catalog,
			rules,
			inbox,
			done,
			prefs,
			rowActions,
			activeId: setup.activeId ?? null
		}
	});
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { tickets, done, doneData, prefs, view };
}

const grid = () => screen.getByRole('grid');
/** The popover of a button; jsdom shows popovers as hidden (as in ticket-table-row-menu.test.ts). */
const popoverOf = (button: Element) =>
	document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
const cell = (name: RegExp | string) => within(grid()).getByRole('gridcell', { name });
const lastGotoUrl = () => {
	const call = mocks.goto.mock.calls.at(-1) as unknown as [string] | undefined;
	return new URL(call?.[0] ?? '', 'http://localhost:3000');
};

describe('month as a grid', () => {
	it('shows the month in ISO weeks, the days named by their full date, today marked', async () => {
		await show();

		expect(screen.getByRole('heading', { level: 2, name: 'Kalender' })).toBeTruthy();
		expect(grid().getAttribute('aria-labelledby')).toBe(
			screen.getByRole('heading', { name: 'Oktober 2026' }).id
		);
		const textsOf = (role: string) =>
			within(grid())
				.getAllByRole(role)
				.map((header) => header.textContent);
		expect(textsOf('columnheader')).toEqual(['KW', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
		expect(textsOf('rowheader')).toEqual([
			'40Kalenderwoche 40',
			'41Kalenderwoche 41',
			'42Kalenderwoche 42',
			'43Kalenderwoche 43',
			'44Kalenderwoche 44'
		]);
		expect(within(grid()).getAllByRole('gridcell')).toHaveLength(35);
		const today = cell('Freitag, 2. Oktober 2026, heute, keine Einträge');
		expect(today.getAttribute('aria-current')).toBe('date');
		expect(today.tabIndex).toBe(0);
		expect(cell(/^Montag, 28\. September 2026/).tabIndex).toBe(-1);
	});

	it('puts tickets on their due day with project and color in their name, overdue ones marked', async () => {
		const overdue = ticket('2026-09-30', { title: 'Steuer', priority: 'high' });
		const garden = ticket('2026-10-14', { title: 'Hecke', projectId: GARDEN.id });
		const office = ticket('2026-10-14', { title: 'Bericht', projectId: OFFICE.id, color: 'gruen' });
		await show('/kalender', { open: [overdue, garden, office] });

		const link = within(cell(/^Mittwoch, 30\. September 2026, 1 Eintrag/)).getByRole('link');
		expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			`${overdue.key} Steuer , überfällig, Projekt Haus, Farbe Blau, vom Projekt „Haus“`
		);
		expect(link.getAttribute('href')).toBe(`/kalender/tickets/${overdue.id}`);
		expect(link.closest('li')?.classList.contains('overdue')).toBe(true);
		const day = within(cell(/^Mittwoch, 14\. Oktober 2026, 2 Einträge/));
		const names = day.getAllByRole('link').map((entry) => entry.textContent?.replace(/\s+/g, ' '));
		expect(names[0]).toContain('Projekt Haus › Garten, Farbe Blau, vom Oberprojekt „Haus“');
		expect(names[1]).toContain('Projekt Büro, Farbe Grün');
	});

	it('shows planned dates of the rules and dated entries of the inbox, muted, with their links', async () => {
		await show('/kalender', {
			rules: [rule()],
			inbox: [item('2026-10-08 07:00:00.000Z', { title: 'Zahnarzt' })]
		});

		const planned = within(cell(/^Montag, 12\. Oktober 2026, 1 Eintrag/)).getByRole('link');
		expect(planned.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Geplant: Müll rausbringen , erscheint am 09.10. , Projekt Büro'
		);
		expect(planned.getAttribute('href')).toBe('/wiederholungen/rule00000000001');
		expect(planned.closest('li')?.classList.contains('planned')).toBe(true);
		const appointment = within(cell(/^Donnerstag, 8\. Oktober 2026, 1 Eintrag/)).getByRole('link');
		expect(appointment.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Termin im Eingang: Zahnarzt , Kalenderdatei'
		);
		expect(appointment.getAttribute('href')).toMatch(/^\/eingang\/i/);
	});

	it(`shows ${MONTH_DAY_LIMIT} entries of a day at most and the rest behind "+N weitere"`, async () => {
		const many = Array.from({ length: 6 }, (_, index) => ticket(TODAY, { title: `Nr. ${index}` }));
		await show('/kalender', { open: many });

		const today = cell(/^Freitag, 2\. Oktober 2026, heute, 6 Einträge/);
		expect(within(today).getAllByRole('link')).toHaveLength(3);
		const name = '+3 weitere: Freitag, 2. Oktober 2026';
		const more = within(today).getByRole('button', { name });
		await fireEvent.click(more);
		const popover = popoverOf(more);
		expect(popover.getAttribute('role')).toBe('dialog');
		const heading = document.getElementById(popover.getAttribute('aria-labelledby') ?? '');
		expect(heading?.textContent).toBe('Freitag, 2. Oktober 2026');
		const links = within(popover).getAllByRole('link', { hidden: true });
		expect(links).toHaveLength(6);
		expect(links.every((link) => !link.hasAttribute('tabindex'))).toBe(true);
		expect(within(popover).getByText('6 Einträge')).toBeTruthy();
	});
});

describe('keyboard of the grid', () => {
	it('moves the focus by days and weeks and to the ends of week and month', async () => {
		await show();
		const today = cell(/^Freitag, 2\. Oktober 2026/);
		today.focus();

		await fireEvent.keyDown(today, { key: 'ArrowRight' });
		await tick();
		const saturday = cell(/^Samstag, 3\. Oktober 2026/);
		expect(document.activeElement).toBe(saturday);
		expect(saturday.tabIndex).toBe(0);
		expect(today.tabIndex).toBe(-1);
		await fireEvent.keyDown(saturday, { key: 'ArrowDown' });
		await tick();
		expect(document.activeElement).toBe(cell(/^Samstag, 10\. Oktober 2026/));
		await fireEvent.keyDown(document.activeElement!, { key: 'Home' });
		await tick();
		expect(document.activeElement).toBe(cell(/^Montag, 5\. Oktober 2026/));
		await fireEvent.keyDown(document.activeElement!, { key: 'End', ctrlKey: true });
		await tick();
		expect(document.activeElement).toBe(cell(/^Samstag, 31\. Oktober 2026/));
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('shows the period around a day outside of it: Page Down, or an arrow beyond the grid', async () => {
		await show();
		const today = cell(/^Freitag, 2\. Oktober 2026/);
		today.focus();

		await fireEvent.keyDown(today, { key: 'PageDown' });
		expect(lastGotoUrl().searchParams.get('datum')).toBe('2026-11-02');
		await fireEvent.keyDown(cell(/^Montag, 28\. September 2026/), { key: 'ArrowUp' });
		expect(lastGotoUrl().searchParams.get('datum')).toBe('2026-09-21');
	});

	it('moves into a cell with Enter, through its entries with the arrows, and back with Escape', async () => {
		const first = ticket(TODAY, { title: 'Erstes', priority: 'urgent' });
		const second = ticket(TODAY, { title: 'Zweites' });
		await show('/kalender', { open: [first, second] });
		const today = cell(/^Freitag, 2\. Oktober 2026/);
		today.focus();

		await fireEvent.keyDown(today, { key: 'Enter' });
		const links = within(today).getAllByRole('link');
		expect(document.activeElement).toBe(links[0]);
		expect(links.every((link) => link.tabIndex === -1)).toBe(true);
		await fireEvent.keyDown(links[0]!, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(links[1]);
		await fireEvent.keyDown(links[1]!, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(links[0]);
		await fireEvent.keyDown(links[0]!, { key: 'Escape' });
		expect(document.activeElement).toBe(today);
	});
});

describe('views, period and layers', () => {
	it('switches the view, remembers it on this device and keeps the filters', async () => {
		await show('/kalender?prio=high');
		const week = screen.getByRole('button', { name: 'Woche' });
		expect(screen.getByRole('button', { name: 'Monat' }).getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(week);
		expect(localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY)).toBe('woche');
		expect(lastGotoUrl().search).toBe('?prio=high&ansicht=woche');
	});

	it('shows the remembered view without one in the URL, and the one of the URL first', async () => {
		localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, 'woche');
		await show();
		expect(screen.getByRole('heading', { name: 'KW 40 · 28.09. – 04.10.2026' })).toBeTruthy();
		expect(within(grid()).getAllByRole('gridcell')).toHaveLength(7);
		document.body.innerHTML = '';
		await show('/kalender?ansicht=agenda');
		expect(screen.queryByRole('grid')).toBeNull();
		expect(screen.getByRole('heading', { name: '02.10. – 29.10.2026' })).toBeTruthy();
	});

	it('goes to today, before and after with the day in the URL', async () => {
		await show('/kalender?datum=2026-03-31');
		expect(screen.getByRole('heading', { name: 'März 2026' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Nächster Monat' }));
		expect(lastGotoUrl().searchParams.get('datum')).toBe('2026-04-30');
		await fireEvent.click(screen.getByRole('button', { name: 'Vorheriger Monat' }));
		expect(lastGotoUrl().searchParams.get('datum')).toBe('2026-02-28');
		await fireEvent.click(screen.getByRole('button', { name: 'Heute' }));
		expect(lastGotoUrl().searchParams.has('datum')).toBe(false);
	});

	it('shows and hides layers, remembers them and loads done tickets only while they are shown', async () => {
		const done = ticket('2026-10-07', { status: 'done', title: 'Abgabe' });
		const { doneData } = await show('/kalender', {
			open: [ticket('2026-10-07', { title: 'Offen' })],
			done: [done],
			inbox: [item('2026-10-07 07:00:00.000Z')]
		});
		expect(doneData.listDone).not.toHaveBeenCalled();
		const button = screen.getByRole('button', { name: /Ebenen \(3 von 4\)/ });
		await fireEvent.click(button);
		const layers = popoverOf(button);
		expect(within(layers).getByRole('group', { hidden: true, name: 'Ebenen' })).toBeTruthy();
		const layer = (name: RegExp) => within(layers).getByRole('checkbox', { hidden: true, name });

		await fireEvent.click(layer(/Erledigte Tickets/));
		await vi.waitFor(() =>
			expect(doneData.listDone).toHaveBeenCalledWith(
				{ from: '2026-09-28', to: '2026-11-01' },
				1,
				expect.anything()
			)
		);
		const day = cell(/^Mittwoch, 7\. Oktober 2026, 3 Einträge/);
		const doneLink = within(day).getAllByRole('link').at(-1)!;
		expect(doneLink.textContent).toContain(', erledigt');
		expect(doneLink.closest('li')?.classList.contains('done')).toBe(true);
		await fireEvent.click(layer(/Termine im Eingang/));
		expect(localStorage.getItem(CALENDAR_LAYERS_STORAGE_KEY)).toBe('offen,erledigt,geplant');
		expect(cell(/^Mittwoch, 7\. Oktober 2026, 2 Einträge/)).toBeTruthy();
	});

	it('applies the filters of "Aufgaben" from the URL; the inbox gives way to a priority', async () => {
		const high = ticket('2026-10-07', { priority: 'high', title: 'Hoch' });
		await show('/kalender?prio=high', {
			open: [high, ticket('2026-10-07', { title: 'Normal' })],
			inbox: [item('2026-10-07 07:00:00.000Z')]
		});

		const day = cell(/^Mittwoch, 7\. Oktober 2026, 1 Eintrag/);
		expect(within(day).getByRole('link').textContent).toContain('Hoch');
		expect(screen.queryByRole('radiogroup', { name: 'Fällig' })).toBeNull();
		expect(screen.queryByRole('searchbox')).toBeNull();
	});
});

describe('agenda', () => {
	it('lists the days with entries from today, under the group "Überfällig"', async () => {
		const overdue = ticket('2026-09-20', { title: 'Alt' });
		await show('/kalender?ansicht=agenda', {
			open: [overdue, ticket('2026-10-05', { title: 'Montag' }), ticket(TODAY, { title: 'Heute' })]
		});

		const headings = screen
			.getAllByRole('heading', { level: 4 })
			.map((heading) => heading.textContent);
		expect(headings).toEqual([
			'Überfällig (1 Eintrag)',
			'Freitag, 2. Oktober 2026 · heute',
			'Montag, 5. Oktober 2026'
		]);
		const group = screen.getByRole('region', { name: 'Überfällig (1 Eintrag)' });
		expect(within(group).getByText('seit 12 Tagen überfällig')).toBeTruthy();
		expect(within(group).getByRole('link').getAttribute('tabindex')).toBeNull();
	});

	it('says so when the four weeks are empty', async () => {
		await show('/kalender?ansicht=agenda&datum=2027-01-01');
		const name = 'Keine Einträge in diesen vier Wochen';
		expect(screen.getByRole('heading', { name })).toBeTruthy();
	});
});

describe('narrow windows and many tickets', () => {
	it('shows marks instead of titles in a narrow month, each still a link with its full name', async () => {
		await show('/kalender', { open: [ticket(TODAY, { title: 'Wäsche' })] });
		resize(grid(), 300);
		await tick();

		expect(grid().classList.contains('compact')).toBe(true);
		const link = within(cell(/^Freitag, 2\. Oktober 2026/)).getByRole('link');
		expect(link.closest('li')?.classList.contains('dot')).toBe(true);
		expect(link.textContent).toContain('Wäsche');
		resize(grid(), 900);
		await tick();
		expect(grid().classList.contains('compact')).toBe(false);
	});

	it('renders only the entries a month shows, with 2 000 open tickets', async () => {
		const two = (value: number) => String(value).padStart(2, '0');
		const open = Array.from({ length: 2000 }, (_, index) =>
			ticket(`2026-${two((index % 12) + 1)}-${two((index % 28) + 1)}`)
		);
		const rules = Array.from({ length: 50 }, (_, index) =>
			rule({ id: `rule${String(index).padStart(11, '0')}` })
		);
		const started = performance.now();
		await show('/kalender', { open, rules });
		const elapsed = performance.now() - started;

		const links = within(grid()).getAllByRole('link');
		expect(links.length).toBeLessThanOrEqual(35 * MONTH_DAY_LIMIT);
		// Generous for slow runners; locally about 100 ms with jsdom, stores included (plan kalender §6).
		expect(elapsed).toBeLessThan(10_000);
	});
});

describe('menu of a ticket and the panel', () => {
	it('opens the menu of the rows with a right click and Shift+F10, with the ways into the calendar', async () => {
		const first = ticket(TODAY, { title: 'Wäsche' });
		await show('/kalender?prio=medium', { open: [first], withMenu: true });
		const link = within(cell(/^Freitag, 2\. Oktober 2026/)).getByRole('link');

		await fireEvent.contextMenu(link, { clientX: 40, clientY: 50 });
		const button = within(link.closest('li')!).getByRole('button', {
			hidden: true,
			name: `Weitere Aktionen für ${first.key}`
		});
		const menu = popoverOf(button);
		expect(menu.getAttribute('aria-label')).toBe(`Weitere Aktionen für ${first.key}`);
		expect(menu.matches(':popover-open')).toBe(true);
		const entries = within(menu).getAllByRole('menuitem', { hidden: true });
		expect(entries.map((entry) => entry.textContent?.trim())).toEqual([
			'Im Seitenpanel öffnen',
			'In Vollansicht öffnen',
			'Link kopieren',
			'In den Papierkorb …'
		]);
		expect(entries[0]?.getAttribute('href')).toBe(`/kalender/tickets/${first.id}?prio=medium`);
		expect(entries[1]?.getAttribute('href')).toBe(`/kalender/tickets/${first.id}/voll?prio=medium`);
		await fireEvent.keyDown(menu, { key: 'Escape' });
		expect(menu.matches(':popover-open')).toBe(false);
		link.focus();
		await fireEvent.keyDown(link, { key: 'F10', shiftKey: true });
		expect(menu.matches(':popover-open')).toBe(true);
		await vi.waitFor(() => expect(document.activeElement).toBe(entries[0]));
	});

	it('marks the ticket of the panel and gives its entry the focus when the panel closes', async () => {
		const first = ticket(TODAY, { title: 'Wäsche' });
		const { view } = await show('/kalender', { open: [first], activeId: first.id });
		const link = within(cell(/^Freitag, 2\. Oktober 2026/)).getByRole('link');
		expect(link.getAttribute('aria-current')).toBe('true');

		await view.rerender({ activeId: null });
		await vi.waitFor(() => expect(document.activeElement).toBe(link));
	});
});
