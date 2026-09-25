// State of the inbox (E4 plan, T-4 and packages 2 and 3; ADR-0014; ADR-0006 and ADR-0007). One
// store per app layout: every new entry is loaded in full (like the open tickets), converted and
// discarded entries page by page from the server (like the done tickets). The view shows what the
// query of the URL asks for (chips "Quelle" and "Zustand"). Own answers and realtime events go
// through the same idempotent `upsert` and `remove`; after a reconnection the store reconciles
// once. A duplicate answer of the server is an outcome, not an error.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import {
	assignToTicket,
	createItem,
	discardItem,
	getItem,
	importCalendarFile,
	listHandledItems,
	listNewItems,
	originalFileUrl,
	restoreItem,
	type CalendarImportSummary,
	type CreateItemOutcome,
	type HandledItemPage
} from '$lib/data/inbox';
import type { RequestOptions } from '$lib/data/options';
import {
	compareHandled,
	compareNewest,
	findSoftDuplicates,
	type HandledState,
	type InboxChannel,
	type InboxDraft,
	type InboxDuplicate,
	type InboxItem,
	type InboxItemSummary,
	type SoftDuplicates
} from '$lib/domain/inbox';
import { DEFAULT_INBOX_QUERY, type InboxQuery } from '$lib/domain/inbox-query';
import { channelsOf, sourceFamily } from '$lib/domain/source';
import type { TicketSummary } from '$lib/domain/ticket';
import { hold, type LiveSource } from './realtime';
import { UNDO_WINDOW_MS, type LoadState, type SessionGuard } from './ticket-list.svelte';

/**
 * Shown while the server does not know the inbox yet: the migration of E4 runs at the next start
 * of the app (docs/plan/e4.md, section 7).
 */
export const INBOX_UNAVAILABLE_MESSAGE =
	'Der Eingang steht nach dem nächsten Start der App bereit (start.bat).';

/** Data access of the inbox; tests pass a fake, the app binds the data layer to its client. */
export interface InboxData {
	listNew(options: RequestOptions): Promise<InboxItemSummary[]>;
	listHandled(
		state: HandledState,
		page: number,
		options: RequestOptions & { channels: readonly InboxChannel[] | null }
	): Promise<HandledItemPage>;
	get(id: string, options: RequestOptions): Promise<InboxItem>;
	create(draft: InboxDraft): Promise<CreateItemOutcome>;
	discard(id: string): Promise<InboxItemSummary>;
	restore(id: string): Promise<InboxItemSummary>;
	assign(id: string, ticketId: string): Promise<InboxItemSummary>;
	originalUrl(item: Pick<InboxItemSummary, 'id' | 'original'>): Promise<string | null>;
	importCalendar(file: File): Promise<CalendarImportSummary>;
}

export function inboxData(pb: PocketBase): InboxData {
	return {
		listNew: (options) => listNewItems(pb, options),
		listHandled: (state, page, options) => listHandledItems(pb, state, page, options),
		get: (id, options) => getItem(pb, id, options),
		create: (draft) => createItem(pb, draft),
		discard: (id) => discardItem(pb, id),
		restore: (id) => restoreItem(pb, id),
		assign: (id, ticketId) => assignToTicket(pb, id, ticketId),
		originalUrl: (item) => originalFileUrl(pb, item),
		importCalendar: (file) => importCalendarFile(pb, file)
	};
}

/** Outcome of creating an entry: created, already there, or failed (message and field texts). */
export type InboxCreateResult =
	| { kind: 'created'; item: InboxItem }
	| InboxDuplicate
	| { kind: 'error'; message: string | null; fields: Readonly<Record<string, string>> };

/**
 * Outcome of an .ics import: the counts of the hook, or a failure with its message (null after a
 * lost session, which leads to the login).
 */
export type CalendarImportResult =
	({ kind: 'imported' } & CalendarImportSummary) | { kind: 'error'; message: string | null };

/** Outcome of discarding, restoring and assigning; a failure carries a message unless hidden. */
export type InboxActionResult =
	{ ok: true; item: InboxItemSummary } | { ok: false; message: string | null };

/** A just discarded entry that stays in place with "Rückgängig" for UNDO_WINDOW_MS. */
interface Lingering {
	item: InboxItemSummary;
	timer: ReturnType<typeof setTimeout>;
}

function sameQuery(a: InboxQuery, b: InboxQuery): boolean {
	return a.source === b.source && a.state === b.state;
}

export class InboxStore {
	readonly #data: InboxData;
	readonly #session: SessionGuard;

	readonly #new = new SvelteMap<string, InboxItemSummary>();
	readonly #handled = new SvelteMap<string, InboxItemSummary>();
	readonly #lingering = new SvelteMap<string, Lingering>();
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
	#query = $state<InboxQuery>(DEFAULT_INBOX_QUERY);
	#handledLoad = $state<LoadState>('idle');
	#handledError = $state<string | null>(null);
	#handledHasMore = $state(false);
	#loadingMoreHandled = $state(false);
	#announcement = $state('');

	#newList = $derived([...this.#new.values()].sort(compareNewest));
	#handledList = $derived([...this.#handled.values()].sort(compareHandled));
	#visible = $derived.by(() => {
		const query = this.#query;
		if (query.state !== 'new') return this.#handledList;
		const lingering = [...this.#lingering.values()].map((entry) => entry.item);
		return [...this.#newList, ...lingering]
			.filter((item) => query.source === null || sourceFamily(item.channel) === query.source)
			.sort(compareNewest);
	});

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

	/** Rows of the view for the query of the URL: new ones (just discarded included) or handled. */
	get visible(): readonly InboxItemSummary[] {
		return this.#visible;
	}

	get query(): InboxQuery {
		return this.#query;
	}

	get state(): LoadState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/** Loaded handled entries of the shown state, most recently handled first. */
	get handled(): readonly InboxItemSummary[] {
		return this.#handledList;
	}

	/** Handled state shown, null while the new entries are shown. */
	get handledState(): HandledState | null {
		return this.#query.state === 'new' ? null : this.#query.state;
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

	/** Polite status message of the view (aria-live). */
	get announcement(): string {
		return this.#announcement;
	}

	find(id: string): InboxItemSummary | null {
		return this.#new.get(id) ?? this.#handled.get(id) ?? this.#lingering.get(id)?.item ?? null;
	}

	isPending(id: string): boolean {
		return this.#pending.has(id);
	}

	/** True while a just discarded entry stands with "Rückgängig". */
	isLingering(id: string): boolean {
		return this.#lingering.has(id);
	}

	/** Possible duplicates of an entry among the open tickets and the other new entries. */
	softDuplicates(
		item: Pick<InboxItemSummary, 'id' | 'title'>,
		openTickets: readonly TicketSummary[]
	): SoftDuplicates {
		return findSoftDuplicates(item, openTickets, this.#newList);
	}

	announce(message: string): void {
		this.#announcement = message;
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
			this.handledState === null ? undefined : this.#loadHandled(1)
		]);
	}

	/**
	 * Shows the view for the query of the URL. New entries are only filtered; converted or
	 * discarded ones load their first page from the server (with the source family as filter), and
	 * a request that became stale is aborted. The same query again loads nothing.
	 */
	activate(query: InboxQuery): void {
		void this.load();
		const before = this.#query;
		this.#query = query;
		if (sameQuery(before, query) && (query.state === 'new' || this.#handledLoad !== 'idle')) {
			return;
		}
		this.#handledController?.abort();
		this.#handledController = null;
		this.#handled.clear();
		this.#handledPage = 0;
		this.#handledHasMore = false;
		this.#handledError = null;
		this.#loadingMoreHandled = false;
		this.#handledLoad = 'idle';
		if (query.state !== 'new') void this.#loadHandled(1);
	}

	/** Next page of handled entries ("Weitere laden"). */
	async loadMoreHandled(): Promise<void> {
		if (this.handledState === null || !this.#handledHasMore) return;
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
			this.#stopLingering(item.id);
			this.#handled.delete(item.id);
			this.#new.set(item.id, item);
			return;
		}
		this.#new.delete(item.id);
		const lingering = this.#lingering.get(item.id);
		if (lingering !== undefined) this.#lingering.set(item.id, { ...lingering, item });
		if (this.#belongsToHandled(item)) this.#handled.set(item.id, item);
		else this.#handled.delete(item.id);
	}

	remove(id: string): void {
		this.#deleted.add(id);
		this.#touched?.add(id);
		this.#stopLingering(id);
		this.#new.delete(id);
		this.#handled.delete(id);
		this.#pending.delete(id);
	}

	/**
	 * A ticket was made from an entry (panel "Neues Ticket" or collected conversion): the entry
	 * leaves the new ones at once, before the realtime event with the answer of the hook arrives.
	 */
	markConverted(id: string, ticketId: string, at: string): void {
		const item = this.find(id);
		if (item === null || item.state === 'converted') return;
		this.upsert({ ...item, state: 'converted', ticketId, handledAt: at });
	}

	/** One entry with its text (panel, prefill of the ticket); it joins the store as well. */
	async fetch(id: string, options: RequestOptions = {}): Promise<InboxItem> {
		const item = await this.#data.get(id, options);
		this.upsert(item);
		return item;
	}

	/** Address of the protected original with a fresh file token, or a message. */
	async originalUrl(
		item: Pick<InboxItemSummary, 'id' | 'original'>
	): Promise<{ ok: true; url: string } | { ok: false; message: string | null }> {
		if (!this.#session.ensureValid()) return { ok: false, message: null };
		try {
			const url = await this.#data.originalUrl(item);
			if (url === null) return { ok: false, message: 'Zu diesem Eintrag gibt es keine Datei.' };
			return { ok: true, url };
		} catch (error) {
			return { ok: false, message: this.#failureMessage(error) };
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

	/**
	 * Takes an .ics file into the inbox (E4 plan, package 14). The new entries come by realtime;
	 * the store reconciles afterwards in case an event is late.
	 */
	async importCalendar(file: File): Promise<CalendarImportResult> {
		if (!this.#session.ensureValid()) return { kind: 'error', message: null };
		try {
			const summary = await this.#data.importCalendar(file);
			if (summary.created > 0) void this.reconcile();
			return { kind: 'imported', ...summary };
		} catch (error) {
			if (toDataError(error).status === 503) {
				return { kind: 'error', message: INBOX_UNAVAILABLE_MESSAGE };
			}
			const message = this.#failureMessage(error);
			return { kind: 'error', message };
		}
	}

	/**
	 * "Verwerfen" (ADR-0014 section 4). A new entry stays in place for UNDO_WINDOW_MS with
	 * "Rückgängig", like the check mark of the ticket table.
	 */
	async discard(id: string): Promise<InboxActionResult> {
		const wasNew = this.#new.has(id);
		const result = await this.#act(
			id,
			() => this.#data.discard(id),
			'konnte nicht verworfen werden.'
		);
		if (!result.ok) return result;
		if (wasNew && !this.#deleted.has(id)) {
			this.#stopLingering(id);
			const timer = setTimeout(() => this.#lingering.delete(id), UNDO_WINDOW_MS);
			this.#lingering.set(id, { item: result.item, timer });
		}
		this.#announcement = `„${result.item.title}“ verworfen. Rückgängig ist kurz möglich.`;
		return result;
	}

	/** "Wiederherstellen" of a discarded entry. */
	async restore(id: string): Promise<InboxActionResult> {
		const result = await this.#act(
			id,
			() => this.#data.restore(id),
			'konnte nicht wiederhergestellt werden.'
		);
		if (result.ok) this.#announcement = `„${result.item.title}“ ist wieder im Eingang.`;
		return result;
	}

	/** "Rückgängig" right after discarding. */
	undo(id: string): Promise<InboxActionResult> {
		return this.restore(id);
	}

	/** "Dem Ticket zuordnen": the entry counts as converted into the ticket. */
	async assign(id: string, ticketId: string, ticketKey = ''): Promise<InboxActionResult> {
		const result = await this.#act(
			id,
			() => this.#data.assign(id, ticketId),
			'konnte nicht zugeordnet werden.'
		);
		if (result.ok) {
			const target = ticketKey === '' ? 'dem Ticket' : ticketKey;
			this.#announcement = `„${result.item.title}“ ist ${target} zugeordnet.`;
		}
		return result;
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
		const query = this.#query;
		const handledState = this.handledState;
		const pagesLoaded = this.#handledLoad === 'ready' ? this.#handledPage : 0;
		try {
			const items = await this.#data.listNew(options);
			const pages: HandledItemPage[] = [];
			for (let page = 1; handledState !== null && page <= pagesLoaded; page += 1) {
				pages.push(
					await this.#data.listHandled(handledState, page, {
						...options,
						channels: this.#channels(query)
					})
				);
			}
			if (controller.signal.aborted) return;
			this.#touched = null;
			this.#merge(this.#new, items, touched);
			const same = sameQuery(this.#query, query) && this.#handledPage === pagesLoaded;
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

	/** Aborts all requests and timers and empties the store. */
	reset(): void {
		this.#newController?.abort();
		this.#handledController?.abort();
		this.#reconcileController?.abort();
		this.#newController = null;
		this.#handledController = null;
		this.#reconcileController = null;
		this.#touched = null;
		for (const { timer } of this.#lingering.values()) clearTimeout(timer);
		this.#lingering.clear();
		this.#new.clear();
		this.#handled.clear();
		this.#deleted.clear();
		this.#pending.clear();
		this.#handledPage = 0;
		this.#state = 'idle';
		this.#error = null;
		this.#query = DEFAULT_INBOX_QUERY;
		this.#handledLoad = 'idle';
		this.#handledError = null;
		this.#handledHasMore = false;
		this.#loadingMoreHandled = false;
		this.#announcement = '';
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

	#stopLingering(id: string): void {
		const lingering = this.#lingering.get(id);
		if (lingering === undefined) return;
		clearTimeout(lingering.timer);
		this.#lingering.delete(id);
	}

	/** Channels of the source chip for the server filter of handled entries, null for all. */
	#channels(query: InboxQuery): readonly InboxChannel[] | null {
		return query.source === null ? null : channelsOf(query.source);
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
		const query = this.#query;
		if (query.state !== item.state || this.#handledLoad !== 'ready') return false;
		if (query.source !== null && sourceFamily(item.channel) !== query.source) return false;
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
		const query = this.#query;
		const state = this.handledState;
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
			const result = await this.#data.listHandled(state, page, {
				signal: controller.signal,
				channels: this.#channels(query)
			});
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
