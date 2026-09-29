// "Alle Kanäle jetzt abrufen" in the inbox view (testing feedback package A, item 4): runs every
// switched-on connection one after the other through the same route as "Jetzt abrufen" on a card
// (a mailbox through the mail helper), says in a live status which one runs, and ends with one
// flag: "N neue" or "keine neuen"; after a failure the flag leads to the card of the connection.
// New entries reach the inbox through its realtime subscription, nothing is reloaded here.

import type PocketBase from 'pocketbase';
import { listConnections, runConnection } from '$lib/data/connections';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { fetchesAutomatically, type Connection, type RunResult } from '$lib/domain/connections';
import { syncProgressText, syncSummary, type SyncEntry } from '$lib/domain/sync-all';
import type { FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface SyncAllData {
	list(options: RequestOptions): Promise<Connection[]>;
	run(id: string): Promise<RunResult>;
}

export function syncAllData(pb: PocketBase): SyncAllData {
	return {
		list: (options) => listConnections(pb, options),
		run: (id) => runConnection(pb, id)
	};
}

function failedRun(message: string): RunResult {
	return {
		status: 'error',
		created: 0,
		duplicates: 0,
		updated: 0,
		skipped: 0,
		failed: 0,
		unmatched: 0,
		error: message,
		missing: []
	};
}

/** Thrown inside a run when the session ended; the store stops quietly. */
class SessionEnded extends Error {}

/** Where the action of the flag leads. */
export interface SyncAllNavigation {
	/** The card of a connection on the page "Kanäle". */
	card(id: string): void;
	/** The page "Kanäle". */
	channels(): void;
}

export class SyncAllStore {
	readonly #data: SyncAllData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #navigate: SyncAllNavigation;

	#running = $state(false);
	#status = $state('');

	constructor(
		data: SyncAllData,
		session: SessionGuard,
		flags: FlagSink,
		navigate: SyncAllNavigation
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#navigate = navigate;
	}

	/** True while the connections run. */
	get running(): boolean {
		return this.#running;
	}

	/** Text of the live status: which connection runs, then the result. */
	get status(): string {
		return this.#status;
	}

	/** Runs every switched-on connection once; a second call while it runs does nothing. */
	async runAll(): Promise<void> {
		if (this.#running || !this.#session.ensureValid()) return;
		this.#running = true;
		this.#status = 'Kanäle werden geladen …';
		try {
			let connections: Connection[];
			try {
				// Notion only imports on request (ADR-0041); it has nothing to fetch.
				connections = (await this.#data.list({})).filter(
					(item) => item.enabled && fetchesAutomatically(item.type)
				);
			} catch (error) {
				const failure = toDataError(error);
				if (failure.kind === 'session') throw new SessionEnded();
				this.#status = 'Die Kanäle ließen sich nicht laden.';
				this.#flags.show({ tone: 'error', title: this.#status, description: failure.message });
				return;
			}
			const entries: SyncEntry[] = [];
			for (const [index, connection] of connections.entries()) {
				this.#status = syncProgressText(index, connections.length, connection.label);
				entries.push({ connection, result: await this.#runOne(connection.id) });
			}
			this.#announce(entries);
		} catch (error) {
			if (!(error instanceof SessionEnded)) throw error;
			this.#status = '';
			this.#session.logout();
		} finally {
			this.#running = false;
		}
	}

	async #runOne(id: string): Promise<RunResult> {
		try {
			return await this.#data.run(id);
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') throw new SessionEnded();
			return failedRun(failure.message);
		}
	}

	#announce(entries: readonly SyncEntry[]): void {
		const summary = syncSummary(entries);
		this.#status = summary.title;
		const problem = summary.problem;
		this.#flags.show({
			tone: summary.tone,
			title: summary.title,
			description: summary.description,
			...(problem !== null
				? {
						action: {
							label: `Zur Karte „${problem.label}“`,
							run: () => this.#navigate.card(problem.id)
						}
					}
				: entries.length === 0
					? { action: { label: 'Kanäle öffnen', run: () => this.#navigate.channels() } }
					: {})
		});
	}
}
