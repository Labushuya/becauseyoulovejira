// An import from Notion in blocks (ADR-0041, addendum 2026-09-30): sends the chosen entries block
// by block, one request after the other, puts entries the server handed back (`pending`) in front
// again, and reports every block, so the dialog shows real progress. An error stops the run; what
// came before stays, as does what an error answer still took (`partial`). A stop on request ends
// the run after the current block (the request to the server cannot be taken back). Without
// Svelte and with relative imports, so the root integration tests run this loop against
// PocketBase and the fake of the Notion API.

import {
	NOTION_NO_PROGRESS_MESSAGE,
	NO_COUNTS,
	countsOf,
	type NotionImportCounts,
	type NotionImportOutcome,
	type NotionImportResult
} from '../domain/notion';

/** Outcome of a whole import or of "Erneut abrufen". */
export interface NotionImportRun {
	results: NotionImportResult[];
	counts: NotionImportCounts;
	/** Message of the error that stopped the run, null when it ran to its end or was stopped. */
	error: string | null;
	/** Stopped on request after a block. */
	stopped: boolean;
	/** Chosen entries without a result: not sent after an error or the stop. */
	open: string[];
	/** Requests sent to the server. */
	requests: number;
}

export interface NotionRunOptions {
	/** Gets the results of each block as soon as they are there. */
	onblock?: (results: NotionImportResult[]) => void;
	/** Once aborted, no further block is sent. */
	stop?: AbortSignal;
	/** Message for a thrown error, or null to end the run without a result (a lost session). */
	failure: (error: unknown) => string | null;
}

/**
 * Sends `refs` in blocks of `size` through `send`; null when `failure` ends the run without a
 * result.
 */
export async function runInBlocks(
	send: (refs: string[]) => Promise<NotionImportOutcome>,
	refs: readonly string[],
	size: number,
	{ onblock, stop, failure }: NotionRunOptions
): Promise<NotionImportRun | null> {
	const step = Math.max(1, Math.floor(size));
	const queue = [...refs];
	const run: NotionImportRun = {
		results: [],
		counts: { ...NO_COUNTS },
		error: null,
		stopped: false,
		open: [],
		requests: 0
	};
	while (queue.length > 0) {
		if (stop?.aborted) {
			run.stopped = true;
			break;
		}
		const block = queue.splice(0, step);
		let outcome: NotionImportOutcome;
		try {
			run.requests += 1;
			outcome = await send(block);
		} catch (error) {
			const message = failure(error);
			if (message === null) return null;
			queue.unshift(...block);
			run.error = message;
			break;
		}
		const batch = outcome.kind === 'ok' ? outcome.value : outcome.partial;
		const sent = new Set(block);
		const answered = (batch?.items ?? []).filter((item) => sent.has(item.ref));
		const done = new Set(answered.map((item) => item.ref));
		if (answered.length > 0) {
			run.results.push(...answered);
			onblock?.(answered);
		}
		// Handed back (`pending`) or not answered at all: next in line.
		queue.unshift(...block.filter((ref) => !done.has(ref)));
		if (outcome.kind !== 'ok') {
			run.error = outcome.message;
			break;
		}
		if (answered.length === 0) {
			run.error = NOTION_NO_PROGRESS_MESSAGE;
			break;
		}
	}
	run.counts = countsOf(run.results);
	run.open = queue;
	return run;
}
