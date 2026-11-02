// The error log of the server in the dialog "Fehler" (FP-2, ADR-0077): loads the newest entries the
// account may see and, for an address `?fehler=<id>`, that one entry, which comes first. Without a
// connection the state is "offline" (a hint, nothing breaks), a failed load "failed" with its entry
// for "Details"; an entry that is gone or not visible is "missing", the list stays. Nothing is kept
// beyond the dialog: no storage, no outbox (ADR-0074), no polling; the dialog loads once when it opens
// and on "Erneut laden".

import { pb } from '$lib/pocketbase';
import { problemOf, toDataError } from '$lib/data/errors';
import { getServerProblem, listServerProblems } from '$lib/data/server-problems';
import type { ProblemEntry } from '$lib/domain/problems';
import { serverProblemEntry, type ServerProblemRecord } from '$lib/domain/server-problems';

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
