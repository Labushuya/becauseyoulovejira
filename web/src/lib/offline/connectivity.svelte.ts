// The monitor of the connection (OF-2, ADR-0074 addendum OF-2; concept OF-0 §3.10). Over the VPN
// `navigator.onLine` says nothing (the phone has mobile data while the tunnel is dead), so the
// monitor listens to the requests of the app instead (lib/pocketbase.ts) and asks the server itself:
// a request without an answer, the end of the realtime connection or the event "offline" make it
// check `GET /api/health` with a limit of 5 s. Only a failed check switches to "offline", so a
// single failure does not flicker. Offline it checks again after 2, 5, 10 and 30 s, then every 60 s,
// and at once when the browser goes online, the tab becomes visible or gets the focus, or on
// "Erneut versuchen". It watches only while the outbox can work (`start`); otherwise it stays
// "online" and asks nothing, so the app behaves as before.

import { SvelteSet } from 'svelte/reactivity';
import { HEALTH_TIMEOUT_MS, checkDelay } from '$lib/domain/offline';
import { pb, type RequestOutcome } from '$lib/pocketbase';

/** One question to the server: true when it answered at all. */
export type Probe = (signal: AbortSignal) => Promise<boolean>;

/** Timers the monitor uses; tests pass fake ones. */
export interface Timers {
	set(run: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

export const WINDOW_TIMERS: Timers = {
	set: (run, ms) => setTimeout(run, ms),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/**
 * `GET /api/health` of the same origin, outside of the SDK so its answer is never watched itself,
 * with the token of the session like every request of the app (the rate limit never counts signed-in
 * requests, concept §3.10).
 */
export function healthProbe(fetcher: typeof fetch, token: () => string): Probe {
	return async (signal) => {
		const auth = token();
		const headers: Record<string, string> = auth === '' ? {} : { Authorization: auth };
		try {
			await fetcher('/api/health', { signal, cache: 'no-store', headers });
			return true;
		} catch {
			return false;
		}
	};
}

export class ConnectivityStore {
	#offline = $state(false);
	#checking = $state(false);
	readonly #probe: Probe;
	readonly #timers: Timers;
	#running: Promise<boolean> | null = null;
	#attempt = 0;
	#timer: unknown = null;
	#watching = 0;
	readonly #listeners = new SvelteSet<(offline: boolean) => void>();

	constructor(probe: Probe, timers: Timers = WINDOW_TIMERS) {
		this.#probe = probe;
		this.#timers = timers;
	}

	/** The last check of the server failed and no request got an answer since. */
	get offline(): boolean {
		return this.#offline;
	}

	/** A check of the server runs. */
	get checking(): boolean {
		return this.#checking;
	}

	/** Whether the monitor watches (the outbox can work). */
	get watching(): boolean {
		return this.#watching > 0;
	}

	/** Called on every change between online and offline. */
	onChange(listener: (offline: boolean) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/** What a request of the app told: an answer means online, none means "check". */
	note(outcome: RequestOutcome): void {
		if (!this.watching) return;
		if (outcome === 'answer') this.#set(false);
		else void this.check();
	}

	/**
	 * Asks the server once (one question at a time); true when it answered. While watching, a
	 * failure switches to offline and plans the next check.
	 */
	check(): Promise<boolean> {
		if (!this.watching) return Promise.resolve(!this.#offline);
		this.#running ??= this.#ask().finally(() => {
			this.#running = null;
		});
		return this.#running;
	}

	async #ask(): Promise<boolean> {
		this.#timers.clear(this.#timer);
		this.#timer = null;
		this.#checking = true;
		const controller = new AbortController();
		const limit = this.#timers.set(() => controller.abort(), HEALTH_TIMEOUT_MS);
		let reached: boolean;
		try {
			reached = await this.#probe(controller.signal);
		} catch {
			reached = false;
		} finally {
			this.#timers.clear(limit);
			this.#checking = false;
		}
		if (!this.watching) return reached;
		this.#set(!reached);
		if (!reached) {
			this.#attempt += 1;
			this.#timer = this.#timers.set(() => void this.check(), checkDelay(this.#attempt));
		}
		return reached;
	}

	/** Back to "online" without asking: the outbox no longer works (switch off, signed out). */
	reset(): void {
		this.#timers.clear(this.#timer);
		this.#timer = null;
		this.#set(false);
	}

	#set(offline: boolean): void {
		if (!offline) {
			this.#attempt = 0;
			this.#timers.clear(this.#timer);
			this.#timer = null;
		}
		if (this.#offline === offline) return;
		this.#offline = offline;
		for (const listener of [...this.#listeners]) listener(offline);
	}

	/**
	 * Starts watching: the events of the window ask the server while offline (the event "offline"
	 * of the browser also when online). Returns the cleanup; the state stays as it was.
	 */
	start(win: Window | null): () => void {
		this.#watching += 1;
		const recheck = () => {
			if (this.#offline) void this.check();
		};
		const onvisibility = () => {
			if (win?.document.visibilityState === 'visible') recheck();
		};
		const always = () => void this.check();
		win?.addEventListener('online', always);
		win?.addEventListener('offline', always);
		win?.addEventListener('focus', recheck);
		win?.document.addEventListener('visibilitychange', onvisibility);
		return () => {
			win?.removeEventListener('online', always);
			win?.removeEventListener('offline', always);
			win?.removeEventListener('focus', recheck);
			win?.document.removeEventListener('visibilitychange', onvisibility);
			this.#watching -= 1;
			if (this.#watching === 0) {
				this.#timers.clear(this.#timer);
				this.#timer = null;
			}
		};
	}
}

let shared: ConnectivityStore | undefined;

/** The monitor of the app, created on first use; it watches only once the outbox starts it. */
export function getConnectivity(): ConnectivityStore {
	shared ??= new ConnectivityStore(
		healthProbe(
			(...args) => fetch(...args),
			() => pb.authStore.token
		)
	);
	return shared;
}
