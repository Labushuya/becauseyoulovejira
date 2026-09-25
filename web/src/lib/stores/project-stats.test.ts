// Number "gesamt" of the project tiles with a fake data layer and fake realtime (E3 plan, T-12
// and package 14): total = active plus done, counting only what is shown, debounced counting
// after ticket events, stale counts aborted, cleanup.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	ProjectStatsStore,
	STATS_DEBOUNCE_MS,
	type ProjectStatsData
} from './project-stats.svelte';
import type { LiveSource, Unsubscribe } from './realtime';

const HOUSE = 'proj00000000001';
const CAR = 'proj00000000002';

function setup(done: Record<string, number> = { [HOUSE]: 4, [CAR]: 0 }) {
	const data = {
		countDone: vi.fn(async (id: string, options: RequestOptions) => {
			void options;
			return done[id] ?? 0;
		})
	} satisfies ProjectStatsData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	return { store: new ProjectStatsStore(data, session), data, session, done };
}

/** Realtime source with ticket events and reconnections only. */
function fakeLive() {
	const tickets: (() => void)[] = [];
	const reconnected: (() => void)[] = [];
	const add = (list: (() => void)[], call: () => void): Promise<Unsubscribe> => {
		list.push(call);
		return Promise.resolve(async () => {
			list.splice(list.indexOf(call), 1);
		});
	};
	const never = (): Promise<Unsubscribe> => {
		throw new Error('The stats must not subscribe to anything but tickets.');
	};
	const source: LiveSource = {
		tickets: (call) => add(tickets, () => call({ action: 'delete', id: 'x' })),
		ticket: never,
		comments: never,
		history: never,
		projects: never,
		tags: never,
		inbox: never,
		reconnected: (call) => add(reconnected, call)
	};
	return { source, tickets, reconnected };
}

const flush = async () => {
	await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ProjectStatsStore', () => {
	it('adds the done tickets of the server to the active ones', async () => {
		const { store, data } = setup();
		expect(store.total(HOUSE, 3)).toBeNull();

		store.track([HOUSE, CAR]);
		await flush();

		expect(data.countDone).toHaveBeenCalledTimes(2);
		expect(store.doneCount(HOUSE)).toBe(4);
		expect(store.total(HOUSE, 3)).toBe(7);
		expect(store.total(CAR, 0)).toBe(0);
		expect(store.total('proj00000000009', 1)).toBeNull();
	});

	it('counts only when a shown project has no number yet', async () => {
		const { store, data } = setup();
		store.track([HOUSE, CAR]);
		await flush();

		store.track([HOUSE]);
		await flush();
		expect(data.countDone).toHaveBeenCalledTimes(2);

		store.track([HOUSE, 'proj00000000003']);
		await flush();
		expect(data.countDone).toHaveBeenCalledTimes(4);
	});

	it('counts again once after a burst of ticket events and after a reconnection', async () => {
		const { store, data, done } = setup();
		const live = fakeLive();
		const stop = store.connect(live.source);
		store.track([HOUSE]);
		await flush();
		expect(data.countDone).toHaveBeenCalledTimes(1);

		done[HOUSE] = 5;
		for (const call of [...live.tickets, ...live.tickets, ...live.tickets]) call();
		await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS - 1);
		expect(data.countDone).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(data.countDone).toHaveBeenCalledTimes(2);
		expect(store.total(HOUSE, 1)).toBe(6);

		for (const call of live.reconnected) call();
		await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
		expect(data.countDone).toHaveBeenCalledTimes(3);

		stop();
		await flush();
		expect(live.tickets).toEqual([]);
		expect(live.reconnected).toEqual([]);
		expect(store.doneCount(HOUSE)).toBeNull();
	});

	it('aborts a stale count and keeps the numbers of the newer one', async () => {
		const { store, data } = setup();
		const signals: AbortSignal[] = [];
		let answer = 1;
		data.countDone.mockImplementation(async (_id, options) => {
			if (options.signal) signals.push(options.signal);
			const value = answer;
			await new Promise((resolve) => setTimeout(resolve, 10));
			if (options.signal?.aborted) throw new DataError('aborted');
			return value;
		});

		store.track([HOUSE]);
		answer = 2;
		const reloading = store.reload();
		await vi.advanceTimersByTimeAsync(10);
		await reloading;

		expect(signals[0]?.aborted).toBe(true);
		expect(store.doneCount(HOUSE)).toBe(2);
		expect(store.error).toBeNull();
	});

	it('keeps the last numbers on a failure, shows it and counts again on "Erneut versuchen"', async () => {
		const { store, data } = setup();
		store.track([HOUSE]);
		await flush();

		data.countDone.mockRejectedValueOnce(new DataError('network'));
		await store.reload();
		expect(store.error).toMatch(/Server nicht erreichbar/);
		expect(store.doneCount(HOUSE)).toBe(4);

		await store.reload();
		expect(store.error).toBeNull();
	});

	it('ends the session on 401 and counts nothing without a session', async () => {
		const { store, data, session } = setup();
		data.countDone.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		store.track([HOUSE]);
		await flush();
		expect(session.logout).toHaveBeenCalledOnce();
		expect(store.error).toBeNull();

		const other = setup();
		other.session.ensureValid.mockReturnValue(false);
		other.store.track([HOUSE]);
		await flush();
		expect(other.data.countDone).not.toHaveBeenCalled();
	});
});
