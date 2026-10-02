// Folder channel on the page "Kanäle" (ADR-0051 §7; ADR-0006): the details of each card (per folder
// its files, the last change, problems) from what the runs of the server stored, loaded with the
// card and after every run; the files of before of a folder and taking chosen ones into the inbox
// in blocks ("Vorhandene Dateien übernehmen"). Nothing here reads a file. Results go out as flags
// (ADR-0025 section 8); a lost session logs out once.

import type PocketBase from 'pocketbase';
import { SvelteMap } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import { adoptFiles, getFolderDetails, listExistingFiles } from '$lib/data/folders';
import type { RequestOptions } from '$lib/data/options';
import {
	FOLDER_LIMITS,
	adoptSummary,
	type AdoptResult,
	type ExistingFiles,
	type FolderDetails
} from '$lib/domain/folders';
import { restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface FoldersData {
	details(id: string, options: RequestOptions): Promise<FolderDetails>;
	existing(id: string, folder: string, options: RequestOptions): Promise<ExistingFiles>;
	adopt(id: string, folder: string, paths: readonly string[]): Promise<AdoptResult>;
}

export function foldersData(pb: PocketBase): FoldersData {
	return {
		details: (id, options) => getFolderDetails(pb, id, options),
		existing: (id, folder, options) => listExistingFiles(pb, id, folder, options),
		adopt: (id, folder, paths) => adoptFiles(pb, id, folder, paths)
	};
}

/** Shown while the server does not know the routes of the folders yet (before the restart). */
export const FOLDERS_UNAVAILABLE_MESSAGE = restartNeeded('Die Details der Ordner sind');

/** The details of a card: loaded, or why not. */
export type FolderDetailsState =
	{ kind: 'ready'; details: FolderDetails } | { kind: 'error'; message: string };

/** The files of before of a folder: loaded, or why not. */
export type ExistingFilesState =
	{ kind: 'ready'; list: ExistingFiles } | { kind: 'error'; message: string };

/** The end of taking files over: the sum of every block and, if a block failed, why. */
export interface AdoptOutcome {
	result: AdoptResult;
	error: string | null;
}

export class FoldersStore {
	readonly #data: FoldersData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #details = new SvelteMap<string, FolderDetailsState>();

	constructor(data: FoldersData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	/** The details of a connection, null until loaded. */
	details(id: string): FolderDetailsState | null {
		return this.#details.get(id) ?? null;
	}

	#message(error: unknown, signal?: AbortSignal): string | null {
		const failure = toDataError(error, signal);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		return failure.kind === 'not_found' ? FOLDERS_UNAVAILABLE_MESSAGE : failure.message;
	}

	/**
	 * Loads the details of a connection; a failure stays as its message (the card says it), loaded
	 * details of before stay until then. Nothing on an aborted request.
	 */
	async loadDetails(id: string, options: RequestOptions = {}): Promise<void> {
		if (!this.#session.ensureValid()) return;
		try {
			this.#details.set(id, { kind: 'ready', details: await this.#data.details(id, options) });
		} catch (error) {
			const message = this.#message(error, options.signal);
			if (message !== null) this.#details.set(id, { kind: 'error', message });
		}
	}

	/** The files of the base of one folder; null on an aborted request or a lost session. */
	async loadExisting(
		id: string,
		folder: string,
		options: RequestOptions = {}
	): Promise<ExistingFilesState | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			return { kind: 'ready', list: await this.#data.existing(id, folder, options) };
		} catch (error) {
			const message = this.#message(error, options.signal);
			return message === null ? null : { kind: 'error', message };
		}
	}

	/**
	 * Takes the chosen files of one folder into the inbox, in blocks of FOLDER_LIMITS.adoptBatch;
	 * `onprogress` hears the files done so far. Ends at the first failed block (the rest stays
	 * chosen), announces the sum as a flag and loads the details again. null when the session ended.
	 */
	async adopt(
		id: string,
		folder: string,
		paths: readonly string[],
		label: string,
		onprogress: (done: number) => void = () => {}
	): Promise<AdoptOutcome | null> {
		if (!this.#session.ensureValid()) return null;
		const sum: AdoptResult = { created: 0, duplicates: 0, skipped: 0, failed: 0 };
		let error: string | null = null;
		for (let start = 0; start < paths.length; start += FOLDER_LIMITS.adoptBatch) {
			const block = paths.slice(start, start + FOLDER_LIMITS.adoptBatch);
			try {
				const result = await this.#data.adopt(id, folder, block);
				sum.created += result.created;
				sum.duplicates += result.duplicates;
				sum.skipped += result.skipped;
				sum.failed += result.failed;
				onprogress(Math.min(start + block.length, paths.length));
			} catch (failure) {
				error = this.#message(failure);
				if (error === null) return null;
				break;
			}
		}
		const done = sum.created + sum.duplicates + sum.skipped + sum.failed;
		if (done > 0) {
			this.#flags.show({ tone: 'success', title: `„${label}“: ${adoptSummary(sum)}` });
		}
		await this.loadDetails(id);
		return { result: sum, error };
	}

	reset(): void {
		this.#details.clear();
	}
}
