// Security of the routes of the page "Einstellungen → System" (ADR-0043) against disposable
// instances of the harness: every refusal on its own (no session, admin account, not the owner of
// the instance, Origin, Host, proxy, client address of a trusted proxy header, server not on
// Windows, action outside the whitelist, rate limit), each logged with reason and user. Even an
// allowed request runs nothing here: the hooks of a harness instance lie in a temp folder without
// byl-control.ps1, and the server is no own instance of an app folder (503 "unavailable"). The data
// layer of the SPA turns the refusals into their reasons. The real commands run only in
// system-control.test.mjs against a copy of the app folder.

import { request } from 'node:http';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import {
	fetchSystemDoctor,
	fetchSystemLogs,
	fetchSystemStatus,
	runSystemAction
} from '../../web/src/lib/data/system.ts';
import { DataError } from '../../web/src/lib/data/errors.ts';

const WINDOWS = process.platform === 'win32';
const READ_ROUTES = ['/api/byl/system', '/api/byl/system/doctor', '/api/byl/system/logs'];
const ACTIONS = ['restart', 'mail-restart', 'autostart-on', 'autostart-off'];

let windows;
let linux;
let proxied;

/** One request on a new connection to `instance`; the body parsed as JSON when it is JSON. */
function call(instance, method, path, { token, origin, host, headers = {} } = {}) {
	const url = new URL(instance.url);
	return new Promise((done, fail) => {
		const req = request(
			{
				host: '127.0.0.1',
				port: Number(url.port),
				path,
				method,
				agent: false,
				timeout: 15_000,
				headers: {
					...(token ? { Authorization: token } : {}),
					...(origin ? { Origin: origin } : {}),
					...(host ? { Host: host } : {}),
					...headers
				}
			},
			(response) => {
				let text = '';
				response.setEncoding('utf8');
				response.on('data', (chunk) => (text += chunk));
				response.on('end', () => {
					let body = text;
					try {
						body = JSON.parse(text);
					} catch {
						// not JSON
					}
					done({ status: response.statusCode, body, headers: response.headers });
				});
			}
		);
		req.once('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
		req.once('error', fail);
		req.end();
	});
}

const own = (instance) => `http://127.0.0.1:${new URL(instance.url).port}`;

async function superuserOf(instance) {
	const client = new PocketBase(instance.url);
	client.autoCancellation(false);
	await client.collection('_superusers').authWithPassword(instance.email, instance.password);
	return client;
}

/** An app account of `instance`: its id, token and an SDK client signed in with it. */
async function account(superuser, instance) {
	const email = `sys-${Math.random().toString(36).slice(2)}@example.com`;
	const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const client = new PocketBase(instance.url);
	client.autoCancellation(false);
	await client.collection('users').authWithPassword(email, password);
	return { id: record.id, token: client.authStore.token, client };
}

/** A request of the app itself on `instance`: token of `who`, Origin of its address for a POST. */
function app(instance, who, method, path, options = {}) {
	return call(instance, method, path, {
		token: who.token,
		origin: method === 'POST' ? own(instance) : undefined,
		...options
	});
}

const accounts = {};

beforeAll(async () => {
	windows = await startPocketBase();
	linux = await startPocketBase({ env: { BYL_HOST_PLATFORM: 'linux' } });
	proxied = await startPocketBase();
	const superuser = await superuserOf(windows);
	// The account created first owns the instance (ADR-0043 §3).
	accounts.owner = await account(superuser, windows);
	accounts.other = await account(superuser, windows);
	accounts.superuserToken = superuser.authStore.token;
	accounts.superuser = superuser;
	accounts.linuxOwner = await account(await superuserOf(linux), linux);
	const proxySuperuser = await superuserOf(proxied);
	accounts.proxiedOwner = await account(proxySuperuser, proxied);
	// This instance takes the client address from a header of a trusted proxy (PocketBase settings).
	await proxySuperuser.settings.update({ trustedProxy: { headers: ['CF-Connecting-IP'], useLeftmostIP: false } });
}, 90_000);

afterAll(async () => {
	for (const instance of [windows, linux, proxied]) {
		if (instance) await instance.stop();
	}
}, 60_000);

describe.skipIf(!WINDOWS)('routes of the page System on a server under Windows: refusals', () => {
	it('answer 401 without a session', async () => {
		for (const path of READ_ROUTES) expect((await call(windows, 'GET', path)).status, path).toBe(401);
		for (const action of ACTIONS) {
			expect((await call(windows, 'POST', `/api/byl/system/actions/${action}`, { origin: own(windows) })).status, action).toBe(401);
		}
	});

	it('refuse an admin account', async () => {
		const answer = await call(windows, 'GET', '/api/byl/system', { token: accounts.superuserToken });
		expect(answer.status).toBe(403);
		expect((await call(windows, 'POST', '/api/byl/system/actions/restart', { token: accounts.superuserToken, origin: own(windows) })).status).toBe(403);
	});

	it('refuse an app account that does not own the instance', async () => {
		for (const path of READ_ROUTES) {
			const answer = await app(windows, accounts.other, 'GET', path);
			expect(answer.status, path).toBe(403);
			expect(answer.body.reason, path).toBe('owner');
		}
		for (const action of ACTIONS) {
			const answer = await app(windows, accounts.other, 'POST', `/api/byl/system/actions/${action}`);
			expect([answer.status, answer.body.reason], action).toEqual([403, 'owner']);
		}
	});

	it('refuse an action without Origin, from a foreign Origin or from another port (CSRF)', async () => {
		const port = Number(new URL(windows.url).port);
		for (const origin of [undefined, 'null', 'https://evil.example', `http://127.0.0.1:${port + 1}`, `http://localhost:${port}`]) {
			const answer = await call(windows, 'POST', '/api/byl/system/actions/restart', { token: accounts.owner.token, origin });
			expect([answer.status, answer.body.reason], String(origin)).toEqual([403, 'origin']);
		}
		const crossSite = await app(windows, accounts.owner, 'POST', '/api/byl/system/actions/autostart-on', {
			headers: { 'Sec-Fetch-Site': 'cross-site' }
		});
		expect([crossSite.status, crossSite.body.reason]).toEqual([403, 'origin']);
	});

	it('refuse a read from another site', async () => {
		for (const options of [{ origin: 'https://evil.example' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { headers: { 'Sec-Fetch-Site': 'same-site' } }]) {
			const answer = await call(windows, 'GET', '/api/byl/system', { token: accounts.owner.token, ...options });
			expect([answer.status, answer.body.reason], JSON.stringify(options)).toEqual([403, 'origin']);
		}
	});

	it('refuse a foreign Host (DNS rebinding) and another port', async () => {
		const port = Number(new URL(windows.url).port);
		for (const host of [`evil.example:${port}`, `127.0.0.1:${port + 1}`, `127.0.0.1.nip.io:${port}`]) {
			const read = await call(windows, 'GET', '/api/byl/system', { token: accounts.owner.token, host });
			expect([read.status, read.body.reason], host).toEqual([403, 'origin']);
			const act = await call(windows, 'POST', '/api/byl/system/actions/restart', {
				token: accounts.owner.token,
				host,
				origin: `http://${host}`
			});
			expect([act.status, act.body.reason], host).toEqual([403, 'origin']);
		}
	});

	it('refuse requests through a proxy, even from 127.0.0.1', async () => {
		for (const [name, value] of [
			['X-Forwarded-For', '203.0.113.5'],
			['Forwarded', 'for=198.51.100.7'],
			['X-Real-IP', '127.0.0.1'],
			['X-Forwarded-Host', 'app.example']
		]) {
			const answer = await app(windows, accounts.owner, 'GET', '/api/byl/system', { headers: { [name]: value } });
			expect([answer.status, answer.body.reason], name).toEqual([403, 'loopback']);
		}
	});

	it('run nothing outside the whitelist', async () => {
		for (const name of ['stop', 'start', 'reset-admin', 'port', 'reload', 'status', 'logs', 'constructor', '__proto__', 'restart%20-Force']) {
			const answer = await app(windows, accounts.owner, 'POST', `/api/byl/system/actions/${name}`);
			expect([answer.status, answer.body.reason], name).toEqual([404, 'unknown']);
		}
		const read = await app(windows, accounts.owner, 'GET', '/api/byl/system/actions/restart');
		expect([404, 405]).toContain(read.status);
		const withQuery = await app(windows, accounts.owner, 'GET', '/api/byl/system?command=stop&args=-Force');
		expect([withQuery.status, withQuery.body.reason]).toEqual([503, 'unavailable']);
	});

	it('run nothing where the server is not the own instance of an app folder', async () => {
		for (const path of READ_ROUTES) {
			const answer = await app(windows, accounts.owner, 'GET', path);
			expect([answer.status, answer.body.reason], path).toEqual([503, 'unavailable']);
		}
		for (const action of ACTIONS) {
			const answer = await app(windows, accounts.owner, 'POST', `/api/byl/system/actions/${action}`);
			expect([answer.status, answer.body.reason], action).toEqual([503, 'unavailable']);
		}
		// The same with localhost and [::1] as the address of the app.
		const port = Number(new URL(windows.url).port);
		for (const name of ['localhost', '[::1]']) {
			const answer = await call(windows, 'POST', '/api/byl/system/actions/restart', {
				token: accounts.owner.token,
				host: `${name}:${port}`,
				origin: `http://${name}:${port}`
			});
			expect([answer.status, answer.body.reason], name).toEqual([503, 'unavailable']);
		}
	});

	it('limit reads and actions per user and minute (429 with Retry-After)', async () => {
		let read;
		for (let i = 0; i < 31; i++) {
			read = await app(windows, accounts.owner, 'GET', '/api/byl/system');
			if (read.status === 429) break;
			expect(read.status).toBe(503);
		}
		expect([read.status, read.body.reason]).toEqual([429, 'rate']);
		expect(Number(read.headers['retry-after'])).toBeGreaterThanOrEqual(1);
		expect(Number(read.headers['retry-after'])).toBeLessThanOrEqual(60);
		expect((await app(windows, accounts.owner, 'GET', '/api/byl/system/logs')).status).toBe(429);
		let act;
		for (let i = 0; i < 11; i++) {
			act = await app(windows, accounts.owner, 'POST', '/api/byl/system/actions/mail-restart');
			if (act.status === 429) break;
			expect(act.status).toBe(503);
		}
		expect([act.status, act.body.reason]).toEqual([429, 'rate']);
		// Another account is refused as before, not by the limit of the owner.
		expect((await app(windows, accounts.other, 'GET', '/api/byl/system')).body.reason).toBe('owner');
	});

	it('write every refusal into the log with reason, action and user, without tokens', async () => {
		let items = [];
		const filter = accounts.superuser.filter("message = 'byl-system: Anfrage abgelehnt'");
		for (let i = 0; i < 40; i++) {
			items = (await accounts.superuser.logs.getList(1, 500, { filter })).items;
			if (items.some((item) => item.data.reason === 'rate')) break;
			await new Promise((done) => setTimeout(done, 250));
		}
		const seen = new Set(items.map((item) => `${item.data.reason}:${item.data.user}`));
		for (const expected of [
			`owner:${accounts.other.id}`,
			`origin:${accounts.owner.id}`,
			`loopback:${accounts.owner.id}`,
			`unknown:${accounts.owner.id}`,
			`unavailable:${accounts.owner.id}`,
			`rate:${accounts.owner.id}`
		]) {
			expect(seen, expected).toContain(expected);
		}
		for (const item of items) {
			expect(item.level).toBe(4);
			expect(Object.keys(item.data).sort()).toEqual(['action', 'ip', 'reason', 'user']);
		}
		const text = JSON.stringify(items);
		for (const secret of [accounts.owner.token, accounts.other.token, accounts.superuserToken, windows.password]) {
			expect(text).not.toContain(secret);
		}
	});
});

describe.skipIf(!WINDOWS)('client address from a trusted proxy header', () => {
	it('refuses an address that is not this machine and lets this machine through', async () => {
		const outside = await app(proxied, accounts.proxiedOwner, 'GET', '/api/byl/system', { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
		expect([outside.status, outside.body.reason]).toEqual([403, 'loopback']);
		const inside = await app(proxied, accounts.proxiedOwner, 'GET', '/api/byl/system', { headers: { 'CF-Connecting-IP': '127.0.0.1' } });
		expect([inside.status, inside.body.reason]).toEqual([503, 'unavailable']);
	});
});

describe('routes of the page System on a server that is not on Windows', () => {
	it('refuse every route with the reason "platform"', async () => {
		for (const path of READ_ROUTES) {
			const answer = await app(linux, accounts.linuxOwner, 'GET', path);
			expect([answer.status, answer.body.reason], path).toEqual([404, 'platform']);
		}
		for (const action of ACTIONS) {
			const answer = await app(linux, accounts.linuxOwner, 'POST', `/api/byl/system/actions/${action}`);
			expect([answer.status, answer.body.reason], action).toEqual([404, 'platform']);
		}
	});

	it('the data layer of the SPA names the reason', async () => {
		expect(await fetchSystemStatus(accounts.linuxOwner.client)).toEqual({ kind: 'denied', reason: 'platform' });
	});
});

describe.skipIf(!WINDOWS)('data layer of the SPA (web/src/lib/data/system.ts)', () => {
	it('turns refusals into their reasons', async () => {
		expect(await fetchSystemStatus(accounts.other.client)).toEqual({ kind: 'denied', reason: 'owner' });
		expect(await fetchSystemDoctor(accounts.other.client)).toEqual({ kind: 'denied', reason: 'owner' });
		expect(await fetchSystemLogs(accounts.proxiedOwner.client)).toEqual({ kind: 'denied', reason: 'unavailable' });
		// Node's fetch sends no Origin, so an action from outside a browser tab is refused.
		expect(await runSystemAction(accounts.proxiedOwner.client, 'restart')).toEqual({ kind: 'denied', reason: 'origin' });
	});

	it('ends with a DataError "session" without a session', async () => {
		const guest = new PocketBase(windows.url);
		guest.autoCancellation(false);
		const failure = await fetchSystemStatus(guest).catch((error) => error);
		expect(failure).toBeInstanceOf(DataError);
		expect(failure.kind).toBe('session');
	});
});
