// Ingest interface of the mail helper (ADR-0016 section 5, ADR-0018 section 8; E4 plan package 22)
// against an own disposable instance whose process environment holds an invented token and an
// invented mailbox password. Without BYL_INGEST_TOKEN (the shared instance of the test run) the
// routes do not exist. Neither value may appear in a response, a record, the log or the console.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pocketBaseUrl } from '../support/api.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { createConnection, listConnections } from '../../web/src/lib/data/connections.ts';

const TOKEN = randomBytes(24).toString('base64');
const PASSWORD = `pw-${randomBytes(12).toString('hex')}`;
const ENV = { BYL_INGEST_TOKEN: TOKEN, BYL_TEST_MAIL_PASSWORD: PASSWORD };

let instance;
let superuser;
let owner;
let other;
let mailbox;

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

function mail(who, data = {}) {
	return who.pb.collection('connections').create({
		owner: who.id,
		type: 'mail',
		label: 'Web.de',
		enabled: true,
		secret_env: 'BYL_TEST_MAIL_PASSWORD',
		settings: { provider: 'webde', user: 'anna@web.de', keywords: ['todo', 'rechnung'] },
		...data
	});
}

async function call(path, { method = 'GET', token = TOKEN, json, form, base = instance.url } = {}) {
	const headers = {};
	if (token !== null) headers.Authorization = `Bearer ${token}`;
	let body;
	if (json !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify(json);
	} else if (form !== undefined) {
		body = form;
	}
	const response = await fetch(`${base}${path}`, { method, headers, body });
	const text = await response.text();
	return { status: response.status, text, json: text === '' ? null : JSON.parse(text) };
}

const unique = () => randomBytes(6).toString('hex');

function draft(connection, extra = {}) {
	return {
		connection: connection.id,
		origin: 'auto',
		title: `Todo: Steuer ${unique()}`,
		body: 'Bitte erledigen.',
		source_ref: `<${unique()}@example.com>`,
		source_date: '2026-09-25 08:00:00.000Z',
		source_meta: { from: 'Bert <bert@example.com>', attachments: 1 },
		...extra
	};
}

function expectNoValues(text) {
	expect(text).not.toContain(TOKEN);
	expect(text).not.toContain(PASSWORD);
}

beforeAll(async () => {
	instance = await startPocketBase({ env: ENV });
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await user();
	other = await user();
	mailbox = await mail(owner);
}, 60_000);

afterAll(async () => {
	await instance?.stop();
});

describe('ingest route: token (ADR-0018 section 8)', () => {
	it('does not exist without BYL_INGEST_TOKEN', async () => {
		for (const [method, path] of [
			['GET', '/api/byl/ingest/connections'],
			['POST', '/api/byl/ingest/items'],
			['POST', '/api/byl/ingest/connections/abcdefghij12345/status']
		]) {
			const answer = await call(path, { method, base: pocketBaseUrl(), json: method === 'POST' ? {} : undefined });
			expect(answer.status, path).toBe(404);
		}
	});

	it('refuses a missing or wrong token', async () => {
		for (const token of [null, '', `${TOKEN}x`, TOKEN.slice(0, -1), TOKEN.toLowerCase()]) {
			expect((await call('/api/byl/ingest/connections', { token })).status).toBe(401);
			expect((await call('/api/byl/ingest/items', { method: 'POST', token, json: draft(mailbox) })).status).toBe(401);
			expect(
				(await call(`/api/byl/ingest/connections/${mailbox.id}/status`, { method: 'POST', token, json: {} })).status
			).toBe(401);
		}
		const answer = await fetch(`${instance.url}/api/byl/ingest/connections`, {
			headers: { Authorization: `Basic ${TOKEN}` }
		});
		expect(answer.status).toBe(401);
	});
});

describe('ingest route: connections', () => {
	it('lists switched-on mail connections of every user without owner and secrets', async () => {
		const second = await mail(other, { label: 'Zweites Postfach', settings: { provider: 'webde', user: 'bert@web.de' } });
		const off = await mail(owner, { label: 'Aus', enabled: false });
		const calendar = await owner.pb.collection('connections').create({
			owner: owner.id,
			type: 'calendar',
			label: 'Kalender',
			enabled: true,
			secret_env: 'BYL_TEST_MAIL_PASSWORD'
		});
		const answer = await call('/api/byl/ingest/connections');
		expect(answer.status).toBe(200);
		const ids = answer.json.items.map((item) => item.id);
		expect(ids).toContain(mailbox.id);
		expect(ids).toContain(second.id);
		expect(ids).not.toContain(off.id);
		expect(ids).not.toContain(calendar.id);
		expect(answer.json.items.find((item) => item.id === mailbox.id)).toEqual({
			id: mailbox.id,
			label: 'Web.de',
			provider: 'webde',
			user: 'anna@web.de',
			secret_env: 'BYL_TEST_MAIL_PASSWORD',
			keywords: ['todo', 'rechnung'],
			match_body: false,
			cursor: ''
		});
		expect(answer.text).not.toContain(owner.id);
		expectNoValues(answer.text);
		await superuser.collection('connections').delete(second.id);
		await superuser.collection('connections').delete(off.id);
		await superuser.collection('connections').delete(calendar.id);
	});
});

describe('ingest route: items (ADR-0016 section 5, ADR-0020)', () => {
	const items = (who, filter) =>
		who.pb.collection('inbox_items').getFullList({ filter: `connection = "${mailbox.id}"${filter ? ` && ${filter}` : ''}` });

	it('creates a fetched mail with a keyword for the owner of the connection', async () => {
		const sent = draft(mailbox, { source_meta: { from: 'Bert <bert@example.com>', keyword: 'erfunden', owner: 'x' } });
		const answer = await call('/api/byl/ingest/items', { method: 'POST', json: sent });
		expect(answer.status).toBe(200);
		expect(answer.json).toEqual({ status: 'created', item: expect.any(String) });
		const item = await owner.pb.collection('inbox_items').getOne(answer.json.item);
		expect(item).toMatchObject({
			owner: owner.id,
			household: '',
			channel: 'mail',
			kind: 'mail',
			state: 'new',
			title: sent.title,
			body: 'Bitte erledigen.',
			source_ref: sent.source_ref,
			connection: mailbox.id,
			source_meta: { from: 'Bert <bert@example.com>', keyword: 'todo' }
		});
		expect(await other.pb.collection('inbox_items').getList(1, 1, { filter: `id = "${item.id}"` })).toMatchObject({
			totalItems: 0
		});
	});

	it('refuses a fetched mail without keyword and saves nothing', async () => {
		const before = (await items(owner)).length;
		const answer = await call('/api/byl/ingest/items', {
			method: 'POST',
			json: draft(mailbox, { title: `Hallo ${unique()}`, body: 'Die Rechnung liegt bei.' })
		});
		expect(answer.status).toBe(422);
		expect(answer.json).toEqual({ status: 'unmatched', message: 'Kein Stichwort erkannt – nicht gespeichert.' });
		expect(await items(owner)).toHaveLength(before);
	});

	it('searches the start of the text with match_body', async () => {
		const withBody = await mail(owner, {
			label: 'Mit Text',
			settings: { provider: 'webde', user: 'text@web.de', keywords: ['rechnung'], match_body: true }
		});
		const answer = await call('/api/byl/ingest/items', {
			method: 'POST',
			json: draft(withBody, { title: `Hallo ${unique()}`, body: 'Die Rechnung liegt bei.' })
		});
		expect(answer.json.status).toBe('created');
		const item = await owner.pb.collection('inbox_items').getOne(answer.json.item);
		expect(item.source_meta.keyword).toBe('rechnung');
		await superuser.collection('connections').delete(withBody.id);
	});

	it('takes a selected mail without keyword', async () => {
		const answer = await call('/api/byl/ingest/items', {
			method: 'POST',
			json: draft(mailbox, { origin: 'selected', title: `Alte Mail ${unique()}` })
		});
		expect(answer.json.status).toBe('created');
		const item = await owner.pb.collection('inbox_items').getOne(answer.json.item);
		expect(item.source_meta).toEqual({ from: 'Bert <bert@example.com>', attachments: 1 });
	});

	it('counts the same mail again as duplicate, also as .eml of the owner', async () => {
		const sent = draft(mailbox);
		const first = await call('/api/byl/ingest/items', { method: 'POST', json: sent });
		const again = await call('/api/byl/ingest/items', { method: 'POST', json: { ...sent, origin: 'selected' } });
		expect(again.json).toEqual({ status: 'duplicate', item: first.json.item, state: 'new' });
		await owner.pb.collection('inbox_items').update(first.json.item, { state: 'discarded' });
		const discarded = await call('/api/byl/ingest/items', { method: 'POST', json: sent });
		expect(discarded.json).toEqual({ status: 'duplicate', item: first.json.item, state: 'discarded' });

		const eml = draft(mailbox);
		const file = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'eml',
			kind: 'mail',
			title: eml.title,
			source_ref: eml.source_ref
		});
		expect((await call('/api/byl/ingest/items', { method: 'POST', json: eml })).json).toEqual({
			status: 'duplicate',
			item: file.id,
			state: 'new'
		});
	});

	it('keeps the original mail of a multipart request as protected file', async () => {
		const sent = draft(mailbox);
		const raw = `Subject: ${sent.title}\r\nMessage-ID: ${sent.source_ref}\r\n\r\nBitte erledigen.\r\n`;
		const form = new FormData();
		form.set('draft', JSON.stringify(sent));
		form.set('original', new Blob([raw], { type: 'message/rfc822' }), 'mail.eml');
		const answer = await call('/api/byl/ingest/items', { method: 'POST', form });
		expect(answer.status).toBe(200);
		const item = await owner.pb.collection('inbox_items').getOne(answer.json.item);
		expect(item.original).toMatch(/^mail_\w+\.eml$/);
		const token = await owner.pb.files.getToken();
		const download = await fetch(owner.pb.files.getURL(item, item.original, { token }));
		expect(await download.text()).toBe(raw);
		expect((await fetch(owner.pb.files.getURL(item, item.original))).status).not.toBe(200);
	});

	it('creates only for switched-on mail connections', async () => {
		const off = await mail(owner, { label: 'Aus', enabled: false });
		const calendar = await owner.pb.collection('connections').create({
			owner: owner.id,
			type: 'calendar',
			label: 'Kalender',
			enabled: true,
			secret_env: 'BYL_TEST_MAIL_PASSWORD'
		});
		for (const connection of [off, calendar, { id: 'abcdefghij12345' }]) {
			const answer = await call('/api/byl/ingest/items', { method: 'POST', json: draft(connection) });
			expect(answer.status).toBe(404);
		}
		await superuser.collection('connections').delete(off.id);
		await superuser.collection('connections').delete(calendar.id);
	});

	it.each([
		['no connection', { connection: '' }],
		['an unknown origin', { origin: 'manual' }],
		['no title', { title: '' }],
		['a list as source_meta', { source_meta: [] }]
	])('refuses a draft with %s', async (name, extra) => {
		const answer = await call('/api/byl/ingest/items', { method: 'POST', json: draft(mailbox, extra) });
		expect(answer.status).toBe(400);
	});
});

describe('ingest route: status of a run', () => {
	it('stores time, cursor, hint and the cleaned error', async () => {
		const ok = await call(`/api/byl/ingest/connections/${mailbox.id}/status`, {
			method: 'POST',
			json: { cursor: '1700000000:42', hint: 'Erster Abruf: ältere Mails bleiben im Postfach.' }
		});
		expect(ok.json).toEqual({ status: 'ok' });
		let record = await owner.pb.collection('connections').getOne(mailbox.id);
		expect(record).toMatchObject({
			cursor: '1700000000:42',
			last_error: '',
			last_hint: 'Erster Abruf: ältere Mails bleiben im Postfach.'
		});
		expect(record.last_run_at).not.toBe('');
		expect(record.last_ok_at).toBe(record.last_run_at);

		const failed = await call(`/api/byl/ingest/connections/${mailbox.id}/status`, {
			method: 'POST',
			json: { error: `Anmeldung abgelehnt für anna@web.de mit ${PASSWORD} (Token ${TOKEN}) an imaps://imap.web.de:993/INBOX?x=1` }
		});
		expect(failed.status).toBe(200);
		record = await owner.pb.collection('connections').getOne(mailbox.id);
		expect(record.last_error).toBe('Anmeldung abgelehnt für anna@web.de mit *** (Token ***) an imaps://imap.web.de:993');
		expect(record.cursor).toBe('1700000000:42');
		expect(record.last_ok_at).not.toBe(record.last_run_at);
		expectNoValues(JSON.stringify(record));
	});

	it('refuses an invalid cursor and anything but a mail connection', async () => {
		expect(
			(await call(`/api/byl/ingest/connections/${mailbox.id}/status`, { method: 'POST', json: { cursor: '42' } })).status
		).toBe(400);
		const calendar = await owner.pb.collection('connections').create({
			owner: owner.id,
			type: 'calendar',
			label: 'Kalender',
			enabled: true,
			secret_env: 'BYL_TEST_MAIL_PASSWORD'
		});
		expect((await call(`/api/byl/ingest/connections/${calendar.id}/status`, { method: 'POST', json: {} })).status).toBe(404);
		await superuser.collection('connections').delete(calendar.id);
	});

	it('keeps the fields that only the server writes away from the client', async () => {
		await expect(owner.pb.collection('connections').update(mailbox.id, { cursor: '1:1' })).rejects.toMatchObject({
			status: 400
		});
	});
});

describe('mail connections of the web app (package 22)', () => {
	it('creates a mailbox with provider and user and refuses a bad user name', async () => {
		const created = await createConnection(owner.pb, {
			type: 'mail',
			label: 'Web.de',
			secretEnv: 'BYL_TEST_MAIL_PASSWORD',
			allowlistEnv: '',
			mailProvider: 'webde',
			mailUser: ' anna@web.de '
		});
		expect(created).toMatchObject({ type: 'mail', mailProvider: 'webde', mailUser: 'anna@web.de', matchBody: false });
		expect((await listConnections(owner.pb)).map((item) => item.id)).toContain(created.id);
		await expect(
			owner.pb.collection('connections').create({
				owner: owner.id,
				type: 'mail',
				label: 'x',
				enabled: true,
				secret_env: 'BYL_TEST_MAIL_PASSWORD',
				settings: { provider: 'webde', user: 'a b' }
			})
		).rejects.toMatchObject({ status: 400, response: { data: { settings: { code: 'validation_mail_user' } } } });
		await superuser.collection('connections').delete(created.id);
	});

	it('starts the cursor over when the mailbox changes', async () => {
		const box = await mail(owner, { label: 'Wechsel' });
		await call(`/api/byl/ingest/connections/${box.id}/status`, { method: 'POST', json: { cursor: '7:9', hint: 'x' } });
		await owner.pb.collection('connections').update(box.id, {
			settings: { provider: 'webde', user: 'anna@web.de', keywords: ['neu'], match_body: true }
		});
		expect((await owner.pb.collection('connections').getOne(box.id)).cursor).toBe('7:9');
		await owner.pb.collection('connections').update(box.id, { settings: { provider: 'webde', user: 'bert@web.de' } });
		expect(await owner.pb.collection('connections').getOne(box.id)).toMatchObject({ cursor: '', last_hint: '' });
		await superuser.collection('connections').delete(box.id);
	});

	it('never shows the token or the password in the log or the console', async () => {
		expectNoValues(JSON.stringify(await superuser.send('/api/logs', { query: { perPage: 500 } })));
		expectNoValues(instance.output());
	});
});
