// Realtime respects the API rules (E1 plan, package 4; ADR-0004 section 4): a subscription to
// the whole collection is filtered by the listRule. Node 24 provides EventSource only with
// --experimental-eventsource, which vitest.config.mjs passes to the integration workers.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScenario, ownedPayload } from '../support/scenario.mjs';

const EVENT_TIMEOUT_MS = 5_000;
const QUIET_PERIOD_MS = 500;

/** Collects realtime events of one client for the "tickets" collection. */
async function subscribeTickets(client) {
	const events = [];
	const waiters = [];
	await client.collection('tickets').subscribe('*', (event) => {
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
