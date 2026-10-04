// Areas "Privat" and "Haushalt" (E7-3, ADR-0059) against an own disposable PocketBase: A and B share
// a household, C is alone. A subscription filtered by the area of a tab gets no event of the other
// area (also the "delete" of the trash); no reference crosses the border of an area (project, tag,
// parent, dependency, rule and "Wiederholen…", target project of a connection, source of a ticket);
// connections stay private; entries of the inbox and tickets of a rule land in their area; @CODE is
// unique per area; the trash of a household needs the owner or the right "purge" to delete for good,
// and its retention is the one of the household (the daily run with the clock of
// tests/fixtures/pb_hooks/trash-clock.pb.js). The migration of the retention and its way back are in
// migrations-rollback.test.mjs.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { ownedPayload, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';

const ROUTE = '/api/byl/household';
const EVENT_TIMEOUT_MS = scaled(5_000);
const QUIET_PERIOD_MS = scaled(500);
const TOKEN = randomBytes(24).toString('base64');
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** A new app account with random credentials (in memory only), signed in. */
async function createAccount() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
	const client = createClient();
	await client.collection('users').authWithPassword(email, password);
	return {
		id,
		client,
		send: (path, body, method = 'POST') => client.send(path, { method, body, requestKey: null }),
		ticket: (data = {}) => client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data }),
		project: (data = {}) =>
			client.collection('projects').create({ owner: id, name: `Projekt ${uniqueSuffix()}`, code: uniqueCode(), ...data }),
		tag: (data = {}) => client.collection('tags').create({ owner: id, name: `tag-${uniqueSuffix()}`, ...data })
	};
}

const scopeOf = (person) => `u:${person.id}`;
const householdScope = () => `h:${householdId}`;

/** Status, validation codes and messages of a rejected call. */
async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		const data = error.response?.data ?? {};
		return {
			status: error.status,
			codes: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.code])),
			messages: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.message])),
			problem: error.response?.problem,
			message: error.response?.message
		};
	}
	throw new Error('Expected the request to be rejected, but it succeeded.');
}

async function statusOf(promise) {
	try {
		await promise;
		return 200;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return error.status;
	}
}

/** Collects the realtime events of tickets with the filter of an area, as the app subscribes. */
async function watch(person, scope) {
	const events = [];
	stops.push(
		await person.client
			.collection('tickets')
			.subscribe('*', (event) => events.push([event.action, event.record.id]), {
				filter: person.client.filter('scope = {:scope}', { scope })
			})
	);
	return events;
}

async function waitFor(list, action, id) {
	const deadline = Date.now() + EVENT_TIMEOUT_MS;
	while (!list.some(([seen, seenId]) => seen === action && seenId === id)) {
		if (Date.now() > deadline) throw new Error(`No realtime event ${action} ${id} within ${EVENT_TIMEOUT_MS} ms`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

const quiet = () => new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));

async function runTrash(nowMs) {
	const response = await fetch(`${instance.url}/api/byl-test/trash/run`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ now: nowMs })
	});
	expect(response.status).toBe(200);
	return response.json();
}

async function runRecurrence(iso) {
	const response = await fetch(`${instance.url}/api/byl-test/recurrence/run`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ now: Date.parse(iso) })
	});
	expect(response.status).toBe(200);
	return response.json();
}

const trashOf = (person, scope) =>
	person.client.send('/api/byl/trash', { method: 'GET', query: scope ? { scope } : {}, requestKey: null });

beforeAll(async () => {
	instance = await startPocketBase({ env: { BYL_INGEST_TOKEN: TOKEN } });
	superuser = createClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	// A is the first account and so the administrator of the app (ADR-0056 §1): only it sets up
	// connections with access data. B and C are plain accounts.
	a = await createAccount();
	b = await createAccount();
	c = await createAccount();
	// A founds the household (and owns it), B joins with a code; C stays alone.
	householdId = (await a.send(ROUTE, { name: `Haus ${uniqueSuffix()}` })).household.id;
	const { code } = await a.send(`${ROUTE}/invites`, {});
	await b.send(`${ROUTE}/join`, { code });
});

afterAll(async () => {
	for (const stop of stops) await stop().catch(() => undefined);
	await instance?.stop();
});

describe('realtime filtered by the area of the tab (ADR-0059 §2)', () => {
	it('delivers only events of the subscribed area, also the "delete" of the trash', async () => {
		const aHousehold = await watch(a, householdScope());
		const aPrivate = await watch(a, scopeOf(a));
		const bHousehold = await watch(b, householdScope());

		const own = await a.ticket();
		const shared = await a.ticket({ household: householdId });
		expect(own.scope).toBe(scopeOf(a));
		expect(shared.scope).toBe(householdScope());
		await waitFor(aHousehold, 'create', shared.id);
		await waitFor(aPrivate, 'create', own.id);
		await waitFor(bHousehold, 'create', shared.id);

		// Into the trash: the server sends the "delete" itself (ADR-0037), only to the right area.
		await a.client.collection('tickets').delete(own.id);
		await b.client.collection('tickets').delete(shared.id);
		await waitFor(aPrivate, 'delete', own.id);
		await waitFor(aHousehold, 'delete', shared.id);
		await waitFor(bHousehold, 'delete', shared.id);
		await quiet();

		expect(aHousehold.filter(([, id]) => id === own.id)).toEqual([]);
		expect(aPrivate.filter(([, id]) => id === shared.id)).toEqual([]);
		expect(bHousehold.filter(([, id]) => id === own.id)).toEqual([]);
	});

	it('narrows lists to one area with the same filter', async () => {
		const own = await a.ticket();
		const shared = await a.ticket({ household: householdId });
		const list = async (scope) =>
			(await a.client.collection('tickets').getFullList({ filter: a.client.filter('scope = {:scope}', { scope }) })).map(
				(ticket) => ticket.id
			);
		expect(await list(householdScope())).toContain(shared.id);
		expect(await list(householdScope())).not.toContain(own.id);
		expect(await list(scopeOf(a))).toContain(own.id);
		expect(await list(scopeOf(a))).not.toContain(shared.id);
		// C sees nothing of the household, whatever it asks for.
		expect(await statusOf(c.client.collection('tickets').getOne(shared.id))).toBe(404);
	});
});

describe('no reference across the border of an area (ADR-0059 §4)', () => {
	let privateProject;
	let householdProject;
	let privateTag;
	let privateTicket;
	let householdTicket;

	beforeAll(async () => {
		privateProject = await a.project();
		householdProject = await a.project({ household: householdId });
		privateTag = await a.tag();
		privateTicket = await a.ticket();
		householdTicket = await a.ticket({ household: householdId });
	});

	it('refuses the project, tags and parent of another area with an understandable message', async () => {
		const project = await rejection(a.ticket({ household: householdId, project: privateProject.id }));
		expect(project).toMatchObject({ status: 400, codes: { project: 'validation_scope_mismatch' } });
		expect(project.messages.project).toMatch(/anderen Bereich/);
		expect((await rejection(a.ticket({ project: householdProject.id }))).codes).toEqual({
			project: 'validation_scope_mismatch'
		});
		const tags = await rejection(b.ticket({ household: householdId, tags: [privateTag.id] }));
		expect(tags.codes).toEqual({ tags: 'validation_scope_mismatch' });
		const parent = await rejection(a.ticket({ household: householdId, parent: privateTicket.id }));
		expect(parent.codes).toEqual({ parent: 'validation_scope_mismatch' });
		expect(parent.messages.parent).toMatch(/übergeordnete Ticket gehört zu einem anderen Bereich/);
		// Also when an existing ticket gets one.
		const update = await rejection(
			a.client.collection('tickets').update(householdTicket.id, { project: privateProject.id })
		);
		expect(update.codes).toEqual({ project: 'validation_scope_mismatch' });
		// A sub project lies under a parent of its own area.
		const subProject = await rejection(a.project({ household: householdId, parent: privateProject.id }));
		expect(subProject.status).toBe(400);
		expect(Object.keys(subProject.codes)).toEqual(['parent']);
	});

	it('refuses a dependency across the border, for every writer', async () => {
		const refused = await rejection(
			superuser.collection('dependencies').create({
				blocker: privateTicket.id,
				blocked: householdTicket.id,
				owner: a.id,
				household: householdId
			})
		);
		expect(refused).toMatchObject({ status: 400, codes: { blocker: 'validation_scope_mismatch' } });
		const second = await a.ticket({ household: householdId });
		const allowed = await superuser
			.collection('dependencies')
			.create({ blocker: householdTicket.id, blocked: second.id, owner: a.id, household: householdId });
		expect(allowed.id).toBeTruthy();
	});

	it('refuses a rule whose template or ticket lies in another area', async () => {
		const template = await rejection(
			a.client.collection('recurrence_rules').create({
				...ownedPayload('recurrence_rules', a.id, householdId),
				project: privateProject.id
			})
		);
		expect(template.codes).toEqual({ project: 'validation_scope_mismatch' });
		const repeat = await rejection(
			a.client.collection('recurrence_rules').create({
				...ownedPayload('recurrence_rules', a.id, householdId),
				ticket: privateTicket.id
			})
		);
		expect(repeat.codes).toEqual({ ticket: 'validation_recurrence_ticket_missing' });
	});

	it('refuses a source of another area for a new ticket', async () => {
		const item = await a.client.collection('inbox_items').create(ownedPayload('inbox_items', a.id));
		const refused = await rejection(a.ticket({ household: householdId, source_item: item.id }));
		expect(refused.codes).toEqual({ source_item: 'validation_scope_mismatch' });
	});

	it('keeps a duplicate in the area of its original and refuses a project of another area', async () => {
		const route = `/api/byl/tickets/${householdTicket.id}/duplicate`;
		const body = { title: `Kopie ${uniqueSuffix()}`, status: 'open', project: '', source: 'none' };
		const result = await b.send(route, body);
		expect((await superuser.collection('tickets').getOne(result.id)).scope).toBe(householdScope());
		const refused = await rejection(b.send(route, { ...body, project: privateProject.id }));
		expect(refused.status).toBe(400);
	});

	it('keeps connections private: none in a household, no target project of another area', async () => {
		// A is the administrator of the app and a member of the household.
		const connection = {
			owner: a.id,
			type: 'github',
			label: `GitHub ${uniqueSuffix()}`,
			enabled: false,
			secret_env: 'BYL_GITHUB_TOKEN',
			settings: { interval: 15, repos: [] }
		};
		const inHousehold = await rejection(a.client.collection('connections').create({ ...connection, household: householdId }));
		expect(inHousehold).toMatchObject({ status: 400, codes: { household: 'validation_connection_private_only' } });
		const target = await rejection(
			a.client.collection('connections').create({ ...connection, target_project: householdProject.id })
		);
		expect(target.codes).toEqual({ target_project: 'validation_target_project_missing' });
		const own = await a.client.collection('connections').create({ ...connection, target_project: privateProject.id });
		expect(own.scope).toBe(scopeOf(a));
	});
});

describe('records land in their area (ADR-0059 §3)', () => {
	it('creates the tickets of a rule in the area of the rule', async () => {
		const project = await b.project({ household: householdId });
		const rule = await b.client.collection('recurrence_rules').create({
			...ownedPayload('recurrence_rules', b.id, householdId),
			title: 'Müll rausbringen',
			project: project.id,
			anchor: '2031-03-03',
			lead_days: 0
		});
		expect(rule.scope).toBe(householdScope());
		expect((await runRecurrence('2031-03-03T08:00:00Z')).created).toBeGreaterThanOrEqual(1);
		const [ticket] = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('recurrence = {:rule}', { rule: rule.id }) });
		expect(ticket).toMatchObject({ household: householdId, scope: householdScope(), project: project.id });
		// A, the other member, sees it; C does not.
		expect((await a.client.collection('tickets').getOne(ticket.id)).id).toBe(ticket.id);
		expect(await statusOf(c.client.collection('tickets').getOne(ticket.id))).toBe(404);
		await superuser.collection('recurrence_rules').update(rule.id, { active: false });
	});

	it('takes an .ics file into the inbox of the household, and refuses a foreign one', async () => {
		const uid = `${uniqueSuffix()}@example.com`;
		const ics = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Beispiel//DE',
			'BEGIN:VEVENT',
			`UID:${uid}`,
			'DTSTAMP:20310101T080000Z',
			'DTSTART:20310310T090000Z',
			'SUMMARY:Elternabend',
			'END:VEVENT',
			'END:VCALENDAR',
			''
		].join('\r\n');
		const form = (household) => {
			const body = new FormData();
			body.append('file', new Blob([ics], { type: 'text/calendar' }), 'termin.ics');
			body.append('select', JSON.stringify([0]));
			if (household !== undefined) body.append('household', household);
			return body;
		};
		const imported = await b.client.send('/api/byl/inbox/ics', { method: 'POST', body: form(householdId) });
		expect(imported.created).toBe(1);
		const item = await a.client.collection('inbox_items').getOne(imported.item);
		expect(item).toMatchObject({ household: householdId, scope: householdScope(), channel: 'ics' });
		// The same file privately is another entry (another area), not a duplicate.
		const own = await b.client.send('/api/byl/inbox/ics', { method: 'POST', body: form() });
		expect(own.created).toBe(1);
		expect((await b.client.collection('inbox_items').getOne(own.item)).scope).toBe(scopeOf(b));
		// The preview and the lookup ask in the area they name.
		const preview = await b.client.send('/api/byl/inbox/ics/preview', { method: 'POST', body: form(householdId) });
		expect(preview.items[0].state).toBe('new');
		expect(await statusOf(c.client.send('/api/byl/inbox/ics', { method: 'POST', body: form(householdId) }))).toBe(400);
	});

	it('gives an entry of a connection the area of the connection', async () => {
		// A household connection exists only from the admin UI (app accounts cannot create one).
		const mailbox = await superuser.collection('connections').create({
			owner: a.id,
			household: householdId,
			type: 'mail',
			label: 'Familie',
			enabled: true,
			secret_env: 'BYL_TEST_FAMILY_MAIL',
			settings: { provider: 'webde', user: 'familie@web.de', keywords: ['todo'] }
		});
		const response = await fetch(`${instance.url}/api/byl/ingest/items`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				connection: mailbox.id,
				origin: 'auto',
				title: `Todo: Zahnarzt ${uniqueSuffix()}`,
				body: 'Termin machen.',
				source_ref: `<${uniqueSuffix()}@example.com>`,
				source_date: '2031-01-05 08:00:00.000Z',
				source_meta: { from: 'Praxis <praxis@example.com>' }
			})
		});
		expect(response.status).toBe(200);
		const { item } = await response.json();
		expect(await b.client.collection('inbox_items').getOne(item)).toMatchObject({
			household: householdId,
			scope: householdScope(),
			connection: mailbox.id
		});
	});
});

describe('@CODE per area (ADR-0059 §5)', () => {
	it('is unique per area: the same code privately, in the household and for C', async () => {
		const code = uniqueCode();
		await a.project({ code });
		await a.project({ code, household: householdId });
		await c.project({ code });
		const twice = await rejection(b.project({ code, household: householdId }));
		expect(twice).toMatchObject({ status: 400, codes: { code: 'validation_not_unique' } });
		const own = await rejection(a.project({ code }));
		expect(own).toMatchObject({ status: 400, codes: { code: 'validation_not_unique' } });
	});
});

describe('trash of a household (ADR-0059 §6)', () => {
	const member = () => a.client.collection('household_members').getFirstListItem(a.client.filter('user = {:u}', { u: b.id }));

	it('lets every member see and restore, deleting for good only with the owner or "purge"', async () => {
		// Done, so nothing blocks deleting it for good (ADR-0047).
		const ticket = await b.ticket({ household: householdId, status: 'done' });
		await b.client.collection('tickets').delete(ticket.id);

		const list = await trashOf(b, householdScope());
		expect(list.items.map((item) => item.id)).toContain(ticket.id);
		expect(list).toMatchObject({ scope: householdScope(), can_purge: false });
		expect(list.items.find((item) => item.id === ticket.id).scope).toBe(householdScope());
		// The private trash of B has none of it; without an area every visible area as before.
		expect((await trashOf(b, scopeOf(b))).items.map((item) => item.id)).not.toContain(ticket.id);
		expect((await trashOf(b)).items.map((item) => item.id)).toContain(ticket.id);

		await b.send(`/api/byl/trash/${ticket.id}/restore`, {});
		await b.client.collection('tickets').delete(ticket.id);
		const refused = await rejection(b.send(`/api/byl/trash/${ticket.id}/purge`, {}));
		expect(refused.status).toBe(403);
		expect(refused.message).toMatch(/Endgültig löschen/);
		expect((await rejection(b.send('/api/byl/trash/empty', { scope: householdScope() }))).status).toBe(403);
		// Emptying without an area leaves the household alone.
		expect((await b.send('/api/byl/trash/empty', {})).purged).toBe(0);
		expect((await trashOf(b, householdScope())).items.map((item) => item.id)).toContain(ticket.id);

		// The owner may; then B with the right "purge".
		expect((await trashOf(a, householdScope())).can_purge).toBe(true);
		await a.send(`/api/byl/trash/${ticket.id}/purge`, {});
		expect(await statusOf(superuser.collection('tickets').getOne(ticket.id))).toBe(404);

		await a.send(`${ROUTE}/members/${(await member()).id}/rights`, { rights: ['purge'] });
		const second = await b.ticket({ household: householdId, status: 'done' });
		await b.client.collection('tickets').delete(second.id);
		expect((await trashOf(b, householdScope())).can_purge).toBe(true);
		const emptied = await b.send('/api/byl/trash/empty', { scope: householdScope() });
		expect(emptied.purged).toBeGreaterThanOrEqual(1);
		expect(await statusOf(superuser.collection('tickets').getOne(second.id))).toBe(404);
		await a.send(`${ROUTE}/members/${(await member()).id}/rights`, { rights: [] });
	});

	it('refuses an area the account is not a member of', async () => {
		expect((await rejection(trashOf(c, householdScope()))).status).toBe(400);
		expect((await rejection(trashOf(c, scopeOf(a)))).status).toBe(400);
	});

	it('changes the retention only with the owner or "purge", and the daily run follows it per area', async () => {
		const refused = await rejection(b.send(`${ROUTE}/retention`, { retention: '7' }));
		expect(refused).toMatchObject({ status: 403, problem: 'right' });
		expect((await rejection(a.send(`${ROUTE}/retention`, { retention: '14' }))).problem).toBe('retention');
		const state = await a.send(`${ROUTE}/retention`, { retention: '7' });
		expect(state.household.trash_retention).toBe('7');
		expect((await b.send(ROUTE, undefined, 'GET')).household.trash_retention).toBe('7');
		expect((await trashOf(b, householdScope())).retention).toBe('7');
		// The private trash keeps the setting of the account (default 30 days).
		expect((await trashOf(a, scopeOf(a))).retention).toBe('');

		const shared = await a.ticket({ household: householdId, status: 'done' });
		const own = await a.ticket({ status: 'done' });
		await a.client.collection('tickets').delete(shared.id);
		await a.client.collection('tickets').delete(own.id);
		const now = Date.now();
		// Eight days later: the household ticket is due (7 days), the private one not (30 days).
		await runTrash(now + 8 * DAY_MS);
		expect(await statusOf(superuser.collection('tickets').getOne(shared.id))).toBe(404);
		expect((await superuser.collection('tickets').getOne(own.id)).deleted_at).not.toBe('');

		// "Nie automatisch" in the household keeps its tickets.
		await a.send(`${ROUTE}/retention`, { retention: 'never' });
		const kept = await a.ticket({ household: householdId, status: 'done' });
		await a.client.collection('tickets').delete(kept.id);
		await runTrash(now + 400 * DAY_MS);
		expect((await superuser.collection('tickets').getOne(kept.id)).deleted_at).not.toBe('');
		expect(await statusOf(superuser.collection('tickets').getOne(own.id))).toBe(404);
	});
});
