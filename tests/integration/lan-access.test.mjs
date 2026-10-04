// Access in the home network (plan docs/plan/heimnetz.md, ADR-0055 addendum) against own disposable
// instances. Two ways to be another device of the home network:
//   simulated - on every machine: the instance runs on 127.0.0.1 with the origin of an address of
//               the home network, and the test hook tests/fixtures/pb_hooks/remote-address.pb.js
//               sets the peer of the connection (RemoteAddr) from X-Byl-Test-Remote-Address, so the
//               server sees a request of 192.168.178.30 exactly as from that device: remoteIP(),
//               realIP(), superuserIPs and the rate limiter. No proxy header is trusted.
//   real      - only in the CI (GitHub Actions, Windows and Linux): the instance listens on 0.0.0.0
//               as the app with the access on, and the test reaches it under a private address of
//               the runner. On a developer machine an instance on 0.0.0.0 would make Windows show
//               its firewall alert (and a "Cancel" there would change the firewall), so it waits for
//               the CI; the instance lives only as long as its cases.
// Checked: the Host of the home network is allowed, a foreign one refused; every route "only on
// this machine" refuses a device of the home network, also with forged proxy headers; the admin UI
// takes no superuser from there; tabs of other devices do not count as open for start.bat; a
// normal account signs in; the protection against guessing counts per device.

import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';

const lan = loadHookLib('lan-rules.js');

const LAN_ADDRESS = '192.168.178.20';
const DEVICE = '192.168.178.30';
const OTHER_DEVICE = '192.168.178.31';
const REMOTE = 'X-Byl-Test-Remote-Address';
const EVENT_TIMEOUT_MS = scaled(10_000);

/**
 * One request with exactly these headers (Host included) to `connect` (host and port of the
 * connection); the body parsed as JSON when it is.
 */
function call(connect, path, { method = 'GET', headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const req = request(
			{
				host: connect.host,
				port: connect.port,
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
					resolve({ status: res.statusCode, json });
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

async function account(superuser) {
	const email = `lan-${randomBytes(10).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	return { id: record.id, email, password };
}

/** Sign-in with password; the answer of PocketBase. */
const signIn = (connect, headers, collection, identity, password) =>
	call(connect, `/api/collections/${collection}/auth-with-password`, {
		method: 'POST',
		headers,
		body: { identity, password }
	});

/**
 * An open app tab as the SDK makes it, from `connect` with `headers`: the realtime connection
 * (PB_CONNECT with the client id), then the subscription of byl/attention with the token. Returns
 * the messages it gets and close().
 */
async function openTab(connect, headers, token) {
	const messages = [];
	let buffer = '';
	let stream;
	const clientId = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('no PB_CONNECT')), EVENT_TIMEOUT_MS);
		stream = request(
			{ host: connect.host, port: connect.port, path: '/api/realtime', method: 'GET', agent: false, headers },
			(res) => {
				res.setEncoding('utf8');
				res.on('data', (chunk) => {
					buffer += chunk.replace(/\r\n/g, '\n');
					let end;
					while ((end = buffer.indexOf('\n\n')) !== -1) {
						const block = buffer.slice(0, end);
						buffer = buffer.slice(end + 2);
						const event = /^event:(.*)$/m.exec(block)?.[1]?.trim();
						const data = /^data:(.*)$/m.exec(block)?.[1]?.trim() ?? '';
						if (event === 'PB_CONNECT') {
							clearTimeout(timer);
							resolve(JSON.parse(data).clientId);
						} else if (event === 'byl/attention') {
							messages.push(JSON.parse(data));
						}
					}
				});
				res.on('error', () => undefined);
			}
		);
		stream.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		stream.end();
	});
	const id = await clientId;
	const subscribed = await call(connect, '/api/realtime', {
		method: 'POST',
		headers: { ...headers, Authorization: token },
		body: { clientId: id, subscriptions: ['byl/attention'] }
	});
	expect(subscribed.status).toBe(204);
	return {
		messages,
		close: () =>
			new Promise((done) => {
				if (stream.destroyed) {
					done();
					return;
				}
				stream.once('close', done);
				stream.destroy();
			})
	};
}

/** Waits until `check` holds, at most `ms`. */
async function until(check, ms) {
	const deadline = Date.now() + ms;
	for (;;) {
		if (await check()) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((done) => setTimeout(done, 100));
	}
}

/** A private IPv4 address of this machine (another device would reach it there), or null. */
function machineAddress() {
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === 'IPv4' && !entry.internal && lan.isPrivateIPv4(entry.address)) return entry.address;
		}
	}
	return null;
}

// The routes that answer only on this machine, with the reason of a request from elsewhere. System,
// backup and the access in the home network check Windows first: on another server they refuse
// with "platform" before.
const LOCAL_ROUTES = [
	{ path: '/api/byl/system', method: 'GET', windows: true },
	{ path: '/api/byl/system/actions/autostart-on', method: 'POST', windows: true },
	{ path: '/api/byl/backup', method: 'GET', windows: true },
	{ path: '/api/byl/storage', method: 'GET' },
	{ path: '/api/byl/security', method: 'GET' },
	{ path: '/api/byl/security/settings', method: 'POST', body: { level: 'strict' } },
	{ path: '/api/byl/security/lan', method: 'GET', windows: true },
	{ path: '/api/byl/security/lan', method: 'POST', body: { enabled: false, addresses: [] }, windows: true },
	{ path: '/api/byl/security/lan/firewall', method: 'POST', body: { action: 'add' }, windows: true },
	{ path: '/api/byl/accounts', method: 'GET' },
	{ path: '/api/byl/accounts', method: 'POST', body: { name: 'Gast', email: 'gast@example.com' } },
	{ path: '/api/byl/accounts/abcdefghijklmno/admin', method: 'POST', body: { admin: true } },
	{ path: '/api/byl/accounts/households/abcdefghijklmno/owner', method: 'POST', body: { member: 'abcdefghijklmno' } },
	{ path: '/api/byl/accounts/households/abcdefghijklmno/delete', method: 'POST', body: { preview: true } },
	{ path: '/api/byl/folders/items/abcdefghijklmno', method: 'GET' }
];

function expectRefusedAsRemote(answer, route) {
	const expected = route.windows && process.platform !== 'win32' ? ['platform', 404] : ['loopback', 403];
	expect([answer.json?.reason, answer.status], `${route.method} ${route.path}`).toEqual(expected);
}

describe('simulated device of the home network (every machine)', () => {
	let instance;
	let local;
	let port;
	let host;
	let superuser;
	let owner;
	let other;
	const remote = (address = DEVICE, extra = {}) => ({ Host: host, [REMOTE]: address, ...extra });

	beforeAll(async () => {
		instance = await startPocketBase({ lanHosts: [LAN_ADDRESS] });
		port = Number(new URL(instance.url).port);
		local = { host: '127.0.0.1', port };
		host = `${LAN_ADDRESS}:${port}`;
		superuser = await superuserOf(instance);
		// The administrator of the app is the app account created first (ADR-0056).
		owner = await account(superuser);
		other = await account(superuser);
		for (const user of [owner, other]) {
			user.token = (await signIn(local, {}, 'users', user.email, user.password)).json.token;
		}
	});

	afterAll(async () => {
		await instance?.stop();
	});

	it('answers under the address of the home network, refuses every other host', async () => {
		expect((await call(local, '/api/health', { headers: remote() })).status).toBe(200);
		expect((await call(local, '/api/health', { headers: { Host: `127.0.0.1:${port}` } })).status).toBe(200);
		for (const name of [`192.168.178.21:${port}`, `${LAN_ADDRESS}:${port + 1}`, LAN_ADDRESS, `evil.example:${port}`]) {
			const answer = await call(local, '/api/health', { headers: { Host: name, [REMOTE]: DEVICE } });
			expect([answer.status, answer.json?.reason], name).toEqual([403, 'host']);
		}
	});

	it('lets a normal account of another device sign in and work', async () => {
		const answer = await signIn(local, remote(), 'users', other.email, other.password);
		expect(answer.status).toBe(200);
		const list = await call(local, '/api/collections/projects/records', {
			headers: remote(DEVICE, { Authorization: answer.json.token })
		});
		expect(list.status).toBe(200);
	});

	it('refuses every route "only on this machine" to another device, also with forged proxy headers', async () => {
		const forged = { 'X-Forwarded-For': '127.0.0.1', 'X-Real-IP': '127.0.0.1', Forwarded: 'for=127.0.0.1' };
		for (const route of LOCAL_ROUTES) {
			for (const extra of [{}, forged]) {
				const origin = route.method === 'POST' ? { Origin: `http://${host}` } : {};
				const answer = await call(local, route.path, {
					method: route.method,
					body: route.body,
					headers: remote(DEVICE, { Authorization: owner.token, ...origin, ...extra })
				});
				expectRefusedAsRemote(answer, route);
			}
		}
		// The same owner on this machine passes the check of the address (the overview answers).
		const own = await call(local, '/api/byl/security', { headers: { Authorization: owner.token } });
		expect(own.status).toBe(200);
		expect(own.json.lan).toEqual({ active: false, hosts: [host], editable: false });
		expect(own.json.hosts.active).toEqual([]);
		// A proxy header on this machine stays refused, too (ADR-0043).
		const proxied = await call(local, '/api/byl/security', {
			headers: { Authorization: owner.token, 'X-Forwarded-For': DEVICE }
		});
		expect(proxied.json.reason).toBe('loopback');
	});

	it('keeps presence and attention to scripts and pages of this machine', async () => {
		const presence = await call(local, '/api/byl/presence', { headers: remote() });
		expect(presence.status).toBe(403);
		const attention = await call(local, '/api/byl/attention?reason=start', { method: 'POST', headers: remote() });
		expect(attention.status).toBe(403);
		const file = await call(local, '/api/byl/attention?reason=datei', {
			method: 'POST',
			headers: remote(DEVICE, { Origin: 'null' })
		});
		expect(file.status).toBe(403);
	});

	it('counts and asks only the tabs of this machine when start.bat looks for an open tab', async () => {
		const tabs = [];
		try {
			tabs.push(await openTab(local, { Host: host, [REMOTE]: DEVICE }, other.token));
			const presence = () => call(local, '/api/byl/presence');
			// The tab of the other device is connected, yet no tab of this machine is open.
			expect((await presence()).json.tabs).toBe(0);
			tabs.push(await openTab(local, {}, owner.token));
			expect(await until(async () => (await presence()).json.tabs === 1, EVENT_TIMEOUT_MS)).toBe(true);
			const sent = await call(local, '/api/byl/attention?reason=start', { method: 'POST' });
			expect(sent.status).toBe(200);
			expect(sent.json.notified).toBe(1);
			expect(await until(() => tabs[1].messages.length === 1, EVENT_TIMEOUT_MS)).toBe(true);
			expect(tabs[0].messages).toEqual([]);
		} finally {
			for (const tab of tabs) await tab.close();
		}
	});

	it('takes no superuser from another device of the home network (superuserIPs)', async () => {
		const token = superuser.authStore.token;
		const own = await call(local, '/api/collections/_superusers/records', { headers: { Authorization: token } });
		expect(own.status).toBe(200);
		for (const extra of [{}, { 'X-Forwarded-For': '127.0.0.1' }]) {
			const answer = await call(local, '/api/collections/_superusers/records', {
				headers: remote(DEVICE, { Authorization: token, ...extra })
			});
			expect(answer.status).toBe(403);
		}
	});
});

describe('protection against guessing per device of the home network', () => {
	let instance;
	let local;
	let host;
	let user;

	beforeAll(async () => {
		instance = await startPocketBase({ lanHosts: [LAN_ADDRESS], rateLimits: true });
		const port = Number(new URL(instance.url).port);
		local = { host: '127.0.0.1', port };
		host = `${LAN_ADDRESS}:${port}`;
		user = await account(await superuserOf(instance));
	});

	afterAll(async () => {
		await instance?.stop();
	});

	it('locks the device that guesses, not the others and not this machine', async () => {
		const from = (address) => ({ Host: host, [REMOTE]: address });
		const statuses = [];
		for (let attempt = 0; attempt < 11; attempt += 1) {
			statuses.push((await signIn(local, from(DEVICE), 'users', user.email, 'falsch-falsch')).status);
		}
		expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
		expect(statuses[10]).toBe(429);
		// Even the right password waits on that device …
		expect((await signIn(local, from(DEVICE), 'users', user.email, user.password)).status).toBe(429);
		// … while another device and this machine sign in.
		expect((await signIn(local, from(OTHER_DEVICE), 'users', user.email, user.password)).status).toBe(200);
		expect((await signIn(local, {}, 'users', user.email, user.password)).status).toBe(200);
	});
});

const ADDRESS = machineAddress();

describe.skipIf(process.env.CI !== 'true' || ADDRESS === null)('real device of the home network (CI only, on 0.0.0.0)', () => {
	let instance;
	let local;
	let remote;
	let owner;
	let superuser;

	beforeAll(async () => {
		instance = await startPocketBase({ lanHosts: [ADDRESS], bindAll: true });
		const port = Number(new URL(instance.url).port);
		local = { host: '127.0.0.1', port };
		// A connection to the address of the machine comes from that address, not from loopback.
		remote = { host: ADDRESS, port };
		superuser = await superuserOf(instance);
		owner = await account(superuser);
		owner.token = (await signIn(local, {}, 'users', owner.email, owner.password)).json.token;
	});

	afterAll(async () => {
		await instance?.stop();
	});

	it('answers under the address of the machine and still under 127.0.0.1', async () => {
		expect((await call(remote, '/api/health')).status).toBe(200);
		expect((await call(local, '/api/health')).status).toBe(200);
		const foreign = await call(remote, '/api/health', { headers: { Host: `evil.example:${local.port}` } });
		expect([foreign.status, foreign.json?.reason]).toEqual([403, 'host']);
	});

	it('refuses the routes "only on this machine" from there, signs in a normal account, takes no superuser', async () => {
		for (const route of LOCAL_ROUTES) {
			const origin = route.method === 'POST' ? { Origin: `http://${ADDRESS}:${local.port}` } : {};
			const answer = await call(remote, route.path, {
				method: route.method,
				body: route.body,
				headers: { Authorization: owner.token, 'X-Forwarded-For': '127.0.0.1', ...origin }
			});
			expectRefusedAsRemote(answer, route);
		}
		expect((await signIn(remote, {}, 'users', owner.email, owner.password)).status).toBe(200);
		const admin = await call(remote, '/api/collections/_superusers/records', {
			headers: { Authorization: superuser.authStore.token }
		});
		expect(admin.status).toBe(403);
		const overview = await call(local, '/api/byl/security', { headers: { Authorization: owner.token } });
		expect(overview.json.lan).toEqual({ active: true, hosts: [`${ADDRESS}:${local.port}`], editable: false });
	});

	it('does not count a tab of the other device as open on this machine', async () => {
		const tab = await openTab(remote, {}, owner.token);
		try {
			expect((await call(local, '/api/byl/presence')).json.tabs).toBe(0);
		} finally {
			await tab.close();
		}
	});
});
