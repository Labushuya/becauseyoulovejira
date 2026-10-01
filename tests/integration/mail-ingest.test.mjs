// The mail helper against a disposable PocketBase and the fake IMAP server (ADR-0016 section 5,
// ADR-0020, P-10; E4 plan package 11): the code of byl-mail.exe (helpers/mail/src) fetches through
// the real ingest route. The instance has an invented token and mailbox password in its process
// environment; neither may appear in PocketBase, its log or the log of the helper.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writtenLogs } from '../support/logs.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FakeImapServer, fakeMail } from '../../helpers/mail/test/fake-imap.ts';
import { IngestClient } from '../../helpers/mail/src/ingest-client.ts';
import { pollAll, FIRST_RUN_HINT } from '../../helpers/mail/src/poll.ts';
import { newScan, scanSignature } from '../../helpers/mail/src/scan.ts';
import { scanStateValue } from '../../helpers/mail/src/scan-state.ts';

const TOKEN = randomBytes(24).toString('base64');
const PASSWORD = `pw-${randomBytes(8).toString('hex')}`;
const ENV = { BYL_INGEST_TOKEN: TOKEN, BYL_TEST_MAIL_PASSWORD: PASSWORD };

let instance;
let superuser;
let owner;
let imap;
let lines;

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

function deps() {
	const log = {
		info: (message) => lines.push(message),
		warn: (message) => lines.push(message),
		error: (message) => lines.push(message)
	};
	return {
		ingest: new IngestClient(instance.url, TOKEN),
		env: ENV,
		log,
		imapOverride: { host: '127.0.0.1', port: imap.port, secure: false },
		secrets: [TOKEN]
	};
}

let counter = 0;
function mail(subject, body) {
	counter += 1;
	return imap.add(fakeMail({ subject, body, messageId: `<mail-${counter}-${randomBytes(4).toString('hex')}@example.com>` }));
}

// Created by the superuser, who may also set the cursor that only the server writes.
async function mailbox(extra = {}) {
	return superuser.collection('connections').create({
		owner: owner.id,
		type: 'mail',
		label: 'Web.de',
		enabled: true,
		secret_env: 'BYL_TEST_MAIL_PASSWORD',
		settings: { provider: 'webde', user: imap.user, keywords: ['todo', 'rechnung'] },
		...extra
	});
}

const items = (connection) =>
	owner.pb.collection('inbox_items').getFullList({ filter: `connection = "${connection.id}"`, sort: 'created' });

/**
 * Cursor at the newest mail and a finished scan for `keywords`: the connection then only fetches
 * what arrives from now on (for the cases that test the fetch after the cursor).
 */
function scanned(keywords, matchBody = false) {
	const uid = imap.mails.at(-1)?.uid ?? 0;
	return {
		cursor: `1700000000:${uid}`,
		scan: scanStateValue({ ...newScan(scanSignature(keywords, matchBody), '1700000000', uid), state: 'done', below: 0 })
	};
}

beforeAll(async () => {
	instance = await startPocketBase({ env: ENV });
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	owner = { id: record.id, pb };
	imap = new FakeImapServer();
	imap.password = PASSWORD;
	await imap.start();
});

afterAll(async () => {
	await imap?.stop();
	await instance?.stop();
});

beforeEach(async () => {
	lines = [];
	imap.refuseLogin = false;
	for (const connection of await superuser.collection('connections').getFullList()) {
		await superuser.collection('connections').delete(connection.id);
	}
});

describe('mail helper with PocketBase (P-10)', () => {
	it('takes old and new mails with a keyword from the whole inbox, without duplicates', async () => {
		mail('Todo: vor der Einrichtung');
		const box = await mailbox();
		await pollAll(deps());
		let stored = await owner.pb.collection('connections').getOne(box.id);
		expect(stored.cursor).toBe(`1700000000:${imap.mails.at(-1).uid}`);
		expect(stored.last_hint).toBe(FIRST_RUN_HINT);
		expect(stored.scan).toMatchObject({ state: 'done', total: imap.mails.length, created: 1 });
		expect((await items(box)).map((item) => item.title)).toEqual(['Todo: vor der Einrichtung']);

		mail('Todo: Steuer', 'Bis Freitag.');
		mail('Hallo');
		mail('Rechnung Handwerker');
		await pollAll(deps());
		const created = (await items(box)).slice(1);
		expect(created.map((item) => item.title)).toEqual(['Todo: Steuer', 'Rechnung Handwerker']);
		expect(created[0]).toMatchObject({
			owner: owner.id,
			channel: 'mail',
			kind: 'mail',
			state: 'new',
			body: 'Bis Freitag.',
			source_meta: { from: 'Bert Beispiel <bert@example.com>', to: 'anna@web.de', keyword: 'todo' }
		});
		expect(created[0].original).toMatch(/\.eml$/);
		stored = await owner.pb.collection('connections').getOne(box.id);
		expect(stored).toMatchObject({ cursor: `1700000000:${imap.mails.at(-1).uid}`, last_error: '', last_hint: '' });
		expect(stored.last_ok_at).not.toBe('');

		// Again from an older cursor (a crash before the status was saved): nothing new.
		await superuser.collection('connections').update(box.id, { cursor: '1700000000:1' });
		await pollAll(deps());
		expect(await items(box)).toHaveLength(3);
		expect(lines.join('\n')).toMatch(/0 neu, 2 schon vorhanden, 1 ohne Stichwort/);
		expect(imap.writes()).toEqual([]);
		expect(imap.flagsUnchanged()).toBe(true);
	});

	it('takes "europa-go" only in the sender, only in the text and only in the subject (package A)', async () => {
		const box = await mailbox({
			settings: { provider: 'webde', user: imap.user, keywords: ['europa-go'], match_body: true }
		});
		await pollAll(deps());
		const id = () => `<europa-${randomBytes(4).toString('hex')}@example.com>`;
		imap.add(fakeMail({ subject: 'Nur Absender', from: 'Europa-Go Reisen <info@europa-go.de>', messageId: id() }));
		imap.add(fakeMail({ subject: 'Nur Text', body: 'Ihre Buchung bei Europa-Go.de ist bestätigt.', messageId: id() }));
		imap.add(fakeMail({ subject: 'Neu bei EUROPA-GO', messageId: id() }));
		imap.add(
			fakeMail({
				subject: 'Nur HTML',
				body: '<p>Gebucht bei <b>europa-go</b>.</p>',
				contentType: 'text/html',
				messageId: id()
			})
		);
		imap.add(fakeMail({ subject: 'Ohne Treffer', body: 'Europa geht immer.', messageId: id() }));
		await pollAll(deps());
		const created = await items(box);
		expect(created.map((item) => [item.title, item.source_meta.keyword])).toEqual([
			['Nur Absender', 'europa-go'],
			['Nur Text', 'europa-go'],
			['Neu bei EUROPA-GO', 'europa-go'],
			['Nur HTML', 'europa-go']
		]);
		expect(lines.join('\n')).toMatch(/4 neu, 1 ohne Stichwort/);
	});

	it('refuses a mail matched only by the text when match_body is off, but not by the sender (package A)', async () => {
		const box = await mailbox({ settings: { provider: 'webde', user: imap.user, keywords: ['europa-go'] }, ...scanned(['europa-go']) });
		await pollAll(deps());
		imap.add(fakeMail({ subject: 'Nur Text', body: 'Buchung bei europa-go', messageId: `<t-${randomBytes(4).toString('hex')}@example.com>` }));
		imap.add(fakeMail({ subject: 'Nur Absender', from: 'info@europa-go.de', messageId: `<f-${randomBytes(4).toString('hex')}@example.com>` }));
		await pollAll(deps());
		expect((await items(box)).map((item) => item.title)).toEqual(['Nur Absender']);
		// The route checks the sender itself: a fetched mail without keyword in subject and sender
		// is refused even if a client claims it matched.
		const refused = await fetch(`${instance.url}/api/byl/ingest/items`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				connection: box.id,
				origin: 'auto',
				title: 'Angebot',
				body: 'europa-go',
				source_ref: '<refused@example.com>',
				source_meta: { from: 'Anna <anna@example.com>' }
			})
		});
		expect(refused.status).toBe(422);
		const accepted = await fetch(`${instance.url}/api/byl/ingest/items`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				connection: box.id,
				origin: 'auto',
				title: 'Angebot',
				source_ref: '<accepted@example.com>',
				source_meta: { from: 'Europa-Go <info@europa-go.de>' }
			})
		});
		expect(accepted.status).toBe(200);
		expect((await accepted.json()).status).toBe('created');
	});

	it('knows a mail that was dropped as .eml file before', async () => {
		const box = await mailbox(scanned(['todo', 'rechnung']));
		const messageId = `<eml-${randomBytes(4).toString('hex')}@example.com>`;
		const file = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'eml',
			kind: 'mail',
			title: 'Todo: aus der Datei',
			source_ref: messageId
		});
		imap.add(fakeMail({ subject: 'Todo: aus der Datei', messageId }));
		const [outcome] = await pollAll(deps());
		expect(outcome).toMatchObject({ created: 0, duplicates: 1 });
		expect((await owner.pb.collection('inbox_items').getFullList({ filter: `source_ref = "${messageId}"` })).map((item) => item.id)).toEqual([
			file.id
		]);
	});

	it('stores a refused login with the Web.de hint, cleaned', async () => {
		const box = await mailbox({ cursor: '1700000000:0' });
		imap.refuseLogin = true;
		await pollAll(deps());
		const stored = await owner.pb.collection('connections').getOne(box.id);
		expect(stored.last_error).toBe('Anmeldung bei Web.de abgelehnt.');
		expect(stored.last_hint).toMatch(/POP3- und IMAP-Zugriff erlauben/);
		expect(stored.cursor).toBe('1700000000:0');
	});

	it('fetches Gmail like Web.de, once per Message-ID, and asks for an app password (E4 plan, package 13)', async () => {
		const gmail = { label: 'Gmail', settings: { provider: 'gmail', user: imap.user, keywords: ['todo'] } };
		const box = await mailbox({ ...gmail, ...scanned(['todo']) });
		const messageId = `<gmail-${randomBytes(4).toString('hex')}@mail.gmail.com>`;
		const file = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'eml',
			kind: 'mail',
			title: 'Todo: auch als Datei',
			source_ref: messageId
		});
		imap.add(fakeMail({ subject: 'Todo: auch als Datei', messageId }));
		mail('Todo: nur im Postfach');
		mail('Newsletter');
		const [outcome] = await pollAll(deps());
		expect(outcome).toMatchObject({ created: 1, duplicates: 1, unmatched: 1 });
		expect((await items(box)).map((item) => [item.title, item.source_meta.keyword])).toEqual([['Todo: nur im Postfach', 'todo']]);
		expect((await owner.pb.collection('inbox_items').getFullList({ filter: `source_ref = "${messageId}"` })).map((item) => item.id)).toEqual([
			file.id
		]);

		imap.refuseLogin = true;
		imap.loginRefusal = '[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)';
		try {
			await pollAll(deps());
		} finally {
			imap.loginRefusal = '[AUTHENTICATIONFAILED] Authentication failed.';
		}
		const stored = await owner.pb.collection('connections').getOne(box.id);
		expect(stored.last_error).toBe('Anmeldung bei Gmail abgelehnt.');
		expect(stored.last_hint.startsWith('App-Passwort nötig (Bestätigung in zwei Schritten)')).toBe(true);
		expect(JSON.stringify(stored)).not.toContain(PASSWORD);
		expect(imap.writes()).toEqual([]);
	});

	it('does nothing for a switched-off connection', async () => {
		const box = await mailbox({ enabled: false, cursor: '1700000000:0' });
		mail('Todo: aus');
		expect(await pollAll(deps())).toEqual([]);
		expect(await items(box)).toEqual([]);
	});

	it('never shows the token or the password', async () => {
		await mailbox();
		await pollAll(deps());
		const everything = [
			lines.join('\n'),
			JSON.stringify(await superuser.collection('connections').getFullList()),
			// All entries, once PocketBase has written those of this run (it writes in batches).
			JSON.stringify(await writtenLogs(superuser)),
			instance.output()
		].join('\n');
		expect(everything).not.toContain(TOKEN);
		expect(everything).not.toContain(PASSWORD);
	});
});

describe('full inbox scan with PocketBase (user decision 2026-09-27)', () => {
	beforeEach(() => {
		imap.mails.length = 0;
		imap.folders.clear();
		imap.commands.length = 0;
	});

	it('takes old mails from the whole inbox (To, Cc, deep text, HTML only), never from trash or spam', async () => {
		const id = () => `<scan-${randomBytes(4).toString('hex')}@example.com>`;
		imap.add(fakeMail({ subject: 'Nur An', to: 'Projekt-X Team <team@example.com>', messageId: id() }));
		imap.add(fakeMail({ subject: 'Nur Cc', headers: ['Cc: Projekt-X <px@example.com>'], messageId: id() }));
		imap.add(fakeMail({ subject: 'Tief im Text', body: `${'Newsletter ohne Treffer. '.repeat(300)}Projekt-X`, messageId: id() }));
		imap.add(
			fakeMail({ subject: 'Nur HTML', body: '<p>Neu im <b>Projekt-X</b></p>', contentType: 'text/html', messageId: id() })
		);
		imap.add(fakeMail({ subject: 'Ohne Treffer', messageId: id() }));
		imap.addTo('Trash', fakeMail({ subject: 'Projekt-X im Papierkorb', messageId: id() }));
		imap.addTo('Junk', fakeMail({ subject: 'Projekt-X im Spam', messageId: id() }));
		imap.addTo('Sent', fakeMail({ subject: 'Projekt-X gesendet', messageId: id() }));
		const box = await mailbox({ settings: { provider: 'webde', user: imap.user, keywords: ['projekt-x'], match_body: true } });
		await pollAll(deps());
		const created = await items(box);
		expect(created.map((item) => item.title).sort()).toEqual(['Nur An', 'Nur Cc', 'Nur HTML', 'Tief im Text']);
		expect(created.every((item) => item.source_meta.keyword === 'projekt-x')).toBe(true);
		const stored = await owner.pb.collection('connections').getOne(box.id);
		expect(stored.scan).toMatchObject({ state: 'done', done: 5, total: 5, created: 4 });
		expect(imap.opened()).toEqual(['INBOX']);
		expect(imap.writes()).toEqual([]);
		expect(imap.flagsUnchanged()).toBe(true);
	});

	it('finds old mails after a new keyword; discarded entries stay discarded, nothing twice', async () => {
		const id = () => `<again-${randomBytes(4).toString('hex')}@example.com>`;
		imap.add(fakeMail({ subject: 'Todo: Garage', messageId: id() }));
		imap.add(fakeMail({ subject: 'Rechnung Garage', messageId: id() }));
		const box = await mailbox({ settings: { provider: 'webde', user: imap.user, keywords: ['todo'] } });
		await pollAll(deps());
		const [todo] = await items(box);
		expect(todo.title).toBe('Todo: Garage');
		await owner.pb.collection('inbox_items').update(todo.id, { state: 'discarded' });

		// The user adds a keyword: the next run searches the whole inbox again.
		await owner.pb.collection('connections').update(box.id, {
			settings: { provider: 'webde', user: imap.user, keywords: ['todo', 'rechnung'] }
		});
		const [outcome] = await pollAll(deps());
		expect(outcome).toMatchObject({ created: 1, duplicates: 1 });
		const after = await items(box);
		expect(after.map((item) => [item.title, item.state])).toEqual([
			['Todo: Garage', 'discarded'],
			['Rechnung Garage', 'new']
		]);
		// A further run without a change does not scan again and creates nothing.
		const [quiet] = await pollAll(deps());
		expect(quiet).toMatchObject({ created: 0, duplicates: 0, scan: null });
		expect(await items(box)).toHaveLength(2);
	});
});
