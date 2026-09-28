// Completing a ticket with open blocking sub-tasks (ADR-0033 section 2) in the table and in the
// fields of panel and full view: the check mark asks with the confirmation (radios "Unteraufgaben
// mit erledigen" and "Trotzdem erledigen"), the status select asks inline below the status. Stores
// run for real on fake data layers.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DoneTicketPage } from '$lib/data/tickets';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketFields from './TicketFields.svelte';
import TicketTable from './TicketTable.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const PARENT_ID = 'parent000000001';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: PARENT_ID,
		key: 'HAUS-12',
		title: 'Umzug',
		description: '',
		sourceItem: null,
		status: 'in_progress',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

const CHILDREN = [
	ticket({ id: 'child0000000001', key: 'HAUS-13', title: 'Kartons', parentId: PARENT_ID }),
	ticket({ id: 'child0000000002', key: 'HAUS-14', title: 'Küche', parentId: PARENT_ID })
];

function catalog() {
	const store = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void store.load();
	return store;
}

describe('check mark of a ticket with open blocking sub-tasks', () => {
	async function showTable() {
		const parent = ticket();
		const data = {
			listOpen: vi.fn(async () => [parent, ...CHILDREN]),
			listSubtasks: vi.fn(async () => CHILDREN),
			listDone: vi.fn(async (page: number): Promise<DoneTicketPage> => ({
				items: [],
				page,
				hasMore: false
			})),
			searchOpen: vi.fn(async () => []),
			setDone: vi.fn(async (id: string, done: boolean) => ({
				...([parent, ...CHILDREN].find((entry) => entry.id === id) ?? parent),
				status: done ? ('done' as const) : ('open' as const),
				updated: '2026-09-24 10:00:00.000Z'
			})),
			update: vi.fn(
				async (id: string, patch: TicketPatch) =>
					({ ...parent, id, ...patch, updated: '2026-09-24 10:00:01.000Z' }) as TicketSummary
			)
		} satisfies TicketListData;
		const store = new TicketListStore(data, SESSION);
		store.activate({ ...(await import('$lib/domain/list-query')).EMPTY_LIST_QUERY });
		render(TicketTable, { props: { store, catalog: catalog() } });
		await vi.waitFor(() => expect(store.openState).toBe('ready'));
		await tick();
		return { store, data };
	}

	it('asks with the confirmation and keeps the check mark until the answer', async () => {
		const { data } = await showTable();
		const check = screen.getByRole('checkbox', { name: 'HAUS-12 erledigt' }) as HTMLInputElement;

		await fireEvent.click(check);
		await tick();

		const dialog = screen.getByRole('dialog', { name: 'HAUS-12 erledigen?' });
		expect(
			within(dialog).getByText('2 Unteraufgaben sind noch offen – trotzdem erledigen?')
		).toBeTruthy();
		const withChildren = within(dialog).getByRole('radio', {
			name: /Unteraufgaben mit erledigen/
		}) as HTMLInputElement;
		expect(withChildren.checked).toBe(true);
		expect(
			document.getElementById(withChildren.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe('HAUS-13 und HAUS-14 werden ebenfalls erledigt.');
		expect(within(dialog).getByRole('radio', { name: /Trotzdem erledigen/ })).toBeTruthy();
		expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		expect(check.checked).toBe(false);
		expect(data.setDone).not.toHaveBeenCalled();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Erledigen' }));

		await vi.waitFor(() =>
			expect(data.setDone).toHaveBeenCalledWith(PARENT_ID, true, 'complete_children')
		);
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	it('completes it anyway with "Trotzdem erledigen" and keeps it open with "Abbrechen"', async () => {
		const { data } = await showTable();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'HAUS-12 erledigt' }));
		await tick();
		let dialog = screen.getByRole('dialog', { name: 'HAUS-12 erledigen?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(data.setDone).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'HAUS-12 erledigt' }));
		await tick();
		dialog = screen.getByRole('dialog', { name: 'HAUS-12 erledigen?' });
		await fireEvent.click(within(dialog).getByRole('radio', { name: /Trotzdem erledigen/ }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Erledigen' }));

		await vi.waitFor(() => expect(data.setDone).toHaveBeenCalledWith(PARENT_ID, true, 'force'));
	});
});

describe('status "Erledigt" of a ticket with open blocking sub-tasks', () => {
	async function showFields() {
		let current = ticket();
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
			subtasksOf: () => CHILDREN
		} satisfies TicketListSync;
		const store = new TicketDetailStore(data, SESSION, list);
		store.open(PARENT_ID);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		render(TicketFields, {
			props: {
				store,
				catalog: catalog(),
				get ticket() {
					return store.ticket as Ticket;
				}
			}
		});
		await tick();
		return { store, data, list };
	}

	it('asks inline below the status, without a dialog, and answers with the choice', async () => {
		const { data, list } = await showFields();
		const select = screen.getByLabelText('Status') as HTMLSelectElement;

		await fireEvent.change(select, { target: { value: 'done' } });
		await tick();

		expect(screen.queryByRole('dialog')).toBeNull();
		expect(
			screen.getByRole('heading', {
				name: /2 Unteraufgaben sind noch offen – trotzdem erledigen\?/
			})
		).toBeTruthy();
		expect(select.value).toBe('in_progress');
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(data.update).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Erledigen' }));

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(
				PARENT_ID,
				{ status: 'done' },
				{ completion: 'complete_children' }
			)
		);
		expect(list.completed).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'done' }),
			'in_progress',
			[
				{ id: 'child0000000001', key: 'HAUS-13', previousStatus: 'in_progress' },
				{ id: 'child0000000002', key: 'HAUS-14', previousStatus: 'in_progress' }
			]
		);
		await vi.waitFor(() => expect(document.activeElement).toBe(select));
		expect(screen.queryByRole('button', { name: 'Erledigen' })).toBeNull();
	});

	it('explains a refused reopening of a series inline and reopens it as a normal ticket (ADR-0023 addendum 4)', async () => {
		const { store, data } = await showFields();
		const message =
			'Von dieser Serie ist schon HAUS-20 offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).';
		data.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					status: {
						code: 'validation_recurrence_reopen_older',
						message,
						params: { key: 'HAUS-20' }
					}
				}
			})
		);
		const select = screen.getByLabelText('Status') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'open' } });
		await tick();

		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.getByRole('heading', { name: /Nicht wieder in die Serie/ })).toBeTruthy();
		expect(screen.getByText(message)).toBeTruthy();
		expect(select.value).toBe('in_progress');
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));

		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Als normales Ticket wieder öffnen (aus der Serie lösen)'
			})
		);
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenLastCalledWith(PARENT_ID, {
				status: 'open',
				detachSeries: true
			})
		);
		await vi.waitFor(() => expect(store.reopenQuestion).toBeNull());
		await vi.waitFor(() => expect(document.activeElement).toBe(select));
	});

	it('cancels with Escape, consumes it and returns the focus to the status', async () => {
		const { data } = await showFields();
		const select = screen.getByLabelText('Status') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'done' } });
		await tick();

		const passedOn = await fireEvent.keyDown(screen.getByRole('button', { name: 'Abbrechen' }), {
			key: 'Escape'
		});
		await tick();

		expect(passedOn).toBe(false);
		expect(screen.queryByRole('button', { name: 'Erledigen' })).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(select));
		expect(data.update).not.toHaveBeenCalled();
	});
});
