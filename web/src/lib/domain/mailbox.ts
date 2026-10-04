// Mailbox selection (ADR-0016 section 6, ADR-0020 section 4; E4 plan package 23). Pure: the last
// mails of a mail connection as the hook lists them, which are chosen at first, and the texts of
// the result. The only way to take older mails or mails without keyword from a mailbox.

import type { DuplicateState } from './inbox';

/** How many of the last mails the view lists (the hook allows 1 to 200). */
export const MAILBOX_LIMITS = [50, 100, 200] as const;
export type MailboxLimit = (typeof MAILBOX_LIMITS)[number];
export const MAILBOX_DEFAULT_LIMIT: MailboxLimit = 50;
/** Mails per import request (limit of the hook and the helper). */
export const MAILBOX_IMPORT_BATCH = 50;

/** One mail of the list: header data only. */
export interface MailboxMail {
	uid: number;
	size: number;
	subject: string;
	from: string;
	/** Date at the sender (PocketBase timestamp), null if unreadable. */
	date: string | null;
	/** Keyword of the connection in the subject, '' without one. */
	keyword: string;
	/**
	 * State of the entry in the inbox, '' if the mail is not there yet, `moved` if its entry moved
	 * into another area (E7-4b).
	 */
	state: DuplicateState | '';
	/** "Schon im Eingang.", "Schon verworfen.", "Schon Ticket HAUS-12." or "In einen anderen Bereich verschoben." */
	stateMessage: string;
}

export type MailboxImportStatus = 'created' | 'duplicate' | 'failed';

export interface MailboxImportResult {
	uid: number;
	status: MailboxImportStatus;
	message: string;
}

/**
 * Answer of the mailbox routes: the value, or why there is none. "unavailable": the mail helper
 * does not run (neutral hint); "failed": the helper or the mailbox refused (error with reason).
 */
export type MailboxOutcome<T> =
	{ kind: 'ok'; value: T } | { kind: 'unavailable' | 'failed'; message: string; hint: string };

/** Chosen at first: mails with a keyword that are not in the inbox yet. */
export function preselectedUids(mails: readonly MailboxMail[]): number[] {
	return mails.filter((mail) => mail.state === '' && mail.keyword !== '').map((mail) => mail.uid);
}

/** Size as "12 kB" or "1,4 MB". */
export function sizeText(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
	return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Summary of an import for the live region, e.g. "2 neu, 1 schon vorhanden, 1 mit Fehler." */
export function importSummary(results: readonly MailboxImportResult[]): string {
	const count = (status: MailboxImportStatus) =>
		results.filter((result) => result.status === status).length;
	const parts = [`${count('created')} neu`];
	if (count('duplicate') > 0) parts.push(`${count('duplicate')} schon vorhanden`);
	if (count('failed') > 0) parts.push(`${count('failed')} mit Fehler`);
	return `${parts.join(', ')}.`;
}
