// Fake data layer of the Notion import (ADR-0041) for component tests: every call answers from a
// fixed value unless a test replaces it. `notionStoreOf` builds the store with a session that stays
// valid, so tests of the page "Kanäle" that do not look at Notion get an inert store.

import { vi } from 'vitest';
import type { NotionPreview } from '$lib/domain/notion';
import { FlagStore } from '$lib/stores/flags.svelte';
import { NotionStore, type NotionData } from '$lib/stores/notion.svelte';

export const EMPTY_PREVIEW: NotionPreview = {
	source: {
		id: '00000000-0000-4000-8000-000000000001',
		type: 'page',
		title: 'Wochenplan',
		url: ''
	},
	dateProperties: [],
	dateProperty: '',
	items: [],
	truncated: false,
	blankPoints: 0,
	limits: {
		maxRows: 1000,
		importBatch: 100,
		contentBlocks: 500,
		contentChars: 50_000,
		treeBlocks: 5000
	}
};

/** A data layer with spies; a test changes single calls with mockImplementation and the like. */
export function fakeNotionData() {
	return {
		check: vi.fn<NotionData['check']>(async () => ({
			kind: 'ok' as const,
			value: { workspace: 'Beispiel', bot: 'becauseyoulovejira', shared: true }
		})),
		sources: vi.fn<NotionData['sources']>(async () => ({
			kind: 'ok' as const,
			value: { sources: [], truncated: false }
		})),
		imports: vi.fn<NotionData['imports']>(async () => []),
		preview: vi.fn<NotionData['preview']>(async () => ({
			kind: 'ok' as const,
			value: EMPTY_PREVIEW
		})),
		importBatch: vi.fn<NotionData['importBatch']>(async (_id, request) => ({
			kind: 'ok' as const,
			value: {
				items: request.refs.map((ref) => ({ ref, status: 'created' as const, message: '' })),
				counts: { created: request.refs.length, duplicates: 0, skipped: 0, failed: 0 },
				pending: []
			}
		}))
	} satisfies NotionData;
}

/** The fake data layer as `fakeNotionData` returns it. */
export type FakeNotionData = ReturnType<typeof fakeNotionData>;

/** The store on a fake data layer (inert by default), with a valid session. */
export function notionStoreOf(
	data: NotionData = fakeNotionData(),
	flags: FlagStore = new FlagStore()
): NotionStore {
	return new NotionStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
}
