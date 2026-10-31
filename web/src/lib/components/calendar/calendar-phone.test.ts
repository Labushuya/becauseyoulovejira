// The calendar in the phone frame (MO-7c2, ADR-0073 addendum MO-7c2) in jsdom with a controlled
// matchMedia: the agenda by default, "Agenda | Monat" and "Filter" in the row of the view instead of
// the bar of the PC, a week of a link as the agenda, the filter sheet with the filters of the calendar
// and its layers, the month with marks whose day opens the list of the day, and the PC unchanged.
// Navigation and page state are mocked; the stores run with fakes, as in calendar-view.test.ts.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALENDAR_LAYERS_STORAGE_KEY } from '$lib/domain/calendar';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { Project } from '$lib/domain/project';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { CalendarDoneStore } from '$lib/stores/calendar.svelte';
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
import { useResizeObserverStub } from '$lib/test/resize-observer-stub';
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
	updated: T0
};

let sequence = 0;

function ticket(due: string, overrides: Partial<TicketSummary> = {}): TicketSummary {
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

let stop: (() => void) | null = null;

/** The window of the test: narrow (a phone) or wide (a PC), with the switch on. */
function useWindow(narrow: boolean): void {
	vi.stubGlobal('matchMedia', (media: string) => ({
		matches: media === PHONE_QUERY ? narrow : false,
		media,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
	stop = getMobileLayoutStore().connect();
	getMobileLayoutStore().choose(true);
}

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
	localStorage.clear();
});

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	localStorage.clear();
});

async function show(path: string, open: TicketSummary[] = []) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const catalog = new CatalogStore(
		{
			listProjects: async () => [HOUSE],
			listTags: async () => [],
			createTag: vi.fn()
		} satisfies CatalogData,
		SESSION
	);
	const listData: TicketListData = {
		listOpen: vi.fn(async () => open),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const flags = new FlagStore();
	const tickets = new TicketListStore(listData, SESSION, { now: () => NOW, flags });
	const done = new CalendarDoneStore(
		{ listDone: vi.fn(async () => ({ items: [], hasMore: false })) },
		SESSION
	);
	const prefs = new CalendarPrefsStore(window);
	const rowData: TicketRowActionsData = {
		get: vi.fn(async (): Promise<Ticket> => ({ ...open[0]!, description: '', sourceItem: null })),
		sources: vi.fn(async () => []),
		commentCount: vi.fn(async () => 0),
		delete: vi.fn(async () => null)
	};
	await catalog.load();
	tickets.loadOpen();
	render(CalendarView, {
		props: {
			tickets,
			catalog,
			rules: { rules: [] } as unknown as RecurrenceStore,
			inbox: { newItems: [] } as unknown as InboxStore,
			done,
			prefs,
			rowActions: new TicketRowActionsStore(rowData, SESSION, tickets, null, flags),
			flags
		}
	});
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { prefs, flags };
}

const viewChoice = () => screen.getByRole('group', { name: 'Ansicht des Kalenders' });
const pressed = () =>
	within(viewChoice())
		.getAllByRole('button')
		.filter((button) => button.getAttribute('aria-pressed') === 'true')
		.map((button) => button.textContent?.trim());
const lastGotoUrl = () => {
	const call = mocks.goto.mock.calls.at(-1) as unknown as [string] | undefined;
	return new URL(call?.[0] ?? '', 'http://localhost:3000');
};
/** The popover of a button; jsdom shows popovers as hidden (as in calendar-view.test.ts). */
const popoverOf = (button: Element) =>
	document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;

describe('calendar in the phone frame (MO-7c2)', () => {
	it('starts with the agenda, with "Agenda | Monat" and "Filter" in the row of the view instead of the bar of the PC', async () => {
		useWindow(true);
		await show('/kalender', [ticket(TODAY, { title: 'Wäsche' })]);

		const row = document.querySelector('.phone-tools') as HTMLElement;
		expect(row).not.toBeNull();
		expect(
			within(viewChoice())
				.getAllByRole('button')
				.map((button) => button.textContent?.trim())
		).toEqual(['Agenda', 'Monat']);
		expect(pressed()).toEqual(['Agenda']);
		expect(within(row).getByRole('button', { name: 'Filter' })).toBeTruthy();
		expect(screen.queryByRole('region', { name: 'Filter' })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Ebenen/ })).toBeNull();
		expect(screen.queryByRole('grid')).toBeNull();
		expect(screen.getByRole('link', { name: /Wäsche/ })).toBeTruthy();
	});

	it('shows a week of a link as the agenda, and "Monat" chooses the month', async () => {
		useWindow(true);
		await show('/kalender?ansicht=woche&datum=2026-10-05');

		expect(screen.queryByRole('grid')).toBeNull();
		expect(screen.getByRole('heading', { name: '05.10. – 01.11.2026' })).toBeTruthy();
		expect(pressed()).toEqual(['Agenda']);
		await fireEvent.click(within(viewChoice()).getByRole('button', { name: 'Monat' }));
		expect(lastGotoUrl().searchParams.get('ansicht')).toBe('monat');
		expect(lastGotoUrl().searchParams.get('datum')).toBe('2026-10-05');
	});

	it('holds the filters of the calendar and its layers in the filter sheet; "Zurücksetzen" keeps view and day', async () => {
		useWindow(true);
		const { prefs } = await show('/kalender?status=open&ansicht=monat&datum=2026-10-05', [
			ticket(TODAY, { title: 'Wäsche' })
		]);

		const open = screen.getByRole('button', { name: 'Filter, 1 aktiv' });
		await fireEvent.click(open);
		const sheet = screen.getByRole('dialog', { name: 'Filter' });
		expect(within(sheet).getByRole('group', { name: 'Status' })).toBeTruthy();
		expect(within(sheet).getByRole('radio', { name: 'Erledigt' })).toBeTruthy();
		expect(within(sheet).queryByRole('group', { name: 'Fällig' })).toBeNull();
		expect(within(sheet).queryByRole('group', { name: 'Sortieren nach' })).toBeNull();
		const layers = within(sheet).getByRole('group', { name: 'Ebenen' });
		expect(within(layers).getAllByRole('checkbox')).toHaveLength(4);

		// A layer applies at once and stays on this device, as in the popover of the PC.
		await fireEvent.click(
			within(layers).getByRole('checkbox', { name: /Künftige Wiederholungen/ })
		);
		expect(prefs.layers.has('planned')).toBe(false);
		expect(localStorage.getItem(CALENDAR_LAYERS_STORAGE_KEY)).toBe('offen,eingang');

		await fireEvent.click(within(sheet).getByRole('button', { name: 'Zurücksetzen' }));
		const reset = lastGotoUrl();
		expect(reset.searchParams.has('status')).toBe(false);
		expect(reset.searchParams.get('ansicht')).toBe('monat');
		expect(reset.searchParams.get('datum')).toBe('2026-10-05');
		expect(within(sheet).getByRole('button', { name: '1 Eintrag anzeigen' })).toBeTruthy();
	});

	it('shows the month with marks; the day is the target and opens the list of the day', async () => {
		useWindow(true);
		await show('/kalender?ansicht=monat', [
			ticket(TODAY, { title: 'Wäsche' }),
			ticket(TODAY, { title: 'Blumen' })
		]);

		const grid = screen.getByRole('grid');
		expect(grid.classList.contains('phone')).toBe(true);
		const day = within(grid).getByRole('gridcell', { name: /^Freitag, 2\. Oktober 2026/ });
		// The marks are no links of their own: the day is the one target.
		expect(within(day).queryAllByRole('link')).toHaveLength(0);
		expect(day.querySelectorAll('.entry.mark')).toHaveLength(2);
		const button = within(day).getByRole('button', {
			name: '2 Einträge am Freitag, 2. Oktober 2026'
		});
		await fireEvent.click(button);
		const list = popoverOf(button);
		const links = within(list).getAllByRole('link', { hidden: true });
		expect(links).toHaveLength(2);
		const names = links.map((link) => link.textContent ?? '').join(' ');
		expect(names).toContain('Blumen');
		expect(names).toContain('Wäsche');
		expect(
			within(list).getAllByRole('button', { hidden: true, name: /^Weitere Aktionen für / })
		).toHaveLength(2);
	});

	it('keeps the calendar of the PC: the bar of filters, three views and the popover "Ebenen"', async () => {
		useWindow(false);
		await show('/kalender', [ticket(TODAY, { title: 'Wäsche' })]);

		expect(document.querySelector('.phone-tools')).toBeNull();
		expect(
			within(viewChoice())
				.getAllByRole('button')
				.map((button) => button.textContent?.trim())
		).toEqual(['Monat', 'Woche', 'Agenda']);
		expect(screen.getByRole('region', { name: 'Filter' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^Ebenen/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Filter/ })).toBeNull();
		const day = within(screen.getByRole('grid')).getByRole('gridcell', {
			name: /^Freitag, 2\. Oktober 2026/
		});
		expect(within(day).getByRole('link', { name: /Wäsche/ })).toBeTruthy();
	});
});
