// Component tests for the project view (E3 plan, T-3, T-12 and package 14; package UI-8; user
// request after EH-4): section bar with the switch "Aufgaben | Projekte | Eingang" first, the
// search, "Archivierte anzeigen" and the layout buttons "Liste | Kacheln"; the list as default with
// sortable columns, the tiles as second layout; search, sort, switch and layout in the URL, the
// layout also in localStorage; "aktiv" from the list store and "gesamt" with the done tickets of
// the server; links to the project panel and "Neues Projekt" that keep the state, the focus after
// closing a panel, empty states. The tags live in the settings now. Navigation and page state are
// mocked; the stores run with fake data layers. The panel itself is covered in
// project-panel.test.ts and the projects layout test.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countActiveByProject, type Project } from '$lib/domain/project';
import { PROJECT_LAYOUT_STORAGE_KEY } from '$lib/domain/project-view';
import type { Tag } from '$lib/domain/tag';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import ProjectsView from './ProjectsView.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { resize, useResizeObserverStub } from '$lib/test/resize-observer-stub';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/projekte') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

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
const OLD: Project = {
	id: 'proj00000000003',
	name: 'Büro',
	code: 'BUERO',
	archived: true,
	updated: T0
};
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: T0 };

useOverlayStubs();
useResizeObserverStub();

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
	localStorage.clear();
});

let sequence = 0;

function ticket(projectId: string | null, status: TicketSummary['status'] = 'open'): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `TASK-${sequence}`,
		title: `Ticket ${sequence}`,
		status,
		priority: 'medium',
		due: null,
		projectId,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: T0,
		updated: T0
	};
}

async function show(
	path = '/projekte',
	{
		projects = [HOUSE, CAR, OLD],
		done = { [HOUSE.id]: 2 } as Record<string, number>,
		activeId = null as string | null,
		creating = false
	} = {}
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const session = { ensureValid: () => true, logout: vi.fn() };
	const catalog = new CatalogStore(
		{
			listProjects: async () => projects,
			listTags: async () => [GARDEN],
			createTag: vi.fn()
		} satisfies CatalogData,
		session
	);
	const listData: TicketListData = {
		listOpen: async () => [
			ticket(HOUSE.id),
			ticket(HOUSE.id, 'waiting'),
			ticket(CAR.id),
			ticket(null)
		],
		listDone: async (page) => ({ items: [], page, hasMore: false }),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const tickets = new TicketListStore(listData, session);
	const countDone = vi.fn(async (id: string) => done[id] ?? 0);
	const stats = new ProjectStatsStore({ countDone }, session);
	await catalog.load();
	tickets.loadOpen();
	// As in projekte/+layout.svelte.
	const activeOf = (project: Project) =>
		tickets.openState === 'ready'
			? (countActiveByProject(tickets.open).get(project.id) ?? 0)
			: null;
	const totalOf = (project: Project) => {
		const active = activeOf(project);
		return active === null ? null : stats.total(project.id, active);
	};
	const props = { catalog, tickets, stats, activeOf, totalOf, activeId, creating };
	const view = render(ProjectsView, { props });
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { catalog, tickets, stats, countDone, view, props };
}

const tileText = (name: string) =>
	screen
		.getByRole('link', { name: new RegExp(`^${name}`) })
		.textContent?.replace(/\s+/g, ' ')
		.trim();

/** Cells of the list row of a project, in column order, without the menu "•••" (AM-4). */
function rowCells(name: string): string[] {
	const row = screen.getByRole('link', { name }).closest('tr') as HTMLElement;
	return [...row.children]
		.filter((cell) => cell.getAttribute('data-col') !== 'actions')
		.map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

/** Project names of the list in the shown order. */
function listNames(): string[] {
	const table = screen.getByRole('table');
	return [...table.querySelectorAll('tbody a[data-project-id]')].map(
		(link) => link.textContent ?? ''
	);
}

function layoutButton(name: 'Liste' | 'Kacheln') {
	const group = screen.getByRole('group', { name: 'Darstellung der Projekte' });
	return within(group).getByRole('button', { name });
}

describe('project view', () => {
	it('shows the section bar with the switch, the search, the layout and "Neues Projekt"', async () => {
		await show();

		const heading = screen.getByRole('heading', { level: 2, name: 'Projekte' });
		expect(screen.getByText('2 Projekte')).toBeTruthy();
		expect(heading.getAttribute('tabindex')).toBe('-1');
		const nav = screen.getByRole('navigation', { name: 'Ansicht' });
		expect(within(nav).getByRole('link', { name: 'Projekte' }).getAttribute('aria-current')).toBe(
			'page'
		);
		expect(screen.getByRole('searchbox', { name: 'Projekte suchen' })).toBeTruthy();
		expect(screen.getByRole('switch', { name: 'Archivierte anzeigen' })).toBeTruthy();
		expect(layoutButton('Liste').getAttribute('aria-pressed')).toBe('true');
		expect(layoutButton('Kacheln').getAttribute('aria-pressed')).toBe('false');
		expect(screen.getByRole('link', { name: 'Neues Projekt' }).getAttribute('href')).toBe(
			'/projekte/neu'
		);
		// Same order as in the other views: the section bar with the switch comes first (UI-8).
		const section = screen.getByRole('region', { name: 'Projekte' });
		expect(section.firstElementChild?.classList.contains('section-bar')).toBe(true);
		expect(section.firstElementChild?.contains(nav)).toBe(true);
		expect(screen.queryByRole('group', { name: 'Filter-Karten' })).toBeNull();
		expect(screen.queryByRole('region', { name: 'Filter' })).toBeNull();
	});

	it('has no section "Tags" any more; the tags live in the settings', async () => {
		await show();

		expect(screen.queryByRole('region', { name: /Tags/ })).toBeNull();
		expect(screen.queryByText('Garten')).toBeNull();
	});

	it('shows the list by default with code, name and the numbers', async () => {
		const { countDone } = await show();

		const table = screen.getByRole('table');
		// The actions (menu "•••", AM-4) name their column for screen readers only and sort nothing.
		expect(
			within(table)
				.getAllByRole('columnheader')
				.map(
					(th) => th.querySelector('[aria-hidden="true"]')?.textContent ?? th.textContent?.trim()
				)
		).toEqual(['Code', 'Name', 'aktiv', 'gesamt', 'neu', 'archiviert', 'Aktionen']);
		expect(within(table).getAllByRole('button', { name: /sortieren/ })).toHaveLength(6);
		expect(table.querySelector('caption')?.textContent).toMatch(/^Projekte · nach Name/);
		expect(listNames()).toEqual(['Auto', 'Haus']);
		await vi.waitFor(() =>
			expect(rowCells('Haus')).toEqual(['HAUS', 'Haus', '2', '4', '0', '–nein'])
		);
		expect(rowCells('Auto')).toEqual(['AUTO', 'Auto', '1', '1', '0', '–nein']);
		expect(countDone.mock.calls.map(([id]) => id)).toEqual([CAR.id, HOUSE.id]);
		expect(screen.getByRole('link', { name: 'Haus' }).getAttribute('href')).toBe(
			'/projekte/proj00000000001'
		);
		expect(screen.getByRole('link', { name: 'Haus' }).closest('th')?.getAttribute('scope')).toBe(
			'row'
		);
		expect(document.querySelector('ul.tiles')).toBeNull();
	});

	it('shows the tiles with "aktiv" and "gesamt" in the second layout', async () => {
		await show('/projekte?darstellung=kacheln');

		expect(screen.queryByRole('table')).toBeNull();
		await vi.waitFor(() => expect(tileText('Haus')).toBe('Haus HAUS 2 aktiv · 4 gesamt'));
		expect(tileText('Auto')).toBe('Auto AUTO 1 aktiv · 1 gesamt');
		expect(screen.queryByRole('link', { name: /^Büro/ })).toBeNull();
		expect(layoutButton('Kacheln').getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('link', { name: /^Haus/ }).getAttribute('href')).toBe(
			'/projekte/proj00000000001?darstellung=kacheln'
		);
	});

	it('switches the layout through the URL and remembers it on the device', async () => {
		await show();

		await fireEvent.click(layoutButton('Kacheln'));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte?darstellung=kacheln', {
			keepFocus: true,
			noScroll: true,
			replaceState: false
		});
		expect(localStorage.getItem(PROJECT_LAYOUT_STORAGE_KEY)).toBe('kacheln');

		// Next visit without the parameter: the remembered tiles.
		document.body.innerHTML = '';
		mocks.goto.mockClear();
		await show('/projekte');
		expect(screen.queryByRole('table')).toBeNull();
		expect(layoutButton('Kacheln').getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(layoutButton('Liste'));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte', {
			keepFocus: true,
			noScroll: true,
			replaceState: false
		});
		expect(localStorage.getItem(PROJECT_LAYOUT_STORAGE_KEY)).toBe('liste');
		await tick();
		expect(screen.getByRole('table')).toBeTruthy();
	});

	it('follows the URL before the remembered layout and ignores unknown values', async () => {
		localStorage.setItem(PROJECT_LAYOUT_STORAGE_KEY, 'kacheln');
		await show('/projekte?darstellung=liste');
		expect(screen.getByRole('table')).toBeTruthy();

		document.body.innerHTML = '';
		localStorage.setItem(PROJECT_LAYOUT_STORAGE_KEY, 'raster');
		await show('/projekte?darstellung=raster');
		expect(screen.getByRole('table')).toBeTruthy();
	});

	it('sorts by a column through the URL, with aria-sort and the order in the name', async () => {
		await show();

		await fireEvent.click(screen.getByRole('button', { name: 'Nach aktiv sortieren' }));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte?sort=aktiv', {
			keepFocus: true,
			noScroll: true,
			replaceState: false
		});

		document.body.innerHTML = '';
		await show('/projekte?sort=aktiv');
		expect(listNames()).toEqual(['Haus', 'Auto']);
		const button = screen.getByRole('button', {
			name: 'Nach aktiv sortieren, sortiert: meiste zuerst'
		});
		expect(button.closest('th')?.getAttribute('aria-sort')).toBe('descending');
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(
			/sortiert nach aktiv, meiste zuerst/
		);

		document.body.innerHTML = '';
		await show('/projekte?sort=-name');
		expect(listNames()).toEqual(['Haus', 'Auto']);
		expect(
			screen
				.getByRole('button', { name: /^Nach Name sortieren/ })
				.closest('th')
				?.getAttribute('aria-sort')
		).toBe('descending');
	});

	it('searches by name or code and keeps the history free of every letter', async () => {
		await show();

		await fireEvent.input(screen.getByRole('searchbox', { name: 'Projekte suchen' }), {
			target: { value: 'au' }
		});
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte?q=au', {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});

		document.body.innerHTML = '';
		await show('/projekte?q=au');
		expect(listNames()).toEqual(['Auto', 'Haus']);
		expect(screen.getByText('2 Projekte')).toBeTruthy();

		document.body.innerHTML = '';
		await show('/projekte?q=haus');
		expect(listNames()).toEqual(['Haus']);
		expect(screen.getByRole('table').querySelector('caption')?.textContent).toMatch(
			/gefiltert nach Suche/
		);
		expect(screen.getByRole('link', { name: 'Haus' }).getAttribute('href')).toBe(
			'/projekte/proj00000000001?q=haus'
		);
	});

	it('says when the search finds nothing and resets it with the focus on the heading', async () => {
		await show('/projekte?q=zzz');

		expect(screen.getByRole('heading', { name: 'Keine Projekte gefunden' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Suche zurücksetzen' }));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte', {
			keepFocus: true,
			noScroll: true,
			replaceState: false
		});
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Projekte' }))
		);
	});

	it('empties the search with Escape and leaves an empty field alone', async () => {
		await show('/projekte?q=au');
		const field = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Projekte suchen' });
		expect(field.value).toBe('au');

		expect(await fireEvent.keyDown(field, { key: 'Escape' })).toBe(false);
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte', {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	});

	it('shows archived projects only with the switch, which lives in the URL', async () => {
		await show();

		await fireEvent.click(screen.getByRole('switch', { name: 'Archivierte anzeigen' }));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte?archiviert=1', {
			keepFocus: true,
			noScroll: true
		});

		document.body.innerHTML = '';
		const { countDone } = await show('/projekte?archiviert=1');
		expect(
			screen.getByRole<HTMLInputElement>('switch', { name: 'Archivierte anzeigen' }).checked
		).toBe(true);
		expect(rowCells('Büro')).toEqual(['BUERO', 'Büro', '0', '0', '0', 'Archiviert']);
		expect(screen.getByText('3 Projekte')).toBeTruthy();
		await vi.waitFor(() => expect(countDone).toHaveBeenCalledWith(OLD.id, expect.anything()));

		document.body.innerHTML = '';
		await show('/projekte?archiviert=1&darstellung=kacheln');
		expect(tileText('Büro')).toMatch(/^Büro BUERO Archiviert/);
	});

	it('opens the project panel from a row and "Neues Projekt", keeping the state', async () => {
		await show('/projekte?q=a&sort=-name&archiviert=1');

		expect(screen.getByRole('link', { name: 'Haus' }).getAttribute('href')).toBe(
			'/projekte/proj00000000001?q=a&sort=-name&archiviert=1'
		);
		expect(screen.getByRole('link', { name: 'Neues Projekt' }).getAttribute('href')).toBe(
			'/projekte/neu?q=a&sort=-name&archiviert=1'
		);
		expect(screen.queryByRole('button', { name: /bearbeiten$/ })).toBeNull();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('marks the row of the project in the panel and counts it even when it is not shown', async () => {
		const { countDone } = await show('/projekte', { activeId: OLD.id });

		await vi.waitFor(() => expect(countDone).toHaveBeenCalledWith(OLD.id, expect.anything()));
		expect(screen.queryByRole('link', { name: 'Büro' })).toBeNull();

		document.body.innerHTML = '';
		await show('/projekte', { activeId: HOUSE.id });
		const link = screen.getByRole('link', { name: 'Haus' });
		expect(link.getAttribute('aria-current')).toBe('page');
		expect(link.closest('tr')?.classList.contains('active')).toBe(true);

		document.body.innerHTML = '';
		await show('/projekte?darstellung=kacheln', { activeId: HOUSE.id });
		expect(screen.getByRole('link', { name: /^Haus/ }).getAttribute('aria-current')).toBe('page');
	});

	it.each(['/projekte', '/projekte?darstellung=kacheln'])(
		'on %s returns the focus to the project after closing the panel, else to the heading',
		async (path) => {
			const { view, props } = await show(path, { activeId: HOUSE.id });

			await view.rerender({ ...props, activeId: null });
			await vi.waitFor(() =>
				expect(document.activeElement).toBe(screen.getByRole('link', { name: /^Haus/ }))
			);

			// A project that is gone (archived or deleted): the heading of the view.
			await view.rerender({ ...props, activeId: 'proj00000000099' });
			(document.activeElement as HTMLElement).blur();
			await view.rerender({ ...props, activeId: null });
			await vi.waitFor(() =>
				expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Projekte' }))
			);
		}
	);

	it('keeps the focus where it is when the panel closes through a click elsewhere', async () => {
		const { view, props } = await show('/projekte', { activeId: HOUSE.id });
		const auto = screen.getByRole('link', { name: 'Auto' });
		auto.focus();

		await view.rerender({ ...props, activeId: null });
		await tick();
		expect(document.activeElement).toBe(auto);
	});

	it('returns the focus to "Neues Projekt" when its panel closes without a project', async () => {
		const { view, props } = await show('/projekte', { creating: true });

		await view.rerender({ ...props, creating: false });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Neues Projekt' }))
		);
	});

	// Empty states since EH-12: heading, one sentence, a verb as action.
	it('says "Noch keine Projekte" with "Projekt anlegen", and that all are archived', async () => {
		await show('/projekte', { projects: [] });
		const empty = screen
			.getByRole('heading', { name: 'Noch keine Projekte' })
			.closest('.empty-state') as HTMLElement;
		const create = within(empty).getByRole('link', { name: 'Projekt anlegen' });
		expect(create.getAttribute('href')).toBe('/projekte/neu');
		expect(create.classList.contains('button-primary')).toBe(true);
		// The section bar keeps its own "Neues Projekt".
		expect(screen.getByRole('link', { name: 'Neues Projekt' })).toBeTruthy();

		document.body.innerHTML = '';
		await show('/projekte', { projects: [OLD] });
		const archived = screen
			.getByRole('heading', { name: 'Alle Projekte sind archiviert' })
			.closest('.empty-state') as HTMLElement;
		expect(within(archived).queryByRole('link')).toBeNull();
		await fireEvent.click(within(archived).getByRole('button', { name: 'Archivierte anzeigen' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/projekte?archiviert=1', {
			keepFocus: true,
			noScroll: true
		});
		expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Projekte' }));
	});

	it('fits the columns of the list and offers "Spalten" only for the list (ADR-0030, SP-5)', async () => {
		await show();
		const table = screen.getByRole('table');
		expect(screen.getByRole('button', { name: 'Spalten' })).toBeTruthy();

		// 500 px instead of 450 since the rows end with the menu "•••" (3.5rem, AM-4); it always stays.
		resize(table.parentElement as HTMLElement, 500);
		await tick();

		expect(
			within(table)
				.getAllByRole('columnheader')
				.map((header) => header.getAttribute('data-col'))
		).toEqual(['code', 'name', 'active', 'total', 'actions']);
		expect(table.querySelector('caption')?.textContent).toMatch(/Weitere Spalten im Panel$/);
		document.body.innerHTML = '';

		await show('/projekte?darstellung=kacheln');
		expect(screen.queryByRole('button', { name: 'Spalten' })).toBeNull();
	});
});

describe('project view: sub projects as a tree (ADR-0034, UP-3)', () => {
	const GARDEN_PROJECT: Project = {
		id: 'proj00000000011',
		name: 'Garten',
		code: 'GART',
		archived: false,
		updated: T0,
		parentId: HOUSE.id
	};
	const ROOF: Project = {
		id: 'proj00000000012',
		name: 'Dach',
		code: 'DACH',
		archived: true,
		updated: T0,
		parentId: HOUSE.id
	};
	const tree = { projects: [HOUSE, CAR, OLD, GARDEN_PROJECT, ROOF] };

	beforeEach(() => sessionStorage.clear());

	it('shows the sub projects indented below their parent, with a fold button', async () => {
		await show('/projekte', tree);

		expect(listNames()).toEqual(['Auto', 'Haus', 'Garten']);
		const fold = screen.getByRole('button', { name: 'Unterprojekte von Haus' });
		expect(fold.getAttribute('aria-expanded')).toBe('true');
		expect(fold.closest('th')?.textContent).toContain('Haus');
		const garden = screen.getByRole('link', { name: 'Garten' }).closest('tr') as HTMLElement;
		expect(garden.classList.contains('child')).toBe(true);
		expect(within(garden).getByText('Unterprojekt von Haus,')).toBeTruthy();
		expect(rowCells('Garten')[0]).toBe('GART');
		// The count names the projects shown, the switch keeps "Dach" (archived) away.
		expect(screen.getByText('3 Projekte')).toBeTruthy();

		document.body.innerHTML = '';
		await show('/projekte?archiviert=1', tree);
		expect(listNames()).toEqual(['Auto', 'Büro', 'Haus', 'Dach', 'Garten']);
	});

	it('folds and unfolds the sub projects, keeps the focus and remembers it in the tab', async () => {
		await show('/projekte', tree);
		const fold = screen.getByRole('button', { name: 'Unterprojekte von Haus' });
		fold.focus();

		await fireEvent.click(fold);
		expect(fold.getAttribute('aria-expanded')).toBe('false');
		expect(listNames()).toEqual(['Auto', 'Haus']);
		expect(document.activeElement).toBe(fold);
		expect(sessionStorage.getItem('byl-projects-collapsed')).toBe(`["${HOUSE.id}"]`);
		expect(mocks.goto).not.toHaveBeenCalled();

		// A new view in the same tab starts folded; the tiles fold the same way.
		document.body.innerHTML = '';
		await show('/projekte?darstellung=kacheln', tree);
		const tileFold = screen.getByRole('button', { name: '1 Unterprojekt von Haus' });
		expect(tileFold.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByRole('link', { name: /Garten/ })).toBeNull();
		await fireEvent.click(tileFold);
		expect(screen.getByRole('link', { name: /Garten/ }).textContent).toMatch(/in Haus/);
		expect(sessionStorage.getItem('byl-projects-collapsed')).toBeNull();
	});

	it('shows a matching sub project with its parent as context, also when folded', async () => {
		sessionStorage.setItem('byl-projects-collapsed', JSON.stringify([HOUSE.id]));
		await show('/projekte?q=gart', tree);

		expect(listNames()).toEqual(['Haus', 'Garten']);
		const parent = screen.getByRole('link', { name: 'Haus' }).closest('tr') as HTMLElement;
		expect(parent.classList.contains('context')).toBe(true);
		expect(within(parent).getByText('(passt nicht zur Suche, Kontext)')).toBeTruthy();
		expect(screen.getByText('1 Projekt')).toBeTruthy();
	});
});
