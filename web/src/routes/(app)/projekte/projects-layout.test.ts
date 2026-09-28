// Route test of the project view (ADR-0025 section 10, decision 4 of the user; plan UI-Konsistenz,
// package UI-8): the tiles with the project panel next to them under /projekte/<id> and
// /projekte/neu, saving, archiving and deleting through the editor with flags, and the ways back
// to the tiles with the switch "Archivierte anzeigen". Navigation, page state and the data layers
// are fakes; the stores are real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '$lib/domain/project';
import type { TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import type { CatalogEditorData } from '$lib/stores/catalog-editor';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketListStore } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ProjectRouteHarness from '$lib/test/ProjectRouteHarness.svelte';

const T0 = '2026-09-24 08:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0
};
const EMPTY: Project = {
	id: 'proj00000000002',
	name: 'Leer',
	code: 'LEER',
	archived: false,
	updated: T0
};

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: {
		url: new URL('http://localhost:3000/projekte'),
		params: {} as Record<string, string>,
		route: { id: '/(app)/projekte' }
	},
	catalog: null as unknown,
	tickets: null as unknown,
	flags: null as unknown,
	editorData: null as unknown
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
// The editor and the numbers check the session before every request.
vi.mock('$lib/auth.svelte', () => ({ auth: { ensureValid: () => true, logout: vi.fn() } }));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => mocks.tickets
}));
vi.mock('$lib/stores/flags.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getFlagStore: () => mocks.flags
}));
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => ({ newCount: 0 })
}));
vi.mock('$lib/stores/catalog-editor', async (importOriginal) => ({
	...(await importOriginal<object>()),
	catalogEditorData: () => mocks.editorData
}));
vi.mock('$lib/stores/project-stats.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	projectStatsData: () => ({ countDone: async () => 0 })
}));
vi.mock('$lib/stores/realtime', async (importOriginal) => ({
	...(await importOriginal<object>()),
	liveSource: () => new Proxy({}, { get: () => async () => async () => undefined })
}));

useOverlayStubs();

function openTicket(projectId: string, id = 't00000000000001'): TicketSummary {
	return {
		id,
		key: 'HAUS-1',
		title: 'Dach',
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

async function show(
	path: string,
	child: 'neu' | 'project' | null = null,
	{
		projects = [HOUSE, EMPTY],
		open = [openTicket(HOUSE.id)]
	}: { projects?: Project[]; open?: TicketSummary[] } = {}
) {
	const url = new URL(path, 'http://localhost:3000');
	mocks.page.url = url;
	const id = /^\/projekte\/([a-z0-9]{15})$/.exec(url.pathname)?.[1];
	mocks.page.params = id ? { id } : {};
	mocks.page.route = {
		id:
			child === 'neu'
				? '/(app)/projekte/neu'
				: child === 'project'
					? '/(app)/projekte/[id]'
					: '/(app)/projekte'
	};
	const session = { ensureValid: () => true, logout: vi.fn() };
	const catalog = new CatalogStore(
		{ listProjects: async () => projects, listTags: async () => [], createTag: vi.fn() },
		session
	);
	await catalog.load();
	const tickets = new TicketListStore(
		{
			listOpen: async () => open,
			listDone: async (page: number) => ({ items: [], page, hasMore: false }),
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(),
			update: vi.fn()
		},
		session
	);
	const flags = new FlagStore();
	const editorData = {
		createProject: vi.fn<CatalogEditorData['createProject']>(async (draft) => ({
			id: 'proj00000000009',
			...draft,
			archived: false,
			updated: T0
		})),
		updateProject: vi.fn<CatalogEditorData['updateProject']>(async (projectId, patch) => ({
			...(projectId === HOUSE.id ? HOUSE : EMPTY),
			...patch,
			updated: '2026-09-24 09:00:00.000Z'
		})),
		setProjectArchived: vi.fn<CatalogEditorData['setProjectArchived']>(
			async (projectId, archived) => ({
				...(projectId === HOUSE.id ? HOUSE : EMPTY),
				archived,
				updated: '2026-09-24 09:00:00.000Z'
			})
		),
		deleteProject: vi.fn<CatalogEditorData['deleteProject']>(async () => undefined),
		renameTag: vi.fn<CatalogEditorData['renameTag']>(),
		deleteTag: vi.fn<CatalogEditorData['deleteTag']>(),
		countTicketsWithTag: vi.fn<CatalogEditorData['countTicketsWithTag']>(async () => 0)
	} satisfies CatalogEditorData;
	mocks.catalog = catalog;
	mocks.tickets = tickets;
	mocks.flags = flags;
	mocks.editorData = editorData;
	render(ProjectRouteHarness, { props: { child } });
	await vi.waitFor(() => expect(tickets.openState).toBe('ready'));
	await tick();
	return { catalog, flags, editorData };
}

const flagTitles = (flags: FlagStore) => flags.flags.map((flag) => flag.title);

beforeEach(() => {
	mocks.goto.mockClear();
	document.body.innerHTML = '';
});

describe('project view route', () => {
	it('shows the tiles without a panel under /projekte', async () => {
		await show('/projekte');

		expect(screen.getByRole('heading', { level: 2, name: 'Projekte' })).toBeTruthy();
		expect(screen.getByRole('link', { name: /^Haus/ })).toBeTruthy();
		expect(screen.queryByRole('complementary')).toBeNull();
		expect(document.querySelector('.view')?.hasAttribute('data-panel-mode')).toBe(false);
	});

	it('opens the panel of a project next to the tiles and marks its tile', async () => {
		await show('/projekte/proj00000000001?archiviert=1', 'project');

		const panel = screen.getByRole('complementary', { name: 'Haus' });
		expect((document.querySelector('.view') as HTMLElement).dataset.panelMode).toBe('embedded');
		expect(screen.getByRole('link', { name: /^Haus/ }).getAttribute('aria-current')).toBe('page');
		await vi.waitFor(() =>
			expect(panel.querySelector('.stats')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
				'1 aktiv · 1 gesamt'
			)
		);
		expect(within(panel).getByRole('link', { name: 'Tickets anzeigen' }).getAttribute('href')).toBe(
			'/?projekt=proj00000000001'
		);
		expect(document.title).toBe('Haus · Projekte · becauseyoulovejira');

		await fireEvent.click(within(panel).getByRole('button', { name: 'Panel schließen' }));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte?archiviert=1');
	});

	it('saves a new name with a flag and stays in the panel', async () => {
		const { editorData, flags } = await show('/projekte/proj00000000001', 'project');

		await fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
			target: { value: 'Wohnung' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

		await vi.waitFor(() =>
			expect(editorData.updateProject).toHaveBeenCalledExactlyOnceWith(HOUSE.id, {
				name: 'Wohnung'
			})
		);
		await vi.waitFor(() => expect(flagTitles(flags)).toEqual(['Projekt „Wohnung“ gespeichert.']));
		expect(screen.getByRole('complementary', { name: 'Wohnung' })).toBeTruthy();
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('shows no flag when "Speichern" changes nothing', async () => {
		const { editorData, flags } = await show('/projekte/proj00000000001', 'project');

		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
		await tick();
		expect(editorData.updateProject).not.toHaveBeenCalled();
		expect(flagTitles(flags)).toEqual([]);
	});

	it('archives with a flag', async () => {
		const { editorData, flags } = await show('/projekte/proj00000000001', 'project');

		await fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));
		await vi.waitFor(() => expect(flagTitles(flags)).toEqual(['Projekt „Haus“ archiviert.']));
		expect(editorData.setProjectArchived).toHaveBeenCalledExactlyOnceWith(HOUSE.id, true);
		expect(screen.getByRole('button', { name: 'Aus dem Archiv holen' })).toBeTruthy();
	});

	it('deletes a project without tickets and goes back to the tiles', async () => {
		const { editorData, flags, catalog } = await show('/projekte/proj00000000002', 'project');

		await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Löschen …' })).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));

		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte'));
		expect(editorData.deleteProject).toHaveBeenCalledExactlyOnceWith(EMPTY.id);
		expect(catalog.projectById(EMPTY.id)).toBeNull();
		expect(flagTitles(flags)).toEqual(['Projekt „Leer“ gelöscht.']);
		// Until the navigation the panel keeps the project instead of "nicht gefunden".
		expect(screen.getByRole('complementary', { name: 'Leer' })).toBeTruthy();
		expect(screen.queryByText('Projekt nicht gefunden')).toBeNull();
	});

	it('creates a project under /projekte/neu and switches to its panel in place', async () => {
		const { editorData, flags } = await show('/projekte/neu?archiviert=1', 'neu');

		expect(screen.getByRole('complementary', { name: 'Neues Projekt' })).toBeTruthy();
		expect(document.title).toBe('Neues Projekt · Projekte · becauseyoulovejira');
		await fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
			target: { value: 'Garten' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte/proj00000000009?archiviert=1', {
				replaceState: true
			})
		);
		expect(editorData.createProject).toHaveBeenCalledExactlyOnceWith({
			name: 'Garten',
			code: 'GART'
		});
		expect(flagTitles(flags)).toEqual(['Projekt „Garten“ (GART) angelegt.']);
	});

	it('says when a project does not exist', async () => {
		await show('/projekte/proj00000000077', 'project');

		const panel = screen.getByRole('complementary', { name: 'Projekt nicht gefunden' });
		await fireEvent.click(within(panel).getByRole('button', { name: 'Panel schließen' }));
		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/projekte');
	});
});

describe('project view route: sub projects (ADR-0034)', () => {
	const GARDEN: Project = {
		id: 'proj00000000011',
		name: 'Garten',
		code: 'GART',
		archived: false,
		updated: T0,
		parentId: HOUSE.id
	};
	const tree = {
		projects: [HOUSE, EMPTY, GARDEN],
		open: [
			openTicket(HOUSE.id),
			openTicket(GARDEN.id, 't00000000000002'),
			openTicket(GARDEN.id, 't00000000000003')
		]
	};

	it('counts a parent with its sub projects and names its own tickets as "davon direkt" (UP-6)', async () => {
		await show('/projekte/proj00000000001', 'project', tree);

		const panel = screen.getByRole('complementary', { name: 'Haus' });
		await vi.waitFor(() =>
			expect(panel.querySelector('.stats')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
				'3 aktiv · 3 gesamt , inkl. Unterprojekte'
			)
		);
		expect(panel.querySelector('.stats')?.getAttribute('title')).toBe('inkl. Unterprojekte');
		expect(panel.querySelector('.direct')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'davon direkt in Haus: 1 aktiv · 1 gesamt'
		);
		// The code stays fixed because of the own ticket; deleting waits for the sub project.
		expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Code' }).readOnly).toBe(true);
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();

		// The list counts the same: the row of Haus with 3, Garten with 2.
		const row = (name: string) =>
			[
				...(within(screen.getByRole('table')).getByRole('link', { name }).closest('tr')?.children ??
					[])
			].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');
		await vi.waitFor(() =>
			expect(row('Haus').slice(2, 4)).toEqual(['3, inkl. Unterprojekte', '3, inkl. Unterprojekte'])
		);
		expect(row('Garten').slice(2, 4)).toEqual(['2', '2']);
	});

	it('offers "Unterprojekt anlegen" and creates the sub project with its parent', async () => {
		await show('/projekte/proj00000000001', 'project', tree);
		expect(screen.getByRole('link', { name: 'Unterprojekt anlegen' }).getAttribute('href')).toBe(
			'/projekte/neu?oberprojekt=proj00000000001'
		);

		document.body.innerHTML = '';
		const { editorData } = await show('/projekte/neu?oberprojekt=proj00000000001', 'neu', tree);
		expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Oberprojekt' }).value).toBe(
			HOUSE.id
		);
		await fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
			target: { value: 'Keller' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
		await vi.waitFor(() =>
			expect(editorData.createProject).toHaveBeenCalledExactlyOnceWith({
				name: 'Keller',
				code: 'KELL',
				parentId: HOUSE.id
			})
		);
	});

	it('brings a sub project back with its archived parent, the parent first', async () => {
		const archived = {
			projects: [{ ...HOUSE, archived: true }, EMPTY, { ...GARDEN, archived: true }],
			open: []
		};
		const { editorData, flags } = await show(
			'/projekte/proj00000000011?archiviert=1',
			'project',
			archived
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Mit Oberprojekt zurückholen' }));
		await vi.waitFor(() =>
			expect(flagTitles(flags)).toEqual(['Projekt „Garten“ mit „Haus“ aus dem Archiv geholt.'])
		);
		expect(editorData.setProjectArchived.mock.calls).toEqual([
			[HOUSE.id, false],
			[GARDEN.id, false]
		]);
	});
});
