// State of the inbox (E4 plan, T-4 and package 2; ADR-0014; ADR-0006 and ADR-0007). One store
// per app layout: every new entry is loaded in full (like the open tickets), converted and
// discarded entries page by page from the server (like the done tickets). Own answers and
// realtime events go through the same idempotent `upsert` and `remove`; after a reconnection the
// store reconciles once. A duplicate answer of the server is an outcome, not an error.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import {
	assignToTicket,
	createItem,
	discardItem,
	getItem,
	listHandledItems,
	listNewItems,
	restoreItem,
	type CreateItemOutcome,
	type HandledItemPage
} from '$lib/data/inbox';
import type { RequestOptions } from '$lib/data/options';
import {
	compareHandled,
	compareNewest,
	findSoftDuplicates,
	type HandledState,
	type InboxDraft,
	type InboxDuplicate,
	type InboxItem,
	type InboxItemSummary,
	type SoftDuplicates
} from '$lib/domain/inbox';
import type { TicketSummary } from '$lib/domain/ticket';
import { hold, type LiveSource } from './realtime';
import type { LoadState, SessionGuard } from './ticket-list.svelte';

/**
 * Shown while the server does not know the inbox yet: the migration of E4 runs at the next start
 * of the app (docs/plan/e4.md, section 7).
 */
export const INBOX_UNAVAILABLE_MESSAGE =
	'Der Eingang steht nach dem nächsten Start der App bereit (start.bat).';

/** Data access of the inbox; tests pass a fake, the app binds the data layer to its client. */
export interface InboxData {
	listNew(options: RequestOptions): Promise<InboxItemSummary[]>;
	listHandled(state: HandledState, page: number, options: RequestOptions): Promise<HandledItemPage>;
	get(id: string, options: RequestOptions): Promise<InboxItem>;
	create(draft: InboxDraft): Promise<CreateItemOutcome>;
	discard(id: string): Promise<InboxItemSummary>;
	restore(id: string): Promise<InboxItemSummary>;
	assign(id: string, ticketId: string): Promise<InboxItemSummary>;
}

export function inboxData(pb: PocketBase): InboxData {
	return {
		listNew: (options) => listNewItems(pb, options),
		listHandled: (state, page, options) => listHandledItems(pb, state, page, options),
		get: (id, options) => getItem(pb, id, options),
		create: (draft) => createItem(pb, draft),
		discard: (id) => discardItem(pb, id),
		restore: (id) => restoreItem(pb, id),
		assign: (id, ticketId) => assignToTicket(pb, id, ticketId)
	};
}

/** Outcome of creating an entry: created, already there, or failed (message and field texts). */
export type InboxCreateResult =
	| { kind: 'created'; item: InboxItem }
	| InboxDuplicate
	| { kind: 'error'; message: string | null; fields: Readonly<Record<string, string>> };

/** Outcome of discarding, restoring and assigning; a failure carries a message unless hidden. */
export type InboxActionResult =
	{ ok: true; item: InboxItemSummary } | { ok: false; message: string | null };

export class InboxStore {
	readonly #data: InboxData;
	readonly #session: SessionGuard;

	readonly #new = new SvelteMap<string, InboxItemSummary>();
	readonly #handled = new SvelteMap<string, InboxItemSummary>();
	/** Deleted IDs: a late event must not bring them back. Record IDs are never reused. */
	readonly #deleted = new SvelteSet<string>();
	/** IDs with a running action (discard, restore, assign). */
	readonly #pending = new SvelteSet<string>();
	/** IDs changed while a load runs: its older snapshot must not remove them. */
	#touched: Set<string> | null = null;

	#newController: AbortController | null = null;
	#handledController: AbortController | null = null;
	#reconcileController: AbortController | null = null;
	#handledPage = 0;

	#state = $state<LoadState>('idle');
	#error = $state<string | null>(null);
	/** Handled entries shown ("Verworfen", "Umgewandelt"), null while only the new ones are shown. */
	#handledState = $state<HandledState | null>(null);
	#handledLoad = $state<LoadState>('idle');
	#handledError = $state<string | null>(null);
	#handledHasMore = $state(false);
	#loadingMoreHandled = $state(false);

	#newList = $derived([...this.#new.values()].sort(compareNewest));
	#handledList = $derived([...this.#handled.values()].sort(compareHandled));

	constructor(data: InboxData, session: SessionGuard) {
		this.#data = data;
		this.#session = session;
	}

	/** Every new entry, newest first. */
	get newItems(): readonly InboxItemSummary[] {
		return this.#newList;
	}

	/** Number of new entries (switch "Eingang", ADR-0015 section 5); null until loaded. */
	get newCount(): number | null {
		return this.#state === 'ready' ? this.#new.size : null;
	}

	get state(): LoadState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/** Loaded handled entries of `handledState`, most recently handled first. */
	get handled(): readonly InboxItemSummary[] {
		return this.#handledList;
	}

	get handledState(): HandledState | null {
		return this.#handledState;
	}

	get handledLoad(): LoadState {
		return this.#handledLoad;
	}

	get handledError(): string | null {
		return this.#handledError;
	}

	get handledHasMore(): boolean {
		return this.#handledHasMore;
	}

	get loadingMoreHandled(): boolean {
		return this.#loadingMoreHandled;
	}

	find(id: string): InboxItemSummary | null {
		return this.#new.get(id) ?? this.#handled.get(id) ?? null;
	}

	isPending(id: string): boolean {
		return this.#pending.has(id);
	}

	/** Possible duplicates of an entry among the open tickets and the other new entries. */
	softDuplicates(
		item: Pick<InboxItemSummary, 'id' | 'title'>,
		openTickets: readonly TicketSummary[]
	): SoftDuplicates {
		return findSoftDuplicates(item, openTickets, this.#newList);
	}

	/** Loads the new entries for the app layout; the returned cleanup empties the store. */
	start(): () => void {
		void this.load();
		return () => this.reset();
	}

	/** Loads the new entries once; a failed load is loaded again. */
	async load(): Promise<void> {
		if (this.#state === 'idle' || this.#state === 'error') await this.#loadNew();
	}

	/** Loads everything shown again ("Erneut versuchen"). */
	async reload(): Promise<void> {
		await Promise.all([
			this.#loadNew(),
			this.#handledState === null ? undefined : this.#loadHandled(1)
		]);
	}

	/**
	 * Shows the converted or discarded entries (first page from the server) or, with null, only the
	 * new ones. The same state again loads nothing.
	 */
	showHandled(state: HandledState | null): void {
		if (state === this.#handledState) return;
		this.#handledController?.abort();
		this.#handledController = null;
		this.#handledState = state;
		this.#handled.clear();
		this.#handledPage = 0;
		this.#handledHasMore = false;
		this.#handledError = null;
		this.#loadingMoreHandled = false;
		this.#handledLoad = 'idle';
		if (state !== null) void this.#loadHandled(1);
	}

	/** Next page of handled entries ("Weitere laden"). */
	async loadMoreHandled(): Promise<void> {
		if (this.#handledState === null || !this.#handledHasMore) return;
		if (this.#handledController !== null) return;
		await this.#loadHandled(this.#handledPage + 1);
	}

	/**
	 * Inserts or replaces an entry (own answer or realtime event). An older `updated` than the
	 * stored one is ignored. A new entry joins the new ones; a handled one leaves them and joins
	 * the loaded handled entries only where the loaded pages cover it.
	 */
	upsert(item: InboxItemSummary): void {
		if (this.#deleted.has(item.id)) return;
		this.#touched?.add(item.id);
		const existing = this.find(item.id);
		if (existing !== null && existing.updated > item.updated) return;
		if (item.state === 'new') {
			this.#handled.delete(item.id);
			this.#new.set(item.id, item);
			return;
		}
		this.#new.delete(item.id);
		if (this.#belongsToHandled(item)) this.#handled.set(item.id, item);
		else this.#handled.delete(item.id);
	}

	remove(id: string): void {
		this.#deleted.add(id);
		this.#touched?.add(id);
		this.#new.delete(id);
		this.#handled.delete(id);
		this.#pending.delete(id);
	}

	/** One entry with its text (panel, prefill of the ticket); it joins the store as well. */
	async fetch(id: string, options: RequestOptions = {}): Promise<InboxItem> {
		const item = await this.#data.get(id, options);
		this.upsert(item);
		return item;
	}

	/**
	 * Loads one entry again, e.g. after a ticket was made from it: the hook converted it, and the
	 * list follows without waiting for the event. Failures are left to the next event.
	 */
	async refresh(id: string): Promise<void> {
		if (!this.#session.ensureValid()) return;
		try {
			await this.fetch(id);
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'not_found') this.remove(id);
			else this.#failureMessage(error);
		}
	}

	/** Creates an entry; a duplicate comes back as outcome with the existing entry's state. */
	async create(draft: InboxDraft): Promise<InboxCreateResult> {
		if (!this.#session.ensureValid()) return { kind: 'error', message: null, fields: {} };
		try {
			const outcome = await this.#data.create(draft);
			if (outcome.kind === 'created') this.upsert(outcome.item);
			return outcome;
		} catch (error) {
			const failure = toDataError(error);
			const fields: Record<string, string> = {};
			for (const [field, detail] of Object.entries(failure.fields)) fields[field] = detail.message;
			const message = this.#failureMessage(error);
			const known = Object.keys(fields).length > 0;
			return { kind: 'error', message: known ? null : message, fields };
		}
	}

	/** "Verwerfen" (ADR-0014 section 4). */
	discard(id: string): Promise<InboxActionResult> {
		return this.#act(id, () => this.#data.discard(id), 'konnte nicht verworfen werden.');
	}

	/** "Wiederherstellen" and "Rückgängig" after discarding. */
	restore(id: string): Promise<InboxActionResult> {
		return this.#act(id, () => this.#data.restore(id), 'konnte nicht wiederhergestellt werden.');
	}

	/** "Dem Ticket zuordnen": the entry counts as converted into the ticket. */
	assign(id: string, ticketId: string): Promise<InboxActionResult> {
		return this.#act(id, () => this.#data.assign(id, ticketId), 'konnte nicht zugeordnet werden.');
	}

	/**
	 * Keeps the inbox live (ADR-0007 sections 2 and 3). Returns the cleanup, which ends the
	 * subscriptions and a running reconciliation.
	 */
	connect(live: LiveSource): () => void {
		const stops = [
			hold(
				live.inbox((change) => {
					if (change.action === 'delete') this.remove(change.id);
					else this.upsert(change.record);
				})
			),
			hold(live.reconnected(() => void this.reconcile()))
		];
		return () => {
			for (const stop of stops) stop();
			this.#reconcileController?.abort();
			this.#reconcileController = null;
		};
	}

	/**
	 * Reconciles after events may have been lost (ADR-0007 section 3): loads the new entries and
	 * the loaded pages of handled entries again and merges them without a loading state. A second
	 * call aborts a running one; an inbox that failed to load is simply loaded again.
	 */
	async reconcile(): Promise<void> {
		this.#reconcileController?.abort();
		this.#reconcileController = null;
		if (this.#state === 'error') {
			await this.reload();
			return;
		}
		if (this.#state !== 'ready' || !this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#reconcileController = controller;
		const touched = new SvelteSet<string>();
		this.#touched = touched;
		const options = { signal: controller.signal };
		const handledState = this.#handledState;
		const pagesLoaded = this.#handledLoad === 'ready' ? this.#handledPage : 0;
		try {
			const items = await this.#data.listNew(options);
			const pages: HandledItemPage[] = [];
			for (let page = 1; handledState !== null && page <= pagesLoaded; page += 1) {
				pages.push(await this.#data.listHandled(handledState, page, options));
			}
			if (controller.signal.aborted) return;
			this.#touched = null;
			this.#merge(this.#new, items, touched);
			const same = this.#handledState === handledState && this.#handledPage === pagesLoaded;
			if (pagesLoaded > 0 && same) {
				this.#merge(
					this.#handled,
					pages.flatMap((page) => page.items),
					touched
				);
				this.#handledHasMore = pages.at(-1)?.hasMore ?? false;
			}
		} catch (error) {
			if (controller.signal.aborted) return;
			// Nothing to show: the inbox stays as it is, the next reconnection tries again.
			this.#failureMessage(error);
		} finally {
			if (this.#touched === touched) this.#touched = null;
			if (this.#reconcileController === controller) this.#reconcileController = null;
		}
	}

	/** Aborts all requests and empties the store. */
	reset(): void {
		this.#newController?.abort();
		this.#handledController?.abort();
		this.#reconcileController?.abort();
		this.#newController = null;
		this.#handledController = null;
		this.#reconcileController = null;
		this.#touched = null;
		this.#new.clear();
		this.#handled.clear();
		this.#deleted.clear();
		this.#pending.clear();
		this.#handledPage = 0;
		this.#state = 'idle';
		this.#error = null;
		this.#handledState = null;
		this.#handledLoad = 'idle';
		this.#handledError = null;
		this.#handledHasMore = false;
		this.#loadingMoreHandled = false;
	}

	async #act(
		id: string,
		call: () => Promise<InboxItemSummary>,
		failure: string
	): Promise<InboxActionResult> {
		if (this.#pending.has(id)) return { ok: false, message: null };
		if (!this.#session.ensureValid()) return { ok: false, message: null };
		this.#pending.add(id);
		try {
			const item = await call();
			this.upsert(item);
			return { ok: true, item };
		} catch (error) {
			const message = this.#failureMessage(error);
			if (message === null) return { ok: false, message: null };
			const title = this.find(id)?.title;
			const field = Object.values(toDataError(error).fields)[0]?.message;
			const prefix = title === undefined ? `Der Eintrag ${failure}` : `„${title}“ ${failure}`;
			return { ok: false, message: `${prefix} ${field ?? message}` };
		} finally {
			this.#pending.delete(id);
		}
	}

	/** Merges a loaded snapshot into `map`: new ones in, changed ones replaced, missing ones out. */
	#merge(
		map: SvelteMap<string, InboxItemSummary>,
		items: readonly InboxItemSummary[],
		touched: ReadonlySet<string>
	): void {
		const ids = new SvelteSet(items.map((item) => item.id));
		for (const id of [...map.keys()]) {
			if (!ids.has(id) && !touched.has(id)) map.delete(id);
		}
		for (const item of items) {
			if (touched.has(item.id) || this.#deleted.has(item.id)) continue;
			const existing = this.find(item.id);
			if (existing !== null && existing.updated > item.updated) continue;
			if (map === this.#new) this.#handled.delete(item.id);
			else this.#new.delete(item.id);
			map.set(item.id, item);
		}
	}

	/** A handled entry joins the loaded ones only where the loaded pages cover it. */
	#belongsToHandled(item: InboxItemSummary): boolean {
		if (this.#handledState !== item.state || this.#handledLoad !== 'ready') return false;
		if (this.#handled.has(item.id) || !this.#handledHasMore) return true;
		const last = this.#handledList.at(-1);
		return last === undefined || compareHandled(item, last) < 0;
	}

	async #loadNew(): Promise<void> {
		this.#newController?.abort();
		this.#newController = null;
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#newController = controller;
		this.#state = 'loading';
		this.#error = null;
		try {
			const items = await this.#data.listNew({ signal: controller.signal });
			if (controller.signal.aborted) return;
			this.#new.clear();
			for (const item of items) {
				if (!this.#deleted.has(item.id)) this.#new.set(item.id, item);
			}
			this.#state = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error, true);
			if (message === null) return;
			this.#error = message;
			this.#state = 'error';
		} finally {
			if (this.#newController === controller) this.#newController = null;
		}
	}

	async #loadHandled(page: number): Promise<void> {
		const state = this.#handledState;
		if (state === null) return;
		this.#handledController?.abort();
		this.#handledController = null;
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#handledController = controller;
		const first = page === 1;
		if (first) this.#handledLoad = 'loading';
		else this.#loadingMoreHandled = true;
		this.#handledError = null;
		try {
			const result = await this.#data.listHandled(state, page, { signal: controller.signal });
			if (controller.signal.aborted) return;
			if (first) this.#handled.clear();
			for (const item of result.items) {
				if (this.#deleted.has(item.id)) continue;
				const existing = this.find(item.id);
				if (existing !== null && existing.updated > item.updated) continue;
				this.#new.delete(item.id);
				this.#handled.set(item.id, item);
			}
			this.#handledPage = result.page;
			this.#handledHasMore = result.hasMore;
			this.#handledLoad = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error, true);
			if (message === null) return;
			this.#handledError = message;
			if (first) this.#handledLoad = 'error';
		} finally {
			if (this.#handledController === controller) {
				this.#handledController = null;
				this.#loadingMoreHandled = false;
			}
		}
	}

	/**
	 * German message of a failed request, or null if nothing is to be shown: an aborted request is
	 * no error, and an ended session leads to the login (ADR-0006 section 4). `listing`: a missing
	 * collection means the migration has not run yet.
	 */
	#failureMessage(error: unknown, listing = false): string | null {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		if (listing && failure.kind === 'not_found') return INBOX_UNAVAILABLE_MESSAGE;
		return failure.message;
	}
}

const [getInboxStore, setInboxStore] = createContext<InboxStore>();

/** Inbox of the signed-in user, set by the app layout. */
export { getInboxStore, setInboxStore };
