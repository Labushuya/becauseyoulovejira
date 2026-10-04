// Owner, household and scope of a record stay as they are through the Record API (ADR-0058,
// addendum "Bereich eines Eintrags", fix after E7-2): A founds household H1, B joins it with a code,
// C founds H2. A member may not take a household record out of the household (household cleared
// in any form of the body), neither may its owner; nobody changes the owner or the scope, and a
// private record does not move into a household this way either. Unchanged values in the body and
// ordinary fields stay allowed. A new record belongs to the signed-in account and to no household
// without its membership (the create rules, before any request hook); its scope comes from owner and
// household. The superuser and the ways of
// the server (generating, converting, duplicating, restoring, the routes of the household) stay
// free. Against an own disposable instance, so its memberships stay out of the shared instance.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf, statusOf } from '../support/api.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { ownedPayload, scopeOf, uniqueSuffix } from '../support/scenario.mjs';

const ROUTE = '/api/byl/household';
const SCOPED = ['projects', 'tags', 'recurrence_rules', 'tickets', 'inbox_items', 'connections'];
const LOCKED = 'validation_scope_locked';

let instance;
let superuser;
let a;
let b;
let c;
let h1;
let h2;

function createClient() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

/**
 * A new app account with random credentials (in memory only), signed in. Every account is an
 * administrator of the app: only they set up and change connections with access data (ADR-0056 §5),
 * so a refusal of a connection here comes from the scope, not from that right.
 */
async function createAccount() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser
		.collection('users')
		.create({ email, password, passwordConfirm: password, instance_admin: true });
	const client = createClient();
	await client.collection('users').authWithPassword(email, password);
	return { id: record.id, client };
}

const send = (person, path, body, method = 'POST') => person.client.send(path, { method, body, requestKey: null });

function payload(collection, person, household = '') {
	if (collection === 'connections') {
		return {
			owner: person.id,
			household,
			type: 'calendar',
			label: `Kalender ${uniqueSuffix()}`,
			enabled: false,
			secret_env: 'BYL_TEST_CALENDAR'
		};
	}
	return ownedPayload(collection, person.id, household);
}

/**
 * Creates a record of `person`, in `household` when given. Since E7-3 an app account creates no
 * connection in a household (ADR-0059 §5); such connections exist only from before, so the superuser
 * creates them here.
 */
function createOf(collection, person, household = '', extra = {}) {
	const body = { ...payload(collection, person, household), ...extra };
	if (collection === 'connections' && household !== '') return superuser.collection(collection).create(body);
	return person.client.collection(collection).create(body);
}

/** A change of an ordinary field of `collection`. */
function ordinary(collection) {
	switch (collection) {
		case 'projects':
		case 'tags':
			return { name: `neu-${uniqueSuffix()}` };
		case 'connections':
			return { label: `Neu ${uniqueSuffix()}` };
		case 'tickets':
			return { title: `Neu ${uniqueSuffix()}`, status: 'in_progress' };
		default:
			return { title: `Neu ${uniqueSuffix()}` };
	}
}

const stored = (collection, id) => superuser.collection(collection).getOne(id);
const refused = (field, code = LOCKED) => ({ status: 400, codes: { [field]: code } });

/** Stored records with the name or title of `body` (each payload has a unique one). */
async function countOf(collection, body) {
	const field = ['projects', 'tags'].includes(collection) ? 'name' : collection === 'connections' ? 'label' : 'title';
	const found = await superuser
		.collection(collection)
		.getFullList({ filter: superuser.filter(`${field} = {:value}`, { value: body[field] }) });
	return found.length;
}

/** Owner, household and scope of a stored record. */
async function placeOf(collection, id) {
	const record = await stored(collection, id);
	return { owner: record.owner, household: record.household, scope: record.scope };
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = createClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	a = await createAccount();
	b = await createAccount();
	c = await createAccount();
	// The routes of the household (E7-2): A founds H1 and invites B, C founds H2.
	h1 = (await send(a, ROUTE, { name: `Haus ${uniqueSuffix()}` })).household.id;
	const { code } = await send(a, `${ROUTE}/invites`, {});
	await send(b, `${ROUTE}/join`, { code });
	h2 = (await send(c, ROUTE, { name: `Haus ${uniqueSuffix()}` })).household.id;
});

afterAll(async () => {
	await instance?.stop();
});

describe.each(SCOPED)('%s', (collection) => {
	let shared;
	let own;

	beforeAll(async () => {
		shared = await createOf(collection, a, h1);
		own = await createOf(collection, a);
	});

	it('refuses a member to take a household record out of the household, in every form of the body', async () => {
		const records = b.client.collection(collection);
		for (const body of [{ household: '' }, { household: null }, { 'household-': h1 }]) {
			expect(await rejectionOf(records.update(shared.id, body)), JSON.stringify(body)).toEqual(refused('household'));
		}
		const form = new FormData();
		form.append('household', '');
		expect(await rejectionOf(records.update(shared.id, form))).toEqual(refused('household'));
		// A household without membership fails the update rule first (404, as before).
		expect(await statusOf(records.update(shared.id, { household: h2 }))).toBe(404);
		expect(await placeOf(collection, shared.id)).toEqual({ owner: a.id, household: h1, scope: scopeOf(a.id, h1) });
	});

	it('refuses the owner of a household record the same', async () => {
		expect(await rejectionOf(a.client.collection(collection).update(shared.id, { household: '' }))).toEqual(
			refused('household')
		);
		expect((await stored(collection, shared.id)).household).toBe(h1);
	});

	it('refuses a changed scope', async () => {
		for (const [person, scope] of [
			[b, scopeOf(b.id)],
			[a, scopeOf(a.id)],
			[a, scopeOf(c.id, h2)]
		]) {
			expect(await rejectionOf(person.client.collection(collection).update(shared.id, { scope })), scope).toEqual(
				refused('scope')
			);
		}
		expect((await stored(collection, shared.id)).scope).toBe(scopeOf(a.id, h1));
	});

	it('refuses a changed owner', async () => {
		// The update rule keeps the owner since E1 (@request.body.owner:changed = false): 404.
		expect(await statusOf(b.client.collection(collection).update(shared.id, { owner: b.id }))).toBe(404);
		expect(await statusOf(a.client.collection(collection).update(shared.id, { owner: b.id }))).toBe(404);
		expect(await statusOf(a.client.collection(collection).update(own.id, { owner: b.id }))).toBe(404);
		expect((await stored(collection, shared.id)).owner).toBe(a.id);
		expect((await stored(collection, own.id)).owner).toBe(a.id);
	});

	it('accepts unchanged values in the body and changes of ordinary fields', async () => {
		const records = b.client.collection(collection);
		const unchanged = { owner: a.id, household: h1, scope: scopeOf(a.id, h1) };
		expect(await records.update(shared.id, { ...ordinary(collection), ...unchanged })).toMatchObject(unchanged);
		const change = ordinary(collection);
		expect(await records.update(shared.id, change)).toMatchObject({ ...change, ...unchanged });
		expect(await a.client.collection(collection).update(shared.id, ordinary(collection))).toMatchObject(unchanged);
	});

	it('keeps a private record private: no move into a household, editable by its owner only', async () => {
		const records = a.client.collection(collection);
		expect(await rejectionOf(records.update(own.id, { household: h1 }))).toEqual(refused('household'));
		expect(await rejectionOf(records.update(own.id, { scope: scopeOf(a.id, h1) }))).toEqual(refused('scope'));
		const unchanged = { owner: a.id, household: '', scope: scopeOf(a.id) };
		expect(await records.update(own.id, { ...ordinary(collection), ...unchanged })).toMatchObject(unchanged);
		expect(await statusOf(b.client.collection(collection).getOne(own.id))).toBe(404);
		expect(await statusOf(b.client.collection(collection).update(own.id, ordinary(collection)))).toBe(404);
		expect(await placeOf(collection, own.id)).toEqual(unchanged);
	});

	// The create rule refuses both before any request hook (PocketBase 0.40.4), with the general 400.
	it('refuses to create a record of another account', async () => {
		const records = b.client.collection(collection);
		for (const body of [payload(collection, a, h1), payload(collection, a)]) {
			expect(await statusOf(records.create(body))).toBe(400);
			expect(await countOf(collection, body)).toBe(0);
		}
	});

	it('refuses to create a record in a household without membership', async () => {
		for (const [person, body] of [
			[c, payload(collection, c, h1)],
			[a, payload(collection, a, h2)]
		]) {
			expect(await statusOf(person.client.collection(collection).create(body))).toBe(400);
			expect(await countOf(collection, body)).toBe(0);
		}
		const member = b.client.collection(collection).create(payload(collection, b, h1));
		if (collection === 'connections') {
			// Connections stay private since E7-3 (ADR-0059 §5), also with the membership.
			expect(await rejectionOf(member)).toEqual(refused('household', 'validation_connection_private_only'));
			return;
		}
		expect(await member).toMatchObject({
			owner: b.id,
			household: h1,
			scope: scopeOf(b.id, h1)
		});
	});

	it('gives a new record the scope of its owner and household, whatever the body says', async () => {
		const records = a.client.collection(collection);
		const inHousehold = await createOf(collection, a, h1, { scope: scopeOf(a.id) });
		expect(inHousehold.scope).toBe(scopeOf(a.id, h1));
		const ofOwner = await records.create({ ...payload(collection, a), scope: scopeOf(c.id, h2) });
		expect(ofOwner.scope).toBe(scopeOf(a.id));
	});

	it('leaves the superuser free to change the area', async () => {
		const record = await createOf(collection, a, h1);
		const out = await superuser.collection(collection).update(record.id, { household: '' });
		expect(out).toMatchObject({ owner: a.id, household: '', scope: scopeOf(a.id) });
		const back = await superuser.collection(collection).update(record.id, { household: h1 });
		expect(back).toMatchObject({ owner: a.id, household: h1, scope: scopeOf(a.id, h1) });
	});
});

describe('dependencies, batch requests and a loosened rule', () => {
	it('keeps writing dependencies to the server, for members as for the owner', async () => {
		const blocker = await a.client.collection('tickets').create(payload('tickets', a, h1));
		const blocked = await a.client.collection('tickets').create(payload('tickets', a, h1));
		const dependency = await superuser
			.collection('dependencies')
			.create({ blocker: blocker.id, blocked: blocked.id, owner: a.id, household: h1 });
		for (const person of [a, b]) {
			expect(await statusOf(person.client.collection('dependencies').update(dependency.id, { household: '' }))).toBe(403);
		}
		expect((await stored('dependencies', dependency.id)).household).toBe(h1);
	});

	it('refuses a changed area through the batch API as well, should it be switched on', async () => {
		await superuser.settings.update({ batch: { enabled: true } });
		try {
			const ticket = await a.client.collection('tickets').create(payload('tickets', a, h1));
			const batch = b.client.createBatch();
			batch.collection('tickets').update(ticket.id, { household: '' });
			expect(await statusOf(batch.send())).toBe(400);
			expect(await placeOf('tickets', ticket.id)).toEqual({ owner: a.id, household: h1, scope: scopeOf(a.id, h1) });
			const allowed = b.client.createBatch();
			allowed.collection('tickets').update(ticket.id, { title: 'Im Stapel' });
			expect(await statusOf(allowed.send())).toBe(200);
			expect((await stored('tickets', ticket.id)).title).toBe('Im Stapel');
		} finally {
			await superuser.settings.update({ batch: { enabled: false } });
		}
	});

	it('refuses a changed owner with a message even when the update rule no longer keeps it', async () => {
		const rule = (await superuser.collections.getOne('tickets')).updateRule;
		const loosened = rule.replace(' && @request.body.owner:changed = false', '');
		expect(loosened).not.toBe(rule);
		await superuser.collections.update('tickets', { updateRule: loosened });
		try {
			const ticket = await a.client.collection('tickets').create(payload('tickets', a, h1));
			expect(await rejectionOf(b.client.collection('tickets').update(ticket.id, { owner: b.id }))).toEqual(
				refused('owner', 'validation_scope_owner_locked')
			);
			expect((await stored('tickets', ticket.id)).owner).toBe(a.id);
		} finally {
			await superuser.collections.update('tickets', { updateRule: rule });
		}
	});
});

describe('the ways of the server keep their area', () => {
	it('generates the tickets of a household rule and repeats a household ticket', async () => {
		const rule = await b.client.collection('recurrence_rules').create({
			owner: b.id,
			household: h1,
			title: `Regel ${uniqueSuffix()}`,
			mode: 'calendar',
			freq: 'daily',
			lead_days: 0,
			initial_status: 'open'
		});
		const response = await fetch(`${instance.url}/api/byl-test/recurrence/run`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ now: Date.now() })
		});
		expect(response.status).toBe(200);
		const generated = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('recurrence = {:rule}', { rule: rule.id }) });
		expect(generated).toHaveLength(1);
		expect(generated[0]).toMatchObject({ owner: b.id, household: h1, scope: scopeOf(b.id, h1) });

		// "Wiederholen…": a rule of B takes a household ticket of A; the hook links it on the server.
		const ticket = await a.client.collection('tickets').create(payload('tickets', a, h1));
		const repeat = await b.client.collection('recurrence_rules').create({
			owner: b.id,
			household: h1,
			title: ticket.title,
			mode: 'after_completion',
			freq: 'weekly',
			initial_status: 'open',
			ticket: ticket.id
		});
		expect(await stored('tickets', ticket.id)).toMatchObject({ recurrence: repeat.id, owner: a.id, household: h1 });
		for (const id of [rule.id, repeat.id]) {
			await b.client.collection('recurrence_rules').update(id, { active: false });
		}
	});

	it('converts a household inbox item into a ticket of the household', async () => {
		const item = await a.client.collection('inbox_items').create(payload('inbox_items', a, h1));
		const ticket = await b.client
			.collection('tickets')
			.create({ owner: b.id, household: h1, title: `Aus dem Eingang ${uniqueSuffix()}`, source_item: item.id });
		expect(await stored('inbox_items', item.id)).toMatchObject({
			state: 'converted',
			ticket: ticket.id,
			owner: a.id,
			household: h1,
			scope: scopeOf(a.id, h1)
		});
	});

	it('duplicates a household ticket into the household', async () => {
		const ticket = await a.client.collection('tickets').create(payload('tickets', a, h1));
		const answer = await send(b, `/api/byl/tickets/${ticket.id}/duplicate`, {
			title: 'Kopie',
			status: 'open',
			source: 'none',
			description: false,
			priority: false,
			tags: false,
			due: false,
			parent: false,
			subtasks: false,
			comments: false
		});
		expect(await placeOf('tickets', answer.id)).toEqual({ owner: b.id, household: h1, scope: scopeOf(b.id, h1) });
	});

	it('restores a household ticket from the trash into the household', async () => {
		const ticket = await a.client.collection('tickets').create(payload('tickets', a, h1));
		await a.client.collection('tickets').delete(ticket.id);
		expect((await send(b, `/api/byl/trash/${ticket.id}/restore`, {})).id).toBe(ticket.id);
		expect(await stored('tickets', ticket.id)).toMatchObject({ deleted_at: '', owner: a.id, household: h1, scope: scopeOf(a.id, h1) });
	});

	it('lets a member join and leave through the routes of the household; his records stay in it', async () => {
		const d = await createAccount();
		const { code } = await send(a, `${ROUTE}/invites`, {});
		await send(d, `${ROUTE}/join`, { code });
		const ticket = await d.client.collection('tickets').create(payload('tickets', d, h1));
		expect(await send(d, `${ROUTE}/leave`, {})).toEqual({ household: null });
		expect(await placeOf('tickets', ticket.id)).toEqual({ owner: d.id, household: h1, scope: scopeOf(d.id, h1) });
		expect((await a.client.collection('tickets').getOne(ticket.id)).id).toBe(ticket.id);
	});
});
