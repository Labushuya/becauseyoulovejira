// The store of the error log of the server (FP-2, ADR-0077) on a fake source: the list newest first,
// the entry of the address first and only once, a gone entry as "missing", no connection as
// "offline" without breaking anything, any other failure as "failed" with its details, and a newer
// load that replaces a running one. Since FP-3 the page "Fehlerprotokoll": the first page of the
// filters, "Mehr laden" after the cursor without an entry twice, a new filter that starts the list
// and its cursor anew, a failed "Mehr laden" that keeps the list, the line for screen readers after
// "Mehr laden", and `resume`, which keeps a shown list. The store of "Details" at the channel cards:
// one query for all cards, none for a new run with the same error, a failed query without a link.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RunResult } from '$lib/domain/connections';
import { problemReport } from '$lib/domain/problems';
import type {
	ChannelProblemCard,
	ServerProblemPage,
	ServerProblemQuery,
	ServerProblemRecord
} from '$lib/domain/server-problems';
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
		page: vi.fn(async (): Promise<ServerProblemPage> => ({ records: [], next: null })),
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

	it('keeps the dialog on the newest 50: no page of the page, nothing more to load', async () => {
		const fake = source();
		const store = new ServerProblemsStore(fake);
		await store.load();
		expect(fake.page).not.toHaveBeenCalled();
		expect(store.hasMore).toBe(false);
		await store.more();
		expect(fake.page).not.toHaveBeenCalled();
		expect(store.filter).toEqual({ source: null, area: null });
	});
});

describe('ServerProblemsStore on the page "Fehlerprotokoll" (FP-3)', () => {
	const at = (minute: number) => Date.UTC(2026, 10, 5, 9, minute, 0);
	/** Entries newest first, one a minute. */
	const records = (from: number, count: number) =>
		Array.from({ length: count }, (_, index) =>
			record(`page${String(from + index).padStart(11, '0')}`, { lastAt: at(59 - from - index) })
		);
	const cursor = (id: string) => ({ lastAt: '2026-11-05 09:00:00.000Z', id });

	it('loads the first page of the filters, then the next one after its cursor, without an entry twice', async () => {
		const first = records(0, 3);
		const second = [first[2] as ServerProblemRecord, ...records(3, 2)];
		const page = vi.fn(async (query: ServerProblemQuery): Promise<ServerProblemPage> =>
			query.after === null
				? { records: first, next: cursor(first[2]?.id ?? '') }
				: { records: second, next: null }
		);
		const store = new ServerProblemsStore(source({ page }));

		await store.browse({ source: 'job', area: 'system' });
		expect(page).toHaveBeenLastCalledWith(
			{ source: 'job', area: 'system', after: null },
			expect.any(AbortSignal)
		);
		expect(store.state).toBe('ready');
		expect(store.hasMore).toBe(true);

		await store.more();
		expect(page).toHaveBeenLastCalledWith(
			{ source: 'job', area: 'system', after: cursor(first[2]?.id ?? '') },
			expect.any(AbortSignal)
		);
		expect(store.entries.map((entry) => entry.serverId)).toEqual(
			[...first, ...records(3, 2)].map((entry) => entry.id)
		);
		expect(store.hasMore).toBe(false);
		expect(store.moreState).toBe('idle');
		// Nothing more to find: "Mehr laden" asks nothing.
		await store.more();
		expect(page).toHaveBeenCalledTimes(2);
	});

	it('starts the list and its cursor anew for a new filter and on "Erneut laden"', async () => {
		const page = vi.fn(async (query: ServerProblemQuery): Promise<ServerProblemPage> => ({
			records: query.source === 'request' ? [NEWER] : records(0, 2),
			next: query.source === 'request' ? null : cursor('page00000000001')
		}));
		const store = new ServerProblemsStore(source({ page }));
		await store.browse();
		expect(store.filter).toEqual({ source: null, area: null });
		expect(store.hasMore).toBe(true);

		const changing = store.browse({ source: 'request', area: null });
		expect(store.state).toBe('loading');
		expect(store.hasMore).toBe(false);
		await changing;
		expect(store.entries.map((entry) => entry.serverId)).toEqual([NEWER.id]);
		expect(store.hasMore).toBe(false);

		// "Erneut laden" keeps the filters and starts from the first page.
		await store.browse();
		expect(page).toHaveBeenLastCalledWith(
			{ source: 'request', area: null, after: null },
			expect.any(AbortSignal)
		);
	});

	it('lets a new filter replace a running "Mehr laden"; its late answer changes nothing', async () => {
		const answers: ((page: ServerProblemPage) => void)[] = [];
		const signals: AbortSignal[] = [];
		const page = vi.fn(
			(_query: ServerProblemQuery, signal: AbortSignal) =>
				new Promise<ServerProblemPage>((resolve) => {
					signals.push(signal);
					answers.push(resolve);
				})
		);
		const store = new ServerProblemsStore(source({ page }));
		const first = store.browse();
		answers[0]?.({ records: records(0, 2), next: cursor('page00000000001') });
		await first;
		const more = store.more();
		expect(store.moreState).toBe('loading');
		const other = store.browse({ source: 'channel', area: null });
		expect(signals[1]?.aborted).toBe(true);
		expect(store.moreState).toBe('idle');
		answers[1]?.({ records: records(2, 2), next: null });
		answers[2]?.({ records: [NEWER], next: null });
		await Promise.all([more, other]);
		expect(store.entries.map((entry) => entry.serverId)).toEqual([NEWER.id]);
	});

	it('keeps the list when "Mehr laden" fails: offline as a hint, any other failure with its details', async () => {
		let fail: DataError | null = null;
		const page = vi.fn(async (query: ServerProblemQuery): Promise<ServerProblemPage> => {
			if (query.after !== null && fail !== null) throw fail;
			return query.after === null
				? { records: records(0, 2), next: cursor('page00000000001') }
				: { records: records(2, 1), next: null };
		});
		const store = new ServerProblemsStore(source({ page }));
		await store.browse();

		fail = new DataError('network');
		await store.more();
		expect(store.state).toBe('ready');
		expect(store.moreState).toBe('offline');
		expect(store.moreProblem).toBeNull();
		expect(store.entries).toHaveLength(2);
		expect(store.hasMore).toBe(true);

		fail = new DataError('server', { status: 500 });
		await store.more();
		expect(store.moreState).toBe('failed');
		expect(store.moreProblem).toMatchObject({ outcome: { result: 'response', status: 500 } });

		fail = null;
		await store.more();
		expect(store.moreState).toBe('idle');
		expect(store.entries).toHaveLength(3);
	});

	it('tells screen readers how many "Mehr laden" brought, empty while it runs and for a new list', async () => {
		const first = records(0, 2);
		let next: ServerProblemRecord[] = records(2, 3);
		const page = vi.fn(async (query: ServerProblemQuery): Promise<ServerProblemPage> =>
			query.after === null
				? { records: first, next: cursor('page00000000001') }
				: { records: next, next: cursor('page00000000004') }
		);
		const store = new ServerProblemsStore(source({ page }));
		await store.browse();
		expect(store.announcement).toBe('');

		const loading = store.more();
		expect(store.announcement).toBe('');
		await loading;
		expect(store.announcement).toBe('3 weitere geladen.');

		// A page with only entries shown already, e.g. after a cleanup of the server in between.
		next = [first[0] as ServerProblemRecord];
		await store.more();
		expect(store.announcement).toBe('Keine weiteren Einträge.');
		expect(store.entries).toHaveLength(5);

		await store.browse({ source: 'job', area: null });
		expect(store.announcement).toBe('');
	});

	it('keeps a shown list with its filters and pages on "resume", and loads anew in any other state', async () => {
		let offline = false;
		const page = vi.fn(async (query: ServerProblemQuery): Promise<ServerProblemPage> => {
			if (offline) throw new DataError('network');
			return query.after === null
				? { records: records(0, 2), next: cursor('page00000000001') }
				: { records: records(2, 1), next: null };
		});
		const store = new ServerProblemsStore(source({ page }));
		// Never loaded: the first page.
		await store.resume();
		expect(page).toHaveBeenCalledTimes(1);
		await store.browse({ source: 'channel', area: 'private' });
		await store.more();
		expect(page).toHaveBeenCalledTimes(3);

		store.stop();
		await store.resume();
		expect(page).toHaveBeenCalledTimes(3);
		expect(store.filter).toEqual({ source: 'channel', area: 'private' });
		expect(store.entries).toHaveLength(3);

		// Offline: "resume" tries the first page of the same filters again.
		offline = true;
		await store.browse();
		expect(store.state).toBe('offline');
		offline = false;
		await store.resume();
		expect(page).toHaveBeenLastCalledWith(
			{ source: 'channel', area: 'private', after: null },
			expect.any(AbortSignal)
		);
		expect(store.state).toBe('ready');

		// Stopped while the first page was loading: loads again.
		const running = store.browse();
		store.stop();
		await running;
		expect(store.state).toBe('loading');
		await store.resume();
		expect(store.state).toBe('ready');

		// The newest 50 of the dialog are no list of the page.
		await store.load();
		const calls = page.mock.calls.length;
		await store.resume();
		expect(page).toHaveBeenCalledTimes(calls + 1);
	});

	it('is "offline" or "failed" for the first page as in the dialog', async () => {
		const page = vi.fn(async (): Promise<ServerProblemPage> => {
			throw new DataError('network');
		});
		const store = new ServerProblemsStore(source({ page }));
		await store.browse();
		expect(store.state).toBe('offline');
		expect(store.entries).toEqual([]);
		expect(store.hasMore).toBe(false);
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
