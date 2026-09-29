// Store of the Notion import (ADR-0041, plan notion-import NI-2) on a fake data layer: the import in
// batches with progress and a stop at an error, "Erneut abrufen" with the options of the last
// import and only new entries, the check with its flag, and a lost session.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { NotionImportedSource, NotionPreviewItem } from '$lib/domain/notion';
import { EMPTY_PREVIEW, fakeNotionData } from '$lib/test/notion-fake';
import { FlagStore } from './flags.svelte';
import { NotionStore } from './notion.svelte';

const CONN = 'conn00000000009';

function item(ref: string, overrides: Partial<NotionPreviewItem> = {}): NotionPreviewItem {
	return {
		ref,
		kind: 'task',
		title: `Zeile ${ref}`,
		sourceDate: null,
		allDay: false,
		excerpt: '',
		section: '',
		done: false,
		url: '',
		state: '',
		message: '',
		...overrides
	};
}

const SOURCE: NotionImportedSource = {
	id: '00000000-0000-4000-8000-0000000000aa',
	type: 'data_source',
	title: 'Aufgaben',
	url: 'https://www.notion.so/db',
	count: 2,
	last: '2026-09-29 10:00:00.000Z',
	dateProperty: 'Erinnerung',
	copyContent: true
};

function setup() {
	const data = fakeNotionData();
	const flags = new FlagStore();
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	return { data, flags, session, store: new NotionStore(data, session, flags) };
}

describe('NotionStore', () => {
	it('imports in batches with progress and reloads the imported sources', async () => {
		const { store, data } = setup();
		const progress: number[] = [];
		const run = await store.runImport(
			CONN,
			{
				source: { type: 'page', id: SOURCE.id },
				refs: ['a', 'b', 'c', 'd', 'e'],
				skipDone: true,
				copyContent: false,
				dateProperty: null
			},
			2,
			(count) => progress.push(count)
		);
		expect(data.importBatch.mock.calls.map(([, request]) => request.refs)).toEqual([
			['a', 'b'],
			['c', 'd'],
			['e']
		]);
		expect(progress).toEqual([2, 4, 5]);
		expect(run).toMatchObject({ counts: { created: 5 }, error: null });
		expect(data.imports).toHaveBeenCalledWith(CONN, {});
	});

	it('stops at an error of Notion and keeps what came before', async () => {
		const { store, data } = setup();
		data.importBatch
			.mockResolvedValueOnce({
				kind: 'ok',
				value: {
					items: [{ ref: 'a', status: 'created', message: '' }],
					counts: { created: 1, duplicates: 0, skipped: 0, failed: 0 }
				}
			})
			.mockResolvedValueOnce({
				kind: 'error',
				message: 'Notion lehnt den Token ab (401).',
				reason: 'connection'
			});
		const run = await store.runImport(
			CONN,
			{
				source: { type: 'page', id: SOURCE.id },
				refs: ['a', 'b', 'c'],
				skipDone: true,
				copyContent: false,
				dateProperty: null
			},
			1
		);
		expect(data.importBatch).toHaveBeenCalledTimes(2);
		expect(run).toMatchObject({
			counts: { created: 1 },
			error: 'Notion lehnt den Token ab (401).'
		});
	});

	it('takes only new entries again, with the options of the last import', async () => {
		const { store, data, flags } = setup();
		data.preview.mockResolvedValueOnce({
			kind: 'ok',
			value: {
				...EMPTY_PREVIEW,
				items: [
					item('a', { state: 'new', message: 'Schon im Eingang.' }),
					item('b'),
					item('c', { done: true }),
					item('d', { state: 'discarded', message: 'Schon verworfen.' })
				]
			}
		});
		expect(await store.refetch(CONN, SOURCE)).toBeNull();
		expect(data.preview).toHaveBeenCalledWith(
			CONN,
			{ type: 'data_source', id: SOURCE.id },
			'Erinnerung',
			{ signal: undefined }
		);
		expect(data.importBatch).toHaveBeenCalledWith(CONN, {
			source: { type: 'data_source', id: SOURCE.id },
			refs: ['b'],
			skipDone: true,
			copyContent: true,
			dateProperty: 'Erinnerung'
		});
		expect(flags.flags[0]).toMatchObject({
			tone: 'success',
			title: '„Aufgaben“: 1 angelegt, 2 schon vorhanden, 1 übersprungen.'
		});
		expect(store.refetching(CONN)).toBeNull();
	});

	it('takes the page content along in batches of 10, without it in batches of the server', async () => {
		const { store, data } = setup();
		const items = Array.from({ length: 12 }, (_, index) => item(`r${index}`));
		data.preview.mockResolvedValue({ kind: 'ok', value: { ...EMPTY_PREVIEW, items } });
		await store.refetch(CONN, SOURCE);
		expect(data.importBatch.mock.calls.map(([, request]) => request.refs.length)).toEqual([10, 2]);
		data.importBatch.mockClear();
		await store.refetch(CONN, { ...SOURCE, copyContent: false });
		expect(data.importBatch.mock.calls.map(([, request]) => request.refs.length)).toEqual([12]);
	});

	it('says "keine neuen Einträge" without asking to import, and names a failed preview', async () => {
		const { store, data, flags } = setup();
		data.preview.mockResolvedValueOnce({
			kind: 'ok',
			value: { ...EMPTY_PREVIEW, items: [item('a', { state: 'new', message: 'x' })] }
		});
		await store.refetch(CONN, SOURCE);
		expect(data.importBatch).not.toHaveBeenCalled();
		expect(flags.flags[0]).toMatchObject({
			tone: 'info',
			title: '„Aufgaben“: keine neuen Einträge.'
		});

		data.preview.mockResolvedValueOnce({
			kind: 'error',
			message: 'Diese Quelle ist nicht freigegeben oder gelöscht (404).',
			reason: 'source'
		});
		expect(await store.refetch(CONN, SOURCE)).toBe(
			'Diese Quelle ist nicht freigegeben oder gelöscht (404).'
		);
		expect(flags.flags[0]).toMatchObject({ tone: 'error' });
	});

	it('announces the check and remembers it for the page', async () => {
		const { store, flags } = setup();
		const outcome = await store.check(CONN, 'Notion');
		expect(outcome).toEqual({
			kind: 'ok',
			value: { workspace: 'Beispiel', bot: 'becauseyoulovejira', shared: true }
		});
		expect(store.lastCheck(CONN)).toEqual(outcome);
		expect(flags.flags[0]).toMatchObject({ tone: 'success' });
		expect(flags.flags[0]?.title).toMatch(/^„Notion“: Verbunden mit dem Arbeitsbereich „Beispiel“/);
		expect(store.isChecking(CONN)).toBe(false);
	});

	it('logs out once when the session is gone', async () => {
		const { store, data, session } = setup();
		data.check.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		expect(await store.check(CONN, 'Notion')).toBeNull();
		expect(session.logout).toHaveBeenCalledOnce();
	});
});
