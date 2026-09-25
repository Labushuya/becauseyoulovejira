// Read-only access to the inbox of a mailbox with imapflow (ADR-0016 sections 4 to 6). The folder is
// opened with EXAMINE (readOnly), mails are read with BODY.PEEK, so the server sets no flag, not
// even \Seen. There is no call that stores flags, copies, moves, deletes, appends or sends.

import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import type { ImapEndpoint } from './config';
import { MAIL_MAX_BYTES } from './mail';

export const INBOX = 'INBOX';

/** A mail of the inbox by UID, with its size in bytes. */
export interface MailRef {
	uid: number;
	size: number;
}

export interface InboxSession {
	/** UIDVALIDITY of the inbox as text (it can exceed a safe integer in theory). */
	readonly uidValidity: string;
	/** Highest UID in the inbox, 0 when it is empty. */
	readonly highestUid: number;
	/** Mails with a UID above `afterUid`, ascending, at most `limit`. */
	listAfter(afterUid: number, limit: number): Promise<MailRef[]>;
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
