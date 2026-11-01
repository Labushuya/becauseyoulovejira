// Open setups of the account outside the page "Kanäle" (KE-1, ADR-0076 §2): the mark at "Kanäle"
// in the navigation of the settings and in "Mehr", and the facts of the quiet hint when the app
// opens (open-setups-attention.ts). One store per (app) layout. It loads only on the occasions the
// layout already has: the sign-in, the app opened again, the tab coming back (at most once a
// minute) and a change of the area; never in a rhythm (no polling, CLAUDE.md §7). The page "Kanäle"
// hands over what it computed from its own, fresher stores (`adopt`), so the mark follows a setup
// done there. Only the own connections of the account (their list follows the area: in a household
// there are none, ADR-0059 §5), never a value: names of variables at most.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { getSecretStatus, listConnections } from '$lib/data/connections';
import { toDataError } from '$lib/data/errors';
import { fetchExtensionInfo } from '$lib/data/extension';
import { listInboxKeys } from '$lib/data/inbox-keys';
import type { RequestOptions } from '$lib/data/options';
import { usesSecret, type Connection, type SecretStatus } from '$lib/domain/connections';
import type { InboxKey } from '$lib/domain/inbox-keys';
import { openSetupsOf, type OpenSetupEntry } from '$lib/domain/open-setups';
import type { SessionGuard } from './ticket-list.svelte';

export interface OpenSetupsData {
	list(options: RequestOptions): Promise<Connection[]>;
	secretStatus(id: string, options: RequestOptions): Promise<SecretStatus>;
	/** null before the migration of the own inbox. */
	inboxKeys(options: RequestOptions): Promise<InboxKey[] | null>;
	/** Whether the extension for WhatsApp Web is built; null while unknown. */
	extensionBuilt(options: RequestOptions): Promise<boolean | null>;
}

export function openSetupsData(pb: PocketBase): OpenSetupsData {
	return {
		list: (options) => listConnections(pb, options),
		secretStatus: (id, options) => getSecretStatus(pb, id, options),
		inboxKeys: (options) => listInboxKeys(pb, options),
		extensionBuilt: async (options) => (await fetchExtensionInfo(pb, options))?.built ?? null
	};
}

export type OpenSetupsState = 'idle' | 'loading' | 'ready' | 'error';

/** The tab came back: at most one load in this time. */
export const REFRESH_GAP_MS = 60_000;

export class OpenSetupsStore {
	readonly #data: OpenSetupsData;
	readonly #session: SessionGuard;
	/** The tab shows the household area, where connections and the own inbox are not offered. */
	readonly #household: () => boolean;
	readonly #now: () => number;
	#controller: AbortController | null = null;
	#loadedAt = Number.NEGATIVE_INFINITY;

	#state = $state<OpenSetupsState>('idle');
	#entries = $state.raw<readonly OpenSetupEntry[]>([]);

	constructor(
		data: OpenSetupsData,
		session: SessionGuard,
		household: () => boolean = () => false,
		now: () => number = () => Date.now()
	) {
		this.#data = data;
		this.#session = session;
		this.#household = household;
		this.#now = now;
	}

	get state(): OpenSetupsState {
		return this.#state;
	}

	/** The open setups; empty while unknown or after a failure. */
	get entries(): readonly OpenSetupEntry[] {
		return this.#entries;
	}

	/** Number for the mark; 0 also while unknown, so nothing is claimed. */
	get count(): number {
		return this.#state === 'ready' ? this.#entries.length : 0;
	}

	/**
	 * Loads the connections, the state of their variables, the keys of the own inbox and whether the
	 * extension is built, and resolves to the open setups; null on any failure (also a refusal), when
	 * the session ended or a newer load replaced this one.
	 */
	async load(): Promise<readonly OpenSetupEntry[] | null> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return null;
		const controller = new AbortController();
		this.#controller = controller;
		const options = { signal: controller.signal };
		if (this.#state !== 'ready') this.#state = 'loading';
		try {
			if (this.#household()) return this.#take(controller, []);
			const [connections, keys] = await Promise.all([
				this.#data.list(options),
				this.#data.inboxKeys(options)
			]);
			const pairs = await Promise.all(
				connections
					.filter((connection) => usesSecret(connection.type))
					.map(
						async (connection) =>
							[connection.id, await this.#data.secretStatus(connection.id, options)] as const
					)
			);
			const statuses: Readonly<Record<string, SecretStatus>> = Object.fromEntries(pairs);
			const built =
				keys !== null && keys.length > 0 ? await this.#data.extensionBuilt(options) : null;
			const entries = openSetupsOf({
				connections,
				status: (id) => statuses[id] ?? null,
				keys,
				extensionBuilt: built
			});
			return this.#take(controller, entries);
		} catch (error) {
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'aborted' || this.#controller !== controller) return null;
			this.#controller = null;
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			this.#state = 'error';
			this.#entries = [];
			return null;
		}
	}

	#take(
		controller: AbortController,
		entries: readonly OpenSetupEntry[]
	): readonly OpenSetupEntry[] | null {
		if (this.#controller !== controller || controller.signal.aborted) return null;
		this.#controller = null;
		this.#entries = entries;
		this.#state = 'ready';
		this.#loadedAt = this.#now();
		return entries;
	}

	/** The tab came back: loads again unless a load finished within REFRESH_GAP_MS. */
	async refresh(): Promise<void> {
		if (this.#controller !== null || this.#now() - this.#loadedAt < REFRESH_GAP_MS) return;
		await this.load();
	}

	/** The page "Kanäle" computed the open setups from its own stores (ADR-0076 §2). */
	adopt(entries: readonly OpenSetupEntry[]): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#entries = entries;
		this.#state = 'ready';
		this.#loadedAt = this.#now();
	}

	/** The area changed: forget the old one and load the new one. */
	rescope(): void {
		this.reset();
		void this.load();
	}

	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#entries = [];
		this.#state = 'idle';
		this.#loadedAt = Number.NEGATIVE_INFINITY;
	}
}

const [getOpenSetupsStore, setOpenSetupsStore, hasOpenSetupsStore] =
	createContext<OpenSetupsStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findOpenSetupsStore(): OpenSetupsStore | null {
	return hasOpenSetupsStore() ? getOpenSetupsStore() : null;
}

export { getOpenSetupsStore, setOpenSetupsStore };
