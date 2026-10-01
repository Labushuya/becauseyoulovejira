// Read rows and base line of the "new" mark (ADR-0015; E4 plan, package 4) against the disposable
// instance: rules with several users and a household, cascade with the ticket, realtime of the
// own rows only, the data layer (existing row counts as success, "Alle als gelesen markieren").

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppUser, rejectionOf, statusOf, userClient } from '../support/api.mjs';
import { createScenario, ownedPayload } from '../support/scenario.mjs';
import { listReads, markAllRead, markRead } from '../../web/src/lib/data/reads.ts';
import { subscribeReads } from '../../web/src/lib/data/realtime.ts';

const EVENT_TIMEOUT_MS = 5_000;
const QUIET_PERIOD_MS = 500;

let s;
let tickets;

const readsOf = (client) => client.collection('ticket_reads');
const read = (client, user, ticket) => readsOf(client).create({ user, ticket });

beforeAll(async () => {
	s = await createScenario();
	const create = (client, owner, household) =>
		client.collection('tickets').create(ownedPayload('tickets', owner, household));
	tickets = {
		aPrivate: await create(s.a, s.ids.a),
		aH1: await create(s.a, s.ids.a, s.h1.id),
		cH2: await create(s.c, s.ids.c, s.h2.id)
	};
});

afterAll(async () => {
	for (const client of [s?.a, s?.b, s?.c]) await client?.realtime.unsubscribe();
});

describe('ticket_reads rules', () => {
	it('lets a user mark own and household tickets as read, once', async () => {
		const own = await read(s.a, s.ids.a, tickets.aPrivate.id);
		expect(own.seen_at).not.toBe('');
		expect(await read(s.b, s.ids.b, tickets.aH1.id)).toMatchObject({ user: s.ids.b });
		expect(await rejectionOf(read(s.a, s.ids.a, tickets.aPrivate.id))).toMatchObject({
			status: 400
		});
	});

	it('refuses rows for other users and for tickets the user cannot see', async () => {
		expect(await statusOf(read(s.a, s.ids.b, tickets.aH1.id))).toBe(400);
		expect(await statusOf(read(s.b, s.ids.b, tickets.aPrivate.id))).toBe(400);
		expect(await statusOf(read(s.c, s.ids.c, tickets.aH1.id))).toBe(400);
		expect(await statusOf(read(s.anonymous, s.ids.a, tickets.aH1.id))).toBe(400);
	});

	it('shows, deletes and never updates only the own rows', async () => {
		const mine = await read(s.a, s.ids.a, tickets.aH1.id);
		const theirs = (await readsOf(s.b).getFullList()).find((row) => row.ticket === tickets.aH1.id);
		expect(theirs).toBeDefined();

		const listed = await readsOf(s.a).getFullList();
		expect(listed.every((row) => row.user === s.ids.a)).toBe(true);
		expect(await statusOf(readsOf(s.a).getOne(theirs.id))).toBe(404);
		expect(await statusOf(readsOf(s.a).delete(theirs.id))).toBe(404);
		expect(await statusOf(readsOf(s.a).update(mine.id, { ticket: tickets.aPrivate.id }))).toBe(
			403
		);
		expect(await statusOf(readsOf(s.a).delete(mine.id))).toBe(200);
		expect(await readsOf(s.anonymous).getFullList()).toEqual([]);
	});

	it('goes with its ticket', async () => {
		// Done, so nothing blocks deleting it for good (ADR-0047).
		const ticket = await s.a
			.collection('tickets')
			.create({ ...ownedPayload('tickets', s.ids.a), status: 'done' });
		const row = await read(s.a, s.ids.a, ticket.id);
		// In the trash (ADR-0037) the row stays, hidden; deleting for good takes it along.
		await s.a.collection('tickets').delete(ticket.id);
		expect(await statusOf(readsOf(s.a).getOne(row.id))).toBe(404);
		expect((await s.superuser.collection('ticket_reads').getOne(row.id)).id).toBe(row.id);
		await s.a.send(`/api/byl/trash/${ticket.id}/purge`, { method: 'POST' });
		expect(await statusOf(s.superuser.collection('ticket_reads').getOne(row.id))).toBe(404);
	});

	it('delivers realtime events of the own rows only', async () => {
		const aEvents = [];
		const cEvents = [];
		await readsOf(s.a).subscribe('*', (event) => aEvents.push(event.record.id));
		await readsOf(s.c).subscribe('*', (event) => cEvents.push(event.record.id));
		const ticket = await s.a
			.collection('tickets')
			.create(ownedPayload('tickets', s.ids.a, s.h1.id));
		const row = await read(s.a, s.ids.a, ticket.id);
		await read(s.b, s.ids.b, ticket.id);
		const deadline = Date.now() + EVENT_TIMEOUT_MS;
		while (!aEvents.includes(row.id) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		await new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));
		expect(aEvents).toEqual([row.id]);
		expect(cEvents).toEqual([]);
	});
});

describe('base line users.unread_since', () => {
	it('is empty for a new user and only the own one can be moved', async () => {
		const fresh = await createAppUser(s.superuser);
		const client = await userClient(fresh);
		expect(client.authStore.record.unread_since).toBe('');
		const moved = await client
			.collection('users')
			.update(fresh.record.id, { unread_since: '2026-09-25 10:00:00.000Z' });
		expect(moved.unread_since).toBe('2026-09-25 10:00:00.000Z');
		expect(
			await statusOf(s.b.collection('users').update(fresh.record.id, { unread_since: '' }))
		).toBe(404);
	});
});

describe('data layer (web/src/lib/data/reads.ts)', () => {
	it('marks as read, takes an existing row as success and lists the rows that matter', async () => {
		const fresh = await createAppUser(s.superuser);
		const client = await userClient(fresh);
		const make = (data = {}) =>
			client
				.collection('tickets')
				.create({ ...ownedPayload('tickets', fresh.record.id), ...data });
		const open = await make();
		const done = await make({ status: 'done' });

		const row = await markRead(client, open.id);
		expect(row).toMatchObject({ ticket: open.id });
		expect(await markRead(client, open.id)).toBeNull();
		await markRead(client, done.id);

		const since = '2000-01-01 00:00:00.000Z';
		expect((await listReads(client, since)).map((entry) => entry.ticket)).toEqual([open.id]);
		expect(await listReads(client, '2999-01-01 00:00:00.000Z')).toEqual([]);
		// A ticket the user cannot see: the create rule refuses (400 without field errors).
		await expect(markRead(client, tickets.aPrivate.id)).rejects.toMatchObject({ status: 400 });
	});

	it('moves the base line to now and keeps the auth record in step', async () => {
		const fresh = await createAppUser(s.superuser);
		const client = await userClient(fresh);
		const before = Date.now();
		const since = await markAllRead(client);
		expect(Date.parse(since.replace(' ', 'T'))).toBeGreaterThanOrEqual(before - 2000);
		expect(client.authStore.record.unread_since).toBe(since);
		expect(client.authStore.record.email).toBe(fresh.email);
	});

	it('follows own read rows and the own base line in realtime', async () => {
		const fresh = await createAppUser(s.superuser);
		const client = await userClient(fresh);
		const ticket = await client
			.collection('tickets')
			.create(ownedPayload('tickets', fresh.record.id));
		const changes = [];
		const stop = await subscribeReads(client, fresh.record.id, (change) => changes.push(change));
		try {
			const row = await markRead(client, ticket.id);
			const since = await markAllRead(client);
			const deadline = Date.now() + EVENT_TIMEOUT_MS;
			while (changes.length < 2 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			expect(changes).toContainEqual({ action: 'create', read: { id: row.id, ticket: ticket.id } });
			expect(changes).toContainEqual({ action: 'baseline', unreadSince: since });
		} finally {
			await stop();
		}
	});
});
