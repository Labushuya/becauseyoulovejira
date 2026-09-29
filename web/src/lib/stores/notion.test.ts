// Store of the Notion import (ADR-0041, plan notion-import NI-2) on a fake data layer: the import in
// blocks with progress, entries the server hands back, a stop at an error that keeps what came
// before and is never silent, a stop on request, one run at a time (fix 2026-09-30), "Erneut
// abrufen" with the options of the last import and only new entries, the check with its flag, and
// a lost session.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type {
	NotionImportRequest,
	NotionImportResult,
	NotionImportedSource,
	NotionPreviewItem
} from '$lib/domain/notion';
import { EMPTY_PREVIEW, fakeNotionData } from '$lib/test/notion-fake';
import { FlagStore } from './flags.svelte';
import { NotionStore } from './notion.svelte';

function request(refs: string[]): NotionImportRequest {
	return {
		source: { type: 'page', id: '00000000-0000-4000-8000-0000000000aa' },
		refs,
		skipDone: true,
		copyContent: false,
		dateProperty: null
	};
}

function created(...refs: string[]): NotionImportResult[] {
	return refs.map((ref) => ({ ref, status: 'created', message: '' }));
}

function counts(created: number) {
	return { created, duplicates: 0, skipped: 0, failed: 0 };
}

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
	it('imports in blocks with progress and reloads the imported sources', async () => {
		const { store, data } = setup();
		const blocks: string[][] = [];
		const run = await store.runImport(CONN, request(['a', 'b', 'c', 'd', 'e']), 2, {
			onblock: (results) => blocks.push(results.map((result) => result.ref))
		});
		expect(data.importBatch.mock.calls.map(([, sent]) => sent.refs)).toEqual([
			['a', 'b'],
			['c', 'd'],
			['e']
		]);
		expect(blocks).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
		expect(run).toMatchObject({ counts: { created: 5 }, error: null, stopped: false, open: [] });
		expect(data.imports).toHaveBeenCalledWith(CONN, {});
	});

	it('sends entries the server handed back again, first in line', async () => {
		const { store, data } = setup();
		data.importBatch.mockResolvedValueOnce({
			kind: 'ok',
			value: { items: created('a'), counts: counts(1), pending: ['b', 'c'] }
		});
		const run = await store.runImport(CONN, request(['a', 'b', 'c', 'd']), 3);
		expect(data.importBatch.mock.calls.map(([, sent]) => sent.refs)).toEqual([
			['a', 'b', 'c'],
			['b', 'c', 'd']
		]);
		expect(run).toMatchObject({ counts: { created: 4 }, error: null, open: [] });
	});

	it('stops at an error of Notion, keeps what came before and what the error still took', async () => {
		const { store, data } = setup();
		data.importBatch
			.mockResolvedValueOnce({
				kind: 'ok',
				value: { items: created('a'), counts: counts(1), pending: [] }
			})
			.mockResolvedValueOnce({
				kind: 'error',
				message: 'Notion lehnt den Token ab (401).',
				reason: 'connection',
				partial: { items: created('b'), counts: counts(1), pending: [] }
			});
		const run = await store.runImport(CONN, request(['a', 'b', 'c', 'd', 'e']), 2);
		expect(data.importBatch).toHaveBeenCalledTimes(2);
		expect(run).toMatchObject({
			counts: { created: 2 },
			error: 'Notion lehnt den Token ab (401).',
			open: ['c', 'd', 'e']
		});
		expect(run?.results.map((result) => result.ref)).toEqual(['a', 'b']);
	});

	it('names a failure of the network, the time limit or an abort instead of staying silent', async () => {
		for (const failure of [
			new DataError('network'),
			new DataError('aborted'),
			Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
		]) {
			const { store, data } = setup();
			data.importBatch.mockRejectedValueOnce(failure);
			const run = await store.runImport(CONN, request(['a', 'b']), 10);
			expect(run?.error, String(failure)).toMatch(/^(Server nicht erreichbar|Die Anfrage wurde)/);
			expect(run).toMatchObject({ counts: { created: 0 }, open: ['a', 'b'] });
		}
		const { store, data } = setup();
		data.importBatch.mockResolvedValueOnce({
			kind: 'error',
			message: 'Der Server hat nicht innerhalb von 2,5 Minuten geantwortet (Zeitüberschreitung).',
			reason: '',
			partial: null
		});
		expect((await store.runImport(CONN, request(['a']), 10))?.error).toContain(
			'Zeitüberschreitung'
		);
	});

	it('stops after the current block on request and leaves the rest open', async () => {
		const { store, data } = setup();
		const stop = new AbortController();
		data.importBatch.mockImplementationOnce(async (_id, sent) => {
			stop.abort();
			return {
				kind: 'ok',
				value: { items: created(...sent.refs), counts: counts(sent.refs.length), pending: [] }
			};
		});
		const run = await store.runImport(CONN, request(['a', 'b', 'c', 'd', 'e']), 2, {
			stop: stop.signal
		});
		expect(data.importBatch).toHaveBeenCalledOnce();
		expect(run).toMatchObject({
			counts: { created: 2 },
			error: null,
			stopped: true,
			open: ['c', 'd', 'e']
		});
	});

	it('runs one import per connection at a time', async () => {
		const { store, data } = setup();
		let release: () => void = () => undefined;
		data.importBatch.mockImplementationOnce(async (_id, sent) => {
			await new Promise<void>((resolve) => (release = resolve));
			return {
				kind: 'ok',
				value: { items: created(...sent.refs), counts: counts(sent.refs.length), pending: [] }
			};
		});
		const first = store.runImport(CONN, request(['a']), 10);
		await vi.waitFor(() => expect(store.isImporting(CONN)).toBe(true));
		expect(await store.runImport(CONN, request(['a']), 10)).toBeNull();
		release();
		expect((await first)?.counts.created).toBe(1);
		expect(data.importBatch).toHaveBeenCalledOnce();
		expect(store.isImporting(CONN)).toBe(false);
	});

	it('ends an import without a result when the session is gone, logging out once', async () => {
		const { store, data, session } = setup();
		data.importBatch.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		expect(await store.runImport(CONN, request(['a']), 10)).toBeNull();
		expect(session.logout).toHaveBeenCalledOnce();

		const expired = setup();
		expired.session.ensureValid.mockReturnValue(false);
		expect(await expired.store.runImport(CONN, request(['a']), 10)).toBeNull();
		expect(expired.data.importBatch).not.toHaveBeenCalled();
		expect(expired.session.logout).not.toHaveBeenCalled();
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

	it('takes the page content along in blocks of 5, without it in blocks of 10', async () => {
		const { store, data } = setup();
		const items = Array.from({ length: 12 }, (_, index) => item(`r${index}`));
		data.preview.mockResolvedValue({ kind: 'ok', value: { ...EMPTY_PREVIEW, items } });
		await store.refetch(CONN, SOURCE);
		expect(data.importBatch.mock.calls.map(([, sent]) => sent.refs.length)).toEqual([5, 5, 2]);
		data.importBatch.mockClear();
		await store.refetch(CONN, { ...SOURCE, copyContent: false });
		expect(data.importBatch.mock.calls.map(([, sent]) => sent.refs.length)).toEqual([10, 2]);
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
