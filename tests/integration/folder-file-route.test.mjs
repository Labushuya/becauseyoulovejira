// Security of "Ansehen" of a file of a watched folder (ADR-0051 §6) against a disposable instance and
// folders in a temp folder of the test: the route shows the current file only to the owner of the
// instance, only from this machine and from the app itself (ADR-0043 §4), only with a file token,
// and only files inside a configured folder, watched by it, reached without links. Every refusal
// on its own: traversal with "..", foreign absolute paths, aliases (trailing dot, stream, device
// name), a junction or symlink out of the folder, excluded files, a folder no longer configured, a
// foreign user, no session, a foreign Host, Origin or proxy. The answers set the type safely: PDF
// and images inline, text as plain text in a sandbox, HTML and SVG only as download. Refusals are
// logged without a path.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writtenLogs } from '../support/logs.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';

const WINDOWS = process.platform === 'win32';
const PDF = Buffer.from('%PDF-1.4\n% Prüfung\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

let base;
let watched;
let outside;
let instance;
let superuser;
let owner;
let other;
let conn;
let fileLink = false;
const items = {};

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function user() {
	const email = `ansehen-${randomBytes(8).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return { id: record.id, pb, token: () => pb.authStore.token };
}

/** One request on a new connection; the body as Buffer, as JSON when it is JSON. */
function send(path, { token, headers = {} } = {}) {
	const url = new URL(instance.url);
	return new Promise((done, fail) => {
		const req = request(
			{
				host: '127.0.0.1',
				port: Number(url.port),
				path,
				method: 'GET',
				agent: false,
				timeout: scaled(15_000),
				headers: { ...(token ? { Authorization: token } : {}), ...headers }
			},
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('end', () => {
					const raw = Buffer.concat(chunks);
					let json = null;
					try {
						json = JSON.parse(raw.toString('utf8'));
					} catch {
						// a file
					}
					done({ status: response.statusCode, raw, json, headers: response.headers });
				});
			}
		);
		req.once('timeout', () => req.destroy(new Error(`timeout ${path}`)));
		req.once('error', fail);
		req.end();
	});
}

/** "Ansehen" of the app: ask with the session, then open the address like a link of the app. */
async function view(who, item, { download = false, headers = {} } = {}) {
	const info = await send(`/api/byl/folders/items/${item.id}`, { token: who.token(), headers: { 'Sec-Fetch-Site': 'same-origin', ...headers } });
	if (info.status !== 200) return { info, file: null };
	const file = await send(`${info.json.url}${download ? '&download=1' : ''}`, { headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate', ...headers } });
	return { info, file };
}

/** An entry of a client with any path (a tampered or foreign reference). */
function crafted(who, ref) {
	return who.pb.collection('inbox_items').create({
		owner: who.id,
		channel: 'folder',
		kind: 'file',
		title: 'Untergeschoben',
		source_ref: ref,
		source_meta: { folder: { version: `v-${randomBytes(4).toString('hex')}` } }
	});
}

const run = (who, connection) => fetch(`${instance.url}/api/byl/connections/${connection.id}/run`, { method: 'POST', headers: { Authorization: who.token() } });

beforeAll(async () => {
	base = realpathSync.native(mkdtempSync(join(tmpdir(), 'byl-ordner-route-')));
	watched = join(base, 'beobachtet');
	outside = join(base, 'draussen');
	mkdirSync(join(watched, 'unter'), { recursive: true });
	mkdirSync(outside);
	writeFileSync(join(outside, 'geheim.txt'), 'geheim\n');
	symlinkSync(outside, join(watched, 'verknuepfung'), 'junction');
	try {
		symlinkSync(join(outside, 'geheim.txt'), join(watched, 'link.txt'), 'file');
		fileLink = true;
	} catch {
		// Symlinks of files need a right under Windows; the junction covers the case there.
	}
	instance = await startPocketBase();
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	// The account created first becomes the administrator of the app (ADR-0056 §2).
	owner = await user();
	other = await user();
	conn = await superuser.collection('connections').create({
		owner: owner.id,
		type: 'folder',
		label: 'Ordner',
		enabled: true,
		secret_env: '',
		settings: { folders: [{ path: watched }] }
	});
	await run(owner, conn);
	writeFileSync(join(watched, 'bericht.pdf'), PDF);
	writeFileSync(join(watched, 'notiz.txt'), 'Grüße\n');
	writeFileSync(join(watched, 'bild.png'), PNG);
	writeFileSync(join(watched, 'seite.html'), '<script>alert(1)</script>');
	writeFileSync(join(watched, 'grafik.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
	writeFileSync(join(watched, 'unter', 'tief.txt'), 'tief\n');
	await run(owner, conn);
	const list = await owner.pb.collection('inbox_items').getFullList({ filter: owner.pb.filter('connection = {:id}', { id: conn.id }) });
	for (const item of list) items[item.source_meta.folder.path] = item;
});

afterAll(async () => {
	await instance?.stop();
	if (base) rmSync(base, { recursive: true, force: true });
});

describe('showing the current file', () => {
	it('shows a PDF inline with safe headers and the bytes of the file as it is now', async () => {
		const { info, file } = await view(owner, items['bericht.pdf']);
		expect(info.json).toMatchObject({ status: 'ok', name: 'bericht.pdf', path: 'bericht.pdf', folder: 'beobachtet', size: PDF.length, inline: true });
		expect(info.json.url).toMatch(/^\/api\/byl\/folders\/items\/[a-z0-9]{15}\/file\?token=/);
		expect(file.status).toBe(200);
		expect(file.headers).toMatchObject({
			'content-type': 'application/pdf',
			'x-content-type-options': 'nosniff',
			'cache-control': 'no-store',
			'cross-origin-resource-policy': 'same-origin',
			'referrer-policy': 'no-referrer'
		});
		expect(file.headers['content-disposition']).toBe(`inline; filename="bericht.pdf"; filename*=UTF-8''bericht.pdf`);
		expect(file.raw.equals(PDF)).toBe(true);
		// Changed on the disk: the next view shows the new content, no copy of before.
		const next = Buffer.concat([PDF, Buffer.from('% Nachtrag\n')]);
		writeFileSync(join(watched, 'bericht.pdf'), next);
		expect((await view(owner, items['bericht.pdf'])).file.raw.equals(next)).toBe(true);
		// The whole file, also when the browser asks for a part.
		const part = await view(owner, items['bericht.pdf'], { headers: { Range: 'bytes=0-3' } });
		expect([part.file.status, part.file.raw.length]).toEqual([200, next.length]);
	});

	it('shows text as plain text in a sandbox and images inline; HTML and SVG only as download', async () => {
		const text = (await view(owner, items['notiz.txt'])).file;
		expect(text.headers['content-type']).toBe('text/plain; charset=utf-8');
		expect(text.headers['content-security-policy']).toMatch(/sandbox/);
		expect(text.raw.toString('utf8')).toBe('Grüße\n');
		const image = (await view(owner, items['bild.png'])).file;
		expect([image.headers['content-type'], image.headers['content-disposition'].split(';')[0]]).toEqual(['image/png', 'inline']);
		for (const name of ['seite.html', 'grafik.svg']) {
			const { info, file } = await view(owner, items[name]);
			expect(info.json.inline, name).toBe(false);
			expect(file.headers['content-type'], name).toBe('application/octet-stream');
			expect(file.headers['content-disposition'], name).toMatch(/^attachment; /);
			expect(file.headers['content-security-policy'], name).toMatch(/sandbox/);
		}
		const download = (await view(owner, items['bericht.pdf'], { download: true })).file;
		expect(download.headers['content-disposition']).toMatch(/^attachment; filename="bericht.pdf"/);
	});

	it('says clearly when the file is gone', async () => {
		writeFileSync(join(watched, 'weg.txt'), 'gleich weg');
		await run(owner, conn);
		const [item] = await owner.pb.collection('inbox_items').getFullList({ filter: owner.pb.filter('source_ref = {:ref}', { ref: join(watched, 'weg.txt') }) });
		const { info, file } = await view(owner, item);
		expect(file.status).toBe(200);
		unlinkSync(join(watched, 'weg.txt'));
		const later = await send(`/api/byl/folders/items/${item.id}`, { token: owner.token() });
		expect([later.status, later.json.reason, later.json.message]).toEqual([404, 'missing', 'Die Datei ist nicht mehr vorhanden.']);
		const stale = await send(info.json.url);
		expect([stale.status, stale.json.reason]).toEqual([404, 'missing']);
	});
});

describe('only files inside a configured folder', () => {
	const refusal = async (ref) => {
		const item = await crafted(owner, ref);
		const info = await send(`/api/byl/folders/items/${item.id}`, { token: owner.token() });
		return [info.status, info.json?.reason];
	};

	it('refuses traversal with "..", foreign absolute paths and aliases', async () => {
		expect(await refusal(`${watched}${sep}..${sep}draussen${sep}geheim.txt`)).toEqual([400, 'path']);
		expect(await refusal(`${watched}${sep}unter${sep}..${sep}..${sep}draussen${sep}geheim.txt`)).toEqual([400, 'path']);
		expect(await refusal(join(outside, 'geheim.txt'))).toEqual([403, 'folder']);
		expect(await refusal(`${watched}-zwilling${sep}notiz.txt`)).toEqual([403, 'folder']);
		expect(await refusal(watched)).toEqual([403, 'folder']);
		if (WINDOWS) {
			expect(await refusal(`${watched}\\notiz.txt.`)).toEqual([400, 'path']);
			expect(await refusal(`${watched}\\notiz.txt::$DATA`)).toEqual([400, 'path']);
			expect(await refusal(`${watched}\\NUL`)).toEqual([400, 'path']);
			expect(await refusal(`${watched}\\unter/../notiz.txt`)).toEqual([400, 'path']);
		} else {
			expect(await refusal(`${watched}/./notiz.txt`)).toEqual([400, 'path']);
		}
	});

	it('refuses a junction or symlink out of the folder', async () => {
		expect(await refusal(join(watched, 'verknuepfung', 'geheim.txt'))).toEqual([403, 'link']);
		if (fileLink) expect(await refusal(join(watched, 'link.txt'))).toEqual([403, 'link']);
	});

	it('refuses excluded files, switched-off subfolders and a folder no longer configured', async () => {
		writeFileSync(join(watched, 'sicherung.tmp'), 'tmp');
		expect(await refusal(join(watched, 'sicherung.tmp'))).toEqual([403, 'folder']);
		const unter = items['unter/tief.txt'];
		expect((await view(owner, unter)).file.status).toBe(200);
		await superuser.collection('connections').update(conn.id, { settings: { folders: [{ path: watched, subfolders: false }] } });
		expect((await send(`/api/byl/folders/items/${unter.id}`, { token: owner.token() })).json.reason).toBe('folder');
		await superuser.collection('connections').update(conn.id, { settings: { folders: [] } });
		expect((await send(`/api/byl/folders/items/${items['notiz.txt'].id}`, { token: owner.token() })).json.reason).toBe('folder');
		await superuser.collection('connections').update(conn.id, { settings: { folders: [{ path: watched }] } });
		expect((await view(owner, items['notiz.txt'])).file.status).toBe(200);
	});

	it('answers 404 for entries of other channels and of other users', async () => {
		const manual = await owner.pb.collection('inbox_items').create({ owner: owner.id, channel: 'manual', kind: 'todo', title: 'Hand' });
		expect((await send(`/api/byl/folders/items/${manual.id}`, { token: owner.token() })).json.reason).toBe('unknown');
		const foreign = await crafted(other, join(watched, 'notiz.txt'));
		expect((await send(`/api/byl/folders/items/${foreign.id}`, { token: owner.token() })).json.reason).toBe('unknown');
	});
});

describe('only the owner, from this machine, from the app itself', () => {
	it('refuses another user, an admin account and requests without a session', async () => {
		const item = items['notiz.txt'];
		const foreign = await send(`/api/byl/folders/items/${item.id}`, { token: other.token() });
		expect([foreign.status, foreign.json.reason]).toEqual([403, 'owner']);
		expect((await send(`/api/byl/folders/items/${item.id}`, { token: superuser.authStore.token })).status).toBe(403);
		expect((await send(`/api/byl/folders/items/${item.id}`)).status).toBe(401);
		const file = await send(`/api/byl/folders/items/${item.id}/file`, { token: superuser.authStore.token });
		expect([file.status, file.json.reason]).toEqual([401, 'auth']);
	});

	it('needs a file token: none, a wrong one or a session token in the address are refused', async () => {
		const item = items['notiz.txt'];
		const path = `/api/byl/folders/items/${item.id}/file`;
		expect((await send(path)).json.reason).toBe('auth');
		expect((await send(`${path}?token=kaputt`)).json.reason).toBe('auth');
		expect((await send(`${path}?token=${owner.token()}`)).json.reason).toBe('auth');
		const foreignToken = await other.pb.files.getToken();
		expect((await send(`${path}?token=${foreignToken}`)).json.reason).toBe('owner');
		const ownToken = await owner.pb.files.getToken();
		expect((await send(`${path}?token=${ownToken}`)).status).toBe(200);
	});

	it('refuses requests through a proxy, from a foreign Host or Origin and from other sites', async () => {
		const item = items['notiz.txt'];
		const cases = [
			[{ 'X-Forwarded-For': '203.0.113.5' }, 'loopback'],
			[{ Forwarded: 'for=203.0.113.5' }, 'loopback'],
			// A foreign Host never reaches the route: the guard of every request refuses it (ADR-0055).
			[{ Host: 'evil.example' }, 'host'],
			[{ Host: '127.0.0.1:1' }, 'host'],
			[{ Origin: 'https://evil.example' }, 'origin'],
			[{ 'Sec-Fetch-Site': 'cross-site' }, 'origin'],
			[{ 'Sec-Fetch-Site': 'same-site' }, 'origin']
		];
		for (const [headers, reason] of cases) {
			const info = await send(`/api/byl/folders/items/${item.id}`, { token: owner.token(), headers });
			expect([info.status, info.json.reason], JSON.stringify(headers)).toEqual([403, reason]);
			const token = await owner.pb.files.getToken();
			const file = await send(`/api/byl/folders/items/${item.id}/file?token=${token}`, { headers });
			expect([file.status, file.json.reason], JSON.stringify(headers)).toEqual([403, reason]);
		}
	});

	it('logs every refusal with reason, user and entry, never with a path or the content', async () => {
		const logs = await writtenLogs(superuser);
		const refusals = logs.filter((entry) => entry.message === 'byl-folders: Datei abgelehnt');
		expect(refusals.length).toBeGreaterThan(5);
		for (const entry of refusals) {
			expect(Object.keys(entry.data).sort()).toEqual(['item', 'reason', 'user']);
		}
		// Only the app itself: the requests of this test to the Record API carry paths in their filter,
		// which PocketBase logs with the address.
		const own = logs.filter(
			(entry) => entry.data?.type !== 'request' || String(entry.data?.url ?? '').startsWith('/api/byl')
		);
		const text = JSON.stringify(own);
		expect(text).not.toContain(base);
		expect(text).not.toContain(base.replace(/\\/g, '\\\\'));
		expect(text).not.toContain('geheim');
		expect(text).not.toContain(createHash('sha256').update(PDF).digest('hex'));
	});
});
