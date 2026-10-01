// Tickets of the trash that wait for a decision (ADR-0047, ADR-0035): their retention ran out, but
// the daily run keeps them while they are blocked. When the app opens and when it is opened again,
// one quiet info flag with "Ansehen", only while there are such tickets; any failure means no flag.

import { waitingText } from '$lib/domain/trash';
import type { FlagSink } from './flags.svelte';

export interface TrashAttentionDeps {
	/** How many tickets wait for a decision now (0 on any failure). */
	waiting(): Promise<number>;
	flags: FlagSink;
	/** Opens the trash. */
	open(): void;
}

export class TrashAttention {
	readonly #deps: TrashAttentionDeps;
	#flag: string | null = null;

	constructor(deps: TrashAttentionDeps) {
		this.#deps = deps;
	}

	/** Asks and shows the flag (one at a time) while tickets wait for a decision. */
	async announce(): Promise<void> {
		const count = await this.#deps.waiting().catch(() => 0);
		if (count === 0) return;
		const { flags } = this.#deps;
		if (this.#flag !== null) flags.dismiss(this.#flag);
		const id = flags.show({
			tone: 'info',
			title: waitingText(count),
			action: { label: 'Ansehen', run: () => this.#deps.open() },
			onclose: () => {
				if (this.#flag === id) this.#flag = null;
			}
		});
		this.#flag = id;
	}
}
