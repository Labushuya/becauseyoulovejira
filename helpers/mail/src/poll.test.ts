// One run of the mail helper against the fake IMAP server and an in-memory ingest route (ADR-0016
// section 5, ADR-0020, P-10; E4 plan package 11): first run sets the cursor, only mails with a
// keyword are sent, the cursor moves over the others, no duplicates on a second run, a new
// UIDVALIDITY starts over, errors land cleaned at the connection, the mailbox stays unchanged.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeImapServer, fakeMail } from '../test/fake-imap';
import { IngestError, type IngestApi, type MailConnection, type StatusReport } from './ingest-client';
import type { Logger } from './log';
import type { IngestDraft } from './mail';
import { FIRST_RUN_HINT, MAX_MAILS_PER_RUN, UIDVALIDITY_HINT, pollAll, pollConnection, type PollDeps } from './poll';

const PASSWORD = 'geheim-1234';
const TOKEN = 'token-abcdef';

/** The ingest route in memory: duplicates by Message-ID, like the fingerprint of the hook. */
class MemoryIngest implements IngestApi {
	connections: MailConnection[] = [];
	items: { draft: IngestDraft; original: Uint8Array | undefined }[] = [];
	reports: { id: string; report: StatusReport }[] = [];
	down = false;
	gone = false;

	async listConnections() {
		if (this.down) throw new IngestError('unreachable', 'PocketBase nicht erreichbar.');
		return this.connections.map((connection) => ({ ...connection }));
	}

	async sendItem(draft: IngestDraft, original?: Uint8Array) {
		if (this.down) throw new IngestError('unreachable', 'PocketBase nicht erreichbar.');
		if (this.gone) return { status: 'gone' as const };
		const existing = this.items.findIndex((item) => item.draft.source_ref === draft.source_ref);
		if (existing >= 0) return { status: 'duplicate' as const, item: String(existing), state: 'new' };
		this.items.push({ draft, original });
		return { status: 'created' as const, item: String(this.items.length - 1) };
	}

	async reportStatus(id: string, report: StatusReport) {
		if (this.down) throw new IngestError('unreachable', 'PocketBase nicht erreichbar.');
		this.reports.push({ id, report });
		const connection = this.connections.find((item) => item.id === id);
		if (connection && report.cursor !== undefined) connection.cursor = report.cursor;
	}

	lastReport() {
		return this.reports.at(-1)?.report;
	}
}

let server: FakeImapServer;
let ingest: MemoryIngest;
let lines: string[];

function connection(extra: Partial<MailConnection> = {}): MailConnection {
	return {
		id: 'abcdefghij12345',
		label: 'Web.de',
		provider: 'webde',
		user: server.user,
		secretEnv: 'BYL_TEST_MAIL_PASSWORD',
		keywords: ['todo', 'rechnung'],
		matchBody: false,
		cursor: '',
		...extra
	};
}

function deps(extra: Partial<PollDeps> = {}): PollDeps {
	const log: Logger = {
		info: (message) => lines.push(`INFO ${message}`),
		warn: (message) => lines.push(`WARN ${message}`),
		error: (message) => lines.push(`ERROR ${message}`)
	};
	return {
		ingest,
		env: { BYL_TEST_MAIL_PASSWORD: PASSWORD },
		log,
		imapOverride: { host: '127.0.0.1', port: server.port, secure: false },
		secrets: [TOKEN],
		...extra
	};
}

let counter = 0;
function mail(subject: string, body = 'Text der Mail.'): number {
	counter += 1;
	return server.add(fakeMail({ subject, body, messageId: `<m${counter}@example.com>` }));
}

beforeEach(async () => {
	server = new FakeImapServer();
	server.password = PASSWORD;
	await server.start();
	ingest = new MemoryIngest();
	lines = [];
});

afterEach(async () => {
	await server.stop();
});

describe('first run', () => {
	it('sets the cursor to the highest UID and takes nothing older', async () => {
		mail('Todo: alt');
		mail('Rechnung alt');
		const box = connection();
		ingest.connections = [box];
		const outcome = await pollConnection(deps(), box);
		expect(outcome).toMatchObject({ status: 'ok', created: 0, cursor: '1700000000:2' });
		expect(ingest.items).toEqual([]);
		expect(ingest.lastReport()).toEqual({ error: '', hint: FIRST_RUN_HINT, cursor: '1700000000:2' });
	});

	it('starts at 0 in an empty inbox', async () => {
		expect((await pollConnection(deps(), connection())).cursor).toBe('1700000000:0');
	});
});

describe('later runs (P-10, ADR-0020)', () => {
	it('sends only new mails with a keyword and moves the cursor over the others', async () => {
		mail('alt');
		const box = connection({ cursor: '1700000000:1' });
		const todo = mail('Todo: Steuer');
		mail('Hallo');
		mail('Neue RECHNUNG');
		mail('Kein Treffer', 'Rechnung im Text');
		const outcome = await pollConnection(deps(), box);
		expect(outcome).toMatchObject({ status: 'ok', created: 2, unmatched: 2, cursor: '1700000000:5' });
		expect(ingest.items.map((item) => item.draft.title)).toEqual(['Todo: Steuer', 'Neue RECHNUNG']);
		expect(ingest.items[0]?.draft).toMatchObject({ connection: box.id, origin: 'auto' });
		expect(Buffer.from(ingest.items[0]?.original ?? []).toString('utf8')).toBe(
			server.mails.find((item) => item.uid === todo)?.source.toString('utf8')
		);
		expect(ingest.lastReport()).toEqual({ error: '', hint: '', cursor: '1700000000:5' });
	});

	it('searches the start of the text with match_body', async () => {
		const box = connection({ cursor: '1700000000:0', matchBody: true });
		mail('Kein Treffer', 'Rechnung im Text');
		expect((await pollConnection(deps(), box)).created).toBe(1);
	});

	it('takes a mail whose keyword is only in the sender, also without match_body (package A)', async () => {
		const box = connection({ cursor: '1700000000:0', keywords: ['europa-go'] });
		server.add(
			fakeMail({ subject: 'Angebot', from: 'Europa-Go Reisen <info@europa-go.de>', messageId: '<from@example.com>' })
		);
		mail('Angebot', 'Kein Treffer');
		const outcome = await pollConnection(deps(), box);
		expect(outcome).toMatchObject({ created: 1, unmatched: 1 });
		expect(ingest.items[0]?.draft.source_meta).toMatchObject({ from: 'Europa-Go Reisen <info@europa-go.de>' });
	});

	it('takes nothing without keywords', async () => {
		const box = connection({ cursor: '1700000000:0', keywords: [] });
		mail('Todo');
		expect(await pollConnection(deps(), box)).toMatchObject({ created: 0, unmatched: 1, cursor: '1700000000:1' });
	});

	it('creates no duplicate when a run is repeated from an older cursor', async () => {
		const box = connection({ cursor: '1700000000:0' });
		mail('Todo 1');
		mail('Todo 2');
		await pollConnection(deps(), box);
		const again = await pollConnection(deps(), { ...box, cursor: '1700000000:0' });
		expect(again).toMatchObject({ created: 0, duplicates: 2 });
		expect(ingest.items).toHaveLength(2);
	});

	it('checks at most MAX_MAILS_PER_RUN mails per run and continues in the next run', async () => {
		const box = connection({ cursor: '1700000000:0', keywords: ['nie'] });
		for (let i = 0; i < MAX_MAILS_PER_RUN + 5; i++) mail(`Mail ${i}`);
		ingest.connections = [box];
		const first = await pollConnection(deps(), box);
		expect(first.cursor).toBe(`1700000000:${MAX_MAILS_PER_RUN}`);
		const second = await pollConnection(deps(), { ...box, cursor: first.cursor });
		expect(second).toMatchObject({ unmatched: 5, cursor: `1700000000:${MAX_MAILS_PER_RUN + 5}` });
	});

	it('skips mails over 10 MB and unreadable ones, and still moves on', async () => {
		const box = connection({ cursor: '1700000000:0' });
		server.add(`Subject: Todo gross\r\nMessage-ID: <big@x>\r\n\r\n${'x'.repeat(10 * 1024 * 1024)}`);
		mail('Todo klein');
		const outcome = await pollConnection(deps(), box);
		expect(outcome).toMatchObject({ created: 1, skipped: 1, cursor: '1700000000:2' });
		expect(lines.join('\n')).toMatch(/1 über 10 MB übersprungen/);
	});

	it('starts over at the highest UID with a hint when UIDVALIDITY changes', async () => {
		mail('Todo 1');
		mail('Todo 2');
		server.renumber(1800000000);
		const outcome = await pollConnection(deps(), connection({ cursor: '1700000000:1' }));
		expect(outcome).toMatchObject({ created: 0, cursor: '1800000000:2' });
		expect(ingest.lastReport()).toEqual({ error: '', hint: UIDVALIDITY_HINT, cursor: '1800000000:2' });
	});
});

describe('read only (ADR-0016 section 5)', () => {
	it('sends no command that changes the mailbox and leaves every flag as it was', async () => {
		const box = connection({ cursor: '1700000000:0' });
		mail('Todo: A');
		mail('B');
		await pollConnection(deps(), box);
		await pollConnection(deps(), { ...box, cursor: '1700000000:0' });
		expect(server.writes()).toEqual([]);
		expect(server.flagsUnchanged()).toBe(true);
		const names = new Set(server.commands.map((command) => command.name));
		expect(names.has('EXAMINE')).toBe(true);
		for (const name of ['SELECT', 'STORE', 'UID STORE', 'COPY', 'MOVE', 'EXPUNGE', 'APPEND', 'CLOSE']) {
			expect(names.has(name), name).toBe(false);
		}
	});
});

describe('errors', () => {
	it('stores a refused login with the Web.de hint and without the password', async () => {
		server.refuseLogin = true;
		const outcome = await pollConnection(deps(), connection({ cursor: '1700000000:3' }));
		expect(outcome.status).toBe('error');
		const report = ingest.lastReport();
		expect(report?.error).toBe('Anmeldung bei Web.de abgelehnt.');
		expect(report?.hint).toMatch(/POP3- und IMAP-Zugriff erlauben/);
		expect(report?.cursor).toBeUndefined();
		expect(JSON.stringify(ingest.reports) + lines.join('\n')).not.toContain(PASSWORD);
	});

	it('stores a refused Gmail login with the app password hint (E4 plan, package 13)', async () => {
		server.refuseLogin = true;
		// What Gmail answers for the normal account password instead of an app password.
		server.loginRefusal =
			'[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)';
		const gmail = connection({ label: 'Gmail', provider: 'gmail', cursor: '1700000000:3' });
		const outcome = await pollConnection(deps(), gmail);
		expect(outcome).toMatchObject({ status: 'error', error: 'Anmeldung bei Gmail abgelehnt.' });
		const report = ingest.lastReport();
		expect(report?.error).toBe('Anmeldung bei Gmail abgelehnt.');
		expect(report?.hint?.startsWith('App-Passwort nötig (Bestätigung in zwei Schritten)')).toBe(true);
		expect(report?.cursor).toBeUndefined();
		expect(JSON.stringify(ingest.reports) + lines.join('\n')).not.toContain(PASSWORD);
	});

	it('fetches a Gmail inbox like Web.de: first run, then only keyword matches, read only', async () => {
		mail('Todo: vor der Einrichtung');
		const gmail = connection({ label: 'Gmail', provider: 'gmail' });
		const first = await pollConnection(deps(), gmail);
		expect(first).toMatchObject({ status: 'ok', created: 0, cursor: '1700000000:1' });
		mail('Todo: Gmail');
		mail('Werbung');
		const second = await pollConnection(deps(), { ...gmail, cursor: first.cursor });
		expect(second).toMatchObject({ status: 'ok', created: 1, unmatched: 1, cursor: '1700000000:3' });
		expect(ingest.items.map((item) => item.draft.title)).toEqual(['Todo: Gmail']);
		expect(server.writes()).toEqual([]);
		expect(server.flagsUnchanged()).toBe(true);
	});

	it('stores an unreachable server as error and tries again next time', async () => {
		const port = server.port;
		await server.stop();
		const box = connection({ cursor: '1700000000:0' });
		const outcome = await pollConnection(deps({ imapOverride: { host: '127.0.0.1', port, secure: false } }), box);
		expect(outcome.status).toBe('error');
		expect(ingest.lastReport()?.error).toMatch(/^Web\.de nicht erreichbar oder Fehler beim Abruf:/);
		await server.start();
		mail('Todo nach dem Ausfall');
		expect((await pollConnection(deps(), box)).created).toBe(1);
	});

	it('keeps the cursor at the last saved mail when PocketBase stops during a run', async () => {
		const box = connection({ cursor: '1700000000:0' });
		mail('Todo 1');
		mail('Todo 2');
		const flaky = new MemoryIngest();
		let calls = 0;
		flaky.sendItem = async (draft, original) => {
			calls += 1;
			if (calls === 2) throw new IngestError('unreachable', 'PocketBase nicht erreichbar.');
			return MemoryIngest.prototype.sendItem.call(flaky, draft, original);
		};
		const outcome = await pollConnection({ ...deps(), ingest: flaky }, box);
		expect(outcome).toMatchObject({ status: 'stopped', created: 1, cursor: '1700000000:1' });
		const next = await pollConnection({ ...deps(), ingest: flaky }, { ...box, cursor: outcome.cursor });
		expect(next).toMatchObject({ status: 'ok', created: 1, cursor: '1700000000:2' });
		expect(flaky.items.map((item) => item.draft.title)).toEqual(['Todo 1', 'Todo 2']);
	});

	it('does nothing without the password variable and says so in the log', async () => {
		const outcome = await pollConnection(deps({ env: {} }), connection());
		expect(outcome.status).toBe('missing');
		expect(ingest.reports).toEqual([]);
		expect(server.commands).toEqual([]);
		expect(lines.join('\n')).toMatch(/BYL_TEST_MAIL_PASSWORD fehlt/);
	});

	it('reports an unknown provider', async () => {
		expect((await pollConnection(deps(), connection({ provider: 'proton' }))).status).toBe('error');
		expect(ingest.lastReport()?.error).toMatch(/Unbekannter Mail-Anbieter/);
	});

	it('stops quietly when the connection is deleted during the run', async () => {
		ingest.gone = true;
		mail('Todo');
		const outcome = await pollConnection(deps(), connection({ cursor: '1700000000:0' }));
		expect(outcome.status).toBe('gone');
		expect(ingest.reports).toEqual([]);
	});
});

describe('all connections', () => {
	it('runs every connection and waits when PocketBase is not reachable', async () => {
		ingest.connections = [connection(), connection({ id: 'zyxwvutsrq54321', label: 'Zweites' })];
		expect((await pollAll(deps())).map((outcome) => outcome.status)).toEqual(['ok', 'ok']);
		ingest.down = true;
		expect(await pollAll(deps())).toEqual([]);
		expect(lines.at(-1)).toMatch(/^WARN Verbindungen nicht abrufbar: PocketBase nicht erreichbar/);
	});

	it('never logs the token, the password or contents of mails', async () => {
		const box = connection({ cursor: '1700000000:0' });
		ingest.connections = [box];
		mail('Todo: Geheimes Projekt', 'Vertraulicher Inhalt');
		await pollAll(deps());
		const log = lines.join('\n');
		for (const value of [TOKEN, PASSWORD, 'Geheimes Projekt', 'Vertraulicher Inhalt', 'bert@example.com']) {
			expect(log).not.toContain(value);
		}
		expect(log).toMatch(/Postfach "Web.de" \(abcdefghij12345\): 1 neu\./);
	});
});
