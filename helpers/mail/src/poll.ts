// One run of the mail helper (ADR-0016 section 5, ADR-0020; E4 plan package 11): for every switched-on
// mail connection, open the inbox read-only, check the mails after the cursor and hand only those
// with a keyword to the ingest route. Since the user decision of 2026-09-27 (ADR-0020, addendum 3)
// the whole inbox is searched as well (scan.ts): at the first run, after every change of the
// keywords or of match_body (signature), after a new UIDVALIDITY and on request ("Posteingang neu
// durchsuchen"). The first run sets the cursor to the highest UID, the scan covers everything up
// to it, newer mails come through the cursor, which moves over every checked mail. Duplicates are
// recognised by the server (Message-ID), so running again after a crash or an outage is harmless.

import { readSecret } from './config';
import type { ImapEndpoint } from './config';
import { ScanControl } from './gate';
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
import { MAIL_MAX_BYTES } from './mail';
import { ConnectionGone, checkMail, emptyOutcome, type PollOutcome } from './mail-check';
import { providerOf, type MailProvider } from './providers';
import { MAX_CREATED_PER_RUN, newScan, runScan, scanSignature } from './scan';
import { scanStateValue, type ScanState } from './scan-state';

export type { PollOutcome } from './mail-check';

/** Mails after the cursor checked per run and connection; the rest follows with the next run. */
export const MAX_MAILS_PER_RUN = 100;

export const FIRST_RUN_HINT =
	'Erster Abruf: Der gesamte Posteingang wird nach Stichwörtern durchsucht (nicht Papierkorb, Spam oder Gesendet); danach kommen neue Mails mit Stichwort.';
export const UIDVALIDITY_HINT =
	'Der Posteingang wurde vom Anbieter neu nummeriert (UIDVALIDITY). Er wird neu durchsucht; was schon im Eingang ist, kommt nicht doppelt.';
export const SCAN_MORE_HINT = `Weitere Treffer – erneut abrufen: Pro Abruf kommen höchstens ${MAX_CREATED_PER_RUN} neue Einträge.`;
export const SCAN_FALLBACK_HINT =
	'Der Anbieter durchsucht Mail-Texte nicht; die App lädt die Mails dafür einzeln (langsamer).';

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
	/** Shared with the local interface: which scans run and which are to be cancelled. */
	control?: ScanControl;
	now?: () => number;
}

export interface PollOptions {
	/** A manual run ("Jetzt abrufen", "Posteingang neu durchsuchen"): continues a paused scan. */
	manual?: boolean;
	/** Starts the full scan over. */
	rescan?: boolean;
	/** Time (ms since the epoch) after which the scan stops and continues later; none by default. */
	deadline?: number | null;
}

/** "UIDVALIDITY:UID" as parts, or null for an empty or broken cursor. */
export function parseCursor(cursor: string): { uidValidity: string; uid: number } | null {
	const match = /^(\d{1,10}):(\d{1,10})$/.exec(cursor);
	if (!match) return null;
	return { uidValidity: String(Number(match[1])), uid: Number(match[2]) };
}

function label(connection: MailConnection): string {
	return `Postfach "${connection.label}" (${connection.id})`;
}

function summary(outcome: PollOutcome): string {
	const parts = [`${outcome.created} neu`];
	if (outcome.duplicates > 0) parts.push(`${outcome.duplicates} schon vorhanden`);
	if (outcome.unmatched > 0) parts.push(`${outcome.unmatched} ohne Stichwort`);
	if (outcome.skipped > 0) parts.push(`${outcome.skipped} über 10 MB übersprungen`);
	if (outcome.failed > 0) parts.push(`${outcome.failed} nicht lesbar oder abgelehnt`);
	const scan = outcome.scan;
	if (scan !== null) parts.push(`Posteingang ${scan.done}/${scan.total} (${scan.state})`);
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
 * The scan this run works on, or null: a new one at the first run, after a new UIDVALIDITY, a
 * change of keywords or match_body, without a stored state or on request; else the stored one if
 * it runs (or failed last time), and a paused one only in a manual run.
 */
export function nextScan(
	connection: MailConnection,
	uidValidity: string,
	cursor: string,
	fresh: boolean,
	options: PollOptions
): ScanState | null {
	const signature = scanSignature(connection.keywords, connection.matchBody);
	const stored = connection.scan;
	if (
		fresh ||
		options.rescan === true ||
		stored === null ||
		stored.signature !== signature ||
		stored.uidValidity !== uidValidity
	) {
		return newScan(signature, uidValidity, parseCursor(cursor)?.uid ?? 0);
	}
	if (stored.state === 'running' || stored.state === 'error') return { ...stored, state: 'running' };
	if (stored.state === 'paused' && options.manual === true) return { ...stored, state: 'running' };
	return null;
}

/**
 * Runs one connection and reports its result to PocketBase. Never throws for errors of the
 * mailbox; an unusable PocketBase ends the run (IngestError) so the caller stops for this interval.
 */
export async function pollConnection(
	deps: PollDeps,
	connection: MailConnection,
	options: PollOptions = {}
): Promise<PollOutcome> {
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
	const control = deps.control ?? new ScanControl();
	const owner = !control.isActive(connection.id);
	if (owner) control.begin(connection.id);
	let hint = '';
	try {
		const cursor = parseCursor(connection.cursor);
		const fresh = cursor === null || cursor.uidValidity !== session.uidValidity;
		if (fresh) {
			hint = cursor === null ? FIRST_RUN_HINT : UIDVALIDITY_HINT;
			outcome.cursor = `${session.uidValidity}:${session.highestUid}`;
		} else {
			await checkMails(deps, connection, session, cursor.uid, outcome);
		}
		outcome.scan = nextScan(connection, session.uidValidity, outcome.cursor, fresh, options);
		if (outcome.scan !== null) {
			const scan = outcome.scan;
			const end = await runScan({
				ingest: deps.ingest,
				connection,
				session,
				outcome,
				scan,
				limit: MAX_CREATED_PER_RUN,
				deadline: options.deadline ?? null,
				isCancelled: () => control.isCancelled(connection.id),
				progress: (state) =>
					report(deps, connection, { error: '', cursor: outcome.cursor, scan: scanStateValue(state) }),
				...(deps.now === undefined ? {} : { now: deps.now })
			});
			if (end === 'paused') hint = SCAN_MORE_HINT;
			else if (scan.fallback) hint = SCAN_FALLBACK_HINT;
			outcome.scanPending = end === 'deadline';
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
			// The scan continues where it stopped in the next run.
			if (outcome.scan !== null) outcome.scan.state = 'error';
		}
	} finally {
		if (owner) control.end(connection.id);
		await session.close();
	}
	const scan = outcome.scan === null ? {} : { scan: scanStateValue(outcome.scan) };
	if (outcome.status === 'gone') {
		deps.log.info(`${label(connection)} wurde während des Abrufs gelöscht oder ausgeschaltet.`);
		return outcome;
	}
	if (outcome.status === 'stopped') {
		deps.log.warn(`${label(connection)}: Abruf unterbrochen: ${outcome.error}`);
		// The ingest route is unusable; the cursor stays at the last saved mail and the next run
		// checks the rest again (duplicates are recognised).
		await report(deps, connection, { error: outcome.error, cursor: outcome.cursor, ...scan });
		return outcome;
	}
	if (outcome.status === 'error') {
		deps.log.warn(`${label(connection)}: ${outcome.error}`);
		await report(deps, connection, { error: outcome.error, cursor: outcome.cursor, ...scan });
		return outcome;
	}
	deps.log.info(`${label(connection)}: ${summary(outcome)}.`);
	await report(deps, connection, { error: '', hint, cursor: outcome.cursor, ...scan });
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
		if (outcome.created >= MAX_CREATED_PER_RUN) break;
		if (mail.size > MAIL_MAX_BYTES) {
			outcome.skipped += 1;
		} else {
			await checkMail(deps.ingest, connection, session, mail.uid, outcome);
		}
		outcome.cursor = `${session.uidValidity}:${mail.uid}`;
	}
}

/**
 * One run over all switched-on mail connections, one after the other; each is read again just
 * before its turn, so a scan cancelled meanwhile stays cancelled. Returns the outcomes; an
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
	for (const listed of connections) {
		try {
			const connection =
				listed === connections[0]
					? listed
					: (await deps.ingest.listConnections()).find((item) => item.id === listed.id);
			if (connection === undefined) continue;
			const outcome = await pollConnection(deps, connection);
			outcomes.push(outcome);
			if (outcome.status === 'stopped') break;
		} catch (error) {
			if (error instanceof IngestError) {
				deps.log.warn(`Verbindungen nicht abrufbar: ${errorText(error)}`);
				break;
			}
			deps.log.error(`${label(listed)}: ${redact(errorText(error), deps.secrets ?? [])}`);
		}
	}
	return outcomes;
}
