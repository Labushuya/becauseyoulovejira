// The log of a disposable PocketBase in tests (plan robuste-skripte RS-3, plan test-haertung T-2).
// PocketBase 0.40.4 writes its log in batches: 3 s after the last new entry, or at 200 entries
// (initLogger resets its ticker with every entry), and /api/logs lists the oldest entries first.
// A test that reads /api/logs right after an action sees only what was written before; a check
// that something is NOT in the log then proves nothing. writtenLogs() first makes a request with a
// mark of its own, waits until PocketBase has written that request, so every earlier entry is
// written as well, and returns all entries, not only the first page.

import { randomBytes } from 'node:crypto';
import { LOG_WRITE_MS } from './timing.mjs';

const PAGE = 500;

/** Every log entry of the instance (`client`: PocketBase SDK signed in as superuser), oldest first. */
export async function allLogEntries(client, filter = '') {
	const entries = [];
	for (let page = 1; ; page += 1) {
		const query = { page, perPage: PAGE, sort: 'created' };
		if (filter !== '') query.filter = filter;
		const result = await client.send('/api/logs', { query });
		entries.push(...result.items);
		if (page >= result.totalPages || result.items.length === 0) return entries;
	}
}

/**
 * Every log entry, after everything logged before this call is written. The mark is a request to
 * /api/health (PocketBase logs every request with its address), so it needs no rights and changes
 * nothing; the instance logs it like any other request.
 */
export async function writtenLogs(client) {
	const mark = randomBytes(8).toString('hex');
	await fetch(`${client.baseURL}/api/health?byl-log-mark=${mark}`);
	const filter = client.filter('data.url ~ {:mark}', { mark });
	const deadline = Date.now() + LOG_WRITE_MS;
	while ((await allLogEntries(client, filter)).length === 0) {
		if (Date.now() >= deadline) throw new Error(`PocketBase did not write its log within ${LOG_WRITE_MS} ms.`);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return allLogEntries(client);
}
