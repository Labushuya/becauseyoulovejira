// Component tests for the open tickets in the project list (ADR-0034, addendum "Offene Tickets in
// Projekten"; plan projekte-tickets): a disclosure per row, the list below it (sub projects below
// their own row, indented), "Alle aufklappen" and "Alle zuklappen", the open rows kept on this
// device, live updates from the list store without a request, done tickets and the trash left
// out, nothing rendered for closed rows and no list in the tiles, and the context menus of the
// entries next to the one of the row. Navigation and page state are mocked; the stores run with
// fake data layers.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countActiveByProject, type Project } from '$lib/domain/project';
import { PROJECT_TICKETS_STORAGE_KEY } from '$lib/domain/project-tickets';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import {
	TicketRowActionsStore,
	type TicketRowActionsData
} from '$lib/stores/ticket-row-actions.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useResizeObserverStub } from '$lib/test/resize-observer-stub';
import ProjectsView from './ProjectsView.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/projekte') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();
useResizeObserverStub();

const T0 = '2026-09-24 08:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0
};
const CAR: Project = {
	id: 'proj00000000002',
	name: 'Auto',
	code: 'AUTO',
	archived: false,
	updated: T0
};
const GARDEN: Project = {
	id: 'proj00000000011',
	name: 'Garten',
	code: 'GART',
	archived: false,
	updated: T0,
	parentId: HOUSE.id
};
const SESSION = { ensureValid: () => true, logout: vi.fn() };

let sequence = 0;

function ticket(project: Project, overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `${project.code}-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: project.id,
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

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
	localStorage.clear();
	sessionStorage.clear();
});

async function show(path = '/projekte', { open = [] as TicketSummary[], withMenu = false } = {}) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const catalog = new CatalogStore(
		{
			listProjects: async () => [HOUSE, CAR, GARDEN],
			listTags: async () => [],
			createTag: vi.fn()
		} satisfies CatalogData,
		SESSION
	);
	const listOpen = vi.fn(async () => open);
	const listData: TicketListData = {
		listOpen,
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const tickets = new TicketListStore(listData, SESSION);
	const stats = new ProjectStatsStore({ countDone: vi.fn(async () => 0) }, SESSION);
	await catalog.load();
	tickets.loadOpen();
	const activeOf = (project: Project) =>
		tickets.openState === 'ready'
			? (countActiveByProject(tickets.open).get(project.id) ?? 0)
			: null;
	const totalOf = (project: Project) => activeOf(project);
	const rowData: TicketRowActionsData = {
		get: vi.fn(async (): Promise<Ticket> => ({ ...open[0]!, description: '', sourceItem: null })),
		sources: vi.fn(async () => []),
		commentCount: vi.fn(async () => 0),
		delete: vi.fn(async () => null)
	};
	const rowActions = withMenu
		? new TicketRowActionsStore(rowData, SESSION, tickets, null, new FlagStore())
		: null;
	const view = render(ProjectsView, {
		props: { catalog, tickets, stats, activeOf, totalOf, rowActions }
	});
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { tickets, listOpen, view };
}

const disclosure = (name: string) =>
	screen.getByRole('button', { name: `Offene Tickets von „${name}“` });
const rowOf = (name: string) =>
	screen.getByRole('link', { name }).closest('tr') as HTMLTableRowElement;
const keysIn = (list: HTMLElement) =>
	within(list)
		.getAllByRole('listitem')
		.map((entry) => entry.querySelector('.key')?.textContent);

describe('open tickets in the project list', () => {
	it('opens a row to its open tickets with a disclosure; the focus stays on it', async () => {
		const open = [ticket(CAR, { due: '2026-10-09' }), ticket(CAR, { due: '2026-10-02' })];
		await show('/projekte', { open });
		const button = disclosure('Auto');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(button.hasAttribute('aria-controls')).toBe(false);
		expect(button.closest('td')?.getAttribute('data-col')).toBe('code');
		// Closed rows render no list.
		expect(screen.queryByRole('list')).toBeNull();

		button.focus();
		await fireEvent.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(button.getAttribute('title')).toBe('Offene Tickets ausblenden');
		const cell = document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
		const list = within(cell).getByRole('list', { name: 'Offene Tickets von „Auto“' });
		// Due date first: the ticket due earlier stands first.
		expect(keysIn(list)).toEqual([open[1]!.key, open[0]!.key]);
		// The list is the next row, after the row of its project; the focus stays on the button.
		expect(cell.closest('tr')?.previousElementSibling).toBe(rowOf('Auto'));
		expect(button.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(document.activeElement).toBe(button);
		expect(mocks.goto).not.toHaveBeenCalled();

		await fireEvent.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByRole('list')).toBeNull();
		expect(document.activeElement).toBe(button);
	});

	it('shows the own tickets of a parent and those of a sub project below its own row', async () => {
		const own = ticket(HOUSE);
		const sub = ticket(GARDEN);
		await show('/projekte', { open: [own, sub] });
		await fireEvent.click(disclosure('Haus'));
		await fireEvent.click(disclosure('Garten'));

		const parentList = screen.getByRole('list', { name: 'Offene Tickets direkt in „Haus“' });
		expect(keysIn(parentList)).toEqual([own.key]);
		const subList = screen.getByRole('list', { name: 'Offene Tickets von „Garten“' });
		expect(keysIn(subList)).toEqual([sub.key]);
		// The tree of ADR-0034: Haus, its tickets, Garten, its tickets (indented like Garten).
		const subRow = subList.closest('tr') as HTMLElement;
		expect(subRow.previousElementSibling).toBe(rowOf('Garten'));
		expect(subRow.classList.contains('child')).toBe(true);
		expect(parentList.closest('tr')?.nextElementSibling).toBe(rowOf('Garten'));
	});

	it('links a parent with more than ten to its own tickets in "Aufgaben"', async () => {
		const open = Array.from({ length: 11 }, () => ticket(HOUSE));
		await show('/projekte', { open });
		await fireEvent.click(disclosure('Haus'));

		const list = screen.getByRole('list', { name: 'Offene Tickets direkt in „Haus“' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(10);
		expect(
			screen.getByRole('link', { name: 'Alle 11 in Aufgaben öffnen' }).getAttribute('href')
		).toBe(`/?projekt=${HOUSE.id}&unterprojekte=0`);
	});

	it('leaves done tickets out and follows the list store live, without a request', async () => {
		const first = ticket(CAR);
		const { tickets, listOpen } = await show('/projekte', {
			open: [first, ticket(CAR, { status: 'done' })]
		});
		await fireEvent.click(disclosure('Auto'));
		const list = () => screen.getByRole('list', { name: 'Offene Tickets von „Auto“' });
		expect(keysIn(list())).toEqual([first.key]);

		// A new ticket arrives by realtime.
		const fresh = ticket(CAR, { due: '2026-10-02', updated: '2026-09-24 09:00:00.000Z' });
		tickets.upsert(fresh);
		await tick();
		expect(keysIn(list())).toEqual([fresh.key, first.key]);

		// Done elsewhere: it leaves the list.
		tickets.upsert({ ...fresh, status: 'done', updated: '2026-09-24 10:00:00.000Z' });
		await tick();
		expect(keysIn(list())).toEqual([first.key]);

		// Moved to the trash elsewhere: the delete event removes it.
		tickets.remove(first.id);
		await tick();
		expect(screen.queryByRole('list')).toBeNull();
		expect(screen.getByRole('heading', { level: 3, name: 'Keine offenen Tickets' })).toBeTruthy();
		expect(listOpen).toHaveBeenCalledTimes(1);
	});

	it('opens and closes all rows above the list; the focus stays on the button', async () => {
		sessionStorage.setItem('byl-projects-collapsed', JSON.stringify([HOUSE.id]));
		await show('/projekte', { open: [ticket(CAR), ticket(HOUSE), ticket(GARDEN)] });
		const tools = screen.getByRole('group', { name: 'Offene Tickets' });
		const openAll = within(tools).getByRole('button', { name: 'Alle aufklappen' });
		const closeAll = within(tools).getByRole('button', { name: 'Alle zuklappen' });
		expect(openAll.getAttribute('aria-disabled')).toBe('false');
		expect(closeAll.getAttribute('aria-disabled')).toBe('true');
		// Above the table.
		expect(
			tools.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();

		openAll.focus();
		await fireEvent.click(openAll);
		expect(document.activeElement).toBe(openAll);
		expect(disclosure('Auto').getAttribute('aria-expanded')).toBe('true');
		expect(disclosure('Haus').getAttribute('aria-expanded')).toBe('true');
		expect(openAll.getAttribute('aria-disabled')).toBe('true');
		expect(closeAll.getAttribute('aria-disabled')).toBe('false');
		// The folded sub project opened as well: it shows its tickets once unfolded.
		await fireEvent.click(screen.getByRole('button', { name: 'Unterprojekte von Haus' }));
		expect(disclosure('Garten').getAttribute('aria-expanded')).toBe('true');

		closeAll.focus();
		await fireEvent.click(closeAll);
		expect(document.activeElement).toBe(closeAll);
		expect(screen.queryByRole('list')).toBeNull();
		expect(localStorage.getItem(PROJECT_TICKETS_STORAGE_KEY)).toBeNull();
	});

	it('remembers the open rows on this device', async () => {
		localStorage.setItem(PROJECT_TICKETS_STORAGE_KEY, JSON.stringify([CAR.id]));
		await show('/projekte', { open: [ticket(CAR), ticket(HOUSE)] });
		expect(disclosure('Auto').getAttribute('aria-expanded')).toBe('true');
		expect(screen.getByRole('list', { name: 'Offene Tickets von „Auto“' })).toBeTruthy();
		expect(disclosure('Haus').getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(disclosure('Haus'));
		expect(JSON.parse(localStorage.getItem(PROJECT_TICKETS_STORAGE_KEY) ?? '[]')).toEqual([
			CAR.id,
			HOUSE.id
		]);

		// The next visit shows the same rows open.
		document.body.innerHTML = '';
		await show('/projekte', { open: [ticket(CAR), ticket(HOUSE)] });
		expect(disclosure('Haus').getAttribute('aria-expanded')).toBe('true');
	});

	it('shows no list and no disclosure in the tiles', async () => {
		localStorage.setItem(PROJECT_TICKETS_STORAGE_KEY, JSON.stringify([CAR.id]));
		await show('/projekte?darstellung=kacheln', { open: [ticket(CAR)] });
		expect(screen.queryByRole('button', { name: /Offene Tickets von/ })).toBeNull();
		expect(screen.queryByRole('group', { name: 'Offene Tickets' })).toBeNull();
		expect(screen.queryByRole('list', { name: /Offene Tickets/ })).toBeNull();
	});

	it('opens the menu of an entry on a right click, beside the entries the one of the browser', async () => {
		const item = ticket(CAR);
		await show('/projekte', { open: [item], withMenu: true });
		await fireEvent.click(disclosure('Auto'));
		const entryMenu = screen.getByRole('button', { name: `Weitere Aktionen für ${item.key}` });
		const projectMenu = screen.getByRole('button', { name: 'Weitere Aktionen für „Auto“' });

		const link = screen.getByRole('link', { name: `${item.key} ${item.title}` });
		expect(await fireEvent.contextMenu(link, { button: 2 })).toBe(false);
		await tick();
		expect(entryMenu.getAttribute('aria-expanded')).toBe('true');
		expect(projectMenu.getAttribute('aria-expanded')).toBe('false');

		// Beside the entries, in the row of the list: the browser keeps its menu.
		const cell = link.closest('td') as HTMLElement;
		expect(await fireEvent.contextMenu(cell, { button: 2 })).toBe(true);

		// The row of the project keeps its own menu.
		expect(
			await fireEvent.contextMenu(rowOf('Auto').querySelector('[data-col="code"]')!, { button: 2 })
		).toBe(false);
		await tick();
		expect(projectMenu.getAttribute('aria-expanded')).toBe('true');
	});
});
