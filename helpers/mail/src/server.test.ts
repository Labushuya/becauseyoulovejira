// Local interface of the mailbox selection (ADR-0016 section 6; E4 plan package 23) against the fake
// IMAP server and an in-memory ingest route: token, only 127.0.0.1, limits, list of the last mails
// with keyword, import of chosen mails without keyword, the mailbox stays unchanged.

import { createServer as createNetServer, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeImapServer, fakeMail } from '../test/fake-imap';
import type { IngestApi, MailConnection, StatusReport } from './ingest-client';
import type { IngestDraft } from './mail';
import { DEFAULT_PORT, helperPort, startMailboxServer, type ServerDeps } from './server';

const TOKEN = 'token-für-den-test';
const PASSWORD = 'geheim-1234';
const ID = 'abcdefghij12345';

class MemoryIngest implements IngestApi {
	connections: MailConnection[] = [];
	items: { draft: IngestDraft; original: Uint8Array | undefined }[] = [];
	async listConnections() {
		return this.connections;
	}
	async sendItem(draft: IngestDraft, original?: Uint8Array) {
		const existing = this.items.findIndex((item) => item.draft.source_ref === draft.source_ref);
		if (existing >= 0) return { status: 'duplicate' as const, item: String(existing), state: 'new' };
		this.items.push({ draft, original });
		return { status: 'created' as const, item: String(this.items.length - 1) };
	}
	async reportStatus(_id: string, _report: StatusReport) {}
}

let imap: FakeImapServer;
let ingest: MemoryIngest;
let server: Server | null;
let lines: string[];
let port = 0;

/** A port that is free right now on 127.0.0.1. */
async function freePort(): Promise<number> {
	const probe = createNetServer();
	await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
	const { port: found } = probe.address() as AddressInfo;
	await new Promise<void>((resolve) => probe.close(() => resolve()));
	return found;
}

function deps(extra: Partial<ServerDeps> = {}): ServerDeps {
	return {
		token: TOKEN,
		ingest,
		env: { BYL_TEST_MAIL_PASSWORD: PASSWORD, BYL_MAIL_HELPER_PORT: String(port) },
		log: {
			info: (message) => lines.push(message),
			warn: (message) => lines.push(message),
			error: (message) => lines.push(message)
		},
		imapOverride: { host: '127.0.0.1', port: imap.port, secure: false },
		...extra
	};
}

async function call(path: string, body: unknown, token: string | null = TOKEN, method = 'POST') {
	const address = server?.address() as AddressInfo;
	const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token === null ? {} : { Authorization: `Bearer ${token}` })
		},
		body: method === 'POST' ? JSON.stringify(body) : undefined
	});
	return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

let counter = 0;
function mail(subject: string) {
	counter += 1;
	return imap.add(fakeMail({ subject, messageId: `<srv-${counter}@example.com>` }));
}

beforeEach(async () => {
	imap = new FakeImapServer();
	imap.password = PASSWORD;
	await imap.start();
	ingest = new MemoryIngest();
	ingest.connections = [
		{
			id: ID,
			label: 'Web.de',
			provider: 'webde',
			user: imap.user,
			secretEnv: 'BYL_TEST_MAIL_PASSWORD',
			keywords: ['todo'],
			matchBody: false,
			cursor: ''
		}
	];
	lines = [];
	port = await freePort();
	server = await startMailboxServer(deps());
});

afterEach(async () => {
	await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
	await imap.stop();
});

describe('interface', () => {
	it('listens on 127.0.0.1 only, on 8091 unless BYL_MAIL_HELPER_PORT says otherwise', () => {
		expect((server?.address() as AddressInfo).address).toBe('127.0.0.1');
		expect(helperPort({})).toBe(DEFAULT_PORT);
		expect(helperPort({ BYL_MAIL_HELPER_PORT: '9123' })).toBe(9123);
		expect(helperPort({ BYL_MAIL_HELPER_PORT: 'x' })).toBeNull();
		expect(lines.join('\n')).toMatch(/Postfach-Auswahl auf http:\/\/127\.0\.0\.1:\d+ bereit/);
	});

	it('refuses requests without or with a wrong token and unknown paths', async () => {
		expect((await call('/mailbox/list', { connection: ID }, null)).status).toBe(401);
		expect((await call('/mailbox/list', { connection: ID }, 'falsch')).status).toBe(401);
		expect((await call('/mailbox/list', { connection: ID }, `${TOKEN}x`)).status).toBe(401);
		expect((await call('/mailbox/other', {})).status).toBe(404);
		expect((await call('/mailbox/list', undefined, TOKEN, 'GET')).status).toBe(404);
		expect(imap.commands).toEqual([]);
	});

	it('keeps running without the interface when the port is taken', async () => {
		const address = server?.address() as AddressInfo;
		const second = await startMailboxServer(deps({ env: { BYL_MAIL_HELPER_PORT: String(address.port) } }));
		expect(second).toBeNull();
		expect(lines.join('\n')).toMatch(/ist belegt/);
	});
});

describe('POST /mailbox/list', () => {
	it('lists the last mails newest first with the keyword, from headers only', async () => {
		mail('Alt');
		mail('Todo: Steuer');
		mail('Hallo');
		const answer = await call('/mailbox/list', { connection: ID, limit: 2 });
		expect(answer.status).toBe(200);
		const items = answer.json.items as Record<string, unknown>[];
		expect(items.map((item) => [item.uid, item.subject, item.keyword])).toEqual([
			[3, 'Hallo', ''],
			[2, 'Todo: Steuer', 'todo']
		]);
		expect(items[1]).toMatchObject({
			from: 'Bert Beispiel <bert@example.com>',
			date: '2026-09-25 08:00:00.000Z',
			messageId: '<srv-2@example.com>',
			title: 'Todo: Steuer',
			sourceRef: '<srv-2@example.com>',
			sourceDate: '2026-09-25 08:00:00.000Z',
			sourceMeta: { from: 'Bert Beispiel <bert@example.com>' }
		});
		const fetches = imap.commands.filter((command) => /FETCH/.test(command.name));
		expect(fetches.map((command) => command.args).join(' ')).toMatch(/BODY\.PEEK\[HEADER\]/);
		expect(fetches.map((command) => command.args).join(' ')).not.toMatch(/BODY\.PEEK\[\]/);
		expect(imap.writes()).toEqual([]);
	});

	it('takes 50 by default and at most 200', async () => {
		for (let i = 0; i < 60; i++) mail(`Mail ${i}`);
		expect(((await call('/mailbox/list', { connection: ID })).json.items as unknown[]).length).toBe(50);
		for (const limit of [0, 201, 1.5, '50']) {
			expect((await call('/mailbox/list', { connection: ID, limit })).status).toBe(400);
		}
	});

	it('answers an empty inbox with an empty list', async () => {
		expect((await call('/mailbox/list', { connection: ID })).json).toEqual({ items: [] });
	});

	it('knows only switched-on mail connections and takes no host or password', async () => {
		expect((await call('/mailbox/list', { connection: 'zyxwvutsrq54321' })).status).toBe(404);
		expect((await call('/mailbox/list', { connection: '../etc' })).status).toBe(400);
		const answer = await call('/mailbox/list', { connection: ID, host: 'example.com', password: 'x' });
		expect(answer.status).toBe(200);
		expect(imap.commands.some((command) => command.name === 'LOGIN')).toBe(true);
	});

	it('reports a refused login with the hint and without the password', async () => {
		imap.refuseLogin = true;
		const answer = await call('/mailbox/list', { connection: ID });
		expect(answer.status).toBe(502);
		expect(answer.json).toMatchObject({
			message: 'Anmeldung bei Web.de abgelehnt.',
			hint: expect.stringMatching(/POP3- und IMAP-Zugriff erlauben/)
		});
		expect(JSON.stringify(answer.json)).not.toContain(PASSWORD);
	});
});

describe('POST /mailbox/import', () => {
	it('takes chosen mails also without keyword, once, with the original', async () => {
		mail('Hallo');
		mail('Todo: Steuer');
		const answer = await call('/mailbox/import', { connection: ID, uids: [1, 2, 1] });
		expect(answer.json).toEqual({
			items: [
				{ uid: 1, status: 'created', message: '' },
				{ uid: 2, status: 'created', message: '' }
			]
		});
		expect(ingest.items.map((item) => [item.draft.title, item.draft.origin])).toEqual([
			['Hallo', 'selected'],
			['Todo: Steuer', 'selected']
		]);
		expect(ingest.items[0]?.original?.length).toBe(imap.mails[0]?.source.length);
		const again = await call('/mailbox/import', { connection: ID, uids: [2, 99] });
		expect(again.json).toEqual({
			items: [
				{ uid: 2, status: 'duplicate', message: 'Schon im Eingang.' },
				{ uid: 99, status: 'failed', message: 'Die Mail ist nicht mehr im Posteingang.' }
			]
		});
		expect(imap.writes()).toEqual([]);
		expect(imap.flagsUnchanged()).toBe(true);
	});

	it('takes 1 to 50 valid UIDs', async () => {
		for (const uids of [[], Array.from({ length: 51 }, (_, i) => i + 1), [0], ['1'], 'x']) {
			expect((await call('/mailbox/import', { connection: ID, uids })).status).toBe(400);
		}
	});
});
