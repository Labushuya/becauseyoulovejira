// Names of the connections for the inbox and the sources of a ticket (ADR-0026, addendum KK-3;
// ADR-0016, addendum of 2026-10-01): the (app) layout loads ID and name of every visible
// connection once per session and follows renames, new and deleted connections through realtime,
// so a renamed channel shows its new name at once wherever an entry names its connection. After a
// reconnection or a subscription that failed first, it loads again (ADR-0007 section 3). Outside
// the layout (tests of single components) there is none; entries then name their channel only.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { listConnectionNames, subscribeConnectionNames } from '$lib/data/connections';
import { onReconnect, type RecordChange, type Unsubscribe } from '$lib/data/realtime';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { ConnectionName } from '$lib/domain/connections';
import { hold, type HoldOptions } from './realtime';
import type { SessionGuard } from './ticket-list.svelte';

export interface ConnectionNamesData {
	list(options: RequestOptions): Promise<ConnectionName[]>;
	subscribe(onChange: (change: RecordChange<ConnectionName>) => void): Promise<Unsubscribe>;
	/** Called after a new connection that follows an interrupted one. */
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function connectionNamesData(pb: PocketBase): ConnectionNamesData {
	return {
		list: (options) => listConnectionNames(pb, options),
		subscribe: (onChange) => subscribeConnectionNames(pb, onChange),
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

export class ConnectionNamesStore {
	readonly #data: ConnectionNamesData;
	readonly #session: SessionGuard;
	readonly #hold: HoldOptions;
	readonly #names = new SvelteMap<string, string>();
	#controller: AbortController | null = null;

	constructor(data: ConnectionNamesData, session: SessionGuard, hold: HoldOptions = {}) {
		this.#data = data;
		this.#session = session;
		this.#hold = hold;
	}

	/** Name of a connection; null without one, for a deleted one or before the names are loaded. */
	nameOf(id: string | null | undefined): string | null {
		if (id === null || id === undefined || id === '') return null;
		return this.#names.get(id) ?? null;
	}

	/**
	 * Loads every name; a second call replaces a running one. A failure (before the migration of the
	 * connections, a passing error) leaves the names as they were: entries then name their channel.
	 */
	async load(): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		try {
			const names = await this.#data.list({ signal: controller.signal });
			this.#names.clear();
			for (const entry of names) this.#names.set(entry.id, entry.label);
		} catch (error) {
			if (toDataError(error, controller.signal).kind === 'session') this.#session.logout();
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/** Loads and follows the names; the cleanup ends the subscriptions and empties the store. */
	start(): () => void {
		void this.load();
		const stopLive = hold((guard) => this.#data.subscribe(guard((change) => this.#apply(change))), {
			...this.#hold,
			recovered: () => void this.load()
		});
		const stopReconnect = hold(
			(guard) => this.#data.reconnected(guard(() => void this.load())),
			this.#hold
		);
		return () => {
			stopLive();
			stopReconnect();
			this.#controller?.abort();
			this.#controller = null;
			this.#names.clear();
		};
	}

	#apply(change: RecordChange<ConnectionName>): void {
		if (change.action === 'delete') this.#names.delete(change.id);
		else this.#names.set(change.record.id, change.record.label);
	}
}

const [getConnectionNames, setConnectionNames, hasConnectionNames] =
	createContext<ConnectionNamesStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findConnectionNames(): ConnectionNamesStore | null {
	return hasConnectionNames() ? getConnectionNames() : null;
}

export { setConnectionNames };
