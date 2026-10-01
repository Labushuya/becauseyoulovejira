// Route of the page "Einstellungen → Speicher" (ADR-0047 §6 to §9, SPE-2) against disposable
// instances of the harness: the refusals of the checks of the page System (no session, admin
// account, not the owner, Origin, another site, proxy, unknown action), the measurement of the
// databases, the files of the inbox by where they belong, the trash and the backups, on a server
// under Windows and one that says it runs under Linux, and the actions: compact the databases, empty
// discarded entries early (the entries stay as tombstones, nothing bound is touched), remove the old
// automatic backups of PocketBase only when asked. A harness instance is no own instance of an app
// folder, so program files, safety copies, logs and the free space stay out (null); those run in
// storage-control.test.mjs against a copy of the app folder.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { fetchStorage, runStorageAction } from '../../web/src/lib/data/storage.ts';

let windows;
let linux;
const accounts = {};

function call(instance, method, path, { token, origin, host, headers = {}, body } = {}) {
	const url = new URL(instance.url);
	const data = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((done, fail) => {
		const req = request(
			{
				host: '127.0.0.1',
				port: Number(url.port),
				path,
				method,
				agent: false,
				timeout: 30_000,
				headers: {
					...(token ? { Authorization: token } : {}),
					...(origin ? { Origin: origin } : {}),
					...(host ? { Host: host } : {}),
					...(data ? { 'Content-Type': 'application/json' } : {}),
					...headers
				}
			},
			(response) => {
				let text = '';
				response.setEncoding('utf8');
				response.on('data', (chunk) => (text += chunk));
				response.on('end', () => {
					let parsed = text;
					try {
						parsed = JSON.parse(text);
					} catch {
						// not JSON
					}
					done({ status: response.statusCode, body: parsed });
				});
			}
		);
		req.once('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
		req.once('error', fail);
		if (data) req.write(data);
		req.end();
	});
}

const own = (instance) => `http://127.0.0.1:${new URL(instance.url).port}`;
const app = (instance, who, method, path, options = {}) =>
	call(instance, method, path, { token: who.token, origin: method === 'POST' ? own(instance) : undefined, ...options });

async function superuserOf(instance) {
	const client = new PocketBase(instance.url);
	client.autoCancellation(false);
	await client.collection('_superusers').authWithPassword(instance.email, instance.password);
	return client;
}

async function account(superuser, instance) {
	const email = `speicher-${randomBytes(5).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const client = new PocketBase(instance.url);
	client.autoCancellation(false);
	await client.collection('users').authWithPassword(email, password);
	return { id: record.id, token: client.authStore.token, client };
}

/** An entry of the inbox with an original file of `bytes` bytes. */
function entry(who, bytes, data = {}) {
	return who.client.collection('inbox_items').create({
		owner: who.id,
		channel: 'telegram',
		kind: 'message',
		title: `Nachricht ${randomBytes(4).toString('hex')}`,
		body: 'Text der Nachricht',
		source_ref: `42:${randomBytes(6).toString('hex')}`,
		original: new File([new Uint8Array(bytes).fill(65)], 'nachricht.txt', { type: 'text/plain' }),
		...data
	});
}

beforeAll(async () => {
	windows = await startPocketBase({ env: { BYL_HOST_PLATFORM: 'windows' } });
	linux = await startPocketBase({ env: { BYL_HOST_PLATFORM: 'linux' } });
	const superuser = await superuserOf(windows);
	// The account created first owns the instance (ADR-0043 §3).
	accounts.owner = await account(superuser, windows);
	accounts.other = await account(superuser, windows);
	accounts.superuserToken = superuser.authStore.token;
	accounts.superuser = superuser;
	accounts.linuxOwner = await account(await superuserOf(linux), linux);
}, 90_000);

afterAll(async () => {
	for (const instance of [windows, linux]) {
		if (instance) await instance.stop();
	}
}, 60_000);

describe('route of the page Speicher: refusals', () => {
	it('answers 401 without a session and refuses an admin account and other accounts', async () => {
		expect((await call(windows, 'GET', '/api/byl/storage')).status).toBe(401);
		expect((await call(windows, 'GET', '/api/byl/storage', { token: accounts.superuserToken })).status).toBe(403);
		const other = await app(windows, accounts.other, 'GET', '/api/byl/storage');
		expect([other.status, other.body.reason]).toEqual([403, 'owner']);
		const act = await app(windows, accounts.other, 'POST', '/api/byl/storage/actions/vacuum');
		expect([act.status, act.body.reason]).toEqual([403, 'owner']);
	});

	it('refuses an action without Origin or from another site, a read from another site and a proxy', async () => {
		for (const origin of [undefined, 'null', 'https://evil.example']) {
			const answer = await call(windows, 'POST', '/api/byl/storage/actions/vacuum', { token: accounts.owner.token, origin });
			expect([answer.status, answer.body.reason], String(origin)).toEqual([403, 'origin']);
		}
		const read = await call(windows, 'GET', '/api/byl/storage', { token: accounts.owner.token, headers: { 'Sec-Fetch-Site': 'cross-site' } });
		expect([read.status, read.body.reason]).toEqual([403, 'origin']);
		const proxied = await app(windows, accounts.owner, 'GET', '/api/byl/storage', { headers: { 'X-Forwarded-For': '203.0.113.5' } });
		expect([proxied.status, proxied.body.reason]).toEqual([403, 'loopback']);
	});

	it('runs no action outside the list and refuses unknown groups', async () => {
		for (const name of ['delete', 'restart', 'constructor']) {
			const answer = await app(windows, accounts.owner, 'POST', `/api/byl/storage/actions/${name}`);
			expect([answer.status, answer.body.reason], name).toEqual([404, 'unknown']);
		}
		for (const groups of [undefined, [], ['backups'], ['programs', 'programs']]) {
			const answer = await app(windows, accounts.owner, 'POST', '/api/byl/storage/actions/leftovers', { body: { groups } });
			expect([answer.status, answer.body.reason], JSON.stringify(groups)).toEqual([400, 'invalid']);
		}
	});
});

describe('route of the page Speicher: measurement', () => {
	it('measures databases, the files of the inbox by where they belong, the trash and the backups', async () => {
		const owner = accounts.owner;
		const fresh = await entry(owner, 1000);
		const atOpen = await entry(owner, 3000);
		const open = await owner.client.collection('tickets').create({ owner: owner.id, title: 'Offen', source_item: atOpen.id });
		const atDone = await entry(owner, 2000);
		await owner.client.collection('tickets').create({ owner: owner.id, title: 'Erledigt', status: 'done', source_item: atDone.id });
		const discarded = await entry(owner, 500);
		await owner.client.collection('inbox_items').update(discarded.id, { state: 'discarded' });
		const bound = await entry(owner, 4000);
		const trashed = await owner.client.collection('tickets').create({ owner: owner.id, title: 'Im Papierkorb', source_item: bound.id });
		await owner.client.send(`/api/byl/tickets/${trashed.id}/delete`, { method: 'POST', body: { sources: 'discard' } });

		const answer = await app(windows, owner, 'GET', '/api/byl/storage');
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		const overview = answer.body;
		expect(overview.own_instance).toBe(false);
		expect(overview.database.bytes).toBeGreaterThan(0);
		// PocketBase 0.40.4 (modernc.org/sqlite) has dbstat (PRAGMA compile_options: ENABLE_DBSTAT_VTAB).
		expect(Object.keys(overview.database.groups).sort()).toEqual(['history', 'inbox', 'other', 'tickets']);
		expect(overview.database.groups.tickets).toBeGreaterThan(0);
		expect(overview.database.groups.inbox).toBeGreaterThan(0);
		expect(overview.database.trash).toMatchObject({ tickets: 1, blocked: 1 });
		expect(overview.logs_database.bytes).toBeGreaterThan(0);
		const { categories } = overview.files;
		expect(categories.new).toEqual({ count: 1, bytes: 1000 });
		expect(categories.open).toEqual({ count: 1, bytes: 3000 });
		expect(categories.done).toEqual({ count: 1, bytes: 2000 });
		expect(categories.discarded).toMatchObject({ count: 1, bytes: 500 });
		expect(categories.discarded.next_empty).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(categories.trash).toEqual({ count: 1, bytes: 4000 });
		expect(overview.files.total).toEqual({ count: 5, bytes: 10500 });
		expect(overview.files.largest.map((item) => item.item)).toEqual([bound.id, atOpen.id, atDone.id, fresh.id, discarded.id]);
		expect(overview.files.largest[1]).toMatchObject({ category: 'open', ticket: { id: open.id, key: open.key, status: 'open', trashed: false } });
		expect(overview.files.largest[0].ticket).toMatchObject({ id: trashed.id, trashed: true });
		expect(overview.backups).toMatchObject({ target: null, safety: null, local: { count: 0 } });
		expect(overview).toMatchObject({ logs: null, program: null, disk: null });
		expect(overview.actions).toMatchObject({ leftovers: { programs: null, safety: null }, discarded: { count: 1, bytes: 500 } });

		// The data layer of the SPA reads the same answer.
		const parsed = await fetchStorage(owner.client);
		expect(parsed.kind).toBe('ok');
		expect(parsed.value.files.categories.trash).toEqual({ count: 1, bytes: 4000 });
	});

	it('measures on a server that is not on Windows too, without the parts of the folder app', async () => {
		const answer = await app(linux, accounts.linuxOwner, 'GET', '/api/byl/storage');
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		expect(answer.body).toMatchObject({ own_instance: false, program: null, disk: null, logs: null });
	});
});

describe('route of the page Speicher: actions', () => {
	it('compacts the databases', async () => {
		const answer = await app(windows, accounts.owner, 'POST', '/api/byl/storage/actions/vacuum');
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		expect(answer.body.result.before.data.bytes).toBeGreaterThan(0);
		expect(answer.body.result.after.data.free_bytes).toBe(0);
	});

	it('empties discarded entries early: tombstones keep state and fingerprint, nothing bound is touched', async () => {
		const owner = accounts.owner;
		const discarded = await entry(owner, 700);
		await owner.client.collection('inbox_items').update(discarded.id, { state: 'discarded' });
		const kept = await entry(owner, 800);
		const before = await accounts.superuser.collection('inbox_items').getOne(discarded.id);

		// The SDK in Node sends no Origin: the data layer of the SPA turns the refusal into its reason.
		expect(await runStorageAction(owner.client, 'discarded')).toEqual({ kind: 'denied', reason: 'origin' });
		const result = await app(windows, owner, 'POST', '/api/byl/storage/actions/discarded');
		expect(result.status, JSON.stringify(result.body)).toBe(200);
		expect(result.body.result.count).toBeGreaterThanOrEqual(1);
		const after = await accounts.superuser.collection('inbox_items').getOne(discarded.id);
		expect(after).toMatchObject({ state: 'discarded', original: '', fingerprint: before.fingerprint });
		expect(after.body).toMatch(/^_Inhalt gelöscht/);
		expect((await accounts.superuser.collection('inbox_items').getOne(kept.id)).original).not.toBe('');
		const again = await app(windows, owner, 'GET', '/api/byl/storage');
		expect(again.body.actions.discarded.count).toBe(0);
		expect(again.body.files.categories.trash).toEqual({ count: 1, bytes: 4000 });
	});

	it('removes old automatic backups of PocketBase only when asked and keeps those of the app', async () => {
		const backups = join(windows.dataDir, 'backups');
		mkdirSync(backups, { recursive: true });
		writeFileSync(join(backups, '@auto_pb_backup_byl_20260801000000.zip'), Buffer.alloc(1200));
		writeFileSync(join(backups, 'byl-20261001-030000.zip'), Buffer.alloc(900));
		const measured = await app(windows, accounts.owner, 'GET', '/api/byl/storage');
		expect(measured.body.backups.pocketbase).toMatchObject({ count: 1, bytes: 1200 });
		expect(measured.body.backups.local).toMatchObject({ count: 1, bytes: 900 });

		const answer = await app(windows, accounts.owner, 'POST', '/api/byl/storage/actions/leftovers', {
			body: { groups: ['pocketbase', 'programs'] }
		});
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		expect(answer.body.result.removed.pocketbase).toEqual({ count: 1, bytes: 1200 });
		expect(answer.body.result.skipped).toEqual([{ group: 'programs', name: '', reason: 'unavailable' }]);
		expect(existsSync(join(backups, '@auto_pb_backup_byl_20260801000000.zip'))).toBe(false);
		expect(existsSync(join(backups, 'byl-20261001-030000.zip'))).toBe(true);
	});
});
