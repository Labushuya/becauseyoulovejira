// Checking one mail of the inbox (ADR-0016 section 5, ADR-0020): load its source (BODY.PEEK),
// parse it, match the keywords of the connection exactly and hand a match to the ingest route.
// Shared by the fetch after the cursor (poll.ts) and the full scan of the inbox (scan.ts).

import type { InboxSession } from './imap';
import type { IngestApi, MailConnection } from './ingest-client';
import { ingestDraft, keywordOf, parseMail } from './mail';
import type { ScanState } from './scan-state';

export interface PollOutcome {
	status: 'ok' | 'error' | 'missing' | 'stopped' | 'gone';
	created: number;
	duplicates: number;
	unmatched: number;
	skipped: number;
	failed: number;
	cursor: string;
	error: string;
	/** State of the full scan after this run, null when no scan ran. */
	scan: ScanState | null;
	/** The scan stopped at the time budget of a manual run and continues in the background. */
	scanPending: boolean;
}

/** The connection was deleted or switched off during the run. */
export class ConnectionGone extends Error {}

export function emptyOutcome(cursor: string): PollOutcome {
	return {
		status: 'ok',
		created: 0,
		duplicates: 0,
		unmatched: 0,
		skipped: 0,
		failed: 0,
		cursor,
		error: '',
		scan: null,
		scanPending: false
	};
}

/**
 * Loads, parses and matches one mail and sends a match with origin "auto". Counts the result in
 * `outcome`; throws ConnectionGone when the connection is gone and IngestError when PocketBase
 * cannot be used.
 */
export async function checkMail(
	ingest: IngestApi,
	connection: MailConnection,
	session: InboxSession,
	uid: number,
	outcome: PollOutcome
): Promise<void> {
	const source = await session.source(uid);
	if (source === null) return;
	let draft;
	try {
		draft = await parseMail(source);
	} catch {
		outcome.failed += 1;
		return;
	}
	if (keywordOf(draft, connection.keywords, connection.matchBody) === '') {
		outcome.unmatched += 1;
		return;
	}
	const result = await ingest.sendItem(ingestDraft(draft, connection.id, 'auto'), source);
	switch (result.status) {
		case 'created':
			outcome.created += 1;
			break;
		case 'duplicate':
			outcome.duplicates += 1;
			break;
		case 'unmatched':
			outcome.unmatched += 1;
			break;
		case 'rejected':
			outcome.failed += 1;
			break;
		case 'gone':
			throw new ConnectionGone();
	}
}
