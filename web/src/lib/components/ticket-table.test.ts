// Component tests for the ticket table (E3 plan, T-4 and package 5; the list behaviour of E2
// package 5 carried over): table structure, section bar, empty states, the switch "Erledigte
// anzeigen" in the URL, check mark with undo and focus, loading errors, "Weitere laden", the
// click on a row and project and tags from the catalog. List store and catalog run for real on
// fake data layers; SvelteKit navigation and page state are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DoneTicketPage } from '$lib/data/tickets';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import {
	TicketListStore,
	UNDO_WINDOW_MS,
	type TicketListData
} from '$lib/stores/ticket-list.svelte';
import { NEW_TICKET_LINK_ID } from '$lib/ticket-links';
import TicketTable from './TicketTable.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false,
	updated: '2026-09-01 10:00:00.000Z'
};
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: '2026-09-01 10:00:00.000Z' };

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

async function showTable(
	data: TicketListData,
	path = '/',
	catalogContent: { projects?: Project[]; tags?: Tag[] } = {}
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const store = new TicketListStore(data, SESSION);
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => catalogContent.projects ?? []),
			listTags: vi.fn(async () => catalogContent.tags ?? [])
		},
		SESSION
	);
	void catalog.load();
	store.activate(mocks.page.url.searchParams.get('erledigte') === '1');
	const result = render(TicketTable, { props: { store, catalog } });
	await vi.advanceTimersByTimeAsync(0);
	return { ...result, store, catalog };
}

function openBody() {
	return screen.getByRole('rowgroup', { name: 'Offene Tickets' });
}

function openRows() {
	return [...openBody().querySelectorAll<HTMLElement>('tr[data-ticket-id]')];
}

function titleLink(row: HTMLElement) {
	return within(row).getByRole('link');
}

function doneBody() {
	return screen.getByRole('rowgroup', { name: 'Erledigt – zuletzt erledigte zuerst' });
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	mocks.goto.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('ticket table', () => {
	it('is a table with caption, column headers and a scrollable named region', async () => {
		await showTable(fakeData([ticket()]));

		const table = screen.getByRole('table', { name: /^Tickets/ });
		expect(table.querySelector('caption')?.textContent).toMatch(
			/Tickets\s*·\s*Standard-Reihenfolge/
		);
		const headers = within(table)
			.getAllByRole('columnheader')
			.map((header) => [header.textContent?.trim(), header.getAttribute('scope')]);
		expect(headers).toEqual([
			['Key', 'col'],
			['PrioPriorität', 'col'],
			['Status', 'col'],
			['Titel', 'col'],
			['Projekt', 'col'],
			['Tags', 'col'],
			['Fällig', 'col'],
			['Erstellt', 'col'],
			['Aktionen', 'col']
		]);
		const region = screen.getByRole('region', { name: /^Tickets/ });
		expect(region.getAttribute('tabindex')).toBe('0');
		expect(region.contains(table)).toBe(true);
	});

	it('shows the open tickets in the default order under "Aufgaben" with their number', async () => {
		const low = ticket({ priority: 'low' });
		const overdue = ticket({ due: '2026-09-01' });
		const urgent = ticket({ priority: 'urgent' });
		await showTable(fakeData([low, overdue, urgent]));

		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Aufgaben');
		expect(screen.getByText('3 Tickets')).toBeTruthy();
		expect(openRows().map((row) => titleLink(row).textContent)).toEqual([
			overdue.title,
			urgent.title,
			low.title
		]);
		expect(screen.queryByRole('rowgroup', { name: /^Erledigt/ })).toBeNull();
	});

	it('resolves project and tags through the catalog and follows a rename', async () => {
		const item = ticket({
			projectId: HOUSE.id,
			tagIds: [GARDEN.id],
			project: { ...HOUSE, name: 'Alter Name' },
			tags: [{ id: GARDEN.id, name: 'alt' }]
		});
		const { catalog } = await showTable(fakeData([item]), '/', {
			projects: [HOUSE],
			tags: [GARDEN]
		});

		const row = openRows()[0]!;
		expect(within(row).getByText('Haushalt')).toBeTruthy();
		expect(within(row).getByText('Garten')).toBeTruthy();

		catalog.upsertProject({ ...HOUSE, name: 'Wohnung', updated: '2026-09-24 10:00:00.000Z' });
		catalog.upsertTag({ ...GARDEN, name: 'Balkon', updated: '2026-09-24 10:00:00.000Z' });
		await tick();

		expect(within(row).getByText('Wohnung')).toBeTruthy();
		expect(within(row).getByText('Balkon')).toBeTruthy();
	});

	it('falls back to the expanded project and tags while the catalog does not know them', async () => {
		const item = ticket({
			projectId: HOUSE.id,
			tagIds: [GARDEN.id],
			project: HOUSE,
			tags: [GARDEN]
		});
		await showTable(fakeData([item]));

		const row = openRows()[0]!;
		expect(within(row).getByText('Haushalt')).toBeTruthy();
		expect(within(row).getByText('Garten')).toBeTruthy();
	});

	it('keeps the query in the row links', async () => {
		const item = ticket();
		await showTable(fakeData([item], [[]]), '/?erledigte=1');

		expect(titleLink(openRows()[0]!).getAttribute('href')).toBe(`/tickets/${item.id}?erledigte=1`);
	});

	it('opens the panel on a click in the row, but not on a click on the check mark', async () => {
		const item = ticket();
		await showTable(fakeData([item]), '/?erledigte=1');

		await fireEvent.click(openRows()[0]!.querySelector('.key')!);
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(`/tickets/${item.id}?erledigte=1`);

		mocks.goto.mockClear();
		await fireEvent.click(screen.getByRole('checkbox', { name: `${item.key} erledigt` }));
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('shows the empty states', async () => {
		await showTable(fakeData([], [[]]), '/?erledigte=1');

		expect(screen.getByText('Keine offenen Tickets.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Neues Ticket' }).getAttribute('href')).toBe(
			'/tickets/neu?erledigte=1'
		);
		expect(screen.getByText('0 Tickets')).toBeTruthy();
		expect(within(doneBody()).getByText('Noch keine erledigten Tickets.')).toBeTruthy();
	});

	it('changes the due labels at the Berlin midnight without a reload (package 6)', async () => {
		// 23:59 in Berlin (CEST).
		vi.setSystemTime(Date.UTC(2026, 8, 24, 21, 59));
		const item = ticket({ due: '2026-09-25' });
		const { store } = await showTable(fakeData([item]));
		const stop = store.start();
		const label = () => openRows()[0]!.querySelector('.due time')?.textContent;
		expect(label()).toBe('morgen, 25.09.2026');

		await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

		expect(label()).toBe('heute, 25.09.2026');
		stop();
	});

	it('shows no table without open tickets and without done tickets', async () => {
		await showTable(fakeData([]));

		expect(screen.getByText('Keine offenen Tickets.')).toBeTruthy();
		expect(screen.queryByRole('table')).toBeNull();
	});

	it('turns the switch into the URL parameter and back', async () => {
		await showTable(fakeData([]));
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
		await showTable(fakeData([], [[]]), '/?erledigte=1');
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
		await showTable(data, '/?erledigte=1');

		const section = doneBody();
		const header = within(section).getByRole('rowheader', { name: /^Erledigt/ });
		expect(header.getAttribute('scope')).toBe('rowgroup');
		expect(section.querySelectorAll('tr[data-ticket-id]')).toHaveLength(1);
		await fireEvent.click(within(section).getByRole('button', { name: 'Weitere laden' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(section.querySelectorAll('tr[data-ticket-id]')).toHaveLength(2);
		expect(within(section).queryByRole('button', { name: 'Weitere laden' })).toBeNull();
	});

	it('checks a ticket, keeps the row with "Rückgängig" and restores the previous status', async () => {
		const item = ticket({ status: 'waiting' });
		const data = fakeData([item]);
		await showTable(data);

		await fireEvent.click(screen.getByRole('checkbox', { name: `${item.key} erledigt` }));
		await vi.advanceTimersByTimeAsync(0);
		expect(data.setDone).toHaveBeenCalledWith(item.id, true);
		expect(screen.getByText(`${item.key} erledigt. Rückgängig ist kurz möglich.`)).toBeTruthy();
		// A just checked row counts as done.
		expect(screen.getByText('0 Tickets')).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', { name: `Rückgängig: ${item.key} wieder öffnen` })
		);
		await vi.advanceTimersByTimeAsync(0);

		expect(data.update).toHaveBeenCalledWith(item.id, { status: 'waiting' });
		expect(within(openRows()[0]!).getByText('Wartet')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('moves the focus to the next row when a checked row goes away', async () => {
		const first = ticket({ priority: 'urgent' });
		const second = ticket();
		await showTable(fakeData([first, second]));

		const toggle = screen.getByRole('checkbox', { name: `${first.key} erledigt` });
		toggle.focus();
		await fireEvent.click(toggle);
		await vi.advanceTimersByTimeAsync(0);
		screen.getByRole('button', { name: `Rückgängig: ${first.key} wieder öffnen` }).focus();

		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		await tick();

		expect(openRows()).toHaveLength(1);
		expect(document.activeElement).toBe(titleLink(openRows()[0]!));
	});

	it('marks the row of the open panel and returns the focus to it when the panel closes', async () => {
		const first = ticket({ priority: 'urgent' });
		const second = ticket();
		const { rerender } = await showTable(fakeData([first, second]));

		await rerender({ activeId: second.id });
		const link = titleLink(openRows()[1]!);
		expect(link.getAttribute('aria-current')).toBe('page');

		(document.activeElement as HTMLElement | null)?.blur();
		await rerender({ activeId: null });
		await tick();

		expect(link.getAttribute('aria-current')).toBeNull();
		expect(document.activeElement).toBe(link);
	});

	it('returns the focus to the heading when the row of the closed panel is gone', async () => {
		const { rerender } = await showTable(fakeData([ticket()]));

		await rerender({ activeId: 'gone00000000000' });
		await rerender({ activeId: null });
		await tick();

		expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Aufgaben' }));
	});

	it('keeps the focus where it is when another row opens the panel', async () => {
		const first = ticket({ priority: 'urgent' });
		const second = ticket();
		const { rerender } = await showTable(fakeData([first, second]));

		await rerender({ activeId: first.id });
		const link = titleLink(openRows()[1]!);
		link.focus();
		await rerender({ activeId: second.id });
		await tick();

		expect(document.activeElement).toBe(link);
	});

	it('keeps the focus on the check mark when an unchecked ticket moves up', async () => {
		const closed = ticket({ status: 'done', completedAt: '2026-09-20 10:00:00.000Z' });
		await showTable(fakeData([], [[closed]]), '/?erledigte=1');

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
		await showTable(data);

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
		await showTable(data);

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
		await showTable(data);

		const status = screen.getByRole('status');
		expect(status.textContent).toBe('Tickets werden geladen …');
		expect(status.className).toContain('loading');
		// No number while loading.
		expect(screen.queryByText(/\d+ Tickets?$/)).toBeNull();
	});

	it('offers no "Neues Ticket" of its own while there are tickets (the header has it)', async () => {
		await showTable(fakeData([ticket()]));

		expect(screen.queryByRole('link', { name: 'Neues Ticket' })).toBeNull();
	});

	it('returns the focus to "Neues Ticket" in the header when the form closes without a ticket', async () => {
		const header = document.createElement('a');
		header.id = NEW_TICKET_LINK_ID;
		header.href = '/tickets/neu';
		document.body.append(header);
		const { rerender } = await showTable(fakeData([ticket()]));

		await rerender({ creating: true });
		(document.activeElement as HTMLElement | null)?.blur();
		await rerender({ creating: false });
		await tick();

		expect(document.activeElement).toBe(header);
	});
});
