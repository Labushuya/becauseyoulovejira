// "Vorhaben abschließen?" on every way to complete an ongoing project (VH-1, ADR-0065 addendum
// VH-1): the check mark and the status cell of "Aufgaben", the check mark and the status menu of a
// sub-task (also inline in the full view), the status of the detail (panel and full view) and the
// bulk actions "Erledigen" and "Status", which ask once and name the number. "Abbrechen" changes
// nothing; a task completes as before, without a question. Stores run for real on fake data layers.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { BulkEditStore, type BulkEditData } from '$lib/stores/bulk-edit.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import InModalHarness from '$lib/test/InModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { expectNoStatusQuestions, expectRowBelowStatus } from '$lib/test/status-questions';
import FlagGroup from './overlay/FlagGroup.svelte';
import TicketFields from './TicketFields.svelte';
import TicketSubtasks from './TicketSubtasks.svelte';
import TicketTable from './TicketTable.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const QUESTION = 'Vorhaben TASK-1 abschließen?';

function ticket(n: number, overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: `t${String(n).padStart(14, '0')}`,
		key: `TASK-${n}`,
		title: `Ticket ${n}`,
		description: '',
		sourceItem: null,
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
		kind: 'task',
		created: `2026-09-0${n} 10:00:00.000Z`,
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

const PROJECT = ticket(1, { kind: 'ongoing', title: 'Spanisch lernen', status: 'in_progress' });
const TASK = ticket(2, { title: 'Fenster putzen' });

function catalog() {
	const store = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void store.load();
	return store;
}

/** A list store on a fake data layer with these open tickets and sub-tasks. */
async function listOf(open: TicketSummary[]) {
	const data = {
		listOpen: vi.fn(async () => open.filter((entry) => entry.status !== 'done')),
		listSubtasks: vi.fn(async () => open.filter((entry) => entry.parentId)),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(async (id: string, done: boolean) => ({
			...(open.find((entry) => entry.id === id) as TicketSummary),
			status: done ? ('done' as const) : ('open' as const),
			updated: '2026-09-24 10:00:00.000Z'
		})),
		update: vi.fn(
			async (id: string, patch: TicketPatch): Promise<TicketSummary> =>
				({
					...(open.find((entry) => entry.id === id) as TicketSummary),
					...patch,
					updated: '2026-09-24 10:00:01.000Z'
				}) as TicketSummary
		)
	} satisfies TicketListData;
	const flags = new FlagStore();
	const store = new TicketListStore(data, SESSION, { flags });
	store.activate(EMPTY_LIST_QUERY);
	await vi.waitFor(() => expect(store.openState).toBe('ready'));
	return { store, data, flags };
}

const dialog = (name = QUESTION) => screen.getByRole('dialog', { name });
const noQuestion = () => expect(screen.queryByRole('dialog', { name: /^Vorhaben / })).toBeNull();

afterEach(() => {
	document.body.innerHTML = '';
});

describe('"Aufgaben": check mark and status cell (VH-1)', () => {
	async function showTable(open: TicketSummary[] = [PROJECT, TASK]) {
		mocks.page.url = new URL('/', 'http://localhost:3000');
		const list = await listOf(open);
		render(TicketTable, { props: { store: list.store, catalog: catalog() } });
		render(FlagGroup, { props: { store: list.flags } });
		await tick();
		return list;
	}

	async function chooseStatus(key: string, status: RegExp) {
		const button = screen.getByRole('button', { name: new RegExp(`^Status von ${key}: `) });
		await fireEvent.pointerEnter(button);
		await fireEvent.click(button);
		await tick();
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: status }));
		await tick();
	}

	it('asks before the check mark completes an ongoing project, and "Abbrechen" changes nothing', async () => {
		const { data } = await showTable();
		const check = screen.getByRole<HTMLInputElement>('checkbox', { name: 'TASK-1 erledigt' });

		await fireEvent.click(check);
		await tick();

		const question = dialog();
		expect(
			within(question).getByText(/„Spanisch lernen“ ist ein laufendes Vorhaben\./)
		).toBeTruthy();
		expect(within(question).getByText(/erscheint nicht mehr täglich im Tagesplan/)).toBeTruthy();
		expect(document.activeElement).toBe(
			within(question).getByRole('button', { name: 'Abbrechen' })
		);
		expect(check.checked).toBe(false);
		expect(data.setDone).not.toHaveBeenCalled();

		await fireEvent.click(within(question).getByRole('button', { name: 'Abbrechen' }));
		await tick();

		noQuestion();
		expect(data.setDone).not.toHaveBeenCalled();
		expect(check.checked).toBe(false);
		expect(screen.getByRole('checkbox', { name: 'TASK-1 erledigt' })).toBeTruthy();
	});

	it('completes it with "Abschließen", with "Rückgängig" in the flag', async () => {
		const { data } = await showTable();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'TASK-1 erledigt' }));
		await tick();

		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Abschließen' }));

		await vi.waitFor(() => expect(data.setDone).toHaveBeenCalledWith(PROJECT.id, true));
		await vi.waitFor(() =>
			expect(screen.getAllByText('TASK-1 erledigt.').length).toBeGreaterThan(0)
		);
		expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeTruthy();
		noQuestion();
	});

	it('completes a task at once, without a question, as before', async () => {
		const { data } = await showTable();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'TASK-2 erledigt' }));
		expect(data.setDone).toHaveBeenCalledWith(TASK.id, true);
		await tick();
		noQuestion();
	});

	it('asks before "Erledigt" of the status cell, and saves only after "Abschließen"', async () => {
		const { data } = await showTable();
		await chooseStatus('TASK-1', /Erledigt/);

		expect(dialog()).toBeTruthy();
		expect(data.setDone).not.toHaveBeenCalled();
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(data.setDone).not.toHaveBeenCalled();
		expect(data.update).not.toHaveBeenCalled();

		await chooseStatus('TASK-1', /Erledigt/);
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Abschließen' }));
		await vi.waitFor(() => expect(data.setDone).toHaveBeenCalledWith(PROJECT.id, true));
	});

	it('changes the status of an ongoing project to anything else without a question', async () => {
		const { data } = await showTable();
		await chooseStatus('TASK-1', /Wartet/);
		noQuestion();
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(PROJECT.id, { status: 'waiting' })
		);
	});

	it('asks about open sub-tasks only after "Abschließen"', async () => {
		const child = ticket(3, { kind: 'ongoing', parentId: PROJECT.id, title: 'Vokabeln' });
		const { data } = await showTable([PROJECT, TASK, child]);
		await fireEvent.click(screen.getByRole('checkbox', { name: 'TASK-1 erledigt' }));
		await tick();
		expect(screen.queryByRole('dialog', { name: 'TASK-1 erledigen?' })).toBeNull();

		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Abschließen' }));
		await vi.waitFor(() =>
			expect(screen.getByRole('dialog', { name: 'TASK-1 erledigen?' })).toBeTruthy()
		);
		noQuestion();
		expect(data.setDone).not.toHaveBeenCalled();
	});
});

describe('"Unteraufgaben": check mark and status menu (VH-1)', () => {
	const PARENT = ticket(5, { key: 'HAUS-5', title: 'Umzug', kind: 'ongoing' });
	const CHILD = ticket(6, { key: 'HAUS-6', title: 'Kisten', parentId: PARENT.id, kind: 'ongoing' });
	const PLAIN = ticket(7, { key: 'HAUS-7', title: 'Schlüssel', parentId: PARENT.id });

	async function showSubtasks(inModal = false) {
		const list = await listOf([PARENT, CHILD, PLAIN]);
		const props = {
			ticket: PARENT,
			list: list.store,
			hrefOf: (id: string) => `/tickets/${id}` as ResolvedPathname
		};
		if (inModal) render(InModalHarness, { props: { component: TicketSubtasks, props } });
		else render(TicketSubtasks, { props });
		await tick();
		return list;
	}

	async function openStatus(key: string) {
		const button = screen.getByRole('button', { name: new RegExp(`^Status von ${key}: `) });
		await fireEvent.pointerEnter(button);
		await fireEvent.click(button);
		await tick();
	}

	it('asks before the check mark of a sub-task that is an ongoing project; "Abbrechen" keeps it', async () => {
		const { data } = await showSubtasks();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'HAUS-6 erledigt' }));
		await tick();

		const question = dialog('Vorhaben HAUS-6 abschließen?');
		expect(within(question).getByText(/„Kisten“ ist ein laufendes Vorhaben/)).toBeTruthy();
		await fireEvent.click(within(question).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(data.setDone).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'HAUS-6 erledigt' }));
		await tick();
		await fireEvent.click(
			within(dialog('Vorhaben HAUS-6 abschließen?')).getByRole('button', { name: 'Abschließen' })
		);
		await vi.waitFor(() => expect(data.setDone).toHaveBeenCalledWith(CHILD.id, true));
	});

	it('asks before "Erledigt" of its status menu, and a task sub-task completes at once', async () => {
		const { data } = await showSubtasks();
		await openStatus('HAUS-6');
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: /Erledigt/ }));
		await tick();
		expect(dialog('Vorhaben HAUS-6 abschließen?')).toBeTruthy();
		expect(data.setDone).not.toHaveBeenCalled();
		await fireEvent.click(
			within(dialog('Vorhaben HAUS-6 abschließen?')).getByRole('button', { name: 'Abschließen' })
		);
		await vi.waitFor(() => expect(data.setDone).toHaveBeenCalledWith(CHILD.id, true));

		await fireEvent.click(screen.getByRole('checkbox', { name: 'HAUS-7 erledigt' }));
		expect(data.setDone).toHaveBeenCalledWith(PLAIN.id, true);
		await tick();
		expect(screen.queryByRole('dialog', { name: /HAUS-7/ })).toBeNull();
	});

	it('asks inline in the section in the full view, and gives the focus back after "Abbrechen"', async () => {
		const { data } = await showSubtasks(true);
		const check = screen.getByRole<HTMLInputElement>('checkbox', { name: 'HAUS-6 erledigt' });
		check.focus();
		await fireEvent.click(check);
		await tick();
		await tick();

		expect(screen.queryByRole('dialog', { name: 'Vorhaben HAUS-6 abschließen?' })).toBeNull();
		const inline = screen.getByRole('group', { name: 'Vorhaben HAUS-6 abschließen?' });
		expect(screen.getByRole('region', { name: 'Unteraufgaben' }).contains(inline)).toBe(true);
		const cancel = within(inline).getByRole('button', { name: 'Abbrechen' });
		await vi.waitFor(() => expect(document.activeElement).toBe(cancel));

		await fireEvent.click(cancel);
		await tick();
		await tick();
		expect(screen.queryByRole('group', { name: 'Vorhaben HAUS-6 abschließen?' })).toBeNull();
		expect(document.activeElement).toBe(check);
		expect(data.setDone).not.toHaveBeenCalled();
	});
});

describe('status of the detail (VH-1)', () => {
	async function showFields(initial: Ticket, inModal = false) {
		let current = initial;
		const data = {
			get: vi.fn(async () => current),
			update: vi.fn(async (_id: string, patch: TicketPatch): Promise<Ticket> => {
				current = {
					...current,
					...(patch.status && { status: patch.status }),
					updated: '2026-09-24 10:00:00.000Z'
				};
				return current;
			}),
			create: vi.fn(),
			delete: vi.fn()
		} satisfies TicketDetailData;
		const listTickets = new SvelteMap<string, TicketSummary>();
		const list = {
			find: (id: string) => listTickets.get(id) ?? null,
			upsert: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary)),
			completed: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary)),
			remove: vi.fn(),
			announce: vi.fn(),
			subtasksOf: () => []
		} satisfies TicketListSync;
		const store = new TicketDetailStore(data, SESSION, list);
		store.open(initial.id);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		const props = {
			store,
			catalog: catalog(),
			get ticket() {
				return store.ticket as Ticket;
			}
		};
		if (inModal) render(InModalHarness, { props: { component: TicketFields, props } });
		else render(TicketFields, { props });
		await tick();
		return { data, list };
	}

	it('asks before "Erledigt" of an ongoing project in the panel; the select keeps the status', async () => {
		const { data } = await showFields(PROJECT);
		const select = screen.getByLabelText<HTMLSelectElement>('Status');

		await fireEvent.change(select, { target: { value: 'done' } });
		await tick();

		expect(dialog()).toBeTruthy();
		// A dialog of its own in the top layer: no row below the status (QB-1).
		expectNoStatusQuestions();
		expect(select.value).toBe('in_progress');
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(data.update).not.toHaveBeenCalled();
		expect(select.value).toBe('in_progress');

		await fireEvent.change(select, { target: { value: 'done' } });
		await tick();
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Abschließen' }));
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(PROJECT.id, { status: 'done' })
		);
	});

	it('asks inline below the status in the full view, without a dialog of its own', async () => {
		const { data } = await showFields(PROJECT, true);
		const select = screen.getByLabelText<HTMLSelectElement>('Status');
		select.focus();
		await fireEvent.change(select, { target: { value: 'done' } });
		await tick();
		await tick();

		expect(screen.queryByRole('dialog', { name: QUESTION })).toBeNull();
		const inline = screen.getByRole('group', { name: QUESTION });
		expectRowBelowStatus(inline);
		expect(within(inline).getByText(/erscheint nicht mehr täglich im Tagesplan/)).toBeTruthy();
		await fireEvent.click(within(inline).getByRole('button', { name: 'Abschließen' }));
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(PROJECT.id, { status: 'done' })
		);
	});

	it('asks in a row of its own over both columns in the full view; "Abbrechen" gives the focus back to the status (QB-1)', async () => {
		const { data } = await showFields(PROJECT, true);
		const select = screen.getByLabelText<HTMLSelectElement>('Status');
		select.focus();
		await fireEvent.change(select, { target: { value: 'done' } });
		await tick();
		await tick();

		const inline = screen.getByRole('group', { name: QUESTION });
		expectRowBelowStatus(inline);
		const cancel = within(inline).getByRole('button', { name: 'Abbrechen' });
		expect(document.activeElement).toBe(cancel);

		await fireEvent.click(cancel);

		await vi.waitFor(() => expect(document.activeElement).toBe(select));
		expectNoStatusQuestions();
		expect(select.value).toBe('in_progress');
		expect(data.update).not.toHaveBeenCalled();
	});

	it('saves "Erledigt" of a task at once, without a question', async () => {
		const { data } = await showFields(TASK);
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } });
		await tick();
		noQuestion();
		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(TASK.id, { status: 'done' }));
	});
});

describe('bulk actions "Erledigen" and "Status" (VH-1)', () => {
	async function showBulk(open: TicketSummary[]) {
		mocks.page.url = new URL('/', 'http://localhost:3000');
		const list = await listOf(open);
		const bulkData: BulkEditData = {
			update: vi.fn(
				async (id: string, patch: TicketPatch): Promise<TicketSummary> =>
					({ ...(list.store.find(id) as TicketSummary), ...patch }) as TicketSummary
			),
			delete: vi.fn(async () => null),
			restore: vi.fn(async () => undefined),
			sourceDates: vi.fn(async () => new Map()),
			sourceCount: vi.fn(async () => 0)
		};
		const bulk = new BulkEditStore(bulkData, SESSION, list.store);
		const run = vi.spyOn(bulk, 'run');
		render(TicketTable, { props: { store: list.store, catalog: catalog(), bulk } });
		await tick();
		await fireEvent.click(
			screen.getByRole('checkbox', { name: 'Alle angezeigten Tickets auswählen' })
		);
		await tick();
		return { run };
	}

	const THIRD = ticket(3, { kind: 'ongoing', title: 'Gitarre üben' });

	it('asks once before "Erledigen" with the number of ongoing projects; "Abbrechen" changes no ticket', async () => {
		const { run } = await showBulk([PROJECT, TASK, THIRD]);
		await fireEvent.click(screen.getByRole('button', { name: 'Erledigen' }));
		await tick();

		const question = dialog('2 Vorhaben abschließen?');
		// The keys in the order of the table.
		expect(
			within(question).getByText(
				/^Unter den 3 ausgewählten Tickets sind 2 laufende Vorhaben: TASK-(1 und TASK-3|3 und TASK-1)\. Abgeschlossen sind sie erledigt und erscheinen nicht mehr täglich im Tagesplan\. Mit „Abbrechen“ bleiben alle Tickets, wie sie sind\.$/
			)
		).toBeTruthy();
		expect(screen.getAllByRole('dialog')).toHaveLength(1);
		await fireEvent.click(within(question).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(run).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Erledigen' }));
		await tick();
		await fireEvent.click(
			within(dialog('2 Vorhaben abschließen?')).getByRole('button', { name: 'Abschließen' })
		);
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		expect(run.mock.calls[0]?.[0]).toEqual({ kind: 'complete', withChildren: true });
		expect([...(run.mock.calls[0]?.[1] ?? [])].sort()).toEqual([PROJECT.id, TASK.id, THIRD.id]);
	});

	it('asks the same before the status "Erledigt" of the bar', async () => {
		const { run } = await showBulk([PROJECT, TASK]);
		const bar = within(screen.getByRole('region', { name: /ausgewählt/ }));
		const button = bar.getByRole('button', { name: 'Status' });
		await fireEvent.click(button);
		await tick();
		const menu = within(document.getElementById(button.getAttribute('aria-controls') ?? '')!);
		await fireEvent.click(menu.getByRole('menuitem', { hidden: true, name: 'Erledigt' }));
		await tick();

		const question = dialog(QUESTION);
		expect(
			within(question).getByText(
				/^Unter den 2 ausgewählten Tickets ist 1 laufendes Vorhaben: TASK-1\./
			)
		).toBeTruthy();
		await fireEvent.click(within(question).getByRole('button', { name: 'Abschließen' }));
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		expect(run.mock.calls[0]?.[0]).toEqual({ kind: 'complete', withChildren: true });
		expect([...(run.mock.calls[0]?.[1] ?? [])].sort()).toEqual([PROJECT.id, TASK.id]);
	});

	it('asks about open sub-tasks after it, and completes tasks at once as before', async () => {
		const child = ticket(4, { parentId: TASK.id, title: 'Rahmen' });
		const { run } = await showBulk([PROJECT, TASK, child]);
		// Only the project and its neighbour: the sub-task of TASK-2 stays open.
		await fireEvent.click(screen.getByRole('checkbox', { name: 'TASK-4 auswählen' }));
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Erledigen' }));
		await tick();
		await fireEvent.click(within(dialog()).getByRole('button', { name: 'Abschließen' }));
		await vi.waitFor(() =>
			expect(screen.getByRole('dialog', { name: '2 Tickets erledigen?' })).toBeTruthy()
		);
		expect(run).not.toHaveBeenCalled();
	});
});
