// Context of the SPA (KOB-1, ADR-0057) and the audit of the routes that work on this machine, against
// own disposable instances. GET /api/byl/context says who asks from where: the administrator of the
// app or another account, on this machine or on another device of the home network (simulated with
// tests/fixtures/pb_hooks/remote-address.pb.js, like lan-access.test.mjs), and the system of the
// server. "local" follows the rule of every route that works on this machine (check in
// lib/system-service.js): the address of the connection, never a header. Every such route refuses
// another account on this machine with "owner" and every device of the home network with "loopback"
// (a route only for Windows says "platform" first on another server), so the second person in her
// own browser profile on this machine reaches none of them.

import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';

const LAN_ADDRESS = '192.168.178.20';
const DEVICE = '192.168.178.30';
const REMOTE = 'X-Byl-Test-Remote-Address';
const ROUTE = '/api/byl/context';
const ON_WINDOWS = process.platform === 'win32';

/** One request with exactly these headers (Host included); the body parsed as JSON when it is. */
function call(port, path, { method = 'GET', headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path,
				method,
				agent: false,
				timeout: scaled(30_000),
				headers: {
					...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
					...headers,
					Connection: 'close'
				}
			},
			(res) => {
				const chunks = [];
				res.on('data', (chunk) => chunks.push(chunk));
				res.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8');
					let json = null;
					try {
						json = text === '' ? null : JSON.parse(text);
					} catch {
						json = null;
					}
					resolve({ status: res.statusCode, json, headers: res.headers });
				});
			}
		);
		req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
		req.on('error', reject);
		if (data !== undefined) req.write(data);
		req.end();
	});
}

async function superuserOf(instance) {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	await pb.collection('_superusers').authWithPassword(instance.email, instance.password);
	return pb;
}

/** An app account created by the superuser and signed in on this machine: { id, token }. */
async function account(instance, superuser) {
	const email = `kontext-${randomBytes(10).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const port = Number(new URL(instance.url).port);
	const signedIn = await call(port, '/api/collections/users/auth-with-password', {
		method: 'POST',
		body: { identity: email, password }
	});
	expect(signedIn.status).toBe(200);
	return { id: record.id, token: signedIn.json.token };
}

// Every route that works on this machine (scripts and processes, restart, backup and restore,
// storage, security and the home network with its firewall rule, accounts, "Ansehen" of files).
// `windows`: the route checks the system first and says "platform" on another server.
const PC_ROUTES = [
	{ method: 'GET', path: '/api/byl/system', windows: true },
	{ method: 'GET', path: '/api/byl/system/doctor', windows: true },
	{ method: 'GET', path: '/api/byl/system/logs', windows: true },
	{ method: 'POST', path: '/api/byl/system/actions/restart', windows: true },
	{ method: 'GET', path: '/api/byl/backup', windows: true },
	{ method: 'GET', path: '/api/byl/backup/notice', windows: true },
	{ method: 'POST', path: '/api/byl/backup/run', windows: true },
	{ method: 'POST', path: '/api/byl/backup/verify', windows: true, body: { source: 'local', name: 'x' } },
	{ method: 'POST', path: '/api/byl/backup/restore', windows: true, body: { confirm: 'WIEDERHERSTELLEN' } },
	{ method: 'GET', path: '/api/byl/backup/restore', windows: true },
	{ method: 'POST', path: '/api/byl/backup/settings', windows: true, body: { target: '' } },
	{ method: 'POST', path: '/api/byl/backup/passphrase', windows: true, body: { passphrase: 'x', confirmation: 'x' } },
	{ method: 'GET', path: '/api/byl/storage' },
	{ method: 'POST', path: '/api/byl/storage/actions/vacuum' },
	{ method: 'GET', path: '/api/byl/security' },
	{ method: 'POST', path: '/api/byl/security/settings', body: { level: 'strict' } },
	{ method: 'POST', path: '/api/byl/security/hosts', windows: true, body: { hosts: [] } },
	{ method: 'GET', path: '/api/byl/security/lan', windows: true },
	{ method: 'POST', path: '/api/byl/security/lan', windows: true, body: { enabled: false, addresses: [] } },
	{ method: 'POST', path: '/api/byl/security/lan/firewall', windows: true, body: { action: 'add' } },
	{ method: 'GET', path: '/api/byl/security/notice' },
	{ method: 'GET', path: '/api/byl/accounts' },
	{ method: 'POST', path: '/api/byl/accounts', body: { name: 'Gast', email: 'gast@example.com' } },
	{ method: 'POST', path: '/api/byl/accounts/abcdefghijklmno/password' },
	{ method: 'POST', path: '/api/byl/accounts/abcdefghijklmno/disabled', body: { disabled: true } },
	{ method: 'POST', path: '/api/byl/accounts/abcdefghijklmno/admin', body: { admin: true } },
	{ method: 'POST', path: '/api/byl/accounts/households/abcdefghijklmno/owner', body: { member: 'abcdefghijklmno' } },
	{ method: 'GET', path: '/api/byl/folders/items/abcdefghijklmno' },
	{ method: 'GET', path: '/api/byl/folders/items/abcdefghijklmno/file' }
];

/** "platform" for a route only for Windows on another server, else `reason` with its status. */
function expected(route, reason, status) {
	return route.windows && !ON_WINDOWS ? ['platform', 404] : [reason, status];
}

describe('GET /api/byl/context and the routes that work on this machine', () => {
	let instance;
	let port;
	let lanHost;
	let admin;
	let other;
	/** A request of the app on this machine: token, Host and, for a POST, the Origin of its address. */
	const here = (who, method = 'GET') => ({
		Authorization: who.token,
		Host: `127.0.0.1:${port}`,
		...(method === 'POST' ? { Origin: `http://127.0.0.1:${port}` } : {})
	});
	/** The same from another device of the home network under the address of this machine there. */
	const fromDevice = (who, method = 'GET', extra = {}) => ({
		Authorization: who.token,
		Host: lanHost,
		[REMOTE]: DEVICE,
		...(method === 'POST' ? { Origin: `http://${lanHost}` } : {}),
		...extra
	});

	beforeAll(async () => {
		instance = await startPocketBase({ lanHosts: [LAN_ADDRESS] });
		port = Number(new URL(instance.url).port);
		lanHost = `${LAN_ADDRESS}:${port}`;
		const superuser = await superuserOf(instance);
		// The account created first is the administrator of the app (ADR-0056).
		admin = await account(instance, superuser);
		other = await account(instance, superuser);
	});

	afterAll(async () => {
		await instance?.stop();
	});

	it('answers 401 without a session', async () => {
		const answer = await call(port, ROUTE, { headers: { Host: `127.0.0.1:${port}` } });
		expect(answer.status).toBe(401);
	});

	it('names the administrator on this machine with the scripts and the address of the app', async () => {
		const answer = await call(port, ROUTE, { headers: here(admin) });
		expect(answer.status).toBe(200);
		expect(answer.headers['cache-control']).toBe('no-store');
		expect(answer.json).toEqual({
			admin: true,
			local: true,
			platform: ON_WINDOWS ? 'windows' : 'linux',
			scripts: ON_WINDOWS,
			localUrl: `http://127.0.0.1:${port}`
		});
	});

	it('names another account on this machine without scripts and without an address', async () => {
		const answer = await call(port, ROUTE, { headers: here(other) });
		expect(answer.json).toEqual({
			admin: false,
			local: true,
			platform: ON_WINDOWS ? 'windows' : 'linux',
			scripts: false,
			localUrl: null
		});
	});

	it('names the administrator on another device of the home network as not local', async () => {
		const answer = await call(port, ROUTE, { headers: fromDevice(admin) });
		expect(answer.status).toBe(200);
		expect(answer.json).toMatchObject({
			admin: true,
			local: false,
			scripts: false,
			localUrl: `http://127.0.0.1:${port}`
		});
	});

	it('names another account on another device without an address', async () => {
		const answer = await call(port, ROUTE, { headers: fromDevice(other) });
		expect(answer.json).toMatchObject({ admin: false, local: false, scripts: false, localUrl: null });
	});

	it('takes no forged proxy header as this machine, in neither direction', async () => {
		const forged = { 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '127.0.0.1', Forwarded: 'for=127.0.0.1' };
		const remote = await call(port, ROUTE, { headers: fromDevice(admin, 'GET', forged) });
		expect(remote.json).toMatchObject({ admin: true, local: false, scripts: false });
		// A proxy header on this machine makes a request not local, as for every route of ADR-0043.
		for (const [name, value] of Object.entries({ 'X-Forwarded-For': DEVICE, ...forged })) {
			const proxied = await call(port, ROUTE, { headers: { ...here(admin), [name]: value } });
			expect(proxied.json, name).toMatchObject({ local: false, scripts: false });
		}
	});

	it('refuses another account on this machine every route that works here, with "owner"', async () => {
		for (const route of PC_ROUTES) {
			const answer = await call(port, route.path, {
				method: route.method,
				body: route.body,
				headers: here(other, route.method)
			});
			expect([answer.json?.reason, answer.status], `${route.method} ${route.path}`).toEqual(
				expected(route, 'owner', 403)
			);
		}
	});

	it('refuses every device of the home network every such route, the administrator too', async () => {
		for (const who of [admin, other]) {
			for (const route of PC_ROUTES) {
				const answer = await call(port, route.path, {
					method: route.method,
					body: route.body,
					headers: fromDevice(who, route.method)
				});
				expect([answer.json?.reason, answer.status], `${route.method} ${route.path}`).toEqual(
					expected(route, 'loopback', 403)
				);
			}
		}
	});

	it('lets the administrator on this machine pass the checks of address and right', async () => {
		for (const route of PC_ROUTES.filter((entry) => entry.method === 'GET')) {
			const answer = await call(port, route.path, { headers: here(admin) });
			expect(['owner', 'loopback', 'origin'], `${route.method} ${route.path}`).not.toContain(answer.json?.reason);
		}
	});

	it('names the folder of the browser extension only to the administrator on this machine', async () => {
		const path = '/api/byl/whatsapp-web/extension';
		const own = await call(port, path, { headers: here(admin) });
		expect(own.status).toBe(200);
		expect(own.json.folder).toMatch(/erweiterung-whatsapp-web$/);
		for (const headers of [here(other), fromDevice(admin), fromDevice(other)]) {
			const answer = await call(port, path, { headers });
			expect(answer.status).toBe(200);
			expect(answer.json).toEqual({ folder: '', built: false, version: '' });
		}
	});
});

describe('GET /api/byl/context on a server under Linux', () => {
	let instance;
	let port;
	let admin;

	beforeAll(async () => {
		instance = await startPocketBase({ env: { BYL_HOST_PLATFORM: 'linux' } });
		port = Number(new URL(instance.url).port);
		admin = await account(instance, await superuserOf(instance));
	});

	afterAll(async () => {
		await instance?.stop();
	});

	it('gives the administrator on this machine no scripts', async () => {
		const answer = await call(port, ROUTE, {
			headers: { Authorization: admin.token, Host: `127.0.0.1:${port}` }
		});
		expect(answer.json).toEqual({
			admin: true,
			local: true,
			platform: 'linux',
			scripts: false,
			localUrl: `http://127.0.0.1:${port}`
		});
	});
});
