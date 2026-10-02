// State of the inbox (E4 plan, T-4 and packages 2 and 3; ADR-0014; ADR-0006 and ADR-0007). One
// store per app layout: every new entry is loaded in full (like the open tickets), converted and
// discarded entries page by page from the server (like the done tickets). The view shows what the
// query of the URL asks for (chips "Quelle" and "Zustand"). Own answers and realtime events go
// through the same idempotent `upsert` and `remove`; after a reconnection the store reconciles
// once. A duplicate answer of the server is an outcome, not an error. Results of discarding,
// restoring and assigning go out as flags (ADR-0025 section 8): a discarded entry leaves the list
// at once, and "Rückgängig" stands in its flag.

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
	savePage,
	type CalendarImportSummary,
	type CreateItemOutcome,
	type HandledItemPage,
	type HandledTarget,
	type PageCopyOutcome
} from '$lib/data/inbox';
import type { RequestOptions } from '$lib/data/options';
import {
	compareHandled,
	compareNewest,
	findSoftDuplicates,
	type InboxChannel,
	type InboxDraft,
	type InboxDuplicate,
	type InboxItem,
	type InboxItemSummary,
	type ListedView,
	type SoftDuplicates
} from '$lib/domain/inbox';
import { DEFAULT_INBOX_QUERY, type InboxQuery } from '$lib/domain/inbox-query';
import type { TreeProject } from '$lib/domain/project-tree';
import { channelsOf, sourceFamily } from '$lib/domain/source';
import { NO_TARGET, matchesTarget } from '$lib/domain/target-project';
import type { TicketSummary } from '$lib/domain/ticket';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type LiveSource } from './realtime';
import type { LoadState, SessionGuard } from './ticket-list.svelte';
import { restartNeeded } from '$lib/guidance/texts';

/**
 * Shown while the server does not know the inbox yet: the migration of E4 runs at the next start
 * of the app (docs/plan/e4.md, section 7).
 */
export const INBOX_UNAVAILABLE_MESSAGE = restartNeeded('Der Eingang ist');

/** Data access of the inbox; tests pass a fake, the app binds the data layer to its client. */
export interface InboxData {
	listNew(options: RequestOptions): Promise<InboxItemSummary[]>;
	listHandled(
		state: ListedView,
		page: number,
		options: RequestOptions & {
			channels: readonly InboxChannel[] | null;
			/** Filter "Zielprojekt" of the server (ADR-0049); null or absent for every entry. */
			target?: HandledTarget;
		}
	): Promise<HandledItemPage>;
	get(id: string, options: RequestOptions): Promise<InboxItem>;
	create(draft: InboxDraft): Promise<CreateItemOutcome>;
	discard(id: string): Promise<InboxItemSummary>;
	restore(id: string): Promise<InboxItemSummary>;
	assign(id: string, ticketId: string): Promise<InboxItemSummary>;
	originalUrl(item: Pick<InboxItemSummary, 'id' | 'original'>): Promise<string | null>;
	importCalendar(file: File, select: readonly number[]): Promise<CalendarImportSummary>;
	savePage(id: string): Promise<PageCopyOutcome>;
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
		importCalendar: (file, select) => importCalendarFile(pb, file, select),
		savePage: (id) => savePage(pb, id)
	};
}

/** Outcome of "Seiteninhalt sichern"; a failure carries a message unless hidden (lost session). */
export type PageCopyResult =
	{ ok: true; truncated: boolean } | { ok: false; message: string | null };

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

/** Whether two queries load the same entries (the grouping only arranges them). */
function sameQuery(a: InboxQuery, b: InboxQuery): boolean {
	return a.source === b.source && a.state === b.state && (a.target ?? null) === (b.target ?? null);
}

/** Projects of the catalog for the filter "Zielprojekt" (sub projects, ADR-0034 §6). */
export type InboxProjects = () => readonly TreeProject[];

export class InboxStore {
	readonly #data: InboxData;
	readonly #session: SessionGuard;
	readonly #projects: InboxProjects;

	readonly #new = new SvelteMap<string, InboxItemSummary>();
	readonly #handled = new SvelteMap<string, InboxItemSummary>();
	readonly #flags: FlagSink;
	/** Just discarded entries whose flag still offers "Rückgängig": entry ID to flag ID. */
	readonly #undoFlags = new SvelteMap<string, { flagId: string; title: string }>();
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

	#newList = $derived([...this.#new.values()].sort(compareNewest));
	#handledList = $derived(
		[...this.#handled.values()].sort(this.#query.state === 'all' ? compareNewest : compareHandled)
	);
	/**
	 * The server does not know the target project yet (ADR-0049): a loaded entry lacks the field.
	 * The filter "Zielprojekt" then counts as not set.
	 */
	#targetsMissing = $derived(
		[...this.#new.values(), ...this.#handled.values()].some(
			(item) => item.withoutTargetField === true
		)
	);
	#visible = $derived.by(() => {
		const query = this.#query;
		if (query.state !== 'new') return this.#handledList;
		const target = this.#targetFilter(query);
		const projects = target === null ? [] : this.#projects();
		return this.#newList.filter(
			(item) =>
				(query.source === null || sourceFamily(item.channel) === query.source) &&
				matchesTarget(item, target, projects)
		);
	});

	constructor(
		data: InboxData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		projects: InboxProjects = () => []
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#projects = projects;
	}

	/**
	 * Whether the server knows the target project of the entries (ADR-0049): at least one entry is
	 * loaded and none lacks the field. Filter, grouping and column of the target wait for it.
	 */
	get targetsReady(): boolean {
		return !this.#targetsMissing && this.#new.size + this.#handled.size > 0;
	}

	/** Every new entry, newest first. */
	get newItems(): readonly InboxItemSummary[] {
		return this.#newList;
	}

	/** Number of new entries (switch "Eingang", ADR-0015 section 5); null until loaded. */
	get newCount(): number | null {
		return this.#state === 'ready' ? this.#new.size : null;
	}

	/** Rows of the view for the query of the URL: the new ones or the handled ones. */
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

	/**
	 * Loaded entries of the shown paged view: most recently handled first, or newest first in the
	 * view "Alle".
	 */
	get handled(): readonly InboxItemSummary[] {
		return this.#handledList;
	}

	/** Paged view shown (a handled state or "all"), null while the new entries are shown. */
	get handledState(): ListedView | null {
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
			// Back in the inbox by another way: "Rückgängig" has nothing left to do.
			this.#dropUndo(item.id);
			this.#new.set(item.id, item);
		} else {
			this.#new.delete(item.id);
		}
		// The view "Alle" pages through every state, new entries included.
		if (this.#belongsToHandled(item)) this.#handled.set(item.id, item);
		else this.#handled.delete(item.id);
	}

	remove(id: string): void {
		this.#deleted.add(id);
		this.#touched?.add(id);
		this.#dropUndo(id);
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
	 * Takes the chosen components of an .ics file into the inbox (E4 plan, packages 14 and 21).
	 * The new entries come by realtime; the store reconciles afterwards in case an event is late.
	 */
	async importCalendar(file: File, select: readonly number[]): Promise<CalendarImportResult> {
		if (!this.#session.ensureValid()) return { kind: 'error', message: null };
		try {
			const summary = await this.#data.importCalendar(file, select);
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
	 * "Verwerfen" (ADR-0014 section 4). The entry leaves the new ones at once; for a new entry a
	 * flag offers "Rückgängig" for FLAG_DURATION_MS, like the check mark of the ticket table.
	 * A failure goes back to the caller, which shows it where the action started.
	 */
	async discard(id: string): Promise<InboxActionResult> {
		const wasNew = this.#new.has(id);
		const result = await this.#act(
			id,
			() => this.#data.discard(id),
			'konnte nicht verworfen werden.'
		);
		if (!result.ok) return result;
		const title = `„${result.item.title}“ verworfen.`;
		if (!wasNew || this.#deleted.has(id)) {
			this.#flags.show({ tone: 'success', title });
			return result;
		}
		this.#dropUndo(id);
		const flagId = this.#flags.show({
			tone: 'success',
			title,
			action: { label: 'Rückgängig', run: () => void this.undo(id) },
			onclose: () => {
				if (this.#undoFlags.get(id)?.flagId === flagId) this.#undoFlags.delete(id);
			}
		});
		this.#undoFlags.set(id, { flagId, title: result.item.title });
		return result;
	}

	/** "Wiederherstellen" of a discarded entry. */
	restore(id: string): Promise<InboxActionResult> {
		return this.#restore(id, undefined);
	}

	/** "Rückgängig" of the flag after discarding; a failure becomes an error flag. */
	async undo(id: string): Promise<InboxActionResult> {
		// The entry left the list with the discard; its title still names it in a failure.
		const title = this.#undoFlags.get(id)?.title;
		this.#undoFlags.delete(id);
		const result = await this.#restore(id, title);
		if (!result.ok && result.message !== null) {
			this.#flags.show({ tone: 'error', title: result.message });
		}
		return result;
	}

	async #restore(id: string, knownTitle: string | undefined): Promise<InboxActionResult> {
		const result = await this.#act(
			id,
			() => this.#data.restore(id),
			'konnte nicht wiederhergestellt werden.',
			knownTitle
		);
		if (result.ok) {
			this.#flags.show({ tone: 'success', title: `„${result.item.title}“ ist wieder im Eingang.` });
		}
		return result;
	}

	/** True while the flag of a just discarded entry offers "Rückgängig". */
	canUndo(id: string): boolean {
		return this.#undoFlags.has(id);
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
			this.#flags.show({
				tone: 'success',
				title: `„${result.item.title}“ ist ${target} zugeordnet.`
			});
		}
		return result;
	}

	/**
	 * "Seiteninhalt sichern" (ADR-0031 section 6): the server fetches the page of a web link once.
	 * A success flag names it (and a cut page); a refusal comes back with the reason of the server.
	 * The entry itself changes through its realtime event; the text needs `fetch` again.
	 */
	async savePage(item: Pick<InboxItemSummary, 'id' | 'title'>): Promise<PageCopyResult> {
		if (this.#pending.has(item.id) || !this.#session.ensureValid()) {
			return { ok: false, message: null };
		}
		this.#pending.add(item.id);
		try {
			const outcome = await this.#data.savePage(item.id);
			if (outcome.kind === 'refused') return { ok: false, message: outcome.message };
			this.#flags.show({
				tone: 'success',
				title: outcome.truncated
					? `Seite von „${item.title}“ gesichert (auf 2 MB gekürzt).`
					: `Seite von „${item.title}“ gesichert.`
			});
			return { ok: true, truncated: outcome.truncated };
		} catch (error) {
			return { ok: false, message: this.#failureMessage(error) };
		} finally {
			this.#pending.delete(item.id);
		}
	}

	/**
	 * Keeps the inbox live (ADR-0007 sections 2 and 3); a subscription that came only after failed
	 * attempts reconciles like a reconnection. Returns the cleanup, which ends the subscriptions
	 * and a running reconciliation.
	 */
	connect(live: LiveSource): () => void {
		const reconcile = () => void this.reconcile();
		const stops = [
			hold(
				(guard) =>
					live.inbox(
						guard((change) => {
							if (change.action === 'delete') this.remove(change.id);
							else this.upsert(change.record);
						})
					),
				{ recovered: reconcile }
			),
			hold((guard) => live.reconnected(guard(reconcile)), { recovered: reconcile })
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
						channels: this.#channels(query),
						target: this.#targetParam(query)
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
		for (const id of [...this.#undoFlags.keys()]) this.#dropUndo(id);
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
	}

	async #act(
		id: string,
		call: () => Promise<InboxItemSummary>,
		failure: string,
		knownTitle?: string
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
			const title = this.find(id)?.title ?? knownTitle;
			const field = Object.values(toDataError(error).fields)[0]?.message;
			const prefix = title === undefined ? `Der Eintrag ${failure}` : `„${title}“ ${failure}`;
			return { ok: false, message: `${prefix} ${field ?? message}` };
		} finally {
			this.#pending.delete(id);
		}
	}

	/** Ends the chance of "Rückgängig" for an entry and closes its flag. */
	#dropUndo(id: string): void {
		const undoable = this.#undoFlags.get(id);
		if (undoable === undefined) return;
		this.#undoFlags.delete(id);
		this.#flags.dismiss(undoable.flagId);
	}

	/** Channels of the source chip for the server filter of handled entries, null for all. */
	#channels(query: InboxQuery): readonly InboxChannel[] | null {
		return query.source === null ? null : channelsOf(query.source);
	}

	/** The filter "Zielprojekt" that applies: none while the server lacks the field (ADR-0049). */
	#targetFilter(query: InboxQuery): string | null {
		return this.#targetsMissing ? null : (query.target ?? null);
	}

	/** The filter "Zielprojekt" for the server filter of handled entries, null for all. */
	#targetParam(query: InboxQuery): HandledTarget {
		const target = this.#targetFilter(query);
		if (target === null) return null;
		return { project: target === NO_TARGET ? null : target };
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
			if (map === this.#new) {
				if (this.#query.state !== 'all') this.#handled.delete(item.id);
			} else if (item.state !== 'new') {
				this.#new.delete(item.id);
			}
			map.set(item.id, item);
		}
	}

	/**
	 * An entry joins the loaded ones of the paged view (its state, or any state in "Alle") only
	 * where the loaded pages cover it.
	 */
	#belongsToHandled(item: InboxItemSummary): boolean {
		const query = this.#query;
		if (query.state === 'new' || this.#handledLoad !== 'ready') return false;
		if (query.state !== 'all' && query.state !== item.state) return false;
		if (query.source !== null && sourceFamily(item.channel) !== query.source) return false;
		const target = this.#targetFilter(query);
		if (!matchesTarget(item, target, target === null ? [] : this.#projects())) return false;
		if (this.#handled.has(item.id) || !this.#handledHasMore) return true;
		const last = this.#handledList.at(-1);
		const compare = query.state === 'all' ? compareNewest : compareHandled;
		return last === undefined || compare(item, last) < 0;
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
				channels: this.#channels(query),
				target: this.#targetParam(query)
			});
			if (controller.signal.aborted) return;
			if (first) this.#handled.clear();
			for (const item of result.items) {
				if (this.#deleted.has(item.id)) continue;
				const existing = this.find(item.id);
				if (existing !== null && existing.updated > item.updated) continue;
				if (item.state !== 'new') this.#new.delete(item.id);
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
