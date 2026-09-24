// Component tests for the list view (E2 plan, package 5): empty states, the switch "Erledigte
// anzeigen" in the URL, check mark with undo and focus, loading errors and "Weitere laden". The
// store runs for real on a fake data layer; SvelteKit navigation and page state are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DoneTicketPage } from '$lib/data/tickets';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import {
	TicketListStore,
	UNDO_WINDOW_MS,
	type TicketListData
} from '$lib/stores/ticket-list.svelte';
import TicketList from './TicketList.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

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
		project: null,
		tags: [],
		recurring: false,
		completedAt: null,
		created: `2026-09-${String(sequence).padStart(2, '0')} 10:00:00.000Z`,
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function fakeData(open: TicketSummary[], donePages: TicketSummary[][] = []) {
	const all = () => [...open, ...donePages.flat()];
	return {
		listOpen: vi.fn(async () => open),
		listDone: vi.fn(async (page: number): Promise<DoneTicketPage> => ({
			items: donePages[page - 1] ?? [],
			page,
			hasMore: page < donePages.length
		})),
		setDone: vi.fn(async (id: string, done: boolean): Promise<TicketSummary> => {
			const current = all().find((entry) => entry.id === id);
			if (!current) throw new DataError('not_found');
			return {
				...current,
				status: done ? 'done' : 'open',
				completedAt: done ? '2026-09-24 10:00:00.000Z' : null,
				updated: '2026-09-24 10:00:00.000Z'
			};
		}),
		update: vi.fn(async (id: string, patch: TicketPatch): Promise<TicketSummary> => {
			const current = all().find((entry) => entry.id === id);
			if (!current) throw new DataError('not_found');
			return { ...current, ...patch, updated: '2026-09-24 10:00:01.000Z' } as TicketSummary;
		})
	} satisfies TicketListData;
}

async function showList(data: TicketListData, path = '/') {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const store = new TicketListStore(data, { ensureValid: () => true, logout: vi.fn() });
	store.activate(mocks.page.url.searchParams.get('erledigte') === '1');
	const result = render(TicketList, { props: { store } });
	await vi.advanceTimersByTimeAsync(0);
	return { ...result, store };
}

function openRows() {
	return within(screen.getByRole('list', { name: 'Offene Tickets' })).getAllByRole('listitem');
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	mocks.goto.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ticket list view', () => {
	it('shows the open tickets in the default order under "Alle Tickets"', async () => {
		const low = ticket({ priority: 'low' });
		const overdue = ticket({ due: '2026-09-01' });
		const urgent = ticket({ priority: 'urgent' });
		await showList(fakeData([low, overdue, urgent]));

		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Alle Tickets');
		expect(openRows().map((row) => within(row).getByRole('link').textContent)).toEqual([
			expect.stringContaining(overdue.key),
			expect.stringContaining(urgent.key),
			expect.stringContaining(low.key)
		]);
		expect(screen.queryByRole('region', { name: 'Erledigt' })).toBeNull();
	});

	it('keeps the query in the row links', async () => {
		const item = ticket();
		await showList(fakeData([item], [[]]), '/?erledigte=1');

		expect(screen.getByRole('link').getAttribute('href')).toBe(`/tickets/${item.id}?erledigte=1`);
	});

	it('shows the empty states', async () => {
		await showList(fakeData([], [[]]), '/?erledigte=1');

		expect(screen.getByText('Keine offenen Tickets.')).toBeTruthy();
		const doneSection = screen.getByRole('region', { name: 'Erledigt' });
		expect(within(doneSection).getByText('Noch keine erledigten Tickets.')).toBeTruthy();
	});

	it('turns the switch into the URL parameter and back', async () => {
		await showList(fakeData([]));
		const toggle = screen.getByRole<HTMLInputElement>('checkbox', {
			name: 'Erledigte anzeigen'
		});
		expect(toggle.checked).toBe(false);

		await fireEvent.click(toggle);
		expect(mocks.goto).toHaveBeenLastCalledWith('/?erledigte=1', {
			keepFocus: true,
			noScroll: true
		});
	});

	it('reads the switch from the URL', async () => {
		await showList(fakeData([], [[]]), '/?erledigte=1');
		const toggle = screen.getByRole<HTMLInputElement>('checkbox', {
			name: 'Erledigte anzeigen'
		});
		expect(toggle.checked).toBe(true);

		await fireEvent.click(toggle);
		expect(mocks.goto).toHaveBeenLastCalledWith('/', { keepFocus: true, noScroll: true });
	});

	it('shows done tickets in their own section with "Weitere laden"', async () => {
		const first = ticket({ status: 'done', completedAt: '2026-09-22 10:00:00.000Z' });
		const second = ticket({ status: 'done', completedAt: '2026-09-21 10:00:00.000Z' });
		const data = fakeData([ticket()], [[first], [second]]);
		await showList(data, '/?erledigte=1');

		const section = screen.getByRole('region', { name: 'Erledigt' });
		expect(within(section).getAllByRole('listitem')).toHaveLength(1);
		await fireEvent.click(within(section).getByRole('button', { name: 'Weitere laden' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(within(section).getAllByRole('listitem')).toHaveLength(2);
		expect(within(section).queryByRole('button', { name: 'Weitere laden' })).toBeNull();
	});

	it('checks a ticket, keeps the row with "Rückgängig" and restores the previous status', async () => {
		const item = ticket({ status: 'waiting' });
		const data = fakeData([item]);
		await showList(data);

		await fireEvent.click(screen.getByRole('checkbox', { name: `${item.key} erledigt` }));
		await vi.advanceTimersByTimeAsync(0);
		expect(data.setDone).toHaveBeenCalledWith(item.id, true);
		expect(screen.getByText(`${item.key} erledigt. Rückgängig ist kurz möglich.`)).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', { name: `Rückgängig: ${item.key} wieder öffnen` })
		);
		await vi.advanceTimersByTimeAsync(0);

		expect(data.update).toHaveBeenCalledWith(item.id, { status: 'waiting' });
		expect(within(openRows()[0]!).getByText('Wartet')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
	});

	it('moves the focus to the next row when a checked row goes away', async () => {
		const first = ticket({ priority: 'urgent' });
		const second = ticket();
		await showList(fakeData([first, second]));

		const toggle = screen.getByRole('checkbox', { name: `${first.key} erledigt` });
		toggle.focus();
		await fireEvent.click(toggle);
		await vi.advanceTimersByTimeAsync(0);
		screen.getByRole('button', { name: `Rückgängig: ${first.key} wieder öffnen` }).focus();

		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		await tick();

		expect(openRows()).toHaveLength(1);
		expect(document.activeElement).toBe(within(openRows()[0]!).getByRole('link'));
	});

	it('keeps the focus on the check mark when an unchecked ticket moves up', async () => {
		const closed = ticket({ status: 'done', completedAt: '2026-09-20 10:00:00.000Z' });
		await showList(fakeData([], [[closed]]), '/?erledigte=1');

		const toggle = screen.getByRole('checkbox', { name: `${closed.key} erledigt` });
		toggle.focus();
		await fireEvent.click(toggle);
		await vi.advanceTimersByTimeAsync(0);
		await tick();

		const moved = within(openRows()[0]!).getByRole('checkbox', { name: `${closed.key} erledigt` });
		expect(document.activeElement).toBe(moved);
	});

	it('springs back and shows an error when checking fails', async () => {
		const item = ticket();
		const data = fakeData([item]);
		data.setDone.mockRejectedValueOnce(new DataError('network'));
		await showList(data);

		const toggle = screen.getByRole<HTMLInputElement>('checkbox', { name: `${item.key} erledigt` });
		await fireEvent.click(toggle);
		await vi.advanceTimersByTimeAsync(0);

		expect(toggle.checked).toBe(false);
		const alert = screen.getByText(/konnte nicht geändert werden/).closest('.alert-error');
		expect(alert?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		await fireEvent.click(within(alert as HTMLElement).getByRole('button', { name: 'Schließen' }));
		expect(screen.queryByText(/konnte nicht geändert werden/)).toBeNull();
	});

	it('shows a loading error with "Erneut versuchen"', async () => {
		const data = fakeData([ticket()]);
		data.listOpen.mockRejectedValueOnce(new DataError('network'));
		await showList(data);

		const alert = screen.getByText(/Server nicht erreichbar/).closest('.alert-error');
		expect(alert).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(openRows()).toHaveLength(1);
		expect(screen.queryByText(/Server nicht erreichbar/)).toBeNull();
	});

	it('announces loading only as a status that appears after a delay', async () => {
		const data = fakeData([]);
		data.listOpen.mockImplementationOnce(() => new Promise(() => undefined));
		await showList(data);

		const status = screen.getByRole('status');
		expect(status.textContent).toBe('Tickets werden geladen …');
		expect(status.className).toContain('loading');
	});

	it('renders "Neues Ticket" and other actions in the header', async () => {
		mocks.page.url = new URL('http://localhost:3000/');
		const store = new TicketListStore(fakeData([]), { ensureValid: () => true, logout: vi.fn() });
		const actions = createRawSnippet(() => ({ render: () => '<button>Aktion</button>' }));
		render(TicketList, { props: { store, actions } });

		expect(screen.getByRole('button', { name: 'Aktion' })).toBeTruthy();
	});
});
