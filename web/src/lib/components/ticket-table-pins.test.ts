// The section "Angeheftet" of the ticket table (PIN-1, ADR-0064): the open pinned tickets of the area
// first, in the order of pinning, whatever the filters, never twice; the number of the heading says
// "+ N angeheftet"; the head folds the section on this device; the pin toggle of a row moves the row
// and keeps the focus on it; realtime and completing take a ticket out; the head checkbox keeps
// choosing what passes the filters. List store, pins and catalog run for real on fake data layers.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DoneTicketPage } from '$lib/data/tickets';
import { parseListQuery } from '$lib/domain/list-query';
import { PINNED_FOLDED_KEY, type TicketPin } from '$lib/domain/pins';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { PinStore } from '$lib/stores/pins.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { fakePins, pinOf } from '$lib/test/fake-pins';
import TicketTable from './TicketTable.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };

let sequence = 0;

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `TASK-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: `2026-09-${String(sequence).padStart(2, '0')} 10:00:00.000Z`,
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function listData(open: TicketSummary[]): TicketListData {
	return {
		listOpen: vi.fn(async () => open),
		listDone: vi.fn(async (page: number): Promise<DoneTicketPage> => ({
			items: [],
			page,
			hasMore: false
		})),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(async (id: string, done: boolean): Promise<TicketSummary> => {
			const current = open.find((entry) => entry.id === id);
			if (!current) throw new Error('unknown');
			return { ...current, status: done ? 'done' : 'open', updated: '2026-09-24 10:00:00.000Z' };
		}),
		update: vi.fn(async (id: string): Promise<TicketSummary> => {
			const current = open.find((entry) => entry.id === id);
			if (!current) throw new Error('unknown');
			return current;
		})
	};
}

async function showTable(open: TicketSummary[], pinned: TicketPin[], path = '/') {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const flags = new FlagStore();
	const fake = fakePins(pinned);
	const pins = new PinStore(fake.data, SESSION, flags);
	const stopPins = pins.start();
	const store = new TicketListStore(listData(open), SESSION, { flags, pins });
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	const result = render(TicketTable, { props: { store, catalog, pins } });
	await vi.advanceTimersByTimeAsync(0);
	return { ...result, store, pins, fake, stopPins };
}

function pinnedBody() {
	return screen.getByRole('rowgroup', { name: /^Angeheftet/ });
}

function rowsOf(body: HTMLElement) {
	return [...body.querySelectorAll<HTMLElement>('tr[data-ticket-id]')];
}

function titlesOf(body: HTMLElement) {
	return rowsOf(body).map((row) => row.querySelector('a.title-link')?.textContent);
}

function openBody() {
	return screen.getByRole('rowgroup', { name: 'Offene Tickets' });
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	mocks.goto.mockClear();
	window.localStorage.clear();
	sequence = 0;
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('section "Angeheftet" of the ticket table', () => {
	it('shows the pinned tickets first, oldest pin on top, and not again below', async () => {
		const first = ticket();
		const second = ticket();
		const third = ticket();
		const fourth = ticket();
		// The third was pinned before the first.
		await showTable([first, second, third, fourth], [pinOf(first.id, 20), pinOf(third.id, 10)]);

		const pinned = pinnedBody();
		expect(rowsOf(pinned)[0]?.closest('tbody')).toBe(pinned);
		expect(titlesOf(pinned)).toEqual([third.title, first.title]);
		// Below in the default order (newer first at equal priority), without the pinned ones.
		expect(titlesOf(openBody())).toEqual([fourth.title, second.title]);
		// The head names the section and its number; it is the first group of the table.
		const toggle = within(pinned).getByRole('button', { name: /Angeheftet/ });
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.textContent).toMatch(/Angeheftet\s*2/);
		expect(screen.getAllByRole('rowgroup')[1]).toBe(pinned);
		// The number of the list: the rows below, plus the pinned ones.
		expect(screen.getByText('2 Tickets, + 2 angeheftet')).toBeTruthy();
		expect(screen.getByText('2 + 2 angeheftet')).toBeTruthy();
	});

	it('keeps the pinned tickets while the filters or the status "Erledigt" would hide them', async () => {
		const low = ticket({ priority: 'low', title: 'Steuererklärung' });
		const high = ticket({ priority: 'high' });
		const other = ticket({ priority: 'high' });
		const { unmount } = await showTable([low, high, other], [pinOf(low.id, 10)], '/?prio=high');

		expect(titlesOf(pinnedBody())).toEqual(['Steuererklärung']);
		expect(titlesOf(openBody())).toEqual([other.title, high.title]);
		unmount();
		document.body.innerHTML = '';

		await showTable([low, high], [pinOf(low.id, 10)], '/?status=done');
		expect(titlesOf(pinnedBody())).toEqual(['Steuererklärung']);
		expect(screen.queryByRole('rowgroup', { name: 'Offene Tickets' })).toBeNull();
	});

	it('names the pinned tickets of the chosen cards in the summary, so it adds up to the card (PL-1)', async () => {
		const urgent = [1, 2, 3, 4, 5].map(() => ticket({ priority: 'urgent' }));
		const pinnedLow = ticket({ priority: 'low' });
		const open = [...urgent, pinnedLow, ticket()];
		const pins = [pinOf(urgent[0]!.id, 10), pinOf(pinnedLow.id, 11)];
		const { store, unmount } = await showTable(open, pins, '/?karte=dringend');

		expect(store.cardCounts.urgent).toBe(5);
		// The pinned ticket of another priority is in the section, but not of the card "Dringend".
		expect(screen.getByText('4 + 2 angeheftet')).toBeTruthy();
		expect(screen.getByText('4 + 1 angeheftet aus: Dringend')).toBeTruthy();
		unmount();
		document.body.innerHTML = '';

		// The status filter "Erledigt" locks the cards: no summary of cards that do not apply.
		await showTable(open, pins, '/?karte=dringend&status=done');
		expect(screen.queryByText(/aus: Dringend/)).toBeNull();
	});

	it('says what is left below when every other ticket is pinned or filtered out', async () => {
		const pinnedHigh = ticket({ priority: 'high' });
		const low = ticket({ priority: 'low' });
		const { unmount } = await showTable(
			[pinnedHigh, low],
			[pinOf(pinnedHigh.id, 10)],
			'/?prio=high'
		);

		// The filters let only the pinned ticket through: no empty state above the section.
		expect(screen.queryByRole('heading', { name: 'Keine Tickets für diese Filter' })).toBeNull();
		expect(titlesOf(pinnedBody())).toEqual([pinnedHigh.title]);
		expect(within(openBody()).getByText('Keine weiteren Tickets für diese Filter.')).toBeTruthy();
		await fireEvent.click(within(openBody()).getByRole('button', { name: 'Filter zurücksetzen' }));
		expect(mocks.goto).toHaveBeenCalled();
		unmount();
		document.body.innerHTML = '';

		// Without filters and with every open ticket pinned: no "Keine offenen Tickets".
		await showTable([pinnedHigh], [pinOf(pinnedHigh.id, 10)]);
		expect(screen.queryByRole('heading', { name: 'Keine offenen Tickets' })).toBeNull();
		expect(within(openBody()).getByText('Keine weiteren offenen Tickets.')).toBeTruthy();
	});

	it('folds and unfolds on this device', async () => {
		const pinnedTicket = ticket();
		const other = ticket();
		const { unmount } = await showTable([pinnedTicket, other], [pinOf(pinnedTicket.id, 10)]);
		const toggle = within(pinnedBody()).getByRole('button', { name: /Angeheftet/ });

		toggle.focus();
		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(rowsOf(pinnedBody())).toEqual([]);
		// The head keeps the focus.
		expect(document.activeElement).toBe(toggle);
		expect(window.localStorage.getItem(PINNED_FOLDED_KEY)).toBe('1');
		// Folded, the ticket still does not stand below.
		expect(titlesOf(openBody())).toEqual([other.title]);

		// Another page on this device starts folded.
		unmount();
		document.body.innerHTML = '';
		await showTable([pinnedTicket, other], [pinOf(pinnedTicket.id, 10)]);
		const again = within(pinnedBody()).getByRole('button', { name: /Angeheftet/ });
		expect(again.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(again);
		expect(again.getAttribute('aria-expanded')).toBe('true');
		expect(titlesOf(pinnedBody())).toEqual([pinnedTicket.title]);
		expect(window.localStorage.getItem(PINNED_FOLDED_KEY)).toBeNull();
	});

	it('shows only the pins of the area: a pinned ticket the list does not know stays out', async () => {
		const here = ticket();
		// Pinned in the other area: the list store of this tab has no such ticket.
		await showTable([here], [pinOf('elsewhere000001', 10)]);

		expect(screen.queryByRole('rowgroup', { name: /^Angeheftet/ })).toBeNull();
		expect(titlesOf(openBody())).toEqual([here.title]);
		expect(screen.getByText('1 Ticket')).toBeTruthy();
	});

	it('pins and releases with the toggle of a row; the focus follows the row', async () => {
		const first = ticket();
		const second = ticket();
		const { fake } = await showTable([first, second], []);
		expect(screen.queryByRole('rowgroup', { name: /^Angeheftet/ })).toBeNull();

		const toggle = within(openBody()).getByRole('button', { name: `${second.key} anheften` });
		expect(toggle.getAttribute('aria-pressed')).toBe('false');
		expect(toggle.getAttribute('title')).toBe('Anheften');
		toggle.focus();
		await fireEvent.click(toggle);
		await vi.advanceTimersByTimeAsync(0);
		await tick();

		expect(fake.data.pin).toHaveBeenCalledWith(second.id);
		expect(titlesOf(pinnedBody())).toEqual([second.title]);
		expect(titlesOf(openBody())).toEqual([first.title]);
		const moved = within(pinnedBody()).getByRole('button', { name: `${second.key} anheften` });
		expect(moved.getAttribute('aria-pressed')).toBe('true');
		expect(moved.getAttribute('title')).toBe('Lösen');
		expect(document.activeElement).toBe(moved);

		await fireEvent.click(moved);
		await vi.advanceTimersByTimeAsync(0);
		await tick();
		expect(fake.data.unpin).toHaveBeenCalledOnce();
		expect(screen.queryByRole('rowgroup', { name: /^Angeheftet/ })).toBeNull();
		const back = within(openBody()).getByRole('button', { name: `${second.key} anheften` });
		expect(back.getAttribute('aria-pressed')).toBe('false');
		expect(document.activeElement).toBe(back);
	});

	it('loses a ticket live when another tab releases it, and when it is completed', async () => {
		const first = ticket();
		const second = ticket();
		const pinFirst = pinOf(first.id, 10);
		const { fake, store } = await showTable([first, second], [pinFirst, pinOf(second.id, 11)]);
		expect(titlesOf(pinnedBody())).toEqual([first.title, second.title]);

		fake.emit({ action: 'delete', id: pinFirst.id });
		await tick();
		expect(titlesOf(pinnedBody())).toEqual([second.title]);
		expect(titlesOf(openBody())).toEqual([first.title]);

		// Completed elsewhere: the ticket leaves the open list and so the section at once.
		store.upsert({ ...second, status: 'done', updated: '2026-09-24 11:00:00.000Z' });
		await tick();
		expect(screen.queryByRole('rowgroup', { name: /^Angeheftet/ })).toBeNull();
	});

	it('lets the head checkbox choose the pinned tickets that pass the filters, not the others', async () => {
		const pinnedHigh = ticket({ priority: 'high' });
		const pinnedLow = ticket({ priority: 'low' });
		const high = ticket({ priority: 'high' });
		await showTable(
			[pinnedHigh, pinnedLow, high],
			[pinOf(pinnedHigh.id, 10), pinOf(pinnedLow.id, 11)],
			'/?prio=high'
		);

		const head = screen.getByRole<HTMLInputElement>('checkbox', {
			name: 'Alle angezeigten Tickets auswählen'
		});
		await fireEvent.click(head);
		const chosen = (row: TicketSummary) =>
			screen.getByRole<HTMLInputElement>('checkbox', { name: `${row.key} auswählen` }).checked;
		expect(chosen(pinnedHigh)).toBe(true);
		expect(chosen(high)).toBe(true);
		expect(chosen(pinnedLow)).toBe(false);
		expect(head.checked).toBe(true);
	});
});
