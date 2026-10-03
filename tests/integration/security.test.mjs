// Security hardening (ADR-0055, plan docs/plan/sicherheit.md, SH-1) against own disposable
// instances with the rate limiter of the migration switched on (the harness switches it off for
// every other test): the Host allowlist against DNS rebinding, CORS only for the own origins with
// the two exceptions (browser extension, landing page per file://), the headers of every answer,
// the limit of sign-ins, and that normal use, realtime, the own inbox, the ingest of the mail
// helper, the routes of the page System and cron stay clear of every limit. Requests that set
// Host or Origin go through node:http, because fetch sets both itself.

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';
import { createInboxKey } from '../../web/src/lib/data/inbox-keys.ts';

const INGEST_TOKEN = `test-${randomBytes(18).toString('base64url')}`;
const EXTENSION = `chrome-extension://${'abcdefghijklmnop'.repeat(2)}`;
const FILE_PAGE = { Origin: 'null', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' };
const EVENT_TIMEOUT_MS = scaled(10_000);

let instance;
let port;
let publicDir;
const clients = [];

/** One request with exactly the given headers (Host included); the body parsed as JSON if it is. */
function call(target, path, { method = 'GET', headers = {}, body } = {}) {
	const url = new URL(path, target.url);
	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{ method, headers: { ...headers, Connection: 'close' }, timeout: scaled(30_000) },
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
					resolve({ status: res.statusCode, headers: res.headers, text, json });
				});
			}
		);
		req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
		req.on('error', reject);
		if (body !== undefined) req.write(body);
		req.end();
	});
}

/** `count` calls of `make` with at most `parallel` at a time; the statuses in order of the calls. */
async function burst(count, make, parallel = 10) {
	const statuses = new Array(count);
	let next = 0;
	const worker = async () => {
		while (next < count) {
			const index = next;
			next += 1;
			statuses[index] = (await make(index)).status;
		}
	};
	await Promise.all(Array.from({ length: parallel }, worker));
	return statuses;
}

function client(target) {
	const pb = new PocketBase(target.url);
	pb.autoCancellation(false);
	clients.push(pb);
	return pb;
}

async function superuserOf(target) {
	const pb = client(target);
	await pb.collection('_superusers').authWithPassword(target.email, target.password);
	return pb;
}

async function newUser(superuser) {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	return { id: record.id, email, password };
}

const signIn = (target, collection, identity, password) =>
	call(target, `/api/collections/${collection}/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity, password })
	});

beforeAll(async () => {
	publicDir = mkdtempSync(join(tmpdir(), 'byl-test-public-'));
	writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>becauseyoulovejira</title>');
	instance = await startPocketBase({ rateLimits: true, publicFiles: publicDir, env: { BYL_INGEST_TOKEN: INGEST_TOKEN } });
	port = Number(new URL(instance.url).port);
});

afterAll(async () => {
	for (const pb of clients) pb.realtime.unsubscribe().catch(() => undefined);
	await instance?.stop();
	rmSync(publicDir, { recursive: true, force: true });
});

describe('Host allowlist (DNS rebinding)', () => {
	it('answers only under 127.0.0.1, localhost and [::1] with the own port', async () => {
		for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`, `[::1]:${port}`]) {
			expect((await call(instance, '/api/health', { headers: { Host: host } })).status, host).toBe(200);
		}
		for (const host of [`evil.example:${port}`, `127.0.0.1:${port + 1}`, `127.0.0.1.nip.io:${port}`, '127.0.0.1', `localhost.:${port}`]) {
			for (const path of ['/api/health', '/', '/_/', '/api/realtime', '/api/collections/users/auth-with-password']) {
				const answer = await call(instance, path, { headers: { Host: host } });
				expect([answer.status, answer.json?.reason], `${host} ${path}`).toEqual([403, 'host']);
				expect(answer.json.message).toBe('Diese Adresse ist für becauseyoulovejira nicht freigegeben.');
			}
		}
	});

	it('takes the hosts of the CORS origins of the start as further hosts', async () => {
		const further = await startPocketBase({ extraOrigins: ['https://rechner.tailnet.example'] });
		try {
			const own = Number(new URL(further.url).port);
			expect((await call(further, '/api/health', { headers: { Host: 'rechner.tailnet.example' } })).status).toBe(200);
			expect((await call(further, '/api/health', { headers: { Host: `127.0.0.1:${own}` } })).status).toBe(200);
			expect((await call(further, '/api/health', { headers: { Host: 'other.tailnet.example' } })).status).toBe(403);
		} finally {
			await further.stop();
		}
	});
});

describe('CORS', () => {
	it('allows only the own origins; a foreign web page gets no approval, not even for a preflight', async () => {
		const own = await call(instance, '/api/health', { headers: { Origin: `http://localhost:${port}` } });
		expect(own.headers['access-control-allow-origin']).toBe(`http://localhost:${port}`);
		for (const origin of ['https://evil.example', 'null', `http://127.0.0.1:${port + 1}`, EXTENSION]) {
			const answer = await call(instance, '/api/health', { headers: { Origin: origin } });
			expect(answer.status, origin).toBe(200);
			expect(answer.headers['access-control-allow-origin'], origin).toBeUndefined();
		}
		const preflight = await call(instance, '/api/collections/users/auth-with-password', {
			method: 'OPTIONS',
			headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
		expect(preflight.headers['access-control-allow-methods']).toBeUndefined();
	});

	it('answers the landing page per file:// on the attention routes only', async () => {
		const sent = await call(instance, '/api/byl/attention?reason=datei', { method: 'POST', headers: FILE_PAGE });
		expect(sent.status).toBe(200);
		expect(sent.headers['access-control-allow-origin']).toBe('null');
		const state = await call(instance, `/api/byl/attention/${sent.json.nonce}`, { headers: FILE_PAGE });
		expect([state.status, state.json, state.headers['access-control-allow-origin']]).toEqual([200, { acked: false }, 'null']);
		const presence = await call(instance, '/api/byl/presence', { headers: FILE_PAGE });
		expect([presence.status, presence.headers['access-control-allow-origin']]).toEqual([403, undefined]);
	});
});

describe('headers', () => {
	it('protect API, web app and admin UI against framing, keep the referrer within the app and switch devices off', async () => {
		for (const path of ['/api/health', '/', '/_/']) {
			const answer = await call(instance, path);
			expect(answer.status, path).toBe(200);
			expect(answer.headers['x-content-type-options'], path).toBe('nosniff');
			expect(answer.headers['referrer-policy'], path).toBe('same-origin');
			expect(answer.headers['permissions-policy'], path).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
			expect(answer.headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
		}
		// The admin UI keeps the full CSP of PocketBase; the app only the frame rule (ADR-0055 §4).
		expect((await call(instance, '/_/')).headers['content-security-policy']).toMatch(/^default-src 'self'.*script-src/);
		expect((await call(instance, '/')).headers['content-security-policy']).toBe("frame-ancestors 'none'");
		// No Cross-Origin-Resource-Policy: the landing page per file:// probes /api/health with no-cors.
		expect((await call(instance, '/api/health')).headers['cross-origin-resource-policy']).toBeUndefined();
		// The Cache-Control of the web build stays (ADR-0040).
		expect((await call(instance, '/')).headers['cache-control']).toBe('no-cache');
	});
});

describe('rate limits in normal use', () => {
	let superuser;
	let owner;
	let ownerPb;

	beforeAll(async () => {
		superuser = await superuserOf(instance);
		owner = await newUser(superuser);
		ownerPb = client(instance);
		await ownerPb.collection('users').authWithPassword(owner.email, owner.password);
	});

	it('never count requests of a signed-in account, nor realtime, the own inbox, the mail helper or the page System', async () => {
		// Realtime: connect and subscribe, an event arrives.
		const events = [];
		await ownerPb.collection('tickets').subscribe('*', (event) => events.push(event));

		// 350 requests of the app within seconds: more than the 300 per 10 s for guests.
		const project = await ownerPb.collection('projects').create({ owner: owner.id, name: 'Haus', code: 'HAUS' });
		const app = await burst(350, (index) =>
			index % 5 === 0
				? ownerPb.collection('tickets').create({ owner: owner.id, title: `Ticket ${index}`, project: project.id }).then(() => ({ status: 200 }))
				: ownerPb.collection('tickets').getList(1, 1).then(() => ({ status: 200 }), (error) => ({ status: error.status }))
		);
		expect(app.filter((status) => status !== 200)).toEqual([]);
		await expect.poll(() => events.length, { timeout: EVENT_TIMEOUT_MS }).toBeGreaterThanOrEqual(70);

		// The mail helper: 350 requests with BYL_INGEST_TOKEN, its own limit of 1000 per 10 s.
		const mail = await burst(350, () => call(instance, '/api/byl/ingest/connections', { headers: { Authorization: `Bearer ${INGEST_TOKEN}` } }));
		expect(mail.filter((status) => status !== 200)).toEqual([]);

		// The own inbox: a script without Origin and the browser extension.
		const key = await createInboxKey(ownerPb, 'Skript');
		for (const headers of [{}, { Origin: EXTENSION }]) {
			const answer = await call(instance, '/api/byl/inbox/ingest', {
				method: 'POST',
				headers: { ...headers, Authorization: `Bearer ${key.token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode: 'manual', text: 'Milch kaufen', external_id: randomBytes(6).toString('hex') })
			});
			expect(answer.status, JSON.stringify(headers)).toBe(201);
			expect(answer.headers['access-control-allow-origin']).toBe(headers.Origin);
		}
		const extensionPreflight = await call(instance, '/api/byl/inbox/ingest', {
			method: 'OPTIONS',
			headers: { Origin: EXTENSION, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }
		});
		expect(extensionPreflight.status).toBe(204);
		expect(extensionPreflight.headers['access-control-allow-origin']).toBe(EXTENSION);
		expect(extensionPreflight.headers['access-control-allow-headers']).toBe('Authorization, Content-Type');

		// The page System passes the guard and the limiter; the route itself answers (no own instance).
		for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
			const system = await call(instance, '/api/byl/system', { headers: { Host: host, Authorization: ownerPb.authStore.token } });
			expect([system.status, system.json.reason], host).toEqual([503, 'unavailable']);
		}
	});

	it('limit what anybody may send without an account to 300 requests per 10 s, while the app and cron go on', async () => {
		// 650 requests take far less than 10 s: they touch at most two windows of the fixed-window
		// limiter of PocketBase, so at most 600 pass.
		const guest = await burst(650, () => call(instance, '/api/health'), 20);
		expect(guest.filter((status) => status === 200).length).toBeLessThanOrEqual(600);
		expect(guest).toContain(429);

		// Signed in, everything goes on, also the subscription that was open before.
		const events = [];
		await ownerPb.collection('projects').subscribe('*', (event) => events.push(event));
		expect((await ownerPb.collection('tickets').getList(1, 1)).items).toHaveLength(1);
		await ownerPb.collection('projects').create({ owner: owner.id, name: 'Garten', code: 'GART' });
		await expect.poll(() => events.length, { timeout: EVENT_TIMEOUT_MS }).toBe(1);

		// Cron runs inside the server, not through HTTP; started by a superuser it runs now as well.
		const cron = await call(instance, '/api/crons/byl-recurrence', { method: 'POST', headers: { Authorization: superuser.authStore.token } });
		expect(cron.status).toBe(204);
	});
});

describe('rate limit of sign-ins', () => {
	it('stops guessing after 10 attempts per minute, the right password included, and keeps the superusers apart', async () => {
		const own = await startPocketBase({ rateLimits: true });
		try {
			const superuser = await superuserOf(own);
			const user = await newUser(superuser);
			const statuses = [];
			for (let attempt = 0; attempt < 10; attempt += 1) {
				statuses.push((await signIn(own, 'users', user.email, 'falsch-geraten')).status);
			}
			expect(statuses).toEqual(new Array(10).fill(400));
			const blocked = await signIn(own, 'users', user.email, 'falsch-geraten');
			expect(blocked.status).toBe(429);
			expect((await signIn(own, 'users', user.email, user.password)).status).toBe(429);
			// The admin UI has a counter of its own, and a superuser is never limited.
			expect((await signIn(own, '_superusers', own.email, own.password)).status).toBe(200);
			expect((await call(own, '/api/settings', { headers: { Authorization: superuser.authStore.token } })).status).toBe(200);
			const settings = (await call(own, '/api/settings', { headers: { Authorization: superuser.authStore.token } })).json;
			expect(settings.superuserIPs).toEqual(['127.0.0.1', '::1']);
			expect(settings.rateLimits.enabled).toBe(true);
		} finally {
			await own.stop();
		}
	});
});
