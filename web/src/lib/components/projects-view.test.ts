// Component tests for the project view (E3 plan, T-3, T-12 and package 14): section bar with the
// switch "Aufgaben | Projekte", "Archivierte anzeigen" in the URL, tiles with "aktiv" from the
// list store and "gesamt" with the done tickets of the server, the dialog and the focus after it,
// empty states. Navigation and page state are mocked; the stores run with fake data layers.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import { CatalogEditor, type CatalogEditorData } from '$lib/stores/catalog-editor';
import { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import ProjectsView from './ProjectsView.svelte';

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

const nativeDialog = {
	showModal: HTMLDialogElement.prototype.showModal,
	close: HTMLDialogElement.prototype.close
};

beforeAll(() => {
	if (typeof nativeDialog.showModal !== 'function') {
		HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
			this.open = true;
		};
	}
	if (typeof nativeDialog.close !== 'function') {
		HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
			this.open = false;
		};
	}
});

afterAll(() => {
	HTMLDialogElement.prototype.showModal = nativeDialog.showModal;
	HTMLDialogElement.prototype.close = nativeDialog.close;
});

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
		completedAt: null,
		created: T0,
		updated: T0
	};
}

async function show(
	path = '/projekte',
	{ projects = [HOUSE, CAR, OLD], done = { [HOUSE.id]: 2 } as Record<string, number> } = {}
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
	render(ProjectsView, { props: { catalog, tickets, stats, editor } });
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { catalog, tickets, stats, editorData, countDone };
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
		expect(screen.getByRole('button', { name: 'Neues Projekt' })).toBeTruthy();
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

	it('opens the dialog and returns the focus to "Neues Projekt" after creating', async () => {
		const { editorData, catalog } = await show();
		const button = screen.getByRole('button', { name: 'Neues Projekt' });
		button.focus();

		await fireEvent.click(button);
		const dialog = screen.getByRole('dialog', { name: 'Neues Projekt' });
		await fireEvent.input(within(dialog).getByRole('textbox', { name: 'Name' }), {
			target: { value: 'Garten' }
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

		expect(editorData.createProject).toHaveBeenCalledWith({ name: 'Garten', code: 'GART' });
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(document.activeElement).toBe(button);
		expect(catalog.projectById('proj00000000009')).not.toBeNull();
		expect(screen.getByText('Projekt „Garten“ (GART) angelegt.')).toBeTruthy();
		expect(tileText('Garten')).toMatch(/^Garten GART/);
	});

	it('returns the focus to "Bearbeiten" after cancelling and to the heading if the tile is gone', async () => {
		await show();
		const edit = screen.getByRole('button', { name: 'Projekt Haus bearbeiten' });

		await fireEvent.click(edit);
		const dialog = screen.getByRole('dialog', { name: 'Projekt bearbeiten' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await vi.waitFor(() => expect(document.activeElement).toBe(edit));

		await fireEvent.click(edit);
		await fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(screen.queryByRole('link', { name: /^Haus/ })).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Projekte' }));
		expect(screen.getByText('Projekt „Haus“ archiviert.')).toBeTruthy();
	});

	it('offers deleting only for a project without tickets', async () => {
		await show('/projekte', { projects: [HOUSE, { ...CAR, id: 'proj00000000004', name: 'Leer' }] });

		await fireEvent.click(screen.getByRole('button', { name: 'Projekt Haus bearbeiten' }));
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

		await fireEvent.click(screen.getByRole('button', { name: 'Projekt Leer bearbeiten' }));
		await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Löschen …' })).toBeTruthy());
	});

	it('says "Noch keine Projekte." with "Neues Projekt", and that all are archived', async () => {
		await show('/projekte', { projects: [] });
		const empty = screen.getByText('Noch keine Projekte.').parentElement as HTMLElement;
		expect(within(empty).getByRole('button', { name: 'Neues Projekt' })).toBeTruthy();

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
