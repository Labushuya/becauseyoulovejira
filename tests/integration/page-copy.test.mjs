// "Seiteninhalt sichern" (ADR-0031 section 6) against a local fake web server: the route keeps the
// text of a page below the excerpt and the HTML as protected original, once; it cuts pages over
// 2 MB, reads Latin-1, refuses anything but HTML and failed answers, and never fetches private,
// loopback, link-local or metadata addresses. The disposable instance allows 127.0.0.1 only on
// the port of the fake server (BYL_TEST_PAGE_PORT, set for this instance alone).

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { savePage as savePageOf } from '../../web/src/lib/data/inbox.ts';

const PAGE = [
	'<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rezept &amp; Tipps</title>',
	'<style>body { color: red }</style><script>document.write("böse")</script></head>',
	'<body><h1>Apfelkuchen</h1><p>Zutaten für 4 Personen:</p><ul><li>Äpfel</li><li>Mehl</li></ul>',
	'<p><a href="https://example.com/mehr">Mehr Rezepte</a> <img src="https://tracker.example/x.gif"></p>',
	'<iframe src="https://ads.example/"></iframe></body></html>'
].join('');

let instance;
let web;
let port;
let who;
let other;
let anonymous;
/** Requests the fake server got, as "METHOD path". */
const requests = [];

function listen(handler) {
	return new Promise((resolve) => {
		const server = createServer(handler);
		server.listen(0, '127.0.0.1', () => resolve(server));
	});
}

function serve(request, response) {
	requests.push(`${request.method} ${request.url}`);
	const path = new URL(request.url, 'http://127.0.0.1').pathname;
	switch (path) {
		case '/rezept':
			response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			response.end(PAGE);
			return;
		case '/latin1':
			// "Grüße" and "Schöne Grüße ½" in ISO-8859-1 bytes.
			response.writeHead(200, { 'Content-Type': 'text/html; charset=ISO-8859-1' });
			response.end(Buffer.from('<title>Grüße</title><p>Schöne Grüße ½</p>', 'latin1'));
			return;
		case '/meta-latin1':
			// Windows-1252 named in a <meta>: 0xC4 "Ä", 0x96 "–", 0x80 "€".
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end(
				Buffer.concat([
					Buffer.from('<meta charset="windows-1252"><p>', 'latin1'),
					Buffer.from([0xc4, 0x72, 0x67, 0x65, 0x72, 0x20, 0x96, 0x20, 0x80]),
					Buffer.from('</p>', 'latin1')
				])
			);
			return;
		case '/gross': {
			response.writeHead(200, { 'Content-Type': 'text/html' });
			response.end(`<p>Anfang</p>${'<p>Füllung</p>'.repeat(250_000)}`);
			return;
		}
		case '/teil':
			response.writeHead(206, { 'Content-Type': 'text/html', 'Content-Range': 'bytes 0-15/99999999' });
			response.end('<p>Nur Anfang</p>');
			return;
		case '/pdf':
			response.writeHead(200, { 'Content-Type': 'application/pdf' });
			response.end('%PDF-1.7');
			return;
		case '/leer':
			response.writeHead(200, { 'Content-Type': 'application/xhtml+xml' });
			response.end('<html><body><script>nur Skript</script></body></html>');
			return;
		default:
			response.writeHead(404, { 'Content-Type': 'text/html' });
			response.end('<p>Nicht gefunden</p>');
	}
}

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function user(superuser) {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return { id: record.id, pb };
}

let counter = 0;
function link(owner, url, data = {}) {
	counter += 1;
	return owner.pb.collection('inbox_items').create({
		owner: owner.id,
		channel: 'link',
		kind: 'link',
		title: `Link ${counter}`,
		source_url: url,
		body: '> Ausgewählter Auszug',
		...data
	});
}

async function savePage(owner, id) {
	const response = await fetch(`${instance.url}/api/byl/inbox/${id}/page`, {
		method: 'POST',
		headers: owner ? { Authorization: owner.pb.authStore.token } : {}
	});
	return { status: response.status, json: await response.json() };
}

const local = (path) => `http://127.0.0.1:${port}${path}?n=${randomBytes(4).toString('hex')}`;

beforeAll(async () => {
	web = await listen(serve);
	port = web.address().port;
	instance = await startPocketBase({ env: { BYL_TEST_PAGE_PORT: String(port) } });
	const superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	who = await user(superuser);
	other = await user(superuser);
	anonymous = null;
}, 60_000);

afterAll(async () => {
	await instance?.stop();
	await new Promise((resolve) => web?.close(resolve));
});

describe('page copy (ADR-0031 section 6)', () => {
	it('keeps the text below the excerpt and the HTML as protected original, once', async () => {
		const item = await link(who, local('/rezept'));
		const saved = await savePage(who, item.id);
		expect(saved).toEqual({ status: 200, json: { title: 'Rezept & Tipps', size: Buffer.byteLength(PAGE), truncated: false } });
		expect(requests.at(-1)).toMatch(/^GET \/rezept\?n=/);

		const after = await who.pb.collection('inbox_items').getOne(item.id);
		expect(after.body).toBe(
			'> Ausgewählter Auszug\n\n---\n\nApfelkuchen\n\nZutaten für 4 Personen:\n\n- Äpfel\n- Mehl\n\nMehr Rezepte (https://example.com/mehr)'
		);
		expect(after.body).not.toMatch(/böse|color|tracker|ads\.example/);
		expect(after.source_meta.page).toMatchObject({
			size: Buffer.byteLength(PAGE),
			truncated: false,
			charset: 'utf-8',
			title: 'Rezept & Tipps'
		});
		expect(after.original).toMatch(/^seite_\w+\.html$/);
		const url = `${instance.url}/api/files/inbox_items/${item.id}/${after.original}`;
		expect((await fetch(url)).status).toBe(404);
		const token = await who.pb.files.getToken();
		expect(await (await fetch(`${url}?token=${encodeURIComponent(token)}`)).text()).toBe(PAGE);

		const count = requests.length;
		expect(await savePage(who, item.id)).toEqual({ status: 409, json: { message: 'Die Seite ist schon gesichert.' } });
		expect(requests).toHaveLength(count);
	});

	it('reads Latin-1 and Windows-1252 pages', async () => {
		const latin = await link(who, local('/latin1'), { body: '' });
		expect((await savePage(who, latin.id)).status).toBe(200);
		const first = await who.pb.collection('inbox_items').getOne(latin.id);
		expect(first.body).toBe('Schöne Grüße ½');
		expect(first.source_meta.page).toMatchObject({ charset: 'iso-8859-1', title: 'Grüße' });

		const meta = await link(who, local('/meta-latin1'), { body: '' });
		expect((await savePage(who, meta.id)).status).toBe(200);
		expect((await who.pb.collection('inbox_items').getOne(meta.id)).body).toBe('Ärger – €');
	});

	it('cuts a page over 2 MB, takes a partial answer and notes a page without text', async () => {
		const big = await link(who, local('/gross'));
		const saved = await savePage(who, big.id);
		expect(saved.status).toBe(200);
		expect(saved.json.truncated).toBe(true);
		const item = await who.pb.collection('inbox_items').getOne(big.id);
		expect(item.body.length).toBeLessThanOrEqual(100_000);
		const token = await who.pb.files.getToken();
		const file = await fetch(`${instance.url}/api/files/inbox_items/${big.id}/${item.original}?token=${encodeURIComponent(token)}`);
		expect((await file.arrayBuffer()).byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);

		const partial = await link(who, local('/teil'), { body: '' });
		expect((await savePage(who, partial.id)).status).toBe(200);
		expect((await who.pb.collection('inbox_items').getOne(partial.id)).body).toBe('Nur Anfang');

		const empty = await link(who, local('/leer'), { body: '' });
		expect((await savePage(who, empty.id)).status).toBe(200);
		expect((await who.pb.collection('inbox_items').getOne(empty.id)).body).toBe(
			'(Die Seite enthält keinen lesbaren Text.)'
		);
	});

	it('refuses anything but HTML and failed answers, and keeps the item as it was', async () => {
		const pdf = await link(who, local('/pdf'));
		expect(await savePage(who, pdf.id)).toEqual({ status: 415, json: { message: 'Nur HTML-Seiten lassen sich sichern.' } });
		const missing = await link(who, local('/weg'));
		expect(await savePage(who, missing.id)).toEqual({ status: 502, json: { message: 'Die Seite antwortet mit HTTP 404.' } });
		for (const id of [pdf.id, missing.id]) {
			const item = await who.pb.collection('inbox_items').getOne(id);
			expect(item.original).toBe('');
			expect(item.body).toBe('> Ausgewählter Auszug');
		}
	});

	it.each([
		'http://127.0.0.1/',
		'http://127.0.0.1:8090/api/health',
		'http://localhost/',
		'http://10.0.0.1/',
		'http://192.168.178.1/',
		'http://169.254.169.254/latest/meta-data/',
		'http://[::1]/',
		'http://[::ffff:127.0.0.1]/',
		'http://0x7f000001/',
		'http://2130706433/',
		'http://127.0.0.1.nip.io/',
		'http://metadata.google.internal/',
		'http://drucker/',
		'https://anna:geheim@example.com/',
		'http://example.com:22/'
	])('never fetches %s', async (url) => {
		const item = await link(who, url);
		const count = requests.length;
		const saved = await savePage(who, item.id);
		expect(saved.status).toBe(400);
		expect(saved.json.message).toMatch(/nicht abgerufen|Nur die Ports/);
		expect(requests).toHaveLength(count);
		expect((await who.pb.collection('inbox_items').getOne(item.id)).original).toBe('');
	});

	it('gives the data layer of the SPA a saved copy or the refusal with its reason', async () => {
		const item = await link(who, local('/rezept'));
		expect(await savePageOf(who.pb, item.id)).toEqual({
			kind: 'saved',
			title: 'Rezept & Tipps',
			size: Buffer.byteLength(PAGE),
			truncated: false
		});
		expect(await savePageOf(who.pb, item.id)).toEqual({
			kind: 'refused',
			message: 'Die Seite ist schon gesichert.'
		});
		const blocked = await link(who, 'http://10.0.0.2/');
		expect(await savePageOf(who.pb, blocked.id)).toEqual({
			kind: 'refused',
			message: 'Lokale, private und interne Adressen werden nicht abgerufen.'
		});
		await expect(savePageOf(other.pb, item.id)).rejects.toMatchObject({ kind: 'not_found' });
	});

	it('answers only for own web links of a signed-in user', async () => {
		const item = await link(who, local('/rezept'));
		const count = requests.length;
		expect((await savePage(anonymous, item.id)).status).toBe(401);
		expect(await savePage(other, item.id)).toEqual({ status: 404, json: { message: 'Eintrag nicht gefunden.' } });
		expect((await savePage(who, 'abcdefghijklmno')).status).toBe(404);
		const note = await who.pb.collection('inbox_items').create({ owner: who.id, channel: 'manual', kind: 'todo', title: 'Notiz' });
		expect(await savePage(who, note.id)).toEqual({
			status: 400,
			json: { message: 'Nur Web-Links mit Adresse haben eine Seite zum Sichern.' }
		});
		expect(requests).toHaveLength(count);
	});
});
