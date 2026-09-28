// Access keys of the own inbox on the page "Kanäle" (ADR-0038; plan eigener-eingang-whatsapp-web,
// EI-1; ADR-0006). Loaded when the page opens and gone with it. A new key in plain text never
// lands here: `create` hands it to the caller, which shows it once and forgets it.

import type PocketBase from 'pocketbase';
import { createInboxKey, listInboxKeys, revokeInboxKey } from '$lib/data/inbox-keys';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { CreatedInboxKey, InboxKey } from '$lib/domain/inbox-keys';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface InboxKeysData {
	list(options: RequestOptions): Promise<InboxKey[] | null>;
	create(name: string): Promise<CreatedInboxKey>;
	revoke(id: string): Promise<void>;
}

export function inboxKeysData(pb: PocketBase): InboxKeysData {
	return {
		list: (options) => listInboxKeys(pb, options),
		create: (name) => createInboxKey(pb, name),
		revoke: (id) => revokeInboxKey(pb, id)
	};
}

export type InboxKeysState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export class InboxKeysStore {
	readonly #data: InboxKeysData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	#controller: AbortController | null = null;

	#state = $state<InboxKeysState>('idle');
	#error = $state<string | null>(null);
	#keys = $state<InboxKey[]>([]);

	constructor(data: InboxKeysData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	get state(): InboxKeysState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	get keys(): readonly InboxKey[] {
		return this.#keys;
	}

	async load(): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		if (this.#state !== 'ready') this.#state = 'loading';
		try {
			const keys = await this.#data.list({ signal: controller.signal });
			if (keys === null) {
				this.#state = 'unavailable';
				return;
			}
			this.#keys = keys;
			this.#state = 'ready';
			this.#error = null;
		} catch (error) {
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			this.#state = 'error';
			this.#error = failure.message;
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/**
	 * Creates a key; answers { key } with the key in plain text (for the caller only) or { error }
	 * with the text for the field. The list gets the key without its plain text.
	 */
	async create(name: string): Promise<{ key: CreatedInboxKey } | { error: string } | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			const key = await this.#data.create(name);
			const listed: InboxKey = {
				id: key.id,
				name: key.name,
				tokenHint: key.tokenHint,
				created: key.created,
				lastUsedAt: key.lastUsedAt
			};
			this.#keys = [listed, ...this.#keys.filter((entry) => entry.id !== key.id)];
			if (this.#state !== 'ready') this.#state = 'ready';
			return { key };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			const field = failure.fields.name;
			return { error: field?.message ?? failure.message };
		}
	}

	/** Revokes a key; answers null or the text of the failure. */
	async revoke(key: InboxKey): Promise<string | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			await this.#data.revoke(key.id);
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			if (failure.kind !== 'not_found') return failure.message;
		}
		this.#keys = this.#keys.filter((entry) => entry.id !== key.id);
		this.#flags.show({ tone: 'success', title: `Zugangsschlüssel „${key.name}“ widerrufen.` });
		return null;
	}

	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#state = 'idle';
		this.#error = null;
		this.#keys = [];
	}
}
