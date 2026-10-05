// The bulk action "In den Haushalt verschieben …" of the table "Aufgaben" (E7-4b, ADR-0061 §8): after a
// move the selection of the table is empty, the bar is gone, and no ID of the other area stays chosen,
// also when the tickets show up again (the tab switches into the area they went to). Since MV-2 the
// dialog offers "Bei wiederkehrenden Tickets die ganze Serie mitnehmen" with "Bisherige erledigte
// Vorkommen mitnehmen (N)", both chosen, and counts series and occurrences apart. Real stores on fake
// data; the moved tickets leave the list as the (app) layout lets them (dropMovedTickets).

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

/** A series of the chosen tickets (MV-2): one rule with one open and four done occurrences. */
const SERIES = { rules: 1, open: 1, done: 4 };

/**
 * A preview of the server without conflicts: the move may run at once. With `series` the chosen
 * tickets belong to a series, and `body` says what the dialog chose. Into the private area the two
 * chosen tickets lose their assignee, and a whole series its rotation (PL-2).
 */
function preview(
	moved: MovePreview['moved'] = null,
	series = false,
	body: Record<string, unknown> = {}
): MovePreview {
	const whole = series && body.series === true;
	const done = whole && body.series_done === true;
	const toPrivate = body.to === 'private';
	return {
		preview: moved === null,
		kind: 'ticket',
		to: toPrivate ? 'private' : 'household',
		scope: `h:${HOUSE.id}`,
		fromName: 'Privat',
		toName: HOUSE.name,
		counts: {
			tickets: done ? 6 : 2,
			subtasks: 0,
			projects: 0,
			rules: whole ? 1 : 0,
			items: 0,
			comments: 0,
			dependencies: 0,
			ticketSources: 0,
			series: whole ? 1 : 0,
			occurrences: { open: whole ? 1 : 0, done: done ? 4 : 0 },
			assigneesCleared: toPrivate ? { tickets: 2, rules: whole ? 1 : 0 } : { tickets: 0, rules: 0 }
		},
		seriesOffer: series ? SERIES : { rules: 0, open: 0, done: 0 },
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

async function setup(series = false, area: 'private' | 'household' = 'private') {
	const household = new HouseholdStore(
		{
			fetch: async () => ({ kind: 'ok' as const, value: householdState })
		} as unknown as HouseholdData,
		SESSION
	);
	await household.load();
	const memory = new Map<string, string>();
	const areas = new AreaStore(
		() => ({
			getItem: (key: string) => memory.get(key) ?? null,
			setItem: (key: string, value: string) => void memory.set(key, value)
		}),
		() => undefined
	);
	areas.begin(ME);
	areas.followHousehold(HOUSE);
	if (area === 'household') areas.select('household');

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
				? preview(null, series, body)
				: preview(
						{
							tickets: (body.ids as string[]).map((id, index) => ({
								id,
								key: `TASK-${index + 1}`,
								previous: open.find((entry) => entry.id === id)?.key ?? ''
							})),
							projects: [],
							rules: [],
							items: []
						},
						series,
						body
					)
	}));
	const moves = new AreaMoveStore({ move }, SESSION, undefined, (result) =>
		dropMovedTickets(store, result)
	);
	render(AreaMoveBulkHarness, {
		props: { area: areas, household, moves, store, catalog, bulk }
	});
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
		expect(within(dialog).queryByRole('checkbox', { name: /ganze Serie/ })).toBeNull();
		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'In den Haushalt verschieben' })
		);
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		// Without a series in the preview the dialog asked nothing about one; the choice stays on (MV-2).
		expect(move).toHaveBeenLastCalledWith(
			{
				kind: 'ticket',
				ids: ['t00000000000001', 't00000000000002'],
				to: 'household',
				series: true,
				series_done: true
			},
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

	it('takes whole series along by default, counts them apart and asks again without (MV-2)', async () => {
		const { move } = await setup(true);
		await choose('TASK-1');
		await choose('TASK-2');
		await fireEvent.click(screen.getByRole('button', { name: 'In den Haushalt verschieben …' }));
		const dialog = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: '2 Tickets in den Haushalt verschieben' })
		);
		const whole = await vi.waitFor(() =>
			within(dialog).getByRole<HTMLInputElement>('checkbox', {
				name: 'Bei wiederkehrenden Tickets die ganze Serie mitnehmen'
			})
		);
		const done = within(dialog).getByRole<HTMLInputElement>('checkbox', {
			name: 'Bisherige erledigte Vorkommen mitnehmen (4)'
		});
		expect([whole.checked, done.checked]).toEqual([true, true]);
		expect(move.mock.calls[0]?.[0]).toMatchObject({
			preview: true,
			series: true,
			series_done: true
		});
		// Series, open and done occurrences apart, and the series runs on in the target.
		for (const line of [
			'6 Tickets',
			'1 Serie mit Regel und Vorlage',
			'1 offenes Vorkommen',
			'4 erledigte Vorkommen',
			'Die Serie läuft im Ziel weiter; ihr nächstes Ticket entsteht dort.'
		]) {
			expect(within(dialog).getByText(line)).toBeTruthy();
		}

		// Without the done ones the preview loads again; they stay.
		await fireEvent.click(done);
		await vi.waitFor(() => expect(within(dialog).getByText('2 Tickets')).toBeTruthy());
		expect(move.mock.calls[1]?.[0]).toMatchObject({
			preview: true,
			series: true,
			series_done: false
		});
		expect(within(dialog).queryByText('4 erledigte Vorkommen')).toBeNull();

		// Without the series the choice of the done ones goes, and nothing of a series moves.
		await fireEvent.click(whole);
		await vi.waitFor(() => expect(move).toHaveBeenCalledTimes(3));
		expect(move.mock.calls[2]?.[0]).toMatchObject({
			preview: true,
			series: false,
			series_done: false
		});
		await vi.waitFor(() =>
			expect(within(dialog).queryByText('1 Serie mit Regel und Vorlage')).toBeNull()
		);
		expect(within(dialog).queryByRole('checkbox', { name: /erledigte Vorkommen/ })).toBeNull();

		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'In den Haushalt verschieben' })
		);
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(move).toHaveBeenLastCalledWith(
			{
				kind: 'ticket',
				ids: ['t00000000000001', 't00000000000002'],
				to: 'household',
				series: false,
				series_done: false
			},
			expect.anything()
		);
	});

	it('warns into the private area which tickets and series lose their assignee (PL-2)', async () => {
		await setup(true, 'household');
		await choose('TASK-1');
		await choose('TASK-2');
		await fireEvent.click(screen.getByRole('button', { name: 'Ins Private verschieben …' }));
		const dialog = await vi.waitFor(() =>
			screen.getByRole('dialog', { name: '2 Tickets ins Private verschieben' })
		);
		await vi.waitFor(() =>
			expect(
				within(dialog).getByText('Bei 2 Tickets und 1 Wiederholung fällt die Zuständigkeit weg.')
			).toBeTruthy()
		);
		// Without the series the rule stays in the household and keeps its rotation.
		await fireEvent.click(
			within(dialog).getByRole('checkbox', {
				name: 'Bei wiederkehrenden Tickets die ganze Serie mitnehmen'
			})
		);
		await vi.waitFor(() =>
			expect(within(dialog).getByText('Bei 2 Tickets fällt die Zuständigkeit weg.')).toBeTruthy()
		);
	});
});
