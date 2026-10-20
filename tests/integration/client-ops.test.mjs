// The outbox at the server (OF-1, ADR-0074) against an own disposable PocketBase, with the scenario
// of the areas (tests/support/scenario.mjs): A and B share a household, C is alone. How PocketBase
// 0.40.4 takes IDs of the client when creating, also twice; the identifier of an action (`op_id`) for
// every action of the first stage: the same action a second time, also at the same time, changes
// nothing and answers like the first time; an identifier belongs to one account; rights are those of
// the moment of the second request; a failed write notes nothing; without an identifier everything is
// as before; the capability of GET /api/byl/tickets/create; the cleanup after 30 days.

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FAIL_TICKET_INSERT, counterValue, createAreaScenario, historyOf, scopeOf, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';

const POLL_TIMEOUT_MS = scaled(5_000);
const DAY_MS = 24 * 60 * 60 * 1000;
const PARALLEL = 5;

let instance;
let superuser;
let a;
let b;
let c;
let householdId;

/** A new identifier of an action, as the SPA draws one (20 characters a-z0-9). */
const opId = () => randomBytes(10).toString('hex');
/** A new ID of a record in the form of PocketBase (15 characters a-z0-9). */
const recordId = () => randomBytes(8).toString('hex').slice(0, 15);

/** Status, codes and params per field, and the message of a refused call. */
async function refusal(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		const data = error.response?.data ?? {};
		return {
			status: error.status,
			data,
			codes: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.code])),
			message: error.response?.message
		};
	}
	throw new Error('Expected the request to be refused, but it succeeded.');
}

/** The notes of an account, read by the superuser. */
const notesOf = (person) =>
	superuser.collection('client_ops').getFullList({ filter: superuser.filter('user = {:user}', { user: person.id }), sort: 'created,id' });

const noteOf = async (person, op) =>
	(await superuser.collection('client_ops').getFullList({ filter: superuser.filter('user = {:user} && op = {:op}', { user: person.id, op }) }))[0];

const ticketsTitled = (title) =>
	superuser.collection('tickets').getFullList({ filter: superuser.filter('title = {:title}', { title }) });

const counterOf = (person) => counterValue(superuser, `${scopeOf(person.id, '')}:TASK`);

/** Waits until `check` returns something truthy. */
async function eventually(check, label) {
	const deadline = Date.now() + POLL_TIMEOUT_MS;
	for (;;) {
		const result = await check();
		if (result) return result;
		if (Date.now() > deadline) throw new Error(`${label} within ${POLL_TIMEOUT_MS} ms`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

beforeAll(async () => {
	instance = await startPocketBase();
	({ superuser, a, b, c, householdId } = await createAreaScenario(instance));
});

afterAll(async () => {
	await instance?.stop();
});

describe('IDs of the client in PocketBase 0.40.4', () => {
	it('creates a ticket, a comment and an entry of the inbox under an ID of the client', async () => {
		const id = recordId();
		const ticket = await a.ticket({ id, title: 'Mit eigener ID' });
		expect(ticket.id).toBe(id);
		const commentId = recordId();
		const comment = await a.client.collection('comments').create({ id: commentId, ticket: id, author: a.id, body: 'Eigene ID' });
		expect(comment.id).toBe(commentId);
		const itemId = recordId();
		const item = await a.client.collection('inbox_items').create({ id: itemId, owner: a.id, channel: 'quick', kind: 'todo', title: 'Eigene ID' });
		expect(item.id).toBe(itemId);
	});

	it('refuses an ID of the wrong form at the field', async () => {
		expect((await refusal(a.ticket({ id: 'abcdefghijklmn' }))).codes).toEqual({ id: 'validation_min_text_constraint' });
		expect((await refusal(a.ticket({ id: 'ABCDEFGHIJKLMNO' }))).codes).toEqual({ id: 'validation_invalid_format' });
	});

	it('refuses an ID that exists at the field (validation_not_unique), without using a number', async () => {
		const id = recordId();
		const first = await a.ticket({ id, title: 'Erstes Mal' });
		const counter = await counterOf(a);
		const twice = await refusal(a.ticket({ id, title: 'Zweites Mal' }));
		expect([twice.status, twice.codes]).toEqual([400, { id: 'validation_not_unique' }]);
		expect(await counterOf(a)).toBe(counter);
		expect((await superuser.collection('tickets').getOne(id)).title).toBe(first.title);
		// Another account gets the same answer: the ID says nothing about whose record it is.
		const foreign = await refusal(c.ticket({ id, title: 'Fremd' }));
		expect([foreign.status, foreign.codes, foreign.message]).toEqual([400, { id: 'validation_not_unique' }, twice.message]);
		const comment = await a.client.collection('comments').create({ id: recordId(), ticket: id, author: a.id, body: 'Erster' });
		const again = await refusal(a.client.collection('comments').create({ id: comment.id, ticket: id, author: a.id, body: 'Zweiter' }));
		expect([again.status, again.codes]).toEqual([400, { id: 'validation_not_unique' }]);
		const item = await a.client.collection('inbox_items').create({ id: recordId(), owner: a.id, channel: 'quick', kind: 'todo', title: 'Erster' });
		const sameItem = await refusal(a.client.collection('inbox_items').create({ id: item.id, owner: a.id, channel: 'quick', kind: 'todo', title: 'Zweiter' }));
		expect([sameItem.status, sameItem.codes]).toEqual([400, { id: 'validation_not_unique' }]);
	});
});

describe('the same action a second time', () => {
	it('creates a ticket once under its ID and answers the same ticket again', async () => {
		const op = opId();
		const id = recordId();
		const title = `Einmal ${uniqueSuffix()}`;
		const counter = await counterOf(a);
		const first = await a.ticket({ id, title, op_id: op });
		const second = await a.ticket({ id, title, op_id: op });
		expect(second).toEqual(first);
		expect(await ticketsTitled(title)).toHaveLength(1);
		expect(await counterOf(a)).toBe(counter + 1);
		expect((await historyOf(superuser, id)).map((entry) => entry.field)).toEqual(['created']);
		expect(await noteOf(a, op)).toMatchObject({ user: a.id, op, kind: 'ticket.create', record: id });
	});

	it('creates a ticket without an ID of the client once as well', async () => {
		const op = opId();
		const title = `Ohne ID ${uniqueSuffix()}`;
		const first = await a.ticket({ title, op_id: op });
		const second = await a.ticket({ title, op_id: op });
		expect(second.id).toBe(first.id);
		expect(second.key).toBe(first.key);
		expect(await ticketsTitled(title)).toHaveLength(1);
	});

	it('answers with expand and fields of the request, like the first time', async () => {
		const project = await a.client.collection('projects').create({ owner: a.id, name: 'Haus', code: 'OFH' });
		const op = opId();
		const options = { expand: 'project', fields: 'id,key,title,expand.project.code' };
		const body = { owner: a.id, title: `Mit Projekt ${uniqueSuffix()}`, project: project.id, op_id: op };
		const first = await a.client.collection('tickets').create(body, options);
		const second = await a.client.collection('tickets').create(body, options);
		expect(first).toMatchObject({ key: 'OFH-1', expand: { project: { code: 'OFH' } } });
		expect(Object.keys(first).sort()).toEqual(['expand', 'id', 'key', 'title']);
		expect(second).toEqual(first);
	});

	it('changes a ticket once and answers its current state again', async () => {
		const ticket = await a.ticket();
		const op = opId();
		const first = await a.client.collection('tickets').update(ticket.id, { status: 'done', op_id: op });
		expect(first.status).toBe('done');
		await a.client.collection('tickets').update(ticket.id, { title: 'Später umbenannt' });
		const second = await a.client.collection('tickets').update(ticket.id, { status: 'done', op_id: op });
		expect(second).toMatchObject({ id: ticket.id, status: 'done', title: 'Später umbenannt', completed_at: first.completed_at });
		const entries = await historyOf(superuser, ticket.id);
		expect(entries.filter((entry) => entry.field === 'status')).toHaveLength(1);
		// A second request that would reopen it under the same identifier changes nothing either.
		const reopen = await a.client.collection('tickets').update(ticket.id, { status: 'open', op_id: op });
		expect(reopen.status).toBe('done');
		expect(await noteOf(a, op)).toMatchObject({ kind: 'ticket.update', record: ticket.id });
	});

	it('writes a comment and an entry of the inbox once', async () => {
		const ticket = await a.ticket();
		const op = opId();
		const body = { ticket: ticket.id, author: a.id, body: 'Nur einmal', op_id: op };
		const first = await a.client.collection('comments').create(body);
		const second = await a.client.collection('comments').create(body);
		expect(second).toEqual(first);
		expect(await superuser.collection('comments').getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticket.id }) })).toHaveLength(1);

		const itemOp = opId();
		const title = `Eingang ${uniqueSuffix()}`;
		const item = { owner: a.id, channel: 'quick', kind: 'todo', title, op_id: itemOp };
		const firstItem = await a.client.collection('inbox_items').create(item);
		const secondItem = await a.client.collection('inbox_items').create(item);
		expect(secondItem).toEqual(firstItem);
		expect(await superuser.collection('inbox_items').getFullList({ filter: superuser.filter('title = {:title}', { title }) })).toHaveLength(1);
		expect(await noteOf(a, itemOp)).toMatchObject({ kind: 'inbox.create', record: firstItem.id });
	});

	it('checks and unchecks an entry of the day plan once and answers the same', async () => {
		const ticket = await a.ticket();
		const { item } = await a.send('/api/byl/dayplan/items', { ticket: ticket.id });
		const op = opId();
		const first = await a.send(`/api/byl/dayplan/items/${item.id}/check`, { mode: 'check', op_id: op });
		const second = await a.send(`/api/byl/dayplan/items/${item.id}/check`, { mode: 'check', op_id: op });
		expect(first).toMatchObject({ action: 'complete', ticket: { status: 'done', previous_status: 'open' } });
		expect(second).toEqual(first);
		const undo = opId();
		const opened = await a.send(`/api/byl/dayplan/items/${item.id}/uncheck`, { op_id: undo });
		const again = await a.send(`/api/byl/dayplan/items/${item.id}/uncheck`, { op_id: undo });
		expect(opened).toMatchObject({ ticket: { status: 'open', previous_status: 'done' } });
		expect(again).toEqual(opened);
		const statuses = (await historyOf(superuser, ticket.id)).filter((entry) => entry.field === 'status');
		expect(statuses.map((entry) => entry.new_value)).toEqual(['done', 'open']);
		expect(await noteOf(a, op)).toMatchObject({ kind: 'dayplan.check', record: item.id, result: { action: 'complete', previous_status: 'open' } });
		expect(await noteOf(a, undo)).toMatchObject({ kind: 'dayplan.uncheck', record: item.id, result: { previous_status: 'done' } });
	});

	it('writes once when the same request arrives several times at once', async () => {
		const many = (send) => Promise.all(Array.from({ length: PARALLEL }, send));
		const op = opId();
		const id = recordId();
		const title = `Gleichzeitig ${uniqueSuffix()}`;
		const counter = await counterOf(a);
		const created = await many(() => a.ticket({ id, title, op_id: op }));
		expect(new Set(created.map((ticket) => ticket.key)).size).toBe(1);
		expect(await ticketsTitled(title)).toHaveLength(1);
		expect(await counterOf(a)).toBe(counter + 1);

		const changeOp = opId();
		const changed = await many(() => a.client.collection('tickets').update(id, { priority: 'urgent', op_id: changeOp }));
		expect(changed.every((ticket) => ticket.priority === 'urgent')).toBe(true);
		expect((await historyOf(superuser, id)).filter((entry) => entry.field === 'priority')).toHaveLength(1);

		const commentOp = opId();
		const comments = await many(() => a.client.collection('comments').create({ ticket: id, author: a.id, body: 'Gleichzeitig', op_id: commentOp }));
		expect(new Set(comments.map((comment) => comment.id)).size).toBe(1);
		expect(await superuser.collection('comments').getFullList({ filter: superuser.filter('ticket = {:id}', { id }) })).toHaveLength(1);

		const itemOp = opId();
		const itemTitle = `Gleichzeitig ${uniqueSuffix()}`;
		const items = await many(() => a.client.collection('inbox_items').create({ owner: a.id, channel: 'quick', kind: 'todo', title: itemTitle, op_id: itemOp }));
		expect(new Set(items.map((item) => item.id)).size).toBe(1);

		const { item } = await a.send('/api/byl/dayplan/items', { ticket: id });
		const checkOp = opId();
		const checks = await many(() => a.send(`/api/byl/dayplan/items/${item.id}/check`, { mode: 'check', op_id: checkOp }));
		expect(checks.every((answer) => answer.ticket.status === 'done' && answer.ticket.previous_status === 'open')).toBe(true);
		expect((await historyOf(superuser, id)).filter((entry) => entry.field === 'status')).toHaveLength(1);

		expect((await notesOf(a)).filter((note) => [op, changeOp, commentOp, itemOp, checkOp].includes(note.op))).toHaveLength(5);
	});

	it('refuses an identifier the account used for another action', async () => {
		const ticket = await a.ticket();
		const other = await a.ticket();
		const op = opId();
		await a.client.collection('tickets').update(ticket.id, { status: 'waiting', op_id: op });
		const elsewhere = await refusal(a.client.collection('tickets').update(other.id, { status: 'waiting', op_id: op }));
		expect(elsewhere).toMatchObject({ status: 400, codes: { op_id: 'validation_op_reused' } });
		expect((await superuser.collection('tickets').getOne(other.id)).status).toBe('open');
		const asComment = await refusal(a.client.collection('comments').create({ ticket: ticket.id, author: a.id, body: 'x', op_id: op }));
		expect(asComment.codes).toEqual({ op_id: 'validation_op_reused' });
		const { item } = await a.send('/api/byl/dayplan/items', { ticket: other.id });
		const asCheck = await refusal(a.send(`/api/byl/dayplan/items/${item.id}/check`, { mode: 'check', op_id: op }));
		expect(asCheck.codes).toEqual({ op_id: 'validation_op_reused' });
	});

	it('refuses an identifier of the wrong form, before anything is written', async () => {
		const title = `Falsche Kennung ${uniqueSuffix()}`;
		const wrong = await refusal(a.ticket({ title, op_id: 'zu-kurz' }));
		expect(wrong).toMatchObject({ status: 400, codes: { op_id: 'validation_op_invalid' } });
		expect(await ticketsTitled(title)).toHaveLength(0);
		const ticket = await a.ticket();
		const { item } = await a.send('/api/byl/dayplan/items', { ticket: ticket.id });
		expect((await refusal(a.send(`/api/byl/dayplan/items/${item.id}/check`, { mode: 'check', op_id: 42 }))).codes).toEqual({
			op_id: 'validation_op_invalid'
		});
	});

	it('notes nothing when the write fails, so the same identifier works afterwards', async () => {
		const op = opId();
		const failed = await refusal(a.ticket({ title: FAIL_TICKET_INSERT, op_id: op }));
		expect(failed.status).toBe(400);
		expect(await noteOf(a, op)).toBeUndefined();
		const title = `Danach ${uniqueSuffix()}`;
		const created = await a.ticket({ title, op_id: op });
		expect(created.title).toBe(title);
		expect(await noteOf(a, op)).toMatchObject({ record: created.id });
	});

	it('names only the ID when the record of the first time is no longer visible', async () => {
		const op = opId();
		const body = { owner: a.id, title: `Gelöscht ${uniqueSuffix()}`, op_id: op };
		const ticket = await a.client.collection('tickets').create(body);
		await a.client.collection('tickets').delete(ticket.id);
		const gone = await refusal(a.client.collection('tickets').create(body));
		expect(gone).toMatchObject({ status: 400, codes: { op_id: 'validation_op_applied' } });
		expect(gone.data.op_id.params).toEqual({ record: ticket.id, kind: 'ticket.create' });
		expect(await ticketsTitled(body.title)).toHaveLength(1);
	});
});

describe('an identifier belongs to one account', () => {
	it('lets another account use the same identifier for its own action, without noticing the first', async () => {
		const op = opId();
		const mine = await a.ticket();
		const theirs = await b.ticket();
		await a.client.collection('tickets').update(mine.id, { status: 'waiting', op_id: op });
		const answered = await b.client.collection('tickets').update(theirs.id, { status: 'in_progress', op_id: op });
		expect(answered).toMatchObject({ id: theirs.id, status: 'in_progress' });
		expect((await superuser.collection('tickets').getOne(mine.id)).status).toBe('waiting');
		expect(await noteOf(a, op)).toMatchObject({ record: mine.id });
		expect(await noteOf(b, op)).toMatchObject({ record: theirs.id });
	});

	it('keeps the notes away from every account', async () => {
		for (const person of [a, b, c]) {
			expect((await refusal(person.client.collection('client_ops').getList(1, 1))).status).toBe(403);
			expect((await refusal(person.client.collection('client_ops').create({ user: person.id, op: opId(), kind: 'ticket.update', record: 'x' }))).status).toBe(403);
		}
	});
});

describe('rights at the moment of the second request', () => {
	it('lets nobody reach a ticket of a household after the membership ended, also not under an identifier of before', async () => {
		const other = await createAreaScenario(instance);
		const ticket = await other.a.ticket({ household: other.householdId });
		const op = opId();
		await other.b.client.collection('tickets').update(ticket.id, { status: 'waiting', op_id: op });
		await other.b.send('/api/byl/household/leave', {});
		const again = await refusal(other.b.client.collection('tickets').update(ticket.id, { status: 'waiting', op_id: op }));
		expect(again.status).toBe(404);
		const fresh = await refusal(other.b.client.collection('tickets').update(ticket.id, { status: 'done', op_id: opId() }));
		expect(fresh.status).toBe(404);
		const create = await refusal(other.b.ticket({ household: other.householdId, op_id: opId() }));
		expect(create.status).toBe(400);
		const comment = await refusal(other.b.client.collection('comments').create({ ticket: ticket.id, author: other.b.id, body: 'x', op_id: opId() }));
		expect(comment.status).toBe(400);
		expect((await superuser.collection('tickets').getOne(ticket.id)).status).toBe('waiting');
	});
});

describe('without an identifier', () => {
	it('creates, changes and comments as before and notes nothing', async () => {
		const notes = (await notesOf(c)).length;
		const title = `Wie bisher ${uniqueSuffix()}`;
		await c.ticket({ title });
		const second = await c.ticket({ title });
		expect(await ticketsTitled(title)).toHaveLength(2);
		const changed = await c.client.collection('tickets').update(second.id, { status: 'done' });
		expect(changed.status).toBe('done');
		const comment = await c.client.collection('comments').create({ ticket: second.id, author: c.id, body: 'Wie bisher' });
		expect(comment).toMatchObject({ offline: false, device_at: '' });
		const stale = await refusal(c.client.collection('tickets').update(second.id, { description: 'Neu', expected_updated: second.updated }));
		expect(stale.codes).toEqual({ description: 'validation_description_stale' });
		expect((await notesOf(c)).length).toBe(notes);
	});
});

describe('what the server knows', () => {
	it('names the version and the actions of the outbox', async () => {
		const support = await a.send('/api/byl/tickets/create', undefined, 'GET');
		expect(support.offline_ops).toEqual({
			version: 1,
			kinds: ['ticket.create', 'ticket.update', 'comment.create', 'inbox.create', 'dayplan.check', 'dayplan.uncheck']
		});
	});
});

describe('the cleanup of the notes', () => {
	it('removes notes older than 30 days and keeps the younger ones', async () => {
		const old = opId();
		const young = opId();
		const at = (ms) => new Date(Date.now() - ms).toISOString().replace('T', ' ');
		await superuser.send('/api/byl-test/client-ops', { method: 'POST', body: { user: c.id, op: old, created: at(31 * DAY_MS) } });
		await superuser.send('/api/byl-test/client-ops', { method: 'POST', body: { user: c.id, op: young, created: at(29 * DAY_MS) } });
		await superuser.crons.run('byl-client-ops-cleanup');
		// The cron route of PocketBase answers before the job has run.
		await eventually(async () => (await noteOf(c, old)) === undefined, 'The old note did not go');
		expect(await noteOf(c, young)).toMatchObject({ op: young });
	});
});
