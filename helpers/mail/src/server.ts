// Local HTTP interface of the mail helper for the mailbox selection (ADR-0016 section 6; E4 plan
// package 23). PocketBase forwards the requests of the web app here; the browser never talks to
// the helper. It listens on 127.0.0.1 only, needs "Authorization: Bearer <BYL_INGEST_TOKEN>" and
// takes nothing but the ID of a switched-on mail connection: host, user and password come from the
// connection and the environment, as for the regular fetch. The mailbox is only read.
//
//   POST /mailbox/list    { connection, limit }  -> { items: [{ uid, date, from, subject, ... }] }
//   POST /mailbox/import  { connection, uids }   -> { items: [{ uid, status, message }] }

import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import PostalMime from 'postal-mime';
import { mailToDraft, MAIL_PARSER_OPTIONS, type ParsedMail } from '../../../web/src/lib/domain/inbox-mail';
import { readSecret, type ImapEndpoint } from './config';
import type { IngestApi, MailConnection } from './ingest-client';
import {
	isAuthenticationFailure,
	openInbox,
	type Credentials,
	type ImapClientFactory,
	type InboxSession
} from './imap';
import { errorText, redact, type Logger } from './log';
import { MAIL_MAX_BYTES, ingestDraft, keywordOf, parseMail } from './mail';
import { providerOf } from './providers';

export const DEFAULT_PORT = 8091;
export const PORT_ENV = 'BYL_MAIL_HELPER_PORT';
export const LIST_DEFAULT = 50;
export const LIST_MAX = 200;
export const IMPORT_MAX = 50;
const BODY_MAX_BYTES = 64 * 1024;

export interface ServerDeps {
	token: string;
	ingest: IngestApi;
	env: NodeJS.ProcessEnv;
	log: Logger;
	imapOverride?: ImapEndpoint | null;
	factory?: ImapClientFactory;
	open?: (endpoint: ImapEndpoint, credentials: Credentials) => Promise<InboxSession>;
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
	/** Keyword of the connection that matches the subject or the sender, or ''. */
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

/** Opens the inbox of a switched-on mail connection, or throws an HttpError. */
async function openConnection(
	deps: ServerDeps,
	id: unknown
): Promise<{ connection: MailConnection; session: InboxSession; secrets: string[] }> {
	if (typeof id !== 'string' || !/^[a-z0-9]{15}$/.test(id)) throw new HttpError(400, 'connection fehlt.');
	const connection = (await deps.ingest.listConnections()).find((item) => item.id === id);
	if (connection === undefined) throw new HttpError(404, 'Keine eingeschaltete Mail-Verbindung.');
	const provider = providerOf(connection.provider);
	if (provider === null) throw new HttpError(502, `Unbekannter Mail-Anbieter „${connection.provider}“.`);
	const password = readSecret(connection.secretEnv, deps.env);
	if (password === '' || connection.user === '') {
		throw new HttpError(
			502,
			`Zugangsdaten fehlen: Variable ${connection.secretEnv} anlegen, dann die App neu starten (stop.bat, dann start.bat).`
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

/** Header data of the last `limit` mails of the inbox, newest first. */
export async function listMailbox(deps: ServerDeps, body: Record<string, unknown>): Promise<MailboxEntry[]> {
	const limit = parseLimit(body.limit);
	const { connection, session } = await openConnection(deps, body.connection);
	try {
		const recent = await session.listRecent(limit);
		const entries: MailboxEntry[] = [];
		for (const mail of recent) {
			let parsed: ParsedMail;
			try {
				parsed = (await PostalMime.parse(mail.headers, MAIL_PARSER_OPTIONS)) as ParsedMail;
			} catch {
				parsed = { attachments: [] };
			}
			const draft = mailToDraft({ ...parsed, text: '', html: undefined, attachments: [] }, 'mail');
			entries.push({
				uid: mail.uid,
				size: mail.size,
				subject: draft.title,
				from: typeof draft.sourceMeta?.from === 'string' ? draft.sourceMeta.from : '',
				date: draft.sourceDate ?? '',
				messageId: draft.sourceRef ?? '',
				keyword: keywordOf({ title: draft.title, body: '', sourceMeta: draft.sourceMeta }, connection.keywords, false),
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
	const source = await session.source(uid);
	if (source === null) return { uid, status: 'failed', message: 'Die Mail ist nicht mehr im Posteingang.' };
	if (source.length > MAIL_MAX_BYTES) return { uid, status: 'failed', message: 'Größer als 10 MB, deshalb nicht übernommen.' };
	let draft;
	try {
		draft = await parseMail(source);
	} catch {
		return { uid, status: 'failed', message: 'Die Mail ließ sich nicht lesen.' };
	}
	const result = await deps.ingest.sendItem(ingestDraft(draft, connection.id, 'selected'), source);
	switch (result.status) {
		case 'created':
			return { uid, status: 'created', message: '' };
		case 'duplicate':
			return { uid, status: 'duplicate', message: 'Schon im Eingang.' };
		case 'gone':
			return { uid, status: 'failed', message: 'Die Verbindung wurde gelöscht oder ausgeschaltet.' };
		case 'rejected':
			return { uid, status: 'failed', message: result.message };
		case 'unmatched':
			return { uid, status: 'failed', message: 'Abgelehnt.' };
	}
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
		if (request.method !== 'POST' || (request.url !== '/mailbox/list' && request.url !== '/mailbox/import')) {
			throw new HttpError(404, 'Nicht gefunden.');
		}
		const body = await readJson(request);
		if (request.url === '/mailbox/list') {
			send(response, 200, { items: await listMailbox(deps, body) });
		} else {
			send(response, 200, { items: await importMails(deps, body) });
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
