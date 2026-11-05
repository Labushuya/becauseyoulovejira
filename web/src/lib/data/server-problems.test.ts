// The list of the page "Fehlerprotokoll" in the data layer (FP-3, ADR-0077 addendum FP-3): one query
// of the record API of problem_events with the fixed filter, its values only as parameters of
// pb.filter, the sort -last_at,-id, without owner and household; 51 entries asked and 50 shown, the
// cursor of the next page from the 50th (keyset) only when the 51st is there, so exactly 50 entries
// end the list. The SDK runs against a stubbed fetch; against a real server in
// tests/integration/problem-events.test.mjs.

import PocketBase from 'pocketbase';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listServerProblemPage, listServerProblems } from './server-problems';

const ORIGIN = 'http://127.0.0.1:8090';

/** An entry of the record API, one minute older than the one before. */
function item(index: number) {
	const minute = String(59 - (index % 60)).padStart(2, '0');
	return {
		id: `entry${String(index).padStart(10, '0')}`,
		source: 'job',
		area: 'system',
		code: 'trash_failed',
		message: 'Papierkorb: Lauf gescheitert',
		context: { job: 'trash' },
		count: 1,
		first_at: `2026-11-05 08:${minute}:00.000Z`,
		last_at: `2026-11-05 09:${minute}:00.000Z`
	};
}

/** The record API answers every list with `items`; returns the asked addresses. */
function serve(items: unknown[]) {
	const urls: URL[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn<typeof fetch>(async (input) => {
			urls.push(new URL(String(input)));
			return Response.json({ page: 1, perPage: 50, totalItems: -1, totalPages: -1, items });
		})
	);
	return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe('listServerProblemPage (FP-3)', () => {
	it('asks for every entry the account may see with all filters switched off', async () => {
		const urls = serve([item(0)]);
		const page = await listServerProblemPage(new PocketBase(ORIGIN), {
			source: null,
			area: null,
			after: null
		});
		const [url] = urls;
		expect(url?.pathname).toBe('/api/collections/problem_events/records');
		expect(url?.searchParams.get('filter')).toBe(
			'("" = "" || source = "") && ("" = "" || area = "") && ("" = "" || last_at < "" || (last_at = "" && id < ""))'
		);
		expect(url?.searchParams.get('sort')).toBe('-last_at,-id');
		// One more than a page: whether a next one follows.
		expect(url?.searchParams.get('perPage')).toBe('51');
		expect(url?.searchParams.get('skipTotal')).toBe('true');
		const fields = url?.searchParams.get('fields')?.split(',') ?? [];
		expect(fields).not.toContain('owner');
		expect(fields).not.toContain('household');
		expect(fields).not.toContain('fingerprint');
		expect(page.records.map((record) => record.id)).toEqual([item(0).id]);
		// Not a full page: the last one.
		expect(page.next).toBeNull();
	});

	it('passes source, area and the cursor only as parameters, quoted by the SDK', async () => {
		const urls = serve([]);
		await listServerProblemPage(new PocketBase(ORIGIN), {
			source: 'channel',
			area: 'household',
			after: { lastAt: '2026-11-05 09:00:00.000Z', id: 'abc\'def" || 1' }
		});
		const at = '"2026-11-05 09:00:00.000Z"';
		expect(urls[0]?.searchParams.get('filter')).toBe(
			[
				'("channel" = "" || source = "channel")',
				'("household" = "" || area = "household")',
				`(${at} = "" || last_at < ${at} || (last_at = ${at} && id < "abc'def\\" || 1"))`
			].join(' && ')
		);
	});

	it('names the cursor of the next page after a full page: the last entry as the server sent it', async () => {
		const items = Array.from({ length: 51 }, (_, index) => item(index));
		serve(items);
		const page = await listServerProblemPage(new PocketBase(ORIGIN), {
			source: null,
			area: null,
			after: null
		});
		// The 51st only says that there is more; the next page starts after the 50th.
		expect(page.records).toHaveLength(50);
		expect(page.records.at(-1)?.id).toBe(items[49]?.id);
		expect(page.next).toEqual({ lastAt: items[49]?.last_at, id: items[49]?.id });
	});

	it('ends the list with exactly 50 entries: no "Mehr laden" that finds nothing', async () => {
		serve(Array.from({ length: 50 }, (_, index) => item(index)));
		const page = await listServerProblemPage(new PocketBase(ORIGIN), {
			source: null,
			area: null,
			after: null
		});
		expect(page.records).toHaveLength(50);
		expect(page.next).toBeNull();
	});

	it('leaves the list of the dialog as it was: no filter, the newest 50', async () => {
		const urls = serve([item(0)]);
		await listServerProblems(new PocketBase(ORIGIN));
		expect(urls[0]?.searchParams.get('filter')).toBeNull();
		expect(urls[0]?.searchParams.get('perPage')).toBe('50');
		expect(urls[0]?.searchParams.get('sort')).toBe('-last_at,-id');
	});
});
