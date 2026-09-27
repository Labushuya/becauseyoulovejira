// Minimal IMAP server for the tests of the mail helper, on 127.0.0.1 without TLS: the mailbox INBOX
// and further folders (Trash, Junk, Sent, …) that a test fills, login with user and password,
// LIST, EXAMINE/SELECT, SEARCH, FETCH (UID, RFC822.SIZE, FLAGS, BODY[], BODY[HEADER] and
// BODY[HEADER.FIELDS (…)], with and without PEEK, also partial as BODY.PEEK[]<start.length>) by
// UID and by sequence number, NOOP and LOGOUT.
// It records every command (without the password), so a test can prove that the helper only reads:
// no SELECT, STORE, COPY, MOVE, EXPUNGE, APPEND or CLOSE, no BODY[] without PEEK, and which folders
// it opened. Commands that would change the mailbox are refused and change nothing.
//
// SEARCH evaluates ALL, UID, sequence sets, OR, NOT, parenthesised lists, SUBJECT, FROM, TO, CC,
// BCC, HEADER, BODY and TEXT as case-insensitive substrings of the raw mail (RFC 3501 section
// 6.4.4; no decoding of encoded words or transfer encodings), and accepts CHARSET UTF-8. With
// `refuseTextSearch` it answers every search for text with NO [BADCHARSET], as a server that
// cannot search (the fallback of the helper). Not a general IMAP server; never used outside of
// tests.

import { createServer, type Server, type Socket } from 'node:net';

export interface FakeMail {
	uid: number;
	source: Buffer;
	flags: string[];
}

export interface RecordedCommand {
	tag: string;
	/** Upper-case name, "UID FETCH" for UID commands. */
	name: string;
	/** Arguments as sent; '***' for LOGIN. */
	args: string;
}

/** Commands a read-only client may send. */
export const READ_ONLY_COMMANDS = new Set([
	'CAPABILITY',
	'LOGIN',
	'LIST',
	'LSUB',
	'NAMESPACE',
	'EXAMINE',
	'SEARCH',
	'UID SEARCH',
	'FETCH',
	'UID FETCH',
	'NOOP',
	'LOGOUT'
]);

const WRITING = new Set([
	'SELECT',
	'STORE',
	'UID STORE',
	'COPY',
	'UID COPY',
	'MOVE',
	'UID MOVE',
	'EXPUNGE',
	'UID EXPUNGE',
	'APPEND',
	'CLOSE',
	'CREATE',
	'DELETE',
	'RENAME'
]);

/** Special-use flag of a further folder in LIST (RFC 6154). */
const SPECIAL_USE: Readonly<Record<string, string>> = {
	Trash: '\\Trash',
	Junk: '\\Junk',
	Sent: '\\Sent',
	Drafts: '\\Drafts',
	Archive: '\\Archive'
};

type Token = string | Token[];

/** Splits IMAP arguments into atoms, quoted strings and parenthesised lists. */
export function tokenize(text: string): Token[] {
	let index = 0;
	const readList = (end: string | null): Token[] => {
		const tokens: Token[] = [];
		while (index < text.length) {
			const ch = text[index] ?? '';
			if (ch === ' ') {
				index += 1;
			} else if (end !== null && ch === end) {
				index += 1;
				return tokens;
			} else if (ch === '(') {
				index += 1;
				tokens.push(readList(')'));
			} else if (ch === '"') {
				index += 1;
				let value = '';
				while (index < text.length && text[index] !== '"') {
					if (text[index] === '\\') index += 1;
					value += text[index] ?? '';
					index += 1;
				}
				index += 1;
				tokens.push(value);
			} else {
				let value = '';
				let depth = 0;
				while (index < text.length) {
					const c = text[index] ?? '';
					if (c === '[') depth += 1;
					if (c === ']') depth -= 1;
					if (depth === 0 && (c === ' ' || c === ')' || c === '(')) break;
					value += c;
					index += 1;
				}
				tokens.push(value);
			}
		}
		return tokens;
	};
	return readList(null);
}

/** Numbers of a sequence set ("1:3,7,9:*") among `available`, with * as the largest. */
export function resolveSet(set: string, available: readonly number[]): number[] {
	const largest = available.length === 0 ? 0 : Math.max(...available);
	const value = (part: string) => (part === '*' ? largest : Number(part));
	const chosen = new Set<number>();
	for (const range of set.split(',')) {
		const [a = '', b] = range.split(':');
		const from = value(a);
		const to = b === undefined ? from : value(b);
		const low = Math.min(from, to);
		const high = Math.max(from, to);
		for (const number of available) if (number >= low && number <= high) chosen.add(number);
	}
	return [...chosen].sort((x, y) => x - y);
}

function headerOf(source: Buffer): Buffer {
	const text = source.toString('latin1');
	const end = text.indexOf('\r\n\r\n');
	return end < 0 ? source : source.subarray(0, end + 4);
}

function bodyOf(source: Buffer): string {
	const text = source.toString('utf8');
	const end = text.indexOf('\r\n\r\n');
	return end < 0 ? '' : text.slice(end + 4);
}

/** Header fields as [lower-case name, unfolded value]. */
function headerFields(source: Buffer): [string, string][] {
	const unfolded = headerOf(source).toString('utf8').replace(/\r\n[ \t]+/g, ' ');
	const fields: [string, string][] = [];
	for (const line of unfolded.split('\r\n')) {
		const colon = line.indexOf(':');
		if (colon > 0) fields.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
	}
	return fields;
}

/** The header lines named in `names` (with their folded continuation lines) and an empty line. */
function headerFieldsOf(source: Buffer, names: readonly string[]): Buffer {
	const wanted = new Set(names.map((name) => name.toLowerCase()));
	const lines = headerOf(source).toString('latin1').split('\r\n');
	const kept: string[] = [];
	let keep = false;
	for (const line of lines) {
		if (line === '') continue;
		if (/^[ \t]/.test(line)) {
			if (keep) kept.push(line);
			continue;
		}
		keep = wanted.has(line.slice(0, Math.max(0, line.indexOf(':'))).trim().toLowerCase());
		if (keep) kept.push(line);
	}
	return Buffer.from(`${kept.map((line) => `${line}\r\n`).join('')}\r\n`, 'latin1');
}

class SearchError extends Error {
	constructor(readonly answer: 'BAD' | 'NO', message: string) {
		super(message);
	}
}

type Criterion = (mail: FakeMail, sequence: number) => boolean;

const TEXT_KEYS = new Set(['SUBJECT', 'FROM', 'TO', 'CC', 'BCC', 'HEADER', 'BODY', 'TEXT']);

export class FakeImapServer {
	user = 'anna@web.de';
	password = 'geheim-1234';
	uidValidity = 1_700_000_000;
	/** Refuse every login (the Web.de setting is off, or Gmail with the normal account password). */
	refuseLogin = false;
	/** Text of the NO answer to a refused LOGIN. */
	loginRefusal = '[AUTHENTICATIONFAILED] Authentication failed.';
	/** Open INBOX writable even for EXAMINE (a broken server). */
	writableExamine = false;
	/** Answer every SEARCH for text with NO [BADCHARSET] (a server without usable search). */
	refuseTextSearch = false;
	readonly commands: RecordedCommand[] = [];
	/** Partial fetches of a body (the beginning of a mail over 10 MB, ADR-0031 section 4). */
	readonly partialFetches: { uid: number; start: number; length: number }[] = [];
	readonly mails: FakeMail[] = [];
	/** Further folders by name (Trash, Junk, Sent, …); the helper must never open them. */
	readonly folders = new Map<string, FakeMail[]>();
	#nextUid = 1;
	#server: Server | null = null;
	#sockets = new Set<Socket>();
	port = 0;

	/** Adds a mail with the next UID (or a given one) and returns the UID. */
	add(source: string | Buffer, uid?: number): number {
		const value = uid ?? this.#nextUid;
		this.#nextUid = Math.max(this.#nextUid, value + 1);
		this.mails.push({ uid: value, source: Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8'), flags: [] });
		this.mails.sort((a, b) => a.uid - b.uid);
		return value;
	}

	/** Adds a mail to a further folder (created on first use). */
	addTo(folder: string, source: string | Buffer): void {
		const mails = this.folders.get(folder) ?? [];
		mails.push({ uid: mails.length + 1, source: Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8'), flags: [] });
		this.folders.set(folder, mails);
	}

	/** Starts over with new UIDs, as a server does after it rebuilt the folder. */
	renumber(uidValidity: number): void {
		this.uidValidity = uidValidity;
		let uid = 1;
		for (const mail of this.mails) mail.uid = uid++;
		this.#nextUid = uid;
	}

	/** Commands that are not in READ_ONLY_COMMANDS, and fetches of a body without PEEK. */
	writes(): RecordedCommand[] {
		return this.commands.filter(
			(command) =>
				!READ_ONLY_COMMANDS.has(command.name) ||
				(/FETCH$/.test(command.name) && /BODY\[/i.test(command.args) && !/BODY\.PEEK\[/i.test(command.args))
		);
	}

	/** Names of the folders opened with EXAMINE or SELECT. */
	opened(): string[] {
		return this.commands
			.filter((command) => command.name === 'EXAMINE' || command.name === 'SELECT')
			.map((command) => String(tokenize(command.args)[0] ?? ''));
	}

	flagsUnchanged(): boolean {
		return [this.mails, ...this.folders.values()].every((mails) => mails.every((mail) => mail.flags.length === 0));
	}

	async start(): Promise<number> {
		this.#server = createServer((socket) => this.#serve(socket));
		await new Promise<void>((resolve, reject) => {
			this.#server?.once('error', reject);
			this.#server?.listen(this.port, '127.0.0.1', () => resolve());
		});
		const address = this.#server.address();
		this.port = typeof address === 'object' && address !== null ? address.port : 0;
		return this.port;
	}

	/** Stops listening and cuts every connection (an outage); start() again uses the same port. */
	async stop(): Promise<void> {
		for (const socket of this.#sockets) socket.destroy();
		this.#sockets.clear();
		const server = this.#server;
		this.#server = null;
		if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	}

	#serve(socket: Socket): void {
		this.#sockets.add(socket);
		socket.on('close', () => this.#sockets.delete(socket));
		socket.on('error', () => undefined);
		const state: SessionState = { authenticated: false, selected: null, readOnly: true };
		let buffer = Buffer.alloc(0);
		let pending: { line: string; bytes: number } | null = null;
		const send = (text: string | Buffer) => {
			if (!socket.destroyed) socket.write(text);
		};
		send('* OK [CAPABILITY IMAP4rev1] Fake IMAP ready\r\n');
		socket.on('data', (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);
			for (;;) {
				if (pending !== null) {
					if (buffer.length < pending.bytes) return;
					const literal = buffer.subarray(0, pending.bytes).toString('utf8');
					buffer = buffer.subarray(pending.bytes);
					pending = { line: `${pending.line}"${literal.replace(/(["\\])/g, '\\$1')}"`, bytes: -1 };
				}
				const end = buffer.indexOf('\r\n');
				if (end < 0) return;
				const part = buffer.subarray(0, end).toString('utf8');
				buffer = buffer.subarray(end + 2);
				const line = (pending?.line ?? '') + part;
				pending = null;
				const literal = /\{(\d+)\}$/.exec(line);
				if (literal) {
					pending = { line: line.slice(0, literal.index), bytes: Number(literal[1]) };
					send('+ Ready\r\n');
					continue;
				}
				this.#handle(line, state, send, socket);
			}
		});
	}

	#mailsOf(state: SessionState): FakeMail[] {
		if (state.selected === 'INBOX') return this.mails;
		return this.folders.get(state.selected ?? '') ?? [];
	}

	#handle(line: string, state: SessionState, send: (text: string | Buffer) => void, socket: Socket): void {
		const match = /^(\S+) (UID \S+|\S+)(?: (.*))?$/.exec(line);
		if (!match) {
			send('* BAD Invalid command\r\n');
			return;
		}
		const tag = match[1] ?? '';
		const name = (match[2] ?? '').toUpperCase();
		const args = match[3] ?? '';
		this.commands.push({ tag, name, args: name === 'LOGIN' ? '***' : args });
		const ok = (text = 'Completed') => send(`${tag} OK ${text}\r\n`);
		const no = (text: string) => send(`${tag} NO ${text}\r\n`);
		const tokens = tokenize(args);
		switch (name) {
			case 'CAPABILITY':
				send('* CAPABILITY IMAP4rev1\r\n');
				return ok();
			case 'NOOP':
				return ok();
			case 'LOGOUT':
				send('* BYE Fake IMAP logging out\r\n');
				ok();
				socket.end();
				return;
			case 'LOGIN': {
				const [user, password] = tokens;
				if (!this.refuseLogin && user === this.user && password === this.password) {
					state.authenticated = true;
					return ok('[CAPABILITY IMAP4rev1] Logged in');
				}
				return no(this.loginRefusal);
			}
			case 'LIST':
			case 'LSUB': {
				const pattern = String(tokens[1] ?? '');
				if (pattern === '') {
					send('* LIST (\\Noselect) "/" ""\r\n');
					return ok();
				}
				send(`* ${name} (\\HasNoChildren) "/" INBOX\r\n`);
				for (const folder of this.folders.keys()) {
					const flags = ['\\HasNoChildren', SPECIAL_USE[folder]].filter(Boolean).join(' ');
					send(`* ${name} (${flags}) "/" ${folder}\r\n`);
				}
				return ok();
			}
			case 'EXAMINE':
			case 'SELECT': {
				if (!state.authenticated) return no('Not authenticated.');
				const folder = String(tokens[0] ?? '');
				const inbox = folder.toUpperCase() === 'INBOX';
				if (!inbox && !this.folders.has(folder)) return no('No such mailbox.');
				state.selected = inbox ? 'INBOX' : folder;
				state.readOnly = name === 'EXAMINE' && !this.writableExamine;
				const mails = this.#mailsOf(state);
				const uidNext = inbox ? this.#nextUid : mails.length + 1;
				send(
					`* ${mails.length} EXISTS\r\n* 0 RECENT\r\n` +
						'* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n' +
						`* OK [PERMANENTFLAGS (${state.readOnly ? '' : '\\Seen \\Deleted'})] Flags\r\n` +
						`* OK [UIDVALIDITY ${this.uidValidity}] UIDs valid\r\n` +
						`* OK [UIDNEXT ${uidNext}] Predicted next UID\r\n`
				);
				return ok(`[${state.readOnly ? 'READ-ONLY' : 'READ-WRITE'}] ${name} completed`);
			}
			case 'SEARCH':
			case 'UID SEARCH': {
				if (state.selected === null) return no('No mailbox selected.');
				const byUid = name === 'UID SEARCH';
				const mails = this.#mailsOf(state);
				let criterion: Criterion;
				try {
					criterion = this.#compileSearch(tokens, mails);
				} catch (error) {
					if (error instanceof SearchError) return send(`${tag} ${error.answer} ${error.message}\r\n`);
					throw error;
				}
				const numbers = mails
					.map((mail, index) => (criterion(mail, index + 1) ? (byUid ? mail.uid : index + 1) : 0))
					.filter((number) => number > 0);
				send(`* SEARCH${numbers.length > 0 ? ` ${numbers.join(' ')}` : ''}\r\n`);
				return ok();
			}
			case 'FETCH':
			case 'UID FETCH': {
				if (state.selected === null) return no('No mailbox selected.');
				this.#fetch(this.#mailsOf(state), name === 'UID FETCH', String(tokens[0] ?? ''), tokens[1] ?? [], state.readOnly, send);
				return ok();
			}
			default:
				if (WRITING.has(name)) return no('Refused by the fake server.');
				send(`${tag} BAD Unknown command\r\n`);
		}
	}

	/** Compiles the keys of a SEARCH into one criterion (all keys must hold). */
	#compileSearch(tokens: Token[], mails: readonly FakeMail[]): Criterion {
		const queue = [...tokens];
		if (String(queue[0] ?? '').toUpperCase() === 'CHARSET') {
			queue.shift();
			const charset = String(queue.shift() ?? '').toUpperCase();
			if (charset !== 'UTF-8' && charset !== 'US-ASCII') throw new SearchError('NO', '[BADCHARSET (UTF-8 US-ASCII)] Unknown charset');
		}
		const uids = mails.map((mail) => mail.uid);
		const sequences = mails.map((_, index) => index + 1);
		const includes = (value: string, needle: string) => value.toLowerCase().includes(needle.toLowerCase());
		const header = (mail: FakeMail, field: string) =>
			headerFields(mail.source).filter(([key]) => key === field.toLowerCase()).map(([, value]) => value);
		const next = (): Token => {
			if (queue.length === 0) throw new SearchError('BAD', 'Missing search argument');
			return queue.shift() as Token;
		};
		const text = (): string => {
			const value = next();
			if (Array.isArray(value)) throw new SearchError('BAD', 'Expected a string');
			return value;
		};
		const key = (): Criterion => {
			const token = next();
			if (Array.isArray(token)) {
				const inner = this.#compileSearch(token, mails);
				return inner;
			}
			const upper = token.toUpperCase();
			if (TEXT_KEYS.has(upper) && this.refuseTextSearch) throw new SearchError('NO', '[BADCHARSET] Search not supported');
			switch (upper) {
				case 'ALL':
					return () => true;
				case 'UID': {
					const chosen = new Set(resolveSet(text(), uids));
					return (mail) => chosen.has(mail.uid);
				}
				case 'OR': {
					const a = key();
					const b = key();
					return (mail, sequence) => a(mail, sequence) || b(mail, sequence);
				}
				case 'NOT': {
					const a = key();
					return (mail, sequence) => !a(mail, sequence);
				}
				case 'SUBJECT':
				case 'FROM':
				case 'TO':
				case 'CC':
				case 'BCC': {
					const needle = text();
					return (mail) => header(mail, upper).some((value) => includes(value, needle));
				}
				case 'HEADER': {
					const field = text();
					const needle = text();
					return (mail) => header(mail, field).some((value) => includes(value, needle));
				}
				case 'BODY': {
					const needle = text();
					return (mail) => includes(bodyOf(mail.source), needle);
				}
				case 'TEXT': {
					const needle = text();
					return (mail) => includes(mail.source.toString('utf8'), needle);
				}
				default:
					if (/^[\d:*,]+$/.test(token)) {
						const chosen = new Set(resolveSet(token, sequences));
						return (_mail, sequence) => chosen.has(sequence);
					}
					throw new SearchError('BAD', `Unknown search key ${token}`);
			}
		};
		const all: Criterion[] = [];
		while (queue.length > 0) all.push(key());
		return (mail, sequence) => all.every((criterion) => criterion(mail, sequence));
	}

	#fetch(
		mails: readonly FakeMail[],
		byUid: boolean,
		set: string,
		items: Token,
		readOnly: boolean,
		send: (text: string | Buffer) => void
	): void {
		const wanted = (Array.isArray(items) ? items : [items]).map((item) => String(item).toUpperCase());
		const numbers = resolveSet(
			set,
			mails.map((mail, index) => (byUid ? mail.uid : index + 1))
		);
		for (const number of numbers) {
			const index = byUid ? mails.findIndex((mail) => mail.uid === number) : number - 1;
			const mail = mails[index];
			if (mail === undefined) continue;
			const parts: (string | Buffer)[] = [];
			const literal = (key: string, value: Buffer) => {
				parts.push(`${key} {${value.length}}\r\n`, value);
			};
			const items: string[] = [];
			if (byUid || wanted.includes('UID')) items.push(`UID ${mail.uid}`);
			for (const item of wanted) {
				if (item === 'UID') continue;
				if (item === 'RFC822.SIZE') items.push(`RFC822.SIZE ${mail.source.length}`);
				else if (item === 'FLAGS') items.push(`FLAGS (${mail.flags.join(' ')})`);
				else if (item === 'INTERNALDATE') items.push('INTERNALDATE "25-Sep-2026 10:00:00 +0200"');
			}
			parts.push(`* ${index + 1} FETCH (${items.join(' ')}`);
			for (const item of wanted) {
				const body = /^BODY(\.PEEK)?\[(HEADER(?:\.FIELDS \(([^)]*)\))?)?\](?:<(\d+)\.(\d+)>)?$/.exec(item);
				if (!body) continue;
				if (body[1] === undefined && !readOnly && !mail.flags.includes('\\Seen')) mail.flags.push('\\Seen');
				parts.push(' ');
				const section = body[2] ?? '';
				const whole =
					body[3] !== undefined
						? headerFieldsOf(mail.source, body[3].split(/\s+/).filter(Boolean))
						: section === 'HEADER'
							? headerOf(mail.source)
							: mail.source;
				// A partial fetch <start.length> answers with the origin octet only (RFC 3501 6.4.5).
				if (body[4] !== undefined && body[5] !== undefined) {
					const start = Number(body[4]);
					this.partialFetches.push({ uid: mail.uid, start, length: Number(body[5]) });
					literal(`BODY[${section}]<${start}>`, whole.subarray(start, start + Number(body[5])));
				} else {
					literal(`BODY[${section}]`, whole);
				}
			}
			parts.push(')\r\n');
			for (const part of parts) send(part);
		}
	}
}

interface SessionState {
	authenticated: boolean;
	/** "INBOX", the name of a further folder, or null before EXAMINE/SELECT. */
	selected: string | null;
	readOnly: boolean;
}

/** An invented mail with CRLF line ends. */
export function fakeMail({
	subject,
	body = 'Text der Mail.',
	messageId,
	from = 'Bert Beispiel <bert@example.com>',
	to = 'anna@web.de',
	headers = [],
	date = 'Fri, 25 Sep 2026 10:00:00 +0200',
	contentType = 'text/plain',
	transferEncoding = '8bit'
}: {
	subject: string;
	/** Already encoded as `transferEncoding` says. */
	body?: string;
	messageId: string;
	from?: string;
	to?: string;
	/** Further header lines, e.g. "Cc: …" or "List-Id: …". */
	headers?: readonly string[];
	date?: string;
	contentType?: 'text/plain' | 'text/html';
	transferEncoding?: '8bit' | 'quoted-printable';
}): string {
	return [
		`From: ${from}`,
		`To: ${to}`,
		...headers,
		`Subject: ${subject}`,
		`Message-ID: ${messageId}`,
		`Date: ${date}`,
		'MIME-Version: 1.0',
		`Content-Type: ${contentType}; charset=UTF-8`,
		`Content-Transfer-Encoding: ${transferEncoding}`,
		'',
		body,
		''
	].join('\r\n');
}
