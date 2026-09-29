// The loop of an import in blocks (stores/notion-run.ts, ADR-0041 addendum 2026-09-30) with a fake
// sender: a server that answers without any result must not keep the loop going, answers for
// entries of another block count for nothing, and a thrown error ends the run with its message or,
// when `failure` says so, without a result.

import { describe, expect, it, vi } from 'vitest';
import { NOTION_NO_PROGRESS_MESSAGE, type NotionImportOutcome } from '$lib/domain/notion';
import { runInBlocks } from './notion-run';

const failure = () => 'Fehler';

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
