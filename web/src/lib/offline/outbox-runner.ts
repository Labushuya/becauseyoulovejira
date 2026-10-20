// The worker of the outbox (OF-2, ADR-0074 addendum OF-2; concept OF-0 §3.6 and §3.9): it sends one
// action after another, but only in the tab that holds the lease of the device, so two tabs never
// send the same action at the same time (the identifier makes a second time harmless anyway). The
// lease lasts 8 s and is renewed every 3 s while there is work; a tab that dies or freezes loses it,
// and another one takes over. What one step does, the outbox decides (`step`); here are only the
// loop, the lease and the waking up.

import { LEASE_MS, LEASE_RENEW_MS } from '$lib/domain/offline';
import type { Timers } from './connectivity.svelte';
import type { OutboxStorage } from './outbox-storage';

export interface RunnerDeps {
	storage: OutboxStorage;
	/** The identifier of this tab (sessionStorage). */
	tab: string;
	now: () => number;
	timers: Timers;
	/** Whether there is something to send now and the connection allows it. */
	ready: () => boolean;
	/** Sends the next action; false when the run ends here (no connection, nothing left, signed out). */
	step: () => Promise<boolean>;
	/** The run ended. */
	settled: () => void;
}

export class OutboxRunner {
	readonly #deps: RunnerDeps;
	#running = false;
	#again = false;
	#stopped = false;
	#wake: unknown = null;
	#renew: unknown = null;

	constructor(deps: RunnerDeps) {
		this.#deps = deps;
	}

	/** Whether a run is going on now. */
	get running(): boolean {
		return this.#running;
	}

	/** Starts a run, or another one right after the current one. */
	kick(): void {
		if (this.#stopped) return;
		if (this.#running) {
			this.#again = true;
			return;
		}
		void this.#run();
	}

	/** Starts a run at `at` (ms of the clock), unless one starts earlier. */
	wakeAt(at: number): void {
		if (this.#stopped) return;
		this.#deps.timers.clear(this.#wake);
		this.#wake = this.#deps.timers.set(() => this.kick(), Math.max(0, at - this.#deps.now()));
	}

	/** Ends every timer; a running step still finishes, but no new one starts. */
	stop(): void {
		this.#stopped = true;
		this.#deps.timers.clear(this.#wake);
		this.#deps.timers.clear(this.#renew);
		this.#wake = null;
		this.#renew = null;
		void this.#deps.storage.release(this.#deps.tab).catch(() => undefined);
	}

	async #lease(): Promise<boolean> {
		try {
			return await this.#deps.storage.lease(this.#deps.tab, this.#deps.now(), LEASE_MS);
		} catch {
			return false;
		}
	}

	async #run(): Promise<void> {
		this.#running = true;
		try {
			do {
				this.#again = false;
				while (!this.#stopped && this.#deps.ready()) {
					if (!(await this.#lease())) {
						// Another tab sends; look again once its lease could have run out.
						this.wakeAt(this.#deps.now() + LEASE_MS);
						break;
					}
					this.#keepLease();
					if (!(await this.#deps.step())) break;
				}
			} while (this.#again && !this.#stopped);
		} finally {
			this.#deps.timers.clear(this.#renew);
			this.#renew = null;
			this.#running = false;
			if (!this.#deps.ready()) {
				await this.#deps.storage.release(this.#deps.tab).catch(() => undefined);
			}
			this.#deps.settled();
		}
	}

	/** Renews the lease every 3 s while the run goes on. */
	#keepLease(): void {
		if (this.#renew !== null) return;
		const renew = () => {
			if (!this.#running || this.#stopped) return;
			void this.#lease();
			this.#renew = this.#deps.timers.set(renew, LEASE_RENEW_MS);
		};
		this.#renew = this.#deps.timers.set(renew, LEASE_RENEW_MS);
	}
}
