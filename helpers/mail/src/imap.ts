// Read-only access to the inbox of a mailbox with imapflow (ADR-0016 sections 4 to 6). The folder is
// opened with EXAMINE (readOnly), mails are read with BODY.PEEK, so the server sets no flag, not
// even \Seen. There is no call that stores flags, copies, moves, deletes, appends or sends.

import { ImapFlow, type ImapFlowOptions, type SearchObject } from 'imapflow';
import type { ImapEndpoint } from './config';
import { MAIL_MAX_BYTES } from './mail';

export const INBOX = 'INBOX';

/**
 * Header fields a full scan of the inbox reads for every mail (BODY.PEEK[HEADER.FIELDS (…)]):
 * what the keywords search (ADR-0020, addendum 2) and the parser needs for the subject.
 */
export const MATCH_HEADER_FIELDS: readonly string[] = Object.freeze([
	'SUBJECT',
	'FROM',
	'TO',
	'CC',
	'REPLY-TO',
	'SENDER',
	'LIST-ID',
	'ORGANIZATION',
	'MIME-VERSION',
	'CONTENT-TYPE'
]);

/** A mail of the inbox by UID, with its size in bytes. */
export interface MailRef {
	uid: number;
	size: number;
}

/** A mail of the inbox with its header only (mailbox selection, ADR-0016 section 6). */
export interface MailHeader extends MailRef {
	headers: Uint8Array;
}

export interface InboxSession {
	/** UIDVALIDITY of the inbox as text (it can exceed a safe integer in theory). */
	readonly uidValidity: string;
	/** Highest UID in the inbox, 0 when it is empty. */
	readonly highestUid: number;
	/** Mails with a UID above `afterUid`, ascending, at most `limit`. */
	listAfter(afterUid: number, limit: number): Promise<MailRef[]>;
	/** Header of the last `limit` mails of the inbox (by position), ascending by UID. */
	listRecent(limit: number): Promise<MailHeader[]>;
	/** UIDs of the inbox from 1 to `until`, ascending (UID SEARCH UID 1:until). */
	uidsUpTo(until: number): Promise<number[]>;
	/** The MATCH_HEADER_FIELDS and the size of the mails `uids`, ascending by UID. */
	headersOf(uids: readonly number[]): Promise<MailHeader[]>;
	/**
	 * UIDs from `from` to `to` that the server finds for one of `any` (UID SEARCH with OR, read
	 * only), ascending; null when the server refuses the search (NO or BAD, e.g. BADCHARSET).
	 */
	searchAny(from: number, to: number, any: readonly SearchObject[]): Promise<number[] | null>;
	/** The source of one mail, or null if it is gone. */
	source(uid: number): Promise<Uint8Array | null>;
	/** Logs out; errors while closing are ignored. */
	close(): Promise<void>;
}

export interface Credentials {
	user: string;
	pass: string;
}

/** The part of ImapFlow the session uses (a fake in the unit tests). */
export type ImapClient = Pick<
	ImapFlow,
	'connect' | 'getMailboxLock' | 'fetch' | 'fetchOne' | 'search' | 'logout' | 'close' | 'on'
> & { mailbox: ImapFlow['mailbox'] };

export type ImapClientFactory = (options: ImapFlowOptions) => ImapClient;

/** Options of imapflow: no logging (it would log addresses), no IDLE, bounded waits and sizes. */
export function clientOptions(endpoint: ImapEndpoint, credentials: Credentials): ImapFlowOptions {
	return {
		host: endpoint.host,
		port: endpoint.port,
		secure: endpoint.secure,
		auth: { user: credentials.user, pass: credentials.pass },
		logger: false,
		disableAutoIdle: true,
		connectionTimeout: 30_000,
		greetingTimeout: 16_000,
		socketTimeout: 120_000,
		maxLiteralSize: MAIL_MAX_BYTES + 1024 * 1024,
		maxResponseSize: MAIL_MAX_BYTES + 2 * 1024 * 1024
	};
}

export const createImapClient: ImapClientFactory = (options) => new ImapFlow(options);

function parseRange(from: number): string {
	return `${from}:*`;
}

/**
 * Connects and opens the inbox read-only. Throws the error of imapflow for a refused login
 * (`authenticationFailed`) or an unreachable server; refuses a server that opens the folder
 * writable although EXAMINE was sent.
 */
export async function openInbox(
	endpoint: ImapEndpoint,
	credentials: Credentials,
	factory: ImapClientFactory = createImapClient
): Promise<InboxSession> {
	const client = factory(clientOptions(endpoint, credentials));
	// An error event without listener would end the process (socket errors after a run).
	client.on('error', () => undefined);
	let lock: { release(): void } | null = null;
	const close = async () => {
		lock?.release();
		lock = null;
		try {
			await client.logout();
		} catch {
			client.close();
		}
	};
	try {
		await client.connect();
		lock = await client.getMailboxLock(INBOX, { readOnly: true });
		const mailbox = client.mailbox;
		if (mailbox === false || mailbox.readOnly !== true) {
			throw new Error('Der Posteingang ließ sich nicht nur lesend öffnen.');
		}
		let highestUid = mailbox.uidNext > 0 ? mailbox.uidNext - 1 : 0;
		if (mailbox.exists > 0 && mailbox.uidNext <= 0) {
			const uids = (await client.search({ all: true }, { uid: true })) || [];
			highestUid = uids.length === 0 ? 0 : Math.max(...uids);
		}
		const uidValidity = String(mailbox.uidValidity);
		return {
			uidValidity,
			highestUid,
			async listAfter(afterUid, limit) {
				if (mailbox.exists === 0) return [];
				const found: MailRef[] = [];
				for await (const message of client.fetch(parseRange(afterUid + 1), { uid: true, size: true }, { uid: true })) {
					// "n:*" also returns the last mail when n is above the highest UID (RFC 3501).
					if (message.uid > afterUid) found.push({ uid: message.uid, size: message.size ?? 0 });
				}
				return found.sort((a, b) => a.uid - b.uid).slice(0, limit);
			},
			async listRecent(limit) {
				if (mailbox.exists === 0) return [];
				const from = Math.max(1, mailbox.exists - limit + 1);
				const found: MailHeader[] = [];
				// Sequence numbers, not UIDs: the last messages by position. BODY.PEEK[HEADER] only.
				for await (const message of client.fetch(`${from}:*`, { uid: true, size: true, headers: true })) {
					found.push({
						uid: message.uid,
						size: message.size ?? 0,
						headers: new Uint8Array(message.headers ?? Buffer.alloc(0))
					});
				}
				return found.sort((a, b) => a.uid - b.uid).slice(-limit);
			},
			async uidsUpTo(until) {
				if (mailbox.exists === 0 || until < 1) return [];
				const uids = await client.search({ uid: `1:${until}` }, { uid: true });
				if (!Array.isArray(uids)) throw new Error('Der Posteingang ließ sich nicht auflisten.');
				// "1:n" also returns the highest UID when n is below it (RFC 3501); keep only up to n.
				return uids.filter((uid) => uid <= until).sort((a, b) => a - b);
			},
			async headersOf(uids) {
				if (uids.length === 0) return [];
				const wanted = new Set(uids);
				const found: MailHeader[] = [];
				const query = { uid: true, size: true, headers: [...MATCH_HEADER_FIELDS] };
				for await (const message of client.fetch(uids.join(','), query, { uid: true })) {
					if (!wanted.has(message.uid)) continue;
					found.push({
						uid: message.uid,
						size: message.size ?? 0,
						headers: new Uint8Array(message.headers ?? Buffer.alloc(0))
					});
				}
				return found.sort((a, b) => a.uid - b.uid);
			},
			async searchAny(from, to, any) {
				if (mailbox.exists === 0 || any.length === 0) return [];
				const query: SearchObject = { uid: `${from}:${to}`, ...(any.length === 1 ? any[0] : { or: [...any] }) };
				const uids = await client.search(query, { uid: true });
				if (!Array.isArray(uids)) return null;
				return uids.filter((uid) => uid >= from && uid <= to).sort((a, b) => a - b);
			},
			async source(uid) {
				const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
				return message && message.source ? new Uint8Array(message.source) : null;
			},
			close
		};
	} catch (error) {
		await close();
		throw error;
	}
}

/** True for the error of a refused login (imapflow AuthenticationFailure). */
export function isAuthenticationFailure(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { authenticationFailed?: unknown }).authenticationFailed === true
	);
}
