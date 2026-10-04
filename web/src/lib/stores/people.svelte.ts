// Names of the accounts for comments, history and the trash (ADR-0056 §4): the (app) layout loads ID
// and name of every visible account once per session (the own one, the members of the own
// households, every account for the administrator) and follows new names through realtime; after a
// reconnection or a subscription that failed first it loads again (ADR-0007 section 3). Outside the
// layout (tests of single components) there is none; persons then stay "Anderes Konto".

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { listPersonNames, subscribePersonNames } from '$lib/data/people';
import { onReconnect, type RecordChange, type Unsubscribe } from '$lib/data/realtime';
import type { PersonName, PersonNames } from '$lib/domain/people';
import { hold, type HoldOptions } from './realtime';
import type { SessionGuard } from './ticket-list.svelte';

export interface PeopleData {
	list(options: RequestOptions): Promise<PersonName[]>;
	subscribe(onChange: (change: RecordChange<PersonName>) => void): Promise<Unsubscribe>;
	/** Called after a new connection that follows an interrupted one. */
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function peopleData(pb: PocketBase): PeopleData {
	return {
		list: (options) => listPersonNames(pb, options),
		subscribe: (onChange) => subscribePersonNames(pb, onChange),
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

export class PeopleStore implements PersonNames {
	readonly #data: PeopleData;
	readonly #session: SessionGuard;
	readonly #hold: HoldOptions;
	readonly #names = new SvelteMap<string, string>();
	#controller: AbortController | null = null;

	constructor(data: PeopleData, session: SessionGuard, hold: HoldOptions = {}) {
		this.#data = data;
		this.#session = session;
		this.#hold = hold;
	}

	/** Name of a visible account; null for an unknown one, one without a name or before loading. */
	nameOf(id: string): string | null {
		const name = this.#names.get(id);
		return name === undefined || name === '' ? null : name;
	}

	/**
	 * Loads every visible name; a second call replaces a running one. A failure leaves the names as
	 * they were: persons then stay "Anderes Konto".
	 */
	async load(): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		try {
			const names = await this.#data.list({ signal: controller.signal });
			this.#names.clear();
			for (const entry of names) this.#names.set(entry.id, entry.name);
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

	#apply(change: RecordChange<PersonName>): void {
		if (change.action === 'delete') this.#names.delete(change.id);
		else this.#names.set(change.record.id, change.record.name);
	}
}

const [getPeople, setPeople, hasPeople] = createContext<PeopleStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findPeople(): PeopleStore | null {
	return hasPeople() ? getPeople() : null;
}

export { setPeople };
