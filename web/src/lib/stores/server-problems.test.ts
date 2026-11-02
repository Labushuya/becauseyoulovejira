// The store of the error log of the server (FP-2, ADR-0077) on a fake source: the list newest first,
// the entry of the address first and only once, a gone entry as "missing", no connection as
// "offline" without breaking anything, any other failure as "failed" with its details, and a newer
// load that replaces a running one. The store of "Details" at the channel cards: one query for all
// cards, none for a new run with the same error, a failed query without a link.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RunResult } from '$lib/domain/connections';
import { problemReport } from '$lib/domain/problems';
import type { ChannelProblemCard, ServerProblemRecord } from '$lib/domain/server-problems';
import { runProblem } from './connections.svelte';
import {
	CHANNEL_PROBLEMS_SETTLE_MS,
	ChannelProblemsStore,
	ServerProblemsStore,
	type ChannelProblemsFinder,
	type ServerProblemsSource
} from './server-problems.svelte';

function record(id: string, overrides: Partial<ServerProblemRecord> = {}): ServerProblemRecord {
	return {
		id,
		source: 'channel',
		area: 'private',
		code: 'channel_error',
		message: 'Abruf gescheitert',
		context: { connection: 'conn00000000001', channel: 'telegram' },
		count: 1,
		firstAt: Date.UTC(2026, 10, 2, 8, 0, 0),
		lastAt: Date.UTC(2026, 10, 2, 9, 0, 0),
		...overrides
	};
}

const NEWER = record('newer000000001a');
const OLDER = record('older000000001a', {
	source: 'job',
	area: 'system',
	context: { job: 'trash' }
});
const LINKED = record('linked00000001a', { lastAt: Date.UTC(2026, 9, 20, 9, 0, 0) });

function source(overrides: Partial<ServerProblemsSource> = {}): ServerProblemsSource {
	return {
		list: vi.fn(async () => [NEWER, OLDER]),
		get: vi.fn(async (id: string) => {
			if (id === LINKED.id) return LINKED;
			if (id === NEWER.id) return NEWER;
			throw new DataError('not_found', { status: 404 });
		}),
		...overrides
	};
}

describe('ServerProblemsStore', () => {
	it('loads the newest entries the account may see', async () => {
		const store = new ServerProblemsStore(source());
		expect(store.state).toBe('idle');
		const loading = store.load();
		expect(store.state).toBe('loading');
		await loading;
		expect(store.state).toBe('ready');
		expect(store.entries.map((entry) => [entry.serverId, entry.source, entry.intent])).toEqual([
			[NEWER.id, 'server', 'Kanal im Hintergrund abrufen: Telegram'],
			[OLDER.id, 'server', 'Papierkorb aufräumen']
		]);
		expect(store.focus).toBeNull();
		expect(store.missing).toBe(false);
	});

	it('puts the entry of the address first, also an older one, and only once', async () => {
		const store = new ServerProblemsStore(source());
		await store.load(LINKED.id);
		expect(store.entries.map((entry) => entry.serverId)).toEqual([LINKED.id, NEWER.id, OLDER.id]);
		expect(store.focus).toBe(`server-${LINKED.id}`);

		await store.load(NEWER.id);
		expect(store.entries.map((entry) => entry.serverId)).toEqual([NEWER.id, OLDER.id]);
		expect(store.focus).toBe(`server-${NEWER.id}`);
	});

	it('says that an entry is gone or not visible and keeps the list', async () => {
		const store = new ServerProblemsStore(source());
		await store.load('gone00000000001');
		expect(store.state).toBe('ready');
		expect(store.missing).toBe(true);
		expect(store.focus).toBeNull();
		expect(store.entries).toHaveLength(2);
	});

	it('is "offline" without a connection: no list, no details, nothing breaks', async () => {
		const store = new ServerProblemsStore(
			source({
				list: async () => {
					throw new DataError('network');
				}
			})
		);
		await store.load();
		expect(store.state).toBe('offline');
		expect(store.entries).toEqual([]);
		expect(store.problem).toBeNull();
	});

	it('is "failed" with its details for any other failure, and loads again', async () => {
		const failing = vi.fn(async (): Promise<ServerProblemRecord[]> => {
			throw new DataError('server', { status: 500 });
		});
		const store = new ServerProblemsStore(source({ list: failing }));
		await store.load();
		expect(store.state).toBe('failed');
		expect(store.problem).toMatchObject({ outcome: { result: 'response', status: 500 } });

		failing.mockImplementationOnce(async () => [NEWER]);
		await store.load();
		expect(store.state).toBe('ready');
		expect(store.problem).toBeNull();
	});

	it('lets a newer load replace a running one and stops with the dialog', async () => {
		const answers: ((records: ServerProblemRecord[]) => void)[] = [];
		const signals: AbortSignal[] = [];
		const store = new ServerProblemsStore(
			source({
				list: vi.fn(
					(signal: AbortSignal) =>
						new Promise<ServerProblemRecord[]>((resolve) => {
							signals.push(signal);
							answers.push(resolve);
						})
				)
			})
		);
		const first = store.load();
		const second = store.load();
		expect(signals[0]?.aborted).toBe(true);
		// The late answer of the replaced load changes nothing.
		answers[0]?.([NEWER]);
		answers[1]?.([OLDER]);
		await Promise.all([first, second]);
		expect(store.entries.map((entry) => entry.serverId)).toEqual([OLDER.id]);

		void store.load();
		store.stop();
		expect(signals[2]?.aborted).toBe(true);
	});
});

describe('ChannelProblemsStore: "Details" of the channel cards in one query (FP-2)', () => {
	const RUN = '2026-11-02 09:30:00.000Z';
	const card = (
		index: number,
		overrides: Partial<ChannelProblemCard> = {}
	): ChannelProblemCard => ({
		connection: `conn0000000000${index}`,
		lastError: `Fehler ${index}`,
		lastRunAt: RUN,
		...overrides
	});
	const idOf = (index: number) => `prob0000000000${index}`;
	/** An entry of every asked connection, a little after the run of 09:30. */
	const finder = () =>
		vi.fn<ChannelProblemsFinder>(async (connections) =>
			connections.map((connection) => ({
				id: connection.replace('conn', 'prob'),
				connection,
				lastAt: Date.UTC(2026, 10, 2, 9, 30, 0, 5)
			}))
		);

	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('waits for the cards to settle and asks one query for all of them', async () => {
		const find = finder();
		const store = new ChannelProblemsStore(find);
		for (const index of [1, 2, 3, 4, 5]) store.watch(card(index));
		await vi.advanceTimersByTimeAsync(CHANNEL_PROBLEMS_SETTLE_MS - 1);
		expect(find).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(find).toHaveBeenCalledTimes(1);
		expect(find.mock.calls[0]?.[1]).toBe(Date.UTC(2026, 10, 2, 9, 30, 0) - 1000);
		await vi.waitFor(() => expect(store.idOf(card(5))).toBe(idOf(5)));
		expect([1, 2, 3, 4].map((index) => store.idOf(card(index)))).toEqual([1, 2, 3, 4].map(idOf));
	});

	it('asks nothing for a new run with the same error, once more for a new error', async () => {
		const find = finder();
		const store = new ChannelProblemsStore(find);
		const ends = [1, 2].map((index) => store.watch(card(index)));
		await vi.advanceTimersByTimeAsync(CHANNEL_PROBLEMS_SETTLE_MS);
		await vi.waitFor(() => expect(store.idOf(card(1))).toBe(idOf(1)));

		ends[0]?.();
		store.watch(card(1, { lastRunAt: '2026-11-02 09:31:00.000Z' }));
		await vi.advanceTimersByTimeAsync(CHANNEL_PROBLEMS_SETTLE_MS);
		expect(find).toHaveBeenCalledTimes(1);
		expect(store.idOf(card(1))).toBe(idOf(1));

		ends[1]?.();
		store.watch(card(2, { lastError: 'Neuer Fehler' }));
		await vi.advanceTimersByTimeAsync(CHANNEL_PROBLEMS_SETTLE_MS);
		expect(find).toHaveBeenCalledTimes(2);
		// The old error of card 2 has no entry any more; the new one has.
		await vi.waitFor(() =>
			expect(store.idOf(card(2, { lastError: 'Neuer Fehler' }))).toBe(idOf(2))
		);
		expect(store.idOf(card(2))).toBeNull();
	});

	it('shows no link after a failed query and asks again with the next change; stop forgets', async () => {
		const find = vi.fn<ChannelProblemsFinder>(async () => {
			throw new DataError('network');
		});
		const store = new ChannelProblemsStore(find);
		const end = store.watch(card(1));
		await vi.advanceTimersByTimeAsync(CHANNEL_PROBLEMS_SETTLE_MS);
		expect(store.idOf(card(1))).toBeNull();
		end();
		store.watch(card(1, { lastRunAt: '2026-11-02 09:31:00.000Z' }));
		await vi.advanceTimersByTimeAsync(CHANNEL_PROBLEMS_SETTLE_MS);
		expect(find).toHaveBeenCalledTimes(2);

		// A card without a run asks nothing; stop ends a waiting query.
		const quiet = finder();
		const other = new ChannelProblemsStore(quiet);
		other.watch(card(1, { lastRunAt: null }));
		await vi.advanceTimersByTimeAsync(CHANNEL_PROBLEMS_SETTLE_MS);
		other.watch(card(2));
		other.stop();
		await vi.advanceTimersByTimeAsync(CHANNEL_PROBLEMS_SETTLE_MS);
		expect(quiet).not.toHaveBeenCalled();
	});
});

describe('"Jetzt abrufen" with an entry of the server (FP-2)', () => {
	const failed: RunResult = {
		status: 'error',
		created: 0,
		duplicates: 0,
		updated: 0,
		skipped: 0,
		failed: 0,
		unmatched: 0,
		error: 'Telegram antwortet mit HTTP 401.',
		missing: []
	};

	it('names the entry of a failed run as Server-ID of its details and report', () => {
		const problem = runProblem('conn00000000001', { ...failed, problem: NEWER.id });
		expect(problem).toMatchObject({ outcome: { result: 'reported' }, serverId: NEWER.id });
		expect(problemReport(problem!)).toContain(`Server-ID: ${NEWER.id}`);
		expect(runProblem('conn00000000001', { ...failed })?.serverId).toBeNull();
	});
});
