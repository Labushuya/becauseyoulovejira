// Fake data layer of "Jetzt neu starten" outside the page System (BW-1, ADR-0072) for component
// tests: the status of a running server, the restart that starts at once, a server that answers
// /api/health, and a clock that only moves while the store waits. `restartStoreOf` builds the store
// with a session that stays valid, so tests of the page "Kanäle" get an inert store by default.

import { vi } from 'vitest';
import type { SystemAnswer } from '$lib/data/system';
import { parseOverview, type SystemOverview, type SystemStatus } from '$lib/domain/system';
import type { RestartData, SystemClock } from '$lib/stores/restart-follow';
import { RestartStore } from '$lib/stores/restart.svelte';

/** The status of the page System for a server with `status` and a mail helper that runs or not. */
export function restartOverview(
	status: Partial<SystemStatus> = {},
	mailRunning = true
): SystemOverview {
	const overview = parseOverview({
		appDir: 'C:\\Apps\\app',
		status: {
			state: 'running',
			pid: 100,
			port: 8090,
			configuredPort: 8090,
			url: 'http://127.0.0.1:8090/',
			startedUtc: '2026-10-19T07:00:00Z',
			verdict: 'current',
			restartReasons: [],
			reload: false,
			mailHelperPid: mailRunning ? 55 : null,
			otherServers: [],
			autostart: 'off',
			...status
		},
		mail: { installed: true, running: mailRunning, blocker: mailRunning ? '' : 'no-mailbox' }
	});
	if (overview === null) throw new Error('not an overview');
	return overview;
}

export const ok = <T>(value: T): SystemAnswer<T> => ({ kind: 'ok', value });

/**
 * A data layer with spies: the restart starts, the server is gone for one question and back with a
 * new PID; "Mail-Helfer neu starten" answers with a running helper.
 */
export function fakeRestartData() {
	const health = [false, true];
	return {
		status: vi
			.fn<RestartData['status']>()
			.mockResolvedValueOnce(ok(restartOverview()))
			.mockResolvedValue(ok(restartOverview({ pid: 200, startedUtc: '2026-10-19T08:00:00Z' }))),
		act: vi.fn<RestartData['act']>(async (action) =>
			action === 'restart' ? ok('restarting' as const) : ok(restartOverview({}, true))
		),
		health: vi.fn<RestartData['health']>(async () => health.shift() ?? true)
	} satisfies RestartData;
}

export type FakeRestartData = ReturnType<typeof fakeRestartData>;

/** Time that passes only while the store waits. */
export function fakeRestartClock(): SystemClock {
	let now = 0;
	return {
		now: () => now,
		wait: async (ms) => {
			now += ms;
		}
	};
}

/** The store on a fake data layer and a fake clock, with a valid session. */
export function restartStoreOf(data: RestartData = fakeRestartData()): RestartStore {
	return new RestartStore(data, { ensureValid: () => true, logout: vi.fn() }, fakeRestartClock());
}
