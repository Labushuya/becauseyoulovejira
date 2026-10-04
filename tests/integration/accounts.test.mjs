// Accounts and the administrator of the app (ADR-0056, E7-1) against an own disposable instance, so
// the first account and its right are known: the right of the first account, the routes of the page
// "Einstellungen → Konten" with every refusal (no session, admin account, not an administrator,
// Origin, own account, last administrator), start passwords and resets that end sessions, disabled
// accounts that cannot sign in, the fields no client changes, names that household members and the
// administrator see without e-mail addresses, the right on every route of an administrator and the
// channels with access data. Requests of the app go through node:http with the Origin of its
// address, like system-route.test.mjs; the data layer of the SPA is checked where it adds something.

import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writtenLogs } from '../support/logs.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';
import {
	changeOwnPassword,
	createAccount,
	fetchAccounts,
	saveOwnName
} from '../../web/src/lib/data/accounts.ts';
import { listPersonNames } from '../../web/src/lib/data/people.ts';

let instance;
let superuser;
const clients = [];

/** One request on a new connection; the body parsed as JSON when it is JSON. */
function call(method, path, { token, origin, body } = {}) {
	const url = new URL(instance.url);
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((done, fail) => {
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
					...(payload ? { 'Content-Type': 'application/json' } : {})
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
					done({ status: response.statusCode, body: parsed, headers: response.headers, text });
				});
			}
		);
		req.once('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
		req.once('error', fail);
		if (payload) req.write(payload);
		req.end();
	});
}

const own = () => `http://127.0.0.1:${new URL(instance.url).port}`;

/** A request of the app: token of `who`, the Origin of its address for a POST. */
function app(who, method, path, body) {
	return call(method, path, { token: who.token, origin: method === 'POST' ? own() : undefined, body });
}

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	clients.push(pb);
	return pb;
}

/** Signs in and returns { id, email, password, token, client }. */
async function signIn(email, password) {
	const pb = client();
	const auth = await pb.collection('users').authWithPassword(email, password);
	return { id: auth.record.id, email, password, token: pb.authStore.token, client: pb };
}

/** An account created by the superuser (the admin UI), signed in. */
async function account(name = '') {
	const email = `konto-${randomBytes(8).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64url');
	await superuser.collection('users').create({ email, password, passwordConfirm: password, name });
	return signIn(email, password);
}

/** An account that the superuser makes an administrator (the admin UI), signed in. */
async function promoted(name) {
	const who = await account(name);
	await superuser.collection('users').update(who.id, { instance_admin: true });
	return who;
}

async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		return { status: error.status, data: error.response?.data ?? {}, message: error.response?.message };
	}
	throw new Error('Expected a rejection.');
}

let admin;
let anna;
let bert;
let clara;
let household;

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	admin = await account('Verwalterin');
	anna = await account('Anna Beispiel');
	bert = await account('Bert Beispiel');
	clara = await account('Clara Beispiel');
	// Anna and Bert share a household, Clara has one of her own (written by the superuser, E7-2 comes later).
	household = await superuser.collection('households').create({ name: 'Zuhause' });
	const alone = await superuser.collection('households').create({ name: 'Allein' });
	await superuser.collection('household_members').create({ household: household.id, user: anna.id, role: 'owner' });
	await superuser.collection('household_members').create({ household: household.id, user: bert.id, role: 'member' });
	await superuser.collection('household_members').create({ household: alone.id, user: clara.id, role: 'owner' });
});

afterAll(async () => {
	for (const pb of clients) await pb.realtime.unsubscribe().catch(() => undefined);
	await instance?.stop();
});

describe('the right "Verwalter der App"', () => {
	it('goes to the first account only', async () => {
		const flags = await superuser.collection('users').getFullList({ sort: 'created,id', fields: 'id,instance_admin,disabled' });
		expect(flags.map((user) => [user.id, user.instance_admin, user.disabled])).toEqual([
			[admin.id, true, false],
			[anna.id, false, false],
			[bert.id, false, false],
			[clara.id, false, false]
		]);
	});

	it('is not changed by an app account through the Record API, not even its own', async () => {
		for (const [who, field, value] of [
			[anna, 'instance_admin', true],
			[anna, 'disabled', true],
			[anna, 'emailVisibility', true],
			[admin, 'instance_admin', false],
			[admin, 'emailVisibility', true]
		]) {
			const refused = await rejection(who.client.collection('users').update(who.id, { [field]: value }));
			expect([refused.status, refused.data[field]?.code], field).toEqual([400, 'validation_account_locked']);
		}
		const record = await superuser.collection('users').getOne(anna.id);
		expect([record.instance_admin, record.disabled, record.emailVisibility]).toEqual([false, false, false]);
	});

	it('keeps one active administrator, also against the superuser', async () => {
		const unset = await rejection(superuser.collection('users').update(admin.id, { instance_admin: false }));
		expect(unset.data.instance_admin?.code).toBe('validation_account_last_admin');
		const disable = await rejection(superuser.collection('users').update(admin.id, { disabled: true }));
		expect(disable.data.disabled?.code).toBe('validation_account_last_admin');
		const remove = await rejection(superuser.collection('users').delete(admin.id));
		expect(remove.status).toBe(400);
		expect((await superuser.collection('users').getOne(admin.id)).instance_admin).toBe(true);
	});
});

describe('names, e-mail addresses and households', () => {
	const ids = (list) => list.map((record) => record.id).sort();

	it('shows an account itself, the members of its households and every account to the administrator', async () => {
		expect(ids(await anna.client.collection('users').getFullList())).toEqual([anna.id, bert.id].sort());
		expect(ids(await bert.client.collection('users').getFullList())).toEqual([anna.id, bert.id].sort());
		expect(ids(await clara.client.collection('users').getFullList())).toEqual([clara.id]);
		expect(ids(await admin.client.collection('users').getFullList())).toEqual(
			[admin.id, anna.id, bert.id, clara.id].sort()
		);
		expect((await rejection(clara.client.collection('users').getOne(anna.id))).status).toBe(404);
		expect((await bert.client.collection('users').getOne(anna.id)).name).toBe('Anna Beispiel');
		expect(await client().collection('users').getFullList()).toEqual([]);
	});

	it('never sends the e-mail address of another account, also not in an expansion', async () => {
		for (const [who, others] of [
			[bert, [anna.id]],
			[admin, [anna.id, bert.id, clara.id]]
		]) {
			const list = await who.client.collection('users').getFullList();
			for (const record of list.filter((entry) => others.includes(entry.id))) {
				expect(record.email, record.id).toBeUndefined();
				expect(JSON.stringify(record)).not.toMatch(/@example\.com/);
			}
			expect(list.find((entry) => entry.id === who.id)?.email).toBe(who.email);
		}
		// A ticket of the household: Bert reads Anna's comment with her name, never her address.
		const ticket = await anna.client
			.collection('tickets')
			.create({ owner: anna.id, household: household.id, title: 'Fenster putzen' });
		await anna.client.collection('comments').create({ ticket: ticket.id, author: anna.id, body: 'Erledige ich.' });
		const comments = await bert.client
			.collection('comments')
			.getFullList({ filter: bert.client.filter('ticket = {:id}', { id: ticket.id }), expand: 'author' });
		expect(comments).toHaveLength(1);
		expect(comments[0].expand?.author?.name).toBe('Anna Beispiel');
		expect(comments[0].expand?.author?.email).toBeUndefined();
		expect(JSON.stringify(comments)).not.toContain(anna.email);
	});

	it('lets the members of a household see each other, nobody else', async () => {
		const rowsOf = async (who) => (await who.client.collection('household_members').getFullList()).map((row) => row.user).sort();
		expect(await rowsOf(anna)).toEqual([anna.id, bert.id].sort());
		expect(await rowsOf(bert)).toEqual([anna.id, bert.id].sort());
		expect(await rowsOf(clara)).toEqual([clara.id]);
		expect(await rowsOf(admin)).toEqual([]);
		const write = await rejection(anna.client.collection('household_members').create({ household: 'x', user: anna.id, role: 'member' }));
		expect(write.status).toBe(403);
	});

	it('changes the own name, trimmed, and refuses an empty or too long one', async () => {
		const users = anna.client.collection('users');
		expect((await users.update(anna.id, { name: '  Anna B.  ' })).name).toBe('Anna B.');
		expect((await rejection(users.update(anna.id, { name: '   ' }))).data.name?.code).toBe('validation_account_name');
		expect((await rejection(users.update(anna.id, { name: 'x'.repeat(101) }))).data.name?.code).toBe(
			'validation_account_name_max'
		);
		expect((await rejection(users.update(bert.id, { name: 'fremd' }))).status).toBe(404);
		await users.update(anna.id, { name: 'Anna Beispiel' });
	});
});

describe('the own password', () => {
	it('changes only with the old one and ends the old sessions', async () => {
		const who = await account('Dora Beispiel');
		const other = await signIn(who.email, who.password);
		const users = who.client.collection('users');
		const wrong = await rejection(
			users.update(who.id, { oldPassword: 'falsch-falsch', password: 'neues-passwort-1', passwordConfirm: 'neues-passwort-1' })
		);
		expect([wrong.status, Object.keys(wrong.data)]).toEqual([400, ['oldPassword']]);
		const short = await rejection(users.update(who.id, { oldPassword: who.password, password: 'kurz', passwordConfirm: 'kurz' }));
		expect([short.status, Object.keys(short.data)]).toEqual([400, ['password']]);
		await users.update(who.id, { oldPassword: who.password, password: 'neues-passwort-1', passwordConfirm: 'neues-passwort-1' });
		expect((await rejection(other.client.collection('users').authRefresh())).status).toBe(401);
		expect((await rejection(signIn(who.email, who.password))).status).toBe(400);
		const again = await signIn(who.email, 'neues-passwort-1');
		expect(again.id).toBe(who.id);
	});
});

describe('routes of the page "Konten": refusals', () => {
	const ROUTES = [
		['GET', '/api/byl/accounts'],
		['POST', '/api/byl/accounts'],
		['POST', '/api/byl/accounts/x/password'],
		['POST', '/api/byl/accounts/x/disabled'],
		['POST', '/api/byl/accounts/x/admin'],
		['POST', '/api/byl/accounts/households/x/owner']
	];

	it('answer 401 without a session and 403 for an admin account', async () => {
		for (const [method, path] of ROUTES) {
			expect((await call(method, path, { origin: own() })).status, path).toBe(401);
			const answer = await call(method, path, { token: superuser.authStore.token, origin: own() });
			expect(answer.status, path).toBe(403);
		}
	});

	it('refuse an account that is not an administrator, with reason "owner"', async () => {
		for (const [method, path] of ROUTES) {
			const answer = await app(anna, method, path, method === 'POST' ? {} : undefined);
			expect([answer.status, answer.body.reason], path).toEqual([403, 'owner']);
		}
	});

	it('refuse a change without the Origin of the app', async () => {
		const answer = await call('POST', '/api/byl/accounts', { token: admin.token, body: { email: 'x@example.com', name: 'X' } });
		expect([answer.status, answer.body.reason]).toEqual([403, 'origin']);
	});
});

describe('routes of the page "Konten": the administrator', () => {
	let created;

	it('lists every account with e-mail, right, switch and creation', async () => {
		const answer = await app(admin, 'GET', '/api/byl/accounts');
		expect(answer.status).toBe(200);
		expect(answer.body.passwordMin).toBe(8);
		const own = answer.body.accounts.find((entry) => entry.id === admin.id);
		expect(own).toMatchObject({ name: 'Verwalterin', email: admin.email, admin: true, disabled: false, self: true });
		expect(answer.body.accounts.find((entry) => entry.id === anna.id)).toMatchObject({
			email: anna.email,
			admin: false,
			self: false
		});
		expect(answer.body.accounts[0].created).toMatch(/^\d{4}-\d{2}-\d{2} /);
		expect(answer.text).not.toMatch(/password"|tokenKey/);
	});

	it('creates an account with a start password shown once', async () => {
		const email = `neu-${randomBytes(6).toString('hex')}@example.com`;
		const answer = await app(admin, 'POST', '/api/byl/accounts', { email: `  ${email}  `, name: '  Emil Beispiel ' });
		expect(answer.status).toBe(201);
		expect(answer.headers['cache-control']).toBe('no-store');
		expect(answer.body.password).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{4}(-[a-km-np-zA-HJ-NP-Z2-9]{4}){3}$/);
		expect(answer.body.account).toMatchObject({ email, name: 'Emil Beispiel', admin: false, disabled: false, self: false });
		created = await signIn(email, answer.body.password);
		expect(created.id).toBe(answer.body.account.id);
		const record = await superuser.collection('users').getOne(created.id);
		expect(record.emailVisibility).toBe(false);
	});

	it('resets a password: shown once, the old sessions end, the new one signs in', async () => {
		const answer = await app(admin, 'POST', `/api/byl/accounts/${created.id}/password`);
		expect(answer.status).toBe(200);
		expect(answer.headers['cache-control']).toBe('no-store');
		expect(answer.body.password).toMatch(/^\S{4}-\S{4}-\S{4}-\S{4}$/);
		expect((await rejection(created.client.collection('users').authRefresh())).status).toBe(401);
		expect((await rejection(signIn(created.email, created.password))).status).toBe(400);
		created = await signIn(created.email, answer.body.password);
	});

	it('disables an account: sessions end, sign-in refused with a clear text; enabling lets it in again', async () => {
		const disabled = await app(admin, 'POST', `/api/byl/accounts/${created.id}/disabled`, { disabled: true });
		expect([disabled.status, disabled.body.account.disabled]).toEqual([200, true]);
		expect((await rejection(created.client.collection('users').authRefresh())).status).toBe(401);
		const refused = await rejection(signIn(created.email, created.password));
		expect(refused.status).toBe(403);
		expect(refused.message).toBe('Dieses Konto ist deaktiviert. Bitte wende dich an den Verwalter der App.');

		const enabled = await app(admin, 'POST', `/api/byl/accounts/${created.id}/disabled`, { disabled: false });
		expect([enabled.status, enabled.body.account.disabled]).toEqual([200, false]);
		created = await signIn(created.email, created.password);
	});

	it('gives and takes the right; the new administrator reaches the page, the old one keeps it', async () => {
		const given = await app(admin, 'POST', `/api/byl/accounts/${created.id}/admin`, { admin: true });
		expect([given.status, given.body.account.admin]).toEqual([200, true]);
		expect((await app(created, 'GET', '/api/byl/accounts')).status).toBe(200);
		const taken = await app(created, 'POST', `/api/byl/accounts/${admin.id}/admin`, { admin: false });
		expect([taken.status, taken.body.account.admin]).toEqual([200, false]);
		expect((await app(admin, 'GET', '/api/byl/accounts')).body.reason).toBe('owner');
		const back = await app(created, 'POST', `/api/byl/accounts/${admin.id}/admin`, { admin: true });
		expect(back.status).toBe(200);
		expect((await app(admin, 'POST', `/api/byl/accounts/${created.id}/admin`, { admin: false })).status).toBe(200);
	});

	it('refuses a taken address (any case), an invalid address and a missing name', async () => {
		// A further administrator of its own: every account has 10 changes per minute (ADR-0043 §4).
		const vera = await promoted('Vera Beispiel');
		for (const [body, problem] of [
			[{ email: anna.email.toUpperCase(), name: 'Doppelt' }, 'email-taken'],
			[{ email: 'kein-at.example.com', name: 'X' }, 'email'],
			[{ email: 'leer@example.com', name: '  ' }, 'name'],
			[{ email: 'lang@example.com', name: 'x'.repeat(101) }, 'name-long'],
			[null, 'email']
		]) {
			const answer = await app(vera, 'POST', '/api/byl/accounts', body);
			expect([answer.status, answer.body.reason, answer.body.problem], JSON.stringify(body)).toEqual([400, 'invalid', problem]);
		}
	});

	it('refuses changes of the own account, unknown accounts and bodies without the switch', async () => {
		const willi = await promoted('Willi Beispiel');
		for (const [path, body, status, problem] of [
			[`/api/byl/accounts/${willi.id}/disabled`, { disabled: true }, 400, 'self-disable'],
			[`/api/byl/accounts/${willi.id}/admin`, { admin: false }, 400, 'self-admin'],
			[`/api/byl/accounts/${willi.id}/password`, undefined, 400, 'self-password'],
			['/api/byl/accounts/abcdefghijklmno/disabled', { disabled: true }, 404, 'missing'],
			[`/api/byl/accounts/${anna.id}/disabled`, { disabled: 'ja' }, 400, 'format'],
			[`/api/byl/accounts/${anna.id}/admin`, {}, 400, 'format']
		]) {
			const answer = await app(willi, 'POST', path, body);
			expect([answer.status, answer.body.problem], path).toEqual([status, problem]);
		}
	});

	it('logs actions and refusals without e-mail addresses and passwords', async () => {
		const entries = await writtenLogs(superuser);
		const own = entries.filter((entry) => String(entry.message).startsWith('byl-accounts:'));
		const actions = own.filter((entry) => entry.message === 'byl-accounts: Aktion ausgeführt').map((entry) => entry.data.action);
		for (const action of ['create', 'password', 'disable', 'enable', 'admin-on', 'admin-off']) {
			expect(actions, action).toContain(action);
		}
		expect(own.some((entry) => entry.message === 'byl-accounts: Anfrage abgelehnt' && entry.data.reason === 'owner')).toBe(true);
		expect(own.some((entry) => entry.message === 'byl-accounts: Eingabe abgelehnt' && entry.data.problem === 'email-taken')).toBe(true);
		const text = JSON.stringify(own);
		expect(text).not.toMatch(/@example\.com/);
		expect(text).not.toContain(created.password);
	});
});

describe('the right on every route of an administrator', () => {
	// Each route checks the right before anything else of its own: an account without it gets
	// "owner", the administrator passes that check (and is refused later only for other reasons of
	// a test instance, never "owner").
	const ROUTES = [
		['GET', '/api/byl/storage'],
		['GET', '/api/byl/security'],
		['GET', '/api/byl/security/notice'],
		['GET', '/api/byl/accounts'],
		['GET', '/api/byl/folders/items/abcdefghijklmno'],
		// System and Sicherung refuse other servers first with "platform".
		...(process.platform === 'win32'
			? [
					['GET', '/api/byl/system'],
					['GET', '/api/byl/backup'],
					['GET', '/api/byl/backup/notice']
				]
			: [])
	];

	it.each(ROUTES)('%s %s', async (method, path) => {
		const refused = await app(clara, method, path);
		expect([refused.status, refused.body.reason]).toEqual([403, 'owner']);
		const passed = await app(admin, method, path);
		expect(passed.body?.reason).not.toBe('owner');
	});
});

describe('data layer of the SPA (web/src/lib/data/accounts.ts, people.ts)', () => {
	it('reads the accounts for the administrator and names the refusal for others', async () => {
		const answer = await fetchAccounts(admin.client);
		expect(answer.kind).toBe('ok');
		expect(answer.value.accounts.some((entry) => entry.id === anna.id && entry.email === anna.email)).toBe(true);
		expect(await fetchAccounts(clara.client)).toEqual({ kind: 'denied', reason: 'owner' });
		// Node's fetch sends no Origin, so a change from outside a browser tab is refused.
		expect(await createAccount(admin.client, { email: 'x@example.com', name: 'X' })).toEqual({
			kind: 'denied',
			reason: 'origin'
		});
	});

	it('reads the names of the own household without addresses', async () => {
		const names = await listPersonNames(bert.client);
		expect(names.find((entry) => entry.id === anna.id)).toEqual({ id: anna.id, name: 'Anna Beispiel' });
		expect(JSON.stringify(names)).not.toContain('@');
		expect((await listPersonNames(clara.client)).map((entry) => entry.id)).toEqual([clara.id]);
	});

	it('changes the own name and password and stays signed in with the new token', async () => {
		const who = await account('Erik Beispiel');
		expect(await saveOwnName(who.client, who.id, 'Erik B.')).toBe('Erik B.');
		const before = who.client.authStore.token;
		await changeOwnPassword(who.client, { id: who.id, email: who.email, current: who.password, next: 'erik-neu-12345' });
		expect(who.client.authStore.token).not.toBe(before);
		expect(who.client.authStore.isValid).toBe(true);
		expect((await who.client.collection('users').getOne(who.id)).name).toBe('Erik B.');
		const wrong = await changeOwnPassword(who.client, {
			id: who.id,
			email: who.email,
			current: 'falsch-falsch',
			next: 'erik-neu-67890'
		}).catch((error) => error);
		expect([wrong.kind, Object.keys(wrong.fields)]).toEqual(['validation', ['oldPassword']]);
	});
});

describe('a household without an active owner (E7-4, ADR-0060 §6)', () => {
	it('names the household an account owns and lists only households without an active owner', async () => {
		const list = await app(admin, 'GET', '/api/byl/accounts');
		expect(list.body.accounts.find((entry) => entry.id === anna.id).owns).toEqual({ id: household.id, name: 'Zuhause' });
		expect(list.body.accounts.find((entry) => entry.id === bert.id).owns).toBeNull();
		expect(list.body.households.some((entry) => entry.id === household.id)).toBe(false);
	});

	it('lets the administrator make an active member the owner once the owner is disabled', async () => {
		// An administrator of its own: every account has 10 changes per minute (ADR-0043 §4).
		const petra = await promoted('Petra Beispiel');
		const olga = await account('Olga Beispiel');
		const max = await account('Max Beispiel');
		const sina = await account('Sina Beispiel');
		const home = await superuser.collection('households').create({ name: 'Wohnung' });
		const rows = {};
		for (const [who, role] of [
			[olga, 'owner'],
			[max, 'member'],
			[sina, 'member']
		]) {
			rows[who.id] = await superuser.collection('household_members').create({ household: home.id, user: who.id, role });
		}
		const path = `/api/byl/accounts/households/${home.id}/owner`;
		const active = await app(petra, 'POST', path, { member: rows[max.id].id });
		expect([active.status, active.body.problem]).toEqual([409, 'owner-active']);

		await superuser.collection('users').update(olga.id, { disabled: true });
		await superuser.collection('users').update(sina.id, { disabled: true });
		const list = await app(petra, 'GET', '/api/byl/accounts');
		expect(list.body.accounts.find((entry) => entry.id === olga.id).owns).toEqual({ id: home.id, name: 'Wohnung' });
		expect(list.body.households.find((entry) => entry.id === home.id)).toEqual({
			id: home.id,
			name: 'Wohnung',
			owner: { id: olga.id, name: 'Olga Beispiel' },
			members: [
				{ id: rows[max.id].id, user: max.id, name: 'Max Beispiel', disabled: false },
				{ id: rows[sina.id].id, user: sina.id, name: 'Sina Beispiel', disabled: true }
			]
		});

		for (const [target, body, status, problem] of [
			[path, {}, 400, 'format'],
			[path, { member: 'abcdefghijklmno' }, 404, 'member'],
			[path, { member: rows[sina.id].id }, 400, 'member-disabled'],
			['/api/byl/accounts/households/abcdefghijklmno/owner', { member: rows[max.id].id }, 404, 'household-missing']
		]) {
			const refused = await app(petra, 'POST', target, body);
			expect([refused.status, refused.body.problem], JSON.stringify(body)).toEqual([status, problem]);
		}

		const changed = await app(petra, 'POST', path, { member: rows[max.id].id });
		expect(changed.status).toBe(200);
		expect(changed.body.households.some((entry) => entry.id === home.id)).toBe(false);
		expect(changed.body.accounts.find((entry) => entry.id === max.id).owns).toEqual({ id: home.id, name: 'Wohnung' });
		const after = await superuser.collection('household_members').getFullList({
			filter: superuser.filter('household = {:h}', { h: home.id }),
			sort: 'created,id'
		});
		expect(after.map((row) => [row.user, row.role, row.rights])).toEqual([
			[olga.id, 'member', ['invite', 'remove', 'delegate', 'rename', 'purge', 'move_out']],
			[max.id, 'owner', []],
			[sina.id, 'member', []]
		]);
		// The new owner manages the household on his page now.
		const state = await max.client.send('/api/byl/household', { method: 'GET', requestKey: null });
		expect(state.me.role).toBe('owner');
	});
});

describe('channels with access data and folders (ADR-0056 §5)', () => {
	const CONNECTIONS = [
		{ type: 'calendar', label: 'Kalender', secret_env: 'BYL_KALENDER', settings: { keywords: ['todo'] } },
		{ type: 'telegram', label: 'Bot', secret_env: 'BYL_BOT', settings: { allowed_env: 'BYL_BOT_CHATS', keywords: [] } },
		{ type: 'mail', label: 'Postfach', secret_env: 'BYL_POST', settings: { provider: 'gmail', user: 'post@example.com', keywords: [] } },
		{ type: 'notion', label: 'Notion', secret_env: 'BYL_NOTION' },
		{ type: 'github', label: 'GitHub', secret_env: 'BYL_GITHUB', settings: { interval: 15, repos: [] } },
		{ type: 'folder', label: 'Ordner', secret_env: '', settings: { interval: 5, folders: [] } }
	];

	it('are set up only by the administrator', async () => {
		for (const connection of CONNECTIONS) {
			const refused = await rejection(clara.client.collection('connections').create({ ...connection, owner: clara.id, enabled: true }));
			expect([refused.status, refused.data.type?.code], connection.type).toEqual([400, 'validation_connection_admin_only']);
		}
		const allowed = await admin.client
			.collection('connections')
			.create({ ...CONNECTIONS[0], owner: admin.id, enabled: true });
		expect(allowed.type).toBe('calendar');
	});

	it('are changed only by the administrator, also when they belong to another account', async () => {
		const connection = await superuser
			.collection('connections')
			.create({ ...CONNECTIONS[0], owner: clara.id, enabled: true });
		const rename = await rejection(clara.client.collection('connections').update(connection.id, { label: 'Neu' }));
		expect(rename.data.type?.code).toBe('validation_connection_admin_only');
		await clara.client.collection('connections').delete(connection.id);
	});
});
