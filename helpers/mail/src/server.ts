// Local HTTP interface of the mail helper for the mailbox selection (ADR-0016 section 6; E4 plan
// package 23). PocketBase forwards the requests of the web app here; the browser never talks to
// the helper. It listens on 127.0.0.1 only, needs "Authorization: Bearer <BYL_INGEST_TOKEN>" and
// takes nothing but the ID of a switched-on mail connection: host, user and password come from the
// connection and the environment, as for the regular fetch. The mailbox is only read.
//
//   POST /mailbox/list    { connection, limit }  -> { items: [{ uid, date, from, subject, ... }] }
//   POST /mailbox/import  { connection, uids }   -> { items: [{ uid, status, message }] }
//
// Since testing feedback package A (item 4) also "Jetzt abrufen" and the probe of the card:
//
//   POST /poll            { connection }         -> { status, created, duplicates, ..., error, missing }
//   GET  /health                                 -> { ok: true, version, busy }
//
// /poll runs the regular fetch of one connection at once (same code and cursor as the interval);
// while another fetch runs it answers 409 "running" instead of waiting. /health touches no mailbox.
//
// Since the full scan of the inbox (ADR-0020, addendum 3):
//
//   POST /scan            { connection, action: "start" | "cancel" }
//                         -> 202 { status: "started" } | 409 { status: "running" }
//                         -> 200 { status: "cancelling" | "idle" }
//
// "start" scans the whole inbox again in the background ("Posteingang neu durchsuchen"); the card
// follows the progress through the status of the connection. "cancel" stops a running scan at the
// next mail. /poll gives the scan POLL_SCAN_BUDGET_MS and lets a longer scan go on in the
// background, so "Jetzt abrufen" answers before the hook gives up.

import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import PostalMime, { decodeWords } from 'postal-mime';
import { duplicateMessage, isDuplicateState } from '../../../web/src/lib/domain/inbox';
import {
	mailMatchTexts,
	mailToDraft,
	MAIL_PARSER_OPTIONS,
	type ParsedMail
} from '../../../web/src/lib/domain/inbox-mail';
import { readSecret, type ImapEndpoint } from './config';
import type { IngestApi, MailConnection } from './ingest-client';
import {
	isAuthenticationFailure,
	openInbox,
	type Credentials,
	type ImapClientFactory,
	type InboxSession
} from './imap';
import { PollGate, ScanControl } from './gate';
import { errorText, redact, type Logger } from './log';
import { MAIL_MAX_BYTES, ingestDraft, keywordOf, largeMailDraft, parseMail } from './mail';
import { DEFAULT_PORT, IMPORT_MAX, LIST_DEFAULT, LIST_MAX, PORT_ENV } from './mailbox-limits';
import { pollConnection, type PollDeps, type PollOptions } from './poll';
import { providerOf } from './providers';
import { searchCriteria, searchTerms } from './scan';

export { DEFAULT_PORT, IMPORT_MAX, LIST_DEFAULT, LIST_MAX, PORT_ENV };
/** Time the scan gets within "Jetzt abrufen"; the hook waits 90 s for the answer. */
export const POLL_SCAN_BUDGET_MS = 45_000;
const BODY_MAX_BYTES = 64 * 1024;

export interface ServerDeps {
	token: string;
	ingest: IngestApi;
	env: NodeJS.ProcessEnv;
	log: Logger;
	imapOverride?: ImapEndpoint | null;
	factory?: ImapClientFactory;
	open?: (endpoint: ImapEndpoint, credentials: Credentials) => Promise<InboxSession>;
	/** Shared with the interval loop, so a manual fetch never runs next to a regular one. */
	gate?: PollGate;
	/** Shared with the interval loop: running scans and cancel requests. */
	control?: ScanControl;
	/** Version of the helper for /health. */
	version?: string;
	now?: () => number;
}

/** Answer of POST /poll ("Jetzt abrufen" of a mailbox). */
export interface PollAnswer {
	/** "running": another fetch holds the gate; "gone": the connection was switched off meanwhile. */
	status: 'ok' | 'error' | 'missing' | 'running' | 'gone';
	created: number;
	duplicates: number;
	unmatched: number;
	skipped: number;
	failed: number;
	/** Cleaned error of the run (no secrets). */
	error: string;
	/** Names of the variables that are not set. */
	missing: string[];
}

/** Answer of POST /scan. */
export interface ScanAnswer {
	status: 'started' | 'running' | 'cancelling' | 'idle';
}

/** One mail of the list: header data only, plus the fields PocketBase needs for the duplicate key. */
export interface MailboxEntry {
	uid: number;
	size: number;
	subject: string;
	from: string;
	/** PocketBase timestamp or '' (unreadable date). */
	date: string;
	messageId: string;
	/**
	 * Keyword of the connection that matches the subject or the sender, with match_body also the
	 * headers (exact) or the text (as the search of the server finds it, without loading the mail),
	 * or ''.
	 */
	keyword: string;
	/** Fields of the inbox draft (title, source_ref, source_date, source_meta.from). */
	title: string;
	sourceRef: string;
	sourceDate: string;
	sourceMeta: Record<string, unknown>;
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly extra: Record<string, unknown> = {}
	) {
		super(message);
	}
}

/** The port from BYL_MAIL_HELPER_PORT, else 8091; null for an invalid value. */
export function helperPort(env: NodeJS.ProcessEnv): number | null {
	const value = (env[PORT_ENV] ?? '').trim();
	if (value === '') return DEFAULT_PORT;
	const port = Number(value);
	return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function tokenMatches(expected: string, header: string | undefined): boolean {
	const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
	if (expected === '' || !match) return false;
	const given = Buffer.from(match[1] ?? '');
	const wanted = Buffer.from(expected);
	return given.length === wanted.length && timingSafeEqual(given, wanted);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		size += (chunk as Buffer).length;
		if (size > BODY_MAX_BYTES) throw new HttpError(413, 'Anfrage zu groß.');
		chunks.push(chunk as Buffer);
	}
	try {
		const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			return value as Record<string, unknown>;
		}
	} catch {
		// Falls through to the error below.
	}
	throw new HttpError(400, 'Kein gültiges JSON.');
}

function send(response: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body);
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(text),
		'Cache-Control': 'no-store'
	});
	response.end(text);
}

/** The limit of a list request: 1 to 200, 50 without one. */
export function parseLimit(value: unknown): number {
	if (value === undefined || value === null) return LIST_DEFAULT;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > LIST_MAX) {
		throw new HttpError(400, `limit muss zwischen 1 und ${LIST_MAX} liegen.`);
	}
	return value;
}

/** The UIDs of an import request: 1 to 50 distinct positive integers. */
export function parseUids(value: unknown): number[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > IMPORT_MAX) {
		throw new HttpError(400, `uids muss 1 bis ${IMPORT_MAX} Mails nennen.`);
	}
	const uids = new Set<number>();
	for (const uid of value) {
		if (typeof uid !== 'number' || !Number.isInteger(uid) || uid < 1 || uid > 4294967295) {
			throw new HttpError(400, 'uids enthält keine gültige UID.');
		}
		uids.add(uid);
	}
	return [...uids];
}

/** The ID of a connection in a request, or an HttpError. */
function connectionId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z0-9]{15}$/.test(value)) throw new HttpError(400, 'connection fehlt.');
	return value;
}

/** Opens the inbox of a switched-on mail connection, or throws an HttpError. */
async function openConnection(
	deps: ServerDeps,
	id: unknown
): Promise<{ connection: MailConnection; session: InboxSession; secrets: string[] }> {
	const wanted = connectionId(id);
	const connection = (await deps.ingest.listConnections()).find((item) => item.id === wanted);
	if (connection === undefined) throw new HttpError(404, 'Keine eingeschaltete Mail-Verbindung.');
	const provider = providerOf(connection.provider);
	if (provider === null) throw new HttpError(502, `Unbekannter Mail-Anbieter „${connection.provider}“.`);
	const password = readSecret(connection.secretEnv, deps.env);
	if (password === '' || connection.user === '') {
		throw new HttpError(
			502,
			`Zugangsdaten fehlen: Variable ${connection.secretEnv} anlegen, dann die App neu starten (neu-starten.bat).`
		);
	}
	const secrets = [password, deps.token];
	const open = deps.open ?? ((target, credentials) => openInbox(target, credentials, deps.factory));
	try {
		const session = await open(deps.imapOverride ?? provider, { user: connection.user, pass: password });
		return { connection, session, secrets };
	} catch (error) {
		if (isAuthenticationFailure(error)) {
			throw new HttpError(502, `Anmeldung bei ${provider.label} abgelehnt.`, { hint: provider.loginHint });
		}
		throw new HttpError(502, redact(`${provider.label} nicht erreichbar: ${errorText(error)}`, secrets));
	}
}

/**
 * The first keyword (in the order of the list) whose text search on the server finds each of the
 * listed mails; only with match_body. The server is asked once per keyword over the UIDs of the
 * list; a refused search leaves the text out (the preselection is a suggestion only).
 */
async function textKeywords(
	session: InboxSession,
	connection: MailConnection,
	uids: readonly number[]
): Promise<Map<number, string>> {
	const found = new Map<number, string>();
	if (!connection.matchBody || uids.length === 0) return found;
	const from = Math.min(...uids);
	const to = Math.max(...uids);
	for (const keyword of connection.keywords) {
		const hits = await session.searchAny(from, to, searchCriteria(searchTerms(keyword)));
		if (hits === null) break;
		for (const uid of hits) if (!found.has(uid)) found.set(uid, keyword);
	}
	return found;
}

/**
 * Header data of the last `limit` mails of the inbox, newest first. The preselection matches the
 * subject and the sender, with match_body also the headers (exactly, from the header) and the text
 * as the search of the server finds it, without loading any mail.
 */
export async function listMailbox(deps: ServerDeps, body: Record<string, unknown>): Promise<MailboxEntry[]> {
	const limit = parseLimit(body.limit);
	const { connection, session } = await openConnection(deps, body.connection);
	try {
		const recent = await session.listRecent(limit);
		const inText = await textKeywords(
			session,
			connection,
			recent.map((mail) => mail.uid)
		);
		const entries: MailboxEntry[] = [];
		for (const mail of recent) {
			let parsed: ParsedMail;
			try {
				parsed = (await PostalMime.parse(mail.headers, MAIL_PARSER_OPTIONS)) as ParsedMail;
			} catch {
				parsed = { attachments: [] };
			}
			const headerOnly = { ...parsed, text: '', html: undefined, attachments: [] };
			const draft = mailToDraft(headerOnly, 'mail');
			const matchTexts = connection.matchBody ? mailMatchTexts(headerOnly, decodeWords) : [];
			const inHeader = keywordOf(
				{ title: draft.title, body: '', sourceMeta: draft.sourceMeta, matchTexts },
				connection.keywords,
				connection.matchBody
			);
			entries.push({
				uid: mail.uid,
				size: mail.size,
				subject: draft.title,
				from: typeof draft.sourceMeta?.from === 'string' ? draft.sourceMeta.from : '',
				date: draft.sourceDate ?? '',
				messageId: draft.sourceRef ?? '',
				keyword: inHeader !== '' ? inHeader : (inText.get(mail.uid) ?? ''),
				title: draft.title,
				sourceRef: draft.sourceRef ?? '',
				sourceDate: draft.sourceDate ?? '',
				sourceMeta: draft.sourceMeta?.from === undefined ? {} : { from: draft.sourceMeta.from }
			});
		}
		return entries.sort((a, b) => b.uid - a.uid);
	} finally {
		await session.close();
	}
}

export interface ImportResult {
	uid: number;
	status: 'created' | 'duplicate' | 'failed';
	message: string;
}

/** Takes the chosen mails into the inbox (origin "selected", also without keyword). */
export async function importMails(deps: ServerDeps, body: Record<string, unknown>): Promise<ImportResult[]> {
	const uids = parseUids(body.uids);
	const { connection, session } = await openConnection(deps, body.connection);
	const results: ImportResult[] = [];
	try {
		for (const uid of uids) {
			results.push(await importOne(deps, connection, session, uid));
		}
	} finally {
		await session.close();
	}
	return results;
}

async function importOne(
	deps: ServerDeps,
	connection: MailConnection,
	session: InboxSession,
	uid: number
): Promise<ImportResult> {
	const gone: ImportResult = { uid, status: 'failed', message: 'Die Mail ist nicht mehr im Posteingang.' };
	// A mail over MAIL_MAX_BYTES (25 MB) comes from its beginning and without its file (ADR-0031
	// section 4 and addendum D).
	const size = (await session.headersOf([uid]))[0]?.size;
	if (size === undefined) return gone;
	const large = size > MAIL_MAX_BYTES;
	const source = large ? null : await session.source(uid);
	if (!large && source === null) return gone;
	let draft;
	try {
		draft = source === null ? await largeMailDraft(session, uid, size) : await parseMail(source);
	} catch {
		return { uid, status: 'failed', message: 'Die Mail ließ sich nicht lesen.' };
	}
	if (draft === null) return gone;
	const sent = ingestDraft(draft, connection.id, 'selected');
	const result = await (source === null ? deps.ingest.sendItem(sent) : deps.ingest.sendItem(sent, source));
	switch (result.status) {
		case 'created':
			return { uid, status: 'created', message: '' };
		case 'duplicate':
			// The text of the state, without the key of a ticket the answer does not name; an entry that
			// moved into another area says so (E7-4b, AR-4).
			return {
				uid,
				status: 'duplicate',
				message: duplicateMessage(isDuplicateState(result.state) ? result.state : 'new', '')
			};
		case 'gone':
			return { uid, status: 'failed', message: 'Die Verbindung wurde gelöscht oder ausgeschaltet.' };
		case 'rejected':
			return { uid, status: 'failed', message: result.message };
		case 'unmatched':
			return { uid, status: 'failed', message: 'Abgelehnt.' };
	}
}

function emptyPollAnswer(status: PollAnswer['status']): PollAnswer {
	return { status, created: 0, duplicates: 0, unmatched: 0, skipped: 0, failed: 0, error: '', missing: [] };
}

/** What pollConnection needs, from the interface's dependencies. */
function pollDeps(deps: ServerDeps, control: ScanControl): PollDeps {
	return {
		ingest: deps.ingest,
		env: deps.env,
		log: deps.log,
		imapOverride: deps.imapOverride ?? null,
		...(deps.factory === undefined ? {} : { factory: deps.factory }),
		...(deps.open === undefined ? {} : { open: deps.open }),
		...(deps.now === undefined ? {} : { now: deps.now }),
		secrets: [deps.token],
		control
	};
}

/**
 * Runs pollConnection for `id` behind the gate, with the connection as PocketBase holds it when the
 * gate is free. Does not wait; errors go to the log. `control` marks the connection active from now
 * on, so a cancel request in between is not lost.
 */
function runInBackground(
	deps: ServerDeps,
	gate: PollGate,
	control: ScanControl,
	id: string,
	options: PollOptions
): void {
	control.begin(id);
	void gate
		.run(async () => {
			const connection = (await deps.ingest.listConnections()).find((item) => item.id === id);
			if (connection !== undefined) await pollConnection(pollDeps(deps, control), connection, options);
		})
		.catch((error: unknown) => {
			deps.log.warn(`Durchsuchen des Posteingangs (${id}): ${redact(errorText(error), [deps.token])}`);
		})
		.finally(() => control.end(id));
}

/**
 * "Jetzt abrufen" of a mailbox: the regular fetch of one switched-on connection, at once, with the
 * cursor PocketBase holds right now; a paused scan continues. The scan gets POLL_SCAN_BUDGET_MS;
 * if it needs longer, it goes on in the background after the answer. The result is reported to
 * PocketBase as after every run.
 */
export async function pollNow(deps: ServerDeps, body: Record<string, unknown>): Promise<PollAnswer> {
	const id = connectionId(body.connection);
	const gate = deps.gate ?? new PollGate();
	const control = deps.control ?? new ScanControl();
	const now = deps.now ?? Date.now;
	// The connection is read inside the gate: a fetch that just ended has saved its cursor.
	const ran = await gate.tryRun(async () => {
		const connection = (await deps.ingest.listConnections()).find((item) => item.id === id);
		if (connection === undefined) return null;
		const outcome = await pollConnection(pollDeps(deps, control), connection, {
			manual: true,
			deadline: now() + POLL_SCAN_BUDGET_MS
		});
		return { connection, outcome };
	});
	if (ran === null) return emptyPollAnswer('running');
	if (ran.value === null) throw new HttpError(404, 'Keine eingeschaltete Mail-Verbindung.');
	const { connection, outcome } = ran.value;
	if (outcome.scanPending) runInBackground(deps, gate, control, id, { manual: true });
	const answer: PollAnswer = {
		...emptyPollAnswer('ok'),
		created: outcome.created,
		duplicates: outcome.duplicates,
		unmatched: outcome.unmatched,
		skipped: outcome.skipped,
		failed: outcome.failed
	};
	switch (outcome.status) {
		case 'ok':
			return answer;
		case 'missing':
			return { ...answer, status: 'missing', missing: [connection.secretEnv] };
		case 'gone':
			return { ...answer, status: 'gone' };
		case 'error':
		case 'stopped':
			return { ...answer, status: 'error', error: outcome.error };
	}
}

/**
 * "Posteingang neu durchsuchen" and "Abbrechen" (ADR-0020, addendum 3). "start" answers at once and
 * scans in the background, or "running" while another fetch holds the gate; "cancel" stops a
 * running scan of the connection at the next mail, or answers "idle" when none runs here.
 */
export async function scanNow(deps: ServerDeps, body: Record<string, unknown>): Promise<ScanAnswer> {
	const id = connectionId(body.connection);
	const control = deps.control ?? new ScanControl();
	if (body.action === 'cancel') return { status: control.requestCancel(id) ? 'cancelling' : 'idle' };
	if (body.action !== 'start') throw new HttpError(400, 'action muss start oder cancel sein.');
	const gate = deps.gate ?? new PollGate();
	if (gate.busy) return { status: 'running' };
	if (!(await deps.ingest.listConnections()).some((item) => item.id === id)) {
		throw new HttpError(404, 'Keine eingeschaltete Mail-Verbindung.');
	}
	if (gate.busy) return { status: 'running' };
	runInBackground(deps, gate, control, id, { manual: true, rescan: true });
	return { status: 'started' };
}

/** The HTTP server; `listen` binds it to 127.0.0.1 only. */
export function createMailboxServer(deps: ServerDeps): Server {
	return createServer((request, response) => {
		void handle(deps, request, response);
	});
}

async function handle(deps: ServerDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
	try {
		if (!tokenMatches(deps.token, request.headers.authorization)) {
			throw new HttpError(401, 'Ungültiger Token.');
		}
		const route = `${request.method ?? ''} ${request.url ?? ''}`;
		switch (route) {
			case 'GET /health':
				send(response, 200, { ok: true, version: deps.version ?? 'dev', busy: deps.gate?.busy ?? false });
				return;
			case 'POST /mailbox/list':
				send(response, 200, { items: await listMailbox(deps, await readJson(request)) });
				return;
			case 'POST /mailbox/import':
				send(response, 200, { items: await importMails(deps, await readJson(request)) });
				return;
			case 'POST /poll': {
				const answer = await pollNow(deps, await readJson(request));
				send(response, answer.status === 'running' ? 409 : 200, answer);
				return;
			}
			case 'POST /scan': {
				const answer = await scanNow(deps, await readJson(request));
				send(response, answer.status === 'started' ? 202 : answer.status === 'running' ? 409 : 200, answer);
				return;
			}
			default:
				throw new HttpError(404, 'Nicht gefunden.');
		}
	} catch (error) {
		if (error instanceof HttpError) {
			send(response, error.status, { message: error.message, ...error.extra });
			return;
		}
		const message = redact(errorText(error), [deps.token]);
		deps.log.warn(`Postfach-Auswahl: ${message}`);
		send(response, 502, { message });
	}
}

/** Starts the interface on 127.0.0.1; resolves null (and logs) if the port is taken or invalid. */
export async function startMailboxServer(deps: ServerDeps): Promise<Server | null> {
	const port = helperPort(deps.env);
	if (port === null) {
		deps.log.warn(`${PORT_ENV} ist kein gültiger Port; die Postfach-Auswahl ist aus.`);
		return null;
	}
	const server = createMailboxServer(deps);
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(port, '127.0.0.1', () => resolve());
		});
	} catch (error) {
		deps.log.warn(`Port ${port} auf 127.0.0.1 ist belegt (${errorText(error)}); die Postfach-Auswahl ist aus, der Abruf läuft weiter.`);
		return null;
	}
	deps.log.info(`Postfach-Auswahl auf http://127.0.0.1:${port} bereit.`);
	return server;
}
