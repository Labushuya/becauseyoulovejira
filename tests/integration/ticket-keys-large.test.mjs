// Ticket numbers of any length (KN-1, ADR-0030 Nachtrag 7) against an own disposable PocketBase:
// after 999, 9 999 and 999 999 come …-1000, …-10000 and …-1000000, without a limit and without
// padding, for TASK and for a project of six letters, when a ticket changes its project and when it
// moves between the areas Privat and Haushalt, alone or with its project. Only the superuser may
// set a counter (its API rules are null); the keys come from the hooks as always. The web layer
// finds the tickets by a part of the number and sorts their keys as numbers.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { uniqueSuffix } from '../support/scenario.mjs';
import { listOpenTickets, searchOpenTicketIds } from '../../web/src/lib/data/tickets.ts';
import { compareKeys } from '../../web/src/lib/domain/ordering.ts';

const HOUSEHOLD = '/api/byl/household';
const MOVE = '/api/byl/area/move';

let instance;
let superuser;

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

/** A new app account with random credentials (in memory only), signed in; its own private area. */
async function account(name = '') {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password, name })).id;
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return {
		id,
		client: pb,
		send: (path, body) => pb.send(path, { method: 'POST', body, requestKey: null }),
		ticket: (data = {}) => pb.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data }),
		project: (code, data = {}) => pb.collection('projects').create({ owner: id, name: `Projekt ${code}`, code, ...data })
	};
}

/** Sets the counter `key` to `value`, as if that many tickets had been numbered there. */
async function setCounter(key, value) {
	const counters = superuser.collection('ticket_counters');
	const [found] = await counters.getFullList({ filter: superuser.filter('key = {:key}', { key }) });
	if (found === undefined) await counters.create({ key, value });
	else await counters.update(found.id, { value });
}

async function counterOf(key) {
	const [found] = await superuser
		.collection('ticket_counters')
		.getFullList({ filter: superuser.filter('key = {:key}', { key }) });
	return found?.value ?? 0;
}

const ticketOf = (id) => superuser.collection('tickets').getOne(id);
const historyOf = (id) =>
	superuser.collection('ticket_history').getFullList({ filter: superuser.filter('ticket = {:id}', { id }), sort: 'created,id' });

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
});

afterAll(async () => {
	await instance?.stop();
});

describe('ticket numbers of any length (KN-1)', () => {
	it('counts on after 999, 9 999 and 999 999 without a limit or padding', async () => {
		const anna = await account();
		const counter = `u:${anna.id}:TASK`;
		// Titles without digits, so the search below matches the keys only.
		const create = () => anna.ticket({ title: 'Müll rausbringen' });
		expect((await create()).key).toBe('TASK-1');
		for (const [before, key] of [
			[999, 'TASK-1000'],
			[9999, 'TASK-10000'],
			[999999, 'TASK-1000000']
		]) {
			await setCounter(counter, before);
			expect(await create()).toMatchObject({ key, number: before + 1, scope: `u:${anna.id}` });
		}
		expect((await create()).key).toBe('TASK-1000001');
		expect(await counterOf(counter)).toBe(1000001);

		// The list of the web app gets every key whole and sorts them as numbers, not as text.
		const keys = (await listOpenTickets(anna.client)).map((ticket) => ticket.key);
		expect([...keys].sort(compareKeys)).toEqual(['TASK-1', 'TASK-1000', 'TASK-10000', 'TASK-1000000', 'TASK-1000001']);
		// The search finds a ticket by a part of its number.
		const found = await searchOpenTicketIds(anna.client, '10000');
		const byId = new Map((await listOpenTickets(anna.client)).map((ticket) => [ticket.id, ticket.key]));
		expect(found.map((id) => byId.get(id)).sort(compareKeys)).toEqual(['TASK-10000', 'TASK-1000000', 'TASK-1000001']);
	});

	it('gives a project of six letters the longest key of the format, also in the history', async () => {
		const bert = await account();
		const project = await bert.project('ABCDEF');
		await setCounter(`u:${bert.id}:${project.id}`, 999999);
		const ticket = await bert.ticket({ project: project.id });
		expect(ticket).toMatchObject({ key: 'ABCDEF-1000000', number: 1000000 });
		expect((await historyOf(ticket.id)).map((entry) => [entry.field, entry.new_value])).toEqual([['created', 'ABCDEF-1000000']]);
		expect((await bert.ticket({ project: project.id })).key).toBe('ABCDEF-1000001');
	});

	it('draws large numbers when a ticket changes its project, and back without one', async () => {
		const clara = await account();
		const tickets = clara.client.collection('tickets');
		const house = await clara.project('HAUS');
		const garden = await clara.project('GARTEN');
		await setCounter(`u:${clara.id}:${house.id}`, 9999);
		await setCounter(`u:${clara.id}:${garden.id}`, 999999);
		const ticket = await clara.ticket();
		expect(ticket.key).toBe('TASK-1');

		expect(await tickets.update(ticket.id, { project: house.id })).toMatchObject({ key: 'HAUS-10000', number: 10000 });
		expect(await tickets.update(ticket.id, { project: garden.id })).toMatchObject({ key: 'GARTEN-1000000', number: 1000000 });
		await setCounter(`u:${clara.id}:TASK`, 999);
		expect(await tickets.update(ticket.id, { project: '' })).toMatchObject({ key: 'TASK-1000', number: 1000 });
		// The history keeps every key whole.
		const keyChanges = (await historyOf(ticket.id))
			.filter((entry) => entry.field === 'key')
			.map((entry) => [entry.old_value, entry.new_value]);
		expect(keyChanges).toEqual([
			['TASK-1', 'HAUS-10000'],
			['HAUS-10000', 'GARTEN-1000000'],
			['GARTEN-1000000', 'TASK-1000']
		]);
	});

	it('draws large numbers when a ticket moves into the household and back', async () => {
		const dora = await account('Dora Beispiel');
		const householdId = (await dora.send(HOUSEHOLD, { name: `Haus ${uniqueSuffix()}` })).household.id;
		await setCounter(`h:${householdId}:TASK`, 999999);
		const ticket = await dora.ticket();
		expect(ticket.key).toBe('TASK-1');

		const moved = await dora.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household' });
		expect(moved.moved.tickets).toEqual([expect.objectContaining({ id: ticket.id, previous: 'TASK-1', key: 'TASK-1000000' })]);
		expect(await ticketOf(ticket.id)).toMatchObject({ scope: `h:${householdId}`, key: 'TASK-1000000', number: 1000000 });
		const entry = (await historyOf(ticket.id)).find((item) => item.field === 'area_move');
		expect(entry.old_value).toBe('TASK-1');
		expect(JSON.parse(entry.new_value)).toMatchObject({ to: 'household', key: 'TASK-1000000' });

		await setCounter(`u:${dora.id}:TASK`, 9999);
		const back = await dora.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'private' });
		expect(back.moved.tickets).toEqual([expect.objectContaining({ previous: 'TASK-1000000', key: 'TASK-10000' })]);
		expect(await ticketOf(ticket.id)).toMatchObject({ scope: `u:${dora.id}`, key: 'TASK-10000', number: 10000 });
	});

	it('draws large numbers for the tickets of a project that moves into the household', async () => {
		const emil = await account('Emil Beispiel');
		const householdId = (await emil.send(HOUSEHOLD, { name: `Haus ${uniqueSuffix()}` })).household.id;
		const project = await emil.project('ABCDEF');
		const first = await emil.ticket({ project: project.id });
		const second = await emil.ticket({ project: project.id });
		expect([first.key, second.key]).toEqual(['ABCDEF-1', 'ABCDEF-2']);
		// The project keeps its ID in the household, so its counter there is known beforehand.
		await setCounter(`h:${householdId}:${project.id}`, 999);

		await emil.send(MOVE, { kind: 'project', ids: [project.id], to: 'household' });
		const keys = (await Promise.all([first, second].map((ticket) => ticketOf(ticket.id)))).map((ticket) => ticket.key);
		expect(keys.sort(compareKeys)).toEqual(['ABCDEF-1000', 'ABCDEF-1001']);
		expect(await counterOf(`h:${householdId}:${project.id}`)).toBe(1001);
	});
});
