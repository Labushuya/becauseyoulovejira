// Open setups that need attention (KE-1, ADR-0076 §3, ADR-0035): when the app opens and when it is
// opened again, one quiet info flag „N Einrichtungen sind offen.“ with "Ansehen" (page "Kanäle").
// Once per device and state: the fingerprint of the open setups (`openSetupsFingerprint`) is
// remembered in localStorage; a new state (another setup, another open step) shows it again. No
// flag after a failure (also a refusal, 403), without a connection, without open setups, and never
// in place of another flag: with MAX_FLAGS shown it waits for the next occasion (it would push out
// the oldest, e.g. a hint of the outbox, ADR-0074). Nothing is remembered then.

import {
	OPEN_SETUP_TEXTS,
	namesText,
	openSetupsFingerprint,
	type OpenSetupEntry
} from '$lib/domain/open-setups';
import type { FlagSink } from './flags.svelte';

/** localStorage: the fingerprint of the open setups the flag already named on this device. */
export const SEEN_KEY = 'byl-open-setups-seen';

export interface OpenSetupsAttentionDeps {
	/** The open setups now; null on any failure (OpenSetupsStore.load). */
	load(): Promise<readonly OpenSetupEntry[] | null>;
	/** The signed-in account; null without one. */
	account(): string | null;
	flags: FlagSink;
	/** Opens the page "Kanäle". */
	open(): void;
	/** The tab has no connection to the server (the outbox or the browser says so). */
	offline(): boolean;
	/** A further flag would push out none that is shown. */
	room(): boolean;
	storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

function storageOf(deps: OpenSetupsAttentionDeps): Pick<Storage, 'getItem' | 'setItem'> | null {
	if (deps.storage !== undefined) return deps.storage;
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export class OpenSetupsAttention {
	readonly #deps: OpenSetupsAttentionDeps;
	#flag: string | null = null;

	constructor(deps: OpenSetupsAttentionDeps) {
		this.#deps = deps;
	}

	/** Asks and shows the flag (one at a time) for a state of open setups not named on this device. */
	async announce(): Promise<void> {
		const { flags } = this.#deps;
		if (this.#deps.offline()) return;
		const entries = await this.#deps.load();
		const account = this.#deps.account();
		if (entries === null || entries.length === 0 || account === null || this.#deps.offline()) {
			return;
		}
		const fingerprint = openSetupsFingerprint(account, entries);
		const storage = storageOf(this.#deps);
		let seen: string | null;
		try {
			seen = storage?.getItem(SEEN_KEY) ?? null;
		} catch {
			seen = null;
		}
		if (seen === fingerprint) return;
		if (this.#flag !== null) flags.dismiss(this.#flag);
		if (!this.#deps.room()) return;
		try {
			storage?.setItem(SEEN_KEY, fingerprint);
		} catch {
			// Without storage the flag may come again at the next start; nothing else breaks.
		}
		const id = flags.show({
			tone: 'info',
			title: OPEN_SETUP_TEXTS.flagTitle(entries.length),
			description: namesText(entries.map((entry) => entry.name)),
			action: { label: OPEN_SETUP_TEXTS.look, run: () => this.#deps.open() },
			onclose: () => {
				if (this.#flag === id) this.#flag = null;
			}
		});
		this.#flag = id;
	}
}
