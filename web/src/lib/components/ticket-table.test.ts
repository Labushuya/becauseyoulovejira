// Component tests for the ticket table (E3 plan, T-4 and package 5; the list behaviour of E2
// package 5 carried over): table structure, section bar, empty states, the switch "Erledigte
// anzeigen" in the URL, check mark with undo and focus, loading errors, "Weitere laden", the
// click on a row and project and tags from the catalog. List store and catalog run for real on
// fake data layers; SvelteKit navigation and page state are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick, type Snippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DoneTicketPage } from '$lib/data/tickets';
import { parseListQuery } from '$lib/domain/list-query';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FLAG_DURATION_MS, FlagStore } from '$lib/stores/flags.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { QUICK_CAPTURE_CONTEXT } from '$lib/quick-capture-context';
import { NEW_TICKET_LINK_ID } from '$lib/ticket-links';
import FlagGroup from './overlay/FlagGroup.svelte';
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
		source: null,
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
		searchOpen: vi.fn(async (): Promise<string[]> => []),
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
	catalogContent: { projects?: Project[]; tags?: Tag[] } = {},
	context?: Map<unknown, unknown>,
	emptyExtra?: Snippet
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const flags = new FlagStore();
	const store = new TicketListStore(data, SESSION, { flags });
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => catalogContent.projects ?? []),
			listTags: vi.fn(async () => catalogContent.tags ?? []),
			createTag: vi.fn()
		},
		SESSION
	);
	void catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	const result = render(TicketTable, { props: { store, catalog, emptyExtra }, context });
	// The flags of the app layout, after the table like after `main` (ADR-0025 section 8).
	render(FlagGroup, { props: { store: flags } });
	await vi.advanceTimersByTimeAsync(0);
	return { ...result, store, catalog, flags };
}

/** The flag section bottom left. */
function flagSection() {
	return within(screen.getByRole('region', { name: 'Benachrichtigungen' }));
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
	// Creation dates are days of September: every test starts with fresh numbers.
	sequence = 0;
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('ticket table', () => {
	// Since UI-6b the table no longer scrolls sideways in a focusable region; it hides the columns
	// marked with data-col through container queries of its frame (table-columns.test.ts).
	it('is a table with caption, column headers and columns that give way', async () => {
		await showTable(fakeData([ticket()]));

		const table = screen.getByRole('table', { name: /^Tickets/ });
		expect(table.querySelector('caption')?.textContent).toMatch(
			/Tickets\s*·\s*Standard-Reihenfolge/
		);
		// Visible text of each header (sortable ones: the text of their button) and its scope.
		const headers = within(table)
			.getAllByRole('columnheader')
			.map((header) => [
				(header.querySelector('[aria-hidden="true"]') ?? header).textContent?.trim(),
				header.getAttribute('scope')
			]);
		expect(headers).toEqual([
			['Key', 'col'],
			['Prio', 'col'],
			['Status', 'col'],
			['Titel', 'col'],
			['Projekt', 'col'],
			['Tags', 'col'],
			['Fällig', 'col'],
			['Erstellt', 'col'],
			['Aktionen', 'col']
		]);
		expect(screen.queryByRole('region', { name: /^Tickets/ })).toBeNull();
		expect(table.parentElement?.classList.contains('frame')).toBe(true);
		// Key, priority, status, title and the actions with the check mark always stay.
		const marks = (cells: Element[]) => cells.map((cell) => cell.getAttribute('data-col'));
		expect(marks(within(table).getAllByRole('columnheader'))).toEqual([
			null,
			null,
			null,
			null,
			'project',
			'tags',
			'due',
			'created',
			null
		]);
		const row = table.querySelector('tr[data-ticket-id]') as HTMLElement;
		expect(marks([...row.children])).toEqual([
			null,
			null,
			null,
			null,
			'project',
			'tags',
			'due',
			'created',
			null
		]);
		expect(table.querySelector('caption')?.textContent).toMatch(/Weitere Spalten im Panel$/);
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

	it('has the switch "Aufgaben | Projekte" in the section bar (package 14)', async () => {
		await showTable(fakeData([ticket()]));

		const nav = screen.getByRole('navigation', { name: 'Ansicht' });
		expect(nav.closest('.start')).not.toBeNull();
		expect(within(nav).getByRole('link', { name: 'Aufgaben' }).getAttribute('aria-current')).toBe(
			'page'
		);
		expect(within(nav).getByRole('link', { name: 'Projekte' }).getAttribute('href')).toBe(
			'/projekte'
		);
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

		// Empty state since EH-11: heading, one sentence, the primary action as a verb.
		expect(screen.getByRole('heading', { level: 3, name: 'Keine offenen Tickets' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Ticket anlegen' }).getAttribute('href')).toBe(
			'/tickets/neu?erledigte=1'
		);
		// Without the (app) layout there is no quick entry to offer.
		expect(screen.queryByRole('button', { name: /Schnellerfassung/ })).toBeNull();
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

	it('offers the quick entry of the layout in the empty state (EH-11)', async () => {
		const open = vi.fn();
		await showTable(fakeData([]), '/', {}, new Map([[QUICK_CAPTURE_CONTEXT, open]]));

		const quick = screen.getByRole('button', { name: /Schnellerfassung/ });
		expect(quick.classList.contains('button-subtle')).toBe(true);
		expect(quick.querySelector('kbd')?.textContent).toBe('c');
		await fireEvent.click(quick);
		expect(open).toHaveBeenCalledOnce();
		// Exactly one primary action.
		const empty = quick.closest('.empty-state') as HTMLElement;
		expect(empty.querySelectorAll('.button-primary')).toHaveLength(1);
	});

	it('shows "Erste Schritte" below the empty state, not below an empty filter result (EH-12)', async () => {
		const extra = createRawSnippet(() => ({ render: () => '<p>Erste Schritte hier</p>' }));
		await showTable(fakeData([]), '/', {}, undefined, extra);
		expect(screen.getByText('Erste Schritte hier')).toBeTruthy();

		document.body.innerHTML = '';
		await showTable(fakeData([ticket()]), '/?prio=urgent', {}, undefined, extra);
		expect(screen.getByRole('heading', { name: 'Keine Tickets für diese Filter' })).toBeTruthy();
		expect(screen.queryByText('Erste Schritte hier')).toBeNull();
	});

	it('shows no table without open tickets and without done tickets', async () => {
		await showTable(fakeData([]));

		expect(screen.getByText('Keine offenen Tickets')).toBeTruthy();
		expect(screen.queryByRole('table')).toBeNull();
	});

	it('turns the switch into the URL parameter and back', async () => {
		await showTable(fakeData([]));
		const toggle = screen.getByRole<HTMLInputElement>('switch', {
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
		const toggle = screen.getByRole<HTMLInputElement>('switch', {
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

	it('checks a ticket, removes the row and restores the previous status from the flag (UI-5)', async () => {
		const item = ticket({ status: 'waiting' });
		const data = fakeData([item]);
		await showTable(data);

		await fireEvent.click(screen.getByRole('checkbox', { name: `${item.key} erledigt` }));
		await vi.advanceTimersByTimeAsync(0);
		expect(data.setDone).toHaveBeenCalledWith(item.id, true);
		expect(screen.queryByRole('rowgroup', { name: 'Offene Tickets' })).toBeNull();
		expect(screen.getByText('0 Tickets')).toBeTruthy();
		// No "Rückgängig" in the table; it stands in the flag bottom left.
		expect(
			within(screen.getByRole('region', { name: /Aufgaben/ })).queryByRole('button', {
				name: /Rückgängig/
			})
		).toBeNull();
		const flag = flagSection().getByRole('listitem');
		expect(flag.textContent).toContain(`${item.key} erledigt.`);
		expect(flagSection().getByRole('status').textContent).toContain(`${item.key} erledigt.`);

		await fireEvent.click(flagSection().getByRole('button', { name: 'Rückgängig' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(data.update).toHaveBeenCalledWith(item.id, { status: 'waiting' });
		expect(within(openRows()[0]!).getByText('Wartet')).toBeTruthy();
		expect(flagSection().queryByRole('button', { name: 'Rückgängig' })).toBeNull();
		expect(flagSection().getByRole('listitem').textContent).toContain(
			`${item.key} ist wieder offen.`
		);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('offers "Rückgängig" for 8 s, longer while the pointer rests on the flag', async () => {
		const item = ticket();
		await showTable(fakeData([item]));
		await fireEvent.click(screen.getByRole('checkbox', { name: `${item.key} erledigt` }));
		await vi.advanceTimersByTimeAsync(0);

		await fireEvent.pointerEnter(screen.getByRole('region', { name: 'Benachrichtigungen' }));
		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS * 2);
		expect(flagSection().getByRole('button', { name: 'Rückgängig' })).toBeTruthy();
		await fireEvent.pointerLeave(screen.getByRole('region', { name: 'Benachrichtigungen' }));
		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS);
		expect(flagSection().queryByRole('button', { name: 'Rückgängig' })).toBeNull();
	});

	it('moves the focus to the next row when a checked row goes away, never to the flag', async () => {
		const first = ticket({ priority: 'urgent' });
		const second = ticket();
		await showTable(fakeData([first, second]));

		const toggle = screen.getByRole('checkbox', { name: `${first.key} erledigt` });
		toggle.focus();
		await fireEvent.click(toggle);
		await vi.advanceTimersByTimeAsync(0);
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

	it('springs back and shows an error flag when checking fails (UI-5)', async () => {
		const item = ticket();
		const data = fakeData([item]);
		data.setDone.mockRejectedValueOnce(new DataError('network'));
		await showTable(data);

		const toggle = screen.getByRole<HTMLInputElement>('checkbox', { name: `${item.key} erledigt` });
		toggle.focus();
		await fireEvent.click(toggle);
		await vi.advanceTimersByTimeAsync(0);

		expect(toggle.checked).toBe(false);
		expect(document.activeElement).toBe(toggle);
		const flag = flagSection().getByRole('listitem');
		expect(flag.classList.contains('tone-error')).toBe(true);
		expect(flag.textContent).toMatch(/konnte nicht geändert werden/);
		expect(flag.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
		expect(flagSection().getByRole('alert').textContent).toMatch(/konnte nicht geändert werden/);
		// Errors stay until they are closed.
		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS * 2);
		await fireEvent.click(
			flagSection().getByRole('button', { name: 'Benachrichtigung schließen' })
		);
		expect(flagSection().queryByRole('listitem')).toBeNull();
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

		const table = within(screen.getByRole('region', { name: /Aufgaben/ }));
		const status = table.getByRole('status');
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

describe('ticket table: filters (E3 plan, package 10)', () => {
	it('shows only the tickets that pass the filters and counts them', async () => {
		const urgent = ticket({ priority: 'urgent' });
		await showTable(fakeData([urgent, ticket(), ticket()]), '/?prio=urgent');

		expect(openRows().map((row) => row.dataset.ticketId)).toEqual([urgent.id]);
		expect(screen.getByText('1 Ticket')).toBeTruthy();
	});

	it('tells an empty filter result apart from an empty list and resets the filters', async () => {
		await showTable(fakeData([ticket()]), '/?prio=urgent&sort=titel&erledigte=1');

		expect(screen.getByRole('heading', { name: 'Keine Tickets für diese Filter' })).toBeTruthy();
		expect(screen.queryByText('Keine offenen Tickets')).toBeNull();
		const reset = screen.getAllByRole('button', { name: 'Filter zurücksetzen' })[0]!;
		// The only action of the empty result is the primary one (EH-11).
		expect(reset.classList.contains('button-primary')).toBe(true);
		await fireEvent.click(reset);

		expect(mocks.goto).toHaveBeenCalledWith('/?sort=titel&erledigte=1', {
			keepFocus: true,
			noScroll: true
		});
		expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Aufgaben' }));
	});

	it('shows an empty result for an unknown project', async () => {
		await showTable(fakeData([ticket()]), '/?projekt=zzzzzzzzzzzzzzz');

		expect(screen.queryByRole('table')).toBeNull();
		expect(screen.getByRole('heading', { name: 'Keine Tickets für diese Filter' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Filter zurücksetzen' })).toBeTruthy();
	});

	it('shows only the section "Erledigt" with the status filter "Erledigt"', async () => {
		const finished = ticket({ status: 'done', completedAt: '2026-09-20 10:00:00.000Z' });
		await showTable(fakeData([ticket()], [[finished]]), '/?status=done');

		expect(screen.queryByRole('rowgroup', { name: 'Offene Tickets' })).toBeNull();
		expect(within(doneBody()).getByText(finished.title)).toBeTruthy();
		expect(screen.getByText('1 Ticket')).toBeTruthy();
		const toggle = screen.getByRole('switch', { name: 'Erledigte anzeigen' });
		expect(toggle).toHaveProperty('checked', true);
		expect(toggle.getAttribute('aria-disabled')).toBe('true');
		expect(
			document.getElementById(String(toggle.getAttribute('aria-describedby')))?.textContent
		).toBe('Der Statusfilter „Erledigt“ zeigt nur erledigte Tickets.');
	});

	it('offers "Filter zurücksetzen" when no done ticket passes the filters', async () => {
		await showTable(fakeData([ticket()], [[]]), '/?status=done&prio=low');

		expect(within(doneBody()).getByText('Keine Tickets für diese Filter.')).toBeTruthy();
		expect(within(doneBody()).getByRole('button', { name: 'Filter zurücksetzen' })).toBeTruthy();
	});

	it('locks the switch "Erledigte anzeigen" with another status filter', async () => {
		await showTable(fakeData([ticket()], [[]]), '/?status=open&erledigte=1');

		expect(screen.queryByRole('rowgroup', { name: /^Erledigt/ })).toBeNull();
		const toggle = screen.getByRole('switch', { name: 'Erledigte anzeigen' });
		expect(toggle).toHaveProperty('checked', false);
		expect(toggle.getAttribute('aria-disabled')).toBe('true');
		expect(
			document.getElementById(String(toggle.getAttribute('aria-describedby')))?.textContent
		).toMatch(/erledigte Tickets ausgeblendet/);

		await fireEvent.click(toggle);
		expect(toggle).toHaveProperty('checked', false);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('announces the new number after a filter change', async () => {
		const { store } = await showTable(fakeData([ticket({ priority: 'high' }), ticket()]));

		store.activate({ ...store.query, priority: 'high' });
		await tick();

		expect(screen.getByText('1 Ticket.').getAttribute('aria-live') ?? '').toBe('polite');
	});
});

describe('ticket table: grouping (E3 plan, package 13)', () => {
	/** Group bodies of the open tickets with their heading. */
	function groupBodies() {
		return [...document.querySelectorAll<HTMLElement>('tbody[data-group]')];
	}

	function groupTitles(body: HTMLElement): string[] {
		return [...body.querySelectorAll<HTMLElement>('tr[data-ticket-id]')].map(
			(row) => titleLink(row).textContent ?? ''
		);
	}

	it('shows one tbody per group with a rowgroup heading, label and number', async () => {
		const waiting = ticket({ status: 'waiting', title: 'Warten' });
		const open = ticket({ title: 'Offen eins' });
		const second = ticket({ title: 'Offen zwei', priority: 'high' });
		await showTable(fakeData([waiting, open, second]), '/?gruppe=status');

		expect(screen.queryByRole('rowgroup', { name: 'Offene Tickets' })).toBeNull();
		const bodies = groupBodies();
		expect(bodies.map((body) => body.dataset.group)).toEqual(['open', 'waiting']);
		expect(screen.getByRole('rowgroup', { name: 'Offen, 2 Tickets' })).toBe(bodies[0]);
		expect(screen.getByRole('rowgroup', { name: 'Wartet, 1 Ticket' })).toBe(bodies[1]);
		const head = within(bodies[0]!).getByRole('rowheader', { name: 'Offen, 2 Tickets' });
		expect(head.getAttribute('scope')).toBe('rowgroup');
		expect(head.getAttribute('colspan')).toBe('9');
		expect(groupTitles(bodies[0]!)).toEqual(['Offen zwei', 'Offen eins']);
		expect(screen.getByText('3 Tickets')).toBeTruthy();
		expect(document.querySelector('caption')?.textContent).toMatch(
			'Standard-Reihenfolge · gruppiert nach Status'
		);
	});

	it('keeps filters and the column sort within the groups', async () => {
		const items = [
			ticket({ title: 'B', priority: 'high', projectId: HOUSE.id, project: HOUSE }),
			ticket({ title: 'A', priority: 'high', projectId: HOUSE.id, project: HOUSE }),
			ticket({ title: 'C', priority: 'low' }),
			ticket({ title: 'D', priority: 'urgent', status: 'waiting' })
		];
		await showTable(fakeData(items), '/?status=open&sort=titel&gruppe=projekt', {
			projects: [HOUSE]
		});
		await vi.advanceTimersByTimeAsync(0);

		const bodies = groupBodies();
		expect(bodies.map((body) => body.dataset.group)).toEqual([HOUSE.id, 'ohne']);
		expect(groupTitles(bodies[0]!)).toEqual(['A', 'B']);
		expect(groupTitles(bodies[1]!)).toEqual(['C']);
		expect(screen.getByRole('rowgroup', { name: 'Haushalt, 2 Tickets' })).toBeTruthy();
		expect(screen.getByRole('rowgroup', { name: 'Ohne Projekt, 1 Ticket' })).toBeTruthy();
	});

	it('follows a change of the URL and leaves the section "Erledigt" ungrouped', async () => {
		const open = ticket({ due: '2026-09-20' });
		const later = ticket();
		const doneItem = ticket({ status: 'done', completedAt: '2026-09-23 10:00:00.000Z' });
		const { store } = await showTable(fakeData([open, later], [[doneItem]]), '/?erledigte=1');
		expect(groupBodies()).toEqual([]);

		mocks.page.url = new URL('/?gruppe=faellig&erledigte=1', 'http://localhost:3000');
		store.activate(parseListQuery(mocks.page.url.searchParams));
		await tick();

		expect(groupBodies().map((body) => body.dataset.group)).toEqual(['overdue', 'none']);
		expect(doneBody().hasAttribute('data-group')).toBe(false);
		expect(within(doneBody()).getAllByRole('rowheader')[0]?.textContent?.trim()).toBe(
			'Erledigt – zuletzt erledigte zuerst'
		);
	});

	it('removes a checked row from its group at once (UI-5)', async () => {
		const waiting = ticket({ status: 'waiting', title: 'Warten' });
		const open = ticket({ title: 'Offen' });
		await showTable(fakeData([waiting, open]), '/?gruppe=status');

		await fireEvent.click(screen.getByRole('checkbox', { name: `${waiting.key} erledigt` }));
		await vi.advanceTimersByTimeAsync(0);
		await tick();

		expect(groupBodies().map((body) => body.dataset.group)).toEqual(['open']);
	});

	it('moves the focus to the next row when the last row of a group goes away', async () => {
		const first = ticket({ status: 'in_progress', title: 'Einzige in Arbeit' });
		const second = ticket({ status: 'waiting', title: 'Wartet' });
		await showTable(fakeData([first, second]), '/?gruppe=status');

		const toggle = screen.getByRole('checkbox', { name: `${first.key} erledigt` });
		toggle.focus();
		await fireEvent.click(toggle);
		await vi.advanceTimersByTimeAsync(0);
		await tick();

		expect(groupBodies().map((body) => body.dataset.group)).toEqual(['waiting']);
		expect(document.activeElement?.textContent).toBe('Wartet');
	});

	it('restores the previous status into its group with "Rückgängig" in the flag', async () => {
		const waiting = ticket({ status: 'waiting', title: 'Warten' });
		const data = fakeData([waiting]);
		await showTable(data, '/?gruppe=status');

		await fireEvent.click(screen.getByRole('checkbox', { name: `${waiting.key} erledigt` }));
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.click(flagSection().getByRole('button', { name: 'Rückgängig' }));
		await vi.advanceTimersByTimeAsync(0);

		expect(data.update).toHaveBeenCalledWith(waiting.id, { status: 'waiting' });
		expect(screen.getByRole('rowgroup', { name: 'Wartet, 1 Ticket' })).toBeTruthy();
	});
});

describe('ticket table: new (E4 plan, package 4)', () => {
	async function showWithReads() {
		const fresh = ticket({ title: 'Neu aus dem Eingang', created: '2026-09-25 10:00:00.000Z' });
		const old = ticket({ title: 'Alt', created: '2026-09-01 10:00:00.000Z' });
		const reads = {
			unreadSince: () => '2026-09-20 00:00:00.000Z',
			list: vi.fn(async () => []),
			markRead: vi.fn(async (id: string) => ({ id: 'read00000000001', ticket: id })),
			markAllRead: vi.fn(async () => '2026-09-26 00:00:00.000Z')
		};
		mocks.page.url = new URL('/', 'http://localhost:3000');
		const flags = new FlagStore();
		const store = new TicketListStore(fakeData([fresh, old]), SESSION, { reads, flags });
		const catalog = new CatalogStore(
			{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
			SESSION
		);
		store.activate(parseListQuery(mocks.page.url.searchParams));
		render(TicketTable, { props: { store, catalog } });
		render(FlagGroup, { props: { store: flags } });
		await vi.advanceTimersByTimeAsync(0);
		return { store, reads, fresh, old };
	}

	it('marks new rows and offers "Alle als gelesen markieren"', async () => {
		const { reads, fresh, old } = await showWithReads();
		const rowOf = (title: string) =>
			screen.getByRole('link', { name: title }).closest('tr') as HTMLElement;
		expect(rowOf(fresh.title).querySelector('.new-dot')).toBeTruthy();
		expect(rowOf(old.title).querySelector('.new-dot')).toBeNull();

		const button = screen.getByRole('button', {
			name: 'Alle als gelesen markieren, 1 neues Ticket'
		});
		await fireEvent.click(button);
		await vi.advanceTimersByTimeAsync(0);
		expect(reads.markAllRead).toHaveBeenCalledOnce();
		expect(rowOf(fresh.title).querySelector('.new-dot')).toBeNull();
		expect(screen.queryByRole('button', { name: /Alle als gelesen markieren/ })).toBeNull();
		expect(flagSection().getByRole('listitem').textContent).toContain(
			'Alle Tickets als gelesen markiert.'
		);
	});
});
