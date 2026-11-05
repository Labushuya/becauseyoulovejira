// The error log of the server in the dialog "Fehler" (FP-2, ADR-0077): loads the newest entries the
// account may see and, for an address `?fehler=<id>`, that one entry, which comes first. Without a
// connection the state is "offline" (a hint, nothing breaks), a failed load "failed" with its entry
// for "Details"; an entry that is gone or not visible is "missing", the list stays. Nothing is kept
// beyond the dialog: no storage, no outbox (ADR-0074), no polling; the dialog loads once when it opens
// and on "Erneut laden". On the page "Fehlerprotokoll" (FP-3) the same store browses instead: the
// first page of the chosen filters (`browse`, also on "Erneut laden" and for every new filter, which
// starts the list and its cursor anew) and "Mehr laden" (`more`) in steps of 50 after the cursor of
// the last page, without an entry twice, with a line for screen readers (`announcement`). The page
// keeps its store while it shows "Diese Sitzung": back at "Server", `resume` keeps filters and loaded
// pages. ChannelProblemsStore finds the entries behind "Details" of the channel cards of the page
// "Kanäle" in one query.

import { pb } from '$lib/pocketbase';
import { problemOf, toDataError } from '$lib/data/errors';
import {
	channelProblemHits,
	getServerProblem,
	listServerProblemPage,
	listServerProblems
} from '$lib/data/server-problems';
import type { ProblemEntry } from '$lib/domain/problems';
import {
	ALL_SERVER_PROBLEMS,
	appendServerProblems,
	channelProblemKey,
	channelProblemsSince,
	matchChannelProblems,
	moreLoadedText,
	serverProblemEntry,
	type ChannelProblemCard,
	type ChannelProblemHit,
	type ServerProblemCursor,
	type ServerProblemPage,
	type ServerProblemQuery,
	type ServerProblemRecord,
	type ServerProblemsFilter
} from '$lib/domain/server-problems';

export type ServerProblemsState = 'idle' | 'loading' | 'ready' | 'offline' | 'failed';

/** "Mehr laden" on the page: nothing running, running, or the last try failed (the list stays). */
export type ServerProblemsMoreState = 'idle' | 'loading' | 'offline' | 'failed';

/** Where the entries come from: the data layer, in tests a fake. */
export interface ServerProblemsSource {
	list(signal: AbortSignal): Promise<ServerProblemRecord[]>;
	get(id: string, signal: AbortSignal): Promise<ServerProblemRecord>;
	/** One page of the page "Fehlerprotokoll" (FP-3). */
	page(query: ServerProblemQuery, signal: AbortSignal): Promise<ServerProblemPage>;
}

const DATA_SOURCE: ServerProblemsSource = {
	list: (signal) => listServerProblems(pb, { signal }),
	get: (id, signal) => getServerProblem(pb, id, { signal }),
	page: (query, signal) => listServerProblemPage(pb, query, { signal })
};

/** Marks an entry the address named that is gone or not visible to the account. */
const MISSING = Symbol('missing');

export class ServerProblemsStore {
	readonly #source: ServerProblemsSource;
	#state = $state<ServerProblemsState>('idle');
	#entries = $state.raw<readonly ProblemEntry[]>([]);
	#focus = $state<string | null>(null);
	#missing = $state(false);
	#problem = $state.raw<ProblemEntry | null>(null);
	#filter = $state.raw<ServerProblemsFilter>(ALL_SERVER_PROBLEMS);
	#next = $state.raw<ServerProblemCursor | null>(null);
	#more = $state<ServerProblemsMoreState>('idle');
	#moreProblem = $state.raw<ProblemEntry | null>(null);
	#announcement = $state('');
	/** The list is one of the page (`browse`), not the newest 50 of the dialog (`load`). */
	#browsing = false;
	#controller: AbortController | null = null;

	constructor(source: ServerProblemsSource = DATA_SOURCE) {
		this.#source = source;
	}

	get state(): ServerProblemsState {
		return this.#state;
	}

	/** The entries, the one of the address first, then the newest. */
	get entries(): readonly ProblemEntry[] {
		return this.#entries;
	}

	/** ID (of the dialog, `server-<id>`) of the entry the address named, once it is loaded. */
	get focus(): string | null {
		return this.#focus;
	}

	/** The address named an entry that is gone or not visible. */
	get missing(): boolean {
		return this.#missing;
	}

	/** The failed load behind "failed", for "Details" (FP-1). */
	get problem(): ProblemEntry | null {
		return this.#problem;
	}

	/** The filters of the page (FP-3); "Alle" in the dialog. */
	get filter(): ServerProblemsFilter {
		return this.#filter;
	}

	/** Whether "Mehr laden" may find more: the last page of the page was full. */
	get hasMore(): boolean {
		return this.#next !== null;
	}

	get moreState(): ServerProblemsMoreState {
		return this.#more;
	}

	/** The failed "Mehr laden" behind "failed", for "Details". */
	get moreProblem(): ProblemEntry | null {
		return this.#moreProblem;
	}

	/**
	 * What screen readers hear after "Mehr laden" ("3 weitere geladen.", "Keine weiteren
	 * Einträge."); empty while it runs, so the same text again is heard again.
	 */
	get announcement(): string {
		return this.#announcement;
	}

	/** Loads the list and, with `focusId`, that entry; a newer call replaces a running one. */
	async load(focusId: string | null = null): Promise<void> {
		this.#browsing = false;
		const controller = this.#start();
		try {
			const [list, focus] = await Promise.all([
				this.#source.list(controller.signal),
				focusId === null ? Promise.resolve(null) : this.#focused(focusId, controller.signal)
			]);
			if (controller.signal.aborted) return;
			const first = focus === null || focus === MISSING ? null : serverProblemEntry(focus);
			const rest = list
				.filter((record) => first === null || record.id !== first.serverId)
				.map(serverProblemEntry);
			this.#entries = first === null ? rest : [first, ...rest];
			this.#focus = first?.id ?? null;
			this.#missing = focus === MISSING;
			this.#state = 'ready';
		} catch (error) {
			this.#fail(error, controller);
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/**
	 * The page "Fehlerprotokoll" (FP-3): the first page of `filter` (by default the filters chosen
	 * before), the list and its cursor anew; a newer call replaces a running one, also "Mehr laden".
	 */
	async browse(filter: ServerProblemsFilter = this.#filter): Promise<void> {
		this.#filter = filter;
		this.#browsing = true;
		const controller = this.#start();
		try {
			const page = await this.#source.page({ ...filter, after: null }, controller.signal);
			if (controller.signal.aborted) return;
			this.#entries = page.records.map(serverProblemEntry);
			this.#next = page.next;
			this.#focus = null;
			this.#missing = false;
			this.#state = 'ready';
		} catch (error) {
			this.#fail(error, controller);
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/**
	 * The page shows the log of the server again (FP-3, "Server" → "Diese Sitzung" → "Server"): a
	 * list it already shows stays with its filters and the pages of "Mehr laden"; in any other state
	 * (never loaded, stopped while loading, offline, failed) the first page of the filters.
	 */
	async resume(): Promise<void> {
		if (this.#browsing && this.#state === 'ready') return;
		await this.browse();
	}

	/**
	 * "Mehr laden": the next page after the cursor with the same filters, appended without an entry
	 * twice. Only on a shown list with more to find and not twice at once; a failure keeps the list.
	 */
	async more(): Promise<void> {
		const after = this.#next;
		if (this.#state !== 'ready' || after === null || this.#more === 'loading') return;
		const controller = new AbortController();
		this.#controller = controller;
		this.#more = 'loading';
		this.#moreProblem = null;
		this.#announcement = '';
		try {
			const page = await this.#source.page({ ...this.#filter, after }, controller.signal);
			if (controller.signal.aborted) return;
			const entries = appendServerProblems(this.#entries, page.records);
			this.#announcement = moreLoadedText(entries.length - this.#entries.length);
			this.#entries = entries;
			this.#next = page.next;
			this.#more = 'idle';
		} catch (error) {
			if (controller.signal.aborted) return;
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'aborted') return;
			this.#moreProblem = failure.kind === 'network' ? null : problemOf(failure);
			this.#more = failure.kind === 'network' ? 'offline' : 'failed';
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/** Stops a running load (the dialog closes, the page goes). */
	stop(): void {
		this.#controller?.abort();
		this.#controller = null;
		if (this.#more === 'loading') this.#more = 'idle';
	}

	/** A new load: the running one (also "Mehr laden") ends, the list starts without a next page. */
	#start(): AbortController {
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		this.#state = 'loading';
		this.#problem = null;
		this.#next = null;
		this.#more = 'idle';
		this.#moreProblem = null;
		this.#announcement = '';
		return controller;
	}

	#fail(error: unknown, controller: AbortController): void {
		if (controller.signal.aborted) return;
		const failure = toDataError(error, controller.signal);
		if (failure.kind === 'aborted') return;
		this.#entries = [];
		this.#focus = null;
		this.#missing = false;
		this.#problem = failure.kind === 'network' ? null : problemOf(failure);
		this.#state = failure.kind === 'network' ? 'offline' : 'failed';
	}

	async #focused(id: string, signal: AbortSignal): Promise<ServerProblemRecord | typeof MISSING> {
		try {
			return await this.#source.get(id, signal);
		} catch (error) {
			const failure = toDataError(error, signal);
			if (failure.kind === 'not_found' || failure.kind === 'forbidden') return MISSING;
			throw failure;
		}
	}
}

/** The entries of failed runs of connections since a time (ms): the data layer, in tests a fake. */
export type ChannelProblemsFinder = (
	connections: readonly string[],
	since: number,
	signal: AbortSignal
) => Promise<ChannelProblemHit[]>;

const CHANNEL_PROBLEMS_FINDER: ChannelProblemsFinder = (connections, since, signal) =>
	channelProblemHits(pb, connections, since, { signal });

/**
 * How long the store waits for the cards to settle before it asks: one query for all cards of a load
 * or of an update over realtime, and the entry of a failed run is written right after its card.
 */
export const CHANNEL_PROBLEMS_SETTLE_MS = 1000;

/**
 * "Details" at the last error of the channel cards on the page "Kanäle" (FP-2, ADR-0077 §7): every
 * card with a last error watches it (`watch`), and the store asks one query for all of them, again only
 * when an error is new, never for a new time of a run with the same error (the server counts it on the
 * same entry). A card gets the entry of its connection only when it is not older than its run
 * (matchChannelProblems). A failed query shows no link and asks again with the next change; nothing is
 * kept beyond the page.
 */
export class ChannelProblemsStore {
	readonly #find: ChannelProblemsFinder;
	readonly #settleMs: number;
	// Plain lists: the cards and the asked keys are no state of a view, only #found is.
	#cards: readonly { readonly token: symbol; readonly card: ChannelProblemCard }[] = [];
	#asked: readonly string[] = [];
	#found = $state.raw<Readonly<Record<string, string>>>({});
	#timer: ReturnType<typeof setTimeout> | null = null;
	#controller: AbortController | null = null;

	constructor(
		find: ChannelProblemsFinder = CHANNEL_PROBLEMS_FINDER,
		settleMs = CHANNEL_PROBLEMS_SETTLE_MS
	) {
		this.#find = find;
		this.#settleMs = settleMs;
	}

	/** A card shows the last error `card`; the returned function ends it (new state, unmount). */
	watch(card: ChannelProblemCard): () => void {
		const token = Symbol('card');
		this.#cards = [...this.#cards, { token, card }];
		this.#schedule();
		return () => {
			this.#cards = this.#cards.filter((entry) => entry.token !== token);
		};
	}

	/** The ID of the entry behind the last error of a card, or null. */
	idOf(card: Pick<ChannelProblemCard, 'connection' | 'lastError'>): string | null {
		const key = channelProblemKey(card);
		return Object.hasOwn(this.#found, key) ? (this.#found[key] ?? null) : null;
	}

	/** Stops a waiting or running query and forgets everything (the page goes or shows another area). */
	stop(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		this.#controller?.abort();
		this.#controller = null;
		this.#asked = [];
		this.#found = {};
	}

	#schedule(): void {
		if (this.#timer !== null) return;
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.#sync();
		}, this.#settleMs);
	}

	async #sync(): Promise<void> {
		const keys = this.#cards.map((entry) => channelProblemKey(entry.card));
		// One card per error, the latest state of it.
		const cards = this.#cards
			.filter((entry, index) => keys.lastIndexOf(keys[index] ?? '') === index)
			.map((entry) => entry.card);
		if (cards.every((card) => this.#asked.includes(channelProblemKey(card)))) return;
		this.#asked = cards.map(channelProblemKey);
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		const since = channelProblemsSince(cards);
		try {
			const hits =
				since === null
					? []
					: await this.#find(
							cards.map((card) => card.connection),
							since,
							controller.signal
						);
			if (controller.signal.aborted) return;
			this.#found = Object.fromEntries(matchChannelProblems(cards, hits));
		} catch {
			if (controller.signal.aborted) return;
			// No link; the next change of a card asks again.
			this.#asked = [];
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}
}
