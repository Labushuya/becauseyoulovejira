// Full scan of the inbox (user decision of 2026-09-27; ADR-0020, addendum 3): every mail of the
// inbox up to the cursor is checked against the keywords, newest first, in blocks of
// SCAN_BLOCK_SIZE mails, with progress, a time budget and cancelling between mails. Only the inbox
// (INBOX) is read; trash, spam, sent mails, archive and drafts are other folders and never opened.
//
// Per block:
// 1. The header fields that keywords search (MATCH_HEADER_FIELDS) are read for every mail and
//    matched locally with the keyword module: subject and sender always, with match_body also
//    To, Cc, Reply-To, Sender, List-Id and Organization. This is exact and needs no body.
// 2. With match_body the server searches the text: one UID SEARCH per keyword over the UIDs of the
//    block, OR over SUBJECT, FROM, TO, CC, the headers Reply-To, Sender, List-Id, Organization and
//    BODY, for every spelling of the keyword (searchTerms: as typed, umlauts as "a" and as "ae",
//    written-out umlauts and "ß"). imapflow adds CHARSET UTF-8 for non-ASCII terms. TEXT is not
//    used: it also searches Received, DKIM and the like, which the keywords never search, and
//    would only load mails for nothing. If the server refuses the search (NO or BAD, for example
//    BADCHARSET), every mail of the block is loaded and checked instead (fallback).
// 3. Only the candidates are loaded (BODY.PEEK[], up to 10 MB; of a larger mail only its first
//    2 MB, stored without the file, ADR-0031 section 4) and matched exactly with the whole text
//    (checkMail); the ingest route checks again. Server hits without a real match count as
//    "ohne Stichwort".
//
// Duplicates are recognised by the fingerprint (Message-ID), discarded entries stay tombstones, so
// scanning again is harmless. At most MAX_CREATED_PER_RUN new entries per run; then the scan
// pauses ("Weitere Treffer – erneut abrufen") and a manual run continues it.

import { createHash } from 'node:crypto';
import type { SearchObject } from 'imapflow';
import PostalMime, { decodeWords } from 'postal-mime';
import {
	MAIL_PARSER_OPTIONS,
	mailMatchTexts,
	mailToDraft,
	type ParsedMail
} from '../../../web/src/lib/domain/inbox-mail';
import { foldKeywordText, keywordKey } from '../../../web/src/lib/domain/keywords';
import type { InboxSession } from './imap';
import type { IngestApi, MailConnection } from './ingest-client';
import { checkMail, type PollOutcome } from './mail-check';
import { keywordOf } from './mail';
import type { ScanState } from './scan-state';

/** Mails per block: one header fetch and one search per keyword each. */
export const SCAN_BLOCK_SIZE = 500;
/** Most new entries per run (fetch after the cursor and scan together). */
export const MAX_CREATED_PER_RUN = 200;
/** Most spellings of one keyword the server searches for. */
export const SEARCH_TERMS_MAX = 6;

/** The keywords and match_body a scan ran with, as 16 hex digits; order and spelling do not count. */
export function scanSignature(keywords: readonly string[], matchBody: boolean): string {
	const keys = [...new Set(keywords.map((keyword) => keywordKey(keyword)))].sort();
	return createHash('sha256').update(JSON.stringify({ keys, matchBody })).digest('hex').slice(0, 16);
}

/** A new scan of the UIDs up to `until`. */
export function newScan(signature: string, uidValidity: string, until: number): ScanState {
	return {
		signature,
		state: 'running',
		uidValidity,
		until,
		below: until + 1,
		done: 0,
		total: 0,
		created: 0,
		fallback: false
	};
}

/**
 * Spellings of a keyword for the search of the server, lower case: as typed, with umlauts as "a"
 * and as "ae" (ADR-0020 §2), and written-out umlauts and "ss" as "ä", "ö", "ü" and "ß", so that
 * "pruefen" also finds "prüfen". At most SEARCH_TERMS_MAX.
 */
export function searchTerms(keyword: string): string[] {
	const typed = keyword.trim().replace(/\s+/g, ' ').toLowerCase();
	const long = foldKeywordText(typed, 'ae');
	const umlauts = long.replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü');
	const terms = new Set<string>();
	for (const term of [
		typed,
		foldKeywordText(typed, 'a'),
		long,
		umlauts,
		long.replace(/ss/g, 'ß'),
		umlauts.replace(/ss/g, 'ß')
	]) {
		if (term !== '') terms.add(term);
	}
	return [...terms].slice(0, SEARCH_TERMS_MAX);
}

/** The criteria of one keyword for UID SEARCH: every searched field for every spelling. */
export function searchCriteria(terms: readonly string[]): SearchObject[] {
	return terms.flatMap((term): SearchObject[] => [
		{ subject: term },
		{ from: term },
		{ to: term },
		{ cc: term },
		{ header: { 'reply-to': term } },
		{ header: { sender: term } },
		{ header: { 'list-id': term } },
		{ header: { organization: term } },
		{ body: term }
	]);
}

/** Whether the header fields of a mail match a keyword (subject and sender, with match_body more). */
export async function headerMatches(headers: Uint8Array, connection: MailConnection): Promise<boolean> {
	let parsed: ParsedMail;
	try {
		parsed = (await PostalMime.parse(headers, MAIL_PARSER_OPTIONS)) as ParsedMail;
	} catch {
		// An unreadable header: the whole mail is loaded and checkMail counts it.
		return true;
	}
	const headerOnly = { ...parsed, text: '', html: undefined, attachments: [] };
	const draft = mailToDraft(headerOnly, 'mail');
	const matchTexts = connection.matchBody ? mailMatchTexts(headerOnly, decodeWords) : [];
	return (
		keywordOf(
			{ title: draft.title, body: '', sourceMeta: draft.sourceMeta, matchTexts },
			connection.keywords,
			connection.matchBody
		) !== ''
	);
}

export interface ScanRun {
	ingest: IngestApi;
	connection: MailConnection;
	session: InboxSession;
	/** Counts of the whole run; `created` also counts the fetch after the cursor. */
	outcome: PollOutcome;
	/** Changed in place; reported after every block. */
	scan: ScanState;
	/** Most entries the run may create in total (MAX_CREATED_PER_RUN). */
	limit: number;
	/** Time (ms since the epoch) after which the scan stops at the next mail; null for none. */
	deadline: number | null;
	isCancelled: () => boolean;
	/** Stores the progress after every block (status route). */
	progress: (scan: ScanState) => Promise<void>;
	now?: () => number;
}

export type ScanEnd = 'done' | 'paused' | 'cancelled' | 'deadline';

interface Candidate {
	uid: number;
	size: number;
}

/** Candidates of a block, newest first: header matches and, with match_body, server hits. */
async function candidatesOf(run: ScanRun, block: readonly number[]): Promise<Candidate[]> {
	const { connection, session, scan } = run;
	const headers = await session.headersOf(block);
	const sizes = new Map(headers.map((header) => [header.uid, header.size]));
	const found = new Map<number, number>();
	for (const header of headers) {
		if (await headerMatches(header.headers, connection)) found.set(header.uid, header.size);
	}
	if (connection.matchBody && headers.length > 0) {
		const from = Math.min(...block);
		const to = Math.max(...block);
		for (const keyword of connection.keywords) {
			const uids = await session.searchAny(from, to, searchCriteria(searchTerms(keyword)));
			if (uids === null) {
				// The server cannot search (e.g. BADCHARSET): load every mail of the block.
				scan.fallback = true;
				for (const [uid, size] of sizes) found.set(uid, size);
				break;
			}
			for (const uid of uids) {
				const size = sizes.get(uid);
				if (size !== undefined) found.set(uid, size);
			}
		}
	}
	return [...found]
		.map(([uid, size]) => ({ uid, size }))
		.sort((a, b) => b.uid - a.uid);
}

/**
 * Runs or continues a scan until it is done, paused at the limit, cancelled or past the deadline.
 * Throws the errors of the mailbox and of the ingest route; the caller keeps the state.
 */
export async function runScan(run: ScanRun): Promise<ScanEnd> {
	const { session, scan, outcome } = run;
	const now = run.now ?? Date.now;
	const all = await session.uidsUpTo(scan.until);
	const pending = all.filter((uid) => uid < scan.below).reverse();
	scan.total = all.length;
	scan.done = all.length - pending.length;
	const stopAt = (uid: number, state: 'paused' | 'cancelled' | 'running'): void => {
		scan.below = uid + 1;
		scan.done = all.filter((value) => value > uid).length;
		scan.state = state;
	};
	if (run.connection.keywords.length === 0) pending.length = 0;
	// The card shows the progress from the start ("0/4.800").
	await run.progress(scan);
	while (pending.length > 0) {
		if (run.isCancelled()) {
			scan.state = 'cancelled';
			return 'cancelled';
		}
		if (run.deadline !== null && now() >= run.deadline) {
			scan.state = 'running';
			return 'deadline';
		}
		const block = pending.splice(0, SCAN_BLOCK_SIZE);
		for (const candidate of await candidatesOf(run, block)) {
			if (outcome.created >= run.limit) {
				stopAt(candidate.uid, 'paused');
				return 'paused';
			}
			if (run.isCancelled()) {
				stopAt(candidate.uid, 'cancelled');
				return 'cancelled';
			}
			if (run.deadline !== null && now() >= run.deadline) {
				stopAt(candidate.uid, 'running');
				return 'deadline';
			}
			const before = outcome.created;
			await checkMail(run.ingest, run.connection, session, candidate.uid, outcome, candidate.size);
			scan.created += outcome.created - before;
		}
		scan.below = block.at(-1) ?? 0;
		scan.done = all.length - pending.length;
		if (pending.length > 0) await run.progress(scan);
	}
	scan.state = 'done';
	scan.below = 0;
	scan.done = scan.total;
	return 'done';
}
