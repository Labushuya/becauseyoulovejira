// One run of the mail helper (ADR-0016 section 5, ADR-0020; E4 plan package 11): for every switched-on
// mail connection, open the inbox read-only, check the mails after the cursor and hand only those
// with a keyword to the ingest route. Scope after P-10: inbox, from the setup on, keyword matches
// only. The first run sets the cursor to the highest UID and takes nothing older; the cursor then
// moves over every checked mail, with or without keyword. A new UIDVALIDITY starts over at the
// highest UID with a hint. Duplicates are recognised by the server (Message-ID), so running again
// after a crash or an outage is harmless.

import { readSecret } from './config';
import type { ImapEndpoint } from './config';
import type { IngestApi, MailConnection, StatusReport } from './ingest-client';
import { IngestError } from './ingest-client';
import {
	isAuthenticationFailure,
	openInbox,
	type Credentials,
	type ImapClientFactory,
	type InboxSession
} from './imap';
import { errorText, redact, type Logger } from './log';
import { MAIL_MAX_BYTES, ingestDraft, keywordOf, parseMail } from './mail';
import { providerOf, type MailProvider } from './providers';

/** Mails checked per run and connection; the rest follows with the next run. */
export const MAX_MAILS_PER_RUN = 100;

export const FIRST_RUN_HINT =
	'Erster Abruf: Ab jetzt kommen neue Mails mit Stichwort in den Eingang, ältere bleiben im Postfach.';
export const UIDVALIDITY_HINT =
	'Der Posteingang wurde vom Anbieter neu nummeriert (UIDVALIDITY). Der Abruf beginnt bei den neuesten Mails; ältere kommen nicht noch einmal.';

export interface PollDeps {
	ingest: IngestApi;
	env: NodeJS.ProcessEnv;
	log: Logger;
	/** Test only: IMAP server that replaces every provider. */
	imapOverride?: ImapEndpoint | null;
	factory?: ImapClientFactory;
	open?: (endpoint: ImapEndpoint, credentials: Credentials) => Promise<InboxSession>;
	/** Values that never appear in a report or the log (the token). */
	secrets?: readonly string[];
}

export interface PollOutcome {
	status: 'ok' | 'error' | 'missing' | 'stopped' | 'gone';
	created: number;
	duplicates: number;
	unmatched: number;
	skipped: number;
	failed: number;
	cursor: string;
	error: string;
}

/** The connection was deleted or switched off during the run. */
class ConnectionGone extends Error {}

/** "UIDVALIDITY:UID" as parts, or null for an empty or broken cursor. */
export function parseCursor(cursor: string): { uidValidity: string; uid: number } | null {
	const match = /^(\d{1,10}):(\d{1,10})$/.exec(cursor);
	if (!match) return null;
	return { uidValidity: String(Number(match[1])), uid: Number(match[2]) };
}

function label(connection: MailConnection): string {
	return `Postfach "${connection.label}" (${connection.id})`;
}

function emptyOutcome(cursor: string): PollOutcome {
	return {
		status: 'ok',
		created: 0,
		duplicates: 0,
		unmatched: 0,
		skipped: 0,
		failed: 0,
		cursor,
		error: ''
	};
}

function summary(outcome: PollOutcome): string {
	const parts = [`${outcome.created} neu`];
	if (outcome.duplicates > 0) parts.push(`${outcome.duplicates} schon vorhanden`);
	if (outcome.unmatched > 0) parts.push(`${outcome.unmatched} ohne Stichwort`);
	if (outcome.skipped > 0) parts.push(`${outcome.skipped} über 10 MB übersprungen`);
	if (outcome.failed > 0) parts.push(`${outcome.failed} nicht lesbar oder abgelehnt`);
	return parts.join(', ');
}

/** Error text for a failed connection to the mailbox, without secrets. */
function mailboxError(provider: MailProvider, error: unknown, secrets: readonly string[]): string {
	if (isAuthenticationFailure(error)) return `Anmeldung bei ${provider.label} abgelehnt.`;
	return redact(`${provider.label} nicht erreichbar oder Fehler beim Abruf: ${errorText(error)}`, secrets);
}

async function report(deps: PollDeps, connection: MailConnection, status: StatusReport): Promise<void> {
	try {
		await deps.ingest.reportStatus(connection.id, status);
	} catch (error) {
		deps.log.warn(`${label(connection)}: Status nicht gespeichert: ${errorText(error)}`);
	}
}

/**
 * Runs one connection and reports its result to PocketBase. Never throws for errors of the
 * mailbox; an unusable PocketBase ends the run (IngestError) so the caller stops for this interval.
 */
export async function pollConnection(deps: PollDeps, connection: MailConnection): Promise<PollOutcome> {
	const outcome = emptyOutcome(connection.cursor);
	const provider = providerOf(connection.provider);
	const password = readSecret(connection.secretEnv, deps.env);
	const secrets = [password, ...(deps.secrets ?? [])];
	if (provider === null) {
		outcome.status = 'error';
		outcome.error = `Unbekannter Mail-Anbieter „${connection.provider}“.`;
		await report(deps, connection, { error: outcome.error });
		return outcome;
	}
	if (password === '' || connection.user === '') {
		outcome.status = 'missing';
		deps.log.warn(
			`${label(connection)} ruft nichts ab, solange ${connection.secretEnv} fehlt (Variable anlegen, dann stop.bat und start.bat).`
		);
		return outcome;
	}
	const endpoint = deps.imapOverride ?? provider;
	const open = deps.open ?? ((target, credentials) => openInbox(target, credentials, deps.factory));
	let session: InboxSession;
	try {
		session = await open(endpoint, { user: connection.user, pass: password });
	} catch (error) {
		outcome.status = 'error';
		outcome.error = mailboxError(provider, error, secrets);
		deps.log.warn(`${label(connection)}: ${outcome.error}`);
		await report(deps, connection, {
			error: outcome.error,
			...(isAuthenticationFailure(error) ? { hint: provider.loginHint } : {})
		});
		return outcome;
	}
	let hint = '';
	try {
		const cursor = parseCursor(connection.cursor);
		if (cursor === null || cursor.uidValidity !== session.uidValidity) {
			hint = cursor === null ? FIRST_RUN_HINT : UIDVALIDITY_HINT;
			outcome.cursor = `${session.uidValidity}:${session.highestUid}`;
		} else {
			await checkMails(deps, connection, session, cursor.uid, outcome);
		}
	} catch (error) {
		if (error instanceof ConnectionGone) {
			outcome.status = 'gone';
		} else if (error instanceof IngestError) {
			outcome.status = 'stopped';
			outcome.error = error.message;
		} else {
			outcome.status = 'error';
			outcome.error = mailboxError(provider, error, secrets);
		}
	} finally {
		await session.close();
	}
	if (outcome.status === 'gone') {
		deps.log.info(`${label(connection)} wurde während des Abrufs gelöscht oder ausgeschaltet.`);
		return outcome;
	}
	if (outcome.status === 'stopped') {
		deps.log.warn(`${label(connection)}: Abruf unterbrochen: ${outcome.error}`);
		// The ingest route is unusable; the cursor stays at the last saved mail and the next run
		// checks the rest again (duplicates are recognised).
		await report(deps, connection, { error: outcome.error, cursor: outcome.cursor });
		return outcome;
	}
	if (outcome.status === 'error') {
		deps.log.warn(`${label(connection)}: ${outcome.error}`);
		await report(deps, connection, { error: outcome.error, cursor: outcome.cursor });
		return outcome;
	}
	deps.log.info(`${label(connection)}: ${summary(outcome)}.`);
	await report(deps, connection, { error: '', hint, cursor: outcome.cursor });
	return outcome;
}

async function checkMails(
	deps: PollDeps,
	connection: MailConnection,
	session: InboxSession,
	afterUid: number,
	outcome: PollOutcome
): Promise<void> {
	const mails = await session.listAfter(afterUid, MAX_MAILS_PER_RUN);
	for (const mail of mails) {
		if (mail.size > MAIL_MAX_BYTES) {
			outcome.skipped += 1;
		} else {
			await checkMail(deps, connection, session, mail.uid, outcome);
		}
		outcome.cursor = `${session.uidValidity}:${mail.uid}`;
	}
}

async function checkMail(
	deps: PollDeps,
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
	const result = await deps.ingest.sendItem(ingestDraft(draft, connection.id, 'auto'), source);
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

/**
 * One run over all switched-on mail connections, one after the other. Returns the outcomes; an
 * unusable PocketBase ends the run early and is logged once per run.
 */
export async function pollAll(deps: PollDeps): Promise<PollOutcome[]> {
	let connections: MailConnection[];
	try {
		connections = await deps.ingest.listConnections();
	} catch (error) {
		deps.log.warn(`Verbindungen nicht abrufbar: ${errorText(error)}`);
		return [];
	}
	const outcomes: PollOutcome[] = [];
	for (const connection of connections) {
		try {
			const outcome = await pollConnection(deps, connection);
			outcomes.push(outcome);
			if (outcome.status === 'stopped') break;
		} catch (error) {
			deps.log.error(`${label(connection)}: ${redact(errorText(error), deps.secrets ?? [])}`);
		}
	}
	return outcomes;
}
