// Checking one mail of the inbox (ADR-0016 section 5, ADR-0020): load its source (BODY.PEEK),
// parse it, match the keywords of the connection exactly and hand a match to the ingest route.
// Shared by the fetch after the cursor (poll.ts) and the full scan of the inbox (scan.ts). A mail
// over MAIL_MAX_BYTES (25 MB since 0.9.0, addendum D of ADR-0031) is read only from its beginning
// and stored without its file (ADR-0031 section 4).

import type { InboxSession } from './imap';
import type { IngestApi, MailConnection } from './ingest-client';
import { MAIL_MAX_BYTES, ingestDraft, keywordOf, largeMailDraft, parseMail } from './mail';
import type { ScanState } from './scan-state';

export interface PollOutcome {
	status: 'ok' | 'error' | 'missing' | 'stopped' | 'gone';
	created: number;
	duplicates: number;
	unmatched: number;
	/** Part of the answer of /poll since 0.5.0; a helper since 0.8.0 skips no mail for its size. */
	skipped: number;
	failed: number;
	/** New entries of mails over MAIL_MAX_BYTES, stored without their file (part of `created`). */
	omitted: number;
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
		omitted: 0,
		cursor,
		error: '',
		scan: null,
		scanPending: false
	};
}

/**
 * Loads, parses and matches one mail and sends a match with origin "auto". A mail over
 * MAIL_MAX_BYTES (`size`) is read only from its beginning and sent without its file; its keyword
 * check covers subject, sender and that beginning. Counts the result in `outcome`; throws
 * ConnectionGone when the connection is gone and IngestError when PocketBase cannot be used.
 */
export async function checkMail(
	ingest: IngestApi,
	connection: MailConnection,
	session: InboxSession,
	uid: number,
	outcome: PollOutcome,
	size = 0
): Promise<void> {
	const large = size > MAIL_MAX_BYTES;
	const source = large ? null : await session.source(uid);
	if (!large && source === null) return;
	let draft;
	try {
		draft = source === null ? await largeMailDraft(session, uid, size) : await parseMail(source);
	} catch {
		outcome.failed += 1;
		return;
	}
	if (draft === null) return;
	if (keywordOf(draft, connection.keywords, connection.matchBody) === '') {
		outcome.unmatched += 1;
		return;
	}
	const sent = ingestDraft(draft, connection.id, 'auto');
	const result = await (source === null ? ingest.sendItem(sent) : ingest.sendItem(sent, source));
	switch (result.status) {
		case 'created':
			outcome.created += 1;
			if (large) outcome.omitted += 1;
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
