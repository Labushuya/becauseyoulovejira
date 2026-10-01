// The loop of an import in blocks (stores/notion-run.ts, ADR-0041 addendum 2026-09-30) with a fake
// sender: a server that answers without any result must not keep the loop going, answers for
// entries of another block count for nothing, and a thrown error ends the run with its message or,
// when `failure` says so, without a result. Since the addendum of 2026-10-01 also the loops over
// several sources (`runSources`) and "Alle erneut abrufen" (`refetchSources`).

import { describe, expect, it, vi } from 'vitest';
import {
	NOTION_NO_PROGRESS_MESSAGE,
	type NotionImportOutcome,
	type NotionImportRequest,
	type NotionImportedSource,
	type NotionOutcome,
	type NotionPreview,
	type NotionPreviewItem,
	type NotionPreviewRequest
} from '$lib/domain/notion';
import { EMPTY_PREVIEW } from '$lib/test/notion-fake';
import { refetchSources, runInBlocks, runSources } from './notion-run';

const failure = () => 'Fehler';

/** A server that takes every entry. */
async function takeAll(refs: readonly string[]): Promise<NotionImportOutcome> {
	return {
		kind: 'ok',
		value: {
			items: refs.map((ref) => ({ ref, status: 'created', message: '' })),
			counts: { created: refs.length, duplicates: 0, skipped: 0, failed: 0 },
			pending: []
		}
	};
}

function refusing(reason: '' | 'source' | 'connection'): () => Promise<NotionImportOutcome> {
	return async () => ({ kind: 'error', message: `Fehler (${reason})`, reason, partial: null });
}

describe('runInBlocks', () => {
	it('stops with a message when a block comes back without any result', async () => {
		const send = vi.fn(async (refs: string[]): Promise<NotionImportOutcome> => ({
			kind: 'ok',
			value: {
				items: [],
				counts: { created: 0, duplicates: 0, skipped: 0, failed: 0 },
				pending: refs
			}
		}));
		const run = await runInBlocks(send, ['a', 'b', 'c'], 2, { failure });
		expect(send).toHaveBeenCalledOnce();
		expect(run).toMatchObject({
			error: NOTION_NO_PROGRESS_MESSAGE,
			open: ['a', 'b', 'c'],
			requests: 1
		});
	});

	it('takes only answers for the entries of the block', async () => {
		const run = await runInBlocks(
			async (refs) => ({
				kind: 'ok',
				value: {
					items: [...refs, 'x'].map((ref) => ({ ref, status: 'created', message: '' })),
					counts: { created: refs.length + 1, duplicates: 0, skipped: 0, failed: 0 },
					pending: []
				}
			}),
			['a', 'b'],
			5,
			{ failure }
		);
		expect(run?.results.map((result) => result.ref)).toEqual(['a', 'b']);
		expect(run?.counts.created).toBe(2);
	});

	it('ends with the message of a thrown error, or without a result when asked to', async () => {
		const send = async (): Promise<NotionImportOutcome> => {
			throw new Error('kaputt');
		};
		expect(await runInBlocks(send, ['a'], 1, { failure })).toMatchObject({
			error: 'Fehler',
			open: ['a']
		});
		expect(await runInBlocks(send, ['a'], 1, { failure: () => null })).toBeNull();
	});
});

describe('runSources', () => {
	it('goes on after an error of one source and reports every source with its blocks', async () => {
		const blocks: [string, number][] = [];
		const run = await runSources(
			[
				{ key: 'a', refs: ['a1', 'a2', 'a3'], size: 2, send: takeAll },
				{ key: 'b', refs: ['b1'], size: 2, send: refusing('source') },
				{ key: 'c', refs: ['c1'], size: 2, send: takeAll }
			],
			{ onblock: (key, results) => blocks.push([key, results.length]), failure }
		);
		expect(blocks).toEqual([
			['a', 2],
			['a', 1],
			['c', 1]
		]);
		expect(run).toMatchObject({ error: null, stopped: false, skipped: [] });
		expect(run?.runs.map(({ key, run: one }) => [key, one.counts.created, one.error])).toEqual([
			['a', 3, null],
			['b', 0, 'Fehler (source)'],
			['c', 1, null]
		]);
	});

	it('ends at an error of the connection or a stop; the rest does not start', async () => {
		const third = vi.fn(takeAll);
		const ended = await runSources(
			[
				{ key: 'a', refs: ['a1'], size: 2, send: refusing('connection') },
				{ key: 'b', refs: ['b1'], size: 2, send: third }
			],
			{ failure }
		);
		expect(ended).toMatchObject({ error: 'Fehler (connection)', stopped: false, skipped: ['b'] });
		expect(third).not.toHaveBeenCalled();

		const stop = new AbortController();
		const stopped = await runSources(
			[
				{
					key: 'a',
					refs: ['a1', 'a2'],
					size: 1,
					send: async (refs) => {
						stop.abort();
						return takeAll(refs);
					}
				},
				{ key: 'b', refs: ['b1'], size: 1, send: third }
			],
			{ stop: stop.signal, failure }
		);
		expect(stopped).toMatchObject({ error: null, stopped: true, skipped: ['b'] });
		expect(stopped?.runs[0]?.run.open).toEqual(['a2']);
		expect(third).not.toHaveBeenCalled();

		const thrown = await runSources([{ key: 'a', refs: ['a1'], size: 1, send: refusing('') }], {
			failure: () => null
		});
		expect(thrown?.error).toBe('Fehler ()');
		expect(
			await runSources(
				[
					{
						key: 'a',
						refs: ['a1'],
						size: 1,
						send: async () => {
							throw new Error('Sitzung');
						}
					}
				],
				{ failure: () => null }
			)
		).toBeNull();
	});
});

describe('refetchSources', () => {
	function source(id: string, overrides: Partial<NotionImportedSource> = {}): NotionImportedSource {
		return {
			id,
			type: 'page',
			title: `Liste ${id}`,
			url: '',
			count: 1,
			last: null,
			dateProperty: '',
			copyContent: false,
			subpages: false,
			...overrides
		};
	}

	function item(ref: string, overrides: Partial<NotionPreviewItem> = {}): NotionPreviewItem {
		return {
			ref,
			kind: 'todo',
			title: ref,
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

	function deps(previews: Record<string, NotionOutcome<NotionPreview>>) {
		return {
			preview: vi.fn(
				async (request: NotionPreviewRequest) =>
					previews[request.source.id] as NotionOutcome<NotionPreview>
			),
			importBatch: vi.fn(async (request: NotionImportRequest) => takeAll(request.refs))
		};
	}

	it('takes only new entries of each source with the options of its last import', async () => {
		const fake = deps({
			p: {
				kind: 'ok',
				value: {
					...EMPTY_PREVIEW,
					items: [item('p1'), item('p2', { state: 'new' }), item('p3', { done: true })]
				}
			},
			d: { kind: 'ok', value: { ...EMPTY_PREVIEW, items: [item('d1', { state: 'new' })] } }
		});
		const started: number[] = [];
		const run = await refetchSources(
			[
				source('p', { subpages: true }),
				source('d', { type: 'data_source', dateProperty: 'Fällig', copyContent: true })
			],
			fake,
			{ onsource: (index) => started.push(index), failure }
		);
		expect(started).toEqual([1, 2]);
		expect(fake.preview.mock.calls.map(([request]) => request)).toEqual([
			{ source: { type: 'page', id: 'p' }, dateProperty: null, subpages: true },
			{ source: { type: 'data_source', id: 'd' }, dateProperty: 'Fällig', subpages: false }
		]);
		// Without anything new a source sends no import.
		expect(fake.importBatch).toHaveBeenCalledOnce();
		expect(fake.importBatch.mock.calls[0]?.[0]).toEqual({
			source: { type: 'page', id: 'p' },
			dateProperty: null,
			subpages: true,
			refs: ['p1'],
			skipDone: true,
			copyContent: false
		});
		expect(run?.results.map((result) => [result.id, result.counts, result.error])).toEqual([
			['p', { created: 1, duplicates: 1, skipped: 1, failed: 0 }, null],
			['d', { created: 0, duplicates: 1, skipped: 0, failed: 0 }, null]
		]);
	});

	it('goes on after a failed preview of one source and ends at an error of the connection', async () => {
		const fake = deps({
			a: { kind: 'error', message: 'Nicht freigegeben (404).', reason: 'source' },
			b: { kind: 'error', message: 'Token abgelehnt (401).', reason: 'connection' },
			c: { kind: 'ok', value: { ...EMPTY_PREVIEW, items: [item('c1')] } }
		});
		const run = await refetchSources([source('a'), source('b'), source('c')], fake, { failure });
		expect(run?.results.map((result) => [result.id, result.error])).toEqual([
			['a', 'Nicht freigegeben (404).'],
			['b', 'Token abgelehnt (401).']
		]);
		expect(run).toMatchObject({ skipped: ['c'], stopped: false });
		expect(fake.importBatch).not.toHaveBeenCalled();

		fake.preview.mockRejectedValueOnce(new Error('Netz'));
		const failed = await refetchSources([source('c'), source('a')], fake, { failure });
		expect(failed?.results).toEqual([
			{
				id: 'c',
				title: 'Liste c',
				counts: { created: 0, duplicates: 0, skipped: 0, failed: 0 },
				error: 'Fehler',
				open: 0
			}
		]);
		expect(failed?.skipped).toEqual(['a']);
		fake.preview.mockRejectedValueOnce(new Error('Sitzung'));
		expect(await refetchSources([source('c')], fake, { failure: () => null })).toBeNull();
	});
});
