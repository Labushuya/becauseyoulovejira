// Local interface of the mailbox selection (ADR-0016 section 6; E4 plan package 23) against the fake
// IMAP server and an in-memory ingest route: token, only 127.0.0.1, limits, list of the last mails
// with keyword, import of chosen mails without keyword, the mailbox stays unchanged.

import { createServer as createNetServer, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeImapServer, fakeMail } from '../test/fake-imap';
import type { IngestApi, MailConnection, StatusReport } from './ingest-client';
import type { IngestDraft } from './mail';
import { PollGate, ScanControl } from './gate';
import { scanStateOf } from './scan-state';
import { DEFAULT_PORT, POLL_SCAN_BUDGET_MS, helperPort, startMailboxServer, type ServerDeps } from './server';

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
	reports: StatusReport[] = [];
	/** Keeps the cursor like PocketBase, so the next fetch starts after it. */
	async reportStatus(id: string, report: StatusReport) {
		this.reports.push(report);
		const connection = this.connections.find((item) => item.id === id);
		if (connection !== undefined && report.cursor !== undefined) connection.cursor = report.cursor;
		if (connection !== undefined && report.scan !== undefined) connection.scan = scanStateOf(report.scan);
	}
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
			cursor: '',
			scan: null
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

	it('preselects a mail by a keyword in the sender (package A)', async () => {
		const [connection] = ingest.connections;
		if (connection) connection.keywords = ['europa-go'];
		imap.add(fakeMail({ subject: 'Angebot', from: 'Europa-Go <info@europa-go.de>', messageId: '<srv-from@example.com>' }));
		mail('Hallo');
		const answer = await call('/mailbox/list', { connection: ID, limit: 2 });
		const items = answer.json.items as Record<string, unknown>[];
		expect(items.map((item) => [item.subject, item.keyword])).toEqual([
			['Hallo', ''],
			['Angebot', 'europa-go']
		]);
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

	it('lists and imports from a Gmail inbox and asks for an app password after a refused login', async () => {
		const [box] = ingest.connections;
		if (box === undefined) throw new Error('no connection');
		Object.assign(box, { label: 'Gmail', provider: 'gmail' });
		mail('Todo: Gmail');
		const list = await call('/mailbox/list', { connection: ID });
		expect(list.status).toBe(200);
		expect(await call('/mailbox/import', { connection: ID, uids: [1] })).toMatchObject({ status: 200 });
		expect(ingest.items).toHaveLength(1);
		imap.refuseLogin = true;
		const refused = await call('/mailbox/list', { connection: ID });
		expect(refused.status).toBe(502);
		expect(refused.json).toMatchObject({
			message: 'Anmeldung bei Gmail abgelehnt.',
			hint: expect.stringMatching(/^App-Passwort nötig \(Bestätigung in zwei Schritten\)/)
		});
		expect(imap.writes()).toEqual([]);
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

	it('takes a chosen mail over 25 MB from its beginning, without the file (ADR-0031)', async () => {
		const source =
			'From: Bert Beispiel <bert@example.com>\r\nSubject: Fotos\r\nMessage-ID: <fotos@example.com>\r\n' +
			`Content-Type: text/plain; charset=utf-8\r\n\r\nAnbei.\r\n${'z'.repeat(26 * 1024 * 1024)}`;
		imap.add(source);
		const answer = await call('/mailbox/import', { connection: ID, uids: [1] });
		expect(answer.json).toEqual({ items: [{ uid: 1, status: 'created', message: '' }] });
		expect(ingest.items[0]?.original).toBeUndefined();
		expect(ingest.items[0]?.draft).toMatchObject({
			title: 'Fotos',
			origin: 'selected',
			source_meta: { original_omitted: 'too_large', original_size: Buffer.byteLength(source) }
		});
		expect(imap.partialFetches).toEqual([{ uid: 1, start: 0, length: 2 * 1024 * 1024 }]);
		expect(imap.writes()).toEqual([]);
		expect(imap.flagsUnchanged()).toBe(true);
	});

	it('takes 1 to 50 valid UIDs', async () => {
		for (const uids of [[], Array.from({ length: 51 }, (_, i) => i + 1), [0], ['1'], 'x']) {
			expect((await call('/mailbox/import', { connection: ID, uids })).status).toBe(400);
		}
	});
});

/**
 * Replaces the server of beforeEach by one with other dependencies, on a new port: fetch may still
 * hold a kept-alive socket to the old one.
 */
async function restart(extra: Partial<ServerDeps>) {
	await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
	port = await freePort();
	const env = { ...(extra.env ?? deps().env), BYL_MAIL_HELPER_PORT: String(port) };
	server = await startMailboxServer(deps({ ...extra, env }));
	expect(server).not.toBeNull();
}

describe('GET /health (package A)', () => {
	it('answers version and whether a fetch runs, without touching the mailbox', async () => {
		const gate = new PollGate();
		await restart({ gate, version: '0.5.0' });
		expect(await call('/health', undefined, TOKEN, 'GET')).toEqual({
			status: 200,
			json: { ok: true, version: '0.5.0', busy: false }
		});
		let release: () => void = () => undefined;
		const running = gate.run(() => new Promise<void>((resolve) => (release = resolve)));
		expect((await call('/health', undefined, TOKEN, 'GET')).json.busy).toBe(true);
		release();
		await running;
		expect((await call('/health', undefined, null, 'GET')).status).toBe(401);
		// The hook recognises a helper before 0.5.0 by exactly this answer to an unknown path.
		expect(await call('/health', {})).toEqual({ status: 404, json: { message: 'Nicht gefunden.' } });
		expect(imap.commands).toEqual([]);
	});
});

describe('POST /poll ("Jetzt abrufen", package A)', () => {
	it('runs the regular fetch at once: first the whole inbox, then new mails with keyword', async () => {
		mail('Todo: vor der Einrichtung');
		const first = await call('/poll', { connection: ID });
		expect(first).toEqual({
			status: 200,
			json: { status: 'ok', created: 1, duplicates: 0, unmatched: 0, skipped: 0, failed: 0, error: '', missing: [] }
		});
		expect(ingest.connections[0]?.cursor).toMatch(/^\d+:1$/);
		expect(ingest.connections[0]?.scan).toMatchObject({ state: 'done', total: 1 });

		mail('Todo: neu');
		mail('Hallo');
		const second = await call('/poll', { connection: ID });
		expect(second.json).toMatchObject({ status: 'ok', created: 1, unmatched: 1 });
		expect(ingest.items.map((item) => [item.draft.title, item.draft.origin])).toEqual([
			['Todo: vor der Einrichtung', 'auto'],
			['Todo: neu', 'auto']
		]);
		expect((await call('/poll', { connection: ID })).json).toMatchObject({ status: 'ok', created: 0, unmatched: 0 });
		// First run: progress at the start of the scan and the result; then one report per run.
		expect(ingest.reports).toHaveLength(4);
		expect(imap.writes()).toEqual([]);
		expect(imap.flagsUnchanged()).toBe(true);
	});

	it('answers within the time budget and lets a longer scan go on in the background', async () => {
		const gate = new PollGate();
		let calls = 0;
		// The first call sets the deadline, every later one is past it.
		await restart({ gate, now: () => (calls++ === 0 ? 0 : POLL_SCAN_BUDGET_MS + 1) });
		mail('Todo: alt');
		const answer = await call('/poll', { connection: ID });
		expect(answer.json).toMatchObject({ status: 'ok', created: 0 });
		await vi.waitFor(() => expect(ingest.items).toHaveLength(1));
		await vi.waitFor(() => expect(gate.busy).toBe(false));
		expect(ingest.connections[0]?.scan).toMatchObject({ state: 'done', created: 1 });
	});

	it('answers 409 "running" while another fetch holds the gate, without waiting', async () => {
		const gate = new PollGate();
		await restart({ gate });
		let release: () => void = () => undefined;
		const loop = gate.run(() => new Promise<void>((resolve) => (release = resolve)));
		const answer = await call('/poll', { connection: ID });
		expect(answer.status).toBe(409);
		expect(answer.json).toMatchObject({ status: 'running', created: 0 });
		expect(imap.commands).toEqual([]);
		release();
		await loop;
		expect((await call('/poll', { connection: ID })).status).toBe(200);
	});

	it('names a missing variable, an unknown connection and a refused login without the password', async () => {
		expect((await call('/poll', { connection: 'zyxwvutsrq54321' })).status).toBe(404);
		expect((await call('/poll', { connection: '../etc' })).status).toBe(400);

		imap.refuseLogin = true;
		const refused = await call('/poll', { connection: ID });
		expect(refused.json).toMatchObject({ status: 'error', error: 'Anmeldung bei Web.de abgelehnt.' });
		expect(JSON.stringify(refused.json)).not.toContain(PASSWORD);

		await restart({ env: {} });
		expect((await call('/poll', { connection: ID })).json).toMatchObject({
			status: 'missing',
			missing: ['BYL_TEST_MAIL_PASSWORD']
		});
	});
});

describe('POST /scan ("Posteingang neu durchsuchen", full inbox)', () => {
	it('scans the whole inbox again in the background and answers at once', async () => {
		const gate = new PollGate();
		await restart({ gate });
		mail('Todo: alt');
		await call('/poll', { connection: ID });
		mail('Rechnung von früher');
		const [box] = ingest.connections;
		if (box === undefined) throw new Error('no connection');
		box.keywords = ['todo', 'rechnung'];
		// The new mail lies below the cursor, so only the scan can find it.
		box.cursor = `${imap.uidValidity}:2`;
		const answer = await call('/scan', { connection: ID, action: 'start' });
		expect(answer).toEqual({ status: 202, json: { status: 'started' } });
		await vi.waitFor(() => expect(ingest.items.map((item) => item.draft.title)).toContain('Rechnung von früher'));
		await vi.waitFor(() => expect(gate.busy).toBe(false));
		expect(ingest.connections[0]?.scan).toMatchObject({ state: 'done', total: 2 });
		expect(imap.writes()).toEqual([]);
	});

	it('answers 409 "running" while the gate is held, and "idle" or "cancelling" to a cancel', async () => {
		const gate = new PollGate();
		const control = new ScanControl();
		await restart({ gate, control });
		let release: () => void = () => undefined;
		const loop = gate.run(() => new Promise<void>((resolve) => (release = resolve)));
		expect(await call('/scan', { connection: ID, action: 'start' })).toEqual({ status: 409, json: { status: 'running' } });
		expect(await call('/scan', { connection: ID, action: 'cancel' })).toEqual({ status: 200, json: { status: 'idle' } });
		control.begin(ID);
		expect(await call('/scan', { connection: ID, action: 'cancel' })).toEqual({ status: 200, json: { status: 'cancelling' } });
		expect(control.isCancelled(ID)).toBe(true);
		control.end(ID);
		release();
		await loop;
		expect((await call('/scan', { connection: ID, action: 'neu' })).status).toBe(400);
		expect((await call('/scan', { connection: 'zyxwvutsrq54321', action: 'start' })).status).toBe(404);
		expect((await call('/scan', { connection: '../etc', action: 'start' })).status).toBe(400);
		expect(imap.commands).toEqual([]);
	});
});

describe('preselection of the mailbox selection with match_body (full inbox)', () => {
	it('matches headers exactly and the text through the search of the server, without loading mails', async () => {
		const [box] = ingest.connections;
		if (box === undefined) throw new Error('no connection');
		box.keywords = ['projekt-x', 'rechnung'];
		imap.add(fakeMail({ subject: 'Hallo', headers: ['Cc: Projekt-X <px@example.com>'], messageId: '<cc@example.com>' }));
		imap.add(fakeMail({ subject: 'Hallo', body: 'Die Rechnung anbei.', messageId: '<text@example.com>' }));
		mail('Nichts');
		const keywordsOf = async () =>
			((await call('/mailbox/list', { connection: ID })).json.items as Record<string, unknown>[]).map(
				(item) => item.keyword
			);
		expect(await keywordsOf()).toEqual(['', '', '']);
		box.matchBody = true;
		expect(await keywordsOf()).toEqual(['', 'rechnung', 'projekt-x']);
		const fetches = imap.commands.filter((command) => /FETCH/.test(command.name)).map((command) => command.args);
		expect(fetches.join(' ')).not.toMatch(/BODY\.PEEK\[\]/);
		imap.refuseTextSearch = true;
		expect(await keywordsOf()).toEqual(['', '', 'projekt-x']);
		expect(imap.writes()).toEqual([]);
	});
});
