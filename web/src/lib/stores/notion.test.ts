// Store of the Notion import (ADR-0041, plan notion-import NI-2) on a fake data layer: the import in
// blocks with progress, entries the server hands back, a stop at an error that keeps what came
// before and is never silent, a stop on request, one run at a time (fix 2026-09-30), several
// sources in one run and "Alle erneut abrufen" with progress, stop and a result per source
// (addendum of 2026-10-01), "Erneut abrufen" with the options of the last import and only new
// entries, the check with its flag, and a lost session.

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

const PAGE = '00000000-0000-4000-8000-0000000000aa';
const DATABASE = '00000000-0000-4000-8000-0000000000bb';

function request(refs: string[], source = PAGE): NotionImportRequest {
	return {
		source: { type: source === PAGE ? 'page' : 'data_source', id: source },
		refs,
		skipDone: true,
		copyContent: false,
		dateProperty: null,
		subpages: false
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
	id: DATABASE,
	type: 'data_source',
	title: 'Aufgaben',
	url: 'https://www.notion.so/db',
	count: 2,
	last: '2026-09-29 10:00:00.000Z',
	dateProperty: 'Erinnerung',
	copyContent: true,
	subpages: false
};

const PAGE_SOURCE: NotionImportedSource = {
	id: PAGE,
	type: 'page',
	title: 'Wochenplan',
	url: 'https://www.notion.so/w',
	count: 4,
	last: '2026-09-29 10:00:00.000Z',
	dateProperty: '',
	copyContent: false,
	subpages: true
};

function setup() {
	const data = fakeNotionData();
	const flags = new FlagStore();
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	return { data, flags, session, store: new NotionStore(data, session, flags) };
}

/** An import of one source; the outcome of that source, or null when the run ended without one. */
async function runOne(
	store: NotionStore,
	refs: string[],
	size: number,
	options: { onblock?: (results: NotionImportResult[]) => void; stop?: AbortSignal } = {}
) {
	const run = await store.runImports(CONN, [{ request: request(refs), size }], {
		stop: options.stop,
		onblock: (_source, results) => options.onblock?.(results)
	});
	return run === null ? null : (run.runs[0]?.run ?? null);
}

describe('NotionStore', () => {
	it('imports in blocks with progress and reloads the imported sources', async () => {
		const { store, data } = setup();
		const blocks: string[][] = [];
		const run = await runOne(store, ['a', 'b', 'c', 'd', 'e'], 2, {
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
		const run = await runOne(store, ['a', 'b', 'c', 'd'], 3);
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
		const run = await runOne(store, ['a', 'b', 'c', 'd', 'e'], 2);
		expect(data.importBatch).toHaveBeenCalledTimes(2);
		expect(run).toMatchObject({
			counts: { created: 2 },
			error: 'Notion lehnt den Token ab (401).',
			reason: 'connection',
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
			const run = await runOne(store, ['a', 'b'], 10);
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
		expect((await runOne(store, ['a'], 10))?.error).toContain('Zeitüberschreitung');
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
		const run = await runOne(store, ['a', 'b', 'c', 'd', 'e'], 2, { stop: stop.signal });
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
		const first = runOne(store, ['a'], 10);
		await vi.waitFor(() => expect(store.isImporting(CONN)).toBe(true));
		expect(await runOne(store, ['a'], 10)).toBeNull();
		expect(await store.refetch(CONN, SOURCE)).toBeNull();
		release();
		expect((await first)?.counts.created).toBe(1);
		expect(data.importBatch).toHaveBeenCalledOnce();
		expect(store.isImporting(CONN)).toBe(false);
	});

	it('ends an import without a result when the session is gone, logging out once', async () => {
		const { store, data, session } = setup();
		data.importBatch.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		expect(await runOne(store, ['a'], 10)).toBeNull();
		expect(session.logout).toHaveBeenCalledOnce();

		const expired = setup();
		expired.session.ensureValid.mockReturnValue(false);
		expect(await runOne(expired.store, ['a'], 10)).toBeNull();
		expect(expired.data.importBatch).not.toHaveBeenCalled();
		expect(expired.session.logout).not.toHaveBeenCalled();
	});

	it('takes several sources in one run; an error of one source ends only that one', async () => {
		const { store, data } = setup();
		data.importBatch.mockImplementation(async (_id, sent) =>
			sent.source.id === DATABASE
				? {
						kind: 'error',
						message: 'Diese Quelle ist nicht freigegeben oder gelöscht (404).',
						reason: 'source',
						partial: null
					}
				: {
						kind: 'ok',
						value: { items: created(...sent.refs), counts: counts(sent.refs.length), pending: [] }
					}
		);
		const blocks: [string, string[]][] = [];
		const run = await store.runImports(
			CONN,
			[
				{ request: request(['d1', 'd2'], DATABASE), size: 10 },
				{ request: request(['p1', 'p2', 'p3'], PAGE), size: 2 }
			],
			{ onblock: (source, results) => blocks.push([source, results.map((result) => result.ref)]) }
		);
		expect(run?.error).toBeNull();
		expect(run?.runs.map(({ key, run: one }) => [key, one.counts.created, one.error])).toEqual([
			[DATABASE, 0, 'Diese Quelle ist nicht freigegeben oder gelöscht (404).'],
			[PAGE, 3, null]
		]);
		expect(blocks).toEqual([
			[PAGE, ['p1', 'p2']],
			[PAGE, ['p3']]
		]);
	});

	it('ends a run over several sources at an error of the connection, the rest does not start', async () => {
		const { store, data } = setup();
		data.importBatch.mockResolvedValueOnce({
			kind: 'error',
			message: 'Notion lehnt den Token ab (401).',
			reason: 'connection',
			partial: null
		});
		const run = await store.runImports(CONN, [
			{ request: request(['d1'], DATABASE), size: 10 },
			{ request: request(['p1'], PAGE), size: 10 }
		]);
		expect(run).toMatchObject({ error: 'Notion lehnt den Token ab (401).', skipped: [PAGE] });
		expect(data.importBatch).toHaveBeenCalledOnce();
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
			{
				source: { type: 'data_source', id: SOURCE.id },
				dateProperty: 'Erinnerung',
				subpages: false
			},
			{}
		);
		expect(data.importBatch).toHaveBeenCalledWith(CONN, {
			source: { type: 'data_source', id: SOURCE.id },
			refs: ['b'],
			skipDone: true,
			copyContent: true,
			dateProperty: 'Erinnerung',
			subpages: false
		});
		expect(flags.flags[0]).toMatchObject({
			tone: 'success',
			title: '„Aufgaben“: 1 angelegt, 2 schon vorhanden, 1 übersprungen.'
		});
		expect(store.refetching(CONN)).toBeNull();
		expect(store.refetchResult(CONN, SOURCE.id)).toMatchObject({
			counts: { created: 1, duplicates: 2, skipped: 1 },
			error: null
		});
	});

	it('reads the sub-pages again when the last import of a page had them', async () => {
		const { store, data } = setup();
		data.preview.mockResolvedValueOnce({
			kind: 'ok',
			value: { ...EMPTY_PREVIEW, items: [item('u1', { kind: 'todo' })] }
		});
		await store.refetch(CONN, PAGE_SOURCE);
		expect(data.preview).toHaveBeenCalledWith(
			CONN,
			{ source: { type: 'page', id: PAGE }, dateProperty: null, subpages: true },
			{}
		);
		expect(data.importBatch.mock.calls[0]?.[1]).toMatchObject({ refs: ['u1'], subpages: true });
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
		expect(flags.flags[0]).toMatchObject({
			tone: 'error',
			title: '„Aufgaben“: Diese Quelle ist nicht freigegeben oder gelöscht (404).'
		});
	});

	it('takes every source again with "Alle erneut abrufen": progress, a result per source, one flag', async () => {
		const { store, data, flags } = setup();
		data.imports.mockResolvedValue([SOURCE, PAGE_SOURCE]);
		await store.loadImports(CONN);
		const seen: (string | null)[] = [];
		let release: () => void = () => undefined;
		data.preview.mockImplementation(async (_id, sent) => {
			seen.push(store.refetchProgress(CONN)?.title ?? null);
			if (sent.source.id === DATABASE) {
				await new Promise<void>((resolve) => (release = resolve));
				return { kind: 'ok', value: { ...EMPTY_PREVIEW, items: [item('r1'), item('r2')] } };
			}
			return { kind: 'error', message: 'Notion bremst gerade (429).', reason: 'source' };
		});
		const running = store.refetchAll(CONN);
		await vi.waitFor(() =>
			expect(store.refetchProgress(CONN)).toEqual({ index: 1, total: 2, title: 'Aufgaben' })
		);
		expect(store.isImporting(CONN)).toBe(true);
		release();
		await running;
		expect(seen).toEqual(['Aufgaben', 'Wochenplan']);
		expect(store.refetchProgress(CONN)).toBeNull();
		expect(store.refetchResult(CONN, DATABASE)).toMatchObject({
			counts: { created: 2 },
			error: null
		});
		expect(store.refetchResult(CONN, PAGE)).toMatchObject({ error: 'Notion bremst gerade (429).' });
		expect(flags.flags[0]).toMatchObject({
			tone: 'success',
			title: '2 Quellen erneut abgerufen: 2 angelegt; 1 Quelle mit Fehler.'
		});
	});

	it('stops "Alle erneut abrufen" after the current block; the next source does not start', async () => {
		const { store, data, flags } = setup();
		data.imports.mockResolvedValue([SOURCE, PAGE_SOURCE]);
		await store.loadImports(CONN);
		const items = Array.from({ length: 12 }, (_, index) => item(`r${index}`));
		data.preview.mockResolvedValue({ kind: 'ok', value: { ...EMPTY_PREVIEW, items } });
		data.importBatch.mockImplementation(async (_id, sent) => {
			store.stopRefetch(CONN);
			expect(store.isStopping(CONN)).toBe(true);
			return {
				kind: 'ok',
				value: { items: created(...sent.refs), counts: counts(sent.refs.length), pending: [] }
			};
		});
		await store.refetchAll(CONN);
		expect(data.importBatch).toHaveBeenCalledOnce();
		expect(data.preview).toHaveBeenCalledOnce();
		expect(store.refetchResult(CONN, DATABASE)).toMatchObject({ counts: { created: 5 }, open: 7 });
		expect(store.refetchResult(CONN, PAGE)).toBeNull();
		expect(store.isStopping(CONN)).toBe(false);
		expect(flags.flags[0]?.title).toBe('1 Quelle erneut abgerufen: 5 angelegt; angehalten.');
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
