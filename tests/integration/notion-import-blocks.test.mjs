// Import of 45 rows in blocks (ADR-0041, addendum 2026-09-30) against disposable PocketBase
// instances in the test mode and the fake of the Notion API: the loop of the dialog
// (web/src/lib/stores/notion-run.ts) with the data layer and the block size of the SPA, a slow
// Notion, 429 with a short and a long Retry-After, the duplicate guarantee on a repeated import,
// and the time limits of a request: entries the server has no time for come back as `pending`, and
// a Notion that answers too late ends as "zu langsam", not as "nicht erreichbar". A second instance
// runs with shorter time limits (BYL_TEST_NOTION_TIMING, only in the test mode). Since the addendum
// of 2026-10-01 also the run over several sources (`runSources`) and "Alle erneut abrufen"
// (`refetchSources`) with the data layer of the SPA.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeNotion } from '../support/fake-notion.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { DATA_SOURCE_ID, HIDDEN_PAGE_ID, PAGE_ID, TOKEN, id, manyRows, workspace } from '../fixtures/notion/workspace.mjs';
import { createConnection } from '../../web/src/lib/data/connections.ts';
import { importNotion, listNotionImports, previewNotion } from '../../web/src/lib/data/notion.ts';
import { emptyConnectionDraft } from '../../web/src/lib/domain/connections.ts';
import { importBatchSize } from '../../web/src/lib/domain/notion.ts';
import { refetchSources, runInBlocks, runSources } from '../../web/src/lib/stores/notion-run.ts';

const SOURCE = { type: 'data_source', id: DATA_SOURCE_ID };
const PAGE = { type: 'page', id: PAGE_ID };
const TOO_SLOW = 'Notion antwortet gerade zu langsam (Zeitüberschreitung). Bitte in einer Minute erneut versuchen.';

let fake;

/** A disposable instance against the fake, and a function for a new user with a Notion connection. */
async function serve(env = {}) {
	const instance = await startPocketBase({
		env: { BYL_TEST_NOTION_PORT: String(fake.port), BYL_NOTION_TOKEN: TOKEN, ...env }
	});
	const superuser = new PocketBase(instance.url);
	superuser.autoCancellation(false);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	async function user() {
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		await superuser.collection('users').create({ email, password, passwordConfirm: password });
		const pb = new PocketBase(instance.url);
		pb.autoCancellation(false);
		await pb.collection('users').authWithPassword(email, password);
		const connection = await createConnection(pb, emptyConnectionDraft('notion'));
		return { pb, id: connection.id };
	}
	return { instance, user };
}

/** The request of the dialog for `refs` of the database. */
function request(refs, copyContent = false) {
	return { source: SOURCE, refs, skipDone: true, copyContent, dateProperty: null, subpages: false };
}

/** The dialog's loop over `refs` with its block size; `blocks` records each block's results and time. */
async function run(who, refs, { size, copyContent = false } = {}) {
	const blocks = [];
	let started = Date.now();
	const outcome = await runInBlocks(
		async (block) => {
			started = Date.now();
			return importNotion(who.pb, who.id, request(block, copyContent));
		},
		refs,
		size,
		{
			onblock: (results) => blocks.push({ count: results.length, ms: Date.now() - started }),
			failure: (error) => String(error)
		}
	);
	return { outcome, blocks };
}

async function previewRefs(who) {
	const preview = await previewNotion(who.pb, who.id, { source: SOURCE, dateProperty: null, subpages: false });
	expect(preview.kind).toBe('ok');
	return { refs: preview.value.items.map((item) => item.ref), preview: preview.value };
}

function inboxCount(who) {
	return who.pb
		.collection('inbox_items')
		.getList(1, 1, { filter: who.pb.filter('channel = {:channel}', { channel: 'notion' }) })
		.then((page) => page.totalItems);
}

beforeAll(async () => {
	const space = workspace();
	space.pageSize = 100;
	space.rows[DATA_SOURCE_ID] = manyRows(45);
	fake = await startFakeNotion(space);
});

afterAll(async () => {
	await fake?.close();
});

beforeEach(() => fake.clear());

describe('Notion: 45 rows in blocks', () => {
	let server;

	beforeAll(async () => {
		server = await serve();
	});

	afterAll(async () => {
		await server?.instance.stop();
	});

	it('takes 45 rows in five blocks of the dialog, reading the source anew each time', async () => {
		const who = await server.user();
		const { refs, preview } = await previewRefs(who);
		expect(refs).toHaveLength(45);
		const size = importBatchSize(preview.limits, false, preview.items.length);
		expect(size).toBe(10);
		fake.clear();
		const { outcome, blocks } = await run(who, refs, { size });
		expect(outcome).toMatchObject({
			counts: { created: 45, duplicates: 0, skipped: 0, failed: 0 },
			error: null,
			open: [],
			requests: 5
		});
		expect(blocks.map((block) => block.count)).toEqual([10, 10, 10, 10, 5]);
		expect(await inboxCount(who)).toBe(45);
		// Each request asks Notion for the schema and one page of rows (3 per second at most).
		expect(fake.requests.map((entry) => `${entry.method} ${entry.path.replace(/[0-9a-f-]{36}/g, ':id')}`)).toEqual(
			Array.from({ length: 5 }, () => ['GET /v1/data_sources/:id', 'POST /v1/data_sources/:id/query']).flat()
		);
		const gaps = fake.requests.slice(1).map((entry, index) => entry.at - fake.requests[index].at);
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(300);

		// Again: every row is "schon vorhanden", nothing comes twice.
		const again = await run(who, refs, { size });
		expect(again.outcome.counts).toEqual({ created: 0, duplicates: 45, skipped: 0, failed: 0 });
		expect(again.outcome.results.every((result) => result.message === 'Schon im Eingang.')).toBe(true);
		expect(await inboxCount(who)).toBe(45);
	});

	it('goes on block by block with a slow Notion', async () => {
		const who = await server.user();
		const { refs } = await previewRefs(who);
		fake.slow(600);
		const { outcome, blocks } = await run(who, refs, { size: 10 });
		expect(outcome).toMatchObject({ counts: { created: 45 }, error: null, requests: 5 });
		// Every block answers on its own: two slow requests to Notion, far below any time limit.
		expect(blocks).toHaveLength(5);
		for (const block of blocks) {
			expect(block.ms).toBeGreaterThanOrEqual(1200);
			expect(block.ms).toBeLessThan(10_000);
		}
		expect(await inboxCount(who)).toBe(45);
	});

	it('waits after 429 with a short Retry-After and stops with a German message after a long one', async () => {
		const who = await server.user();
		const { refs } = await previewRefs(who);
		fake.inject({ method: 'POST', path: /\/query$/, status: 429, code: 'rate_limited', headers: { 'Retry-After': '1' } });
		const waited = await run(who, refs.slice(0, 20), { size: 10 });
		expect(waited.outcome).toMatchObject({ counts: { created: 20 }, error: null });
		expect(waited.blocks[0].ms).toBeGreaterThanOrEqual(1000);

		fake.clear();
		fake.inject({ method: 'POST', path: /\/query$/, status: 429, code: 'rate_limited', headers: { 'Retry-After': '120' }, times: 3 });
		const stopped = await run(who, refs.slice(20), { size: 10 });
		expect(stopped.outcome).toMatchObject({
			counts: { created: 0 },
			error: 'Notion bremst gerade die Anfragen (429). Bitte in einer Minute erneut versuchen.',
			requests: 1
		});
		expect(stopped.outcome.open).toEqual(refs.slice(20));
		// The retry takes the rest; what came before is "schon vorhanden".
		fake.clear();
		const retried = await run(who, refs, { size: 10 });
		expect(retried.outcome.counts).toEqual({ created: 25, duplicates: 20, skipped: 0, failed: 0 });
		expect(await inboxCount(who)).toBe(45);
	});
});

describe('Notion: time limits of a request', () => {
	let server;

	beforeAll(async () => {
		// Only in the test mode: new entries for 1.5 s, requests to Notion for 3 s per request.
		server = await serve({ BYL_TEST_NOTION_TIMING: '1500,3000' });
	});

	afterAll(async () => {
		await server?.instance.stop();
	});

	it('hands back what it had no time for, and the loop takes it with the next request', async () => {
		const who = await server.user();
		const { refs } = await previewRefs(who);
		const chosen = refs.slice(0, 10);
		fake.slow(250);
		const first = await importNotion(who.pb, who.id, request(chosen, true));
		expect(first.kind).toBe('ok');
		const taken = first.value.items.map((item) => item.ref);
		expect(taken.length).toBeGreaterThan(0);
		expect(first.value.pending.length).toBeGreaterThan(0);
		expect([...taken, ...first.value.pending]).toEqual(chosen);

		const rest = await run(who, first.value.pending, { size: 10, copyContent: true });
		expect(rest.outcome).toMatchObject({ error: null, open: [] });
		expect(rest.outcome.counts.created).toBe(first.value.pending.length);
		expect(rest.outcome.requests).toBeGreaterThan(1);
		expect(await inboxCount(who)).toBe(10);
	});

	it('calls a Notion that answers too late slow, within the time of the request', async () => {
		const who = await server.user();
		const { refs } = await previewRefs(who);
		fake.slow(5000);
		const started = Date.now();
		const { outcome } = await run(who, refs.slice(0, 10), { size: 10 });
		expect(Date.now() - started).toBeLessThan(4500);
		expect(outcome).toMatchObject({ counts: { created: 0 }, error: TOO_SLOW, requests: 1 });
		expect(outcome.open).toEqual(refs.slice(0, 10));
		// A passing slowness is no problem of the connection.
		const connection = await who.pb.collection('connections').getOne(who.id);
		expect(connection.last_error).toBe('');

		const preview = await previewNotion(who.pb, who.id, { source: SOURCE, dateProperty: null, subpages: false });
		expect(preview).toEqual({ kind: 'error', message: TOO_SLOW, reason: 'source' });
	});
});

describe('Notion: several sources in one run and "Alle erneut abrufen"', () => {
	let server;

	beforeAll(async () => {
		server = await serve();
	});

	afterAll(async () => {
		await server?.instance.stop();
	});

	/** One source of the dialog's run with its chosen entries and block size. */
	function step(who, source, refs, size, subpages = false) {
		return {
			key: source.id,
			refs,
			size,
			send: (block) =>
				importNotion(who.pb, who.id, { source, refs: block, skipDone: true, copyContent: false, dateProperty: null, subpages })
		};
	}

	it('takes several sources in one run, each in its blocks, and goes on after an error of one source', async () => {
		const who = await server.user();
		const { refs } = await previewRefs(who);
		const page = await previewNotion(who.pb, who.id, { source: PAGE, dateProperty: null, subpages: true });
		const points = page.value.items.filter((item) => !item.done).map((item) => item.ref);
		expect(points).toHaveLength(8);
		const blocks = [];
		const outcome = await runSources(
			[
				step(who, SOURCE, refs.slice(0, 15), 10),
				step(who, { type: 'page', id: HIDDEN_PAGE_ID }, [id(3, 60)], 10),
				step(who, PAGE, points, 100, true)
			],
			{ onblock: (key, results) => blocks.push([key, results.length]), failure: (error) => String(error) }
		);
		expect(outcome).toMatchObject({ error: null, stopped: false, skipped: [] });
		expect(outcome.runs.map(({ key, run }) => [key, run.counts.created, run.open.length])).toEqual([
			[DATA_SOURCE_ID, 15, 0],
			[HIDDEN_PAGE_ID, 0, 1],
			[PAGE_ID, 8, 0]
		]);
		// The page that is not shared ends only itself, as a problem of the source.
		expect(outcome.runs[1].run).toMatchObject({ reason: 'source', error: expect.stringContaining('(404)') });
		expect(blocks).toEqual([
			[DATA_SOURCE_ID, 10],
			[DATA_SOURCE_ID, 5],
			[PAGE_ID, 8]
		]);
		expect(await inboxCount(who)).toBe(23);
	});

	it('takes only new entries of every imported source, with the options of its last import', async () => {
		const who = await server.user();
		const { refs } = await previewRefs(who);
		await run(who, refs.slice(0, 10), { size: 10 });
		const first = await importNotion(who.pb, who.id, {
			source: PAGE,
			refs: [id(3, 2), id(3, 40)],
			skipDone: true,
			copyContent: false,
			dateProperty: null,
			subpages: true
		});
		expect(first.value.counts.created).toBe(2);
		const sources = await listNotionImports(who.pb, who.id);
		expect(sources.map((source) => [source.title, source.count, source.subpages])).toEqual([
			['Wochenplan', 2, true],
			['Aufgaben Haushalt', 10, false]
		]);

		let imports = 0;
		const deps = {
			preview: (sent) => previewNotion(who.pb, who.id, sent),
			importBatch: (sent) => {
				imports += 1;
				return importNotion(who.pb, who.id, sent);
			}
		};
		const started = [];
		fake.clear();
		const outcome = await refetchSources(sources, deps, {
			onsource: (index, source) => started.push([index, source.title]),
			failure: (error) => String(error)
		});
		expect(started).toEqual([
			[1, 'Wochenplan'],
			[2, 'Aufgaben Haushalt']
		]);
		// Wochenplan with its sub-pages: 9 points, 2 taken, 1 done; the rows: 45, 10 taken.
		expect(outcome).toMatchObject({ stopped: false, skipped: [] });
		expect(outcome.results.map((result) => [result.title, result.counts, result.error, result.open])).toEqual([
			['Wochenplan', { created: 6, duplicates: 2, skipped: 1, failed: 0 }, null, 0],
			['Aufgaben Haushalt', { created: 35, duplicates: 10, skipped: 0, failed: 0 }, null, 0]
		]);
		expect(fake.requests.some((entry) => entry.path.includes(id(3, 41)))).toBe(true);
		expect(imports).toBe(5);
		expect(await inboxCount(who)).toBe(53);

		// Again: nothing new, so no import request at all.
		imports = 0;
		const again = await refetchSources(await listNotionImports(who.pb, who.id), deps, { failure: (error) => String(error) });
		expect(again.results.map((result) => [result.counts.created, result.error])).toEqual([
			[0, null],
			[0, null]
		]);
		expect(imports).toBe(0);
	});

	it('stops after the current block and starts no further source', async () => {
		const who = await server.user();
		const { refs } = await previewRefs(who);
		await run(who, refs.slice(0, 1), { size: 10 });
		await importNotion(who.pb, who.id, { source: PAGE, refs: [id(3, 2)], skipDone: true, copyContent: false, dateProperty: null, subpages: false });
		const stop = new AbortController();
		let imports = 0;
		const outcome = await refetchSources(
			await listNotionImports(who.pb, who.id),
			{
				preview: (sent) => previewNotion(who.pb, who.id, sent),
				importBatch: (sent) => {
					imports += 1;
					stop.abort();
					return importNotion(who.pb, who.id, sent);
				}
			},
			{ stop: stop.signal, failure: (error) => String(error) }
		);
		expect(outcome.stopped).toBe(true);
		expect(outcome.results).toHaveLength(1);
		expect(outcome.results[0]).toMatchObject({ title: 'Wochenplan', counts: { created: 5 }, error: null, open: 0 });
		expect(outcome.skipped).toEqual([DATA_SOURCE_ID]);
		expect(imports).toBe(1);
	});
});
