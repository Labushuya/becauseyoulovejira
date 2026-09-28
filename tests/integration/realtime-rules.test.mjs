// Realtime respects the API rules (E1 plan, package 4; ADR-0004 section 4): a subscription to
// the whole collection is filtered by the listRule. Node 24 provides EventSource only with
// --experimental-eventsource, which vitest.config.mjs passes to the integration workers.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScenario, ownedPayload } from '../support/scenario.mjs';

const EVENT_TIMEOUT_MS = 5_000;
const QUIET_PERIOD_MS = 500;

/** Collects realtime events of one client for a collection ("tickets" by default). */
async function subscribeTickets(client, collection = 'tickets') {
	const events = [];
	const waiters = [];
	await client.collection(collection).subscribe('*', (event) => {
		events.push({ action: event.action, id: event.record.id });
		for (const waiter of [...waiters]) waiter();
	});
	return {
		events,
		/** Resolves once an event matching `action` and `id` has arrived. */
		waitFor(action, id) {
			const matches = () => events.some((event) => event.action === action && event.id === id);
			if (matches()) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					waiters.splice(waiters.indexOf(check), 1);
					reject(new Error(`No realtime event ${action} ${id} within ${EVENT_TIMEOUT_MS} ms`));
				}, EVENT_TIMEOUT_MS);
				const check = () => {
					if (!matches()) return;
					clearTimeout(timer);
					waiters.splice(waiters.indexOf(check), 1);
					resolve();
				};
				waiters.push(check);
			});
		}
	};
}

describe('realtime subscriptions on tickets', () => {
	let s;

	beforeAll(async () => {
		s = await createScenario();
	});

	afterAll(async () => {
		for (const client of [s?.a, s?.b, s?.c]) {
			await client?.realtime.unsubscribe();
		}
	});

	it('runs with the EventSource of Node 24', () => {
		expect(typeof globalThis.EventSource).toBe('function');
	});

	it('delivers no events about records outside the own scopes', async () => {
		const a = await subscribeTickets(s.a);
		const b = await subscribeTickets(s.b);
		const c = await subscribeTickets(s.c);
		const tickets = s.a.collection('tickets');

		const aPrivate = await tickets.create(ownedPayload('tickets', s.ids.a));
		await tickets.update(aPrivate.id, { title: 'privat geändert' });
		const aH1 = await tickets.create(ownedPayload('tickets', s.ids.a, s.h1.id));
		await tickets.delete(aPrivate.id);
		const last = await tickets.create(ownedPayload('tickets', s.ids.a, s.h1.id));

		// Positive control: the owner receives everything, B receives the household records.
		await a.waitFor('create', aPrivate.id);
		await a.waitFor('update', aPrivate.id);
		await a.waitFor('delete', aPrivate.id);
		await a.waitFor('create', last.id);
		await b.waitFor('create', aH1.id);
		await b.waitFor('create', last.id);
		await new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));

		expect(b.events.filter((event) => event.id === aPrivate.id)).toEqual([]);
		expect(c.events).toEqual([]);
	});
});

describe('realtime subscriptions on inbox_items', () => {
	let s;

	beforeAll(async () => {
		s = await createScenario();
	});

	afterAll(async () => {
		for (const client of [s?.a, s?.b, s?.c]) {
			await client?.realtime.unsubscribe();
		}
	});

	it('delivers no events about inbox items outside the own scopes', async () => {
		const a = await subscribeTickets(s.a, 'inbox_items');
		const b = await subscribeTickets(s.b, 'inbox_items');
		const c = await subscribeTickets(s.c, 'inbox_items');
		const items = s.a.collection('inbox_items');

		const aPrivate = await items.create(ownedPayload('inbox_items', s.ids.a));
		await items.update(aPrivate.id, { state: 'discarded' });
		const aH1 = await items.create(ownedPayload('inbox_items', s.ids.a, s.h1.id));
		await items.delete(aPrivate.id);
		const last = await items.create(ownedPayload('inbox_items', s.ids.a, s.h1.id));

		await a.waitFor('create', aPrivate.id);
		await a.waitFor('update', aPrivate.id);
		await a.waitFor('delete', aPrivate.id);
		await a.waitFor('create', last.id);
		await b.waitFor('create', aH1.id);
		await b.waitFor('create', last.id);
		await new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));

		expect(b.events.filter((event) => event.id === aPrivate.id)).toEqual([]);
		expect(c.events).toEqual([]);
	});

	it('sends the update of a converted item to the owner', async () => {
		const a = await subscribeTickets(s.a, 'inbox_items');
		const c = await subscribeTickets(s.c, 'inbox_items');
		const item = await s.a.collection('inbox_items').create(ownedPayload('inbox_items', s.ids.a));
		await s.a.collection('tickets').create({ owner: s.ids.a, title: 'Aus dem Eingang', source_item: item.id });
		await a.waitFor('update', item.id);
		await new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));
		expect(c.events).toEqual([]);
	});
});

describe('realtime of the archive cascade of sub projects (ADR-0034, spike UP-1)', () => {
	let s;

	beforeAll(async () => {
		s = await createScenario();
	});

	afterAll(async () => {
		for (const client of [s?.a, s?.b, s?.c]) {
			await client?.realtime.unsubscribe();
		}
	});

	it('sends the updates of parent and sub projects after the commit, to members only', async () => {
		const projects = s.a.collection('projects');
		const parent = await projects.create(ownedPayload('projects', s.ids.a, s.h1.id));
		const garden = await projects.create({
			...ownedPayload('projects', s.ids.a, s.h1.id),
			parent: parent.id
		});
		const roof = await projects.create({
			...ownedPayload('projects', s.ids.a, s.h1.id),
			parent: parent.id
		});
		const a = await subscribeTickets(s.a, 'projects');
		const b = await subscribeTickets(s.b, 'projects');
		const c = await subscribeTickets(s.c, 'projects');

		await projects.update(parent.id, { archived: true });

		for (const id of [parent.id, garden.id, roof.id]) {
			await a.waitFor('update', id);
			await b.waitFor('update', id);
		}
		await new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));
		expect(c.events).toEqual([]);
	});
});

describe('realtime subscriptions on recurrence_rules (E5 plan, package 2)', () => {
	let s;

	beforeAll(async () => {
		s = await createScenario();
	});

	afterAll(async () => {
		for (const client of [s?.a, s?.b, s?.c]) {
			await client?.realtime.unsubscribe();
		}
	});

	it('delivers no events about rules outside the own scopes', async () => {
		const a = await subscribeTickets(s.a, 'recurrence_rules');
		const b = await subscribeTickets(s.b, 'recurrence_rules');
		const c = await subscribeTickets(s.c, 'recurrence_rules');
		const rules = s.a.collection('recurrence_rules');

		const aPrivate = await rules.create(ownedPayload('recurrence_rules', s.ids.a));
		await rules.update(aPrivate.id, { active: false });
		const aH1 = await rules.create(ownedPayload('recurrence_rules', s.ids.a, s.h1.id));
		await rules.delete(aPrivate.id);
		const last = await rules.create(ownedPayload('recurrence_rules', s.ids.a, s.h1.id));

		await a.waitFor('create', aPrivate.id);
		await a.waitFor('update', aPrivate.id);
		await a.waitFor('delete', aPrivate.id);
		await a.waitFor('create', last.id);
		await b.waitFor('create', aH1.id);
		await b.waitFor('create', last.id);
		await new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));

		expect(b.events.filter((event) => event.id === aPrivate.id)).toEqual([]);
		expect(c.events).toEqual([]);
	});
});
