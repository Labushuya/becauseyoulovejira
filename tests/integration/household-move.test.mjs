// Moving between the areas Privat and Haushalt and dissolving a household (E7-4, ADR-0061) against an
// own disposable PocketBase: A and B share a household (A founds it, so A is its owner), C is alone.
// Every kind of move in both directions with its cascade (sub-tasks, sub projects, tickets of a
// project, sources), every conflict and its choice (project, tags, dependencies, parent, @CODE, entry
// of the inbox with connection, target project and fingerprint), numbers and history, the rights of
// the creator and of "move_out" for every record of the cascade, one transaction (a failure in the
// middle leaves everything as it was), the realtime "delete" of tabs that lose a record and the update
// of those that see it now, and dissolving a household both ways. The new owner chosen by the
// administrator is in accounts.test.mjs, the connections of before in migrations-rollback.test.mjs.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FAIL_AREA_MOVE, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import { moveRecords } from '../../web/src/lib/data/area-move.ts';
import { dissolveHousehold } from '../../web/src/lib/data/household.ts';

const ROUTE = '/api/byl/household';
const MOVE = '/api/byl/area/move';
const EVENT_TIMEOUT_MS = scaled(5_000);
const TOKEN = randomBytes(24).toString('base64');

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
async function createAccount(name = '') {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password, name })).id;
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

const privateScope = (person) => `u:${person.id}`;
const householdScope = () => `h:${householdId}`;

/** Status, problem, params and message of a refused call. */
async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return {
			status: error.status,
			problem: error.response?.problem,
			params: error.response?.params,
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

const ticketOf = (id) => superuser.collection('tickets').getOne(id);
const historyOf = (id) =>
	superuser.collection('ticket_history').getFullList({ filter: superuser.filter('ticket = {:id}', { id }), sort: 'created,id' });

/** Collects the realtime events of a collection with the filter of an area, as the app subscribes. */
async function watch(person, collection, scope) {
	const events = [];
	stops.push(
		await person.client
			.collection(collection)
			.subscribe('*', (event) => events.push({ action: event.action, id: event.record.id, record: event.record }), {
				filter: person.client.filter('scope = {:scope}', { scope })
			})
	);
	return events;
}

async function waitFor(list, action, id) {
	const deadline = Date.now() + EVENT_TIMEOUT_MS;
	for (;;) {
		const found = list.find((event) => event.action === action && event.id === id);
		if (found) return found;
		if (Date.now() > deadline) throw new Error(`No realtime event ${action} ${id} within ${EVENT_TIMEOUT_MS} ms`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
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

async function memberOf(person) {
	return a.client.collection('household_members').getFirstListItem(a.client.filter('user = {:u}', { u: person.id }));
}

beforeAll(async () => {
	instance = await startPocketBase({ env: { BYL_INGEST_TOKEN: TOKEN } });
	superuser = createClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	// A is the first account and so the administrator of the app; it founds the household, B joins.
	a = await createAccount('Anna Beispiel');
	b = await createAccount('Bert Beispiel');
	c = await createAccount('Clara Beispiel');
	householdId = (await a.send(ROUTE, { name: `Haus ${uniqueSuffix()}` })).household.id;
	const { code } = await a.send(`${ROUTE}/invites`, {});
	await b.send(`${ROUTE}/join`, { code });
});

afterAll(async () => {
	for (const stop of stops) await stop().catch(() => undefined);
	await instance?.stop();
});

describe('a ticket with its sub-tasks into the household and back', () => {
	it('previews without a change, then moves the cascade with new keys, history, tags and comments', async () => {
		const project = await a.project();
		const tag = await a.tag({ name: `einkauf-${uniqueSuffix()}` });
		const ticket = await a.ticket({ project: project.id, tags: [tag.id] });
		const sub = await a.ticket({ project: project.id, parent: ticket.id });
		await a.client.collection('comments').create({ ticket: ticket.id, author: a.id, body: 'Bitte bis Freitag.' });
		const before = await ticketOf(ticket.id);

		const preview = await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household', preview: true });
		expect(preview).toMatchObject({
			preview: true,
			to: 'household',
			scope: householdScope(),
			from_name: 'Privat',
			counts: { tickets: 2, subtasks: 1, projects: 0, comments: 1 },
			needs: { project: true, dependencies: false, codes: [] }
		});
		expect(preview.conflicts.project.projects).toEqual([{ id: project.id, code: project.code, name: project.name }]);
		expect(preview.conflicts.tags).toEqual({ reused: [], created: [tag.name] });
		expect((await ticketOf(ticket.id)).scope).toBe(privateScope(a));

		// Without the choice of the project nothing moves.
		expect((await rejection(a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household' }))).problem).toBe(
			'project-choice'
		);
		const moved = await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household', project: '' });
		expect(moved.preview).toBe(false);
		const keys = Object.fromEntries(moved.moved.tickets.map((entry) => [entry.id, entry]));
		expect(keys[ticket.id].previous).toBe(before.key);
		expect(keys[ticket.id].key).toMatch(/^TASK-\d+$/);

		const after = await ticketOf(ticket.id);
		expect(after).toMatchObject({ household: householdId, scope: householdScope(), owner: a.id, project: '' });
		expect(after.key).toBe(keys[ticket.id].key);
		const child = await ticketOf(sub.id);
		expect(child).toMatchObject({ household: householdId, parent: ticket.id, project: '' });
		// The tag of the same name in the household (created now), the private one stays.
		const [shared] = await superuser
			.collection('tags')
			.getFullList({ filter: superuser.filter('scope = {:s} && name = {:n}', { s: householdScope(), n: tag.name }) });
		expect(after.tags).toEqual([shared.id]);
		expect((await superuser.collection('tags').getOne(tag.id)).scope).toBe(privateScope(a));
		// History: one entry with the old key, the new key and the project left behind.
		const entry = (await historyOf(ticket.id)).find((item) => item.field === 'area_move');
		expect(entry.old_value).toBe(before.key);
		expect(JSON.parse(entry.new_value)).toEqual({
			to: 'household',
			key: after.key,
			project: { from: project.name, to: '' }
		});
		expect(entry.user).toBe(a.id);
		// B sees the ticket, its sub-task and its comment now; the ID stayed.
		expect((await b.client.collection('tickets').getOne(ticket.id)).key).toBe(after.key);
		expect((await b.client.collection('comments').getFullList({ filter: b.client.filter('ticket = {:t}', { t: ticket.id }) })).length).toBe(1);
		expect(await statusOf(c.client.collection('tickets').getOne(ticket.id))).toBe(404);

		// Back into the private area of A (A created it): a new key in the private counter again.
		const back = await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'private' });
		expect(back.moved.tickets.find((item) => item.id === ticket.id).previous).toBe(after.key);
		expect(await ticketOf(ticket.id)).toMatchObject({ household: '', scope: privateScope(a), owner: a.id });
		expect(await statusOf(b.client.collection('tickets').getOne(ticket.id))).toBe(404);
	});

	it('moves a sub-task alone as a top-level ticket and keeps the parent where it is', async () => {
		const parent = await a.ticket();
		const sub = await a.ticket({ parent: parent.id });
		const preview = await a.send(MOVE, { kind: 'ticket', ids: [sub.id], to: 'household', preview: true });
		expect(preview.conflicts.parents).toEqual([{ id: sub.id, key: sub.key, parent: parent.key }]);
		await a.send(MOVE, { kind: 'ticket', ids: [sub.id], to: 'household' });
		expect(await ticketOf(sub.id)).toMatchObject({ parent: '', scope: householdScope() });
		expect((await ticketOf(parent.id)).scope).toBe(privateScope(a));
		const entry = (await historyOf(sub.id)).find((item) => item.field === 'area_move');
		expect(JSON.parse(entry.new_value).parent).toBe(parent.key);
	});

	it('takes a chosen project of the target, only an active one there', async () => {
		const target = await a.project({ household: householdId });
		const archived = await a.project({ household: householdId, archived: true });
		const own = await a.project();
		const ticket = await a.ticket({ project: own.id });
		// The preview names the active projects of the target to choose from (the tab knows only its own).
		const preview = await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household', preview: true });
		const targets = preview.conflicts.project.targets.map((project) => project.id);
		expect(targets).toContain(target.id);
		expect(targets).not.toContain(archived.id);
		expect(targets).not.toContain(own.id);
		for (const project of [archived.id, own.id]) {
			expect((await rejection(a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household', project }))).problem).toBe(
				'project'
			);
		}
		const moved = await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household', project: target.id });
		expect(moved.moved.tickets[0].key).toMatch(new RegExp(`^${target.code}-\\d+$`));
		expect((await ticketOf(ticket.id)).project).toBe(target.id);
	});

	it('moves several tickets at once (the bulk action) and refuses a ticket of the target area', async () => {
		const first = await a.ticket();
		const second = await a.ticket();
		const moved = await a.send(MOVE, { kind: 'ticket', ids: [first.id, second.id], to: 'household' });
		expect(moved.counts.tickets).toBe(2);
		const again = await rejection(a.send(MOVE, { kind: 'ticket', ids: [first.id], to: 'household' }));
		expect([again.status, again.problem]).toEqual([400, 'area']);
		const format = await rejection(a.send(MOVE, { kind: 'ticket', ids: [], to: 'household' }));
		expect([format.status, format.problem]).toEqual([400, 'format']);
	});
});

describe('dependencies with tickets that stay behind', () => {
	it('names them, takes the other ticket along or releases the dependency', async () => {
		const one = await a.ticket();
		const two = await a.ticket();
		const dependency = await superuser.collection('dependencies').create({ blocker: one.id, blocked: two.id, owner: a.id });
		const preview = await a.send(MOVE, { kind: 'ticket', ids: [one.id], to: 'household', preview: true });
		expect(preview.needs.dependencies).toBe(true);
		expect(preview.conflicts.dependencies).toEqual([
			{ ticket: { id: one.id, key: one.key, title: one.title }, other: { id: two.id, key: two.key, title: two.title } }
		]);
		expect((await rejection(a.send(MOVE, { kind: 'ticket', ids: [one.id], to: 'household' }))).problem).toBe(
			'dependencies-choice'
		);
		const taking = await a.send(MOVE, { kind: 'ticket', ids: [one.id], to: 'household', preview: true, dependencies: 'take' });
		expect(taking.counts).toMatchObject({ tickets: 2, dependencies: 1 });
		expect(taking.needs.dependencies).toBe(false);
		await a.send(MOVE, { kind: 'ticket', ids: [one.id], to: 'household', dependencies: 'take' });
		expect((await ticketOf(two.id)).scope).toBe(householdScope());
		expect((await superuser.collection('dependencies').getOne(dependency.id)).household).toBe(householdId);

		const three = await a.ticket();
		const four = await a.ticket();
		const released = await superuser.collection('dependencies').create({ blocker: three.id, blocked: four.id, owner: a.id });
		await a.send(MOVE, { kind: 'ticket', ids: [three.id], to: 'household', dependencies: 'release' });
		expect(await statusOf(superuser.collection('dependencies').getOne(released.id))).toBe(404);
		expect((await ticketOf(four.id)).scope).toBe(privateScope(a));
	});
});

describe('a project with its sub projects and tickets', () => {
	it('asks for a new code when the target has it, and numbers the tickets anew', async () => {
		const code = uniqueCode().slice(0, 4);
		await a.project({ household: householdId, code });
		const project = await a.project({ code });
		const sub = await a.project({ parent: project.id });
		const ticket = await a.ticket({ project: project.id });
		const subTicket = await a.ticket({ project: sub.id });
		const rule = await a.client.collection('recurrence_rules').create({
			owner: a.id,
			title: `Regel ${uniqueSuffix()}`,
			mode: 'calendar',
			freq: 'weekly',
			weekdays: ['MO'],
			// Far ahead, so the rule makes no ticket of the project yet.
			anchor: '2040-01-02',
			lead_days: 0,
			initial_status: 'open',
			project: project.id
		});

		const preview = await a.send(MOVE, { kind: 'project', ids: [project.id], to: 'household', preview: true });
		expect(preview.counts).toMatchObject({ projects: 2, tickets: 2 });
		expect(preview.needs.codes).toEqual([project.id]);
		expect(preview.conflicts.codes).toEqual([{ id: project.id, code, name: project.name, suggestion: `${code}H` }]);
		expect(preview.conflicts.rules_project).toEqual([{ id: rule.id, title: rule.title }]);

		for (const bad of [undefined, code, 'x', 'TASK', 'ZU-LANGE']) {
			const refused = await rejection(
				a.send(MOVE, { kind: 'project', ids: [project.id], to: 'household', codes: bad === undefined ? {} : { [project.id]: bad } })
			);
			expect([refused.problem, refused.params?.project], String(bad)).toEqual(['code', project.id]);
		}
		const moved = await a.send(MOVE, { kind: 'project', ids: [project.id], to: 'household', codes: { [project.id]: `${code}H` } });
		expect(moved.moved.projects.find((item) => item.id === project.id).code).toBe(`${code}H`);
		expect(await superuser.collection('projects').getOne(project.id)).toMatchObject({ scope: householdScope(), code: `${code}H` });
		expect(await superuser.collection('projects').getOne(sub.id)).toMatchObject({ scope: householdScope(), parent: project.id });
		expect((await ticketOf(ticket.id)).key).toBe(`${code}H-1`);
		expect((await ticketOf(subTicket.id)).key).toBe(`${sub.code}-1`);
		// The rule stays private and loses its project of the other area.
		expect(await superuser.collection('recurrence_rules').getOne(rule.id)).toMatchObject({ scope: privateScope(a), project: '' });
	});

	it('moves a sub project alone as a top-level project', async () => {
		const parent = await a.project();
		const sub = await a.project({ parent: parent.id });
		const preview = await a.send(MOVE, { kind: 'project', ids: [sub.id], to: 'household', preview: true });
		expect(preview.conflicts.project_parents).toEqual([{ id: sub.id, code: sub.code, parent: parent.code }]);
		await a.send(MOVE, { kind: 'project', ids: [sub.id], to: 'household' });
		expect(await superuser.collection('projects').getOne(sub.id)).toMatchObject({ parent: '', scope: householdScope() });
	});
});

describe('a rule and the tickets of a series', () => {
	it('lets the tickets made so far stay without the rule; the next one comes in the target', async () => {
		const project = await a.project();
		const rule = await a.client.collection('recurrence_rules').create({
			owner: a.id,
			title: `Müll ${uniqueSuffix()}`,
			mode: 'calendar',
			freq: 'daily',
			anchor: '2032-04-01',
			lead_days: 0,
			initial_status: 'open',
			project: project.id
		});
		await runRecurrence('2032-04-01T08:00:00Z');
		const [instance] = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('recurrence = {:r}', { r: rule.id }) });
		expect(instance.scope).toBe(privateScope(a));

		const preview = await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', preview: true });
		expect(preview).toMatchObject({ counts: { rules: 1, tickets: 0 }, needs: { project: true } });
		expect(preview.conflicts.rule_tickets).toBe(1);
		await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', project: '' });
		expect(await superuser.collection('recurrence_rules').getOne(rule.id)).toMatchObject({ scope: householdScope(), project: '' });
		expect(await ticketOf(instance.id)).toMatchObject({ scope: privateScope(a), recurrence: '' });
		expect((await historyOf(instance.id)).some((item) => item.field === 'recurrence' && item.new_value === '')).toBe(true);

		await runRecurrence('2032-04-03T08:00:00Z');
		const next = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('recurrence = {:r}', { r: rule.id }) });
		expect(next.length).toBeGreaterThan(0);
		expect(next.every((ticket) => ticket.scope === householdScope())).toBe(true);
		await superuser.collection('recurrence_rules').update(rule.id, { active: false });
	});

	it('moves a ticket of a series without its rule: it leaves the series', async () => {
		const rule = await a.client.collection('recurrence_rules').create({
			owner: a.id,
			title: `Blumen ${uniqueSuffix()}`,
			mode: 'calendar',
			freq: 'daily',
			anchor: '2032-05-01',
			lead_days: 0,
			initial_status: 'open'
		});
		await runRecurrence('2032-05-01T08:00:00Z');
		const [instance] = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('recurrence = {:r}', { r: rule.id }) });
		const preview = await a.send(MOVE, { kind: 'ticket', ids: [instance.id], to: 'household', preview: true });
		expect(preview.conflicts.series).toEqual([{ id: instance.id, key: instance.key }]);
		await a.send(MOVE, { kind: 'ticket', ids: [instance.id], to: 'household' });
		expect(await ticketOf(instance.id)).toMatchObject({ scope: householdScope(), recurrence: '' });
		const entry = (await historyOf(instance.id)).find((item) => item.field === 'area_move');
		expect(JSON.parse(entry.new_value).series).toBe(true);
		await superuser.collection('recurrence_rules').update(rule.id, { active: false });
	});
});

describe('an entry of the inbox', () => {
	it('moves alone, loses a connection and a target project of the other area, and keeps a duplicate apart', async () => {
		const project = await a.project();
		await a.client.collection('users').update(a.id, { inbox_targets: { files: project.id } });
		const ref = `<${uniqueSuffix()}@example.com>`;
		const mail = { channel: 'eml', kind: 'mail', title: `Rechnung ${uniqueSuffix()}`, source_ref: ref };
		const item = await a.client.collection('inbox_items').create({ owner: a.id, ...mail });
		expect(item.target_project).toBe(project.id);
		// The same mail in the household already: both stay after the move.
		await b.client.collection('inbox_items').create({ owner: b.id, household: householdId, ...mail });

		const preview = await a.send(MOVE, { kind: 'item', ids: [item.id], to: 'household', preview: true });
		expect(preview.conflicts.items).toEqual({ connection: 0, target: 1, duplicate: 1 });
		await a.send(MOVE, { kind: 'item', ids: [item.id], to: 'household' });
		const moved = await superuser.collection('inbox_items').getOne(item.id);
		expect(moved).toMatchObject({ scope: householdScope(), target_project: '' });
		expect(moved.fingerprint).not.toBe(item.fingerprint);
		await a.client.collection('users').update(a.id, { inbox_targets: null });

		// An entry of a connection: the connection stays private, the entry loses the reference.
		const connection = await a.client.collection('connections').create({
			owner: a.id,
			type: 'mail',
			label: `Post ${uniqueSuffix()}`,
			enabled: true,
			secret_env: 'BYL_TEST_MAIL',
			settings: { provider: 'webde', user: 'post@web.de', keywords: ['todo'] }
		});
		const response = await fetch(`${instance.url}/api/byl/ingest/items`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				connection: connection.id,
				origin: 'auto',
				title: `Todo: Arzt ${uniqueSuffix()}`,
				body: 'Termin.',
				source_ref: `<${uniqueSuffix()}@example.com>`,
				source_date: '2032-01-05 08:00:00.000Z',
				source_meta: { from: 'Praxis <praxis@example.com>' }
			})
		});
		expect(response.status).toBe(200);
		const ingested = (await response.json()).item;
		const fromConnection = await a.send(MOVE, { kind: 'item', ids: [ingested], to: 'household', preview: true });
		expect(fromConnection.conflicts.items.connection).toBe(1);
		await a.send(MOVE, { kind: 'item', ids: [ingested], to: 'household' });
		expect(await superuser.collection('inbox_items').getOne(ingested)).toMatchObject({ scope: householdScope(), connection: '' });
		expect((await superuser.collection('connections').getOne(connection.id)).scope).toBe(privateScope(a));
	});

	it('refuses an entry that belongs to a ticket; it comes along with the ticket', async () => {
		const item = await a.client.collection('inbox_items').create({ owner: a.id, channel: 'manual', kind: 'todo', title: `Zettel ${uniqueSuffix()}` });
		const ticket = await a.ticket({ source_item: item.id });
		const refused = await rejection(a.send(MOVE, { kind: 'item', ids: [item.id], to: 'household' }));
		expect([refused.status, refused.problem]).toEqual([409, 'linked']);
		const moved = await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household' });
		expect(moved.counts.items).toBe(1);
		expect(await superuser.collection('inbox_items').getOne(item.id)).toMatchObject({ scope: householdScope(), ticket: ticket.id });
		expect((await ticketOf(ticket.id)).source_item).toBe(item.id);
	});
});

describe('rights for every record of the cascade (ADR-0061 §4)', () => {
	it('lets the creator move into the private area, others only with "move_out", the owner always', async () => {
		const ofA = await a.ticket({ household: householdId });
		const ofB = await b.ticket({ household: householdId });
		const refused = await rejection(b.send(MOVE, { kind: 'ticket', ids: [ofA.id], to: 'private' }));
		expect([refused.status, refused.problem, refused.params]).toEqual([403, 'right', { label: ofA.key }]);
		// Also the preview says no: the right holds for every record.
		expect((await rejection(b.send(MOVE, { kind: 'ticket', ids: [ofA.id], to: 'private', preview: true }))).status).toBe(403);

		// B's own ticket with a sub-task of A: the cascade needs the right as well.
		const sub = await a.ticket({ household: householdId, parent: ofB.id });
		expect((await rejection(b.send(MOVE, { kind: 'ticket', ids: [ofB.id], to: 'private' }))).params).toEqual({ label: sub.key });
		await a.client.collection('tickets').delete(sub.id);
		await b.send(MOVE, { kind: 'ticket', ids: [ofB.id], to: 'private' });
		expect(await ticketOf(ofB.id)).toMatchObject({ owner: b.id, scope: privateScope(b) });

		// With "move_out" B takes A's ticket into the private area of B, who becomes its owner.
		await a.send(`${ROUTE}/members/${(await memberOf(b)).id}/rights`, { rights: ['move_out'] });
		await b.send(MOVE, { kind: 'ticket', ids: [ofA.id], to: 'private' });
		expect(await ticketOf(ofA.id)).toMatchObject({ owner: b.id, household: '', scope: privateScope(b) });
		expect(await statusOf(a.client.collection('tickets').getOne(ofA.id))).toBe(404);
		await a.send(`${ROUTE}/members/${(await memberOf(b)).id}/rights`, { rights: [] });

		// The owner of the household has the right by the role.
		const another = await b.ticket({ household: householdId });
		await a.send(MOVE, { kind: 'ticket', ids: [another.id], to: 'private' });
		expect((await ticketOf(another.id)).owner).toBe(a.id);
	});

	it('refuses a record of someone else, and an account without a household', async () => {
		const own = await a.ticket();
		const foreign = await rejection(b.send(MOVE, { kind: 'ticket', ids: [own.id], to: 'household' }));
		expect([foreign.status, foreign.problem]).toEqual([404, 'missing']);
		const alone = await rejection(c.send(MOVE, { kind: 'ticket', ids: [own.id], to: 'household' }));
		expect([alone.status, alone.problem]).toEqual([404, 'no-household']);
	});
});

describe('one transaction', () => {
	it('changes nothing when a write in the middle of the cascade fails', async () => {
		const parent = await a.ticket();
		const ok = await a.ticket({ parent: parent.id });
		const failing = await a.ticket({ parent: parent.id, title: FAIL_AREA_MOVE });
		const before = await Promise.all([parent, ok, failing].map((ticket) => ticketOf(ticket.id)));
		const counter = await superuser
			.collection('ticket_counters')
			.getFullList({ filter: superuser.filter('key = {:k}', { k: `${householdScope()}:TASK` }) });
		expect(await statusOf(a.send(MOVE, { kind: 'ticket', ids: [parent.id], to: 'household' }))).toBe(400);
		const after = await Promise.all([parent, ok, failing].map((ticket) => ticketOf(ticket.id)));
		expect(after.map((ticket) => [ticket.scope, ticket.key])).toEqual(before.map((ticket) => [ticket.scope, ticket.key]));
		expect((await historyOf(parent.id)).some((item) => item.field === 'area_move')).toBe(false);
		const counterAfter = await superuser
			.collection('ticket_counters')
			.getFullList({ filter: superuser.filter('key = {:k}', { k: `${householdScope()}:TASK` }) });
		expect(counterAfter.map((row) => row.value)).toEqual(counter.map((row) => row.value));
	});
});

describe('realtime (ADR-0061 §3)', () => {
	it('removes a record from tabs that lose it, marked as moved, and shows it where it is now', async () => {
		const aPrivate = await watch(a, 'tickets', privateScope(a));
		const aHousehold = await watch(a, 'tickets', householdScope());
		const bHousehold = await watch(b, 'tickets', householdScope());
		const bPrivate = await watch(b, 'tickets', privateScope(b));

		const ticket = await a.ticket();
		await waitFor(aPrivate, 'create', ticket.id);
		await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household' });
		expect((await waitFor(aPrivate, 'delete', ticket.id)).record.moved).toBe(true);
		await waitFor(aHousehold, 'update', ticket.id);
		await waitFor(bHousehold, 'update', ticket.id);

		await a.send(`${ROUTE}/members/${(await memberOf(b)).id}/rights`, { rights: ['move_out'] });
		await b.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'private' });
		expect((await waitFor(aHousehold, 'delete', ticket.id)).record.moved).toBe(true);
		await waitFor(bHousehold, 'delete', ticket.id);
		await waitFor(bPrivate, 'update', ticket.id);
		await a.send(`${ROUTE}/members/${(await memberOf(b)).id}/rights`, { rights: [] });
	});
});

describe('data layer of the SPA (web/src/lib/data/area-move.ts, household.ts)', () => {
	it('reads the preview and the move of the real server strictly, and a refusal as its problem', async () => {
		const project = await a.project();
		const ticket = await a.ticket({ project: project.id });
		const preview = await moveRecords(a.client, { kind: 'ticket', ids: [ticket.id], to: 'household', preview: true });
		expect(preview.kind).toBe('ok');
		expect(preview.value).toMatchObject({ preview: true, kind: 'ticket', to: 'household', moved: null });
		expect(preview.value.conflicts.project.projects.map((entry) => entry.id)).toEqual([project.id]);
		const moved = await moveRecords(a.client, { kind: 'ticket', ids: [ticket.id], to: 'household', project: '' });
		expect(moved.kind).toBe('ok');
		expect(moved.value.moved.tickets[0]).toMatchObject({ id: ticket.id, previous: ticket.key });
		expect(await moveRecords(c.client, { kind: 'ticket', ids: [ticket.id], to: 'private' })).toEqual({
			kind: 'invalid',
			problem: 'no-household',
			params: {}
		});
	});

	it('reads the preview of dissolving and refuses a member', async () => {
		const answer = await dissolveHousehold(a.client, { mode: 'adopt', preview: true });
		expect(answer.kind).toBe('ok');
		expect(answer.value.household.id).toBe(householdId);
		expect(answer.value.members.find((member) => member.self)?.role).toBe('owner');
		expect(await dissolveHousehold(b.client, { mode: 'adopt', preview: true })).toEqual({
			kind: 'invalid',
			problem: 'owner-only'
		});
	});
});

describe('dissolving a household (ADR-0061 §5)', () => {
	/** A household of `owner` with `member`, filled with records of both. */
	async function filledHousehold(owner, member) {
		const id = (await owner.send(ROUTE, { name: `Wohnung ${uniqueSuffix()}` })).household.id;
		const { code } = await owner.send(`${ROUTE}/invites`, {});
		await member.send(`${ROUTE}/join`, { code });
		const projectCode = uniqueCode().slice(0, 4);
		await owner.project({ code: projectCode });
		const project = await member.project({ household: id, code: projectCode });
		const tag = await member.tag({ household: id, name: `putzen-${uniqueSuffix()}` });
		const ticket = await member.ticket({ household: id, project: project.id, tags: [tag.id] });
		const sub = await owner.ticket({ household: id, project: project.id, parent: ticket.id });
		const trashed = await member.ticket({ household: id, project: project.id, status: 'done' });
		await member.client.collection('tickets').delete(trashed.id);
		const item = await member.client
			.collection('inbox_items')
			.create({ owner: member.id, household: id, channel: 'manual', kind: 'todo', title: `Zettel ${uniqueSuffix()}` });
		const rule = await member.client.collection('recurrence_rules').create({
			owner: member.id,
			household: id,
			title: `Fenster ${uniqueSuffix()}`,
			mode: 'calendar',
			freq: 'monthly',
			month_day: 1,
			initial_status: 'open',
			project: project.id
		});
		return { id, projectCode, project, tag, ticket, sub, trashed, item, rule };
	}

	it('previews and takes everything into the private area of the owner, then the household is gone', async () => {
		const owner = await createAccount('Dora Beispiel');
		const member = await createAccount('Emil Beispiel');
		const home = await filledHousehold(owner, member);
		const events = [];
		stops.push(await member.client.realtime.subscribe('byl/household', (data) => events.push(data)));

		expect((await rejection(member.send(`${ROUTE}/dissolve`, { mode: 'adopt', preview: true }))).problem).toBe('owner-only');
		expect((await rejection(owner.send(`${ROUTE}/dissolve`, { mode: 'beides' }))).problem).toBe('mode');
		const preview = await owner.send(`${ROUTE}/dissolve`, { mode: 'adopt', preview: true });
		expect(preview.counts).toMatchObject({ tickets: 2, trash: 1, projects: 1, rules: 1, items: 1, tags: 1 });
		expect(preview.members.map((entry) => [entry.name, entry.role, entry.self])).toEqual([
			['Dora Beispiel', 'owner', true],
			['Emil Beispiel', 'member', false]
		]);
		expect(preview.codes).toEqual([{ id: home.project.id, code: home.projectCode, name: home.project.name, suggestion: `${home.projectCode}H` }]);

		await owner.send(`${ROUTE}/dissolve`, { mode: 'adopt' });
		const mine = privateScope(owner);
		expect(await superuser.collection('projects').getOne(home.project.id)).toMatchObject({ scope: mine, code: `${home.projectCode}H` });
		const ticket = await ticketOf(home.ticket.id);
		expect(ticket).toMatchObject({ scope: mine, owner: owner.id, household: '' });
		expect(ticket.key).toMatch(new RegExp(`^${home.projectCode}H-\\d+$`));
		expect((await ticketOf(home.sub.id)).parent).toBe(home.ticket.id);
		const entry = (await historyOf(home.ticket.id)).find((item) => item.field === 'area_move');
		expect(JSON.parse(entry.new_value)).toMatchObject({ to: 'private', dissolved: true });
		expect(await superuser.collection('inbox_items').getOne(home.item.id)).toMatchObject({ scope: mine, owner: owner.id });
		expect(await superuser.collection('recurrence_rules').getOne(home.rule.id)).toMatchObject({ scope: mine, project: home.project.id });
		// The tag of the household became a private one of the same name, the household tag is gone.
		expect(await statusOf(superuser.collection('tags').getOne(home.tag.id))).toBe(404);
		const [privateTag] = await superuser
			.collection('tags')
			.getFullList({ filter: superuser.filter('scope = {:s} && name = {:n}', { s: mine, n: home.tag.name }) });
		expect(ticket.tags).toEqual([privateTag.id]);
		// The trash came along and restores with its key in the renamed project.
		const trashed = await ticketOf(home.trashed.id);
		expect(trashed.scope).toBe(mine);
		const restored = await owner.send(`/api/byl/trash/${home.trashed.id}/restore`, {});
		expect(restored.key).toBe(trashed.key);
		expect((await ticketOf(home.trashed.id)).project).toBe(home.project.id);
		// The household, its memberships and counters are gone; the member is told.
		expect(await statusOf(superuser.collection('households').getOne(home.id))).toBe(404);
		expect((await member.send(ROUTE, undefined, 'GET')).household).toBeNull();
		expect(await statusOf(member.client.collection('tickets').getOne(home.ticket.id))).toBe(404);
		const counters = await superuser
			.collection('ticket_counters')
			.getFullList({ filter: superuser.filter('key ~ {:k}', { k: `h:${home.id}:` }) });
		expect(counters).toEqual([]);
		const deadline = Date.now() + EVENT_TIMEOUT_MS;
		while (!events.some((data) => data?.dissolved === true) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		expect(events.some((data) => data?.dissolved === true)).toBe(true);
	});

	it('deletes everything for good only with the name of the household typed', async () => {
		const owner = await createAccount('Fritz Beispiel');
		const member = await createAccount('Gina Beispiel');
		const home = await filledHousehold(owner, member);
		const household = await superuser.collection('households').getOne(home.id);
		const wrong = await rejection(owner.send(`${ROUTE}/dissolve`, { mode: 'delete', name: `${household.name}x` }));
		expect([wrong.status, wrong.problem]).toEqual([400, 'dissolve-name']);
		expect((await ticketOf(home.ticket.id)).scope).toBe(`h:${home.id}`);

		await owner.send(`${ROUTE}/dissolve`, { mode: 'delete', name: `  ${household.name} ` });
		for (const [collection, id] of [
			['tickets', home.ticket.id],
			['tickets', home.sub.id],
			['tickets', home.trashed.id],
			['projects', home.project.id],
			['tags', home.tag.id],
			['inbox_items', home.item.id],
			['recurrence_rules', home.rule.id],
			['households', home.id]
		]) {
			expect(await statusOf(superuser.collection(collection).getOne(id)), `${collection} ${id}`).toBe(404);
		}
		expect((await owner.send(ROUTE, undefined, 'GET')).household).toBeNull();
		expect((await member.send(ROUTE, undefined, 'GET')).household).toBeNull();
		// The private project of the same code stays untouched.
		const own = await owner.client.collection('projects').getFullList();
		expect(own.map((project) => project.code)).toContain(home.projectCode);
	});
});
