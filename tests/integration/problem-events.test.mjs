// The error log of the server (FP-2, ADR-0077) against an own disposable PocketBase with the scenario
// of the areas (tests/support/scenario.mjs): A and B share a household, C founds another one later,
// which the administrator D joins. The wrapper of every request: an unexpected 5xx and a failure of
// the app that PocketBase answers with 400 (a plain Error of a hook, an Error of a model hook behind
// "Failed to create record.") keep an entry and name it in X-Byl-Problem, the answer stays that of
// PocketBase; a refusal, a validation, a missing record, an unreadable or too large body, a cancelled
// request, the deliberate 503 and an answer the route writes keep none. The same failure counts on its
// entry. Who sees what: a private entry only its owner, also not the administrator; one of a household
// its current members, not those of another household; one of the app the administrator; filters do
// not widen that, the fingerprint can neither be filtered nor sorted. Writing through the record API is
// refused to every account. The list of the page "Fehlerprotokoll" (FP-3): filtered by source and area
// and paged by the keyset, every entry once, and its filters only narrow. A failed run of a channel, of "Verbindung prüfen" of GitHub and of the mail
// helper keeps an entry with the connection, without its secrets, and "Details" of the page finds the
// entry of the error shown. Jobs of the server: a failed cron job and the catch-up at the start keep
// an entry for the administrator. The limits: 30 days and 5000 entries, by the cron and with every new
// entry. Before the migration nothing changes. Values of secrets are invented.

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppUser, createClient, userClient } from '../support/api.mjs';
import { startFakeGitHub } from '../support/fake-github.mjs';
import { allLogEntries } from '../support/logs.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { createAreaScenario } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import { runConnection } from '../../web/src/lib/data/connections.ts';
import { channelProblemHits, getServerProblem, listServerProblemPage, listServerProblems } from '../../web/src/lib/data/server-problems.ts';
import { SERVER_PROBLEMS_PAGE, channelProblemKey, channelProblemsSince, matchChannelProblems } from '../../web/src/lib/domain/server-problems.ts';

const POLL_TIMEOUT_MS = scaled(10_000);
const DAY_MS = 24 * 60 * 60 * 1000;
const HEADER = 'X-Byl-Problem';
const PROBLEM_EVENTS_MIGRATION = '1790205100_problem_events.js';
const PATH_SECRET = `pfad-${randomBytes(8).toString('hex')}`;
const QUERY_SECRET = `abfrage-${randomBytes(8).toString('hex')}`;
const INGEST_TOKEN = randomBytes(24).toString('base64');
const MAIL_PASSWORD = `pw-${randomBytes(12).toString('hex')}`;
// Invented tokens of GitHub, built from parts so no scanner takes them for real ones.
const GITHUB_TOKEN = 'github' + '_pat_' + '11FAKE0FP2ERFUNDEN' + 'NurFuerTests_' + 'c'.repeat(50);
const GITHUB_WRONG = 'github' + '_pat_' + '11FAKE0FP2FALSCH00' + 'NurFuerTests_' + 'd'.repeat(50);
// The secrets the fixture route names in its message (tests/fixtures/pb_hooks/problem-events-probe.pb.js).
const ROUTE_SECRETS = ['geheim-wert-123', 'abc.def.ghi', 'anna@example.com', 'abfrage-geheim'];
const UNEXPECTED = 'http_400_unexpected';

let instance;
let github;
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

/** A POST with a body of JSON (or a broken one, as text). */
const post = (body) => ({
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: typeof body === 'string' ? body : JSON.stringify(body)
});

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
const asSuperuser = () => ({ client: superuser });

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
	github = await startFakeGitHub({ token: GITHUB_TOKEN });
	instance = await startPocketBase({
		env: {
			BYL_TEST_FP2_CAL: `http://127.0.0.1:9/${PATH_SECRET}/kalender.ics?token=${QUERY_SECRET}`,
			BYL_INGEST_TOKEN: INGEST_TOKEN,
			BYL_TEST_FP2_MAIL_PASSWORD: MAIL_PASSWORD,
			BYL_TEST_GITHUB_PORT: String(github.port),
			BYL_TEST_FP2_GH: GITHUB_TOKEN,
			BYL_TEST_FP2_GH_WRONG: GITHUB_WRONG
		}
	});
	({ superuser, a, b, c, householdId } = await createAreaScenario(instance));
	const user = await createAppUser(superuser);
	await superuser.collection('users').update(user.record.id, { instance_admin: true });
	admin = { id: user.record.id, client: await userClient(user, instance.url) };
});

afterAll(async () => {
	await instance?.stop();
	await github?.close();
});

describe('the wrapper of every request', () => {
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

	it('keeps a plain Error of a hook, which PocketBase answers with 400, and names its entry', async () => {
		const answer = await call('/api/byl-test/problems/crash', a);
		expect(answer.status).toBe(400);
		expect(answer.json).toEqual({ data: {}, message: 'Something went wrong while processing your request.', status: 400 });
		expect(answer.problem).toMatch(/^[a-z0-9]{15}$/);
		expect(await events(a).getOne(answer.problem)).toMatchObject({
			source: 'request',
			area: 'private',
			owner: a.id,
			code: UNEXPECTED,
			message: 'Kaputt im Hook',
			context: { method: 'GET', route: '/api/byl-test/problems/crash', status: 400 }
		});
	});

	it('keeps an Error of a model hook behind "Failed to create record.", of a superuser for the administrator', async () => {
		const at = '2026-11-02 10:00:00.000Z';
		const answer = await call(
			'/api/collections/problem_events/records',
			asSuperuser(),
			post({ source: 'job', area: 'system', code: '__byl_fail_problem_create__', fingerprint: 'f'.repeat(64), count: 1, first_at: at, last_at: at })
		);
		expect([answer.status, answer.json.message, answer.json.data]).toEqual([400, 'Failed to create record.', {}]);
		const entry = await events(admin).getOne(answer.problem);
		expect(entry).toMatchObject({
			source: 'request',
			area: 'system',
			owner: '',
			household: '',
			code: UNEXPECTED,
			message: 'Failed to create record.: Error: Kaputt im Model-Hook',
			context: { method: 'POST', route: '/api/collections/problem_events/records', status: 400 }
		});
		expect(await statusOf(events(a).getOne(answer.problem))).toBe(404);
		// Any failed request of a superuser belongs to the app.
		const crash = await call('/api/byl-test/problems/crash', asSuperuser());
		expect(await events(admin).getOne(crash.problem)).toMatchObject({ area: 'system', owner: '', code: UNEXPECTED });
	});

	it('keeps nothing for a refusal, a validation, a missing record, a body that is broken or too large, the deliberate 503 or a 500 the route writes itself', async () => {
		const before = await total();
		const expected = [
			['refusal', await call('/api/byl-test/problems/refuse', a), 400],
			['deliberate 503', await call('/api/byl-test/problems/unavailable', a), 503],
			['written by the route', await call('/api/byl-test/problems/written', a), 500],
			['missing record of the record API', await call('/api/collections/tickets/records/abcdefghij12345', a), 404],
			['validation of save()', await call('/api/byl-test/problems/invalid', a), 400],
			['no rows', await call('/api/byl-test/problems/gone', a), 404],
			['broken body', await call('/api/byl-test/problems/body', a, post('{"titel": kaputt}')), 400],
			['too large body', await call('/api/byl-test/problems/body', a, post({ text: 'x'.repeat(500) })), 413],
			['validation of the record API', await call('/api/collections/problem_events/records', asSuperuser(), post({})), 400],
			['create rule of the record API', await call('/api/collections/tickets/records', c, post({ owner: a.id, title: 'Fremd' })), 400],
			['filter of the record API', await call(`/api/collections/problem_events/records?filter=${encodeURIComponent('fingerprint != ""')}`, a), 400]
		];
		for (const [label, answer, status] of expected) expect([label, answer.status, answer.problem]).toEqual([label, status, null]);
		expect(expected[2][1].json.message).toBe('Von der Route selbst geschrieben.');
		// The validations answer with their fields, as before.
		for (const index of [4, 8]) expect(Object.keys(expected[index][1].json.data).length).toBeGreaterThan(0);
		expect(await total()).toBe(before);
	});

	it('keeps nothing for a request the client cancelled', async () => {
		const before = await total();
		const state = async () => (await superuser.send('/api/byl-test/problems/cancelled/state', {})).state;
		const controller = new AbortController();
		const pending = fetch(`${instance.url}/api/byl-test/problems/cancelled`, {
			headers: { Authorization: a.client.authStore.token },
			signal: controller.signal
		}).catch((error) => error);
		await eventually(async () => (await state()) === 'waiting', 'The route did not start');
		controller.abort();
		await pending;
		await eventually(async () => (await state()) === 'cancelled', 'The route did not see the cancelled request');
		// PocketBase logs a request after the wrapper is through with it.
		const logged = superuser.filter('data.url = {:url}', { url: '/api/byl-test/problems/cancelled' });
		await eventually(async () => (await allLogEntries(superuser, logged)).length > 0, 'PocketBase did not log the cancelled request');
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
	let otherHousehold;
	let theirs;
	let privateOfC;

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
		// C founds a household of its own, the administrator joins it with a code.
		otherHousehold = (await c.send('/api/byl/household', { name: `Haus ${randomBytes(4).toString('hex')}` })).household.id;
		const { code } = await c.send('/api/byl/household/invites', {});
		await admin.client.send('/api/byl/household/join', { method: 'POST', body: { code }, requestKey: null });
		theirs = await record({ source: 'job', area: 'household', household: otherHousehold, code: 'recurrence_failed', message: 'Andere Regel', context: { job: 'recurrence' } });
		privateOfC = await record({ source: 'job', area: 'private', owner: c.id, code: 'recurrence_failed', message: 'Regel von C', context: { job: 'recurrence' } });
		for (const id of [own, shared, app, theirs, privateOfC]) expect(id).toMatch(/^[a-z0-9]{15}$/);
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

	it('shows an entry of the household to its members only, not to the members of another household', async () => {
		const entry = await events(b).getOne(shared);
		expect(entry).toMatchObject({ source: 'job', area: 'household', owner: '', household: householdId, code: 'recurrence_failed' });
		expect(await visibleIds(a)).toContain(shared);
		// C and the administrator are members of the other household.
		for (const other of [c, admin]) {
			expect(await statusOf(events(other).getOne(shared))).toBe(404);
			expect(await visibleIds(other)).not.toContain(shared);
			expect((await events(other).getOne(theirs)).household).toBe(otherHousehold);
		}
		for (const member of [a, b]) {
			expect(await statusOf(events(member).getOne(theirs))).toBe(404);
			expect(await visibleIds(member)).not.toContain(theirs);
		}
	});

	it('shows the administrator in a household no private entry of its members', async () => {
		expect((await events(c).getOne(privateOfC)).owner).toBe(c.id);
		for (const id of [own, privateOfC]) expect(await statusOf(events(admin).getOne(id))).toBe(404);
		const seen = await visibleIds(admin);
		expect(seen).toContain(theirs);
		expect(seen).toContain(app);
		expect(seen).not.toContain(privateOfC);
	});

	it('widens nothing through a filter and neither filters nor sorts by the fingerprint', async () => {
		const listWith = async (who, options) => {
			try {
				return { status: 200, ids: (await events(who).getList(1, 200, options)).items.map((entry) => entry.id) };
			} catch (error) {
				return { status: error.status, ids: [] };
			}
		};
		for (const [filter, status] of [
			[`@collection.household_members.household ?= "${householdId}"`, 403],
			[`@collection.household_members:z.user ?= "${a.id}" && household = "${householdId}"`, 403],
			[`household = "${householdId}"`, 200],
			[`id = "${shared}"`, 200],
			['(area = "household") || id != ""', 200]
		]) {
			const answer = await listWith(c, { filter });
			expect([filter, answer.status]).toEqual([filter, status]);
			expect(answer.ids).not.toContain(shared);
		}
		expect((await listWith(a, { filter: 'fingerprint != ""' })).status).toBe(400);
		expect((await listWith(a, { sort: 'fingerprint' })).status).toBe(400);
		expect(Object.keys(await events(a).getOne(own, { fields: 'id,fingerprint' }))).toEqual(['id']);
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

	it('hides the entries of the household from a member who left (ADR-0058 §5)', async () => {
		await b.send('/api/byl/household/leave', {});
		expect(await statusOf(events(b).getOne(shared))).toBe(404);
		expect(await visibleIds(b)).not.toContain(shared);
		expect((await events(a).getOne(shared)).id).toBe(shared);
	});
});

// FP-3 (ADR-0077 addendum FP-3): the list of the page "Fehlerprotokoll" through the data layer of the
// SPA, filtered by source and area and paged by the keyset of the sort -last_at,-id.
describe('the page "Fehlerprotokoll" (FP-3)', () => {
	const at = (ms) => new Date(Date.now() - ms).toISOString().replace('T', ' ');
	const ids = (page) => page.records.map((entry) => entry.id);
	let ownOfA;
	let ofHousehold;

	beforeAll(async () => {
		// More than one page of entries of the app with the same last occurrence: there the keyset
		// goes by the ID. An hour old, newer than the entries of the limits below.
		await superuser.send('/api/byl-test/problems/aged', {
			method: 'POST',
			body: { count: SERVER_PROBLEMS_PAGE + 5, prefix: 'fp3k', last_at: at(60 * 60 * 1000) }
		});
		ownOfA = (await call('/api/byl-test/problems/fail', a)).problem;
		ofHousehold = await record({
			source: 'job',
			area: 'household',
			household: householdId,
			code: 'recurrence_failed',
			message: 'Regel des Haushalts',
			context: { job: 'recurrence' }
		});
	});

	it('pages through the entries of a filter by the keyset, none twice and none left out', async () => {
		const expected = (
			await events(admin).getFullList({ filter: 'source = "job" && area = "system"', sort: '-last_at,-id', fields: 'id' })
		).map((entry) => entry.id);
		expect(expected.length).toBeGreaterThan(SERVER_PROBLEMS_PAGE);
		const seen = [];
		let after = null;
		for (let step = 0; step < 5; step++) {
			const page = await listServerProblemPage(admin.client, { source: 'job', area: 'system', after });
			expect(page.records.length).toBeLessThanOrEqual(SERVER_PROBLEMS_PAGE);
			for (const entry of page.records) expect([entry.source, entry.area]).toEqual(['job', 'system']);
			seen.push(...ids(page));
			if (page.next === null) break;
			after = page.next;
		}
		expect(seen).toEqual(expected);
		expect(new Set(seen).size).toBe(seen.length);
		expect(seen.filter((id) => id.startsWith('fp3k'))).toHaveLength(SERVER_PROBLEMS_PAGE + 5);
	});

	it('only narrows: no filter shows an entry the rules of the server hide', async () => {
		const page = (who, source, area) => listServerProblemPage(who.client, { source, area, after: null });
		// The private entry of A: only A finds it, also with the filter of its source and area.
		expect(ids(await page(a, 'request', 'private'))).toContain(ownOfA);
		for (const other of [c, admin]) expect(ids(await page(other, 'request', 'private'))).not.toContain(ownOfA);
		// The entry of the household: its members only; C and the administrator are in another one.
		expect(ids(await page(a, null, 'household'))).toContain(ofHousehold);
		for (const other of [c, admin]) expect(ids(await page(other, null, 'household'))).not.toContain(ofHousehold);
		// The app only for the administrator.
		expect(ids(await page(a, null, 'system'))).toEqual([]);
		expect(ids(await page(c, 'job', 'system'))).toEqual([]);
		// Whatever a filter finds, the account sees without one, too.
		for (const who of [a, c, admin]) {
			const visible = new Set(await visibleIds(who));
			for (const area of ['private', 'household', 'system']) {
				for (const id of ids(await page(who, null, area))) expect(visible.has(id), id).toBe(true);
			}
		}
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

		// The way of the card to its entry, through the data layer of the SPA: one query of the page
		// (JSON path of the context), matched to the error of the card, and the entry as the dialog
		// reads it.
		const card = await admin.client.collection('connections').getOne(connection.id);
		const shown = { connection: connection.id, lastError: card.last_error, lastRunAt: card.last_run_at };
		const since = channelProblemsSince([shown]);
		expect(matchChannelProblems([shown], await channelProblemHits(admin.client, [connection.id], since)).get(channelProblemKey(shown))).toBe(run.problem);
		expect(await channelProblemHits(a.client, [connection.id], since)).toEqual([]);
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

	it('keeps the error of "Verbindung prüfen" of GitHub, so "Details" names it and not the older one of a run', async () => {
		github.addRepo('octo/fp2', { files: { 'README.md': '# FP-2\n' } });
		const connection = await superuser.collection('connections').create({
			owner: admin.id,
			type: 'github',
			label: 'GitHub',
			enabled: true,
			secret_env: 'BYL_TEST_FP2_GH_WRONG',
			settings: { repos: [{ repo: 'octo/fp2' }] }
		});
		const run = await runNow(connection.id);
		expect(run.status).toBe('error');
		const older = await events(admin).getOne(run.problem);
		expect(older.message).toContain('BYL_TEST_FP2_GH_WRONG');

		await superuser.collection('connections').update(connection.id, { secret_env: 'BYL_TEST_FP2_GH' });
		github.inject({ path: /^\/user$/, status: 401 });
		const check = await call(`/api/byl/connections/${connection.id}/github/check`, admin, { method: 'POST' });
		expect(check.json).toMatchObject({ status: 'error', message: expect.stringContaining('BYL_TEST_FP2_GH,') });

		const card = await admin.client.collection('connections').getOne(connection.id);
		const shown = { connection: connection.id, lastError: card.last_error, lastRunAt: card.last_run_at };
		const hits = await channelProblemHits(admin.client, [connection.id], channelProblemsSince([shown]));
		const linked = matchChannelProblems([shown], hits).get(channelProblemKey(shown));
		expect(linked).not.toBe(older.id);
		const entry = await events(admin).getOne(linked);
		expect(entry).toMatchObject({
			source: 'channel',
			area: 'private',
			owner: admin.id,
			code: 'channel_error',
			context: { connection: connection.id, channel: 'github' }
		});
		expect(entry.message).toContain('BYL_TEST_FP2_GH,');
		for (const secret of [GITHUB_TOKEN, GITHUB_WRONG]) expect(JSON.stringify(entry)).not.toContain(secret);
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

describe('jobs of the server', () => {
	it('keeps a failed job for the administrator, with its name and without its secret', async () => {
		const id = (await superuser.send('/api/byl-test/problems/job', { method: 'POST', body: { job: 'trash', message: 'Lauf gescheitert mit token=geheim-job-1' } })).id;
		const entry = await events(admin).getOne(id);
		expect(entry).toMatchObject({
			source: 'job',
			area: 'system',
			owner: '',
			household: '',
			code: 'trash_failed',
			message: 'Lauf gescheitert mit token=[entfernt]',
			context: { job: 'trash' }
		});
		for (const other of [a, c]) expect(await statusOf(events(other).getOne(id))).toBe(404);
		// A name of another form stays out of the context.
		const odd = (await superuser.send('/api/byl-test/problems/job', { method: 'POST', body: { job: 'Böse Aufgabe', message: 'x' } })).id;
		expect(await events(admin).getOne(odd)).toMatchObject({ code: 'B_se_Aufgabe_failed', context: {} });
	});

	describe('in an instance of their own', () => {
		let jobs;
		let root;

		const entryOf = async (client, code) =>
			(await client.collection('problem_events').getList(1, 1, { filter: client.filter('code = {:code}', { code }) })).items[0];
		const signIn = async () => {
			root = createClient(jobs.url);
			await root.collection('_superusers').authWithPassword(jobs.email, jobs.password);
		};

		beforeAll(async () => {
			jobs = await startPocketBase();
			await signIn();
		});

		afterAll(async () => {
			await jobs?.stop();
		});

		it('keeps the failure of a cron job (byl-client-ops-cleanup)', async () => {
			const user = await createAppUser(root);
			await root.send('/api/byl-test/client-ops', {
				method: 'POST',
				body: { user: user.record.id, op: `op-${randomBytes(8).toString('hex')}`, created: '2020-01-01 00:00:00.000Z' }
			});
			await root.send('/api/byl-test/problems/break', { method: 'POST', body: { job: 'client-ops' } });
			await root.crons.run('byl-client-ops-cleanup');
			// The cron route of PocketBase answers before the job has run.
			const entry = await eventually(() => entryOf(root, 'client-ops_failed'), 'The failed cron job kept no entry');
			expect(entry).toMatchObject({ source: 'job', area: 'system', owner: '', household: '', context: { job: 'client-ops' } });
			expect(entry.message).toContain('Bereinigung absichtlich gescheitert');
		});

		it('keeps the failure of the catch-up at the start', async () => {
			await root.send('/api/byl-test/problems/break', { method: 'POST', body: { job: 'startup-recurrence' } });
			await jobs.restart();
			await signIn();
			const entry = await eventually(() => entryOf(root, 'startup-recurrence_failed'), 'The failed catch-up kept no entry');
			expect(entry).toMatchObject({ source: 'job', area: 'system', owner: '', context: { job: 'startup-recurrence' } });
		});
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
