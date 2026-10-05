// The menu "•••" of a row of the project list (plan aktionsmenues, AM-4): "Öffnen" (the panel,
// where a project is edited), "Tickets anzeigen", "Unterprojekt anlegen" for an active top-level
// project, then "Archivieren", "Aus dem Archiv holen" or "Mit Oberprojekt zurückholen", and
// "Löschen …" only without tickets and sub projects. Archiving with active sub projects and
// deleting ask first, as in the panel; a right click and Shift+F10 open the menu (AM-3). Since
// AM-5 every tile has the same menu in its corner, with the right click and the keys of the rows;
// a click on the tile still opens the panel. The stores run with fake data layers, the actions of
// the route are spies; navigation and page state are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countActiveByProject, type Project } from '$lib/domain/project';
import type { TicketSummary } from '$lib/domain/ticket';
import type { ProjectActions } from '$lib/project-route';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { newSubProjectHref, projectHref, projectTicketsHref } from '$lib/ticket-links';
import ProjectsView from './ProjectsView.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/projekte') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const T0 = '2026-09-24 08:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0
};
const GARDEN: Project = {
	id: 'proj00000000002',
	name: 'Garten',
	code: 'GART',
	archived: false,
	parentId: HOUSE.id,
	updated: T0
};
const EMPTY: Project = {
	id: 'proj00000000003',
	name: 'Leer',
	code: 'LEER',
	archived: false,
	updated: T0
};
const OLD: Project = {
	id: 'proj00000000004',
	name: 'Büro',
	code: 'BUERO',
	archived: true,
	updated: T0
};
const ATTIC: Project = {
	id: 'proj00000000005',
	name: 'Alt',
	code: 'ALT',
	archived: true,
	updated: T0
};
const BOX: Project = {
	id: 'proj00000000006',
	name: 'Kiste',
	code: 'KISTE',
	archived: true,
	parentId: ATTIC.id,
	updated: T0
};

function ticket(projectId: string): TicketSummary {
	return {
		id: `t${projectId.slice(-14)}`,
		key: 'TASK-1',
		title: 'Fenster',
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

function fakeActions() {
	return {
		archive: vi.fn<ProjectActions['archive']>(async (project, archived) => ({
			ok: true,
			value: { ...project, archived }
		})),
		restoreWithParent: vi.fn<ProjectActions['restoreWithParent']>(async (project) => ({
			ok: true,
			value: { ...project, archived: false }
		})),
		remove: vi.fn<ProjectActions['remove']>(async () => ({ ok: true, value: undefined })),
		fail: vi.fn<ProjectActions['fail']>()
	};
}

async function show(
	path = '/projekte?archiviert=1',
	{ actions = fakeActions() as ProjectActions | null, activeId = null as string | null } = {}
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const session = { ensureValid: () => true, logout: vi.fn() };
	const catalog = new CatalogStore(
		{
			listProjects: async () => [HOUSE, GARDEN, EMPTY, OLD, ATTIC, BOX],
			listTags: async () => [],
			createTag: vi.fn()
		},
		session
	);
	const tickets = new TicketListStore(
		{
			listOpen: async () => [ticket(HOUSE.id)],
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(),
			update: vi.fn()
		},
		session
	);
	const stats = new ProjectStatsStore({ countDone: vi.fn(async () => 0) }, session);
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
	render(ProjectsView, {
		props: {
			catalog,
			tickets,
			stats,
			activeOf,
			totalOf,
			actions: actions ?? undefined,
			activeId,
			creating: false
		}
	});
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { actions };
}

function menuButton(name: string): HTMLElement {
	return screen.getByRole('button', { name: `Weitere Aktionen für „${name}“` });
}

function menuOf(button: HTMLElement): HTMLElement {
	return document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
}

function labels(name: string): (string | undefined)[] {
	return within(menuOf(menuButton(name)))
		.getAllByRole('menuitem', { hidden: true })
		.map((entry) => entry.textContent?.trim());
}

function entry(name: string, label: string): HTMLElement {
	return within(menuOf(menuButton(name))).getByRole('menuitem', { name: label, hidden: true });
}

const isOpen = (name: string) => menuButton(name).getAttribute('aria-expanded') === 'true';

beforeEach(() => {
	mocks.goto.mockClear();
	localStorage.clear();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('menu "•••" of a row of the project list (AM-4)', () => {
	it('ends every row of the list with "•••"', async () => {
		await show();
		const row = screen.getByRole('link', { name: 'Haus' }).closest('tr') as HTMLElement;
		const cell = row.querySelector('[data-col="actions"]') as HTMLElement;
		expect(within(cell).getByRole('button', { name: 'Weitere Aktionen für „Haus“' })).toBe(
			menuButton('Haus')
		);
		expect(menuButton('Haus').classList.contains('row-menu')).toBe(true);
		expect(menuButton('Haus').getAttribute('title')).toBe('Weitere Aktionen');
	});

	it('offers the entries of each state, "Löschen …" only without tickets and sub projects', async () => {
		await show();
		const url = new URL('http://localhost:3000/projekte?archiviert=1');
		// Tickets and a sub project: no deleting; a top-level project may get a sub project.
		expect(labels('Haus')).toEqual([
			'Öffnen',
			'Tickets anzeigen',
			'Unterprojekt anlegen',
			'Archivieren'
		]);
		expect(entry('Haus', 'Öffnen').getAttribute('href')).toBe(projectHref(HOUSE.id, url));
		expect(entry('Haus', 'Tickets anzeigen').getAttribute('href')).toBe(
			projectTicketsHref(HOUSE.id)
		);
		expect(entry('Haus', 'Unterprojekt anlegen').getAttribute('href')).toBe(
			newSubProjectHref(HOUSE.id, url)
		);
		expect(entry('Haus', 'Archivieren').getAttribute('aria-haspopup')).toBe('dialog');
		// A sub project gets no sub project; without tickets it can go.
		expect(labels('Garten')).toEqual(['Öffnen', 'Tickets anzeigen', 'Archivieren', 'Löschen …']);
		expect(entry('Garten', 'Archivieren').hasAttribute('aria-haspopup')).toBe(false);
		expect(labels('Leer')).toEqual([
			'Öffnen',
			'Tickets anzeigen',
			'Unterprojekt anlegen',
			'Archivieren',
			'Löschen …'
		]);
		expect(entry('Leer', 'Löschen …').getAttribute('aria-haspopup')).toBe('dialog');
		expect(labels('Büro')).toEqual([
			'Öffnen',
			'Tickets anzeigen',
			'Aus dem Archiv holen',
			'Löschen …'
		]);
		expect(labels('Kiste')).toEqual([
			'Öffnen',
			'Tickets anzeigen',
			'Mit Oberprojekt zurückholen',
			'Löschen …'
		]);
	});

	it('only links without the actions of the route', async () => {
		await show('/projekte', { actions: null });
		expect(labels('Haus')).toEqual(['Öffnen', 'Tickets anzeigen', 'Unterprojekt anlegen']);
	});

	it('archives and restores at once and reports a refusal as an error flag', async () => {
		const actions = fakeActions();
		actions.archive.mockResolvedValueOnce({
			ok: false,
			message: null,
			fields: { archived: 'Das geht gerade nicht.' }
		});
		await show(undefined, { actions });

		await fireEvent.click(entry('Leer', 'Archivieren'));
		await vi.waitFor(() => expect(actions.archive).toHaveBeenCalledWith(EMPTY, true));
		expect(actions.fail).toHaveBeenCalledExactlyOnceWith(
			'Projekt „Leer“ ließ sich nicht archivieren.',
			'Das geht gerade nicht.'
		);

		await fireEvent.click(entry('Büro', 'Aus dem Archiv holen'));
		await vi.waitFor(() => expect(actions.archive).toHaveBeenLastCalledWith(OLD, false));
		await fireEvent.click(entry('Kiste', 'Mit Oberprojekt zurückholen'));
		await vi.waitFor(() =>
			expect(actions.restoreWithParent).toHaveBeenCalledWith(
				expect.objectContaining({ id: BOX.id }),
				expect.objectContaining({ id: ATTIC.id })
			)
		);
		expect(actions.fail).toHaveBeenCalledOnce();
	});

	it('asks before archiving a project with active sub projects, as the panel does', async () => {
		const { actions } = await show();
		await fireEvent.click(entry('Haus', 'Archivieren'));
		await tick();

		const dialog = screen.getByRole('dialog', { name: 'Projekt „Haus“ archivieren?' });
		expect(dialog.textContent).toContain(
			'Archiviert auch 1 Unterprojekt: Garten. Zurückholen geht später für jedes einzeln.'
		);
		expect(actions?.archive).not.toHaveBeenCalled();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Archivieren' }));
		await vi.waitFor(() => expect(actions?.archive).toHaveBeenCalledWith(HOUSE, true));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	it('asks before deleting, keeps a refusal in the question and closes the panel of the project', async () => {
		const actions = fakeActions();
		actions.remove
			.mockResolvedValueOnce({ ok: false, message: 'Der Server lehnt ab.', fields: {} })
			.mockResolvedValueOnce({ ok: true, value: undefined });
		await show('/projekte/proj00000000003?archiviert=1', { actions, activeId: EMPTY.id });

		await fireEvent.click(entry('Leer', 'Löschen …'));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Projekt „Leer“ löschen?' });
		expect(dialog.textContent).toContain(
			'„Leer“ (LEER) hat keine Tickets. Das Projekt wird endgültig gelöscht; das lässt sich nicht rückgängig machen.'
		);
		const confirm = within(dialog).getByRole('button', { name: 'Endgültig löschen' });
		await fireEvent.click(confirm);
		await vi.waitFor(() => expect(dialog.textContent).toContain('Der Server lehnt ab.'));

		await fireEvent.click(confirm);
		await vi.waitFor(() => expect(actions.remove).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/projekte?archiviert=1'));
	});

	it('opens the menu with a right click and Shift+F10, never the panel', async () => {
		await show();
		const row = screen.getByRole('link', { name: 'Haus' }).closest('tr') as HTMLElement;
		const code = row.querySelector('[data-col="code"]') as HTMLElement;

		expect(await fireEvent.contextMenu(code, { button: 2, clientX: 50, clientY: 70 })).toBe(false);
		await tick();
		expect(isOpen('Haus')).toBe(true);
		expect(menuOf(menuButton('Haus')).style.top).toBe('70px');
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

		const fold = within(row).getByRole('button', { name: 'Unterprojekte von Haus' });
		fold.focus();
		expect(await fireEvent.keyDown(fold, { key: 'ContextMenu' })).toBe(false);
		await tick();
		expect(isOpen('Haus')).toBe(true);
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(document.activeElement).toBe(fold);
		expect(fold.getAttribute('aria-expanded')).toBe('true');
		expect(mocks.goto).not.toHaveBeenCalled();
	});
});

describe('menu "•••" of a project tile (AM-5)', () => {
	const TILES = '/projekte?archiviert=1&darstellung=kacheln';
	const NAMES = ['Haus', 'Garten', 'Leer', 'Büro', 'Alt', 'Kiste'];

	/** The link of the tile of a project (a sub project's starts with "in Haus"). */
	function tileLink(name: string): HTMLElement {
		const link = screen
			.getAllByRole('link')
			.find((candidate) => candidate.querySelector('.name')?.textContent === name);
		if (link === undefined) throw new Error(`No tile for ${name}`);
		return link;
	}

	/** The tile around the link of a project (a menu row of the grid). */
	function tileOf(name: string): HTMLElement {
		return tileLink(name).closest('[data-menu-row]') as HTMLElement;
	}

	it('gives every tile the menu of its row in the list, next to its link', async () => {
		await show();
		const inList = new Map(NAMES.map((name) => [name, labels(name)]));
		document.body.innerHTML = '';

		await show(TILES);
		for (const name of NAMES) {
			const button = menuButton(name);
			expect(tileOf(name).contains(button), name).toBe(true);
			expect(tileLink(name).contains(button), name).toBe(false);
			expect(button.classList.contains('row-menu'), name).toBe(true);
			expect(button.getAttribute('title'), name).toBe('Weitere Aktionen');
			expect(labels(name), name).toEqual(inList.get(name));
		}
		const url = new URL(`http://localhost:3000${TILES}`);
		expect(entry('Haus', 'Öffnen').getAttribute('href')).toBe(projectHref(HOUSE.id, url));
		expect(entry('Garten', 'Tickets anzeigen').getAttribute('href')).toBe(
			projectTicketsHref(GARDEN.id)
		);
	});

	it('runs the entries of a tile like those of a row, with the questions of the panel', async () => {
		const { actions } = await show(TILES);

		await fireEvent.click(entry('Büro', 'Aus dem Archiv holen'));
		await vi.waitFor(() => expect(actions?.archive).toHaveBeenCalledWith(OLD, false));

		await fireEvent.click(entry('Haus', 'Archivieren'));
		await tick();
		const archive = screen.getByRole('dialog', { name: 'Projekt „Haus“ archivieren?' });
		await fireEvent.click(within(archive).getByRole('button', { name: 'Abbrechen' }));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(actions?.archive).toHaveBeenCalledTimes(1);

		await fireEvent.click(entry('Leer', 'Löschen …'));
		await tick();
		const remove = screen.getByRole('dialog', { name: 'Projekt „Leer“ löschen?' });
		await fireEvent.click(within(remove).getByRole('button', { name: 'Endgültig löschen' }));
		await vi.waitFor(() => expect(actions?.remove).toHaveBeenCalledWith(EMPTY));
	});

	it('opens the menu of a tile at the pointer on a right click, never the panel', async () => {
		await show(TILES);
		const name = tileLink('Leer').querySelector('.name') as HTMLElement;

		expect(await fireEvent.contextMenu(name, { button: 2, clientX: 120, clientY: 80 })).toBe(false);
		await tick();
		expect(isOpen('Leer')).toBe(true);
		expect(menuOf(menuButton('Leer')).style.top).toBe('80px');
		expect(menuOf(menuButton('Leer')).style.left).toBe('120px');
		await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Öffnen'));
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

		// A sub project opens its own menu, not the one of its parent.
		const garden = tileLink('Garten').querySelector('.name') as HTMLElement;
		expect(await fireEvent.contextMenu(garden, { button: 2 })).toBe(false);
		await tick();
		expect(isOpen('Garten')).toBe(true);
		expect(isOpen('Haus')).toBe(false);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('leaves the menu of the browser with Ctrl and outside the tiles', async () => {
		await show(TILES);

		expect(await fireEvent.contextMenu(tileLink('Leer'), { button: 2, ctrlKey: true })).toBe(true);
		const fold = screen.getByRole('button', { name: '1 Unterprojekt von Haus' });
		expect(await fireEvent.contextMenu(fold, { button: 2 })).toBe(true);
		expect(NAMES.some((name) => isOpen(name))).toBe(false);
	});

	it('opens the menu of the focused tile with Shift+F10 and the context menu key', async () => {
		await show(TILES);
		const link = tileLink('Büro');
		link.focus();

		expect(await fireEvent.keyDown(link, { key: 'F10', shiftKey: true })).toBe(false);
		await tick();
		expect(isOpen('Büro')).toBe(true);
		await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Öffnen'));
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(document.activeElement).toBe(link);

		const other = tileLink('Kiste');
		other.focus();
		expect(await fireEvent.keyDown(other, { key: 'ContextMenu' })).toBe(false);
		await tick();
		expect(isOpen('Kiste')).toBe(true);
		await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Öffnen'));
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(document.activeElement).toBe(other);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('still opens the panel with a click on the tile; "•••" is no part of the link', async () => {
		await show(TILES);
		const link = tileLink('Leer');
		const url = new URL(`http://localhost:3000${TILES}`);

		expect(link.getAttribute('href')).toBe(projectHref(EMPTY.id, url));
		// Nothing of the view takes the click (jsdom would try to navigate, so the test stops it last).
		let prevented: boolean | null = null;
		const last = (event: Event) => {
			prevented = event.defaultPrevented;
			event.preventDefault();
		};
		document.addEventListener('click', last);
		await fireEvent.click(link);
		document.removeEventListener('click', last);
		expect(prevented).toBe(false);
		expect(isOpen('Leer')).toBe(false);

		await fireEvent.click(menuButton('Leer'));
		expect(isOpen('Leer')).toBe(true);
		expect(link.contains(menuButton('Leer'))).toBe(false);
	});
});
