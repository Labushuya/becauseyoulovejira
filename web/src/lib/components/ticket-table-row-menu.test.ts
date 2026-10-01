// The menu "•••" of a row of the ticket table (plan aktionsmenues, AM-2): after "Öffnen" in the
// actions, named after its ticket, with both ways to open it, "Link kopieren", "Duplizieren …"
// and "In den Papierkorb …"; a click on it never opens the row, its questions are the dialogs of
// the panel (the table is no modal), and the row waits while a question loads. The keyboard of the
// menu itself is covered in ticket-actions.test.ts. AM-3: a right click, Shift+F10 or the context
// menu key open the same menu at the pointer or the focused element, never the row; the browser
// keeps its menu with Ctrl, for touch, on selected text and in the fields of the cell editors.
// List store, row actions and the store of "Duplizieren …" run for real on fake data layers;
// navigation and page state are mocked.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrashMove } from '$lib/data/tickets';
import type { InboxItemSummary } from '$lib/domain/inbox';
import { parseListQuery } from '$lib/domain/list-query';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import {
	TicketRowActionsStore,
	type TicketRowActionsData
} from '$lib/stores/ticket-row-actions.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import FlagGroup from './overlay/FlagGroup.svelte';
import TicketTable from './TicketTable.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const ID = 't00000000000001';
const OTHER = 't00000000000002';

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: ID,
		key: 'TASK-1',
		title: 'Fenster putzen',
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		parentId: null,
		blocksParent: true,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

const SOURCE: InboxItemSummary = {
	id: 'item00000000001',
	channel: 'mail',
	kind: 'mail',
	title: 'Fenster',
	sourceUrl: '',
	sourceRef: '',
	sourceDate: null,
	sourceMeta: {},
	original: '',
	state: 'converted',
	ticketId: ID,
	handledAt: '2026-09-01 10:00:00.000Z',
	created: '2026-09-01 10:00:00.000Z',
	updated: '2026-09-01 10:00:00.000Z'
};

const MOVE: TrashMove = {
	id: ID,
	updated: '2026-09-28 10:00:00.000Z',
	tickets: [{ id: ID, key: 'TASK-1', updated: '2026-09-28 10:00:00.000Z' }]
};

interface Setup {
	path?: string;
	activeId?: string | null;
	duplicates?: boolean;
	rowData?: Partial<TicketRowActionsData>;
}

async function showTable(setup: Setup = {}) {
	mocks.page.url = new URL(setup.path ?? '/?erledigte=1', 'http://localhost:3000');
	const open = [ticket(), ticket({ id: OTHER, key: 'TASK-2', title: 'Keller aufräumen' })];
	const data: TicketListData = {
		listOpen: vi.fn(async () => open),
		listDone: vi.fn(async (page: number) => ({ items: [], page, hasMore: false })),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const flags = new FlagStore();
	const store = new TicketListStore(data, SESSION, { flags });
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	await catalog.load();
	const rowData = {
		get: vi.fn(async (): Promise<Ticket> => ({ ...ticket(), description: '', sourceItem: null })),
		sources: vi.fn(async () => [SOURCE]),
		commentCount: vi.fn(async () => 0),
		delete: vi.fn<TicketRowActionsData['delete']>(async () => MOVE),
		...setup.rowData
	};
	const trash = { offerUndo: vi.fn() };
	const rowActions = new TicketRowActionsStore(rowData, SESSION, store, trash, flags);
	const duplicates =
		setup.duplicates === false
			? null
			: new TicketDuplicateStore({ duplicate: vi.fn() }, SESSION, flags);
	store.activate(parseListQuery(mocks.page.url.searchParams));
	render(TicketTable, {
		props: { store, catalog, rowActions, duplicates, activeId: setup.activeId ?? null }
	});
	render(FlagGroup, { props: { store: flags } });
	await vi.advanceTimersByTimeAsync(0);
	return { store, rowData, trash, flags };
}

function rowOf(id: string): HTMLElement {
	return document.querySelector(`tr[data-ticket-id="${id}"]`) as HTMLElement;
}

function menuButton(key = 'TASK-1'): HTMLElement {
	return screen.getByRole('button', { name: `Weitere Aktionen für ${key}` });
}

/** The menu of a row; jsdom shows popovers as hidden. */
function menuOf(button: HTMLElement): HTMLElement {
	return document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
}

/** Chooses an entry like a browser: the menu opens from its focused button, the entry closes it. */
async function choose(entry: string, key = 'TASK-1') {
	const button = menuButton(key);
	button.focus();
	await fireEvent.click(button);
	await tick();
	await fireEvent.click(
		within(menuOf(button)).getByRole('menuitem', { name: entry, hidden: true })
	);
	await vi.advanceTimersByTimeAsync(0);
	await tick();
	return button;
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

describe('menu "•••" of a row (AM-2)', () => {
	it('ends the actions of every row after "Öffnen", named after its ticket', async () => {
		await showTable();
		for (const [id, key] of [
			[ID, 'TASK-1'],
			[OTHER, 'TASK-2']
		] as const) {
			const actions = rowOf(id).querySelector('[data-col="actions"]') as HTMLElement;
			const button = within(actions).getByRole('button', { name: `Weitere Aktionen für ${key}` });
			const controls = [...actions.querySelectorAll('input, a, button')].filter(
				(element) => element.closest('[popover]') === null
			);
			expect(controls.map((element) => element.tagName)).toEqual(['INPUT', 'A', 'BUTTON']);
			expect(controls.at(-1)).toBe(button);
			expect(button.getAttribute('title')).toBe('Weitere Aktionen');
			expect(button.getAttribute('aria-haspopup')).toBe('menu');
			// A Tab stop of the row, unlike "Öffnen" (the title link does that for the keyboard).
			expect(button.getAttribute('tabindex')).toBeNull();
			expect(menuOf(button).getAttribute('aria-label')).toBe(`Weitere Aktionen für ${key}`);
		}
	});

	it('offers both ways to open the ticket, the link, "Duplizieren …" and the trash', async () => {
		await showTable();
		const menu = within(menuOf(menuButton()));
		const entries = menu.getAllByRole('menuitem', { hidden: true });
		expect(entries.map((entry) => entry.textContent?.trim())).toEqual([
			'Im Seitenpanel öffnen',
			'In Vollansicht öffnen',
			'Link kopieren',
			'Duplizieren …',
			'In den Papierkorb …'
		]);
		// Links with the list state, whatever way is remembered; they remember nothing.
		expect(entries[0]?.getAttribute('href')).toBe(`/tickets/${ID}?erledigte=1`);
		expect(entries[1]?.getAttribute('href')).toBe(`/tickets/${ID}/voll?erledigte=1`);
		const lines = menu.getAllByRole('separator', { hidden: true });
		expect(lines.map((line) => line.nextElementSibling?.textContent?.trim())).toEqual([
			'Link kopieren',
			'In den Papierkorb …'
		]);
		expect(entries[3]?.getAttribute('aria-haspopup')).toBe('dialog');
		expect(entries[4]?.getAttribute('aria-haspopup')).toBe('dialog');
	});

	it('leaves out "Duplizieren …" without its store', async () => {
		await showTable({ duplicates: false });
		const entries = within(menuOf(menuButton())).getAllByRole('menuitem', { hidden: true });
		expect(entries.map((entry) => entry.textContent?.trim())).not.toContain('Duplizieren …');
	});

	it('never opens or chooses the row from "•••" or its menu', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		await showTable();
		await choose('Link kopieren');

		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/tickets/${ID}`);
		await vi.waitFor(() =>
			expect(screen.getByRole('region', { name: 'Benachrichtigungen' }).textContent).toContain(
				'Link kopiert'
			)
		);
		expect(mocks.goto).not.toHaveBeenCalled();
		const select = within(rowOf(ID)).getByRole<HTMLInputElement>('checkbox', {
			name: 'TASK-1 auswählen'
		});
		expect(select.checked).toBe(false);
		expect(rowOf(ID).classList.contains('selected')).toBe(false);
		expect(document.activeElement).toBe(menuButton());
	});

	it('moves the ticket to the trash with the question of the panel and offers "Rückgängig"', async () => {
		const { rowData, trash } = await showTable();
		await choose('In den Papierkorb …');

		const dialog = screen.getByRole('dialog', { name: 'TASK-1 in den Papierkorb verschieben?' });
		expect(within(dialog).getByText(/Zu diesem Ticket gehört 1 Quelle\./)).toBeTruthy();
		expect(within(dialog).getByRole('group', { name: 'Quellen' })).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'In den Papierkorb' }));
		await vi.advanceTimersByTimeAsync(0);
		await tick();

		expect(rowData.delete).toHaveBeenCalledExactlyOnceWith(ID, 'inbox');
		expect(trash.offerUndo).toHaveBeenCalledExactlyOnceWith(
			MOVE,
			'TASK-1 in den Papierkorb verschoben. 1 Quelle ist wieder im Eingang.'
		);
		expect(rowOf(ID)).toBeNull();
		expect(screen.queryByRole('dialog')).toBeNull();
		// The panel of another ticket stays; the focus goes to the next row or the heading.
		expect(mocks.goto).not.toHaveBeenCalled();
		const focused = document.activeElement as HTMLElement;
		expect(
			rowOf(OTHER).contains(focused) || focused.hasAttribute('data-view-heading'),
			focused.outerHTML
		).toBe(true);
	});

	it('closes the panel of a ticket moved to the trash from its row', async () => {
		await showTable({ path: `/tickets/${ID}?erledigte=1`, activeId: ID });
		await choose('In den Papierkorb …');
		const dialog = screen.getByRole('dialog', { name: 'TASK-1 in den Papierkorb verschieben?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'In den Papierkorb' }));

		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/?erledigte=1'));
	});

	it('keeps the ticket on "Abbrechen" and gives the focus back to its "•••"', async () => {
		const { rowData } = await showTable();
		const button = await choose('In den Papierkorb …');
		const dialog = screen.getByRole('dialog', { name: 'TASK-1 in den Papierkorb verschieben?' });
		expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Abbrechen' }));

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await tick();

		expect(screen.queryByRole('dialog')).toBeNull();
		expect(rowData.delete).not.toHaveBeenCalled();
		expect(rowOf(ID)).not.toBeNull();
		expect(document.activeElement).toBe(button);
	});

	it('opens the question of "Duplizieren …" as the modal of the panel, one dialog only', async () => {
		const { rowData } = await showTable();
		const button = await choose('Duplizieren …');

		expect(rowData.get).toHaveBeenCalledWith(ID);
		const dialogs = screen.getAllByRole('dialog');
		expect(dialogs).toHaveLength(1);
		const dialog = screen.getByRole('dialog', { name: 'TASK-1 duplizieren' });
		expect(within(dialog).getByLabelText<HTMLInputElement>('Titel').value).toBe(
			'Fenster putzen (Kopie)'
		);
		// With sources the question asks about them, as in the panel.
		expect(within(dialog).getByRole('radiogroup', { name: 'Quelle' })).toBeTruthy();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(button);
	});

	it('lets the row wait while its question loads', async () => {
		let answer!: (sources: InboxItemSummary[]) => void;
		await showTable({
			rowData: {
				sources: vi.fn(() => new Promise<InboxItemSummary[]>((resolve) => (answer = resolve)))
			}
		});
		await choose('In den Papierkorb …');
		const actions = rowOf(ID).querySelector('[data-col="actions"]') as HTMLElement;
		expect(actions.getAttribute('aria-busy')).toBe('true');
		expect(screen.queryByRole('dialog')).toBeNull();

		answer([]);
		await vi.advanceTimersByTimeAsync(0);
		await tick();
		expect(actions.getAttribute('aria-busy')).toBeNull();
		const dialog = screen.getByRole('dialog', { name: 'TASK-1 in den Papierkorb verschieben?' });
		expect(within(dialog).queryByRole('group', { name: 'Quellen' })).toBeNull();
	});

	it('stands in every row of the groups as well', async () => {
		await showTable({ path: '/?gruppe=status' });
		expect(menuButton('TASK-1')).toBeTruthy();
		expect(menuButton('TASK-2')).toBeTruthy();
	});
});

describe('context menu of a row (AM-3)', () => {
	function cell(id: string, column: string): HTMLElement {
		return rowOf(id).querySelector(`[data-col="${column}"]`) as HTMLElement;
	}

	function titleLink(id = ID): HTMLElement {
		return rowOf(id).querySelector('a.title-link') as HTMLElement;
	}

	function isOpen(key = 'TASK-1'): boolean {
		return menuButton(key).getAttribute('aria-expanded') === 'true';
	}

	/** Right click like a browser on Windows: the menu event comes after the button is released. */
	async function rightClick(target: Element, init: MouseEventInit = {}): Promise<boolean> {
		const kept = await fireEvent.contextMenu(target, { button: 2, ...init });
		await tick();
		return kept;
	}

	it('opens the menu of the row at the pointer instead of the one of the browser', async () => {
		await showTable();
		const kept = await rightClick(cell(ID, 'key'), { clientX: 300, clientY: 200 });

		expect(kept).toBe(false);
		expect(isOpen()).toBe(true);
		expect(isOpen('TASK-2')).toBe(false);
		const menu = menuOf(menuButton());
		expect(menu.style.top).toBe('200px');
		expect(menu.style.left).toBe('300px');
		// The same menu as "•••", with the focus on its first entry.
		expect(document.activeElement?.textContent?.trim()).toBe('Im Seitenpanel öffnen');
		expect(menu.contains(document.activeElement)).toBe(true);
	});

	it('neither opens nor chooses the row on a right click', async () => {
		await showTable();
		for (const column of ['key', 'title', 'select', 'actions', 'priority']) {
			await rightClick(cell(ID, column), { clientX: 120, clientY: 80 });
			expect(isOpen(), column).toBe(true);
			await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		}

		expect(mocks.goto).not.toHaveBeenCalled();
		const select = within(rowOf(ID)).getByRole<HTMLInputElement>('checkbox', {
			name: 'TASK-1 auswählen'
		});
		expect(select.checked).toBe(false);
		expect(rowOf(ID).classList.contains('selected')).toBe(false);
	});

	it('opens it on the links that open the row itself, not on other links', async () => {
		await showTable();
		expect(await rightClick(titleLink(), { clientX: 10, clientY: 10 })).toBe(false);
		expect(isOpen()).toBe(true);
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

		const open = rowOf(ID).querySelector('a.open') as HTMLElement;
		expect(await rightClick(open)).toBe(false);
		expect(isOpen()).toBe(true);
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

		// A link inside the open menu is a real link with the menu of the browser.
		await rightClick(cell(ID, 'key'));
		const entry = within(menuOf(menuButton())).getByRole('menuitem', {
			name: 'In Vollansicht öffnen',
			hidden: true
		});
		expect(await rightClick(entry)).toBe(true);
	});

	it('leaves the browser menu with Ctrl, for touch and on selected text', async () => {
		await showTable();
		expect(await rightClick(cell(ID, 'key'), { ctrlKey: true })).toBe(true);
		expect(isOpen()).toBe(false);

		await fireEvent.pointerDown(cell(ID, 'key'), { pointerType: 'touch' });
		expect(await rightClick(cell(ID, 'key'))).toBe(true);
		expect(isOpen()).toBe(false);
		await fireEvent.pointerDown(cell(ID, 'key'), { pointerType: 'mouse' });

		const selection = vi.spyOn(document, 'getSelection').mockReturnValue({
			isCollapsed: false,
			toString: () => 'Fenster',
			containsNode: (node: Node) => titleLink().contains(node)
		} as unknown as Selection);
		expect(await rightClick(titleLink())).toBe(true);
		expect(isOpen()).toBe(false);
		// Selected text elsewhere does not stop the menu on another cell.
		expect(await rightClick(cell(ID, 'key'))).toBe(false);
		expect(isOpen()).toBe(true);
		selection.mockRestore();
	});

	it('leaves the browser menu in the fields of a cell editor and outside the rows', async () => {
		await showTable();
		const tags = within(rowOf(ID)).getByRole('button', { name: /^Tags von TASK-1/ });
		tags.focus();
		await tick();
		const input = within(cell(ID, 'tags')).getByRole('combobox', { hidden: true });

		expect(await rightClick(input)).toBe(true);
		expect(await fireEvent.keyDown(input, { key: 'F10', shiftKey: true })).toBe(true);
		expect(isOpen()).toBe(false);

		const head = document.querySelector('thead th') as HTMLElement;
		expect(await rightClick(head)).toBe(true);
	});

	it('opens with Shift+F10 below the focused element and gives the focus back with Escape', async () => {
		await showTable();
		const link = titleLink();
		vi.spyOn(link, 'getBoundingClientRect').mockReturnValue({
			x: 200,
			y: 100,
			top: 100,
			left: 200,
			bottom: 120,
			right: 320,
			width: 120,
			height: 20,
			toJSON: () => ({})
		});
		link.focus();

		const kept = await fireEvent.keyDown(link, { key: 'F10', shiftKey: true });
		await tick();

		expect(kept).toBe(false);
		expect(isOpen()).toBe(true);
		const menu = menuOf(menuButton());
		expect(menu.style.top).toBe('124px');
		expect(menu.style.left).toBe('200px');
		expect(document.activeElement?.textContent?.trim()).toBe('Im Seitenpanel öffnen');

		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(isOpen()).toBe(false);
		expect(document.activeElement).toBe(link);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('opens with the context menu key from a cell of the row', async () => {
		await showTable();
		const priority = within(rowOf(OTHER)).getByRole('button', { name: /^Priorität von TASK-2/ });
		priority.focus();

		expect(await fireEvent.keyDown(priority, { key: 'ContextMenu' })).toBe(false);
		await tick();
		expect(isOpen('TASK-2')).toBe(true);
		expect(isOpen('TASK-1')).toBe(false);

		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(document.activeElement).toBe(priority);
	});

	it('runs an entry from the context menu like from "•••"', async () => {
		const { rowData } = await showTable();
		await rightClick(cell(ID, 'due'), { clientX: 40, clientY: 40 });
		await fireEvent.click(
			within(menuOf(menuButton())).getByRole('menuitem', {
				name: 'In den Papierkorb …',
				hidden: true
			})
		);
		await vi.advanceTimersByTimeAsync(0);
		await tick();

		expect(rowData.sources).toHaveBeenCalledWith(ID);
		const dialog = screen.getByRole('dialog', { name: 'TASK-1 in den Papierkorb verschieben?' });
		// Nothing had the focus before the right click: "Abbrechen" gives it to "•••" of the row.
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(document.activeElement).toBe(menuButton());
	});

	it('opens at the button again after a right click when "•••" is clicked', async () => {
		await showTable();
		await rightClick(cell(ID, 'key'), { clientX: 300, clientY: 200 });
		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
		expect(document.activeElement).toBe(menuButton());

		await fireEvent.click(menuButton());
		await tick();

		// Below the button (jsdom measures it at 0, 0): 4 px gap, no longer at the pointer.
		expect(menuOf(menuButton()).style.top).toBe('4px');
	});
});
