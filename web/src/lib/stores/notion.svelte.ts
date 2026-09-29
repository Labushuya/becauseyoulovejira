// Notion import on the page "Kanäle" (ADR-0041, plan notion-import NI-2; ADR-0006): "Verbindung
// prüfen", the sources imported so far per connection (from the inbox, loaded with the card), the
// list of shared sources and the preview for the import dialog, the import in batches with
// progress, and "Erneut abrufen", which takes only entries that are not in the inbox yet with the
// options of the last import. Only reading: nothing goes to Notion but questions. Results go out
// as flags (ADR-0025 section 8); a lost session logs out once.

import type PocketBase from 'pocketbase';
import { SvelteMap } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import {
	checkNotion,
	importNotion,
	listNotionImports,
	listNotionSources,
	previewNotion,
	type NotionImportBatch
} from '$lib/data/notion';
import type { RequestOptions } from '$lib/data/options';
import {
	NO_COUNTS,
	addCounts,
	batches,
	blockedReason,
	checkText,
	countsText,
	importBatchSize,
	refetchText,
	type NotionCheck,
	type NotionImportCounts,
	type NotionImportRequest,
	type NotionImportResult,
	type NotionImportedSource,
	type NotionOutcome,
	type NotionPreview,
	type NotionSourceList
} from '$lib/domain/notion';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
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
		source: NotionImportRequest['source'],
		dateProperty: string | null,
		options: RequestOptions
	): Promise<NotionOutcome<NotionPreview>>;
	importBatch(id: string, request: NotionImportRequest): Promise<NotionOutcome<NotionImportBatch>>;
}

export function notionData(pb: PocketBase): NotionData {
	return {
		check: (id) => checkNotion(pb, id),
		sources: (id, query, options) => listNotionSources(pb, id, query, options),
		imports: (id, options) => listNotionImports(pb, id, options),
		preview: (id, source, dateProperty, options) =>
			previewNotion(pb, id, source, dateProperty, options),
		importBatch: (id, request) => importNotion(pb, id, request)
	};
}

/** Outcome of a whole import (all batches) or of "Erneut abrufen". */
export interface NotionImportRun {
	results: NotionImportResult[];
	counts: NotionImportCounts;
	/** Error that stopped the run (message of the server), null when every batch ran. */
	error: string | null;
}

/** Answer of "Verbindung prüfen" in the page: the result or why it failed. */
export type NotionCheckState = NotionOutcome<NotionCheck>;

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
		source: NotionImportRequest['source'],
		dateProperty: string | null,
		signal?: AbortSignal
	): Promise<NotionOutcome<NotionPreview> | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			return await this.#data.preview(id, source, dateProperty, { signal });
		} catch (error) {
			return this.#failed(error, signal);
		}
	}

	/**
	 * Takes the chosen entries into the inbox in batches of `batchSize` (the limit of the server),
	 * one after the other; `onprogress` gets the number of handled entries after each batch. An
	 * error stops the rest; what was taken stays. Reloads the imported sources afterwards. null when
	 * the session ended.
	 */
	async runImport(
		id: string,
		request: NotionImportRequest,
		batchSize: number,
		onprogress: (handled: number) => void = () => undefined
	): Promise<NotionImportRun | null> {
		const run: NotionImportRun = { results: [], counts: { ...NO_COUNTS }, error: null };
		for (const refs of batches(request.refs, batchSize)) {
			if (!this.#session.ensureValid()) return null;
			let outcome: NotionOutcome<NotionImportBatch>;
			try {
				outcome = await this.#data.importBatch(id, { ...request, refs });
			} catch (error) {
				const failed = this.#failed(error, undefined);
				if (failed === null) return null;
				run.error = failed.message;
				break;
			}
			if (outcome.kind !== 'ok') {
				run.error = outcome.message;
				break;
			}
			run.results.push(...outcome.value.items);
			run.counts = addCounts(run.counts, outcome.value.counts);
			onprogress(run.results.length);
		}
		await this.loadImports(id);
		return run;
	}

	/**
	 * "Erneut abrufen" of an imported source: its preview with the options of the last import, then
	 * only the entries that are not in the inbox yet, skipping done ones. The result goes out as a
	 * flag; an error also comes back as text for the card.
	 */
	async refetch(id: string, source: NotionImportedSource): Promise<string | null> {
		if (this.#refetching.has(id) || !this.#session.ensureValid()) return null;
		this.#refetching.set(id, source.id);
		try {
			const preview = await this.preview(
				id,
				{ type: source.type, id: source.id },
				source.type === 'data_source' ? source.dateProperty : null
			);
			if (preview === null) return null;
			if (preview.kind !== 'ok') {
				this.#flags.show({
					tone: preview.kind === 'error' ? 'error' : 'info',
					title: `„${source.title}“: ${preview.message}`
				});
				return preview.message;
			}
			const refs = preview.value.items
				.filter((item) => blockedReason(item, true) === '')
				.map((item) => item.ref);
			const done = preview.value.items.filter((item) => item.state === '' && item.done).length;
			const known = preview.value.items.filter((item) => item.state !== '').length;
			if (refs.length === 0) {
				const counts = { ...NO_COUNTS, duplicates: known, skipped: done };
				this.#flags.show({ ...this.#toFlag(refetchText(source.title, counts)) });
				await this.loadImports(id);
				return null;
			}
			const withContent = source.type === 'data_source' && source.copyContent;
			const run = await this.runImport(
				id,
				{
					source: { type: source.type, id: source.id },
					refs,
					skipDone: true,
					copyContent: withContent,
					dateProperty: source.type === 'data_source' ? source.dateProperty : null
				},
				importBatchSize(preview.value.limits, withContent)
			);
			if (run === null) return null;
			const counts = addCounts(run.counts, { ...NO_COUNTS, duplicates: known, skipped: done });
			if (run.error !== null) {
				this.#flags.show({
					tone: 'error',
					title: `„${source.title}“: ${countsText(counts)}. ${run.error}`
				});
				return run.error;
			}
			this.#flags.show(this.#toFlag(refetchText(source.title, counts)));
			return null;
		} finally {
			this.#refetching.delete(id);
		}
	}

	reset(): void {
		this.#imports.clear();
		this.#checking.clear();
		this.#lastCheck.clear();
		this.#refetching.clear();
	}

	#toFlag(text: { text: string; tone: 'success' | 'info' | 'error' }) {
		return { tone: text.tone, title: text.text };
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
