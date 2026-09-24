// Ticket list store with a fake data layer (E2 plan, package 5): order, moving between open and
// done, stale answers and requests, midnight, check mark with undo, reset.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DoneFilter, DoneTicketPage } from '$lib/data/tickets';
import type { RequestOptions } from '$lib/data/options';
import { EMPTY_LIST_QUERY, NO_PROJECT, type ListQuery } from '$lib/domain/list-query';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import type { LiveSource, RecordChange, Unsubscribe } from './realtime';
import {
	SEARCH_DEBOUNCE_MS,
	TicketListStore,
	UNDO_WINDOW_MS,
	type TicketListData
} from './ticket-list.svelte';

// 2026-09-24 12:00 in Berlin (CEST).
const NOON = Date.UTC(2026, 8, 24, 10, 0, 0);

/** List state with only the switch "Erledigte anzeigen" set. */
const withDone = (showDone: boolean) => ({ ...EMPTY_LIST_QUERY, showDone });

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

function fakeData(open: TicketSummary[] = [], donePages: TicketSummary[][] = []) {
	const data = {
		listOpen: vi.fn((options: RequestOptions) => abortable(options, Promise.resolve(open))),
		listDone: vi.fn((page: number, options: RequestOptions & { filter?: DoneFilter }) =>
			abortable<DoneTicketPage>(
				options,
				Promise.resolve({
					items: donePages[page - 1] ?? [],
					page,
					hasMore: page < donePages.length
				})
			)
		),
		searchOpen: vi.fn<TicketListData['searchOpen']>(async () => []),
		setDone: vi.fn(async (id: string, isDone: boolean): Promise<TicketSummary> => {
			const current = [...open, ...donePages.flat()].find((entry) => entry.id === id);
			if (!current) throw new DataError('not_found');
			return {
				...current,
				status: isDone ? 'done' : 'open',
				completedAt: isDone ? '2026-09-24 10:00:00.000Z' : null,
				updated: '2026-09-24 10:00:00.000Z'
			};
		}),
		update: vi.fn(async (id: string, patch: TicketPatch): Promise<TicketSummary> => {
			const current = [...open, ...donePages.flat()].find((entry) => entry.id === id);
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

describe('loading and order', () => {
	it('loads only the open tickets and sorts them in the default order', async () => {
		const later = ticket({ priority: 'urgent' });
		const overdue = ticket({ due: '2026-09-20', priority: 'low' });
		const soon = ticket({ due: '2026-09-26' });
		const data = fakeData([later, soon, overdue]);
		const store = new TicketListStore(data, session());

		store.activate(withDone(false));
		expect(store.openState).toBe('loading');
		await settle();

		expect(store.openState).toBe('ready');
		expect(store.open.map((entry) => entry.id)).toEqual([overdue.id, soon.id, later.id]);
		expect(data.listDone).not.toHaveBeenCalled();
		expect(store.done).toEqual([]);
	});

	it('loads done tickets page by page when the switch is on', async () => {
		const first = done({ completedAt: '2026-09-22 10:00:00.000Z' });
		const second = done({ completedAt: '2026-09-21 10:00:00.000Z' });
		const third = done({ completedAt: '2026-09-20 10:00:00.000Z' });
		const data = fakeData([], [[first, second], [third]]);
		const store = new TicketListStore(data, session());

		store.activate(withDone(true));
		await settle();
		expect(store.done.map((entry) => entry.id)).toEqual([first.id, second.id]);
		expect(store.doneHasMore).toBe(true);

		await store.loadMoreDone();
		expect(data.listDone).toHaveBeenLastCalledWith(2, expect.anything());
		expect(store.done.map((entry) => entry.id)).toEqual([first.id, second.id, third.id]);
		expect(store.doneHasMore).toBe(false);
	});

	it('drops the done tickets when the switch goes off and aborts a stale request', async () => {
		const data = fakeData([], [[done()]]);
		const pending = deferred<DoneTicketPage>();
		data.listDone.mockImplementationOnce((_page, options) => abortable(options, pending.promise));
		const store = new TicketListStore(data, session());

		store.activate(withDone(true));
		store.activate(withDone(false));
		store.activate(withDone(true));
		await settle();

		const firstSignal = data.listDone.mock.calls[0]?.[1].signal;
		expect(firstSignal?.aborted).toBe(true);
		expect(data.listDone).toHaveBeenCalledTimes(2);
		expect(store.doneState).toBe('ready');
		expect(store.done).toHaveLength(1);

		pending.resolve({ items: [done(), done()], page: 1, hasMore: false });
		await settle();
		expect(store.done).toHaveLength(1);
	});

	it('shows a load error, but not an aborted request, and retries', async () => {
		const data = fakeData([ticket()]);
		data.listOpen.mockRejectedValueOnce(new DataError('network'));
		const store = new TicketListStore(data, session());

		store.activate(withDone(false));
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

		store.activate(withDone(false));
		await settle();
		expect(guard.logout).toHaveBeenCalledOnce();
		expect(store.openError).toBeNull();

		const invalid = fakeData();
		new TicketListStore(invalid, session(false)).activate(withDone(true));
		expect(invalid.listOpen).not.toHaveBeenCalled();
		expect(invalid.listDone).not.toHaveBeenCalled();
	});

	it('loads the open tickets once for the project view without a list state (package 14)', async () => {
		const item = ticket();
		const data = fakeData([item]);
		const store = new TicketListStore(data, session());

		store.loadOpen();
		store.loadOpen();
		await settle();

		expect(data.listOpen).toHaveBeenCalledOnce();
		expect(data.listDone).not.toHaveBeenCalled();
		expect(store.open).toEqual([item]);
		store.loadOpen();
		store.activate(withDone(false));
		await settle();
		expect(data.listOpen).toHaveBeenCalledOnce();
		expect(store.announcement).toBe('');
	});
});

describe('upsert and remove', () => {
	it('moves a ticket between open and done and ignores an older update', async () => {
		const item = ticket();
		const store = new TicketListStore(fakeData([item]), session());
		store.activate(withDone(true));
		await settle();

		const closed = { ...item, status: 'done' as const, updated: '2026-09-24 09:00:00.000Z' };
		store.upsert(closed);
		expect(store.open).toEqual([]);
		expect(store.done).toEqual([closed]);

		store.upsert({ ...item, title: 'veraltet' });
		expect(store.done).toEqual([closed]);

		const reopened = { ...closed, status: 'open' as const, updated: '2026-09-24 09:30:00.000Z' };
		store.upsert(reopened);
		expect(store.open).toEqual([reopened]);
		expect(store.done).toEqual([]);

		store.remove(item.id);
		expect(store.open).toEqual([]);
		expect(store.find(item.id)).toBeNull();
	});

	it('keeps done tickets out of the list while the switch is off', async () => {
		const store = new TicketListStore(fakeData(), session());
		store.activate(withDone(false));
		await settle();

		store.upsert(done());
		expect(store.open).toEqual([]);
		expect(store.done).toEqual([]);
	});

	it('resorts after an update', async () => {
		const first = ticket({ priority: 'high' });
		const second = ticket({ priority: 'low' });
		const store = new TicketListStore(fakeData([first, second]), session());
		store.activate(withDone(false));
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
		store.activate(withDone(false));
		await settle();

		expect(store.visible.map((entry) => entry.id)).toEqual([first.id, second.id]);
		expect(store.openCount).toBe(2);

		await store.setDone(first.id, true);
		// The checked row stays visible for "Rückgängig" but no longer counts.
		expect(store.visible.map((entry) => entry.id)).toContain(first.id);
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

	it('keeps a just checked row in place under a status filter until undo expires', async () => {
		const item = ticket({ status: 'in_progress' });
		const store = new TicketListStore(fakeData([item]), session());
		store.activate(query({ status: 'in_progress' }));
		await settle();

		await store.setDone(item.id, true);
		expect(store.visible.map((entry) => entry.id)).toEqual([item.id]);
		expect(store.visibleCount).toBe(0);

		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		expect(store.visible).toEqual([]);
	});

	it('shows only the section "Erledigt" with the status filter "Erledigt"', async () => {
		const open = ticket();
		const first = done({ completedAt: '2026-09-22 10:00:00.000Z' });
		const data = fakeData([open], [[first]]);
		const store = new TicketListStore(data, session());
		const onlyDone = query({ status: 'done', priority: 'medium' });

		store.activate(onlyDone);
		await settle();

		expect(store.showDone).toBe(true);
		expect(store.visible).toEqual([]);
		expect(store.done.map((entry) => entry.id)).toEqual([first.id]);
		expect(store.visibleCount).toBe(1);
		expect(data.listDone).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ filter: { query: onlyDone, today: '2026-09-24' } })
		);
	});

	it('hides the section "Erledigt" with another status, even with the switch on', async () => {
		const data = fakeData([ticket()], [[done()]]);
		const store = new TicketListStore(data, session());

		store.activate(query({ status: 'open', showDone: true }));
		await settle();

		expect(store.showDone).toBe(false);
		expect(data.listDone).not.toHaveBeenCalled();
	});

	it('loads the done tickets again for other filters and aborts the stale request', async () => {
		const data = fakeData([], [[done({ priority: 'low' })]]);
		const store = new TicketListStore(data, session());
		store.activate(query({ showDone: true }));
		await settle();
		const pending = deferred<DoneTicketPage>();
		data.listDone.mockImplementationOnce((_page, options) => abortable(options, pending.promise));

		store.activate(query({ showDone: true, priority: 'high' }));
		store.activate(query({ showDone: true, priority: 'low' }));
		await settle();

		expect(data.listDone).toHaveBeenCalledTimes(3);
		expect(data.listDone.mock.calls[1]?.[1].signal?.aborted).toBe(true);
		expect(data.listDone.mock.calls[2]?.[1].filter?.query.priority).toBe('low');
		expect(store.done).toHaveLength(1);

		// Same filters, other view: nothing is loaded again.
		store.activate(query({ showDone: true, priority: 'low', grouping: 'project' }));
		expect(data.listDone).toHaveBeenCalledTimes(3);
	});

	it('keeps done tickets that do not pass the filters out of the section', async () => {
		const shown = done({ priority: 'high', completedAt: '2026-09-22 10:00:00.000Z' });
		const store = new TicketListStore(fakeData([], [[shown]]), session());
		store.activate(query({ showDone: true, priority: 'high' }));
		await settle();

		store.upsert(done({ priority: 'low', completedAt: '2026-09-23 10:00:00.000Z' }));
		expect(store.done.map((entry) => entry.id)).toEqual([shown.id]);

		store.upsert({ ...shown, priority: 'low', updated: '2026-09-24 10:00:00.000Z' });
		expect(store.done).toEqual([]);
	});

	it('announces the number of done tickets once they are loaded', async () => {
		const data = fakeData([ticket()], [[done(), done()], [done()]]);
		const store = new TicketListStore(data, session());
		store.activate(EMPTY_LIST_QUERY);
		await settle();

		store.activate(query({ status: 'done' }));
		expect(store.announcement).toBe('');
		await settle();
		expect(store.announcement).toBe('Mehr als 2 Tickets.');
		expect(store.visibleCountMore).toBe(true);
	});

	it('loads the done tickets again at midnight while a due filter is set', async () => {
		// 2026-09-24 23:59 in Berlin.
		vi.setSystemTime(Date.UTC(2026, 8, 24, 21, 59, 0));
		const data = fakeData([], [[done({ due: '2026-09-25' })]]);
		const store = new TicketListStore(data, session());
		const stop = store.start();
		store.activate(query({ showDone: true, due: 'today' }));
		await settle();
		expect(data.listDone).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(61_000);
		expect(data.listDone).toHaveBeenCalledTimes(2);
		expect(data.listDone.mock.calls[1]?.[1].filter?.today).toBe('2026-09-25');
		stop();
	});

	it('reconciles the done tickets with the current filters', async () => {
		const data = fakeData([], [[done({ priority: 'high' })]]);
		const store = new TicketListStore(data, session());
		const filters = query({ showDone: true, priority: 'high' });
		store.activate(filters);
		await settle();

		await store.reconcile();
		expect(data.listDone).toHaveBeenLastCalledWith(
			1,
			expect.objectContaining({ filter: { query: filters, today: '2026-09-24' } })
		);
	});
});

describe('column sort (E3 plan, package 9)', () => {
	const sorted = (key: 'status' | 'project', reversed = false): ListQuery => ({
		...EMPTY_LIST_QUERY,
		sort: { key, reversed }
	});

	it('keeps a just checked row at its place in the status sort until undo expires', async () => {
		const backlog = ticket({ status: 'backlog' });
		const working = ticket({ status: 'in_progress' });
		const waiting = ticket({ status: 'waiting' });
		const store = new TicketListStore(fakeData([waiting, working, backlog]), session());
		store.activate(sorted('status'));
		await settle();
		expect(store.visible.map((entry) => entry.id)).toEqual([backlog.id, working.id, waiting.id]);

		await store.setDone(working.id, true);
		expect(store.visible.map((entry) => entry.id)).toEqual([backlog.id, working.id, waiting.id]);

		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
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

describe('KPI numbers (E3 plan, package 12)', () => {
	it('count the tickets that are not done, independent of the filters, and follow changes', async () => {
		const overdue = ticket({ due: '2026-09-23', priority: 'urgent' });
		const working = ticket({ status: 'in_progress', due: '2026-09-24' });
		const store = new TicketListStore(fakeData([overdue, working, ticket()]), session());
		store.activate({ ...EMPTY_LIST_QUERY, priority: 'low' });
		await settle();

		expect(store.kpis).toEqual({ notDone: 3, inProgress: 1, dueToday: 1, overdue: 1, urgent: 1 });
		expect(store.kpis.notDone).toBe(store.openCount);

		// A just checked row counts as done, like the header counter.
		await store.setDone(overdue.id, true);
		expect(store.kpis).toMatchObject({ notDone: 2, overdue: 0, urgent: 0 });

		store.upsert(ticket({ priority: 'urgent' }));
		expect(store.kpis).toMatchObject({ notDone: 3, urgent: 1 });
		store.remove(working.id);
		expect(store.kpis).toMatchObject({ notDone: 2, inProgress: 0, dueToday: 0 });
	});

	it('move the due numbers at the Berlin midnight', async () => {
		// 2026-09-24 23:59 in Berlin.
		vi.setSystemTime(Date.UTC(2026, 8, 24, 21, 59, 0));
		const store = new TicketListStore(fakeData([ticket({ due: '2026-09-24' })]), session());
		const stop = store.start();
		store.activate(EMPTY_LIST_QUERY);
		await settle();
		expect(store.kpis).toMatchObject({ dueToday: 1, overdue: 0 });

		await vi.advanceTimersByTimeAsync(61_000);
		expect(store.kpis).toMatchObject({ dueToday: 0, overdue: 1 });
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
		store.activate(withDone(false));
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
	it('shows the new state at once, locks during the request and keeps the row with undo', async () => {
		const item = ticket({ status: 'in_progress' });
		const data = fakeData([item]);
		const answer = deferred<TicketSummary>();
		data.setDone.mockImplementationOnce(() => answer.promise);
		const store = new TicketListStore(data, session());
		store.activate(withDone(false));
		await settle();

		const request = store.setDone(item.id, true);
		expect(store.isChecked(item)).toBe(true);
		expect(store.isPending(item.id)).toBe(true);
		void store.setDone(item.id, false);
		expect(data.setDone).toHaveBeenCalledOnce();

		answer.resolve({ ...item, status: 'done', updated: '2026-09-24 10:00:00.000Z' });
		await request;
		expect(store.isPending(item.id)).toBe(false);
		expect(store.isLingering(item.id)).toBe(true);
		expect(store.open.map((entry) => entry.id)).toEqual([item.id]);
		expect(store.open[0]?.status).toBe('done');
		expect(store.announcement).toMatch(/erledigt/);

		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		expect(store.isLingering(item.id)).toBe(false);
		expect(store.open).toEqual([]);
	});

	it('restores the exact previous status with undo', async () => {
		const item = ticket({ status: 'waiting' });
		const data = fakeData([item]);
		const store = new TicketListStore(data, session());
		store.activate(withDone(false));
		await settle();

		await store.setDone(item.id, true);
		await store.undo(item.id);

		expect(data.update).toHaveBeenCalledWith(item.id, { status: 'waiting' });
		expect(store.isLingering(item.id)).toBe(false);
		expect(store.open.map((entry) => entry.status)).toEqual(['waiting']);
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		expect(store.open).toHaveLength(1);
	});

	it('moves the row into the section "Erledigt" after the undo window when shown', async () => {
		const item = ticket();
		const store = new TicketListStore(fakeData([item]), session());
		store.activate(withDone(true));
		await settle();

		await store.setDone(item.id, true);
		expect(store.done).toEqual([]);
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		expect(store.open).toEqual([]);
		expect(store.done.map((entry) => entry.id)).toEqual([item.id]);
	});

	it('reopens a done ticket with the reopen status', async () => {
		const closed = done();
		const data = fakeData([], [[closed]]);
		const store = new TicketListStore(data, session());
		store.activate(withDone(true));
		await settle();

		await store.setDone(closed.id, false);

		expect(data.setDone).toHaveBeenCalledWith(closed.id, false);
		expect(store.done).toEqual([]);
		expect(store.open.map((entry) => entry.status)).toEqual(['open']);
		expect(store.isLingering(closed.id)).toBe(false);
	});

	it('springs back with a message when the request fails', async () => {
		const item = ticket();
		const data = fakeData([item]);
		data.setDone.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		const store = new TicketListStore(data, session());
		store.activate(withDone(false));
		await settle();

		await store.setDone(item.id, true);

		expect(store.isChecked(item)).toBe(false);
		expect(store.isPending(item.id)).toBe(false);
		expect(store.notice).toMatch(new RegExp(`^${item.key} konnte nicht geändert werden\\.`));
		expect(store.open[0]?.status).toBe('open');

		store.dismissNotice();
		expect(store.notice).toBeNull();
	});
});

describe('reset', () => {
	it('empties everything and aborts running requests and timers', async () => {
		const item = ticket();
		const data = fakeData([item, ticket()], [[done()]]);
		const store = new TicketListStore(data, session());
		store.activate(withDone(true));
		await settle();
		await store.setDone(item.id, true);
		const pending = deferred<DoneTicketPage>();
		data.listDone.mockImplementationOnce((_page, options) => abortable(options, pending.promise));
		void store.reload();

		store.reset();

		expect(data.listDone.mock.lastCall?.[1].signal?.aborted).toBe(true);
		expect(store.open).toEqual([]);
		expect(store.done).toEqual([]);
		expect(store.isLingering(item.id)).toBe(false);
		expect(store.openState).toBe('idle');
		expect(store.showDone).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('announce', () => {
	it('sets the polite status message, e.g. after a deletion in the panel', async () => {
		const item = ticket();
		const store = new TicketListStore(fakeData([item]), session());
		store.activate(withDone(false));
		await settle();

		store.remove(item.id);
		store.announce('TASK-1 wurde gelöscht.');

		expect(store.open).toEqual([]);
		expect(store.announcement).toBe('TASK-1 wurde gelöscht.');
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

	it('keeps a just checked row in the group of its previous status until undo expires', async () => {
		const waiting = ticket({ status: 'waiting' });
		const open = ticket();
		const store = new TicketListStore(fakeData([waiting, open]), session());
		store.activate(grouped('status'));
		await settle();

		await store.setDone(waiting.id, true);
		expect(shape(store)).toEqual([
			['open', [open.id]],
			['waiting', [waiting.id]]
		]);
		expect(store.groups?.[1]?.tickets[0]?.status).toBe('done');

		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
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

	it('keeps a just checked row with "Rückgängig" although the server no longer finds it', async () => {
		const hit = ticket();
		const { store, data } = await started([hit], [hit.id]);
		const live = fakeLive();
		const stop = store.connect(live.source);
		store.activate(searching('Miete'));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

		await store.setDone(hit.id, true);
		data.searchOpen.mockImplementation((_search, options) =>
			abortable(options, Promise.resolve([]))
		);
		live.send({ action: 'update', record: store.find(hit.id) as TicketSummary });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

		expect(visibleIds(store)).toEqual([hit.id]);
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

	it('sends the applied search with the done filter, not every typed letter', async () => {
		const { store, data } = await started([]);
		store.activate(searching(null, { showDone: true }));
		await settle();
		data.listDone.mockClear();

		store.activate(searching('Mi', { showDone: true }));
		store.activate(searching('Mie', { showDone: true }));
		expect(data.listDone).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

		expect(data.listDone).toHaveBeenCalledOnce();
		expect(data.listDone.mock.calls[0]?.[1].filter?.query.search).toBe('Mie');
	});

	it('accepts a done ticket from an event with a search only if it was found or is loaded', async () => {
		const found = done({ title: 'Miete' });
		const data = fakeData([], [[found]]);
		data.searchOpen.mockResolvedValue([]);
		const store = new TicketListStore(data, session());
		store.activate(searching('Miete', { showDone: true }));
		await settle();
		expect(store.done.map((entry) => entry.id)).toEqual([found.id]);

		const unknown = done({ completedAt: '2026-09-24 09:00:00.000Z' });
		store.upsert(unknown);
		expect(store.done.map((entry) => entry.id)).toEqual([found.id]);

		store.upsert({ ...found, title: 'Miete Mai', updated: '2026-09-24 11:00:00.000Z' });
		expect(store.done[0]?.title).toBe('Miete Mai');
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
