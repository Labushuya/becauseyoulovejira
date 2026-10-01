// An import from Notion in blocks (ADR-0041, addendum 2026-09-30): sends the chosen entries block
// by block, one request after the other, puts entries the server handed back (`pending`) in front
// again, and reports every block, so the dialog shows real progress. An error stops the run; what
// came before stays, as does what an error answer still took (`partial`). A stop on request ends
// the run after the current block (the request to the server cannot be taken back).
//
// Since the addendum of 2026-10-01 a run goes over several sources one after the other
// (`runSources`), and "Alle erneut abrufen" takes the new entries of every source taken over so far
// (`refetchSources`). An error that concerns only one source (reason "source": not shared, too
// slow, rate limited) ends that source and the next one goes on; an error of the connection or a
// failed request ends the whole run. Without Svelte and with relative imports, so the root
// integration tests run these loops against PocketBase and the fake of the Notion API.

import {
	NOTION_NO_PROGRESS_MESSAGE,
	NO_COUNTS,
	addCounts,
	blockedReason,
	countsOf,
	importBatchSize,
	type NotionImportCounts,
	type NotionImportOutcome,
	type NotionImportRequest,
	type NotionImportResult,
	type NotionImportedSource,
	type NotionOutcome,
	type NotionPreview,
	type NotionPreviewRequest,
	type NotionSourceResult
} from '../domain/notion';

/** Outcome of a whole import or of "Erneut abrufen". */
export interface NotionImportRun {
	results: NotionImportResult[];
	counts: NotionImportCounts;
	/** Message of the error that stopped the run, null when it ran to its end or was stopped. */
	error: string | null;
	/** Whom the error concerns: the connection, only this source, or unknown (a failed request). */
	reason: 'connection' | 'source' | '';
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
		reason: '',
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
			run.reason = outcome.reason;
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

/** One source of a run over several: its chosen entries, its block size and how to send them. */
export interface NotionSourceStep {
	/** ID of the source. */
	key: string;
	refs: readonly string[];
	size: number;
	send: (refs: string[]) => Promise<NotionImportOutcome>;
}

/** Outcome of a run over several sources. */
export interface NotionSourcesRun {
	/** The sources that ran, in order, each with its own outcome. */
	runs: { key: string; run: NotionImportRun }[];
	/** Sources that did not start (after a stop or an error of the connection). */
	skipped: string[];
	/** Message of the error that ended the whole run, null without one. */
	error: string | null;
	stopped: boolean;
}

/**
 * Runs the sources one after the other, each in its blocks (ADR-0041, addendum of 2026-10-01).
 * `onblock` gets the key of the source with the results of each block. An error of only one
 * source ends that source; the next one goes on. An error of the connection, a failed request or
 * the stop ends the whole run. null when `failure` ends it without a result (a lost session).
 */
export async function runSources(
	steps: readonly NotionSourceStep[],
	{
		onblock,
		stop,
		failure
	}: Omit<NotionRunOptions, 'onblock'> & {
		onblock?: (key: string, results: NotionImportResult[]) => void;
	}
): Promise<NotionSourcesRun | null> {
	const outcome: NotionSourcesRun = { runs: [], skipped: [], error: null, stopped: false };
	for (let index = 0; index < steps.length; index++) {
		const step = steps[index] as NotionSourceStep;
		if (stop?.aborted || outcome.error !== null) {
			outcome.skipped.push(step.key);
			continue;
		}
		const run = await runInBlocks(step.send, step.refs, step.size, {
			onblock: (results) => onblock?.(step.key, results),
			stop,
			failure
		});
		if (run === null) return null;
		outcome.runs.push({ key: step.key, run });
		if (run.error !== null && run.reason !== 'source') outcome.error = run.error;
	}
	outcome.stopped = stop?.aborted === true && outcome.error === null;
	return outcome;
}

/** What "Alle erneut abrufen" needs: the preview of a source and the import of a block. */
export interface NotionRefetchDeps {
	preview(request: NotionPreviewRequest): Promise<NotionOutcome<NotionPreview>>;
	importBatch(request: NotionImportRequest): Promise<NotionImportOutcome>;
}

/** Outcome of "Alle erneut abrufen". */
export interface NotionRefetchRun {
	results: NotionSourceResult[];
	/** Sources that did not start (after a stop or an error of the connection). */
	skipped: string[];
	stopped: boolean;
}

/** Result of a source of "Alle erneut abrufen" with nothing left open. */
function resultOf(
	source: NotionImportedSource,
	counts: NotionImportCounts,
	error: string | null
): NotionSourceResult {
	return { id: source.id, title: source.title, counts, error, open: 0 };
}

/**
 * "Alle erneut abrufen" (ADR-0041, addendum of 2026-10-01; also "Erneut abrufen" of one source):
 * for each source, one after the other, its preview with the options of its last import, then only
 * the entries that are not in the inbox yet, skipping done ones, in blocks. A source without new
 * entries sends no import. `onsource` says which source starts (1-based). An error of only this
 * source ends it, the next goes on; an error of the connection or a failed request ends the run.
 * null when `failure` ends it without a result (a lost session).
 */
export async function refetchSources(
	sources: readonly NotionImportedSource[],
	deps: NotionRefetchDeps,
	{
		onsource,
		stop,
		failure
	}: {
		onsource?: (index: number, source: NotionImportedSource) => void;
		stop?: AbortSignal;
		failure: (error: unknown) => string | null;
	}
): Promise<NotionRefetchRun | null> {
	const outcome: NotionRefetchRun = { results: [], skipped: [], stopped: false };
	let ended = false;
	for (let index = 0; index < sources.length; index++) {
		const source = sources[index] as NotionImportedSource;
		if (stop?.aborted || ended) {
			outcome.skipped.push(source.id);
			continue;
		}
		onsource?.(index + 1, source);
		const isPage = source.type === 'page';
		const request = {
			source: { type: source.type, id: source.id },
			dateProperty: isPage ? null : source.dateProperty,
			subpages: isPage && source.subpages
		};
		let preview: NotionOutcome<NotionPreview>;
		try {
			preview = await deps.preview(request);
		} catch (error) {
			const message = failure(error);
			if (message === null) return null;
			outcome.results.push(resultOf(source, { ...NO_COUNTS }, message));
			ended = true;
			continue;
		}
		if (preview.kind !== 'ok') {
			outcome.results.push(resultOf(source, { ...NO_COUNTS }, preview.message));
			if (preview.reason !== 'source') ended = true;
			continue;
		}
		const items = preview.value.items;
		const refs = items.filter((item) => blockedReason(item, true) === '').map((item) => item.ref);
		const known = items.filter((item) => item.state !== '').length;
		const done = items.filter((item) => item.state === '' && item.done).length;
		const before = { ...NO_COUNTS, duplicates: known, skipped: done };
		if (refs.length === 0) {
			outcome.results.push(resultOf(source, before, null));
			continue;
		}
		const withContent = source.type === 'data_source' && source.copyContent;
		const run = await runInBlocks(
			(block) =>
				deps.importBatch({
					...request,
					refs: block,
					skipDone: true,
					copyContent: withContent
				}),
			refs,
			importBatchSize(preview.value.limits, withContent, items.length),
			{ stop, failure }
		);
		if (run === null) return null;
		outcome.results.push({
			id: source.id,
			title: source.title,
			counts: addCounts(run.counts, before),
			error: run.error,
			open: run.open.length
		});
		if (run.error !== null && run.reason !== 'source') ended = true;
	}
	outcome.stopped = stop?.aborted === true;
	return outcome;
}
