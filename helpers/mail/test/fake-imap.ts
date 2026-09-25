// Minimal IMAP server for the tests of the mail helper, on 127.0.0.1 without TLS: one mailbox INBOX,
// login with user and password, EXAMINE/SELECT, SEARCH, FETCH (UID, RFC822.SIZE, FLAGS, BODY[] and
// BODY[HEADER], with and without PEEK) by UID and by sequence number, NOOP and LOGOUT. It records
// every command (without the password), so a test can prove that the helper only reads: no SELECT,
// STORE, COPY, MOVE, EXPUNGE, APPEND or CLOSE, and no BODY[] without PEEK. Commands that would
// change the mailbox are refused and change nothing. Not a general IMAP server; never used outside
// of tests.

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
	readonly commands: RecordedCommand[] = [];
	readonly mails: FakeMail[] = [];
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

	flagsUnchanged(): boolean {
		return this.mails.every((mail) => mail.flags.length === 0);
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
		const state = { authenticated: false, selected: false, readOnly: true };
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

	#handle(
		line: string,
		state: { authenticated: boolean; selected: boolean; readOnly: boolean },
		send: (text: string | Buffer) => void,
		socket: Socket
	): void {
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
				if (pattern === '') send('* LIST (\\Noselect) "/" ""\r\n');
				else send(`* ${name} (\\HasNoChildren) "/" INBOX\r\n`);
				return ok();
			}
			case 'EXAMINE':
			case 'SELECT': {
				if (!state.authenticated) return no('Not authenticated.');
				if (String(tokens[0] ?? '').toUpperCase() !== 'INBOX') return no('No such mailbox.');
				state.selected = true;
				state.readOnly = name === 'EXAMINE' && !this.writableExamine;
				const uidNext = this.#nextUid;
				send(
					`* ${this.mails.length} EXISTS\r\n* 0 RECENT\r\n` +
						'* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n' +
						`* OK [PERMANENTFLAGS (${state.readOnly ? '' : '\\Seen \\Deleted'})] Flags\r\n` +
						`* OK [UIDVALIDITY ${this.uidValidity}] UIDs valid\r\n` +
						`* OK [UIDNEXT ${uidNext}] Predicted next UID\r\n`
				);
				return ok(`[${state.readOnly ? 'READ-ONLY' : 'READ-WRITE'}] ${name} completed`);
			}
			case 'SEARCH':
			case 'UID SEARCH': {
				if (!state.selected) return no('No mailbox selected.');
				const byUid = name === 'UID SEARCH';
				const numbers = this.mails.map((mail, index) => (byUid ? mail.uid : index + 1));
				send(`* SEARCH${numbers.length > 0 ? ` ${numbers.join(' ')}` : ''}\r\n`);
				return ok();
			}
			case 'FETCH':
			case 'UID FETCH': {
				if (!state.selected) return no('No mailbox selected.');
				this.#fetch(name === 'UID FETCH', String(tokens[0] ?? ''), tokens[1] ?? [], state.readOnly, send);
				return ok();
			}
			default:
				if (WRITING.has(name)) return no('Refused by the fake server.');
				send(`${tag} BAD Unknown command\r\n`);
		}
	}

	#fetch(
		byUid: boolean,
		set: string,
		items: Token,
		readOnly: boolean,
		send: (text: string | Buffer) => void
	): void {
		const wanted = (Array.isArray(items) ? items : [items]).map((item) => String(item).toUpperCase());
		const numbers = resolveSet(
			set,
			this.mails.map((mail, index) => (byUid ? mail.uid : index + 1))
		);
		for (const number of numbers) {
			const index = byUid ? this.mails.findIndex((mail) => mail.uid === number) : number - 1;
			const mail = this.mails[index];
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
				const body = /^BODY(\.PEEK)?\[(HEADER)?\]$/.exec(item);
				if (!body) continue;
				if (body[1] === undefined && !readOnly && !mail.flags.includes('\\Seen')) mail.flags.push('\\Seen');
				parts.push(' ');
				literal(`BODY[${body[2] ?? ''}]`, body[2] === 'HEADER' ? headerOf(mail.source) : mail.source);
			}
			parts.push(')\r\n');
			for (const part of parts) send(part);
		}
	}
}

/** An invented mail with CRLF line ends. */
export function fakeMail({
	subject,
	body = 'Text der Mail.',
	messageId,
	from = 'Bert Beispiel <bert@example.com>',
	date = 'Fri, 25 Sep 2026 10:00:00 +0200'
}: {
	subject: string;
	body?: string;
	messageId: string;
	from?: string;
	date?: string;
}): string {
	return [
		`From: ${from}`,
		'To: anna@web.de',
		`Subject: ${subject}`,
		`Message-ID: ${messageId}`,
		`Date: ${date}`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=UTF-8',
		'Content-Transfer-Encoding: 8bit',
		'',
		body,
		''
	].join('\r\n');
}
