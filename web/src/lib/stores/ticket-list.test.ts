// Ticket list store with a fake data layer (E2 plan, package 5): order, moving between open and
// done, stale answers and requests, midnight, check mark with undo, reset.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { DoneTicketPage } from '$lib/data/tickets';
import type { RequestOptions } from '$lib/data/options';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { TicketListStore, UNDO_WINDOW_MS, type TicketListData } from './ticket-list.svelte';

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
		listDone: vi.fn((page: number, options: RequestOptions) =>
			abortable<DoneTicketPage>(
				options,
				Promise.resolve({
					items: donePages[page - 1] ?? [],
					page,
					hasMore: page < donePages.length
				})
			)
		),
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

		store.activate(false);
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

		store.activate(true);
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

		store.activate(true);
		store.activate(false);
		store.activate(true);
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

		store.activate(false);
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

		store.activate(false);
		await settle();
		expect(guard.logout).toHaveBeenCalledOnce();
		expect(store.openError).toBeNull();

		const invalid = fakeData();
		new TicketListStore(invalid, session(false)).activate(true);
		expect(invalid.listOpen).not.toHaveBeenCalled();
		expect(invalid.listDone).not.toHaveBeenCalled();
	});
});

describe('upsert and remove', () => {
	it('moves a ticket between open and done and ignores an older update', async () => {
		const item = ticket();
		const store = new TicketListStore(fakeData([item]), session());
		store.activate(true);
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
		store.activate(false);
		await settle();

		store.upsert(done());
		expect(store.open).toEqual([]);
		expect(store.done).toEqual([]);
	});

	it('resorts after an update', async () => {
		const first = ticket({ priority: 'high' });
		const second = ticket({ priority: 'low' });
		const store = new TicketListStore(fakeData([first, second]), session());
		store.activate(false);
		await settle();
		expect(store.open.map((entry) => entry.id)).toEqual([first.id, second.id]);

		store.upsert({ ...second, priority: 'urgent', updated: '2026-09-24 09:00:00.000Z' });
		expect(store.open.map((entry) => entry.id)).toEqual([second.id, first.id]);
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
		store.activate(false);
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
		store.activate(false);
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
		store.activate(false);
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
		store.activate(true);
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
		store.activate(true);
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
		store.activate(false);
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
		store.activate(true);
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
