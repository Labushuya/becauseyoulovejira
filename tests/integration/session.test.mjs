// Session care and realtime against the disposable instance (E2 plan, package 2; ADR-0007):
// authRefresh extends the token, subscriptions survive it, and the logout order
// "unsubscribe, then clear" lets another user subscribe on the same client without the 403
// the server returns when the user of a realtime connection changes.

import { getTokenPayload } from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppUser, superuserClient, userClient } from '../support/api.mjs';
import { createOwner } from '../support/scenario.mjs';

const EVENT_TIMEOUT_MS = 5_000;
const QUIET_PERIOD_MS = 500;

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Subscribes to all tickets of `client` and collects the events. */
async function collectTicketEvents(client) {
	const events = [];
	await client.collection('tickets').subscribe('*', (event) => {
		events.push({ action: event.action, id: event.record.id });
	});
	return {
		events,
		async waitFor(action, id) {
			const deadline = Date.now() + EVENT_TIMEOUT_MS;
			while (!events.some((event) => event.action === action && event.id === id)) {
				if (Date.now() > deadline) {
					throw new Error(`No realtime event ${action} ${id} within ${EVENT_TIMEOUT_MS} ms`);
				}
				await delay(25);
			}
		}
	};
}

describe('session care', () => {
	let superuser;
	const clients = [];

	beforeAll(async () => {
		superuser = await superuserClient();
	});

	afterAll(async () => {
		for (const client of clients) await client.realtime.unsubscribe();
	});

	async function owner() {
		const created = await createOwner(superuser);
		clients.push(created.client);
		return created;
	}

	it('extends the token expiry with authRefresh', async () => {
		const { client } = await owner();
		const before = getTokenPayload(client.authStore.token).exp;

		// exp has a resolution of one second.
		await delay(1_100);
		await client.collection('users').authRefresh();

		expect(getTokenPayload(client.authStore.token).exp).toBeGreaterThan(before);
		expect(client.authStore.isValid).toBe(true);
	});

	it('keeps delivering realtime events after authRefresh', async () => {
		const a = await owner();
		const events = await collectTicketEvents(a.client);

		await a.client.collection('users').authRefresh();
		const ticket = await a.ticket();

		await events.waitFor('create', ticket.id);
	});

	it('delivers nothing after unsubscribe and clear, and lets another user subscribe', async () => {
		const a = await owner();
		const { client } = a;
		const events = await collectTicketEvents(client);
		const first = await a.ticket();
		await events.waitFor('create', first.id);

		// Logout order of auth.logout(): stop all subscriptions, then clear the store.
		const stopped = client.realtime.unsubscribe();
		client.authStore.clear();
		await stopped;
		expect(client.realtime.isConnected).toBe(false);

		// A second session of A changes a ticket; the logged-out client must not hear of it.
		const otherTab = await userClient({ email: a.email, password: a.password });
		const second = await otherTab.collection('tickets').create({ owner: a.id, title: 'Zweites' });
		await otherTab.collection('tickets').update(second.id, { title: 'geändert' });
		await delay(QUIET_PERIOD_MS);
		expect(events.events.map((event) => event.id)).toEqual([first.id]);

		// B logs in on the same client and subscribes without a 403.
		const userB = await createAppUser(superuser);
		await client.collection('users').authWithPassword(userB.email, userB.password);
		const eventsB = await collectTicketEvents(client);
		const ticketB = await client
			.collection('tickets')
			.create({ owner: userB.record.id, title: 'Ticket von B' });
		await eventsB.waitFor('create', ticketB.id);
		expect(eventsB.events.every((event) => event.id === ticketB.id)).toBe(true);
	});

	it('control: without unsubscribing first, the server rejects the user change with 403', async () => {
		const a = await owner();
		const { client } = a;
		await collectTicketEvents(client);

		const userB = await createAppUser(superuser);
		await client.collection('users').authWithPassword(userB.email, userB.password);

		await expect(client.collection('comments').subscribe('*', () => {})).rejects.toMatchObject({
			status: 403
		});
	});
});
