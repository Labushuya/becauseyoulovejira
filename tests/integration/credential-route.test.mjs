// Routes of the access data set from the browser (BW-3, ADR-0075) against a disposable instance of
// the harness, on every system (the instance names itself a server under Windows through
// BYL_HOST_PLATFORM, so the checks of the page System apply as at the app): every refusal of the
// chain (no session, another account, a proxy, a foreign Origin), then the names (foreign, of the
// system, outside the pattern) and the values, each refused before anything runs. Even a permitted
// request runs nothing here: the server is no own instance of an app folder (503 "unavailable").
// A marker value never shows in an answer, in the log of PocketBase or in the output of the server.
// The real commands of byl-control.ps1 run only in system-control.test.mjs against a copy.

import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writtenLogs } from '../support/logs.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';

const MARKER = `marker-${randomBytes(9).toString('hex')}`;
const ROUTES = [
	{ method: 'GET', path: '/api/byl/credentials' },
	{ method: 'POST', path: '/api/byl/credentials/set', body: { name: 'BYL_TELEGRAM_TOKEN', value: MARKER } },
	{ method: 'POST', path: '/api/byl/credentials/remove', body: { name: 'BYL_TELEGRAM_TOKEN' } }
];

let instance;
let superuser;
let admin;
let secondAdmin;
let other;
/** The text of every answer of this file, searched for the marker at the end. */
const answers = [];

/** One request on a new connection; the body parsed as JSON when it is JSON. */
function call(method, path, { token, origin, headers = {}, body } = {}) {
	const url = new URL(instance.url);
	return new Promise((done, fail) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const req = request(
			{
				host: '127.0.0.1',
				port: Number(url.port),
				path,
				method,
				agent: false,
				timeout: scaled(15_000),
				headers: {
					...(token ? { Authorization: token } : {}),
					...(origin ? { Origin: origin } : {}),
					...(data ? { 'Content-Type': 'application/json' } : {}),
					...headers
				}
			},
			(response) => {
				let text = '';
				response.setEncoding('utf8');
				response.on('data', (chunk) => (text += chunk));
				response.on('end', () => {
					answers.push(text);
					let parsed = text;
					try {
						parsed = JSON.parse(text);
					} catch {
						// not JSON
					}
					done({ status: response.statusCode, body: parsed, headers: response.headers });
				});
			}
		);
		req.once('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
		req.once('error', fail);
		if (data) req.write(data);
		req.end();
	});
}

const own = () => `http://127.0.0.1:${new URL(instance.url).port}`;

/** A request of the app itself: token of `who`, Origin of its address for a POST. */
function app(who, method, path, options = {}) {
	return call(method, path, { token: who.token, origin: method === 'POST' ? own() : undefined, ...options });
}

async function account(extra = {}) {
	const email = `zugang-${randomBytes(8).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password, ...extra });
	const client = new PocketBase(instance.url);
	client.autoCancellation(false);
	await client.collection('users').authWithPassword(email, password);
	return { id: record.id, token: client.authStore.token };
}

beforeAll(async () => {
	// An invented allowlist of Telegram in the environment of the server (V7).
	instance = await startPocketBase({ env: { BYL_HOST_PLATFORM: 'windows', BYL_ROUTE_IDS: '424242' } });
	superuser = new PocketBase(instance.url);
	superuser.autoCancellation(false);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	// The account created first becomes the administrator of the app (ADR-0056 §2); a second one
	// gets the right, so the rate limit of the changes (10 a minute) holds for each.
	admin = await account();
	secondAdmin = await account({ instance_admin: true });
	other = await account();
	// A paused Telegram bot of the administrator with its own names (V7: the allowlist counts).
	await superuser.collection('connections').create({
		owner: admin.id,
		type: 'telegram',
		label: 'Bot der Tests',
		enabled: false,
		secret_env: 'BYL_TEST_ROUTE_BOT',
		settings: { allowed_env: 'BYL_ROUTE_IDS', keywords: ['todo'] }
	});
});

afterAll(async () => {
	await instance?.stop();
});

describe('routes of the access data (BW-3, ADR-0075): the checks of the page System', () => {
	it('answer 401 without a session', async () => {
		for (const route of [...ROUTES, { method: 'GET', path: '/api/byl/credentials/restart-notice' }]) {
			const answer = await call(route.method, route.path, { origin: own(), body: route.body });
			expect(answer.status, route.path).toBe(401);
		}
	});

	it('refuse every account but the administrator of the app with "owner", the hint too', async () => {
		for (const route of [...ROUTES, { method: 'GET', path: '/api/byl/credentials/restart-notice' }]) {
			const answer = await app(other, route.method, route.path, { body: route.body });
			expect([answer.status, answer.body.reason], route.path).toEqual([403, 'owner']);
		}
	});

	it('refuse a request through a proxy, even from 127.0.0.1, with "loopback"', async () => {
		for (const route of ROUTES) {
			for (const [name, value] of [
				['X-Forwarded-For', '127.0.0.1'],
				['Forwarded', 'for=192.168.178.30'],
				['X-Real-IP', '127.0.0.1']
			]) {
				const answer = await app(admin, route.method, route.path, { body: route.body, headers: { [name]: value } });
				expect([answer.status, answer.body.reason], `${route.path} ${name}`).toEqual([403, 'loopback']);
			}
		}
	});

	it('refuse a change without the Origin of the app and a read from another site with "origin" (CSRF)', async () => {
		const port = Number(new URL(instance.url).port);
		for (const route of ROUTES.filter((entry) => entry.method === 'POST')) {
			for (const origin of [undefined, 'null', 'https://evil.example', `http://127.0.0.1:${port + 1}`]) {
				const answer = await call('POST', route.path, { token: admin.token, origin, body: route.body });
				expect([answer.status, answer.body.reason], `${route.path} ${origin}`).toEqual([403, 'origin']);
			}
			const crossSite = await app(admin, 'POST', route.path, { body: route.body, headers: { 'Sec-Fetch-Site': 'cross-site' } });
			expect([crossSite.status, crossSite.body.reason]).toEqual([403, 'origin']);
		}
		const read = await call('GET', '/api/byl/credentials', { token: admin.token, origin: 'https://evil.example' });
		expect([read.status, read.body.reason]).toEqual([403, 'origin']);
	});
});

describe('routes of the access data: names and values, checked by the server (S4, S8)', () => {
	it('refuse a foreign name, the names of the system and names outside the pattern', async () => {
		const cases = [
			['BYL_FOREIGN', 'unknown'],
			['BYL_INGEST_TOKEN', 'blocked'],
			['BYL_TELEGRAM_API_BASE', 'blocked'],
			// Named by a connection, but a switch of the tests.
			['BYL_TEST_ROUTE_BOT', 'blocked'],
			['PATH', 'name'],
			[`BYL_${'A'.repeat(61)}`, 'name']
		];
		for (const [name, problem] of cases) {
			const answer = await app(admin, 'POST', '/api/byl/credentials/set', { body: { name, value: MARKER } });
			expect([answer.status, answer.body.problem], name).toEqual([400, problem]);
			expect(answer.body.message).toBeTruthy();
		}
	});

	it('refuse an empty value, control characters and more than 4096 characters', async () => {
		for (const [value, problem] of [
			['', 'empty'],
			[`${MARKER}\n`, 'control'],
			[MARKER.repeat(200), 'long']
		]) {
			const answer = await app(admin, 'POST', '/api/byl/credentials/set', { body: { name: 'BYL_TELEGRAM_TOKEN', value } });
			expect([answer.status, answer.body.problem, answer.body.name], problem).toEqual([400, problem, 'BYL_TELEGRAM_TOKEN']);
		}
	});

	it('pass a suggestion of a setup and a name of a connection on, here only to "unavailable"', async () => {
		for (const [path, body] of [
			['/api/byl/credentials/set', { name: 'BYL_TELEGRAM_TOKEN_2', value: ` ${MARKER} ` }],
			['/api/byl/credentials/set', { name: 'BYL_ROUTE_IDS', value: '12345' }],
			['/api/byl/credentials/remove', { name: 'BYL_ROUTE_IDS' }]
		]) {
			const answer = await app(secondAdmin, 'POST', path, { body });
			expect([answer.status, answer.body.reason], `${path} ${body.name}`).toEqual([503, 'unavailable']);
		}
		const status = await app(secondAdmin, 'GET', '/api/byl/credentials?names=BYL_GMAIL_PASSWORD');
		expect([status.status, status.body.reason]).toEqual([503, 'unavailable']);
	});

	it('lists the allowlist of Telegram among the variables of the page "Sicherheit" (V7)', async () => {
		const answer = await app(admin, 'GET', '/api/byl/security');
		expect(answer.status).toBe(200);
		expect(answer.body.secrets).toEqual([
			{ name: 'BYL_ROUTE_IDS', set: true },
			{ name: 'BYL_TEST_ROUTE_BOT', set: false }
		]);
		expect(JSON.stringify(answer.body)).not.toContain('424242');
	});

	it('names no restart without a change, and no marker leaves the server (S1, S3)', async () => {
		const notice = await app(admin, 'GET', '/api/byl/credentials/restart-notice');
		expect(notice.status).toBe(200);
		expect(notice.body).toEqual({ needed: false });
		expect(notice.headers['cache-control']).toBe('no-store');
		expect(answers.length).toBeGreaterThan(30);
		for (const text of answers) expect(text).not.toContain(MARKER);
		const entries = await writtenLogs(superuser);
		const refusals = entries.filter((entry) => entry.message === 'byl-credentials: Anfrage abgelehnt');
		expect(refusals.map((entry) => entry.data.reason)).toEqual(expect.arrayContaining(['owner', 'loopback', 'origin', 'unknown', 'blocked', 'name', 'control']));
		expect(JSON.stringify(entries)).not.toContain(MARKER);
		expect(instance.output()).not.toContain(MARKER);
	});
});
