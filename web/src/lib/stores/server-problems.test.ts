// The store of the error log of the server (FP-2, ADR-0077) on a fake source: the list newest first,
// the entry of the address first and only once, a gone entry as "missing", no connection as
// "offline" without breaking anything, any other failure as "failed" with its details, and a newer
// load that replaces a running one.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RunResult } from '$lib/domain/connections';
import { problemReport } from '$lib/domain/problems';
import type { ServerProblemRecord } from '$lib/domain/server-problems';
import { runProblem } from './connections.svelte';
import { ServerProblemsStore, type ServerProblemsSource } from './server-problems.svelte';

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
