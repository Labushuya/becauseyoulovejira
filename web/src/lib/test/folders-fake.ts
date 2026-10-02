// Fake data layer of the folder channel (ADR-0051) for component tests: every call answers from a
// fixed value unless a test replaces it. `foldersStoreOf` builds the store with a session that stays
// valid, so tests of the page "Kanäle" that do not look at folders get an inert store.

import { vi } from 'vitest';
import type { AdoptResult, ExistingFiles, FolderDetails } from '$lib/domain/folders';
import { FlagStore } from '$lib/stores/flags.svelte';
import { FoldersStore, type FoldersData } from '$lib/stores/folders.svelte';

export const EMPTY_FOLDER_DETAILS: FolderDetails = {
	interval: 5,
	platform: 'windows',
	limit: 2000,
	folders: []
};

export const EMPTY_EXISTING: ExistingFiles = { folder: '', name: '', base: true, files: [] };

export const NO_ADOPT: AdoptResult = { created: 0, duplicates: 0, skipped: 0, failed: 0 };

/** A data layer with spies; a test changes single calls with mockImplementation and the like. */
export function fakeFoldersData() {
	return {
		details: vi.fn<FoldersData['details']>(async () => EMPTY_FOLDER_DETAILS),
		existing: vi.fn<FoldersData['existing']>(async () => EMPTY_EXISTING),
		adopt: vi.fn<FoldersData['adopt']>(async () => NO_ADOPT)
	} satisfies FoldersData;
}

/** The fake data layer as `fakeFoldersData` returns it. */
export type FakeFoldersData = ReturnType<typeof fakeFoldersData>;

/** The store on a fake data layer (inert by default), with a valid session. */
export function foldersStoreOf(
	data: FoldersData = fakeFoldersData(),
	flags: FlagStore = new FlagStore()
): FoldersStore {
	return new FoldersStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
}
