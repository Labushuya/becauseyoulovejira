// One fetch at a time (testing feedback package A, item 4): the interval loop and "Jetzt abrufen"
// of the local interface share the cursor of a connection, so they must not run at once. The loop
// waits for a running manual fetch; a manual fetch does not wait for the loop, it answers "running"
// at once (the hook would otherwise hold the request for minutes).

export class PollGate {
	#tail: Promise<void> = Promise.resolve();
	/** Tasks that run or wait. */
	#holders = 0;

	/** True while a task runs or waits. */
	get busy(): boolean {
		return this.#holders > 0;
	}

	/** Runs `task` after the tasks before it. */
	async run<T>(task: () => Promise<T>): Promise<T> {
		this.#holders += 1;
		const previous = this.#tail;
		let release: () => void = () => undefined;
		this.#tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		try {
			await previous;
			return await task();
		} finally {
			this.#holders -= 1;
			release();
		}
	}

	/** Runs `task` at once and resolves `{ value }`, or resolves null while another task holds the gate. */
	async tryRun<T>(task: () => Promise<T>): Promise<{ value: T } | null> {
		if (this.#holders > 0) return null;
		return { value: await this.run(task) };
	}
}

/**
 * Which connections are being fetched or scanned right now, and which scans the user cancelled
 * ("Abbrechen" on the card, ADR-0020 addendum 3). A cancel request only counts while the connection
 * is active; it ends with the run.
 */
export class ScanControl {
	#active = new Set<string>();
	#cancelled = new Set<string>();

	begin(id: string): void {
		this.#active.add(id);
	}

	end(id: string): void {
		this.#active.delete(id);
		this.#cancelled.delete(id);
	}

	isActive(id: string): boolean {
		return this.#active.has(id);
	}

	/** Asks the running scan of `id` to stop at the next mail; false when none is active. */
	requestCancel(id: string): boolean {
		if (!this.#active.has(id)) return false;
		this.#cancelled.add(id);
		return true;
	}

	isCancelled(id: string): boolean {
		return this.#cancelled.has(id);
	}
}
