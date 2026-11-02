// The error log of the server (FP-2, ADR-0077) against an own disposable PocketBase with the scenario
// of the areas (tests/support/scenario.mjs): A and B share a household, C is alone, D is the
// administrator of the app. The middleware: an unexpected 5xx keeps an entry and names it in
// X-Byl-Problem, the answer stays that of PocketBase; a refusal, the deliberate 503 and an answer the
// route writes keep none. The same failure counts on its entry. Who sees what: a private entry only
// its owner, also not the administrator; one of the household its members; one of the app the
// administrator. Writing through the record API is refused to every account. A failed run of a
// channel and of the mail helper keeps an entry with the connection, without its secrets. The limits:
// 30 days and 5000 entries, by the cron and with every new entry. Before the migration nothing
// changes. Values of secrets are invented.

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppUser, createClient, userClient } from '../support/api.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { createAreaScenario } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import { runConnection } from '../../web/src/lib/data/connections.ts';
import { getServerProblem, latestChannelProblem, listServerProblems } from '../../web/src/lib/data/server-problems.ts';

const POLL_TIMEOUT_MS = scaled(10_000);
const DAY_MS = 24 * 60 * 60 * 1000;
const HEADER = 'X-Byl-Problem';
const PROBLEM_EVENTS_MIGRATION = '1790205100_problem_events.js';
const PATH_SECRET = `pfad-${randomBytes(8).toString('hex')}`;
const QUERY_SECRET = `abfrage-${randomBytes(8).toString('hex')}`;
const INGEST_TOKEN = randomBytes(24).toString('base64');
const MAIL_PASSWORD = `pw-${randomBytes(12).toString('hex')}`;
// The secrets the fixture route names in its message (tests/fixtures/pb_hooks/problem-events-probe.pb.js).
const ROUTE_SECRETS = ['geheim-wert-123', 'abc.def.ghi', 'anna@example.com', 'abfrage-geheim'];

let instance;
let superuser;
let a;
let b;
let c;
let admin;
let householdId;

/** A request to the instance, as the SPA sends it, with the account of `who` (or none). */
async function call(path, who = null, init = {}) {
	const headers = { ...(init.headers ?? {}) };
	if (who !== null) headers.Authorization = who.client.authStore.token;
	const response = await fetch(`${instance.url}${path}`, { ...init, headers });
	const text = await response.text();
	return { status: response.status, problem: response.headers.get(HEADER), json: text === '' ? null : JSON.parse(text) };
}

/** Status of a call of the record API; 200 on success. */
async function statusOf(promise) {
	try {
		await promise;
		return 200;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return error.status;
	}
}

const events = (who) => who.client.collection('problem_events');
const visibleIds = async (who) => (await events(who).getFullList({ sort: '-last_at' })).map((entry) => entry.id);
const total = async () => (await superuser.collection('problem_events').getList(1, 1)).totalItems;
const record = async (input) => (await superuser.send('/api/byl-test/problems/record', { method: 'POST', body: input })).id;

/**
 * "Jetzt abrufen" of the administrator through the data layer of the SPA; a run of the cron job at
 * the same moment is waited for.
 */
async function runNow(id) {
	return eventually(async () => {
		const result = await runConnection(admin.client, id);
		return result.status === 'running' ? null : result;
	}, 'The connection stayed locked');
}

/** Waits until `check` returns something truthy. */
async function eventually(check, label) {
	const deadline = Date.now() + POLL_TIMEOUT_MS;
	for (;;) {
		const result = await check();
		if (result) return result;
		if (Date.now() > deadline) throw new Error(`${label} within ${POLL_TIMEOUT_MS} ms`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

beforeAll(async () => {
	instance = await startPocketBase({
		env: {
			BYL_TEST_FP2_CAL: `http://127.0.0.1:9/${PATH_SECRET}/kalender.ics?token=${QUERY_SECRET}`,
			BYL_INGEST_TOKEN: INGEST_TOKEN,
			BYL_TEST_FP2_MAIL_PASSWORD: MAIL_PASSWORD
		}
	});
	({ superuser, a, b, c, householdId } = await createAreaScenario(instance));
	const user = await createAppUser(superuser);
	await superuser.collection('users').update(user.record.id, { instance_admin: true });
	admin = { id: user.record.id, client: await userClient(user, instance.url) };
});

afterAll(async () => {
	await instance?.stop();
});

describe('the middleware of every request', () => {
	let entryId;

	it('answers an unexpected 5xx as before and names its entry in X-Byl-Problem', async () => {
		const answer = await call('/api/byl-test/problems/fail', a);
		expect(answer.status).toBe(500);
		expect(Object.keys(answer.json).sort()).toEqual(['data', 'message', 'status']);
		expect(answer.json.status).toBe(500);
		expect(answer.problem).toMatch(/^[a-z0-9]{15}$/);
		entryId = answer.problem;

		const entry = await events(a).getOne(entryId);
		expect(entry).toMatchObject({
			source: 'request',
			area: 'private',
			owner: a.id,
			household: '',
			code: 'http_500',
			count: 1,
			context: { method: 'GET', route: '/api/byl-test/problems/fail', status: 500 }
		});
		expect(entry.first_at).toBe(entry.last_at);
		expect(entry).not.toHaveProperty('fingerprint');
		expect(entry.message).toBe('Kaputt bei Zeile 1234: token=[entfernt] und Authorization: [entfernt] für [E-Mail], Abruf von /api/byl/x');
		for (const secret of ROUTE_SECRETS) expect(JSON.stringify(entry)).not.toContain(secret);
	});

	it('counts the same failure on its entry instead of a new one', async () => {
		const before = await total();
		const again = await call('/api/byl-test/problems/fail', a);
		expect(again.problem).toBe(entryId);
		expect(await total()).toBe(before);
		const entry = await events(a).getOne(entryId);
		expect(entry.count).toBe(2);
		expect(entry.last_at >= entry.first_at).toBe(true);
	});

	it('keeps nothing for a refusal, the deliberate 503 or a 500 the route writes itself', async () => {
		const before = await total();
		const refused = await call('/api/byl-test/problems/refuse', a);
		expect([refused.status, refused.problem]).toEqual([400, null]);
		const unavailable = await call('/api/byl-test/problems/unavailable', a);
		expect([unavailable.status, unavailable.problem]).toEqual([503, null]);
		const written = await call('/api/byl-test/problems/written', a);
		expect([written.status, written.problem, written.json.message]).toEqual([500, null, 'Von der Route selbst geschrieben.']);
		const missing = await call('/api/collections/tickets/records/abcdefghij12345', a);
		expect([missing.status, missing.problem]).toEqual([404, null]);
		// A plain Error of a hook: PocketBase 0.40.4 answers it with 400, so it is no 5xx (ADR-0077 §2).
		const crash = await call('/api/byl-test/problems/crash', a);
		expect([crash.status, crash.problem]).toEqual([400, null]);
		expect(await total()).toBe(before);
	});

	it('keeps a failure without an account for the administrator', async () => {
		const answer = await call('/api/byl-test/problems/fail');
		expect(answer.status).toBe(500);
		expect(answer.problem).not.toBe(entryId);
		const entry = await events(admin).getOne(answer.problem);
		expect(entry).toMatchObject({ source: 'request', area: 'system', owner: '', household: '' });
		expect(await statusOf(events(a).getOne(answer.problem))).toBe(404);
	});
});

describe('who sees an entry (ADR-0077 §5)', () => {
	let own;
	let shared;
	let app;

	beforeAll(async () => {
		own = (await call('/api/byl-test/problems/fail', a)).problem;
		const rule = await a.client.collection('recurrence_rules').create({
			owner: a.id,
			household: householdId,
			title: 'Müll rausbringen',
			mode: 'calendar',
			freq: 'weekly',
			initial_status: 'open',
			active: false
		});
		shared = (await superuser.send('/api/byl-test/problems/rule', { method: 'POST', body: { rule: rule.id } })).id;
		app = await record({ source: 'job', area: 'system', code: 'trash_failed', message: 'Papierkorb: Lauf gescheitert', context: { job: 'trash' } });
		for (const id of [own, shared, app]) expect(id).toMatch(/^[a-z0-9]{15}$/);
	});

	it('shows a private entry only to its owner, not to another account and not to the administrator', async () => {
		expect((await events(a).getOne(own)).id).toBe(own);
		for (const other of [b, c, admin]) {
			expect(await statusOf(events(other).getOne(own))).toBe(404);
			expect(await visibleIds(other)).not.toContain(own);
			expect((await listServerProblems(other.client)).map((entry) => entry.id)).not.toContain(own);
		}
		expect(await visibleIds(a)).toContain(own);
		// The list of the dialog, newest first, as the data layer of the SPA reads it.
		const listed = await listServerProblems(a.client);
		expect(listed.map((entry) => entry.id)).toContain(own);
		expect(listed.map((entry) => entry.lastAt)).toEqual([...listed.map((entry) => entry.lastAt)].sort((x, y) => y - x));
	});

	it('shows an entry of the household to its members only', async () => {
		const entry = await events(b).getOne(shared);
		expect(entry).toMatchObject({ source: 'job', area: 'household', owner: '', household: householdId, code: 'recurrence_failed' });
		expect(await visibleIds(a)).toContain(shared);
		for (const other of [c, admin]) expect(await statusOf(events(other).getOne(shared))).toBe(404);
	});

	it('shows an entry of the app only to the administrator', async () => {
		expect((await events(admin).getOne(app)).area).toBe('system');
		for (const other of [a, b, c]) expect(await statusOf(events(other).getOne(app))).toBe(404);
		const anonymous = createClient(instance.url);
		expect((await anonymous.collection('problem_events').getList(1, 50)).items).toEqual([]);
		expect(await statusOf(anonymous.collection('problem_events').getOne(app))).toBe(404);
	});

	it('refuses create, update and delete through the record API to every account', async () => {
		const count = (await events(a).getOne(own)).count;
		for (const [who, id] of [
			[a, own],
			[b, shared],
			[admin, app]
		]) {
			expect(await statusOf(events(who).create({ source: 'job', area: 'system', fingerprint: 'f'.repeat(64), count: 1 }))).toBe(403);
			expect(await statusOf(events(who).update(id, { count: 99, message: 'geändert' }))).toBe(403);
			expect(await statusOf(events(who).delete(id))).toBe(403);
		}
		expect((await events(a).getOne(own)).count).toBe(count);
	});
});

describe('failures of the channels', () => {
	it('keeps a failed run with the connection, private to its owner and without its secrets', async () => {
		const connection = await admin.client.collection('connections').create({
			owner: admin.id,
			type: 'calendar',
			label: 'Kalender mit geheimer Adresse',
			enabled: true,
			secret_env: 'BYL_TEST_FP2_CAL',
			settings: { keywords: ['#byl'] }
		});
		const run = await runNow(connection.id);
		expect(run.status).toBe('error');
		expect(run.problem).toMatch(/^[a-z0-9]{15}$/);
		const entry = await events(admin).getOne(run.problem);
		expect(entry).toMatchObject({
			source: 'channel',
			area: 'private',
			owner: admin.id,
			code: 'channel_error',
			count: 1,
			context: { connection: connection.id, channel: 'calendar' }
		});
		expect(JSON.stringify(entry)).not.toContain(PATH_SECRET);
		expect(JSON.stringify(entry)).not.toContain(QUERY_SECRET);
		expect(await statusOf(events(a).getOne(run.problem))).toBe(404);

		// The way of the card to its entry, through the data layer of the SPA: the newest entry of the
		// connection (JSON path of the context), and the entry as the dialog reads it.
		expect(await latestChannelProblem(admin.client, connection.id)).toBe(run.problem);
		expect(await latestChannelProblem(a.client, connection.id)).toBeNull();
		expect(await getServerProblem(admin.client, run.problem)).toMatchObject({
			id: run.problem,
			source: 'channel',
			area: 'private',
			context: { connection: connection.id, channel: 'calendar' }
		});
		await expect(getServerProblem(a.client, run.problem)).rejects.toMatchObject({ kind: 'not_found' });

		const again = await runNow(connection.id);
		expect(again.problem).toBe(run.problem);
		// At least two: the cron of the calendars may have run it in between as well.
		expect((await events(admin).getOne(run.problem)).count).toBeGreaterThanOrEqual(2);
	});

	it('keeps a failed run the mail helper reports, without password and address', async () => {
		const mailbox = await admin.client.collection('connections').create({
			owner: admin.id,
			type: 'mail',
			label: 'Web.de',
			enabled: true,
			secret_env: 'BYL_TEST_FP2_MAIL_PASSWORD',
			settings: { provider: 'webde', user: 'anna@web.de', keywords: ['todo'] }
		});
		const response = await fetch(`${instance.url}/api/byl/ingest/connections/${mailbox.id}/status`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${INGEST_TOKEN}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: `Anmeldung von anna@web.de mit ${MAIL_PASSWORD} abgelehnt` })
		});
		expect(await response.json()).toEqual({ status: 'ok' });
		const found = await events(admin).getList(1, 1, {
			filter: admin.client.filter('source = "channel" && context.connection = {:id}', { id: mailbox.id })
		});
		expect(found.items).toHaveLength(1);
		expect(found.items[0]).toMatchObject({ area: 'private', owner: admin.id, context: { connection: mailbox.id, channel: 'mail' } });
		expect(found.items[0].message).toBe('Anmeldung von [E-Mail] mit *** abgelehnt');
	});
});

describe('the limits (ADR-0077 §3)', () => {
	const at = (ms) => new Date(Date.now() - ms).toISOString().replace('T', ' ');
	const prefixed = async (prefix) =>
		(await superuser.collection('problem_events').getList(1, 1, { filter: superuser.filter('id ~ {:prefix}', { prefix: `${prefix}%` }) }))
			.totalItems;

	it('removes entries 30 days after their last occurrence with the daily cron', async () => {
		const keep = await record({ source: 'job', area: 'system', code: 'recent', message: 'Neu', context: {} });
		await superuser.send('/api/byl-test/problems/aged', { method: 'POST', body: { count: 3, prefix: 'aged', last_at: at(31 * DAY_MS) } });
		expect(await prefixed('aged')).toBe(3);
		await superuser.crons.run('byl-problem-events-cleanup');
		// The cron route of PocketBase answers before the job has run.
		await eventually(async () => (await prefixed('aged')) === 0, 'The old entries did not go');
		expect((await superuser.collection('problem_events').getOne(keep)).code).toBe('recent');
	});

	it('keeps at most the newest 5000 entries, pruned with every new one', async () => {
		const recent = await total();
		await superuser.send('/api/byl-test/problems/aged', { method: 'POST', body: { count: 5000, prefix: 'many', last_at: at(DAY_MS) } });
		expect(await total()).toBe(recent + 5000);
		const newest = await record({ source: 'job', area: 'system', code: 'newest', message: 'Ganz neu', context: {} });
		expect(await total()).toBe(5000);
		expect(await prefixed('many')).toBe(5000 - recent - 1);
		expect((await superuser.collection('problem_events').getOne(newest)).code).toBe('newest');
	});
});

describe('before the migration of the error log', () => {
	let before;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < PROBLEM_EVENTS_MIGRATION });
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('answers an unexpected 5xx as before, without a header, and has no log', async () => {
		const response = await fetch(`${before.url}/api/byl-test/problems/fail`);
		expect(response.status).toBe(500);
		expect(response.headers.get(HEADER)).toBeNull();
		expect(Object.keys(await response.json()).sort()).toEqual(['data', 'message', 'status']);
		const root = createClient(before.url);
		await root.collection('_superusers').authWithPassword(before.email, before.password);
		expect(await statusOf(root.collection('problem_events').getList(1, 1))).toBe(404);
	});
});
