// The error log of the server in the dialog "Fehler" (FP-2, ADR-0077): loads the newest entries the
// account may see and, for an address `?fehler=<id>`, that one entry, which comes first. Without a
// connection the state is "offline" (a hint, nothing breaks), a failed load "failed" with its entry
// for "Details"; an entry that is gone or not visible is "missing", the list stays. Nothing is kept
// beyond the dialog: no storage, no outbox (ADR-0074), no polling; the dialog loads once when it opens
// and on "Erneut laden". ChannelProblemsStore finds the entries behind "Details" of the channel cards
// of the page "Kanäle" in one query.

import { pb } from '$lib/pocketbase';
import { problemOf, toDataError } from '$lib/data/errors';
import {
	channelProblemHits,
	getServerProblem,
	listServerProblems
} from '$lib/data/server-problems';
import type { ProblemEntry } from '$lib/domain/problems';
import {
	channelProblemKey,
	channelProblemsSince,
	matchChannelProblems,
	serverProblemEntry,
	type ChannelProblemCard,
	type ChannelProblemHit,
	type ServerProblemRecord
} from '$lib/domain/server-problems';

export type ServerProblemsState = 'idle' | 'loading' | 'ready' | 'offline' | 'failed';

/** Where the entries come from: the data layer, in tests a fake. */
export interface ServerProblemsSource {
	list(signal: AbortSignal): Promise<ServerProblemRecord[]>;
	get(id: string, signal: AbortSignal): Promise<ServerProblemRecord>;
}

const DATA_SOURCE: ServerProblemsSource = {
	list: (signal) => listServerProblems(pb, { signal }),
	get: (id, signal) => getServerProblem(pb, id, { signal })
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

	/** Loads the list and, with `focusId`, that entry; a newer call replaces a running one. */
	async load(focusId: string | null = null): Promise<void> {
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		this.#state = 'loading';
		this.#problem = null;
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
			if (controller.signal.aborted) return;
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'aborted') return;
			this.#entries = [];
			this.#focus = null;
			this.#missing = false;
			this.#problem = failure.kind === 'network' ? null : problemOf(failure);
			this.#state = failure.kind === 'network' ? 'offline' : 'failed';
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/** Stops a running load (the dialog closes). */
	stop(): void {
		this.#controller?.abort();
		this.#controller = null;
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
