// Ticket list store with a fake data layer (E2 plan, package 5): order, a ticket leaving the list
// once done (since ER-1 the view "Erledigte" shows it, ADR-0066), stale answers and requests,
// midnight, check mark with "Rückgängig" in a flag, reset.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { EMPTY_LIST_QUERY, NO_PROJECT, type ListQuery } from '$lib/domain/list-query';
import type { TicketDraft, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { FLAG_DURATION_MS, FlagStore } from './flags.svelte';
import type { LiveSource, RecordChange, Unsubscribe } from './realtime';
import { SEARCH_DEBOUNCE_MS, TicketListStore, type TicketListData } from './ticket-list.svelte';

// 2026-09-24 12:00 in Berlin (CEST).
const NOON = Date.UTC(2026, 8, 24, 10, 0, 0);

let sequence = 0;

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	const id = overrides.id ?? `t${String(sequence).padStart(14, '0')}`;
	return {
		id,
		key: `TASK-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'open',
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

function done(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return ticket({ status: 'done', completedAt: '2026-09-20 10:00:00.000Z', ...overrides });
}

/** Promise that rejects with "aborted" once the signal of the request aborts. */
function abortable<T>(options: RequestOptions, value: Promise<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		options.signal?.addEventListener('abort', () => reject(new DataError('aborted')));
		value.then(resolve, reject);
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** `open` are listed; `known` are only known to the server (done sub-tasks of the tests). */
function fakeData(open: TicketSummary[] = [], known: TicketSummary[] = []) {
	const data = {
		listOpen: vi.fn((options: RequestOptions) => abortable(options, Promise.resolve(open))),
		searchOpen: vi.fn<TicketListData['searchOpen']>(async () => []),
		setDone: vi.fn(async (id: string, isDone: boolean): Promise<TicketSummary> => {
			const current = [...open, ...known].find((entry) => entry.id === id);
			if (!current) throw new DataError('not_found');
			return {
				...current,
				status: isDone ? 'done' : 'open',
				completedAt: isDone ? '2026-09-24 10:00:00.000Z' : null,
				updated: '2026-09-24 10:00:00.000Z'
			};
		}),
		update: vi.fn(async (id: string, patch: TicketPatch): Promise<TicketSummary> => {
			const current = [...open, ...known].find((entry) => entry.id === id);
			if (!current) throw new DataError('not_found');
			return {
				...current,
				...(patch.status ? { status: patch.status } : {}),
				completedAt: null,
				updated: '2026-09-24 10:00:01.000Z'
			};
		})
	} satisfies TicketListData;
	return data;
}

function session(valid = true) {
	return { ensureValid: vi.fn(() => valid), logout: vi.fn() };
}

async function settle() {
	await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOON);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('area of the tab (E7-3, ADR-0059 §2)', () => {
	it('drops the tickets of the old area at once and loads the new one for the same query', async () => {
		const privateTicket = ticket({ title: 'Privat' });
		const householdTicket = ticket({ title: 'Haushalt' });
		const data = fakeData([privateTicket]);
		const store = new TicketListStore(data, session());
		store.activate({ ...EMPTY_LIST_QUERY, priority: 'medium' });
		await settle();
		expect(store.open.map((entry) => entry.id)).toEqual([privateTicket.id]);

		data.listOpen.mockImplementation((options: RequestOptions) =>
			abortable(options, Promise.resolve([householdTicket]))
		);
		store.rescope();
		expect(store.open).toEqual([]);
		expect(store.openState).toBe('loading');
		expect(store.query.priority).toBe('medium');
		await settle();
		expect(store.open.map((entry) => entry.id)).toEqual([householdTicket.id]);
		expect(data.listOpen).toHaveBeenCalledTimes(2);
	});

	it('loads nothing for a list that was never shown', () => {
		const data = fakeData([ticket()]);
		const store = new TicketListStore(data, session());
		store.rescope();
		expect(store.openState).toBe('idle');
		expect(data.listOpen).not.toHaveBeenCalled();
	});
});

describe('loading and order', () => {
	it('loads only the open tickets and sorts them in the default order', async () => {
		const later = ticket({ priority: 'urgent' });
		const overdue = ticket({ due: '2026-09-20', priority: 'low' });
		const soon = ticket({ due: '2026-09-26' });
		const data = fakeData([later, soon, overdue]);
		const store = new TicketListStore(data, session());

		store.activate(EMPTY_LIST_QUERY);
		expect(store.openState).toBe('loading');
		await settle();

		expect(store.openState).toBe('ready');
		expect(store.open.map((entry) => entry.id)).toEqual([overdue.id, soon.id, later.id]);
	});

	it('shows a load error, but not an aborted request, and retries', async () => {
		const data = fakeData([ticket()]);
		data.listOpen.mockRejectedValueOnce(new DataError('network'));
		const store = new TicketListStore(data, session());

		store.activate(EMPTY_LIST_QUERY);
		await settle();
		expect(store.openState).toBe('error');
		expect(store.openError).toMatch(/Server nicht erreichbar/);

		await store.reload();
		expect(store.openState).toBe('ready');
		expect(store.openError).toBeNull();
		expect(store.open).toHaveLength(1);
	});

	it('ends the session on a session error and sends nothing without a valid session', async () => {
		const data = fakeData();
		data.listOpen.mockRejectedValueOnce(new DataError('session'));
		const guard = session();
		const store = new TicketListStore(data, guard);

		store.activate(EMPTY_LIST_QUERY);
		await settle();
		expect(guard.logout).toHaveBeenCalledOnce();
		expect(store.openError).toBeNull();

		const invalid = fakeData();
		new TicketListStore(invalid, session(false)).activate(EMPTY_LIST_QUERY);
		expect(invalid.listOpen).not.toHaveBeenCalled();
	});

	it('loads the open tickets once for the project view without a list state (package 14)', async () => {
		const item = ticket();
		const data = fakeData([item]);
		const store = new TicketListStore(data, session());

		store.loadOpen();
		store.loadOpen();
		await settle();

		expect(data.listOpen).toHaveBeenCalledOnce();
		expect(store.open).toEqual([item]);
		store.loadOpen();
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		expect(data.listOpen).toHaveBeenCalledOnce();
		expect(store.announcement).toBe('');
	});
});

describe('upsert and remove', () => {
	it('lets a done ticket leave the list and takes it back when it is open again', async () => {
		const item = ticket();
		const store = new TicketListStore(fakeData([item]), session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		const closed = { ...item, status: 'done' as const, updated: '2026-09-24 09:00:00.000Z' };
		store.upsert(closed);
		expect(store.open).toEqual([]);
		expect(store.find(item.id)).toBeNull();

		const reopened = { ...closed, status: 'open' as const, updated: '2026-09-24 09:30:00.000Z' };
		store.upsert(reopened);
		expect(store.open).toEqual([reopened]);
		store.upsert({ ...item, title: 'veraltet' });
		expect(store.find(item.id)?.title).toBe(item.title);

		store.remove(item.id);
		expect(store.open).toEqual([]);
		expect(store.find(item.id)).toBeNull();
	});

	it('keeps done tickets out of the list (ADR-0066)', async () => {
		const store = new TicketListStore(fakeData(), session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		store.upsert(done());
		expect(store.open).toEqual([]);
		expect(store.visible).toEqual([]);
	});

	it('resorts after an update', async () => {
		const first = ticket({ priority: 'high' });
		const second = ticket({ priority: 'low' });
		const store = new TicketListStore(fakeData([first, second]), session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		expect(store.open.map((entry) => entry.id)).toEqual([first.id, second.id]);

		store.upsert({ ...second, priority: 'urgent', updated: '2026-09-24 09:00:00.000Z' });
		expect(store.open.map((entry) => entry.id)).toEqual([second.id, first.id]);
	});
});

describe('visible rows and counter (E3 plan, package 5)', () => {
	it('shows the open tickets in the default order and counts those that are not done', async () => {
		const first = ticket({ priority: 'urgent' });
		const second = ticket();
		const store = new TicketListStore(fakeData([second, first]), session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		expect(store.visible.map((entry) => entry.id)).toEqual([first.id, second.id]);
		expect(store.openCount).toBe(2);

		await store.setDone(first.id, true);
		// The checked row leaves at once; "Rückgängig" stands in its flag (UI-5).
		expect(store.visible.map((entry) => entry.id)).toEqual([second.id]);
		expect(store.openCount).toBe(1);

		store.upsert(ticket());
		expect(store.openCount).toBe(2);
	});
});

describe('filters (E3 plan, package 10)', () => {
	const HOUSE = 'proj00000000001';
	const query = (overrides: Partial<ListQuery>): ListQuery => ({
		...EMPTY_LIST_QUERY,
		...overrides
	});

	it('filters the open tickets without loading them again and announces the number', async () => {
		const urgent = ticket({ priority: 'urgent', projectId: HOUSE });
		const high = ticket({ priority: 'high' });
		const data = fakeData([urgent, high]);
		const store = new TicketListStore(data, session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		store.activate(query({ priority: 'urgent' }));
		expect(store.visible.map((entry) => entry.id)).toEqual([urgent.id]);
		expect(store.visibleCount).toBe(1);
		expect(store.announcement).toBe('1 Ticket.');

		store.activate(query({ priority: 'urgent', project: NO_PROJECT }));
		expect(store.visible).toEqual([]);
		expect(store.announcement).toBe('Keine Tickets für diese Filter.');

		store.activate(EMPTY_LIST_QUERY);
		expect(store.visibleCount).toBe(2);
		expect(store.announcement).toBe('2 Tickets.');
		// The open tickets and the header counter stay unfiltered.
		expect(store.openCount).toBe(2);
		expect(data.listOpen).toHaveBeenCalledOnce();
	});

	it('announces nothing when only the view changes', async () => {
		const store = new TicketListStore(fakeData([ticket()]), session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		store.activate(query({ sort: { key: 'title', reversed: false }, grouping: 'status' }));
		expect(store.announcement).toBe('');
	});

	it('shows new and changed tickets only when they pass the filters', async () => {
		const store = new TicketListStore(fakeData([]), session());
		store.activate(query({ status: 'in_progress' }));
		await settle();

		const item = ticket({ status: 'open', updated: '2026-09-24 09:00:00.000Z' });
		store.upsert(item);
		expect(store.visible).toEqual([]);
		store.upsert({ ...item, status: 'in_progress', updated: '2026-09-24 09:01:00.000Z' });
		expect(store.visible.map((entry) => entry.id)).toEqual([item.id]);
	});

	it('removes a just checked row at once under a status filter (UI-5)', async () => {
		const item = ticket({ status: 'in_progress' });
		const store = new TicketListStore(fakeData([item]), session());
		store.activate(query({ status: 'in_progress' }));
		await settle();

		await store.setDone(item.id, true);
		expect(store.visible).toEqual([]);
		expect(store.visibleCount).toBe(0);
	});

	it('shows no done ticket, whatever the status filter (ADR-0066)', async () => {
		const open = ticket();
		const store = new TicketListStore(fakeData([open]), session());
		store.activate(query({ status: 'done' }));
		await settle();

		expect(store.visible).toEqual([]);
		expect(store.visibleCount).toBe(0);
		store.upsert(done());
		expect(store.visible).toEqual([]);
		expect(store.open.map((entry) => entry.id)).toEqual([open.id]);
	});

	it('filters by "Wiederkehrend" (plan OR-2)', async () => {
		const series = ticket({ recurring: true, recurrenceId: 'rule00000000001' });
		const single = ticket();
		const store = new TicketListStore(fakeData([series, single]), session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		store.activate(query({ recurring: 'recurring' }));
		expect(store.visible.map((entry) => entry.id)).toEqual([series.id]);
		expect(store.announcement).toBe('1 Ticket.');

		store.activate(query({ recurring: 'once' }));
		expect(store.visible.map((entry) => entry.id)).toEqual([single.id]);
	});
});

describe('project filter with sub projects (ADR-0034)', () => {
	const query = (overrides: Partial<ListQuery>): ListQuery => ({
		...EMPTY_LIST_QUERY,
		...overrides
	});
	const HOUSE_ID = 'proj00000000001';
	const GARDEN_ID = 'proj00000000011';

	it('shows the tickets of the sub projects unless they are switched off', async () => {
		const inHouse = ticket({ projectId: HOUSE_ID });
		const inGarden = ticket({ projectId: GARDEN_ID });
		const elsewhere = ticket({ projectId: 'proj00000000002' });
		const store = new TicketListStore(fakeData([inHouse, inGarden, elsewhere]), session(), {
			subProjectsOf: (id) => (id === HOUSE_ID ? [GARDEN_ID] : [])
		});
		store.activate(query({ project: HOUSE_ID }));
		await settle();
		expect(store.visible.map((entry) => entry.id).sort()).toEqual([inHouse.id, inGarden.id].sort());

		store.activate(query({ project: HOUSE_ID, subProjects: false }));
		expect(store.visible.map((entry) => entry.id)).toEqual([inHouse.id]);
	});
});

describe('column sort (E3 plan, package 9)', () => {
	const sorted = (key: 'status' | 'project', reversed = false): ListQuery => ({
		...EMPTY_LIST_QUERY,
		sort: { key, reversed }
	});

	it('removes a just checked row from the status sort at once (UI-5)', async () => {
		const backlog = ticket({ status: 'backlog' });
		const working = ticket({ status: 'in_progress' });
		const waiting = ticket({ status: 'waiting' });
		const store = new TicketListStore(fakeData([waiting, working, backlog]), session());
		store.activate(sorted('status'));
		await settle();
		expect(store.visible.map((entry) => entry.id)).toEqual([backlog.id, working.id, waiting.id]);

		await store.setDone(working.id, true);
		expect(store.visible.map((entry) => entry.id)).toEqual([backlog.id, waiting.id]);
	});

	it('resolves projects through the given function, by default through expand', async () => {
		const first = { id: 'proj00000000001', name: 'Bau', code: 'BAU', archived: false };
		const second = { id: 'proj00000000002', name: 'Auto', code: 'AUTO', archived: false };
		const a = ticket({ projectId: first.id, project: first });
		const b = ticket({ projectId: second.id, project: second });

		const byExpand = new TicketListStore(fakeData([a, b]), session());
		byExpand.activate(sorted('project'));
		await settle();
		expect(byExpand.visible.map((entry) => entry.id)).toEqual([b.id, a.id]);

		const renamed = new TicketListStore(fakeData([a, b]), session(), {
			projectOf: (entry) =>
				entry.projectId === second.id ? { ...second, name: 'Zelt' } : entry.project
		});
		renamed.activate(sorted('project'));
		await settle();
		expect(renamed.visible.map((entry) => entry.id)).toEqual([a.id, b.id]);
	});
});

describe('filter cards (FI-1)', () => {
	const HOUSE = 'proj00000000001';
	const query = (overrides: Partial<ListQuery>): ListQuery => ({
		...EMPTY_LIST_QUERY,
		...overrides
	});
	const ids = (tickets: readonly TicketSummary[]) => tickets.map((entry) => entry.id).sort();

	it('shows the union of the chosen cards, each ticket once, and announces the number', async () => {
		// Today is 2026-09-24 (NOON).
		const lateUrgent = ticket({ due: '2026-09-23', priority: 'urgent' });
		const working = ticket({ status: 'in_progress', due: '2026-09-24' });
		const all = ticket({ status: 'in_progress', due: '2026-09-24', priority: 'urgent' });
		const plain = ticket();
		const store = new TicketListStore(fakeData([lateUrgent, working, all, plain]), session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		store.activate(query({ cards: ['in_progress', 'due_today', 'urgent'] }));
		expect(ids(store.visible)).toEqual(ids([lateUrgent, working, all]));
		expect(store.visibleCount).toBe(3);
		expect(store.announcement).toBe('3 Tickets.');

		store.activate(query({ cards: ['due_today', 'overdue'] }));
		expect(ids(store.visible)).toEqual(ids([lateUrgent, working, all]));

		// The detail filters narrow the union.
		store.activate(query({ cards: ['in_progress', 'urgent'], priority: 'urgent' }));
		expect(ids(store.visible)).toEqual(ids([lateUrgent, all]));
		expect(store.announcement).toBe('2 Tickets.');

		store.activate(EMPTY_LIST_QUERY);
		expect(store.visibleCount).toBe(4);
	});

	it('counts each card over the detail filters, not the other cards, and follows changes', async () => {
		const lateUrgent = ticket({ due: '2026-09-23', priority: 'urgent', projectId: HOUSE });
		const working = ticket({ status: 'in_progress', due: '2026-09-24', projectId: HOUSE });
		const store = new TicketListStore(fakeData([lateUrgent, working, ticket()]), session());
		store.activate(query({ cards: ['urgent'] }));
		await settle();

		const all = { allOpen: 3, in_progress: 1, due_today: 1, overdue: 1, urgent: 1 };
		expect(store.cardCounts).toEqual(all);
		expect(store.cardCounts.allOpen).toBe(store.openCount);
		store.activate(query({ cards: ['in_progress', 'overdue'] }));
		expect(store.cardCounts).toEqual(all);

		store.activate(query({ project: HOUSE }));
		expect(store.cardCounts).toEqual({ ...all, allOpen: 2 });
		store.activate(query({ priority: 'low' }));
		expect(store.cardCounts).toEqual({
			allOpen: 0,
			in_progress: 0,
			due_today: 0,
			overdue: 0,
			urgent: 0
		});

		store.activate(EMPTY_LIST_QUERY);
		// A just checked row counts as done, like the header counter.
		await store.setDone(lateUrgent.id, true);
		expect(store.cardCounts).toMatchObject({ allOpen: 2, overdue: 0, urgent: 0 });
		store.upsert(ticket({ priority: 'urgent' }));
		expect(store.cardCounts).toMatchObject({ allOpen: 3, urgent: 1 });
		store.remove(working.id);
		expect(store.cardCounts).toMatchObject({ allOpen: 2, in_progress: 0, due_today: 0 });
	});

	it('counts only the hits of the search', async () => {
		const hit = ticket({ priority: 'urgent' });
		const data = fakeData([hit, ticket({ priority: 'urgent' }), ticket()]);
		data.searchOpen.mockResolvedValue([hit.id]);
		const store = new TicketListStore(data, session());

		store.activate(query({ search: 'Miete' }));
		await settle();

		expect(store.cardCounts).toMatchObject({ allOpen: 1, urgent: 1 });
	});

	it('move the due numbers at the Berlin midnight', async () => {
		// 2026-09-24 23:59 in Berlin.
		vi.setSystemTime(Date.UTC(2026, 8, 24, 21, 59, 0));
		const store = new TicketListStore(fakeData([ticket({ due: '2026-09-24' })]), session());
		const stop = store.start();
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		expect(store.cardCounts).toMatchObject({ due_today: 1, overdue: 0 });

		await vi.advanceTimersByTimeAsync(61_000);
		expect(store.cardCounts).toMatchObject({ due_today: 0, overdue: 1 });
		stop();
	});
});

describe('today', () => {
	it('computes the order again after the Berlin midnight without a reload', async () => {
		// 2026-09-24 23:59 in Berlin.
		vi.setSystemTime(Date.UTC(2026, 8, 24, 21, 59, 0));
		const urgent = ticket({ priority: 'urgent' });
		const nextWeek = ticket({ due: '2026-10-02', priority: 'low' });
		const store = new TicketListStore(fakeData([urgent, nextWeek]), session());
		const stop = store.start();
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		expect(store.today).toBe('2026-09-24');
		expect(store.open.map((entry) => entry.id)).toEqual([urgent.id, nextWeek.id]);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(store.today).toBe('2026-09-24');
		await vi.advanceTimersByTimeAsync(1_000);
		expect(store.today).toBe('2026-09-25');
		expect(store.open.map((entry) => entry.id)).toEqual([nextWeek.id, urgent.id]);

		// The timer is planned again for the following midnight.
		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
		expect(store.today).toBe('2026-09-26');

		stop();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('check mark', () => {
	/** A store with real flags (ADR-0025 section 8), so the tests see "Rückgängig" in the flag. */
	function withFlags(data: TicketListData) {
		const flags = new FlagStore();
		const store = new TicketListStore(data, session(), { flags });
		return { flags, store };
	}

	it('shows the new state at once, locks during the request and offers undo in a flag', async () => {
		const item = ticket({ status: 'in_progress' });
		const data = fakeData([item]);
		const answer = deferred<TicketSummary>();
		data.setDone.mockImplementationOnce(() => answer.promise);
		const { flags, store } = withFlags(data);
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		const request = store.setDone(item.id, true);
		expect(store.isChecked(item)).toBe(true);
		expect(store.isPending(item.id)).toBe(true);
		void store.setDone(item.id, false);
		expect(data.setDone).toHaveBeenCalledOnce();

		answer.resolve({ ...item, status: 'done', updated: '2026-09-24 10:00:00.000Z' });
		await request;
		expect(store.isPending(item.id)).toBe(false);
		// The row leaves at once; "Rückgängig" stands in the flag (UI-5).
		expect(store.open).toEqual([]);
		expect(store.canUndo(item.id)).toBe(true);
		expect(flags.flags.map((flag) => [flag.tone, flag.title, flag.action?.label])).toEqual([
			['success', `${item.key} erledigt.`, 'Rückgängig']
		]);
		expect(store.announcement).toBe('');

		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS);
		expect(flags.flags).toEqual([]);
		expect(store.canUndo(item.id)).toBe(false);
	});

	it('restores the exact previous status with "Rückgängig" in the flag', async () => {
		const item = ticket({ status: 'waiting' });
		const data = fakeData([item]);
		const { flags, store } = withFlags(data);
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		await store.setDone(item.id, true);
		flags.act(flags.flags[0]?.id ?? '');
		await settle();

		expect(data.update).toHaveBeenCalledWith(item.id, { status: 'waiting' });
		expect(store.canUndo(item.id)).toBe(false);
		expect(store.open.map((entry) => entry.status)).toEqual(['waiting']);
		expect(flags.flags.map((flag) => flag.title)).toEqual([`${item.key} ist wieder offen.`]);
	});

	it('keeps "Rückgängig" while the flag is paused (pointer or focus on it)', async () => {
		const item = ticket({ status: 'open' });
		const data = fakeData([item]);
		const { flags, store } = withFlags(data);
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		await store.setDone(item.id, true);
		flags.pause('hover');
		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS * 3);
		expect(store.canUndo(item.id)).toBe(true);
		flags.resume('hover');
		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS);
		expect(store.canUndo(item.id)).toBe(false);
		await store.undo(item.id);
		expect(data.update).not.toHaveBeenCalled();
	});

	it('closes the flag when the ticket is open again by another way', async () => {
		const item = ticket({ status: 'open' });
		const { flags, store } = withFlags(fakeData([item]));
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		await store.setDone(item.id, true);
		store.upsert({ ...item, status: 'in_progress', updated: '2026-09-24 11:00:00.000Z' });
		expect(flags.flags).toEqual([]);
		expect(store.canUndo(item.id)).toBe(false);
	});

	it('names the open follow-up when undo is refused (E5 plan, package 4)', async () => {
		const item = ticket({ status: 'open' });
		const data = fakeData([item]);
		vi.mocked(data.update).mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					status: {
						code: 'validation_recurrence_open_instance',
						message:
							'Von dieser Serie ist schon HAUS-12 offen. Erledige es zuerst oder löse ein Ticket aus der Serie.',
						params: { key: 'HAUS-12' }
					}
				}
			})
		);
		const { flags, store } = withFlags(data);
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		await store.setDone(item.id, true);
		await store.undo(item.id);

		const errors = flags.flags.filter((flag) => flag.tone === 'error');
		expect(errors.map((flag) => [flag.tone, flag.title])).toEqual([
			[
				'error',
				`${item.key} konnte nicht zurückgesetzt werden. Von dieser Serie ist schon HAUS-12 offen. Erledige es zuerst oder löse ein Ticket aus der Serie.`
			]
		]);
	});

	it('lets the checked row leave the list at once; the view "Erledigte" shows it (ADR-0066)', async () => {
		const item = ticket();
		const store = new TicketListStore(fakeData([item]), session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		await store.setDone(item.id, true);
		expect(store.open).toEqual([]);
		expect(store.visible).toEqual([]);
		expect(store.canUndo(item.id)).toBe(true);
	});

	it('reopens a done sub-task with the reopen status and says so in a flag', async () => {
		const closed = done({ parentId: 'parent000000001' });
		const data = fakeData([], [closed]);
		const { flags, store } = withFlags(data);
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		store.upsert(closed);

		await store.setDone(closed.id, false);

		expect(data.setDone).toHaveBeenCalledWith(closed.id, false);
		expect(store.open.map((entry) => entry.status)).toEqual(['open']);
		expect(store.canUndo(closed.id)).toBe(false);
		expect(flags.flags.map((flag) => [flag.title, flag.action])).toEqual([
			[`${closed.key} wieder offen.`, null]
		]);
	});

	it('offers to reopen an older instance as a normal ticket when the series refuses (ADR-0023 addendum 4)', async () => {
		const closed = done({ parentId: 'parent000000001' });
		const data = fakeData([], [closed]);
		const message =
			'Von dieser Serie ist schon HAUS-14 offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).';
		vi.mocked(data.setDone).mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					status: {
						code: 'validation_recurrence_reopen_older',
						message,
						params: { key: 'HAUS-14' }
					}
				}
			})
		);
		const { flags, store } = withFlags(data);
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		store.upsert(closed);

		await store.setDone(closed.id, false);
		const [refusal] = flags.flags;
		expect(refusal).toMatchObject({
			tone: 'error',
			title: `${closed.key} konnte nicht geändert werden. ${message}`
		});
		expect(refusal?.action?.label).toBe('Als normales Ticket wieder öffnen (aus der Serie lösen)');

		refusal?.action?.run();
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(closed.id, { status: 'open', detachSeries: true })
		);
		await vi.waitFor(() =>
			expect(flags.flags.map((flag) => flag.title)).toContain(
				`${closed.key} ist wieder offen, als normales Ticket.`
			)
		);
	});

	it('springs back with an error flag when the request fails', async () => {
		const item = ticket();
		const data = fakeData([item]);
		data.setDone.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		const { flags, store } = withFlags(data);
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		await store.setDone(item.id, true);

		expect(store.isChecked(item)).toBe(false);
		expect(store.isPending(item.id)).toBe(false);
		expect(flags.flags[0]?.tone).toBe('error');
		expect(flags.flags[0]?.title).toMatch(
			new RegExp(`^${item.key} konnte nicht geändert werden\\.`)
		);
		expect(store.open[0]?.status).toBe('open');
		// Errors stay until they are closed.
		await vi.advanceTimersByTimeAsync(FLAG_DURATION_MS * 2);
		expect(flags.flags).toHaveLength(1);
	});
});

describe('reset', () => {
	it('empties everything and aborts running requests and timers', async () => {
		const item = ticket();
		const data = fakeData([item, ticket()]);
		const flags = new FlagStore();
		const store = new TicketListStore(data, session(), { flags });
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		await store.setDone(item.id, true);
		const pending = deferred<TicketSummary[]>();
		data.listOpen.mockImplementationOnce((options) => abortable(options, pending.promise));
		void store.reload();

		store.reset();

		expect(data.listOpen.mock.lastCall?.[0].signal?.aborted).toBe(true);
		expect(store.open).toEqual([]);
		expect(store.canUndo(item.id)).toBe(false);
		expect(flags.flags).toEqual([]);
		expect(store.openState).toBe('idle');
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('announce', () => {
	it('shows a success flag, e.g. after a deletion in the panel', async () => {
		const item = ticket();
		const flags = new FlagStore();
		const store = new TicketListStore(fakeData([item]), session(), { flags });
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		store.remove(item.id);
		store.announce('TASK-1 wurde gelöscht.');

		expect(store.open).toEqual([]);
		expect(flags.flags.map((flag) => [flag.tone, flag.title])).toEqual([
			['success', 'TASK-1 wurde gelöscht.']
		]);
		// The live region of the list keeps the number of tickets only.
		expect(store.announcement).toBe('');
	});
});

describe('grouping (E3 plan, package 13)', () => {
	const grouped = (grouping: ListQuery['grouping'], extra: Partial<ListQuery> = {}): ListQuery => ({
		...EMPTY_LIST_QUERY,
		grouping,
		...extra
	});
	const shape = (store: TicketListStore) =>
		store.groups?.map((group) => [group.key, group.tickets.map((entry) => entry.id)]) ?? null;

	it('has no groups without a grouping', async () => {
		const store = new TicketListStore(fakeData([ticket()]), session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		expect(store.groups).toBeNull();
	});

	it('groups the visible rows in the order of the domain, keeping filter and sort', async () => {
		const low = ticket({ priority: 'low', title: 'B' });
		const urgent = ticket({ priority: 'urgent', title: 'C' });
		const lowToo = ticket({ priority: 'low', title: 'A' });
		const hidden = ticket({ priority: 'urgent', status: 'waiting' });
		const store = new TicketListStore(fakeData([low, urgent, lowToo, hidden]), session());
		store.activate(
			grouped('priority', { status: 'open', sort: { key: 'title', reversed: false } })
		);
		await settle();

		expect(shape(store)).toEqual([
			['urgent', [urgent.id]],
			['low', [lowToo.id, low.id]]
		]);
		expect(store.groups?.map((group) => group.label)).toEqual(['Dringend', 'Niedrig']);
	});

	it('removes a just checked row from its group at once (UI-5)', async () => {
		const waiting = ticket({ status: 'waiting' });
		const open = ticket();
		const store = new TicketListStore(fakeData([waiting, open]), session());
		store.activate(grouped('status'));
		await settle();

		await store.setDone(waiting.id, true);
		expect(shape(store)).toEqual([['open', [open.id]]]);
	});

	it('moves a ticket into its new group after a realtime update', async () => {
		const item = ticket();
		const store = new TicketListStore(fakeData([item]), session());
		store.activate(grouped('status'));
		await settle();

		store.upsert({ ...item, status: 'in_progress', updated: '2026-09-24 11:00:00.000Z' });

		expect(shape(store)).toEqual([['in_progress', [item.id]]]);
	});
});

describe('search (E3 plan, package 11)', () => {
	const searching = (search: string | null, extra: Partial<ListQuery> = {}): ListQuery => ({
		...EMPTY_LIST_QUERY,
		search,
		...extra
	});
	const visibleIds = (store: TicketListStore) => store.visible.map((entry) => entry.id);

	/** Realtime source with ticket events only. */
	function fakeLive() {
		const listeners: ((change: RecordChange<TicketSummary>) => void)[] = [];
		const never = async (): Promise<Unsubscribe> => async () => undefined;
		const source: LiveSource = {
			tickets: async (call) => {
				listeners.push(call);
				return async () => undefined;
			},
			ticket: never,
			comments: never,
			history: never,
			projects: never,
			tags: never,
			inbox: never,
			reads: never,
			reconnected: never
		};
		return {
			source,
			send: (change: RecordChange<TicketSummary>) => {
				for (const listener of listeners) listener(change);
			}
		};
	}

	async function started(open: TicketSummary[], ids: string[] = []) {
		const data = fakeData(open);
		data.searchOpen.mockImplementation((_search, options) =>
			abortable(options, Promise.resolve(ids))
		);
		const store = new TicketListStore(data, session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		return { store, data };
	}

	it('asks once after the pause while typing and narrows the list to the found IDs', async () => {
		const hit = ticket({ title: 'Miete zahlen' });
		const other = ticket();
		const { store, data } = await started([hit, other], [hit.id]);

		store.activate(searching('Mi'));
		store.activate(searching('Mie'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
		store.activate(searching('Miete'));
		expect(store.searchBusy).toBe(true);
		expect(visibleIds(store)).toEqual([hit.id, other.id]);
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

		expect(data.searchOpen).toHaveBeenCalledOnce();
		expect(data.searchOpen.mock.calls[0]?.[0]).toBe('Miete');
		expect(store.search).toBe('Miete');
		expect(visibleIds(store)).toEqual([hit.id]);
		expect(store.searchBusy).toBe(false);
		expect(store.announcement).toBe('1 Ticket.');
	});

	it('ignores a search shorter than two characters and clears the search at once', async () => {
		const hit = ticket();
		const other = ticket();
		const { store, data } = await started([hit, other], [hit.id]);

		store.activate(searching('M'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.searchOpen).not.toHaveBeenCalled();
		expect(store.search).toBeNull();

		store.activate(searching('Mi'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(visibleIds(store)).toEqual([hit.id]);

		store.activate(searching(null));
		expect(store.search).toBeNull();
		expect(visibleIds(store)).toEqual([hit.id, other.id]);
		expect(store.announcement).toBe('2 Tickets.');
	});

	it('applies a search from the URL of a fresh page at once', async () => {
		const hit = ticket();
		const data = fakeData([hit, ticket()]);
		data.searchOpen.mockResolvedValue([hit.id]);
		const store = new TicketListStore(data, session());

		store.activate(searching('Miete'));
		await settle();

		expect(data.searchOpen).toHaveBeenCalledOnce();
		expect(visibleIds(store)).toEqual([hit.id]);
	});

	it('aborts a stale request and drops its answer', async () => {
		const first = ticket();
		const second = ticket();
		const { store, data } = await started([first, second]);
		const signals: AbortSignal[] = [];
		const answers = [deferred<string[]>(), deferred<string[]>()];
		data.searchOpen.mockImplementation((_search, options) => {
			if (options.signal) signals.push(options.signal);
			return abortable(options, answers[signals.length - 1]!.promise);
		});

		store.activate(searching('Mi'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		store.activate(searching('Miete'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(signals[0]?.aborted).toBe(true);

		answers[0]!.resolve([first.id]);
		answers[1]!.resolve([second.id]);
		await settle();
		expect(visibleIds(store)).toEqual([second.id]);
	});

	it('keeps the old rows while a newer search loads (no flicker)', async () => {
		const first = ticket();
		const second = ticket();
		const { store, data } = await started([first, second], [first.id]);
		store.activate(searching('Mi'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		const answer = deferred<string[]>();
		data.searchOpen.mockImplementation((_search, options) => abortable(options, answer.promise));

		store.activate(searching('Miete'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(store.searchBusy).toBe(true);
		expect(visibleIds(store)).toEqual([first.id]);

		answer.resolve([second.id]);
		await settle();
		expect(visibleIds(store)).toEqual([second.id]);
	});

	it('asks again after create and update events, but not after a delete', async () => {
		const hit = ticket();
		const { store, data } = await started([hit], [hit.id]);
		const live = fakeLive();
		const stop = store.connect(live.source);
		await settle();
		store.activate(searching('Miete'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.searchOpen).toHaveBeenCalledOnce();

		const created = ticket({ title: 'Miete Garage' });
		data.searchOpen.mockImplementation((_search, options) =>
			abortable(options, Promise.resolve([hit.id, created.id]))
		);
		live.send({ action: 'create', record: created });
		live.send({ action: 'update', record: { ...hit, updated: '2026-09-24 11:00:00.000Z' } });
		expect(visibleIds(store)).toEqual([hit.id]);
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.searchOpen).toHaveBeenCalledTimes(2);
		expect(visibleIds(store).sort()).toEqual([hit.id, created.id].sort());

		live.send({ action: 'delete', id: created.id });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.searchOpen).toHaveBeenCalledTimes(2);
		expect(visibleIds(store)).toEqual([hit.id]);
		stop();
	});

	it('asks once for 50 tickets created in a row by "Gesammelt umwandeln" (E4 plan, package 3)', async () => {
		const hit = ticket();
		const { store, data } = await started([hit], [hit.id]);
		const live = fakeLive();
		const stop = store.connect(live.source);
		await settle();
		store.activate(searching('Miete'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.searchOpen).toHaveBeenCalledOnce();

		for (let index = 0; index < 50; index += 1) {
			const id = `bulk${String(index).padStart(11, '0')}`;
			live.send({ action: 'create', record: ticket({ id, title: `Eintrag ${index}` }) });
			await vi.advanceTimersByTimeAsync(10);
		}
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.searchOpen).toHaveBeenCalledTimes(2);
		stop();
	});

	it('removes a just checked row from the search result at once (UI-5)', async () => {
		const hit = ticket();
		const other = ticket();
		const { store, data } = await started([hit, other], [hit.id, other.id]);
		const live = fakeLive();
		const stop = store.connect(live.source);
		store.activate(searching('Miete'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(visibleIds(store)).toEqual([hit.id, other.id]);

		await store.setDone(hit.id, true);
		expect(visibleIds(store)).toEqual([other.id]);
		data.searchOpen.mockImplementation((_search, options) =>
			abortable(options, Promise.resolve([other.id]))
		);
		live.send({
			action: 'update',
			record: { ...hit, status: 'done', updated: '2026-09-24 11:00:00.000Z' }
		});
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

		expect(visibleIds(store)).toEqual([other.id]);
		stop();
	});

	it('shows the list without search on a failure and asks again on "Erneut versuchen"', async () => {
		const hit = ticket();
		const other = ticket();
		const { store, data } = await started([hit, other], [hit.id]);
		data.searchOpen.mockRejectedValueOnce(new DataError('network'));

		store.activate(searching('Miete'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(store.searchError).toMatch(/Server nicht erreichbar/);
		expect(visibleIds(store)).toEqual([hit.id, other.id]);

		store.retrySearch();
		await settle();
		expect(store.searchError).toBeNull();
		expect(visibleIds(store)).toEqual([hit.id]);
	});

	it('forgets the search on reset', async () => {
		const hit = ticket();
		const { store } = await started([hit], [hit.id]);
		store.activate(searching('Miete'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

		store.reset();

		expect(store.search).toBeNull();
		expect(store.searchBusy).toBe(false);
		expect(store.searchError).toBeNull();
	});
});

describe('sub-tasks (ADR-0033)', () => {
	const PARENT_ID = 'parent000000001';

	function family() {
		const parent = ticket({
			id: PARENT_ID,
			projectId: 'proj00000000001',
			tagIds: ['tag000000000001']
		});
		const later = ticket({ parentId: PARENT_ID, created: '2026-09-03 10:00:00.000Z' });
		const doneOne = done({ parentId: PARENT_ID, created: '2026-09-01 10:00:00.000Z' });
		const earlier = ticket({ parentId: PARENT_ID, created: '2026-09-02 10:00:00.000Z' });
		const foreign = ticket({ parentId: 'other0000000001' });
		return { parent, later, doneOne, earlier, foreign };
	}

	async function loaded() {
		const f = family();
		const data = {
			...fakeData([f.parent, f.later, f.earlier, f.foreign]),
			listSubtasks: vi.fn(async () => [f.later, f.doneOne, f.earlier, f.foreign]),
			create: vi.fn(async (draft: TicketDraft): Promise<TicketSummary> =>
				ticket({
					title: draft.title,
					projectId: draft.project,
					tagIds: draft.tags,
					parentId: draft.parent ?? null,
					created: '2026-09-24 10:00:00.000Z'
				})
			)
		} satisfies TicketListData;
		const guard = session();
		const store = new TicketListStore(data, guard);
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		return { ...f, data, store, guard };
	}

	const idsOf = (list: readonly TicketSummary[]) => list.map((entry) => entry.id);

	it('loads every sub-task with the open tickets and lists them per parent, open ones first', async () => {
		const { store, data, parent, later, doneOne, earlier } = await loaded();

		expect(data.listSubtasks).toHaveBeenCalledOnce();
		expect(idsOf(store.subtasksOf(PARENT_ID))).toEqual([earlier.id, later.id, doneOne.id]);
		expect(store.progressOf(PARENT_ID)).toEqual({ done: 1, total: 3 });
		expect(store.progressOf(later.id)).toEqual({ done: 0, total: 0 });
		expect(store.subtasksOf(parent.id)).toHaveLength(3);
		// The done one is known for the section, but the list does not show it.
		expect(store.find(doneOne.id)).toEqual(doneOne);
		expect(idsOf(store.open)).not.toContain(doneOne.id);
		expect(store.openCount).toBe(4);
	});

	it('follows answers and events: moving, releasing and deleting a sub-task', async () => {
		const { store, later, earlier, foreign } = await loaded();

		store.upsert({ ...later, parentId: foreign.parentId, updated: '2026-09-24 10:00:00.000Z' });
		expect(store.progressOf(PARENT_ID)).toEqual({ done: 1, total: 2 });
		expect(idsOf(store.subtasksOf('other0000000001'))).toContain(later.id);

		store.upsert({ ...earlier, parentId: null, updated: '2026-09-24 10:00:00.000Z' });
		expect(store.progressOf(PARENT_ID)).toEqual({ done: 1, total: 1 });
		expect(store.find(earlier.id)?.parentId).toBeNull();

		store.remove(foreign.id);
		expect(idsOf(store.subtasksOf('other0000000001'))).toEqual([later.id]);
	});

	it('ignores an older version of a sub-task', async () => {
		const { store, earlier } = await loaded();
		store.upsert({ ...earlier, title: 'Neu', updated: '2026-09-24 10:00:00.000Z' });

		store.upsert({ ...earlier, title: 'Alt', parentId: null });

		expect(store.subtasksOf(PARENT_ID).find((entry) => entry.id === earlier.id)?.title).toBe('Neu');
	});

	it('reconciles the sub-tasks after a reconnection', async () => {
		const { store, data, later, doneOne } = await loaded();
		const renamed = { ...later, title: 'Umbenannt', updated: '2026-09-24 10:00:00.000Z' };
		data.listSubtasks.mockResolvedValueOnce([renamed, doneOne]);

		await store.reconcile();

		expect(idsOf(store.subtasksOf(PARENT_ID))).toEqual([later.id, doneOne.id]);
		expect(store.subtasksOf(PARENT_ID)[0]?.title).toBe('Umbenannt');
	});

	it('reopens a done sub-task the list does not show and offers "Rückgängig" when checking one', async () => {
		const { store, data, doneOne, earlier } = await loaded();
		data.setDone.mockImplementation(async (id: string, isDone: boolean) => ({
			...(id === doneOne.id ? doneOne : earlier),
			status: isDone ? 'done' : 'open',
			completedAt: isDone ? '2026-09-24 10:00:00.000Z' : null,
			updated: '2026-09-24 10:00:00.000Z'
		}));

		await store.setDone(doneOne.id, false);
		expect(store.progressOf(PARENT_ID)).toEqual({ done: 0, total: 3 });
		expect(idsOf(store.open)).toContain(doneOne.id);

		await store.setDone(earlier.id, true);
		expect(store.progressOf(PARENT_ID)).toEqual({ done: 1, total: 3 });
		expect(store.canUndo(earlier.id)).toBe(true);
	});

	it('adds a sub-task in the project and with the tags of the parent', async () => {
		const { store, data, parent } = await loaded();

		const result = await store.addSubtask(parent, '  Kartons packen  ');

		expect(data.create).toHaveBeenCalledWith({
			title: 'Kartons packen',
			description: '',
			status: 'open',
			priority: 'medium',
			due: null,
			project: 'proj00000000001',
			tags: ['tag000000000001'],
			parent: PARENT_ID
		});
		expect(result.ok).toBe(true);
		const created = result.ok ? result.ticket : null;
		expect(store.subtasksOf(PARENT_ID).map((entry) => entry.title)).toContain('Kartons packen');
		expect(idsOf(store.open)).toContain(created?.id);
	});

	it('creates a sub-task in the area of its parent, whatever area the tab shows (E7-3)', async () => {
		const { store, data, parent } = await loaded();

		await store.addSubtask({ ...parent, scope: 'h:house0000000001' }, 'Im Haushalt');
		expect(data.create).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: 'Im Haushalt', parent: PARENT_ID }),
			'house0000000001'
		);
		await store.addSubtask({ ...parent, scope: 'u:user00000000001' }, 'Privat');
		expect(data.create).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: 'Privat', parent: PARENT_ID }),
			''
		);
	});

	it('keeps the sub project of the parent for a sub-task, not its parent project (ADR-0034)', async () => {
		const { store, data, parent } = await loaded();
		const inGarden = { ...parent, projectId: 'proj00000000011' };

		await store.addSubtask(inGarden, 'Beet umgraben');

		expect(data.create).toHaveBeenLastCalledWith(
			expect.objectContaining({ project: 'proj00000000011', parent: PARENT_ID })
		);
	});

	it('gives back the message of the refused field; an empty title sends nothing', async () => {
		const { store, data, parent, guard } = await loaded();
		data.create.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' }
				}
			})
		);

		expect(await store.addSubtask(parent, 'Kartons')).toEqual({
			ok: false,
			message: 'Das Projekt ist archiviert.'
		});
		expect(await store.addSubtask(parent, '   ')).toEqual({ ok: false, message: null });
		expect(data.create).toHaveBeenCalledOnce();

		data.create.mockRejectedValueOnce(new DataError('session'));
		expect(await store.addSubtask(parent, 'Kartons')).toEqual({ ok: false, message: null });
		expect(guard.logout).toHaveBeenCalled();
	});

	it('forgets the sub-tasks on reset', async () => {
		const { store } = await loaded();

		store.reset();

		expect(store.subtasksOf(PARENT_ID)).toEqual([]);
	});
});

describe('completing a ticket with open blocking sub-tasks (ADR-0033 section 2)', () => {
	const PARENT_ID = 'parent000000001';
	const openChildrenError = (count: number, keys: string[]) =>
		new DataError('validation', {
			status: 400,
			fields: {
				status: {
					code: 'validation_parent_open_children',
					message: 'Offene Unteraufgaben blockieren das Erledigen.',
					params: { count, keys }
				}
			}
		});

	async function started(subtasks: TicketSummary[]) {
		const parent = ticket({ id: PARENT_ID, key: 'HAUS-12', status: 'in_progress' });
		const all = [parent, ...subtasks];
		let clock = 0;
		const data = {
			...fakeData(all.filter((entry) => entry.status !== 'done')),
			listSubtasks: vi.fn(async () => subtasks),
			setDone: vi.fn(async (id: string, isDone: boolean): Promise<TicketSummary> => {
				clock += 1;
				const current = all.find((entry) => entry.id === id) ?? parent;
				return {
					...current,
					status: isDone ? 'done' : 'open',
					completedAt: isDone ? '2026-09-24 10:00:00.000Z' : null,
					updated: `2026-09-24 10:00:0${clock}.000Z`
				};
			}),
			update: vi.fn(async (id: string, patch: TicketPatch): Promise<TicketSummary> => {
				clock += 1;
				const current = all.find((entry) => entry.id === id) ?? parent;
				return {
					...current,
					...patch,
					updated: `2026-09-24 10:00:0${clock}.000Z`
				} as TicketSummary;
			})
		} satisfies TicketListData;
		const flags = new FlagStore();
		const store = new TicketListStore(data, session(), { flags });
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		return { store, data, flags, parent };
	}

	it('asks before sending when blocking sub-tasks are open, and not for others', async () => {
		const blocking = ticket({ parentId: PARENT_ID, key: 'HAUS-13' });
		const loose = ticket({ parentId: PARENT_ID, key: 'HAUS-14', blocksParent: false });
		const closed = done({ parentId: PARENT_ID, key: 'HAUS-15' });
		const { store, data } = await started([blocking, loose, closed]);

		await store.setDone(PARENT_ID, true);

		expect(data.setDone).not.toHaveBeenCalled();
		expect(store.completion).toEqual({
			id: PARENT_ID,
			key: 'HAUS-12',
			count: 1,
			keys: ['HAUS-13'],
			previousStatus: 'in_progress'
		});
		expect(store.isChecked(store.find(PARENT_ID) as TicketSummary)).toBe(false);

		store.cancelCompletion();
		expect(store.completion).toBeNull();
		expect(data.setDone).not.toHaveBeenCalled();
	});

	it('completes the sub-tasks along and restores all of them with "Rückgängig"', async () => {
		const first = ticket({ parentId: PARENT_ID, key: 'HAUS-13', status: 'waiting' });
		const second = ticket({ parentId: PARENT_ID, key: 'HAUS-14' });
		const { store, data, flags } = await started([first, second]);
		await store.setDone(PARENT_ID, true);

		await store.confirmCompletion('complete_children');

		expect(data.setDone).toHaveBeenCalledWith(PARENT_ID, true, 'complete_children');
		expect(store.completion).toBeNull();
		expect(flags.flags.map((flag) => [flag.title, flag.action?.label])).toEqual([
			['HAUS-12 und 2 Unteraufgaben erledigt.', 'Rückgängig']
		]);

		flags.act(flags.flags[0]?.id ?? '');
		await settle();

		expect(data.update.mock.calls).toEqual([
			[PARENT_ID, { status: 'in_progress' }],
			[first.id, { status: 'waiting' }],
			[second.id, { status: 'open' }]
		]);
		expect(flags.flags.map((flag) => flag.title)).toEqual([
			'HAUS-12 und 2 Unteraufgaben sind wieder offen.'
		]);
	});

	it('completes it anyway with "Trotzdem erledigen"; "Rückgängig" reopens only the ticket', async () => {
		const child = ticket({ parentId: PARENT_ID, key: 'HAUS-13' });
		const { store, data, flags } = await started([child]);
		await store.setDone(PARENT_ID, true);

		await store.confirmCompletion('force');

		expect(data.setDone).toHaveBeenCalledWith(PARENT_ID, true, 'force');
		expect(flags.flags.map((flag) => flag.title)).toEqual(['HAUS-12 erledigt.']);
		flags.act(flags.flags[0]?.id ?? '');
		await settle();
		expect(data.update.mock.calls).toEqual([[PARENT_ID, { status: 'in_progress' }]]);
	});

	it('asks when the hook refuses a completion the list did not expect', async () => {
		const { store, data } = await started([]);
		data.setDone.mockRejectedValueOnce(openChildrenError(2, ['HAUS-20', 'HAUS-21']));

		await store.setDone(PARENT_ID, true);

		expect(store.completion).toMatchObject({ count: 2, keys: ['HAUS-20', 'HAUS-21'] });
		expect(store.isPending(PARENT_ID)).toBe(false);
	});

	it('keeps a failure in the question and names the restore that failed', async () => {
		const child = ticket({ parentId: PARENT_ID, key: 'HAUS-13' });
		const { store, data, flags } = await started([child]);
		await store.setDone(PARENT_ID, true);
		data.setDone.mockRejectedValueOnce(new DataError('network'));

		await store.confirmCompletion('complete_children');
		expect(store.completion).not.toBeNull();
		expect(store.completionError).toMatch(/Server nicht erreichbar/);

		await store.confirmCompletion('complete_children');
		expect(store.completion).toBeNull();
		data.update.mockImplementationOnce(async () =>
			ticket({ id: PARENT_ID, key: 'HAUS-12', updated: '2026-09-24 11:00:00.000Z' })
		);
		data.update.mockRejectedValueOnce(new DataError('network'));
		flags.act(flags.flags[0]?.id ?? '');
		await settle();

		expect(flags.flags.map((flag) => [flag.tone, flag.title])).toEqual([
			['error', 'HAUS-13 konnte nicht zurückgesetzt werden.'],
			['success', 'HAUS-12 ist wieder offen.']
		]);
	});
});

describe('editing a cell in place (plan BI-3)', () => {
	async function started(items: TicketSummary[]) {
		const data = fakeData(items);
		const flags = new FlagStore();
		const store = new TicketListStore(data, session(), { flags });
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		return { data, flags, store };
	}

	it('saves the field through the Record API, locks meanwhile and shows the answer', async () => {
		const item = ticket({ priority: 'low' });
		const { data, store } = await started([item]);
		const answer = deferred<TicketSummary>();
		data.update.mockImplementationOnce(() => answer.promise);

		const request = store.changeField(item.id, { priority: 'high' });
		expect(store.isPending(item.id)).toBe(true);
		expect(await store.changeField(item.id, { priority: 'urgent' })).toBe(false);
		answer.resolve({ ...item, priority: 'high', updated: '2026-09-24 10:00:02.000Z' });

		expect(await request).toBe(true);
		expect(data.update).toHaveBeenCalledExactlyOnceWith(item.id, { priority: 'high' });
		expect(store.find(item.id)?.priority).toBe('high');
		expect(store.isPending(item.id)).toBe(false);
	});

	it('completes like the check mark, with "Rückgängig" in the flag', async () => {
		const item = ticket({ status: 'waiting' });
		const { data, flags, store } = await started([item]);

		expect(await store.changeField(item.id, { status: 'done' })).toBe(true);

		expect(data.setDone).toHaveBeenCalledWith(item.id, true);
		expect(data.update).not.toHaveBeenCalled();
		expect(flags.flags[0]?.action?.label).toBe('Rückgängig');
	});

	it('names a refusal with its reason in an error flag and keeps the value', async () => {
		const item = ticket({ priority: 'low' });
		const { data, flags, store } = await started([item]);
		data.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: { due: { code: 'validation_calendar_date', message: 'Ungültiges Datum.' } }
			})
		);

		expect(await store.changeField(item.id, { due: '2026-02-30' })).toBe(false);

		expect(flags.flags.map((flag) => [flag.tone, flag.title])).toEqual([
			['error', `${item.key} konnte nicht geändert werden. Ungültiges Datum.`]
		]);
		expect(store.find(item.id)?.due).toBeNull();
	});

	it('does nothing for an unknown ticket or without a session', async () => {
		const item = ticket();
		const { data, store } = await started([item]);
		expect(await store.changeField('unknown00000000', { priority: 'high' })).toBe(false);
		const ended = new TicketListStore(data, session(false));
		expect(await ended.changeField(item.id, { priority: 'high' })).toBe(false);
		expect(data.update).not.toHaveBeenCalled();
	});
});
