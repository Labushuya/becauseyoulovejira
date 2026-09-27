// One run of the mail helper against the fake IMAP server and an in-memory ingest route (ADR-0016
// section 5, ADR-0020, P-10; E4 plan package 11): the cursor, only mails with a keyword are sent,
// the cursor moves over the others, no duplicates on a second run, errors land cleaned at the
// connection, the mailbox stays unchanged. Since the user decision of 2026-09-27 (ADR-0020,
// addendum 3) the whole inbox is scanned: old mails, headers and deep text, only the inbox, again
// after new keywords, at most 200 new entries per run, fallback without server search, cancel and
// time budget.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeImapServer, fakeMail } from '../test/fake-imap';
import { ScanControl } from './gate';
import { IngestError, type IngestApi, type MailConnection, type StatusReport } from './ingest-client';
import PostalMime from 'postal-mime';
import { ORIGINAL_OMITTED_NOTE } from '../../../web/src/lib/domain/inbox-mail';
import type { Logger } from './log';
import { MAIL_PARTIAL_BYTES, type IngestDraft } from './mail';
import {
	FIRST_RUN_HINT,
	MAX_MAILS_PER_RUN,
	SCAN_FALLBACK_HINT,
	SCAN_MORE_HINT,
	UIDVALIDITY_HINT,
	nextScan,
	parseCursor,
	pollAll,
	pollConnection,
	type PollDeps
} from './poll';
import { MAX_CREATED_PER_RUN, SCAN_BLOCK_SIZE, newScan, scanSignature } from './scan';
import { scanStateOf, type ScanState } from './scan-state';

const PASSWORD = 'geheim-1234';
const TOKEN = 'token-abcdef';

/** The ingest route in memory: duplicates by Message-ID, like the fingerprint of the hook. */
class MemoryIngest implements IngestApi {
	connections: MailConnection[] = [];
	items: { draft: IngestDraft; original: Uint8Array | undefined; state: string }[] = [];
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
		if (existing >= 0) {
			return { status: 'duplicate' as const, item: String(existing), state: this.items[existing]?.state ?? 'new' };
		}
		this.items.push({ draft, original, state: 'new' });
		return { status: 'created' as const, item: String(this.items.length - 1) };
	}

	async reportStatus(id: string, report: StatusReport) {
		if (this.down) throw new IngestError('unreachable', 'PocketBase nicht erreichbar.');
		this.reports.push({ id, report });
		const connection = this.connections.find((item) => item.id === id);
		if (connection && report.cursor !== undefined) connection.cursor = report.cursor;
		if (connection && report.scan !== undefined) connection.scan = scanStateOf(report.scan);
	}

	lastReport() {
		return this.reports.at(-1)?.report;
	}
}

let server: FakeImapServer;
let ingest: MemoryIngest;
let lines: string[];

/** A scan that is done for the keywords of `box`, so a run only fetches after the cursor. */
function finishedScan(box: Pick<MailConnection, 'keywords' | 'matchBody' | 'cursor'>): ScanState {
	const uidValidity = parseCursor(box.cursor)?.uidValidity ?? '1700000000';
	return { ...newScan(scanSignature(box.keywords, box.matchBody), uidValidity, 0), state: 'done', below: 0 };
}

/** A connection; with a cursor and without `scan` its scan is done (the behaviour before the scan). */
function connection(extra: Partial<MailConnection> = {}): MailConnection {
	const box: MailConnection = {
		id: 'abcdefghij12345',
		label: 'Web.de',
		provider: 'webde',
		user: server.user,
		secretEnv: 'BYL_TEST_MAIL_PASSWORD',
		keywords: ['todo', 'rechnung'],
		matchBody: false,
		cursor: '',
		scan: null,
		...extra
	};
	if (extra.scan === undefined && box.cursor !== '') box.scan = finishedScan(box);
	return box;
}

/** The connection as the in-memory route holds it after the reports of the last run. */
function stored(id = 'abcdefghij12345'): MailConnection {
	const found = ingest.connections.find((item) => item.id === id);
	if (found === undefined) throw new Error('connection not registered');
	return { ...found };
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
function mail(subject: string, body = 'Text der Mail.', more: { to?: string; headers?: string[] } = {}): number {
	counter += 1;
	return server.add(fakeMail({ subject, body, messageId: `<m${counter}@example.com>`, ...more }));
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

describe('first run (full inbox, ADR-0020 addendum 3)', () => {
	it('takes an old mail over 10 MB of the full scan without its file (ADR-0031)', async () => {
		mail('Hallo');
		const big = server.add(
			`Subject: Rechnung gross\r\nMessage-ID: <scan-big@x>\r\n\r\nSumme 12 Euro\r\n${'q'.repeat(10 * 1024 * 1024)}`
		);
		const box = connection();
		ingest.connections = [box];
		const outcome = await pollConnection(deps(), box);
		expect(outcome).toMatchObject({ status: 'ok', created: 1, omitted: 1 });
		expect(ingest.items[0]?.original).toBeUndefined();
		expect(ingest.items[0]?.draft.source_meta).toMatchObject({ original_omitted: 'too_large' });
		expect(server.partialFetches.map((fetch) => fetch.uid)).toEqual([big]);
		expect(server.writes()).toEqual([]);
	});

	it('sets the cursor to the highest UID and takes the old mails with a keyword', async () => {
		mail('Todo: alt');
		mail('Hallo');
		mail('Rechnung alt');
		const box = connection();
		ingest.connections = [box];
		const outcome = await pollConnection(deps(), box);
		expect(outcome).toMatchObject({ status: 'ok', created: 2, cursor: '1700000000:3' });
		expect(ingest.items.map((item) => item.draft.title)).toEqual(['Rechnung alt', 'Todo: alt']);
		expect(ingest.items[0]?.draft.origin).toBe('auto');
		const last = ingest.lastReport();
		expect(last).toMatchObject({ error: '', hint: FIRST_RUN_HINT, cursor: '1700000000:3' });
		expect(scanStateOf(last?.scan)).toMatchObject({ state: 'done', until: 3, below: 0, done: 3, total: 3, created: 2 });
	});

	it('starts at 0 in an empty inbox and finishes the scan at once', async () => {
		const outcome = await pollConnection(deps(), connection());
		expect(outcome.cursor).toBe('1700000000:0');
		expect(outcome.scan).toMatchObject({ state: 'done', total: 0 });
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
		expect(outcome).toMatchObject({ status: 'ok', created: 2, unmatched: 2, cursor: '1700000000:5', scan: null });
		expect(ingest.items.map((item) => item.draft.title)).toEqual(['Todo: Steuer', 'Neue RECHNUNG']);
		expect(ingest.items[0]?.draft).toMatchObject({ connection: box.id, origin: 'auto' });
		expect(Buffer.from(ingest.items[0]?.original ?? []).toString('utf8')).toBe(
			server.mails.find((item) => item.uid === todo)?.source.toString('utf8')
		);
		expect(ingest.lastReport()).toEqual({ error: '', hint: '', cursor: '1700000000:5' });
	});

	it('searches the whole text with match_body', async () => {
		const box = connection({ cursor: '1700000000:0', matchBody: true });
		mail('Kein Treffer', `${'Text ohne Treffer. '.repeat(400)}Rechnung im Text`);
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

	it('takes a mail over 10 MB from its beginning, without the file, and moves on (ADR-0031)', async () => {
		const box = connection({ cursor: '1700000000:0' });
		const source =
			'From: Anna Beispiel <anna@example.com>\r\nSubject: Todo gross\r\nMessage-ID: <big@x>\r\n' +
			`Content-Type: text/plain; charset=utf-8\r\n\r\nHier der Anfang.\r\n${'x'.repeat(10 * 1024 * 1024)}`;
		const big = server.add(source);
		mail('Todo klein');
		const outcome = await pollConnection(deps(), box);
		expect(outcome).toMatchObject({ created: 2, skipped: 0, omitted: 1, cursor: '1700000000:2' });
		const large = ingest.items.find((item) => item.draft.source_ref === '<big@x>');
		expect(large?.original).toBeUndefined();
		expect(large?.draft).toMatchObject({
			title: 'Todo gross',
			source_meta: {
				from: 'Anna Beispiel <anna@example.com>',
				original_omitted: 'too_large',
				original_size: Buffer.byteLength(source)
			}
		});
		expect(large?.draft.body.startsWith('Hier der Anfang.')).toBe(true);
		expect(large?.draft.body.endsWith(ORIGINAL_OMITTED_NOTE)).toBe(true);
		expect(large?.draft.body.length).toBeLessThanOrEqual(100_000);
		// Only its first 2 MB were fetched, read-only.
		expect(server.partialFetches).toEqual([{ uid: big, start: 0, length: MAIL_PARTIAL_BYTES }]);
		expect(server.writes()).toEqual([]);
		expect(ingest.items.find((item) => item.draft.title === 'Todo klein')?.original).toBeDefined();
		expect(lines.join('\n')).toMatch(/2 neu, davon 1 über 10 MB ohne Originaldatei/);
	});

	it('falls back to the header of a mail over 10 MB whose beginning cannot be read', async () => {
		const box = connection({ cursor: '1700000000:0' });
		const header = 'From: amt@example.com\r\nSubject: Todo Bescheid\r\nMessage-ID: <kopf@x>\r\n\r\n';
		server.add(`${header}${'y'.repeat(10 * 1024 * 1024)}`);
		const original = PostalMime.parse;
		let calls = 0;
		PostalMime.parse = (async (...args: Parameters<typeof PostalMime.parse>) => {
			calls += 1;
			if (calls === 1) throw new Error('unreadable');
			return original(...args);
		}) as typeof PostalMime.parse;
		try {
			const outcome = await pollConnection(deps(), box);
			expect(outcome).toMatchObject({ created: 1, omitted: 1, failed: 0 });
		} finally {
			PostalMime.parse = original;
		}
		expect(ingest.items[0]?.draft).toMatchObject({
			title: 'Todo Bescheid',
			body: ORIGINAL_OMITTED_NOTE,
			source_meta: { from: 'amt@example.com', original_omitted: 'too_large' }
		});
	});

	it('scans the inbox again when UIDVALIDITY changes, without duplicates', async () => {
		mail('Todo 1');
		mail('Todo 2');
		const box = connection({ cursor: '1700000000:2' });
		ingest.connections = [box];
		await pollConnection(deps(), { ...box, cursor: '1700000000:0' });
		expect(ingest.items).toHaveLength(2);
		server.renumber(1800000000);
		const outcome = await pollConnection(deps(), stored());
		expect(outcome).toMatchObject({ created: 0, duplicates: 2, cursor: '1800000000:2' });
		expect(ingest.lastReport()).toMatchObject({ error: '', hint: UIDVALIDITY_HINT, cursor: '1800000000:2' });
		expect(stored().scan).toMatchObject({ state: 'done', uidValidity: '1800000000', total: 2 });
	});
});

describe('full inbox scan (user decision 2026-09-27)', () => {
	it('finds keywords in old mails: only in To or Cc, deep in the text, HTML only, with a hyphen', async () => {
		const box = connection({ keywords: ['projekt-x', 'europa-go', 'erledigen'], matchBody: true });
		ingest.connections = [box];
		mail('Nur An', 'Hallo', { to: 'Projekt-X Team <team@example.com>' });
		mail('Nur Cc', 'Hallo', { headers: ['Cc: Projekt-X <px@example.com>'] });
		mail('Tief im Text', `${'Newsletter ohne Treffer. '.repeat(300)}Abmelden bei Europa-Go`);
		server.add(
			fakeMail({
				subject: 'Nur HTML',
				body: '<html><body><p>Bitte <b>erledigen</b> bis Freitag.</p></body></html>',
				messageId: '<html@example.com>',
				contentType: 'text/html'
			})
		);
		mail('Nichts', 'Kein Treffer');
		const outcome = await pollConnection(deps(), box);
		expect(outcome).toMatchObject({ status: 'ok', created: 4, unmatched: 0 });
		expect(ingest.items.map((item) => item.draft.title).sort()).toEqual(['Nur An', 'Nur Cc', 'Nur HTML', 'Tief im Text']);
		// Only the matches were loaded: one BODY.PEEK[] per candidate, none for "Nichts".
		const loads = server.commands.filter((command) => /BODY\.PEEK\[\]/.test(command.args));
		expect(loads).toHaveLength(4);
	});

	it('leaves trash, spam, sent mails, drafts and the archive out and opens only the inbox', async () => {
		for (const folder of ['Trash', 'Junk', 'Sent', 'Drafts', 'Archive']) {
			server.addTo(folder, fakeMail({ subject: `Todo in ${folder}`, messageId: `<${folder}@example.com>` }));
		}
		mail('Todo im Posteingang');
		const box = connection({ matchBody: true });
		await pollConnection(deps(), box);
		expect(ingest.items.map((item) => item.draft.title)).toEqual(['Todo im Posteingang']);
		expect(server.opened()).toEqual(['INBOX']);
	});

	it('finds old mails again when a keyword is added (rescan), without duplicates', async () => {
		mail('Todo: Steuer');
		mail('Rechnung Handwerker');
		const box = connection({ keywords: ['todo'] });
		ingest.connections = [box];
		await pollConnection(deps(), box);
		expect(ingest.items.map((item) => item.draft.title)).toEqual(['Todo: Steuer']);
		// Without a change the next run does not scan again.
		expect((await pollConnection(deps(), stored())).scan).toBeNull();
		ingest.connections = [{ ...stored(), keywords: ['todo', 'rechnung'] }];
		const outcome = await pollConnection(deps(), stored());
		expect(outcome).toMatchObject({ created: 1, duplicates: 1 });
		expect(ingest.items.map((item) => item.draft.title)).toEqual(['Todo: Steuer', 'Rechnung Handwerker']);
	});

	it('rescans on request and creates no duplicate; a discarded entry stays discarded', async () => {
		mail('Todo 1');
		mail('Todo 2');
		const box = connection();
		ingest.connections = [box];
		await pollConnection(deps(), box);
		const first = ingest.items[0];
		if (first) first.state = 'discarded';
		const again = await pollConnection(deps(), stored(), { manual: true, rescan: true });
		expect(again).toMatchObject({ created: 0, duplicates: 2 });
		expect(ingest.items).toHaveLength(2);
		expect(ingest.items[0]?.state).toBe('discarded');
	});

	it(`creates at most ${MAX_CREATED_PER_RUN} entries per run, then pauses until a manual run`, async () => {
		for (let i = 0; i < MAX_CREATED_PER_RUN + 5; i++) mail(`Todo ${i}`);
		const box = connection();
		ingest.connections = [box];
		const first = await pollConnection(deps(), box);
		expect(first.created).toBe(MAX_CREATED_PER_RUN);
		expect(ingest.lastReport()?.hint).toBe(SCAN_MORE_HINT);
		expect(stored().scan).toMatchObject({ state: 'paused', created: MAX_CREATED_PER_RUN, total: MAX_CREATED_PER_RUN + 5 });
		// The newest mails come first.
		expect(ingest.items[0]?.draft.title).toBe(`Todo ${MAX_CREATED_PER_RUN + 4}`);
		const automatic = await pollConnection(deps(), stored());
		expect(automatic.created).toBe(0);
		const manual = await pollConnection(deps(), stored(), { manual: true });
		expect(manual.created).toBe(5);
		expect(stored().scan).toMatchObject({ state: 'done', created: MAX_CREATED_PER_RUN + 5, done: MAX_CREATED_PER_RUN + 5 });
		expect(ingest.lastReport()?.hint).toBe('');
		expect(new Set(ingest.items.map((item) => item.draft.source_ref)).size).toBe(MAX_CREATED_PER_RUN + 5);
	});

	it('reports the progress block by block', async () => {
		for (let i = 0; i < SCAN_BLOCK_SIZE + 20; i++) mail(`Mail ${i}`);
		const box = connection({ keywords: ['nie'] });
		ingest.connections = [box];
		await pollConnection(deps(), box);
		const progress = ingest.reports
			.map((entry) => scanStateOf(entry.report.scan))
			.filter((scan) => scan !== null)
			.map((scan) => `${scan.state} ${scan.done}/${scan.total}`);
		expect(progress).toEqual([
			`running 0/${SCAN_BLOCK_SIZE + 20}`,
			`running ${SCAN_BLOCK_SIZE}/${SCAN_BLOCK_SIZE + 20}`,
			`done ${SCAN_BLOCK_SIZE + 20}/${SCAN_BLOCK_SIZE + 20}`
		]);
	});

	it('searches with CHARSET UTF-8 and finds umlauts in every spelling', async () => {
		mail('Hallo', 'Bitte bis Freitag prüfen.');
		mail('Hallo', 'Den Weg mit Fuß gehen.');
		const box = connection({ keywords: ['pruefen', 'fuss'], matchBody: true });
		const outcome = await pollConnection(deps(), box);
		expect(outcome.created).toBe(2);
		expect(server.commands.some((command) => /CHARSET UTF-8/.test(command.args))).toBe(true);
	});

	it('loads the mails of a block when the server refuses the text search (fallback)', async () => {
		server.refuseTextSearch = true;
		mail('Hallo', `${'x '.repeat(3000)}Rechnung anbei`);
		mail('Hallo', 'Nichts');
		const box = connection({ matchBody: true });
		ingest.connections = [box];
		const outcome = await pollConnection(deps(), box);
		expect(outcome).toMatchObject({ created: 1, unmatched: 1 });
		expect(stored().scan).toMatchObject({ state: 'done', fallback: true });
		expect(ingest.lastReport()?.hint).toBe(SCAN_FALLBACK_HINT);
	});

	it('stops at a cancel request and does not start a cancelled scan again by itself', async () => {
		mail('Todo alt');
		const control = new ScanControl();
		const box = connection();
		ingest.connections = [box];
		control.begin(box.id);
		expect(control.requestCancel(box.id)).toBe(true);
		const outcome = await pollConnection(deps({ control }), box);
		expect(outcome.created).toBe(0);
		expect(stored().scan).toMatchObject({ state: 'cancelled', done: 0, total: 1 });
		control.end(box.id);
		expect((await pollConnection(deps({ control }), stored())).scan).toBeNull();
		const rescan = await pollConnection(deps({ control }), stored(), { manual: true, rescan: true });
		expect(rescan.created).toBe(1);
	});

	it('stops at the time budget and continues in the next run', async () => {
		mail('Todo 1');
		mail('Todo 2');
		let time = 0;
		const box = connection();
		ingest.connections = [box];
		const first = await pollConnection(deps({ now: () => (time += 10) }), box, { manual: true, deadline: 15 });
		expect(first).toMatchObject({ scanPending: true });
		expect(stored().scan?.state).toBe('running');
		const second = await pollConnection(deps(), stored());
		expect(first.created + second.created).toBe(2);
		expect(stored().scan?.state).toBe('done');
	});

	it('chooses the scan of a run from the stored state', () => {
		const box = connection({ cursor: '1700000000:9' });
		const signature = scanSignature(box.keywords, box.matchBody);
		const stateOf = (scan: ScanState | null, fresh = false, options = {}) =>
			nextScan({ ...box, scan }, '1700000000', box.cursor, fresh, options)?.state ?? null;
		const base = newScan(signature, '1700000000', 9);
		expect(stateOf(null)).toBe('running');
		expect(stateOf({ ...base, state: 'done' })).toBeNull();
		expect(stateOf({ ...base, state: 'done' }, true)).toBe('running');
		expect(stateOf({ ...base, state: 'done' }, false, { rescan: true })).toBe('running');
		expect(stateOf({ ...base, state: 'done', signature: '0000000000000000' })).toBe('running');
		expect(stateOf({ ...base, state: 'done', uidValidity: '1' })).toBe('running');
		expect(stateOf({ ...base, state: 'error' })).toBe('running');
		expect(stateOf({ ...base, state: 'paused' })).toBeNull();
		expect(stateOf({ ...base, state: 'paused' }, false, { manual: true })).toBe('running');
		expect(stateOf({ ...base, state: 'cancelled' }, false, { manual: true })).toBeNull();
		expect(nextScan({ ...box, scan: null }, '1700000000', box.cursor, false, {})).toMatchObject({ until: 9, below: 10 });
	});
});

describe('read only (ADR-0016 section 5)', () => {
	it('sends no command that changes the mailbox and leaves every flag as it was', async () => {
		mail('Todo: A');
		mail('B', 'Rechnung im Text');
		await pollConnection(deps(), connection({ matchBody: true }));
		await pollConnection(deps(), connection({ cursor: '1700000000:0' }));
		await pollConnection(deps(), connection({ cursor: '1700000000:2', matchBody: true }), { rescan: true });
		expect(server.writes()).toEqual([]);
		expect(server.flagsUnchanged()).toBe(true);
		const names = new Set(server.commands.map((command) => command.name));
		expect(names.has('EXAMINE')).toBe(true);
		expect(names.has('UID SEARCH')).toBe(true);
		for (const name of ['SELECT', 'STORE', 'UID STORE', 'COPY', 'UID COPY', 'MOVE', 'UID MOVE', 'EXPUNGE', 'UID EXPUNGE', 'APPEND', 'CLOSE']) {
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

	it('fetches a Gmail inbox like Web.de: whole inbox first, then only keyword matches, read only', async () => {
		mail('Todo: vor der Einrichtung');
		const gmail = connection({ label: 'Gmail', provider: 'gmail' });
		ingest.connections = [gmail];
		const first = await pollConnection(deps(), gmail);
		expect(first).toMatchObject({ status: 'ok', created: 1, cursor: '1700000000:1' });
		mail('Todo: Gmail');
		mail('Werbung');
		const second = await pollConnection(deps(), stored());
		expect(second).toMatchObject({ status: 'ok', created: 1, unmatched: 1, cursor: '1700000000:3' });
		expect(ingest.items.map((item) => item.draft.title)).toEqual(['Todo: vor der Einrichtung', 'Todo: Gmail']);
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

	it('reads each connection again before its turn (a cancelled scan stays cancelled)', async () => {
		mail('Todo');
		const second = connection({ id: 'zyxwvutsrq54321', label: 'Zweites' });
		ingest.connections = [connection(), second];
		const cancelled = { ...newScan(scanSignature(second.keywords, false), '1700000000', 0), state: 'cancelled' as const };
		const listed = ingest.listConnections.bind(ingest);
		let calls = 0;
		ingest.listConnections = async () => {
			calls += 1;
			const list = await listed();
			return calls === 1 ? list : list.map((item) => (item.id === second.id ? { ...item, cursor: '1700000000:1', scan: cancelled } : item));
		};
		const outcomes = await pollAll(deps());
		expect(outcomes[1]?.scan).toBeNull();
		expect(calls).toBe(2);
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
