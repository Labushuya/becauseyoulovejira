// The bulk action "In den Haushalt verschieben …" of the table "Aufgaben" (E7-4b, ADR-0061 §8): after a
// move the selection of the table is empty, the bar is gone, and no ID of the other area stays chosen,
// also when the tickets show up again (the tab switches into the area they went to). Real stores on
// fake data; the moved tickets leave the list as the (app) layout lets them (dropMovedTickets).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoveAnswer } from '$lib/data/area-move';
import type { MovePreview } from '$lib/domain/area-move';
import type { HouseholdState } from '$lib/domain/household';
import { parseListQuery } from '$lib/domain/list-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { pb } from '$lib/pocketbase';
import { AreaMoveStore, dropMovedTickets } from '$lib/stores/area-move.svelte';
import { AreaStore } from '$lib/stores/area.svelte';
import { BulkEditStore, type BulkEditData } from '$lib/stores/bulk-edit.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { HouseholdStore, type HouseholdData } from '$lib/stores/household.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import AreaMoveBulkHarness from '$lib/test/AreaMoveBulkHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const ME = 'user00000000001';
const HOUSE = { id: 'house0000000001', name: 'Haus Beispiel' };
const SESSION = { ensureValid: () => true, logout: vi.fn() };

beforeEach(() => {
	pb.authStore.save('test-token', {
		id: ME,
		collectionId: '_pb_users_auth_',
		collectionName: 'users'
	} as never);
});

afterEach(() => {
	pb.authStore.clear();
	document.body.innerHTML = '';
});

function ticket(n: number): TicketSummary {
	return {
		id: `t${String(n).padStart(14, '0')}`,
		key: `TASK-${n}`,
		title: `Ticket ${n}`,
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
		created: `2026-09-${String(n).padStart(2, '0')} 10:00:00.000Z`,
		updated: '2026-09-01 10:00:00.000Z',
		owner: ME
	};
}

const householdState: HouseholdState = {
	household: { ...HOUSE, created: '', trashRetention: '30' },
	me: { member: 'member00000001', role: 'member', rights: [] },
	members: [],
	invites: null
};

/** A preview of the server without conflicts: the move may run at once. */
function preview(moved: MovePreview['moved'] = null): MovePreview {
	return {
		preview: moved === null,
		kind: 'ticket',
		to: 'household',
		scope: `h:${HOUSE.id}`,
		fromName: 'Privat',
		toName: HOUSE.name,
		counts: {
			tickets: 2,
			subtasks: 0,
			projects: 0,
			rules: 0,
			items: 0,
			comments: 0,
			dependencies: 0,
			ticketSources: 0
		},
		conflicts: {
			project: null,
			tags: { reused: [], created: [] },
			dependencies: [],
			ticketSources: [],
			parents: [],
			projectParents: [],
			codes: [],
			series: [],
			ruleTickets: 0,
			rulesProject: [],
			items: { connection: 0, target: 0, duplicate: 0 },
			targets: 0,
			unitTargets: 0
		},
		needs: { project: false, dependencies: false, ticketSources: false, codes: [] },
		moved
	};
}

async function setup() {
	const household = new HouseholdStore(
		{
			fetch: async () => ({ kind: 'ok' as const, value: householdState })
		} as unknown as HouseholdData,
		SESSION
	);
	await household.load();
	const memory = new Map<string, string>();
	const area = new AreaStore(
		() => ({
			getItem: (key: string) => memory.get(key) ?? null,
			setItem: (key: string, value: string) => void memory.set(key, value)
		}),
		() => undefined
	);
	area.begin(ME);
	area.followHousehold(HOUSE);

	const open = [ticket(1), ticket(2), ticket(3)];
	const data: TicketListData = {
		listOpen: vi.fn(async () => open),
		listSubtasks: vi.fn(async () => []),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const store = new TicketListStore(data, SESSION);
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	const bulkData: BulkEditData = {
		update: vi.fn(),
		delete: vi.fn(async () => null),
		restore: vi.fn(async () => undefined),
		sourceDates: vi.fn(async () => new Map()),
		sourceCount: vi.fn(async () => 0)
	};
	const bulk = new BulkEditStore(bulkData, SESSION, store);

	const move = vi.fn(async (body: Record<string, unknown>): Promise<MoveAnswer<MovePreview>> => ({
		kind: 'ok',
		value:
			body.preview === true
				? preview()
				: preview({
						tickets: (body.ids as string[]).map((id, index) => ({
							id,
							key: `TASK-${index + 1}`,
							previous: open.find((entry) => entry.id === id)?.key ?? ''
						})),
						projects: [],
						rules: [],
						items: []
					})
	}));
	const moves = new AreaMoveStore({ move }, SESSION, undefined, (result) =>
		dropMovedTickets(store, result)
	);
	render(AreaMoveBulkHarness, { props: { area, household, moves, store, catalog, bulk } });
	await vi.waitFor(() => expect(box('TASK-1')).toBeTruthy());
	return { store, move };
}

const box = (key: string) =>
	screen.getByRole<HTMLInputElement>('checkbox', { name: `${key} auswählen` });
const headBox = () =>
	screen.getByRole<HTMLInputElement>('checkbox', { name: 'Alle angezeigten Tickets auswählen' });
const bar = () => screen.queryByRole('region', { name: /ausgewählt/ });

async function choose(key: string) {
	const input = box(key);
	await fireEvent.pointerDown(input.closest('td') as HTMLElement);
	await fireEvent.click(input);
}

describe('the bulk action "In den Haushalt verschieben …" (E7-4b)', () => {
	it('leaves no ticket of the other area chosen after a move, also when they show up again', async () => {
		const { store, move } = await setup();
		await choose('TASK-1');
		await choose('TASK-2');
		expect(within(bar() as HTMLElement).getByText('2 Tickets ausgewählt')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'In den Haushalt verschieben …' }));
		const dialog = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: '2 Tickets in den Haushalt verschieben' })
		);
		await vi.waitFor(() => expect(within(dialog).getByText('2 Tickets')).toBeTruthy());
		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'In den Haushalt verschieben' })
		);
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(move).toHaveBeenLastCalledWith(
			{ kind: 'ticket', ids: ['t00000000000001', 't00000000000002'], to: 'household' },
			expect.anything()
		);

		// The moved rows are gone, and the selection with them: no bar, the head box is empty.
		await vi.waitFor(() => expect(bar()).toBeNull());
		expect(screen.queryByRole('checkbox', { name: 'TASK-1 auswählen' })).toBeNull();
		expect(box('TASK-3').checked).toBe(false);
		expect(headBox().checked).toBe(false);
		expect(headBox().indeterminate).toBe(false);

		// The tab shows the area they went to: they come back, none of them chosen.
		store.rescope();
		await vi.waitFor(() => expect(box('TASK-1')).toBeTruthy());
		expect(['TASK-1', 'TASK-2', 'TASK-3'].map((key) => box(key).checked)).toEqual([
			false,
			false,
			false
		]);
		expect(bar()).toBeNull();
	});
});
