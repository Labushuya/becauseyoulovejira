// Routes of the page "Einstellungen → Sicherheit" (ADR-0055 §8, plan docs/plan/sicherheit.md, SH-2)
// against an own disposable instance: the overview only for the owner of the instance on this
// machine, the level of the protection and the validity of a sign-in (applied at once), the further
// hosts only through the control script of an own instance, the protocol of failed sign-ins without
// a password, its notice and its cleanup after 30 days. Requests that set Origin go through
// node:http, because fetch sets it itself.

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('security-rules.js');
const DAY_MS = 24 * 60 * 60 * 1000;

let instance;
let superuser;
let owner;
let other;

/** One request; `origin` true sends the Origin of the app (a POST of the app needs it). */
function call(path, { method = 'GET', token, origin = method !== 'GET', body } = {}) {
	const url = new URL(path, instance.url);
	const headers = { Connection: 'close' };
	if (token !== undefined) headers.Authorization = token;
	if (origin) headers.Origin = instance.url;
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	return new Promise((resolve, reject) => {
		const req = request(url, { method, headers, timeout: scaled(30_000) }, (res) => {
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				resolve({ status: res.statusCode, json: text === '' ? null : JSON.parse(text) });
			});
		});
		req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
		req.on('error', reject);
		if (body !== undefined) req.write(JSON.stringify(body));
		req.end();
	});
}

async function account() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	await pb.collection('users').authWithPassword(email, password);
	return { email, password, token: pb.authStore.token };
}

const signIn = (collection, identity, password) =>
	call(`/api/collections/${collection}/auth-with-password`, { method: 'POST', origin: false, body: { identity, password } });

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = new PocketBase(instance.url);
	superuser.autoCancellation(false);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	// The account created first becomes the administrator of the app (ADR-0056 §2).
	owner = await account();
	other = await account();
});

afterAll(async () => {
	await instance?.stop();
});

describe('overview', () => {
	it('answers the owner of the instance only, and only from the address of the app', async () => {
		const answer = await call('/api/byl/security', { token: owner.token });
		expect(answer.status).toBe(200);
		const port = Number(new URL(instance.url).port);
		expect(answer.json).toMatchObject({
			// The harness switches the limiter of the migration off (ADR-0055 §7).
			level: 'off',
			cors: { restricted: true },
			hosts: { own: [`127.0.0.1:${port}`, `localhost:${port}`], active: [], configured: [], editable: false, max: 10 },
			admin: { ips: ['127.0.0.1', '::1'], loopbackOnly: true },
			session: { days: 5, seconds: 432000, choices: [1, 5, 14, 30], standard: 5 },
			secrets: [],
			keys: { count: 0, lastUsedAt: null },
			extension: { built: false, version: '' }
		});
		expect(answer.json.backup.available).toBe(process.platform === 'win32');
		expect(answer.json.backup.target).toBe(false);
		expect((await call('/api/byl/security', { token: other.token })).json.reason).toBe('owner');
		expect((await call('/api/byl/security')).status).toBe(401);
		const superuserAnswer = await call('/api/byl/security', { token: superuser.authStore.token });
		expect(superuserAnswer.status).toBe(403);
	});

	it('names the further hosts of byl-config.json next to those the server started with', async () => {
		writeFileSync(
			join(dirname(instance.dataDir), 'byl-config.json'),
			JSON.stringify({ port: 8090, security: { hosts: ['Rechner.Tailnet.example', 'localhost'] } })
		);
		const answer = await call('/api/byl/security', { token: owner.token });
		expect(answer.json.hosts).toMatchObject({ active: [], configured: ['rechner.tailnet.example'] });
	});
});

describe('settings', () => {
	it('set the level of the protection at once, as rules of PocketBase', async () => {
		const strict = await call('/api/byl/security/settings', { method: 'POST', token: owner.token, body: { level: 'strict' } });
		expect([strict.status, strict.json.level]).toEqual([200, 'strict']);
		const settings = await superuser.settings.getAll();
		expect(settings.rateLimits.enabled).toBe(true);
		expect(settings.rateLimits.rules).toEqual(rules.rateLimitRules('strict'));
		const normal = await call('/api/byl/security/settings', { method: 'POST', token: owner.token, body: { level: 'normal' } });
		expect(normal.json.level).toBe('normal');
		// Back to the state of the harness, so the sign-ins below are not limited.
		await superuser.settings.update({ rateLimits: { enabled: false } });
	});

	it('set the validity of a sign-in for the collection users', async () => {
		const answer = await call('/api/byl/security/settings', { method: 'POST', token: owner.token, body: { days: 14 } });
		expect([answer.status, answer.json.session.days, answer.json.session.seconds]).toEqual([200, 14, 14 * 86400]);
		const users = await superuser.collections.getOne('users');
		expect(users.authToken.duration).toBe(14 * 86400);
		await call('/api/byl/security/settings', { method: 'POST', token: owner.token, body: { days: 5 } });
	});

	it('refuse other values, other accounts and requests without the Origin of the app', async () => {
		for (const [body, problem] of [
			[{}, 'empty'],
			[{ level: 'custom' }, 'level'],
			[{ days: 7 }, 'days']
		]) {
			const answer = await call('/api/byl/security/settings', { method: 'POST', token: owner.token, body });
			expect([answer.status, answer.json.reason, answer.json.problem], JSON.stringify(body)).toEqual([400, 'invalid', problem]);
		}
		const foreign = await call('/api/byl/security/settings', { method: 'POST', token: other.token, body: { level: 'strict' } });
		expect([foreign.status, foreign.json.reason]).toEqual([403, 'owner']);
		const noOrigin = await call('/api/byl/security/settings', { method: 'POST', token: owner.token, origin: false, body: { level: 'strict' } });
		expect([noOrigin.status, noOrigin.json.reason]).toEqual([403, 'origin']);
	});

	it('change the further hosts only through the control script of an own instance', async () => {
		const answer = await call('/api/byl/security/hosts', { method: 'POST', token: owner.token, body: { hosts: ['rechner.tailnet.example'] } });
		// A test instance runs nothing (ADR-0043 §4); off Windows the route is not there at all.
		expect([answer.status, answer.json.reason]).toEqual(process.platform === 'win32' ? [503, 'unavailable'] : [404, 'platform']);
		const viaSystem = await call('/api/byl/system/actions/security-configure', { method: 'POST', token: owner.token });
		expect([viaSystem.status, viaSystem.json.reason]).toEqual([404, 'unknown']);
	});
});

describe('failed sign-ins', () => {
	it('are recorded without a password, grouped, with a notice from ten a day on', async () => {
		const before = await call('/api/byl/security/notice', { token: owner.token });
		expect(before.json).toEqual({ attention: false, count: 0, last: null });
		for (let attempt = 0; attempt < 9; attempt += 1) {
			expect((await signIn('users', owner.email, 'falsch-geraten')).status).toBe(400);
		}
		expect((await signIn('users', 'niemand@example.com', 'falsch-geraten')).status).toBe(400);
		expect((await signIn('_superusers', instance.email, 'falsch-geraten')).status).toBe(400);
		// A right password is no failure.
		expect((await signIn('users', owner.email, owner.password)).status).toBe(200);

		const overview = (await call('/api/byl/security', { token: owner.token })).json;
		expect(overview.logins).toMatchObject({ days: 30, total: 11, lastDay: 11 });
		const groups = overview.logins.groups.map(({ area, identity, known, source, count }) => ({ area, identity, known, source, count }));
		expect(groups).toEqual(
			expect.arrayContaining([
				{ area: 'app', identity: owner.email, known: true, source: 'program', count: 9 },
				{ area: 'app', identity: 'niemand@example.com', known: false, source: 'program', count: 1 },
				{ area: 'admin', identity: instance.email, known: true, source: 'program', count: 1 }
			])
		);
		expect(JSON.stringify(overview.logins)).not.toContain('falsch-geraten');
		const port = Number(new URL(instance.url).port);
		expect(overview.logins.groups[0].host).toBe(`127.0.0.1:${port}`);

		const notice = (await call('/api/byl/security/notice', { token: owner.token })).json;
		expect(notice).toMatchObject({ attention: true, count: 11 });
		expect(notice.last).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect((await call('/api/byl/security/notice', { token: other.token })).status).toBe(403);
		// Nobody reads them through the Record API.
		const pb = new PocketBase(instance.url);
		pb.authStore.save(owner.token, null);
		await expect(pb.collection('login_failures').getList(1, 1)).rejects.toMatchObject({ status: 403 });
	});

	it('go after 30 days with the daily cleanup', async () => {
		const at = (ms) => rules.pocketBaseTime(Date.now() - ms);
		for (const created of [at(31 * DAY_MS), at(29 * DAY_MS)]) {
			const answer = await call('/api/byl-test/login-failures', {
				method: 'POST',
				token: superuser.authStore.token,
				origin: false,
				body: { identity: `alt-${created}@example.com`, created }
			});
			expect(answer.status).toBe(200);
		}
		const cron = await call('/api/crons/byl-login-failures', { method: 'POST', token: superuser.authStore.token, origin: false });
		expect(cron.status).toBe(204);
		// The cron route of PocketBase answers before the job has run.
		const rows = () => superuser.collection('login_failures').getFullList({ filter: 'identity ~ "alt-"' });
		await expect.poll(async () => (await rows()).length, { timeout: scaled(10_000) }).toBe(1);
		expect((await rows())[0].identity).toContain(at(29 * DAY_MS).slice(0, 10));
	});
});
