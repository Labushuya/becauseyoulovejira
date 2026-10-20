// Actions from the outbox at the server (OF-1, ADR-0074) against an own disposable PocketBase, with the
// scenario of the areas (tests/support/scenario.mjs): A and B share a household, C is alone. The time
// of the device is kept only between 48 hours back and 5 minutes ahead and marks the history, comments
// and entries of the inbox (`created` stays the time of the server, a client never writes the marks
// itself); a conditional change conflicts only at a field someone else changed to another value; the
// day plan checks the same, answers a check mark of before also after midnight and still refuses a new
// one on a day before; a comment on a ticket created from the outbox. The days of the plan come from the
// test clock of tests/fixtures/pb_hooks/day-plan-clock.pb.js; the bounds of the time of the device have
// margins of minutes, far from the few milliseconds between the clocks of Node and of the server.

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { createAreaScenario, historyOf } from '../support/scenario.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let instance;
let superuser;
let a;
let b;
let householdId;

const opId = () => randomBytes(10).toString('hex');
const recordId = () => randomBytes(8).toString('hex').slice(0, 15);
/** A time of the device `ms` from now, as the SPA sends it, and the form the server keeps. */
const deviceTime = (ms) => new Date(Date.now() + ms).toISOString();
const kept = (iso) => iso.replace('T', ' ');

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

const entriesOf = async (ticketId, field) => (await historyOf(superuser, ticketId)).filter((entry) => entry.field === field);
const noteOf = async (person, op) =>
	(await superuser.collection('client_ops').getFullList({ filter: superuser.filter('user = {:user} && op = {:op}', { user: person.id, op }) }))[0];

/** The test clock of the day plan at `iso` (UTC); null goes back to the time of the machine. */
async function useClock(iso) {
	await superuser.send('/api/byl-test/dayplan/clock', { method: 'POST', body: { now: iso === null ? null : Date.parse(iso) } });
}

beforeAll(async () => {
	instance = await startPocketBase();
	({ superuser, a, b, householdId } = await createAreaScenario(instance));
});

afterAll(async () => {
	await useClock(null).catch(() => undefined);
	await instance?.stop();
});

describe('the time of the device in the history', () => {
	it('marks every entry of an action from the outbox and keeps a time from the last 48 hours', async () => {
		const ticket = await a.ticket();
		const at = deviceTime(-HOUR);
		const done = await a.client.collection('tickets').update(ticket.id, { status: 'done', op_id: opId(), offline: true, client_at: at });
		const [entry] = await entriesOf(ticket.id, 'status');
		expect(entry).toMatchObject({ offline: true, device_at: kept(at), user: a.id, new_value: 'done' });
		// The time of the server stays the one that counts: the entry and completed_at are of the sync.
		expect(entry.created > entry.device_at).toBe(true);
		expect(done.completed_at > entry.device_at).toBe(true);
	});

	it('drops a time more than 5 minutes ahead or more than 48 hours back, and the action still counts as offline', async () => {
		for (const [ms, expected] of [
			[4 * MINUTE, true],
			[10 * MINUTE, false],
			[-47 * HOUR, true],
			[-49 * HOUR, false]
		]) {
			const ticket = await a.ticket();
			const at = deviceTime(ms);
			await a.client.collection('tickets').update(ticket.id, { priority: 'high', op_id: opId(), client_at: at });
			const [entry] = await entriesOf(ticket.id, 'priority');
			expect(entry, String(ms)).toMatchObject({ offline: true, device_at: expected ? kept(at) : '' });
		}
	});

	it('marks "Trotzdem übertragen" without a time, an unreadable time and nothing without the fields', async () => {
		const ticket = await a.ticket();
		await a.client.collection('tickets').update(ticket.id, { status: 'waiting', op_id: opId(), offline: true });
		await a.client.collection('tickets').update(ticket.id, { priority: 'low', op_id: opId(), client_at: 'gestern' });
		await a.client.collection('tickets').update(ticket.id, { title: 'Online geändert' });
		expect((await entriesOf(ticket.id, 'status'))[0]).toMatchObject({ offline: true, device_at: '' });
		expect((await entriesOf(ticket.id, 'priority'))[0]).toMatchObject({ offline: true, device_at: '' });
		expect((await entriesOf(ticket.id, 'title'))[0]).toMatchObject({ offline: false, device_at: '' });
	});

	it('marks the creation of a ticket and the sub-tasks completed along', async () => {
		const at = deviceTime(-2 * HOUR);
		const parent = await a.ticket({ op_id: opId(), offline: true, client_at: at });
		expect((await entriesOf(parent.id, 'created'))[0]).toMatchObject({ offline: true, device_at: kept(at) });
		const child = await a.ticket({ parent: parent.id });
		await a.client.collection('tickets').update(parent.id, { status: 'done', complete_children: true, op_id: opId(), client_at: at });
		expect((await entriesOf(child.id, 'status'))[0]).toMatchObject({ offline: true, device_at: kept(at), new_value: 'done', user: a.id });
		expect((await entriesOf(child.id, 'created'))[0]).toMatchObject({ offline: false, device_at: '' });
	});

	it('marks the history of a check mark of the day plan', async () => {
		const ticket = await a.ticket();
		const { item } = await a.send('/api/byl/dayplan/items', { ticket: ticket.id });
		const at = deviceTime(-30 * MINUTE);
		await a.send(`/api/byl/dayplan/items/${item.id}/check`, { mode: 'check', op_id: opId(), client_at: at });
		expect((await entriesOf(ticket.id, 'status'))[0]).toMatchObject({ offline: true, device_at: kept(at), new_value: 'done' });
		await a.send(`/api/byl/dayplan/items/${item.id}/uncheck`, { op_id: opId(), offline: true });
		expect((await entriesOf(ticket.id, 'status'))[1]).toMatchObject({ offline: true, device_at: '', new_value: 'open' });
	});
});

describe('the time of the device at comments and entries of the inbox', () => {
	it('marks a comment from the outbox and lets no client write the marks itself', async () => {
		const ticket = await a.ticket();
		const at = deviceTime(-HOUR);
		const offline = await a.client.collection('comments').create({ ticket: ticket.id, author: a.id, body: 'Offline', op_id: opId(), client_at: at });
		expect(offline).toMatchObject({ offline: true, device_at: kept(at) });
		const forged = await a.client.collection('comments').create({ ticket: ticket.id, author: a.id, body: 'Gefälscht', offline: false, device_at: '2026-01-01 08:00:00.000Z' });
		expect(forged).toMatchObject({ offline: false, device_at: '' });
		const outOfBounds = await a.client.collection('comments').create({
			ticket: ticket.id,
			author: a.id,
			body: 'Zu alt',
			offline: true,
			device_at: '2026-01-01 08:00:00.000Z',
			client_at: deviceTime(-72 * HOUR)
		});
		expect(outOfBounds).toMatchObject({ offline: true, device_at: '' });
		const edited = await a.client.collection('comments').update(offline.id, { body: 'Bearbeitet', offline: false, device_at: '' });
		expect(edited).toMatchObject({ body: 'Bearbeitet', offline: true, device_at: kept(at) });
		const marked = await a.client.collection('comments').update(forged.id, { body: 'Bearbeitet', offline: true, device_at: kept(at) });
		expect(marked).toMatchObject({ offline: false, device_at: '' });
	});

	it('marks an entry of the inbox in source_meta and replaces a mark of the body', async () => {
		const at = deviceTime(-HOUR);
		const offline = await a.client.collection('inbox_items').create({
			owner: a.id,
			channel: 'quick',
			kind: 'todo',
			title: 'Offline erfasst',
			source_meta: { prefill: { priority: 'high' }, offline: { device_at: '2020-01-01 00:00:00.000Z' } },
			op_id: opId(),
			client_at: at
		});
		expect(offline.source_meta).toEqual({ prefill: { priority: 'high' }, offline: { device_at: kept(at) } });
		const online = await a.client.collection('inbox_items').create({
			owner: a.id,
			channel: 'quick',
			kind: 'todo',
			title: 'Online erfasst',
			source_meta: { prefill: { priority: 'low' }, offline: { device_at: '2020-01-01 00:00:00.000Z' } }
		});
		expect(online.source_meta).toEqual({ prefill: { priority: 'low' } });
		const plain = await a.client.collection('inbox_items').create({ owner: a.id, channel: 'quick', kind: 'todo', title: 'Ohne Meta' });
		expect(plain.source_meta).toBeNull();
	});
});

describe('a conditional change per field', () => {
	it('changes when someone else changed another field meanwhile', async () => {
		const ticket = await a.ticket({ household: householdId });
		await b.client.collection('tickets').update(ticket.id, { title: 'Von Bert umbenannt', priority: 'urgent' });
		const done = await a.client.collection('tickets').update(ticket.id, { status: 'done', expected: { status: 'open' }, op_id: opId() });
		expect(done).toMatchObject({ status: 'done', title: 'Von Bert umbenannt', priority: 'urgent' });
	});

	it('refuses at the field someone else changed to another value, and writes and notes nothing', async () => {
		const ticket = await a.ticket({ household: householdId, due: '2026-10-20 00:00:00.000Z' });
		const changed = await b.client.collection('tickets').update(ticket.id, { status: 'waiting' });
		const op = opId();
		const conflict = await refusal(
			a.client.collection('tickets').update(ticket.id, {
				status: 'done',
				due: '2026-10-22 00:00:00.000Z',
				expected: { status: 'open', due: '2026-10-20 00:00:00.000Z' },
				op_id: op
			})
		);
		expect(conflict).toMatchObject({ status: 400, codes: { status: 'validation_ticket_conflict' }, message: 'Das Ticket wurde inzwischen geändert.' });
		expect(conflict.data.status).toEqual({
			code: 'validation_ticket_conflict',
			message: 'Der Status wurde inzwischen geändert.',
			params: { expected: 'open', actual: 'waiting', updated: changed.updated }
		});
		const stored = await superuser.collection('tickets').getOne(ticket.id);
		expect(stored).toMatchObject({ status: 'waiting', due: '2026-10-20 00:00:00.000Z' });
		expect(await entriesOf(ticket.id, 'due')).toEqual([]);
		expect(await noteOf(a, op)).toBeUndefined();
		// "Meine Änderung übernehmen": the same identifier again with the new state as expectation.
		const taken = await a.client.collection('tickets').update(ticket.id, { status: 'done', expected: { status: 'waiting' }, op_id: op });
		expect(taken.status).toBe('done');
	});

	it('names every field in conflict and only those', async () => {
		const ticket = await a.ticket({ household: householdId, priority: 'low' });
		await b.client.collection('tickets').update(ticket.id, { priority: 'high', due: '2026-11-01 00:00:00.000Z' });
		const conflict = await refusal(
			a.client.collection('tickets').update(ticket.id, {
				priority: 'medium',
				due: '2026-11-02 00:00:00.000Z',
				status: 'in_progress',
				expected: { priority: 'low', due: '', status: 'open' }
			})
		);
		expect(conflict.codes).toEqual({ priority: 'validation_ticket_conflict', due: 'validation_ticket_conflict' });
		expect(conflict.data.due.message).toBe('Die Fälligkeit wurde inzwischen geändert.');
	});

	it('takes the same wish twice as arrived', async () => {
		const ticket = await a.ticket({ household: householdId });
		await b.client.collection('tickets').update(ticket.id, { status: 'done' });
		const same = await a.client.collection('tickets').update(ticket.id, { status: 'done', expected: { status: 'open' }, op_id: opId() });
		expect(same.status).toBe('done');
		expect((await entriesOf(ticket.id, 'status')).map((entry) => entry.user)).toEqual([b.id]);
	});

	it('compares tags as a set and refuses expectations of the wrong form', async () => {
		const first = await a.client.collection('tags').create({ owner: a.id, name: `eins-${opId()}` });
		const second = await a.client.collection('tags').create({ owner: a.id, name: `zwei-${opId()}` });
		const ticket = await a.ticket({ tags: [first.id, second.id] });
		const tagged = await a.client.collection('tickets').update(ticket.id, { tags: [first.id], expected: { tags: [second.id, first.id] } });
		expect(tagged.tags).toEqual([first.id]);
		for (const expected of ['open', [], {}, { owner: a.id }, { status: { value: 'open' } }]) {
			const wrong = await refusal(a.client.collection('tickets').update(ticket.id, { status: 'done', expected }));
			expect(wrong.codes, JSON.stringify(expected)).toEqual({ expected: 'validation_expected_invalid' });
		}
		expect((await superuser.collection('tickets').getOne(ticket.id)).status).toBe('open');
	});

	it('keeps expected_updated as before, also next to expected', async () => {
		const ticket = await a.ticket({ description: 'Alt' });
		await a.client.collection('tickets').update(ticket.id, { title: 'Dazwischen' });
		const stale = await refusal(
			a.client.collection('tickets').update(ticket.id, { description: 'Neu', expected_updated: ticket.updated, expected: { description: 'Alt' } })
		);
		expect(stale.codes).toEqual({ description: 'validation_description_stale' });
	});
});

describe('the check mark of the day plan from the outbox', () => {
	/** A ticket of the household of A and B in the plan of today, read for B and A. */
	async function planned() {
		const ticket = await a.ticket({ household: householdId });
		const { item } = await a.send('/api/byl/dayplan/items', { ticket: ticket.id });
		return { ticket, item };
	}

	it('refuses a check mark whose ticket someone else gave another status, and takes the same done as arrived', async () => {
		await useClock(null);
		const { ticket, item } = await planned();
		await b.client.collection('tickets').update(ticket.id, { status: 'waiting' });
		const conflict = await refusal(a.send(`/api/byl/dayplan/items/${item.id}/check`, { mode: 'check', expected: { checked: false, status: 'open' }, op_id: opId() }));
		expect(conflict.codes).toEqual({ status: 'validation_ticket_conflict' });
		expect((await superuser.collection('day_plan_items').getOne(item.id)).checked_by).toBe('');

		const other = await planned();
		await b.client.collection('tickets').update(other.ticket.id, { status: 'done' });
		const arrived = await a.send(`/api/byl/dayplan/items/${other.item.id}/check`, { mode: 'check', expected: { checked: false, status: 'open' }, op_id: opId() });
		expect(arrived).toMatchObject({ action: 'complete', ticket: { status: 'done', previous_status: 'done' }, item: { checked_by: a.id } });
		expect((await entriesOf(other.ticket.id, 'status')).map((entry) => entry.user)).toEqual([b.id]);
	});

	it('refuses taking a mark back when someone else reopened the ticket with another status', async () => {
		await useClock(null);
		const { ticket, item } = await planned();
		await a.send(`/api/byl/dayplan/items/${item.id}/check`, { mode: 'check' });
		await b.client.collection('tickets').update(ticket.id, { status: 'in_progress' });
		const conflict = await refusal(a.send(`/api/byl/dayplan/items/${item.id}/uncheck`, { status: 'open', expected: { checked: true, status: 'done' } }));
		expect(conflict.codes).toEqual({ status: 'validation_ticket_conflict' });
		expect((await superuser.collection('tickets').getOne(ticket.id)).status).toBe('in_progress');
		expect((await refusal(a.send(`/api/byl/dayplan/items/${item.id}/uncheck`, { expected: { checked: 'ja' } }))).codes).toEqual({
			expected: 'validation_expected_invalid'
		});
	});

	it('answers a check mark of before also after midnight, and still refuses a new one on the day before', async () => {
		// 23:50 in Berlin (UTC+1 in January).
		await useClock('2031-01-08T22:50:00.000Z');
		const first = await planned();
		const second = await planned();
		const op = opId();
		const checked = await a.send(`/api/byl/dayplan/items/${first.item.id}/check`, { mode: 'check', op_id: op, client_at: deviceTime(-MINUTE) });
		// 00:10 the next day: the plan of yesterday is read only.
		await useClock('2031-01-08T23:10:00.000Z');
		const again = await a.send(`/api/byl/dayplan/items/${first.item.id}/check`, { mode: 'check', op_id: op, client_at: deviceTime(-MINUTE) });
		expect(again).toEqual(checked);
		const late = await refusal(
			a.send(`/api/byl/dayplan/items/${second.item.id}/check`, { mode: 'check', op_id: opId(), offline: true, client_at: deviceTime(-21 * MINUTE) })
		);
		expect(late.codes).toEqual({ date: 'validation_dayplan_readonly' });
		expect((await superuser.collection('tickets').getOne(second.ticket.id)).status).toBe('open');
		await useClock(null);
	});
});

describe('a comment on a ticket created from the outbox', () => {
	it('arrives after the ticket under its ID, both once, both marked', async () => {
		const at = deviceTime(-3 * HOUR);
		const id = recordId();
		const create = { id, owner: a.id, title: 'Offline angelegt', source: 'quick', op_id: opId(), client_at: at };
		const comment = { ticket: id, author: a.id, body: 'Offline kommentiert', op_id: opId(), client_at: deviceTime(-2 * HOUR) };
		// Before the ticket arrived, the comment has no ticket to belong to.
		expect((await refusal(a.client.collection('comments').create(comment))).status).toBe(400);
		const ticket = await a.client.collection('tickets').create(create);
		const written = await a.client.collection('comments').create(comment);
		expect(await a.client.collection('tickets').create(create)).toEqual(ticket);
		expect(await a.client.collection('comments').create(comment)).toEqual(written);
		expect(ticket).toMatchObject({ id, key: expect.stringMatching(/^TASK-\d+$/) });
		expect(written).toMatchObject({ ticket: id, offline: true, device_at: kept(comment.client_at) });
		expect((await entriesOf(id, 'created'))[0]).toMatchObject({ offline: true, device_at: kept(at) });
		expect(await superuser.collection('comments').getFullList({ filter: superuser.filter('ticket = {:id}', { id }) })).toHaveLength(1);
	});
});
