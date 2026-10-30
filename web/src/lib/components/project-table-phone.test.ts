// "Projekte" in the phone frame (MO-7b, ADR-0073 addendum MO-7b) in jsdom with the real stores on fake
// data and a controlled matchMedia: cards as the default instead of the table and the tiles (the name
// with its colour, a muted line with code and numbers, sub projects indented below their parent with
// the fold, "•••"), a tap on a card opens the project as a page; the row of the view holds the search,
// "Filter" and "Neues Projekt"; the filter sheet holds "Archivierte anzeigen" and the sort the cards
// have no column headers for. The project as a page: the arrow back after its way, the actions of the
// head in "•••". The counter-checks: on a PC with the switch on and on a phone with the switch off
// the table and the tiles stay as before.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { countActiveByProject, type Project } from '$lib/domain/project';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { TicketSummary } from '$lib/domain/ticket';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import type { EditResult } from '$lib/stores/catalog-editor';
import { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { PC_CONTEXT, useContext } from '$lib/test/context';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useResizeObserverStub } from '$lib/test/resize-observer-stub';
import ProjectPanel from './ProjectPanel.svelte';
import ProjectsView from './ProjectsView.svelte';

useOverlayStubs();
useResizeObserverStub();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	guards: [] as unknown[],
	page: { url: new URL('http://localhost:3000/projekte') }
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
	beforeNavigate: (guard: unknown) => mocks.guards.push(guard)
}));
vi.mock('$app/state', () => ({ page: mocks.page }));

const T0 = '2026-09-24 08:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0
};
const GARDEN: Project = {
	id: 'proj00000000004',
	name: 'Garten',
	code: 'GART',
	archived: false,
	parentId: HOUSE.id,
	parent: { id: HOUSE.id, name: 'Haus', code: 'HAUS' },
	updated: T0
} as Project;
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

let stop: (() => void) | null = null;

/** The window of the test: narrow (a phone) or wide (a PC), with the switch on or off. */
function useWindow(narrow: boolean, enabled: boolean): void {
	vi.stubGlobal('matchMedia', (media: string) => ({
		matches: media === PHONE_QUERY ? narrow : false,
		media,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
	stop = getMobileLayoutStore().connect();
	getMobileLayoutStore().choose(enabled);
}

let sequence = 0;
function ticket(projectId: string | null): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `TASK-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'open',
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

async function show(path = '/projekte', projects = [HOUSE, GARDEN, CAR, OLD]) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const session = { ensureValid: () => true, logout: vi.fn() };
	const catalog = new CatalogStore(
		{
			listProjects: async () => projects,
			listTags: async () => [],
			createTag: vi.fn()
		} satisfies CatalogData,
		session
	);
	const listData: TicketListData = {
		listOpen: async () => [ticket(HOUSE.id), ticket(HOUSE.id), ticket(CAR.id)],
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const tickets = new TicketListStore(listData, session);
	const stats = new ProjectStatsStore({ countDone: vi.fn(async () => 1) }, session);
	await catalog.load();
	tickets.loadOpen();
	const activeOf = (project: Project) =>
		tickets.openState === 'ready'
			? (countActiveByProject(tickets.open).get(project.id) ?? 0)
			: null;
	const totalOf = (project: Project) => {
		const active = activeOf(project);
		return active === null ? null : stats.total(project.id, active);
	};
	const view = render(ProjectsView, { props: { catalog, tickets, stats, activeOf, totalOf } });
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { view, catalog };
}

/** The card of a project by its name. */
const card = (name: string) =>
	[...document.querySelectorAll<HTMLElement>('li[data-project-row]')].find(
		(entry) => entry.querySelector('.card-title a')?.textContent?.trim() === name
	) as HTMLElement;

beforeEach(async () => {
	mocks.goto.mockClear();
	mocks.guards.length = 0;
	localStorage.clear();
	await useContext(PC_CONTEXT);
});

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('"Projekte" as cards in the phone frame (MO-7b)', () => {
	it('shows cards instead of the table: the name, code and numbers, sub projects below their parent', async () => {
		useWindow(true, true);
		await show();

		expect(screen.queryByRole('table')).toBeNull();
		expect(document.querySelector('.tiles')).toBeNull();
		const names = [...document.querySelectorAll('li[data-project-row] .card-title a')].map((link) =>
			link.textContent?.trim()
		);
		expect(names).toEqual(['Auto', 'Haus', 'Garten']);
		const house = card('Haus');
		const link = within(house).getByRole('link', { name: 'Haus' });
		expect(link.getAttribute('href')).toBe(`/projekte/${HOUSE.id}`);
		expect(link.hasAttribute('data-row-link')).toBe(true);
		const meta = house.querySelector('.card-meta')?.textContent?.replace(/\s+/g, ' ');
		expect(meta).toContain('HAUS');
		expect(meta).toMatch(/2 aktiv/);
		expect(meta).toMatch(/gesamt/);
		expect(house.hasAttribute('data-menu-row')).toBe(true);
		expect(within(house).getByRole('button', { name: 'Weitere Aktionen für „Haus“' })).toBeTruthy();

		// A sub project is indented below its parent; the parent folds it with a target of its own.
		const garden = card('Garten');
		expect(garden.classList.contains('child')).toBe(true);
		expect(garden.textContent).toMatch(/Unterprojekt von Haus/);
		const fold = within(house).getByRole('button', { name: '1 Unterprojekt von Haus' });
		expect(fold.getAttribute('aria-expanded')).toBe('true');
		await fireEvent.click(fold);
		await tick();
		expect(card('Garten')).toBeUndefined();
		expect(fold.getAttribute('aria-expanded')).toBe('false');
	});

	it('shows cards also when the tiles were chosen on this device', async () => {
		useWindow(true, true);
		await show('/projekte?darstellung=kacheln');
		expect(document.querySelector('.tiles')).toBeNull();
		expect(card('Haus')).toBeDefined();
	});

	it('opens the project with a tap on the card; "•••" keeps its own tap', async () => {
		useWindow(true, true);
		await show('/projekte?q=a');
		await fireEvent.click(card('Haus').querySelector('.card-meta') as HTMLElement);
		expect(mocks.goto).toHaveBeenCalledWith(`/projekte/${HOUSE.id}?q=a`);
		mocks.goto.mockClear();
		await fireEvent.click(
			within(card('Haus')).getByRole('button', { name: 'Weitere Aktionen für „Haus“' })
		);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('shows the row of the view: the search, "Filter" and "Neues Projekt"', async () => {
		useWindow(true, true);
		const { view } = await show('/projekte?archiviert=1');
		const row = view.container.querySelector('.phone-tools') as HTMLElement;
		expect(within(row).getByRole('searchbox', { name: 'Projekte suchen' })).toBeTruthy();
		expect(within(row).getByRole('button', { name: 'Filter, 1 aktiv' })).toBeTruthy();
		expect(within(row).getByRole('link', { name: 'Neues Projekt' }).getAttribute('href')).toBe(
			'/projekte/neu?archiviert=1'
		);
		// The layout, "Spalten" and the folds of the open tickets of the PC are not above the list.
		expect(screen.queryByRole('group', { name: 'Darstellung der Projekte' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Spalten' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Alle aufklappen' })).toBeNull();
		expect(screen.queryByRole('switch', { name: 'Archivierte anzeigen' })).toBeNull();
	});

	it('filters and sorts in the sheet: "Archivierte anzeigen", "Sortieren nach" and its order', async () => {
		useWindow(true, true);
		await show();
		const button = screen.getByRole('button', { name: 'Filter' });
		await fireEvent.click(button);
		await tick();
		const sheet = screen.getByRole('dialog', { name: 'Filter' });
		await fireEvent.click(within(sheet).getByRole('switch', { name: 'Archivierte anzeigen' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/projekte?archiviert=1', {
			keepFocus: true,
			noScroll: true
		});
		const sortBy = within(sheet).getByRole('group', { name: 'Sortieren nach' });
		expect(within(sortBy).getByRole('radio', { name: 'Standard' })).toHaveProperty('checked', true);
		await fireEvent.click(within(sortBy).getByRole('radio', { name: 'aktiv' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/projekte?sort=aktiv', {
			keepFocus: true,
			noScroll: true,
			replaceState: false
		});
		expect(within(sheet).getByRole('button', { name: '3 Projekte anzeigen' })).toBeTruthy();
	});

	it('offers the order once a sort is chosen', async () => {
		useWindow(true, true);
		await show('/projekte?sort=aktiv');
		await fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
		await tick();
		const sheet = screen.getByRole('dialog', { name: 'Filter' });
		const order = within(sheet).getByRole('group', { name: 'Reihenfolge' });
		expect(
			within(order)
				.getAllByRole('radio')
				.map((radio) => radio.closest('label')?.textContent?.trim())
		).toEqual(['meiste zuerst', 'wenigste zuerst']);
		await fireEvent.click(within(order).getByRole('radio', { name: 'wenigste zuerst' }));
		expect(mocks.goto).toHaveBeenLastCalledWith('/projekte?sort=-aktiv', {
			keepFocus: true,
			noScroll: true,
			replaceState: false
		});
	});
});

describe('the project as a page (MO-7b)', () => {
	function showPanel(onback = vi.fn()) {
		const props = {
			project: HOUSE,
			total: 0,
			active: 0,
			fresh: 0,
			ticketsHref: '/?projekt=proj00000000001' as ResolvedPathname,
			onsave: vi.fn(async (): Promise<EditResult<Project>> => ({ ok: true, value: HOUSE })),
			onarchive: vi.fn(async (): Promise<EditResult<Project>> => ({ ok: true, value: HOUSE })),
			ondelete: vi.fn(async (): Promise<EditResult<void>> => ({ ok: true, value: undefined })),
			onclose: vi.fn(),
			backLabel: 'Zu den Projekten',
			onback
		};
		render(ProjectPanel, { props });
		return props;
	}

	it('names the arrow after its way back and goes back through it', async () => {
		useWindow(true, true);
		const props = showPanel();
		await fireEvent.click(screen.getByRole('button', { name: 'Zu den Projekten' }));
		expect(props.onback).toHaveBeenCalledOnce();
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('asks before the arrow drops typed input, then goes back', async () => {
		useWindow(true, true);
		const props = showPanel();
		await fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
			target: { value: 'Haus neu' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Zu den Projekten' }));
		await tick();
		const question = screen.getByRole('dialog', { name: 'Änderungen verwerfen?' });
		expect(props.onback).not.toHaveBeenCalled();
		await fireEvent.click(within(question).getByRole('button', { name: 'Verwerfen' }));
		expect(props.onback).toHaveBeenCalledOnce();
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('puts the actions of the head into "•••"', () => {
		useWindow(true, true);
		showPanel();
		const head = screen
			.getByRole('complementary', { name: 'Haus' })
			.querySelector('header') as HTMLElement;
		expect(within(head).queryByRole('button', { name: 'Löschen …' })).toBeNull();
		const more = within(head).getByRole('button', { name: 'Weitere Aktionen' });
		const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement;
		expect(
			within(menu)
				.getAllByRole('menuitem', { hidden: true })
				.map((entry) => entry.textContent?.trim())
		).toEqual(['Löschen …', 'Schließen']);
	});
});

describe('"Projekte" outside the phone frame stays as before (MO-7b)', () => {
	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])('keeps the table, the tiles and the bar of the PC on %s', async (_name, narrow, enabled) => {
		useWindow(narrow, enabled);
		await show();
		expect(screen.getByRole('table')).toBeTruthy();
		expect(document.querySelectorAll('li[data-project-row]')).toHaveLength(0);
		expect(screen.getByRole('group', { name: 'Darstellung der Projekte' })).toBeTruthy();
		expect(screen.getByRole('switch', { name: 'Archivierte anzeigen' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^Filter/ })).toBeNull();
		document.body.innerHTML = '';
		await show('/projekte?darstellung=kacheln');
		expect(document.querySelector('.tiles')).not.toBeNull();
	});
});
