// Keywords of the file imports on the page "Kanäle" (E4 plan, package 21; ADR-0020 section 3;
// ADR-0006). Loaded when the page opens; every change saves all lists of the user at once. Before
// the migration 1790201500 the server does not know the field and the page says so.

import type PocketBase from 'pocketbase';
import { getImportKeywords, saveImportKeywords } from '$lib/data/import-keywords';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	EMPTY_IMPORT_KEYWORDS,
	type ImportKeywordList,
	type ImportKeywords,
	type ImportKind
} from '$lib/domain/keywords';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';
import { restartNeeded } from '$lib/guidance/texts';

/** Shown while the server does not know the lists yet (migration after a restart). */
export const IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE = restartNeeded(
	'Die Stichwörter für Datei-Importe sind'
);

export interface ImportKeywordsData {
	load(options: RequestOptions): Promise<ImportKeywords | null>;
	save(settings: ImportKeywords): Promise<ImportKeywords>;
}

export function importKeywordsData(pb: PocketBase): ImportKeywordsData {
	return {
		load: (options) => getImportKeywords(pb, options),
		save: (settings) => saveImportKeywords(pb, settings)
	};
}

export class ImportKeywordsStore {
	readonly #data: ImportKeywordsData;
	readonly #session: SessionGuard;
	#controller: AbortController | null = null;

	#state = $state<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>('idle');
	#error = $state<string | null>(null);
	#settings = $state<ImportKeywords>(EMPTY_IMPORT_KEYWORDS);

	readonly #flags: FlagSink;

	constructor(data: ImportKeywordsData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	get state() {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	get settings(): ImportKeywords {
		return this.#settings;
	}

	async load(): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		if (this.#state !== 'ready') this.#state = 'loading';
		try {
			const settings = await this.#data.load({ signal: controller.signal });
			if (settings === null) {
				this.#state = 'unavailable';
				return;
			}
			this.#settings = settings;
			this.#state = 'ready';
			this.#error = null;
		} catch (error) {
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			this.#state = 'error';
			this.#error = failure.message;
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/**
	 * Saves the list of one kind; answers null or the text of the failure, which stays at the
	 * list. `announcement` is the text of the success flag.
	 */
	async save(
		kind: ImportKind,
		list: ImportKeywordList,
		announcement: string
	): Promise<string | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			this.#settings = await this.#data.save({ ...this.#settings, [kind]: list });
			this.#flags.show({ tone: 'success', title: announcement });
			return null;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			const fields = Object.values(failure.fields);
			return fields.length > 0 ? (fields[0]?.message ?? failure.message) : failure.message;
		}
	}

	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#state = 'idle';
		this.#error = null;
		this.#settings = EMPTY_IMPORT_KEYWORDS;
	}
}
