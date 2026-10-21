// Where the outbox keeps its actions on the device (OF-2, ADR-0074 addendum OF-2; concept OF-0
// §3.2 and §5): IndexedDB "byl-offline", because it has transactions (the lease of the tabs and the
// running number) and more room than localStorage. A small wrapper of its own, no dependency;
// MemoryOutboxStorage stands in for it in the tests (jsdom has no IndexedDB). Kept are only the
// actions themselves, never a copy of a ticket, a list or a plan.
//
// - Store "actions", key `op`; indexes byUserSeq [user, seq] and byTarget [user, target].
// - Store "meta": `seq` (running number of the device), `lease` ({ tab, until }) and, since OF-3c,
//   `notices:<account>` (the notices of the outbox of one account, domain/offline-notices.ts). A new key
//   in an existing store: the version of the database stays 1, an older build never reads it.
// - Deleting goes by key, never with deleteDatabase (that blocks while another tab has it open).

import type { KeptAction } from '$lib/domain/offline';

export const OUTBOX_DATABASE = 'byl-offline';
const VERSION = 1;
const ACTIONS = 'actions';
const META = 'meta';

/** What the outbox needs of its storage; every call is one transaction. */
export interface OutboxStorage {
	/** Every stored entry of every account, unread (the outbox checks each one). */
	list(): Promise<unknown[]>;
	put(action: KeptAction): Promise<void>;
	remove(ops: readonly string[]): Promise<void>;
	/**
	 * Compare-and-swap of one entry over the tabs (OF-2b): in one transaction, when `matches` holds
	 * for the stored entry of `op` (undefined without one), writes `next`, or deletes the entry for
	 * null. True when it wrote. Marking an action as sent and taking a change into it go through
	 * here, so neither overwrites the other.
	 */
	swap(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null
	): Promise<boolean>;
	/**
	 * Compare-and-swap of one entry like `swap`; when it writes, the notices of `user` change with it in
	 * the same transaction (`note` on them as stored, null leaves them; OF-3c), so the deletion after
	 * 7 days never deletes an action without its notice, nor writes a notice without the deletion.
	 */
	swapNoting(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null,
		user: string,
		note: (current: unknown) => unknown[] | null
	): Promise<boolean>;
	/**
	 * The notices of `user` as stored, unread (OF-3c); undefined without any. With `change`, in one
	 * transaction: it gets them as stored and returns what to keep instead (an empty list deletes them),
	 * null to leave them; the result is what the device holds afterwards.
	 */
	notices(user: string, change?: (current: unknown) => unknown[] | null): Promise<unknown>;
	/** The next number of the order on this device. */
	nextSeq(): Promise<number>;
	/**
	 * Takes or renews the lease of `tab` until `now + ms` when it is free, ran out or is its own;
	 * true while `tab` holds it. IndexedDB runs transactions of one store one after another, so this
	 * is the compare-and-swap the tabs need without Web Locks (no secure context, concept §3.9).
	 */
	lease(tab: string, now: number, ms: number): Promise<boolean>;
	/** Gives the lease up, if `tab` holds it. */
	release(tab: string): Promise<void>;
}

interface Lease {
	tab: string;
	until: number;
}

function isLease(value: unknown): value is Lease {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as Lease).tab === 'string' &&
		typeof (value as Lease).until === 'number'
	);
}

/** The rule of the lease: free, ran out or the own one. */
export function mayLease(current: unknown, tab: string, now: number): boolean {
	return !isLease(current) || current.tab === tab || current.until <= now;
}

/** The key of the notices of an account in the store "meta" (OF-3c). */
export function noticesKey(user: string): string {
	return `notices:${user}`;
}

/** The storage of the tests: one instance stands for one device, several outboxes may share it. */
export class MemoryOutboxStorage implements OutboxStorage {
	readonly entries = new Map<string, unknown>();
	/** The notices per account (OF-3c), as the store "meta" keeps them. */
	readonly notes = new Map<string, unknown>();
	#seq = 0;
	#lease: Lease | null = null;

	async list(): Promise<unknown[]> {
		return [...this.entries.values()].map((entry) => structuredClone(entry));
	}

	async put(action: KeptAction): Promise<void> {
		this.entries.set(action.op, structuredClone(action));
	}

	async remove(ops: readonly string[]): Promise<void> {
		for (const op of ops) this.entries.delete(op);
	}

	async swap(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null
	): Promise<boolean> {
		const current = this.entries.get(op);
		if (!matches(current === undefined ? undefined : structuredClone(current))) return false;
		if (next === null) this.entries.delete(op);
		else this.entries.set(op, structuredClone(next));
		return true;
	}

	async swapNoting(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null,
		user: string,
		note: (current: unknown) => unknown[] | null
	): Promise<boolean> {
		const current = this.entries.get(op);
		if (!matches(current === undefined ? undefined : structuredClone(current))) return false;
		const notes = note(structuredClone(this.notes.get(user)));
		if (next === null) this.entries.delete(op);
		else this.entries.set(op, structuredClone(next));
		if (notes !== null) this.#keep(user, notes);
		return true;
	}

	async notices(user: string, change?: (current: unknown) => unknown[] | null): Promise<unknown> {
		if (change !== undefined) {
			const next = change(structuredClone(this.notes.get(user)));
			if (next !== null) this.#keep(user, next);
		}
		return structuredClone(this.notes.get(user));
	}

	#keep(user: string, notes: unknown[]): void {
		if (notes.length === 0) this.notes.delete(user);
		else this.notes.set(user, structuredClone(notes));
	}

	async nextSeq(): Promise<number> {
		this.#seq += 1;
		return this.#seq;
	}

	async lease(tab: string, now: number, ms: number): Promise<boolean> {
		if (!mayLease(this.#lease, tab, now)) return false;
		this.#lease = { tab, until: now + ms };
		return true;
	}

	async release(tab: string): Promise<void> {
		if (this.#lease?.tab === tab) this.#lease = null;
	}

	/** Who holds the lease now (tests). */
	get holder(): string | null {
		return this.#lease?.tab ?? null;
	}
}

function done<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function finished(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

/** Writes the notices of an account in the store "meta", deletes the key for none (OF-3c). */
function keep(meta: IDBObjectStore, key: string, notes: unknown[]): void {
	if (notes.length === 0) meta.delete(key);
	else meta.put(notes, key);
}

/** IndexedDB of the browser. The database opens on first use, so a device without the outbox has none. */
export class IdbOutboxStorage implements OutboxStorage {
	readonly #factory: IDBFactory;
	#db: Promise<IDBDatabase> | null = null;

	constructor(factory: IDBFactory) {
		this.#factory = factory;
	}

	#open(): Promise<IDBDatabase> {
		this.#db ??= new Promise<IDBDatabase>((resolve, reject) => {
			const request = this.#factory.open(OUTBOX_DATABASE, VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(ACTIONS)) {
					const actions = db.createObjectStore(ACTIONS, { keyPath: 'op' });
					actions.createIndex('byUserSeq', ['user', 'seq']);
					actions.createIndex('byTarget', ['user', 'target']);
				}
				if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
			};
			request.onsuccess = () => {
				const db = request.result;
				// Another tab of a newer build asks for a new version: this one steps aside.
				db.onversionchange = () => {
					db.close();
					this.#db = null;
				};
				resolve(db);
			};
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error('The outbox of the device is blocked.'));
		}).catch((error: unknown) => {
			this.#db = null;
			throw error;
		});
		return this.#db;
	}

	async list(): Promise<unknown[]> {
		const db = await this.#open();
		return done(db.transaction(ACTIONS, 'readonly').objectStore(ACTIONS).getAll());
	}

	async put(action: KeptAction): Promise<void> {
		const db = await this.#open();
		const transaction = db.transaction(ACTIONS, 'readwrite');
		transaction.objectStore(ACTIONS).put(action);
		await finished(transaction);
	}

	async remove(ops: readonly string[]): Promise<void> {
		if (ops.length === 0) return;
		const db = await this.#open();
		const transaction = db.transaction(ACTIONS, 'readwrite');
		const store = transaction.objectStore(ACTIONS);
		for (const op of ops) store.delete(op);
		await finished(transaction);
	}

	async swap(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null
	): Promise<boolean> {
		const db = await this.#open();
		const transaction = db.transaction(ACTIONS, 'readwrite');
		const store = transaction.objectStore(ACTIONS);
		const current: unknown = await done(store.get(op));
		const take = matches(current);
		if (take && next === null) store.delete(op);
		else if (take && next !== null) store.put(next);
		await finished(transaction);
		return take;
	}

	async swapNoting(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null,
		user: string,
		note: (current: unknown) => unknown[] | null
	): Promise<boolean> {
		const db = await this.#open();
		// Both stores in one transaction: the action and its notice change together or not at all.
		const transaction = db.transaction([ACTIONS, META], 'readwrite');
		const store = transaction.objectStore(ACTIONS);
		const meta = transaction.objectStore(META);
		const key = noticesKey(user);
		const [current, notes] = await Promise.all([done(store.get(op)), done(meta.get(key))]);
		const take = matches(current);
		if (take) {
			// The notice first: should it throw, nothing is written and the transaction ends empty.
			const noted = note(notes);
			if (next === null) store.delete(op);
			else store.put(next);
			if (noted !== null) keep(meta, key, noted);
		}
		await finished(transaction);
		return take;
	}

	async notices(user: string, change?: (current: unknown) => unknown[] | null): Promise<unknown> {
		const db = await this.#open();
		const transaction = db.transaction(META, change === undefined ? 'readonly' : 'readwrite');
		const meta = transaction.objectStore(META);
		const key = noticesKey(user);
		let notes: unknown = await done(meta.get(key));
		const next = change?.(notes) ?? null;
		if (next !== null) {
			keep(meta, key, next);
			notes = next.length === 0 ? undefined : next;
		}
		await finished(transaction);
		return notes;
	}

	async nextSeq(): Promise<number> {
		const db = await this.#open();
		const transaction = db.transaction(META, 'readwrite');
		const store = transaction.objectStore(META);
		const current = await done(store.get('seq'));
		const next = (typeof current === 'number' ? current : 0) + 1;
		store.put(next, 'seq');
		await finished(transaction);
		return next;
	}

	async lease(tab: string, now: number, ms: number): Promise<boolean> {
		const db = await this.#open();
		const transaction = db.transaction(META, 'readwrite');
		const store = transaction.objectStore(META);
		const current: unknown = await done(store.get('lease'));
		const take = mayLease(current, tab, now);
		if (take) store.put({ tab, until: now + ms } satisfies Lease, 'lease');
		await finished(transaction);
		return take;
	}

	async release(tab: string): Promise<void> {
		const db = await this.#open();
		const transaction = db.transaction(META, 'readwrite');
		const store = transaction.objectStore(META);
		const current: unknown = await done(store.get('lease'));
		if (isLease(current) && current.tab === tab) store.delete('lease');
		await finished(transaction);
	}
}

/**
 * Whether this browser already has the database of the outbox, without creating it
 * (`indexedDB.databases()`); false where the browser cannot say.
 */
export async function hasOutboxDatabase(factory: IDBFactory | undefined): Promise<boolean> {
	if (factory === undefined || typeof factory.databases !== 'function') return false;
	try {
		return (await factory.databases()).some((info) => info.name === OUTBOX_DATABASE);
	} catch {
		return false;
	}
}
