// The monitor of the connection (OF-2, concept OF-0 §3.10): it asks nothing while it does not watch;
// watching, an answer means online and a request without one makes it ask the server; only a failed
// check switches to offline, then it asks again after 2, 5, 10 and 30 s and every 60 s, and at once
// when the browser goes online or the tab comes back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectivityStore } from './connectivity.svelte';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
	vi.useRealTimers();
});

function monitor(reachable = true) {
	const server = { reachable };
	const probe = vi.fn(async () => server.reachable);
	return { store: new ConnectivityStore(probe), probe, server };
}

describe('ConnectivityStore', () => {
	it('stays online and asks nothing while it does not watch', async () => {
		const { store, probe } = monitor(false);
		store.note('network');
		await store.check();
		expect(probe).not.toHaveBeenCalled();
		expect(store.offline).toBe(false);
	});

	it('switches to offline only after a failed check, and back with the next answer', async () => {
		const { store, probe, server } = monitor(false);
		const changes: boolean[] = [];
		store.onChange((offline) => changes.push(offline));
		const stop = store.start(null);
		store.note('network');
		await vi.advanceTimersByTimeAsync(0);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(store.offline).toBe(true);
		server.reachable = true;
		store.note('answer');
		expect(store.offline).toBe(false);
		expect(changes).toEqual([true, false]);
		stop();
	});

	it('asks again after 2, 5, 10 and 30 s, then every 60 s, while offline', async () => {
		const { store, probe } = monitor(false);
		const stop = store.start(null);
		await store.check();
		for (const [wait, calls] of [
			[1999, 1],
			[1, 2],
			[5000, 3],
			[10000, 4],
			[30000, 5],
			[60000, 6],
			[60000, 7]
		] as const) {
			await vi.advanceTimersByTimeAsync(wait);
			expect(probe).toHaveBeenCalledTimes(calls);
		}
		stop();
		await vi.advanceTimersByTimeAsync(120000);
		expect(probe).toHaveBeenCalledTimes(7);
	});

	it('asks at once when the browser goes online or the tab becomes visible', async () => {
		const { store, probe, server } = monitor(false);
		const stop = store.start(window);
		await store.check();
		server.reachable = true;
		window.dispatchEvent(new Event('online'));
		await vi.advanceTimersByTimeAsync(0);
		expect(probe).toHaveBeenCalledTimes(2);
		expect(store.offline).toBe(false);
		stop();
	});

	it('gives up a check after 5 s (a tunnel without the other side hangs)', async () => {
		let signal: AbortSignal | null = null;
		const store = new ConnectivityStore(
			(given) =>
				new Promise((resolve) => {
					signal = given;
					given.addEventListener('abort', () => resolve(false));
				})
		);
		const stop = store.start(null);
		const result = store.check();
		await vi.advanceTimersByTimeAsync(5000);
		expect(await result).toBe(false);
		expect((signal as AbortSignal | null)?.aborted).toBe(true);
		expect(store.offline).toBe(true);
		stop();
	});

	it('goes back to online without asking when the outbox stops working', async () => {
		const { store } = monitor(false);
		const stop = store.start(null);
		await store.check();
		stop();
		expect(store.offline).toBe(true);
		store.reset();
		expect(store.offline).toBe(false);
	});
});
