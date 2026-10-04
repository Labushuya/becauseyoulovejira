// Access to household records ends with the membership (ADR-0058 §5, E7-2, migration 1790203900):
// B founds a household, A joins with a code, A creates records of every collection with a scope in
// it (and private ones) and leaves. From then on A can neither list, view, change nor delete any
// household record, not even the own ones, also not through the ticket (comments, history, read
// rows, dependencies), the trash, "Duplizieren" or realtime; B keeps everything, the private records
// of A stay A's. The same for a member who is removed. Against an own disposable instance, so its
// memberships stay out of the shared instance of the other files.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { statusOf } from '../support/api.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { ownedPayload, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';

const ROUTE = '/api/byl/household';
const SCOPED = ['projects', 'tags', 'recurrence_rules', 'tickets', 'inbox_items', 'connections'];
const EVENT_TIMEOUT_MS = scaled(5_000);
const QUIET_PERIOD_MS = scaled(500);

let instance;
let superuser;
let a;
let b;
let householdId;
/** Records of A in the household, by collection, and private ones. */
const shared = {};
const own = {};
let comment;
let dependency;
let trashed;
const stops = [];
const events = { a: [], b: [] };

const send = (person, path, body, method = 'POST') =>
	person.client.send(path, { method, body, requestKey: null });

/** Collects realtime events of one account for the tickets. */
async function watch(person, into) {
	stops.push(await person.client.collection('tickets').subscribe('*', (event) => into.push([event.action, event.record.id])));
}

async function waitFor(list, action, id) {
	const deadline = Date.now() + EVENT_TIMEOUT_MS;
	while (!list.some(([seen, seenId]) => seen === action && seenId === id)) {
		if (Date.now() > deadline) throw new Error(`No realtime event ${action} ${id} within ${EVENT_TIMEOUT_MS} ms`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

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

function createClient() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

/** A new app account with random credentials (in memory only), signed in, with a ticket helper. */
async function createOwner() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
	const client = createClient();
	await client.collection('users').authWithPassword(email, password);
	return {
		id,
		client,
		ticket: (data = {}) => client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data })
	};
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = createClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	// The first account becomes the administrator of the app (ADR-0056 §1), who sees every account;
	// this one takes that place, so A and B are plain accounts.
	await createOwner();
	a = await createOwner();
	b = await createOwner();
	// B founds the household (and owns it), A joins with a code.
	householdId = (await send(b, ROUTE, { name: `Haus ${uniqueSuffix()}` })).household.id;
	const { code } = await send(b, `${ROUTE}/invites`, {});
	await send(a, `${ROUTE}/join`, { code });

	for (const collection of SCOPED) {
		// Connections with access data are set up by the administrator only (ADR-0056 §5); the
		// superuser writes them here.
		const writer = collection === 'connections' ? superuser : a.client;
		shared[collection] = await writer.collection(collection).create(payload(collection, a, householdId));
		own[collection] = await writer.collection(collection).create(payload(collection, a));
	}
	shared.second = await a.ticket({ household: householdId });
	comment = await a.client.collection('comments').create({ ticket: shared.tickets.id, author: a.id, body: 'Von A' });
	dependency = await superuser
		.collection('dependencies')
		.create({ blocker: shared.tickets.id, blocked: shared.second.id, owner: a.id, household: householdId });
	trashed = await a.ticket({ household: householdId });
	await a.client.collection('tickets').delete(trashed.id);

	await watch(a, events.a);
	await watch(b, events.b);
	// A leaves; the household and its records stay.
	expect(await send(a, `${ROUTE}/leave`, {})).toEqual({ household: null });
});

afterAll(async () => {
	for (const stop of stops) await stop();
	await instance?.stop();
});

describe('after leaving', () => {
	it.each(SCOPED)('A can neither list, view, change nor delete household records of %s', async (collection) => {
		const records = a.client.collection(collection);
		const listed = (await records.getFullList({ batch: 500 })).map((record) => record.id);
		expect(listed).not.toContain(shared[collection].id);
		expect(listed).toContain(own[collection].id);
		expect(await statusOf(records.getOne(shared[collection].id))).toBe(404);
		expect(await statusOf(records.update(shared[collection].id, {}))).toBe(404);
		// Inbox items are never deleted through the API (deleteRule null): 403 for everyone.
		expect(await statusOf(records.delete(shared[collection].id))).toBe(collection === 'inbox_items' ? 403 : 404);
		expect(await statusOf(records.create(payload(collection, a, householdId)))).toBe(400);
		// The record is still there, untouched, with A as its owner.
		expect((await superuser.collection(collection).getOne(shared[collection].id)).owner).toBe(a.id);
	});

	it('A sees nothing through the ticket either: comments, history, read rows, dependencies, names', async () => {
		expect(await a.client.collection('comments').getFullList({ filter: a.client.filter('ticket = {:t}', { t: shared.tickets.id }) })).toEqual([]);
		expect(await statusOf(a.client.collection('comments').getOne(comment.id))).toBe(404);
		expect(await statusOf(a.client.collection('comments').update(comment.id, { body: 'x' }))).toBe(404);
		expect(await statusOf(a.client.collection('comments').create({ ticket: shared.tickets.id, author: a.id, body: 'x' }))).toBe(400);
		expect(await a.client.collection('ticket_history').getFullList({ filter: a.client.filter('ticket = {:t}', { t: shared.tickets.id }) })).toEqual([]);
		expect(await statusOf(a.client.collection('ticket_reads').create({ user: a.id, ticket: shared.tickets.id }))).toBe(400);
		expect((await a.client.collection('dependencies').getFullList()).map((row) => row.id)).not.toContain(dependency.id);
		expect(await statusOf(a.client.collection('users').getOne(b.id))).toBe(404);
	});

	it('A finds no household ticket in the trash and cannot duplicate one', async () => {
		const trash = await send(a, '/api/byl/trash', undefined, 'GET');
		expect(trash.items.map((item) => item.id)).not.toContain(trashed.id);
		expect(await statusOf(send(a, `/api/byl/trash/${trashed.id}`, undefined, 'GET'))).toBe(404);
		expect(await statusOf(send(a, `/api/byl/trash/${trashed.id}/restore`, {}))).toBe(404);
		expect(await statusOf(send(a, `/api/byl/tickets/${shared.tickets.id}/duplicate`, { title: 'Kopie', status: 'open', project: '', source: 'none' }))).toBe(404);
		expect((await send(b, '/api/byl/trash', undefined, 'GET')).items.map((item) => item.id)).toContain(trashed.id);
	});

	it('A gets no realtime event of a household record, B does; private records still reach A', async () => {
		await b.client.collection('tickets').update(shared.tickets.id, { title: `Von B ${uniqueSuffix()}` });
		await waitFor(events.b, 'update', shared.tickets.id);
		await a.client.collection('tickets').update(own.tickets.id, { title: `Privat ${uniqueSuffix()}` });
		await waitFor(events.a, 'update', own.tickets.id);
		await new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));
		expect(events.a.filter(([, id]) => id === shared.tickets.id)).toEqual([]);
		expect(events.b.filter(([, id]) => id === own.tickets.id)).toEqual([]);
	});

	it('B keeps every household record, also those of A', async () => {
		for (const collection of SCOPED) {
			expect((await b.client.collection(collection).getOne(shared[collection].id)).id).toBe(shared[collection].id);
			expect(await statusOf(b.client.collection(collection).getOne(own[collection].id))).toBe(404);
		}
		expect((await b.client.collection('comments').getOne(comment.id)).body).toBe('Von A');
		expect((await b.client.collection('dependencies').getOne(dependency.id)).id).toBe(dependency.id);
		expect(await statusOf(b.client.collection('projects').update(shared.projects.id, { name: 'Von B' }))).toBe(200);
	});

	it('A keeps the private records', async () => {
		for (const collection of SCOPED) {
			expect((await a.client.collection(collection).getOne(own[collection].id)).id).toBe(own[collection].id);
		}
		expect(await statusOf(a.client.collection('tickets').update(own.tickets.id, { priority: 'high' }))).toBe(200);
	});
});

describe('after being removed', () => {
	it('a member loses access at once as well', async () => {
		const c = await createOwner();
		const { code } = await send(b, `${ROUTE}/invites`, {});
		await send(c, `${ROUTE}/join`, { code });
		const ticket = await c.ticket({ household: householdId });
		expect((await c.client.collection('tickets').getOne(shared.tickets.id)).id).toBe(shared.tickets.id);
		const state = await send(b, ROUTE, undefined, 'GET');
		const member = state.members.find((entry) => entry.user === c.id);
		await send(b, `${ROUTE}/members/${member.id}/remove`, {});
		expect(await statusOf(c.client.collection('tickets').getOne(shared.tickets.id))).toBe(404);
		expect(await statusOf(c.client.collection('tickets').getOne(ticket.id))).toBe(404);
		expect((await b.client.collection('tickets').getOne(ticket.id)).owner).toBe(c.id);
	});
});
