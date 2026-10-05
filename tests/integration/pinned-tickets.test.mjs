// Pinned tickets (PIN-1, ADR-0064) against an own disposable PocketBase: A and B share a household
// (A founds it), C is alone. A pin belongs to its account and stands only on a ticket the account
// sees; completing and the trash release the pins of every account, reopening and restoring pin
// nothing again; leaving the household and being removed take the pins on its tickets along, private
// pins stay; a move keeps a pin while its account still sees the ticket; the tabs of an account
// follow live. Reads, pins and releases go through the data layer of the SPA (data/pins.ts,
// subscribePins of data/realtime.ts). The migration with its way back is in
// migrations-rollback.test.mjs.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import { listPins, pinTicket, unpinTicket } from '../../web/src/lib/data/pins.ts';
import { subscribePins } from '../../web/src/lib/data/realtime.ts';

const ROUTE = '/api/byl/household';
const MOVE = '/api/byl/area/move';
const EVENT_TIMEOUT_MS = scaled(5_000);

let instance;
let superuser;
let a;
let b;
let c;
let householdId;
const stops = [];

function createClient() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

/** A new app account with random credentials (in memory only), signed in; `login` opens another tab. */
async function createAccount(name) {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password, name })).id;
	const login = async () => {
		const client = createClient();
		await client.collection('users').authWithPassword(email, password);
		return client;
	};
	const client = await login();
	return {
		id,
		client,
		login,
		send: (path, body = {}, method = 'POST') => client.send(path, { method, body, requestKey: null }),
		ticket: (data = {}) => client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data })
	};
}

/** Every pin of a ticket, of every account, as the superuser sees them. */
const pinsOf = (ticketId) =>
	superuser.collection('ticket_pins').getFullList({ filter: superuser.filter('ticket = {:t}', { t: ticketId }), sort: 'created,id' });
const accountsOf = async (ticketId) => (await pinsOf(ticketId)).map((pin) => pin.user).sort();

/** Status of a refused call. */
async function statusOf(promise) {
	try {
		await promise;
		return 200;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return error.status;
	}
}

/** The changes of the own pins one tab receives, as the store of the app subscribes. */
async function watchPins(client) {
	const changes = [];
	stops.push(await subscribePins(client, (change) => changes.push(change)));
	return changes;
}

async function waitFor(changes, action, id) {
	const deadline = Date.now() + EVENT_TIMEOUT_MS;
	for (;;) {
		const found = changes.find((change) => change.action === action && (change.id ?? change.record?.id) === id);
		if (found) return found;
		if (Date.now() > deadline) throw new Error(`No realtime change ${action} ${id} within ${EVENT_TIMEOUT_MS} ms`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

async function join(person) {
	const { code } = await a.send(`${ROUTE}/invites`);
	await person.send(`${ROUTE}/join`, { code });
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = createClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	a = await createAccount('Anna Beispiel');
	b = await createAccount('Bert Beispiel');
	c = await createAccount('Clara Beispiel');
	householdId = (await a.send(ROUTE, { name: `Haus ${uniqueSuffix()}` })).household.id;
	await join(b);
});

afterAll(async () => {
	for (const stop of stops) await stop().catch(() => undefined);
	await instance?.stop();
});

describe('a pin belongs to its account', () => {
	it('lets A and B pin the same ticket of the household; each reads and releases only the own pin', async () => {
		const ticket = await a.ticket({ household: householdId });
		const pinA = await pinTicket(a.client, ticket.id);
		const pinB = await pinTicket(b.client, ticket.id);
		expect(pinA).toMatchObject({ ticket: ticket.id });
		expect(pinA.created).toMatch(/^\d{4}-\d{2}-\d{2} /);
		expect(pinB.id).not.toBe(pinA.id);
		expect(await accountsOf(ticket.id)).toEqual([a.id, b.id].sort());

		// Each account reads only its own pin; C, outside the household, none.
		const ownA = await listPins(a.client);
		expect(ownA.filter((pin) => pin.ticket === ticket.id)).toEqual([pinA]);
		expect(ownA.map((pin) => pin.id)).not.toContain(pinB.id);
		expect((await listPins(b.client)).filter((pin) => pin.ticket === ticket.id)).toEqual([pinB]);
		expect((await listPins(c.client)).filter((pin) => pin.ticket === ticket.id)).toEqual([]);
		expect(await statusOf(a.client.collection('ticket_pins').getOne(pinB.id))).toBe(404);

		// The same pin again is no error (another tab, a second click); a pin for B is refused.
		expect(await pinTicket(a.client, ticket.id)).toBeNull();
		expect(await statusOf(a.client.collection('ticket_pins').create({ user: b.id, ticket: ticket.id }))).toBe(400);
		// A pin never changes.
		expect(await statusOf(a.client.collection('ticket_pins').update(pinA.id, { ticket: ticket.id }))).toBe(403);

		// A cannot release the pin of B: the delete finds nothing, B keeps it.
		expect(await statusOf(a.client.collection('ticket_pins').delete(pinB.id))).toBe(404);
		await unpinTicket(a.client, pinB.id);
		expect(await accountsOf(ticket.id)).toEqual([a.id, b.id].sort());

		await unpinTicket(a.client, pinA.id);
		expect(await accountsOf(ticket.id)).toEqual([b.id]);
		// Released already: no error.
		await unpinTicket(a.client, pinA.id);
	});

	it('pins only tickets the account sees, never a done one or one in the trash', async () => {
		const privateA = await a.ticket();
		const shared = await a.ticket({ household: householdId });
		const ofC = await c.ticket();
		expect(await statusOf(pinTicket(b.client, privateA.id))).toBe(400);
		expect(await statusOf(pinTicket(c.client, privateA.id))).toBe(400);
		expect(await statusOf(pinTicket(c.client, shared.id))).toBe(400);
		expect(await statusOf(pinTicket(a.client, ofC.id))).toBe(400);
		expect(await accountsOf(privateA.id)).toEqual([]);
		expect(await accountsOf(shared.id)).toEqual([]);
		expect(await accountsOf(ofC.id)).toEqual([]);

		const done = await a.ticket({ status: 'done' });
		const refusal = await pinTicket(a.client, done.id).catch((error) => error);
		expect(refusal.kind).toBe('validation');
		expect(refusal.fields.ticket).toMatchObject({
			code: 'validation_pin_done',
			message: 'Erledigte Tickets lassen sich nicht anheften.'
		});

		const trashed = await a.ticket();
		await a.client.collection('tickets').delete(trashed.id);
		expect(await statusOf(pinTicket(a.client, trashed.id))).toBe(400);
		expect(await accountsOf(trashed.id)).toEqual([]);
	});
});

describe('released by the server', () => {
	it('completing releases the pins of every account, live; reopening pins nothing again', async () => {
		const ticket = await a.ticket({ household: householdId });
		const changesA = await watchPins(a.client);
		const changesB = await watchPins(b.client);
		const pinA = await pinTicket(a.client, ticket.id);
		const pinB = await pinTicket(b.client, ticket.id);

		await b.client.collection('tickets').update(ticket.id, { status: 'done' });
		expect(await accountsOf(ticket.id)).toEqual([]);
		await waitFor(changesA, 'delete', pinA.id);
		await waitFor(changesB, 'delete', pinB.id);

		await a.client.collection('tickets').update(ticket.id, { status: 'open' });
		expect(await accountsOf(ticket.id)).toEqual([]);
		expect((await listPins(a.client)).map((pin) => pin.ticket)).not.toContain(ticket.id);
	});

	it('completing a ticket with its sub-tasks releases their pins as well', async () => {
		const parent = await a.ticket();
		const child = await a.ticket({ parent: parent.id });
		const other = await a.ticket({ parent: parent.id, blocks_parent: false });
		await pinTicket(a.client, parent.id);
		await pinTicket(a.client, child.id);
		await pinTicket(a.client, other.id);

		await a.client.collection('tickets').update(parent.id, { status: 'done', complete_children: true });
		expect(await accountsOf(parent.id)).toEqual([]);
		expect(await accountsOf(child.id)).toEqual([]);
		// A sub-task that does not block stays open, and so does its pin.
		expect(await accountsOf(other.id)).toEqual([a.id]);
	});

	it('the trash releases the pins of every account and of the sub-tasks, live; restoring pins nothing again', async () => {
		const ticket = await a.ticket({ household: householdId });
		const sub = await a.ticket({ household: householdId, parent: ticket.id });
		const changesA = await watchPins(a.client);
		const pinA = await pinTicket(a.client, ticket.id);
		const pinSub = await pinTicket(a.client, sub.id);
		await pinTicket(b.client, ticket.id);

		await b.client.collection('tickets').delete(ticket.id);
		expect(await accountsOf(ticket.id)).toEqual([]);
		expect(await accountsOf(sub.id)).toEqual([]);
		await waitFor(changesA, 'delete', pinA.id);
		await waitFor(changesA, 'delete', pinSub.id);

		await a.send(`/api/byl/trash/${ticket.id}/restore`, {});
		expect((await a.client.collection('tickets').getOne(ticket.id)).deleted_at).toBe('');
		expect(await accountsOf(ticket.id)).toEqual([]);
		expect(await accountsOf(sub.id)).toEqual([]);
	});
});

describe('the household and the areas', () => {
	it('leaving the household takes the pins on its tickets along, live; private pins and those of others stay', async () => {
		const dora = await createAccount('Dora Beispiel');
		await join(dora);
		const shared = await a.ticket({ household: householdId });
		const own = await dora.ticket();
		const changes = await watchPins(dora.client);
		const pinShared = await pinTicket(dora.client, shared.id);
		await pinTicket(dora.client, own.id);
		await pinTicket(a.client, shared.id);

		await dora.send(`${ROUTE}/leave`);
		expect(await accountsOf(shared.id)).toEqual([a.id]);
		expect(await accountsOf(own.id)).toEqual([dora.id]);
		await waitFor(changes, 'delete', pinShared.id);
		expect((await listPins(dora.client)).map((pin) => pin.ticket)).toEqual([own.id]);

		// Joining again brings nothing back.
		await join(dora);
		expect((await listPins(dora.client)).map((pin) => pin.ticket)).toEqual([own.id]);
		await dora.send(`${ROUTE}/leave`);
	});

	it('removing a member takes its pins on the tickets of the household along', async () => {
		const emil = await createAccount('Emil Beispiel');
		await join(emil);
		const shared = await a.ticket({ household: householdId });
		await pinTicket(emil.client, shared.id);
		await pinTicket(b.client, shared.id);
		const membership = await a.client
			.collection('household_members')
			.getFirstListItem(a.client.filter('user = {:u}', { u: emil.id }));

		await a.send(`${ROUTE}/members/${membership.id}/remove`);
		expect(await accountsOf(shared.id)).toEqual([b.id]);
	});

	it('a move keeps a pin while its account still sees the ticket', async () => {
		const ticket = await a.ticket();
		await pinTicket(a.client, ticket.id);

		// Into the household: A still sees it, so A keeps the pin; B may pin it now.
		await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household' });
		expect(await accountsOf(ticket.id)).toEqual([a.id]);
		await pinTicket(b.client, ticket.id);
		expect(await accountsOf(ticket.id)).toEqual([a.id, b.id].sort());

		// Back into the private area of A (A created it): B no longer sees it and loses the pin.
		await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'private' });
		expect(await accountsOf(ticket.id)).toEqual([a.id]);
		expect((await listPins(b.client)).map((pin) => pin.ticket)).not.toContain(ticket.id);
	});
});

describe('live in every tab of the account', () => {
	it('shows a pin of one tab in the other and releases it there, never in a tab of another account', async () => {
		const second = await a.login();
		const changesA = await watchPins(second);
		const changesB = await watchPins(b.client);
		const ticket = await a.ticket({ household: householdId });

		const pin = await pinTicket(a.client, ticket.id);
		const created = await waitFor(changesA, 'create', pin.id);
		expect(created.record).toEqual(pin);
		await unpinTicket(a.client, pin.id);
		await waitFor(changesA, 'delete', pin.id);

		// B gets its own pin, which comes after the one of A: by then that one would have arrived.
		const own = await pinTicket(b.client, ticket.id);
		await waitFor(changesB, 'create', own.id);
		expect(changesB.map((change) => change.id ?? change.record.id)).not.toContain(pin.id);
	});
});
