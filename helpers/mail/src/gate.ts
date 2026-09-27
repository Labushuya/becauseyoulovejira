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
