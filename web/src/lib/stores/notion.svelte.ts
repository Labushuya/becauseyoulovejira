// Notion import on the page "Kanäle" (ADR-0041, plan notion-import NI-2; ADR-0006): "Verbindung
// prüfen", the sources imported so far per connection (from the inbox, loaded with the card), the
// list of shared sources and the previews for the import dialog, the import in blocks with
// progress over one or several sources (stores/notion-run.ts; one run per connection at a time),
// and "Erneut abrufen" of one source or of all of them ("Alle erneut abrufen", addendum of
// 2026-10-01), which take only entries that are not in the inbox yet with the options of the last
// import. Only reading: nothing goes to Notion but questions. Results go out as flags (ADR-0025
// section 8); a lost session logs out once, every other failure of an import is its error, never
// silence.

import type PocketBase from 'pocketbase';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { DataError, toDataError } from '$lib/data/errors';
import {
	checkNotion,
	importNotion,
	listNotionImports,
	listNotionSources,
	previewNotion
} from '$lib/data/notion';
import type { RequestOptions } from '$lib/data/options';
import {
	checkText,
	refetchAllText,
	refetchText,
	sourceResultText,
	type NotionCheck,
	type NotionImportOutcome,
	type NotionImportRequest,
	type NotionImportResult,
	type NotionImportedSource,
	type NotionOutcome,
	type NotionPreview,
	type NotionPreviewRequest,
	type NotionSourceList,
	type NotionSourceResult
} from '$lib/domain/notion';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { refetchSources, runSources, type NotionRefetchRun, type NotionSourcesRun } from './notion-run';
import type { SessionGuard } from './ticket-list.svelte';

export interface NotionData {
	check(id: string): Promise<NotionOutcome<NotionCheck>>;
	sources(
		id: string,
		query: string,
		options: RequestOptions
	): Promise<NotionOutcome<NotionSourceList>>;
	imports(id: string, options: RequestOptions): Promise<NotionImportedSource[]>;
	preview(
		id: string,
		request: NotionPreviewRequest,
		options: RequestOptions
	): Promise<NotionOutcome<NotionPreview>>;
	importBatch(id: string, request: NotionImportRequest): Promise<NotionImportOutcome>;
}

export function notionData(pb: PocketBase): NotionData {
	return {
		check: (id) => checkNotion(pb, id),
		sources: (id, query, options) => listNotionSources(pb, id, query, options),
		imports: (id, options) => listNotionImports(pb, id, options),
		preview: (id, request, options) => previewNotion(pb, id, request, options),
		importBatch: (id, request) => importNotion(pb, id, request)
	};
}

/** Answer of "Verbindung prüfen" in the page: the result or why it failed. */
export type NotionCheckState = NotionOutcome<NotionCheck>;

/** One source of an import over several: its request (with all chosen entries) and block size. */
export interface NotionImportPlan {
	request: NotionImportRequest;
	size: number;
}

/** Where "Alle erneut abrufen" stands: the source that runs (1-based) of how many. */
export interface NotionRefetchProgress {
	index: number;
	total: number;
	title: string;
}

export class NotionStore {
	readonly #data: NotionData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	/** Imported sources per connection, once loaded. */
	readonly #imports = new SvelteMap<string, NotionImportedSource[]>();
	/** Connections with a running "Verbindung prüfen". */
	readonly #checking = new SvelteMap<string, true>();
	/** Answer of the last check per connection on this page (the assistant shows it). */
	readonly #lastCheck = new SvelteMap<string, NotionCheckState>();
	/** Source of a running "Erneut abrufen" per connection. */
	readonly #refetching = new SvelteMap<string, string>();
	/** Progress of a running "Alle erneut abrufen" per connection. */
	readonly #progress = new SvelteMap<string, NotionRefetchProgress>();
	/** Result of the last "Erneut abrufen" per connection and source, for the card. */
	readonly #results = new SvelteMap<string, ReadonlyMap<string, NotionSourceResult>>();
	/** Stops a running "Alle erneut abrufen" after its current block. */
	readonly #stops = new Map<string, AbortController>();
	readonly #stopping = new SvelteSet<string>();
	/** Connections with a running import. */
	readonly #importing = new SvelteSet<string>();

	constructor(data: NotionData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	/** Imported sources of a connection, null until loaded. */
	imports(id: string): readonly NotionImportedSource[] | null {
		return this.#imports.get(id) ?? null;
	}

	isChecking(id: string): boolean {
		return this.#checking.has(id);
	}

	lastCheck(id: string): NotionCheckState | null {
		return this.#lastCheck.get(id) ?? null;
	}

	/** Source ID of a running "Erneut abrufen" of the connection, null if none runs. */
	refetching(id: string): string | null {
		return this.#refetching.get(id) ?? null;
	}

	/** Progress of a running "Alle erneut abrufen", null if none runs. */
	refetchProgress(id: string): NotionRefetchProgress | null {
		return this.#progress.get(id) ?? null;
	}

	/** Result of the last "Erneut abrufen" of a source on this page, null without one. */
	refetchResult(id: string, sourceId: string): NotionSourceResult | null {
		return this.#results.get(id)?.get(sourceId) ?? null;
	}

	/** Whether a stop of "Alle erneut abrufen" was asked for and the run still finishes its block. */
	isStopping(id: string): boolean {
		return this.#stopping.has(id);
	}

	/** Whether an import of the connection runs (dialog or "Erneut abrufen"). */
	isImporting(id: string): boolean {
		return this.#importing.has(id);
	}

	/** Loads the imported sources of a connection; unknown on failure (the card says nothing). */
	async loadImports(id: string, options: RequestOptions = {}): Promise<void> {
		if (!this.#session.ensureValid()) return;
		try {
			this.#imports.set(id, await this.#data.imports(id, options));
		} catch (error) {
			const failure = toDataError(error, options.signal);
			if (failure.kind === 'session') this.#session.logout();
		}
	}

	/**
	 * "Verbindung prüfen": asks Notion for the integration and whether it sees anything. The answer
	 * stays for the page; `announce` sends it as a flag too (the card; the assistant shows it inline).
	 */
	async check(
		id: string,
		label: string,
		{ announce = true } = {}
	): Promise<NotionCheckState | null> {
		if (this.#checking.has(id) || !this.#session.ensureValid()) return null;
		this.#checking.set(id, true);
		try {
			const outcome = await this.#data.check(id);
			this.#lastCheck.set(id, outcome);
			if (announce) {
				if (outcome.kind === 'ok') {
					this.#flags.show({
						tone: outcome.value.shared ? 'success' : 'info',
						title: `„${label}“: ${checkText(outcome.value)}`
					});
				} else {
					this.#flags.show({
						tone: outcome.kind === 'error' ? 'error' : 'info',
						title: `„${label}“: ${outcome.message}`
					});
				}
			}
			return outcome;
		} catch (error) {
			const failed = this.#failed(error, undefined);
			if (failed !== null) {
				this.#lastCheck.set(id, failed);
				if (announce) this.#flags.show({ tone: 'error', title: `„${label}“: ${failed.message}` });
			}
			return failed;
		} finally {
			this.#checking.delete(id);
		}
	}

	/** Shared sources for the dialog; null when the session ended or the request was aborted. */
	async sources(
		id: string,
		query: string,
		signal?: AbortSignal
	): Promise<NotionOutcome<NotionSourceList> | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			return await this.#data.sources(id, query, { signal });
		} catch (error) {
			return this.#failed(error, signal);
		}
	}

	/** Preview of one source; null when the session ended or the request was aborted. */
	async preview(
		id: string,
		request: NotionPreviewRequest,
		signal?: AbortSignal
	): Promise<NotionOutcome<NotionPreview> | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			return await this.#data.preview(id, request, { signal });
		} catch (error) {
			return this.#failed(error, signal);
		}
	}

	/**
	 * Takes the chosen entries of one or several sources into the inbox in one run, source after
	 * source, each in its blocks (stores/notion-run.ts, ADR-0041 addendum of 2026-10-01): `onblock`
	 * gets the source and the results of each block, `stop` ends the run after the current block. An
	 * error of one source ends only that source; an error of the connection or of the request ends
	 * the run, whatever failed (Notion, the network, the time limit); what was taken stays. Reloads
	 * the imported sources afterwards. null when the session ended or an import of the connection
	 * already runs.
	 */
	async runImports(
		id: string,
		plan: readonly NotionImportPlan[],
		{
			onblock,
			stop
		}: { onblock?: (sourceId: string, results: NotionImportResult[]) => void; stop?: AbortSignal } = {}
	): Promise<NotionSourcesRun | null> {
		if (this.#importing.has(id)) return null;
		this.#importing.add(id);
		try {
			// The guard ends an expired session itself; only a refused request still needs the logout.
			const ended = new DataError('session');
			const run = await runSources(
				plan.map(({ request, size }) => ({
					key: request.source.id,
					refs: request.refs,
					size,
					send: (refs: string[]) => {
						if (!this.#session.ensureValid()) throw ended;
						return this.#data.importBatch(id, { ...request, refs });
					}
				})),
				{ onblock, stop, failure: (error) => this.#failureOf(error, ended) }
			);
			if (run !== null) await this.loadImports(id);
			return run;
		} finally {
			this.#importing.delete(id);
		}
	}

	/**
	 * "Erneut abrufen" of an imported source: its preview with the options of the last import, then
	 * only the entries that are not in the inbox yet, skipping done ones. The result goes out as a
	 * flag and stays for the card; an error also comes back as text for the card.
	 */
	async refetch(id: string, source: NotionImportedSource): Promise<string | null> {
		const run = await this.#refetch(id, [source], false);
		const result = run?.results[0];
		if (result === undefined) return null;
		if (result.error !== null) {
			this.#flags.show({ tone: 'error', title: `„${source.title}“: ${sourceResultText(result)}` });
			return result.error;
		}
		const text = refetchText(source.title, result.counts);
		this.#flags.show({ tone: text.tone, title: text.text });
		return null;
	}

	/**
	 * "Alle erneut abrufen" (ADR-0041, addendum of 2026-10-01): every source taken over so far, one
	 * after the other, like "Erneut abrufen" of each, with progress (`refetchProgress`) and a result
	 * per source (`refetchResult`); `stopRefetch` ends it after the current block. One flag sums it up.
	 */
	async refetchAll(id: string): Promise<void> {
		const sources = this.imports(id) ?? [];
		if (sources.length === 0) return;
		const run = await this.#refetch(id, sources, true);
		if (run === null) return;
		const text = refetchAllText(run.results, run.stopped);
		this.#flags.show({ tone: text.tone, title: text.text });
	}

	/** Ends a running "Alle erneut abrufen" after its current block. */
	stopRefetch(id: string): void {
		const stop = this.#stops.get(id);
		if (stop === undefined || stop.signal.aborted) return;
		this.#stopping.add(id);
		stop.abort();
	}

	/** Runs "Erneut abrufen" over `sources`; only "Alle erneut abrufen" (`all`) shows its progress. */
	async #refetch(
		id: string,
		sources: readonly NotionImportedSource[],
		all: boolean
	): Promise<NotionRefetchRun | null> {
		if (this.#importing.has(id) || !this.#session.ensureValid()) return null;
		this.#importing.add(id);
		const stop = new AbortController();
		this.#stops.set(id, stop);
		const ended = new DataError('session');
		const guard = () => {
			if (!this.#session.ensureValid()) throw ended;
		};
		try {
			const run = await refetchSources(
				sources,
				{
					preview: (request) => {
						guard();
						return this.#data.preview(id, request, {});
					},
					importBatch: (request) => {
						guard();
						return this.#data.importBatch(id, request);
					}
				},
				{
					stop: stop.signal,
					onsource: (index, source) => {
						this.#refetching.set(id, source.id);
						if (all) this.#progress.set(id, { index, total: sources.length, title: source.title });
					},
					failure: (error) => this.#failureOf(error, ended)
				}
			);
			if (run === null) return null;
			const results = new Map(this.#results.get(id) ?? []);
			for (const result of run.results) results.set(result.id, result);
			this.#results.set(id, results);
			await this.loadImports(id);
			return run;
		} finally {
			this.#importing.delete(id);
			this.#refetching.delete(id);
			this.#progress.delete(id);
			this.#stops.delete(id);
			this.#stopping.delete(id);
		}
	}

	reset(): void {
		for (const stop of this.#stops.values()) stop.abort();
		this.#imports.clear();
		this.#checking.clear();
		this.#lastCheck.clear();
		this.#refetching.clear();
		this.#progress.clear();
		this.#results.clear();
		this.#stops.clear();
		this.#stopping.clear();
		this.#importing.clear();
	}

	/** Message of a failed request of a run; null for a lost session (logged out once). */
	#failureOf(error: unknown, ended: DataError): string | null {
		if (error === ended) return null;
		const failure = toDataError(error);
		if (failure.kind !== 'session') return failure.message;
		this.#session.logout();
		return null;
	}

	/** A failure of the data layer as an error outcome; null for an aborted request or a lost session. */
	#failed(
		error: unknown,
		signal: AbortSignal | undefined
	): { kind: 'error'; message: string; reason: '' } | null {
		const failure = toDataError(error, signal);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		return { kind: 'error', message: failure.message, reason: '' };
	}
}
