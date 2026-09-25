// Component tests for the project view (E3 plan, T-3, T-12 and package 14; package UI-8): section
// bar with the switch "Aufgaben | Projekte | Eingang" first, "Archivierte anzeigen" in the URL,
// tiles with "aktiv" from the list store and "gesamt" with the done tickets of the server, links to
// the project panel and "Neues Projekt", the focus after closing a panel, empty states. Navigation
// and page state are mocked; the stores run with fake data layers. The panel itself is covered in
// project-panel.test.ts and the projects layout test.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countActiveByProject, type Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import { CatalogEditor, type CatalogEditorData } from '$lib/stores/catalog-editor';
import { FlagStore } from '$lib/stores/flags.svelte';
import { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import ProjectsView from './ProjectsView.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

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

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
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
	const editorData = {
		createProject: vi.fn<CatalogEditorData['createProject']>(async (draft) => ({
			id: 'proj00000000009',
			...draft,
			archived: false,
			updated: T0
		})),
		updateProject: vi.fn<CatalogEditorData['updateProject']>(),
		setProjectArchived: vi.fn<CatalogEditorData['setProjectArchived']>(async (id, archived) => ({
			...HOUSE,
			id,
			archived,
			updated: '2026-09-24 09:00:00.000Z'
		})),
		deleteProject: vi.fn<CatalogEditorData['deleteProject']>(async () => undefined),
		renameTag: vi.fn<CatalogEditorData['renameTag']>(),
		deleteTag: vi.fn<CatalogEditorData['deleteTag']>(),
		countTicketsWithTag: vi.fn<CatalogEditorData['countTicketsWithTag']>(async () => 0)
	} satisfies CatalogEditorData;
	const editor = new CatalogEditor(editorData, session, catalog);
	await catalog.load();
	tickets.loadOpen();
	const flags = new FlagStore();
	// As in projekte/+layout.svelte.
	const activeOf = (project: Project) =>
		tickets.openState === 'ready'
			? (countActiveByProject(tickets.open).get(project.id) ?? 0)
			: null;
	const totalOf = (project: Project) => {
		const active = activeOf(project);
		return active === null ? null : stats.total(project.id, active);
	};
	const view = render(ProjectsView, {
		props: { catalog, tickets, stats, editor, flags, activeOf, totalOf, activeId, creating }
	});
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	const props = { catalog, tickets, stats, editor, flags, activeOf, totalOf, activeId, creating };
	return { catalog, tickets, stats, editorData, countDone, flags, view, props };
}

const tileText = (name: string) =>
	screen
		.getByRole('link', { name: new RegExp(`^${name}`) })
		.textContent?.replace(/\s+/g, ' ')
		.trim();

describe('project view', () => {
	it('shows the section bar with the switch, "Archivierte anzeigen" and "Neues Projekt"', async () => {
		await show();

		const heading = screen.getByRole('heading', { level: 2, name: 'Projekte' });
		expect(screen.getByText('2 Projekte')).toBeTruthy();
		expect(heading.getAttribute('tabindex')).toBe('-1');
		const nav = screen.getByRole('navigation', { name: 'Ansicht' });
		expect(within(nav).getByRole('link', { name: 'Projekte' }).getAttribute('aria-current')).toBe(
			'page'
		);
		expect(screen.getByRole('checkbox', { name: 'Archivierte anzeigen' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Neues Projekt' }).getAttribute('href')).toBe(
			'/projekte/neu'
		);
		// Same order as in the other views: the section bar with the switch comes first (UI-8).
		const section = screen.getByRole('region', { name: 'Projekte' });
		expect(section.firstElementChild?.classList.contains('section-bar')).toBe(true);
		expect(section.firstElementChild?.contains(nav)).toBe(true);
		expect(screen.queryByRole('group', { name: 'Kennzahlen' })).toBeNull();
		expect(screen.queryByRole('region', { name: 'Filter' })).toBeNull();
	});

	it('shows "aktiv" from the list store and "gesamt" with the done tickets of the server', async () => {
		const { countDone } = await show();

		await vi.waitFor(() => expect(tileText('Haus')).toBe('Haus HAUS 2 aktiv · 4 gesamt'));
		expect(tileText('Auto')).toBe('Auto AUTO 1 aktiv · 1 gesamt');
		expect(countDone.mock.calls.map(([id]) => id)).toEqual([CAR.id, HOUSE.id]);
		expect(screen.queryByRole('link', { name: /^Büro/ })).toBeNull();
	});

	it('shows archived projects only with the switch, which lives in the URL', async () => {
		await show();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Archivierte anzeigen' }));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte?archiviert=1', {
			keepFocus: true,
			noScroll: true
		});

		document.body.innerHTML = '';
		const { countDone } = await show('/projekte?archiviert=1');
		expect(
			screen.getByRole<HTMLInputElement>('checkbox', { name: 'Archivierte anzeigen' }).checked
		).toBe(true);
		expect(tileText('Büro')).toMatch(/^Büro BUERO Archiviert/);
		expect(screen.getByText('3 Projekte')).toBeTruthy();
		await vi.waitFor(() => expect(countDone).toHaveBeenCalledWith(OLD.id, expect.anything()));
	});

	it('opens the project panel from a tile and "Neues Projekt", keeping the switch', async () => {
		await show('/projekte?archiviert=1');

		expect(screen.getByRole('link', { name: /^Haus/ }).getAttribute('href')).toBe(
			'/projekte/proj00000000001?archiviert=1'
		);
		expect(screen.getByRole('link', { name: 'Neues Projekt' }).getAttribute('href')).toBe(
			'/projekte/neu?archiviert=1'
		);
		expect(screen.queryByRole('button', { name: /bearbeiten$/ })).toBeNull();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('marks the tile of the project in the panel and counts it even when it is not shown', async () => {
		const { countDone } = await show('/projekte', { activeId: OLD.id });

		await vi.waitFor(() => expect(countDone).toHaveBeenCalledWith(OLD.id, expect.anything()));
		expect(screen.queryByRole('link', { name: /^Büro/ })).toBeNull();

		document.body.innerHTML = '';
		await show('/projekte', { activeId: HOUSE.id });
		expect(screen.getByRole('link', { name: /^Haus/ }).getAttribute('aria-current')).toBe('page');
	});

	it('returns the focus to the tile after closing the panel, else to the heading', async () => {
		const { view, props } = await show('/projekte', { activeId: HOUSE.id });

		await view.rerender({ ...props, activeId: null });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('link', { name: /^Haus/ }))
		);

		// A tile that is gone (archived or deleted): the heading of the view.
		await view.rerender({ ...props, activeId: 'proj00000000099' });
		(document.activeElement as HTMLElement).blur();
		await view.rerender({ ...props, activeId: null });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Projekte' }))
		);
	});

	it('keeps the focus where it is when the panel closes through a click elsewhere', async () => {
		const { view, props } = await show('/projekte', { activeId: HOUSE.id });
		const auto = screen.getByRole('link', { name: /^Auto/ });
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

	it('says "Noch keine Projekte." with "Neues Projekt", and that all are archived', async () => {
		await show('/projekte', { projects: [] });
		const empty = screen.getByText('Noch keine Projekte.').parentElement as HTMLElement;
		expect(within(empty).getByRole('link', { name: 'Neues Projekt' })).toBeTruthy();

		document.body.innerHTML = '';
		await show('/projekte', { projects: [OLD] });
		expect(screen.getByText(/Alle Projekte sind archiviert\./)).toBeTruthy();
	});

	it('shows the section "Tags" below the tiles', async () => {
		await show();

		expect(screen.getByRole('region', { name: 'Tags' })).toBeTruthy();
		expect(screen.getByText('Garten')).toBeTruthy();
	});
});
