// Component tests for the column sort of the ticket table (E3 plan, T-5 and package 9): sort
// buttons in the column headers, the click cycle as URL change, aria-sort, the caption, the row
// order per sort (projects through the catalog), realtime upserts during a sort and back to the
// previous sort. List store and catalog run for real on fake data layers; SvelteKit navigation and
// page state are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseListQuery } from '$lib/domain/list-query';
import type { Project } from '$lib/domain/project';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import TicketTable from './TicketTable.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const UPDATED = '2026-09-01 10:00:00.000Z';
const GARDEN: Project = {
	id: 'proj00000000001',
	name: 'Garten',
	code: 'GAR',
	archived: false,
	updated: UPDATED
};
const HOUSE: Project = {
	id: 'proj00000000002',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: UPDATED
};

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
		updated: UPDATED,
		...overrides
	};
}

function fakeData(open: TicketSummary[]): TicketListData {
	return {
		listOpen: vi.fn(async () => open),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
}

async function showTable(data: TicketListData, path = '/') {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => [GARDEN, HOUSE]),
			listTags: vi.fn(async () => []),
			createTag: vi.fn()
		},
		SESSION
	);
	await catalog.load();
	const store = new TicketListStore(data, SESSION, {
		projectOf: (entry) => catalog.projectOf(entry)
	});
	store.activate(parseListQuery(mocks.page.url.searchParams));
	const result = render(TicketTable, { props: { store, catalog } });
	await vi.advanceTimersByTimeAsync(0);
	return { ...result, store, catalog };
}

/** Navigates like the tickets layout: new URL, the store follows it. */
async function navigate(store: TicketListStore, path: string) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	store.activate(parseListQuery(mocks.page.url.searchParams));
	await tick();
}

function openTitles(): string[] {
	const body = screen.getByRole('rowgroup', { name: 'Offene Tickets' });
	return [...body.querySelectorAll('tr[data-ticket-id]')].map(
		(row) => within(row as HTMLElement).getByRole('link').textContent ?? ''
	);
}

function header(name: RegExp) {
	return screen.getByRole('button', { name }).closest('th') as HTMLElement;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	mocks.goto.mockClear();
	sequence = 0;
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('column sort (E3 plan, package 9)', () => {
	it('has a sort button in every sortable column header, none for tags and actions', async () => {
		await showTable(fakeData([ticket()]));

		for (const column of [
			'Key',
			'Priorität',
			'Status',
			'Titel',
			'Projekt',
			'Fälligkeit',
			'Erstellt'
		]) {
			const button = screen.getByRole('button', { name: `Nach ${column} sortieren` });
			expect(button.getAttribute('type')).toBe('button');
			expect(button.closest('th')?.hasAttribute('aria-sort')).toBe(false);
		}
		const table = screen.getByRole('table');
		const plain = within(table)
			.getAllByRole('columnheader')
			.filter((th) => th.querySelector('button') === null && th.dataset.col !== 'select')
			.map((th) => th.textContent?.trim());
		expect(plain).toEqual(['Tags', 'Aktionen']);
		expect(table.querySelector('caption')?.textContent).toMatch(/Standard-Reihenfolge/);
	});

	it.each([
		['/', /^Nach Priorität sortieren/, '/?sort=prio'],
		['/?sort=prio', /^Nach Priorität sortieren/, '/?sort=-prio'],
		['/?sort=-prio', /^Nach Priorität sortieren/, '/'],
		['/?sort=prio', /^Nach Titel sortieren/, '/?sort=titel'],
		[
			'/?status=open&gruppe=prio',
			/^Nach Erstellt sortieren/,
			'/?status=open&sort=erstellt&gruppe=prio'
		]
	])('on %s, a click on %s navigates to %s', async (from, name, to) => {
		await showTable(fakeData([ticket()]), from);

		await fireEvent.click(screen.getByRole('button', { name }));

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(to, { keepFocus: true, noScroll: true });
	});

	it('marks only the sorted column with aria-sort, an icon and the order in its name', async () => {
		await showTable(fakeData([ticket()]), '/?sort=prio');

		const priority = header(/^Nach Priorität sortieren/);
		expect(priority.getAttribute('aria-sort')).toBe('descending');
		expect(
			screen.getByRole('button', { name: 'Nach Priorität sortieren, sortiert: Dringend zuerst' })
		).toBeTruthy();
		expect(priority.querySelector('svg')?.dataset.direction).toBe('descending');
		expect(header(/^Nach Titel sortieren/).hasAttribute('aria-sort')).toBe(false);
		expect(header(/^Nach Titel sortieren/).querySelector('svg')?.dataset.direction).toBe('none');
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(
			/sortiert nach Priorität, Dringend zuerst/
		);
	});

	it.each([
		['/?sort=-prio', /^Nach Priorität sortieren/, 'ascending', 'Niedrig zuerst'],
		['/?sort=faellig', /^Nach Fälligkeit sortieren/, 'ascending', 'früheste zuerst'],
		['/?sort=-faellig', /^Nach Fälligkeit sortieren/, 'descending', 'späteste zuerst'],
		['/?sort=erstellt', /^Nach Erstellt sortieren/, 'descending', 'neueste zuerst'],
		['/?sort=key', /^Nach Key sortieren/, 'ascending', 'aufsteigend']
	])('%s sets aria-sort to the actual direction', async (path, name, direction, order) => {
		await showTable(fakeData([ticket()]), path);

		expect(header(name).getAttribute('aria-sort')).toBe(direction);
		expect(screen.getByRole('button', { name }).textContent).toContain(`sortiert: ${order}`);
	});

	it('orders the rows by the chosen column, empty values last in both directions', async () => {
		const tickets = [
			ticket({ title: 'Ticket 10', due: '2026-09-30', priority: 'low' }),
			ticket({ title: 'äpfel kaufen', due: null, priority: 'urgent' }),
			ticket({ title: 'Ticket 2', due: '2026-09-25', priority: 'high' })
		];
		const { store } = await showTable(fakeData(tickets), '/?sort=titel');
		expect(openTitles()).toEqual(['äpfel kaufen', 'Ticket 2', 'Ticket 10']);

		await navigate(store, '/?sort=-titel');
		expect(openTitles()).toEqual(['Ticket 10', 'Ticket 2', 'äpfel kaufen']);

		await navigate(store, '/?sort=faellig');
		expect(openTitles()).toEqual(['Ticket 2', 'Ticket 10', 'äpfel kaufen']);
		await navigate(store, '/?sort=-faellig');
		expect(openTitles()).toEqual(['Ticket 10', 'Ticket 2', 'äpfel kaufen']);

		await navigate(store, '/?sort=prio');
		expect(openTitles()).toEqual(['äpfel kaufen', 'Ticket 2', 'Ticket 10']);
	});

	it('restores the previous sort and the default order when going back', async () => {
		const tickets = [ticket({ title: 'B', priority: 'urgent' }), ticket({ title: 'A' })];
		const { store } = await showTable(fakeData(tickets), '/?sort=titel');
		expect(openTitles()).toEqual(['A', 'B']);

		await navigate(store, '/?sort=-titel');
		expect(openTitles()).toEqual(['B', 'A']);
		await navigate(store, '/?sort=titel');
		expect(openTitles()).toEqual(['A', 'B']);
		await navigate(store, '/');
		expect(openTitles()).toEqual(['B', 'A']);
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(
			/Standard-Reihenfolge/
		);
	});

	it('sorts projects by name through the catalog and follows a rename', async () => {
		const tickets = [
			ticket({ title: 'im Haus', projectId: HOUSE.id }),
			ticket({ title: 'ohne' }),
			ticket({ title: 'im Garten', projectId: GARDEN.id })
		];
		const { catalog } = await showTable(fakeData(tickets), '/?sort=projekt');
		expect(openTitles()).toEqual(['im Garten', 'im Haus', 'ohne']);

		catalog.upsertProject({ ...GARDEN, name: 'Wohnung', updated: '2026-09-24 10:00:00.000Z' });
		await tick();
		expect(openTitles()).toEqual(['im Haus', 'im Garten', 'ohne']);
	});

	it('puts a ticket from a realtime event at its place in the chosen sort', async () => {
		const { store } = await showTable(
			fakeData([ticket({ title: 'Alpha' }), ticket({ title: 'Delta' })]),
			'/?sort=titel'
		);

		store.upsert(ticket({ title: 'Charlie' }));
		await tick();
		expect(openTitles()).toEqual(['Alpha', 'Charlie', 'Delta']);

		const bravo = ticket({ title: 'Zulu' });
		store.upsert(bravo);
		store.upsert({ ...bravo, title: 'Bravo', updated: '2026-09-24 10:00:00.000Z' });
		await tick();
		expect(openTitles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
	});

	it('keeps the keyboard focus on the sort button', async () => {
		await showTable(fakeData([ticket()]));

		const button = screen.getByRole('button', { name: /^Nach Status sortieren/ });
		button.focus();
		await fireEvent.click(button);

		expect(document.activeElement).toBe(button);
		expect(mocks.goto).toHaveBeenCalledWith('/?sort=status', { keepFocus: true, noScroll: true });
	});
});
