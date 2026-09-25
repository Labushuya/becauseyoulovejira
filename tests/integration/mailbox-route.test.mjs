// Mailbox selection end to end (ADR-0016 section 6; E4 plan package 23): the data layer of the web
// app asks the routes of the hook, the hook asks the interface of the mail helper (the code of
// byl-mail.exe, started here in the test) on 127.0.0.1 with the ingest token, the helper reads the
// fake IMAP server and takes chosen mails through the ingest route. Only a signed-in user who sees
// the connection gets an answer; a stopped helper gives a hint; the mailbox stays unchanged.

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FakeImapServer, fakeMail } from '../../helpers/mail/test/fake-imap.ts';
import { IngestClient } from '../../helpers/mail/src/ingest-client.ts';
import { startMailboxServer } from '../../helpers/mail/src/server.ts';
import { importFromMailbox, listMailbox } from '../../web/src/lib/data/connections.ts';

const TOKEN = randomBytes(24).toString('base64');
const PASSWORD = `pw-${randomBytes(8).toString('hex')}`;

let port;
let instance;
let superuser;
let owner;
let other;
let imap;
let helper = null;
let mailbox;
const lines = [];

async function freePort() {
	const probe = createNetServer();
	await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
	const { port: found } = probe.address();
	await new Promise((resolve) => probe.close(resolve));
	return found;
}

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function user() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return { id: record.id, pb };
}

async function startHelper(token = TOKEN) {
	helper = await startMailboxServer({
		token,
		ingest: new IngestClient(instance.url, TOKEN),
		env: { BYL_TEST_MAIL_PASSWORD: PASSWORD, BYL_MAIL_HELPER_PORT: String(port) },
		log: { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) },
		imapOverride: { host: '127.0.0.1', port: imap.port, secure: false }
	});
	expect(helper).not.toBeNull();
}

async function stopHelper() {
	const server = helper;
	helper = null;
	if (server) await new Promise((resolve) => server.close(resolve));
}

let counter = 0;
function mail(subject) {
	counter += 1;
	return imap.add(fakeMail({ subject, messageId: `<box-${counter}-${randomBytes(4).toString('hex')}@example.com>` }));
}

beforeAll(async () => {
	port = await freePort();
	instance = await startPocketBase({
		env: { BYL_INGEST_TOKEN: TOKEN, BYL_TEST_MAIL_PASSWORD: PASSWORD, BYL_MAIL_HELPER_PORT: String(port) }
	});
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await user();
	other = await user();
	imap = new FakeImapServer();
	imap.password = PASSWORD;
	await imap.start();
	mailbox = await owner.pb.collection('connections').create({
		owner: owner.id,
		type: 'mail',
		label: 'Web.de',
		enabled: true,
		secret_env: 'BYL_TEST_MAIL_PASSWORD',
		settings: { provider: 'webde', user: imap.user, keywords: ['todo'] }
	});
	await startHelper();
}, 60_000);

afterAll(async () => {
	await stopHelper();
	await imap?.stop();
	await instance?.stop();
});

describe('GET /api/byl/connections/{id}/mailbox', () => {
	it('lists the last mails with keyword and state in the inbox, newest first', async () => {
		const old = mail('Todo: vor der Einrichtung');
		const plain = mail('Hallo');
		const matched = mail('Todo: Steuer');
		const discarded = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'eml',
			kind: 'mail',
			title: 'Hallo',
			source_ref: imap.mails.find((item) => item.uid === plain).source.toString('utf8').match(/Message-ID: (\S+)/)[1]
		});
		await owner.pb.collection('inbox_items').update(discarded.id, { state: 'discarded' });

		const answer = await listMailbox(owner.pb, mailbox.id, 50);
		expect(answer.kind).toBe('ok');
		expect(answer.value.map((item) => [item.uid, item.subject, item.keyword, item.state])).toEqual([
			[matched, 'Todo: Steuer', 'todo', ''],
			[plain, 'Hallo', '', 'discarded'],
			[old, 'Todo: vor der Einrichtung', 'todo', '']
		]);
		expect(answer.value[1].stateMessage).toBe('Schon verworfen.');
		expect(answer.value[0]).toMatchObject({ from: 'Bert Beispiel <bert@example.com>', date: '2026-09-25 08:00:00.000Z' });
		expect((await listMailbox(owner.pb, mailbox.id, 1)).value).toHaveLength(1);
	});

	it('answers only signed-in users who see a switched-on mail connection', async () => {
		const guest = await fetch(`${instance.url}/api/byl/connections/${mailbox.id}/mailbox`);
		expect(guest.status).toBe(401);
		await expect(listMailbox(other.pb, mailbox.id, 50)).rejects.toMatchObject({ kind: 'not_found' });
		const calendar = await owner.pb.collection('connections').create({
			owner: owner.id,
			type: 'calendar',
			label: 'Kalender',
			enabled: true,
			secret_env: 'BYL_TEST_MAIL_PASSWORD'
		});
		await expect(listMailbox(owner.pb, calendar.id, 50)).rejects.toMatchObject({ kind: 'not_found' });
		const off = await owner.pb.collection('connections').create({
			owner: owner.id,
			type: 'mail',
			label: 'Aus',
			enabled: false,
			secret_env: 'BYL_TEST_MAIL_PASSWORD',
			settings: { provider: 'webde', user: imap.user }
		});
		expect(await listMailbox(owner.pb, off.id, 50)).toEqual({
			kind: 'failed',
			message: 'Die Verbindung ist ausgeschaltet.',
			hint: ''
		});
		for (const limit of [0, 201]) {
			expect((await listMailbox(owner.pb, mailbox.id, limit)).kind).toBe('failed');
		}
		await superuser.collection('connections').delete(calendar.id);
		await superuser.collection('connections').delete(off.id);
	});

	it('passes on a refused login with the hint', async () => {
		imap.refuseLogin = true;
		const answer = await listMailbox(owner.pb, mailbox.id, 50);
		imap.refuseLogin = false;
		expect(answer).toEqual({
			kind: 'failed',
			message: 'Anmeldung bei Web.de abgelehnt.',
			hint: expect.stringMatching(/POP3- und IMAP-Zugriff erlauben/)
		});
		expect(JSON.stringify(answer)).not.toContain(PASSWORD);
	});
});

describe('POST /api/byl/connections/{id}/mailbox/import', () => {
	it('takes chosen mails without keyword for the owner, once, and leaves the mailbox as it was', async () => {
		const plain = mail('Ohne Stichwort');
		const matched = mail('Todo: Gewählt');
		const answer = await importFromMailbox(owner.pb, mailbox.id, [plain, matched]);
		expect(answer).toEqual({
			kind: 'ok',
			value: [
				{ uid: plain, status: 'created', message: '' },
				{ uid: matched, status: 'created', message: '' }
			]
		});
		const items = await owner.pb.collection('inbox_items').getFullList({
			filter: `connection = "${mailbox.id}"`,
			sort: 'created'
		});
		expect(items.map((item) => [item.title, item.source_meta.keyword ?? ''])).toEqual([
			['Ohne Stichwort', ''],
			['Todo: Gewählt', 'todo']
		]);
		expect(items[0].original).toMatch(/\.eml$/);
		const again = await importFromMailbox(owner.pb, mailbox.id, [plain]);
		expect(again.value).toEqual([{ uid: plain, status: 'duplicate', message: 'Schon im Eingang.' }]);
		const listed = await listMailbox(owner.pb, mailbox.id, 50);
		expect(listed.value.find((item) => item.uid === plain).state).toBe('new');
		expect(imap.writes()).toEqual([]);
		expect(imap.flagsUnchanged()).toBe(true);
	});

	it('refuses foreign connections and invalid choices', async () => {
		await expect(importFromMailbox(other.pb, mailbox.id, [1])).rejects.toMatchObject({ kind: 'not_found' });
		const tooMany = await fetch(`${instance.url}/api/byl/connections/${mailbox.id}/mailbox/import`, {
			method: 'POST',
			headers: { Authorization: owner.pb.authStore.token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ uids: Array.from({ length: 51 }, (_, i) => i + 1) })
		});
		expect(tooMany.status).toBe(400);
		expect((await importFromMailbox(owner.pb, mailbox.id, [0])).kind).toBe('failed');
	});
});

describe('mail helper stopped, restarted or with another token', () => {
	it('answers with the hint while the helper is stopped and works again after a restart', async () => {
		await stopHelper();
		expect(await listMailbox(owner.pb, mailbox.id, 50)).toEqual({
			kind: 'unavailable',
			message: 'Der Mail-Hilfsprozess läuft nicht (byl-mail.exe fehlt oder ist beendet).',
			hint: expect.stringMatching(/start\.bat/)
		});
		expect((await importFromMailbox(owner.pb, mailbox.id, [1])).kind).toBe('unavailable');
		await startHelper();
		expect((await listMailbox(owner.pb, mailbox.id, 50)).kind).toBe('ok');
	});

	it('explains a helper that has another token', async () => {
		await stopHelper();
		await startHelper('ein-anderer-token');
		const answer = await listMailbox(owner.pb, mailbox.id, 50);
		expect(answer).toMatchObject({ kind: 'unavailable', message: expect.stringMatching(/BYL_INGEST_TOKEN/) });
		await stopHelper();
		await startHelper();
	});

	it('never sends anything but ID and limit to the helper and never shows the token', async () => {
		await stopHelper();
		const received = [];
		const spy = createServer((request, response) => {
			let body = '';
			request.on('data', (chunk) => (body += chunk));
			request.on('end', () => {
				received.push({ url: request.url, auth: request.headers.authorization, body: JSON.parse(body) });
				response.writeHead(200, { 'Content-Type': 'application/json' });
				response.end('{"items":[]}');
			});
		});
		await new Promise((resolve) => spy.listen(port, '127.0.0.1', resolve));
		try {
			await listMailbox(owner.pb, mailbox.id, 20);
		} finally {
			await new Promise((resolve) => spy.close(resolve));
		}
		expect(received).toEqual([
			{ url: '/mailbox/list', auth: `Bearer ${TOKEN}`, body: { connection: mailbox.id, limit: 20 } }
		]);
		await startHelper();
		const everything = [
			JSON.stringify(await superuser.send('/api/logs', { query: { perPage: 500 } })),
			instance.output(),
			lines.join('\n')
		].join('\n');
		expect(everything).not.toContain(TOKEN);
		expect(everything).not.toContain(PASSWORD);
	});
});
