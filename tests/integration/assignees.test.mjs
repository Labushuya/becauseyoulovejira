// "Zuständig" in the household (E7-5, ADR-0068) against an own disposable PocketBase with the scenario
// of the areas (tests/support/scenario.mjs): A and B share a household (A founds it), C is alone. The
// assignee is a current member of the household of the ticket or nobody, a private ticket never has
// one, and every member may assign; an assignment by someone else tells the open tabs of the assignee
// (topic byl/assigned) and makes the ticket "neu" for him again (his read row goes, `assigned_at`),
// an own one does neither. A membership that ends takes the person out of every ticket (with history)
// and rotation of the household. Rules give every new occurrence its person: "fest" and "abwechselnd"
// over several occurrences, with "Nur das aktuelle Vorkommen" (WH-1), with "Verpasste Termine
// nachholen" and when reopening takes a follow-up back. Moving (also a whole series) into the private
// area clears assignments, duplicating keeps them only in the same household, a follow-up has none.
// The day plan suggests "Mir zugewiesen" for the account that looks at it, the same as the rules of the
// SPA. Changes reach the other member live.
//
// Dates are relative to the Berlin "today" of the machine: completing runs with the real clock like the
// app, the runs of the generation with the clock of the test route POST /api/byl-test/recurrence/run.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { createAreaScenario, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import { addDays, berlinToday } from '../../web/src/lib/domain/berlin-date.ts';
import { suggestionsOf } from '../../web/src/lib/domain/day-plan.ts';

const MOVE = '/api/byl/area/move';
const PLAN = '/api/byl/dayplan';
const TOPIC = 'byl/assigned';
const EVENT_TIMEOUT_MS = scaled(5_000);

let instance;
let superuser;
let a;
let b;
let c;
let householdId;
const stops = [];

const today = () => berlinToday(Date.now());
const stored = (date) => `${date} 00:00:00.000Z`;
/** Noon UTC of a Berlin date: the same calendar day in Berlin in summer and in winter. */
const noon = (date) => `${date}T12:00:00Z`;
const householdScope = () => `h:${householdId}`;

const ticketOf = (id) => superuser.collection('tickets').getOne(id);
const ruleOf = (id) => superuser.collection('recurrence_rules').getOne(id);
const historyOf = (id) =>
	superuser.collection('ticket_history').getFullList({ filter: superuser.filter('ticket = {:id}', { id }), sort: 'created,id' });
const assigneeHistory = async (id) =>
	(await historyOf(id)).filter((entry) => entry.field === 'assignee').map((entry) => [entry.old_value, entry.new_value, entry.user]);
const openOf = (ruleId) =>
	superuser
		.collection('tickets')
		.getFullList({ filter: superuser.filter("recurrence = {:r} && status != 'done'", { r: ruleId }), sort: 'due,created,id' });
const readsOf = (person, ticketId) =>
	superuser
		.collection('ticket_reads')
		.getFullList({ filter: superuser.filter('user = {:u} && ticket = {:t}', { u: person.id, t: ticketId }) });

/** Status and the validation code per field of a refused call. */
async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		const data = error.response?.data ?? {};
		return { status: error.status, codes: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.code])) };
	}
	throw new Error('Expected the request to be refused, but it succeeded.');
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

/** Waits until `ready()` holds, at most EVENT_TIMEOUT_MS. */
async function until(ready, label) {
	const deadline = Date.now() + EVENT_TIMEOUT_MS;
	while (!(await ready())) {
		if (Date.now() > deadline) throw new Error(`Not reached within ${EVENT_TIMEOUT_MS} ms: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

/** The notices of the topic byl/assigned for the tabs of `person`. */
async function notices(person) {
	const received = [];
	stops.push(await person.client.realtime.subscribe(TOPIC, (data) => received.push(data)));
	return received;
}

/**
 * A notice is not sent: a marker ticket of `person` assigned by the other member afterwards arrives,
 * and nothing came before it (PocketBase sends the messages of one tab in order).
 */
async function nothingBefore(received, person, other) {
	const marker = await other.ticket({ household: householdId, title: `Marke ${uniqueSuffix()}` });
	await other.client.collection('tickets').update(marker.id, { assignee: person.id });
	await until(() => received.some((notice) => notice.ticket === marker.id), 'marker notice');
	return received.filter((notice) => notice.ticket !== marker.id);
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

/** A daily rule of A in the household with the assignment of `assignment`, made by the run of today. */
async function dailyRule(assignment, extra = {}) {
	return a.client.collection('recurrence_rules').create({
		owner: a.id,
		household: householdId,
		title: `Müll ${uniqueSuffix()}`,
		mode: 'calendar',
		freq: 'daily',
		anchor: today(),
		lead_days: 7,
		initial_status: 'open',
		...assignment,
		...extra
	});
}

async function complete(person, ticketId) {
	return person.client.collection('tickets').update(ticketId, { status: 'done' });
}

beforeAll(async () => {
	instance = await startPocketBase();
	({ superuser, a, b, c, householdId } = await createAreaScenario(instance));
});

afterAll(async () => {
	for (const stop of stops) await stop().catch(() => undefined);
	await instance?.stop();
});

// Every test leaves its rules paused, so a later run with another clock does not touch them.
afterEach(async () => {
	const active = await superuser.collection('recurrence_rules').getFullList({ filter: 'active = true' });
	for (const rule of active) await superuser.collection('recurrence_rules').update(rule.id, { active: false });
});

describe('the assignee of a ticket', () => {
	it('is a current member of the household or nobody; every member may assign, also to himself', async () => {
		const ticket = await a.ticket({ household: householdId });
		expect(ticket.assignee).toBe('');
		// B assigns the ticket of A to A, then takes it himself ("Ich übernehme"), then A gives it back.
		expect((await b.client.collection('tickets').update(ticket.id, { assignee: a.id })).assignee).toBe(a.id);
		expect((await b.client.collection('tickets').update(ticket.id, { assignee: b.id })).assignee).toBe(b.id);
		expect((await a.client.collection('tickets').update(ticket.id, { assignee: a.id })).assignee).toBe(a.id);
		expect((await a.client.collection('tickets').update(ticket.id, { assignee: '' })).assignee).toBe('');
		// Also when it is created.
		const created = await b.ticket({ household: householdId, assignee: b.id });
		expect(created.assignee).toBe(b.id);
		// The history names "Zuständig" and "Zuständigkeit entfernt" with the account of the change.
		expect(await assigneeHistory(ticket.id)).toEqual([
			['', a.id, b.id],
			[a.id, b.id, b.id],
			[b.id, a.id, a.id],
			[a.id, '', a.id]
		]);
	});

	it('refuses an account outside the household (C) and any assignee at a private ticket, for the superuser as well', async () => {
		const ticket = await a.ticket({ household: householdId });
		expect(await rejection(a.client.collection('tickets').update(ticket.id, { assignee: c.id }))).toEqual({
			status: 400,
			codes: { assignee: 'validation_assignee_member' }
		});
		expect(await rejection(a.ticket({ household: householdId, assignee: c.id }))).toEqual({
			status: 400,
			codes: { assignee: 'validation_assignee_member' }
		});
		expect(await rejection(superuser.collection('tickets').update(ticket.id, { assignee: c.id }))).toEqual({
			status: 400,
			codes: { assignee: 'validation_assignee_member' }
		});
		const own = await a.ticket();
		expect(await rejection(a.client.collection('tickets').update(own.id, { assignee: a.id }))).toEqual({
			status: 400,
			codes: { assignee: 'validation_assignee_private' }
		});
		expect(await rejection(c.ticket({ assignee: c.id }))).toEqual({ status: 400, codes: { assignee: 'validation_assignee_private' } });
		// C does not even see the ticket of the household.
		expect(await statusOf(c.client.collection('tickets').update(ticket.id, { assignee: c.id }))).toBe(404);
		expect((await ticketOf(ticket.id)).assignee).toBe('');
	});

	it('keeps `assigned_at` with the server: set by an assignment of someone else, cleared by an own one', async () => {
		const ticket = await a.ticket({ household: householdId });
		const sent = await b.client.collection('tickets').update(ticket.id, { assigned_at: '2020-01-01 00:00:00.000Z' });
		expect(sent.assigned_at).toBe('');
		const assigned = await a.client.collection('tickets').update(ticket.id, { assignee: b.id });
		expect(assigned.assigned_at).not.toBe('');
		// Another change keeps it, the own assignment of A clears it.
		expect((await b.client.collection('tickets').update(ticket.id, { title: 'Anders' })).assigned_at).toBe(assigned.assigned_at);
		expect((await a.client.collection('tickets').update(ticket.id, { assignee: a.id })).assigned_at).toBe('');
	});
});

describe('the notice of an assignment and "neu"', () => {
	it('tells only the tabs of the assignee about an assignment by someone else and makes the ticket new for him again', async () => {
		const toB = await notices(b);
		const toA = await notices(a);
		const ticket = await a.ticket({ household: householdId, title: 'Keller aufräumen' });
		// B opened the ticket: his read row exists.
		await b.client.collection('ticket_reads').create({ user: b.id, ticket: ticket.id });
		expect(await readsOf(b, ticket.id)).toHaveLength(1);

		const assigned = await a.client.collection('tickets').update(ticket.id, { assignee: b.id });
		await until(() => toB.some((notice) => notice.ticket === ticket.id), 'notice to B');
		expect(toB.find((notice) => notice.ticket === ticket.id)).toEqual({
			ticket: ticket.id,
			key: assigned.key,
			title: 'Keller aufräumen',
			scope: householdScope(),
			by: a.id,
			by_name: 'Anna Beispiel'
		});
		// The read row of B is gone in the same transaction; B's base line is older than the assignment.
		expect(await readsOf(b, ticket.id)).toEqual([]);
		const bRecord = await superuser.collection('users').getOne(b.id);
		expect(assigned.assigned_at >= (bRecord.unread_since || bRecord.created)).toBe(true);
		// A, who assigned, hears nothing about it.
		expect((await nothingBefore(toA, a, b)).filter((notice) => notice.ticket === ticket.id)).toEqual([]);
	});

	it('tells nobody about an own assignment ("Ich übernehme") and keeps the read row', async () => {
		const toB = await notices(b);
		const ticket = await a.ticket({ household: householdId });
		await b.client.collection('ticket_reads').create({ user: b.id, ticket: ticket.id });
		await b.client.collection('tickets').update(ticket.id, { assignee: b.id });
		expect(await readsOf(b, ticket.id)).toHaveLength(1);
		expect((await nothingBefore(toB, b, a)).filter((notice) => notice.ticket === ticket.id)).toEqual([]);
		expect((await ticketOf(ticket.id)).assigned_at).toBe('');
	});

	it('tells the assignee of a new ticket another member created for him', async () => {
		const toA = await notices(a);
		const created = await b.ticket({ household: householdId, assignee: a.id, title: 'Fenster putzen' });
		await until(() => toA.some((notice) => notice.ticket === created.id), 'notice of the new ticket');
		expect(toA.find((notice) => notice.ticket === created.id)).toMatchObject({ key: created.key, by: b.id, by_name: 'Bert Beispiel' });
	});

	it('brings the change of the assignee live to the other member', async () => {
		const ticket = await a.ticket({ household: householdId });
		const events = [];
		stops.push(
			await b.client.collection('tickets').subscribe(ticket.id, (event) => events.push(event))
		);
		await a.client.collection('tickets').update(ticket.id, { assignee: a.id });
		await until(() => events.some((event) => event.action === 'update' && event.record.assignee === a.id), 'update at B');
	});
});

describe('a membership that ends', () => {
	it('takes the person out of every ticket (in the trash too) with history and out of every rotation', async () => {
		const { a: owner, b: member, c: outsider, householdId: home } = await createAreaScenario(instance, [
			'Anna Zwei',
			'Bert Zwei',
			'Clara Zwei'
		]);
		const assigned = await owner.client.collection('tickets').create({ owner: owner.id, household: home, title: 'Rasen', assignee: member.id });
		const trashed = await owner.client.collection('tickets').create({ owner: owner.id, household: home, title: 'Altglas', assignee: member.id });
		await owner.send(`/api/byl/tickets/${trashed.id}/delete`, { sources: 'inbox' });
		const kept = await owner.client.collection('tickets').create({ owner: owner.id, household: home, title: 'Bad', assignee: owner.id });
		const base = { owner: owner.id, household: home, mode: 'calendar', freq: 'weekly', initial_status: 'open', active: false };
		const rotation = await owner.client
			.collection('recurrence_rules')
			.create({ ...base, title: 'Müll', assignee_mode: 'rotate', assignees: [owner.id, member.id], assignee_next: 1 });
		const fixed = await owner.client
			.collection('recurrence_rules')
			.create({ ...base, title: 'Blumen', assignee_mode: 'fixed', assignees: [member.id] });
		const single = await owner.client
			.collection('recurrence_rules')
			.create({ ...base, title: 'Keller', assignee_mode: 'rotate', assignees: [member.id] });

		await member.send('/api/byl/household/leave', {});

		expect((await ticketOf(assigned.id)).assignee).toBe('');
		expect((await ticketOf(trashed.id)).assignee).toBe('');
		expect((await ticketOf(kept.id)).assignee).toBe(owner.id);
		expect(await assigneeHistory(assigned.id)).toEqual([[member.id, '', member.id]]);
		expect(await assigneeHistory(trashed.id)).toEqual([[member.id, '', member.id]]);
		expect(await ruleOf(rotation.id)).toMatchObject({ assignee_mode: 'rotate', assignees: [owner.id], assignee_next: 0 });
		expect(await ruleOf(fixed.id)).toMatchObject({ assignee_mode: '', assignees: [], assignee_next: 0 });
		expect(await ruleOf(single.id)).toMatchObject({ assignee_mode: '', assignees: [] });
		expect(outsider.id).not.toBe(member.id);
	});

	it('does the same when a member is removed, with the account that removed him in the history', async () => {
		const { a: owner, b: member, householdId: home } = await createAreaScenario(instance, ['Anna Drei', 'Bert Drei', 'Clara Drei']);
		const ticket = await owner.client.collection('tickets').create({ owner: owner.id, household: home, title: 'Hof', assignee: member.id });
		const state = await owner.send('/api/byl/household', undefined, 'GET');
		const membership = state.members.find((entry) => entry.user === member.id);
		await owner.send(`/api/byl/household/members/${membership.id}/remove`, {});
		expect((await ticketOf(ticket.id)).assignee).toBe('');
		expect(await assigneeHistory(ticket.id)).toEqual([[member.id, '', owner.id]]);
	});

	it('leaves no assignee and no rotation in the private area after dissolving with "adopt"', async () => {
		const { a: owner, b: member, householdId: home } = await createAreaScenario(instance, ['Anna Vier', 'Bert Vier', 'Clara Vier']);
		const mine = await owner.client.collection('tickets').create({ owner: owner.id, household: home, title: 'Dach', assignee: owner.id });
		const theirs = await owner.client.collection('tickets').create({ owner: owner.id, household: home, title: 'Zaun', assignee: member.id });
		const rotation = await owner.client.collection('recurrence_rules').create({
			owner: owner.id,
			household: home,
			title: 'Müll',
			mode: 'calendar',
			freq: 'weekly',
			initial_status: 'open',
			active: false,
			assignee_mode: 'rotate',
			assignees: [owner.id, member.id]
		});

		await owner.send('/api/byl/household/dissolve', { mode: 'adopt' });

		for (const id of [mine.id, theirs.id]) {
			const ticket = await ticketOf(id);
			expect(ticket.household).toBe('');
			expect(ticket.assignee).toBe('');
			expect(ticket.assigned_at).toBe('');
		}
		expect(await assigneeHistory(mine.id)).toEqual([[owner.id, '', owner.id]]);
		expect(await assigneeHistory(theirs.id)).toEqual([[member.id, '', owner.id]]);
		expect(await ruleOf(rotation.id)).toMatchObject({ household: '', assignee_mode: '', assignees: [], assignee_next: 0 });
	});
});

describe('rules with an assignment', () => {
	it('checks the assignment: members only, "fest" one person, nothing in the private area', async () => {
		expect(await rejection(dailyRule({ assignee_mode: 'rotate', assignees: [a.id, c.id] }, { active: false }))).toEqual({
			status: 400,
			codes: { assignees: 'validation_recurrence_assignee_member' }
		});
		expect(await rejection(dailyRule({ assignee_mode: 'fixed', assignees: [a.id, b.id] }, { active: false }))).toEqual({
			status: 400,
			codes: { assignees: 'validation_recurrence_assignee_fixed' }
		});
		expect(await rejection(dailyRule({ assignee_mode: 'rotate', assignees: [a.id, b.id], assignee_next: 2 }, { active: false }))).toEqual({
			status: 400,
			codes: { assignee_next: 'validation_recurrence_assignee_next' }
		});
		expect(
			await rejection(
				a.client.collection('recurrence_rules').create({
					owner: a.id,
					title: 'Privat',
					mode: 'calendar',
					freq: 'daily',
					initial_status: 'open',
					assignee_mode: 'fixed',
					assignees: [a.id]
				})
			)
		).toEqual({ status: 400, codes: { assignees: 'validation_recurrence_assignee_private' } });
		// Without a mode the people go; a changed list starts again at its first person.
		const none = await dailyRule({ assignee_mode: '', assignees: [a.id] }, { active: false });
		expect(none).toMatchObject({ assignee_mode: '', assignees: [], assignee_next: 0 });
		const rule = await dailyRule({ assignee_mode: 'rotate', assignees: [a.id, b.id], assignee_next: 1 }, { active: false });
		expect(rule.assignee_next).toBe(1);
		expect((await b.client.collection('recurrence_rules').update(rule.id, { assignees: [b.id, a.id] })).assignee_next).toBe(0);
		expect((await b.client.collection('recurrence_rules').update(rule.id, { title: 'Müll raus' })).assignee_next).toBe(0);
	});

	it('gives every occurrence the person by the mode: "fest" always B, "abwechselnd" A, B, A with WH-1', async () => {
		const fixed = await dailyRule({ assignee_mode: 'fixed', assignees: [b.id] });
		const [first] = await openOf(fixed.id);
		expect(first.assignee).toBe(b.id);
		await complete(b, first.id);
		await until(async () => (await openOf(fixed.id)).length === 1, 'next of "fest"');
		expect((await openOf(fixed.id))[0].assignee).toBe(b.id);

		const rotation = await dailyRule({ assignee_mode: 'rotate', assignees: [a.id, b.id] });
		const people = [];
		let current = null;
		for (let i = 0; i < 3; i += 1) {
			if (current !== null) await complete(current.assignee === a.id ? a : b, current.id);
			const previous = current?.id;
			await until(async () => (await openOf(rotation.id)).some((ticket) => ticket.id !== previous), `occurrence ${i + 1}`);
			[current] = await openOf(rotation.id);
			people.push(current.assignee);
		}
		expect(people).toEqual([a.id, b.id, a.id]);
		expect((await ruleOf(rotation.id)).assignee_next).toBe(1);
		// The generation is no person: no history entry "Zuständig", no `assigned_at`.
		expect(await assigneeHistory(current.id)).toEqual([]);
		expect(current.assigned_at).toBe('');
	});

	it('takes the rotation back when reopening removes the untouched follow-up', async () => {
		const rotation = await dailyRule({ assignee_mode: 'rotate', assignees: [a.id, b.id] });
		const [first] = await openOf(rotation.id);
		expect(first.assignee).toBe(a.id);
		await complete(a, first.id);
		await until(async () => (await openOf(rotation.id)).length === 1, 'follow-up');
		expect((await openOf(rotation.id))[0].assignee).toBe(b.id);
		expect((await ruleOf(rotation.id)).assignee_next).toBe(0);
		// Reopening the first removes the untouched follow-up of B; the next one is B's again.
		await a.client.collection('tickets').update(first.id, { status: 'open' });
		expect((await ruleOf(rotation.id)).assignee_next).toBe(1);
		await complete(a, first.id);
		await until(async () => (await openOf(rotation.id)).length === 1, 'follow-up again');
		expect((await openOf(rotation.id))[0].assignee).toBe(b.id);
	});

	it('goes round with "Verpasste Termine nachholen": one person per missed date, in the order of the dates', async () => {
		const rule = await dailyRule(
			{ assignee_mode: 'rotate', assignees: [b.id, a.id] },
			{ active: false, each_occurrence: true, lead_days: 0, anchor: addDays(today(), -10) }
		);
		await superuser.collection('recurrence_rules').update(rule.id, { active: true, next_due: stored(addDays(today(), -3)) });
		const run = await runRecurrence(noon(today()));
		expect(run.tickets).toBe(4);
		const made = await openOf(rule.id);
		expect(made.map((ticket) => [ticket.due.slice(0, 10), ticket.assignee])).toEqual([
			[addDays(today(), -3), b.id],
			[addDays(today(), -2), a.id],
			[addDays(today(), -1), b.id],
			[today(), a.id]
		]);
		expect((await ruleOf(rule.id)).assignee_next).toBe(0);
	});
});

describe('moving, duplicating and follow-ups', () => {
	it('clears the assignee of a ticket that moves into the private area, with its history', async () => {
		const ticket = await a.ticket({ household: householdId, assignee: b.id });
		await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'private' });
		const moved = await ticketOf(ticket.id);
		expect(moved).toMatchObject({ household: '', assignee: '', assigned_at: '' });
		const history = await historyOf(ticket.id);
		expect(history.map((entry) => entry.field).slice(-2)).toEqual(['area_move', 'assignee']);
		expect(await assigneeHistory(ticket.id)).toEqual([[b.id, '', a.id]]);
		// Back into the household it comes without one.
		await a.send(MOVE, { kind: 'ticket', ids: [ticket.id], to: 'household' });
		expect((await ticketOf(ticket.id)).assignee).toBe('');
	});

	it('clears the rotation and the assignees of a whole series that moves into the private area (MV-2)', async () => {
		const rule = await dailyRule({ assignee_mode: 'rotate', assignees: [a.id, b.id] });
		const [open] = await openOf(rule.id);
		expect(open.assignee).toBe(a.id);
		await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'private', series: true, series_done: true });
		expect(await ruleOf(rule.id)).toMatchObject({ household: '', assignee_mode: '', assignees: [], assignee_next: 0 });
		expect(await ticketOf(open.id)).toMatchObject({ household: '', recurrence: rule.id, assignee: '' });
		// Back into the household the series has no assignment.
		await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true, series_done: true });
		expect(await ruleOf(rule.id)).toMatchObject({ household: householdId, assignee_mode: '', assignees: [] });
	});

	it('keeps the assignee of a duplicate in the same household (also of its sub-tasks), never in another area', async () => {
		const original = await a.ticket({ household: householdId, assignee: b.id });
		const child = await a.ticket({ household: householdId, parent: original.id, assignee: a.id });
		const same = await a.send(`/api/byl/tickets/${original.id}/duplicate`, { title: 'Kopie', status: 'open', subtasks: true });
		expect((await ticketOf(same.id)).assignee).toBe(b.id);
		expect((await ticketOf(same.subtasks[0].id)).assignee).toBe(a.id);
		expect(child.assignee).toBe(a.id);
		const outside = await a.send(`/api/byl/tickets/${original.id}/duplicate`, { title: 'Privat', status: 'open', to: 'private', subtasks: true });
		expect(await ticketOf(outside.id)).toMatchObject({ household: '', assignee: '' });
		expect((await ticketOf(outside.subtasks[0].id)).assignee).toBe('');
		// Out of the private area into the household there is none to take along.
		const own = await a.ticket();
		const inside = await a.send(`/api/byl/tickets/${own.id}/duplicate`, { title: 'Haushalt', status: 'open', to: 'household' });
		expect(await ticketOf(inside.id)).toMatchObject({ household: householdId, assignee: '' });
	});

	it('gives a follow-up no assignee (QT-1)', async () => {
		const source = await a.ticket({ household: householdId, assignee: b.id });
		const follow = await a.send(`/api/byl/tickets/${source.id}/follow-up`, { title: 'Folge', tags: true, charm: true, description: false });
		expect(await ticketOf(follow.id)).toMatchObject({ household: householdId, assignee: '' });
	});
});

describe('the day plan suggests "Mir zugewiesen" for the account that looks at it', () => {
	it('suggests the tickets of A to A and those of B to B, with the same suggestions as the rules of the SPA', async () => {
		const forA = await a.ticket({ household: householdId, assignee: a.id, title: `Für Anna ${uniqueSuffix()}` });
		const forB = await b.ticket({ household: householdId, assignee: b.id, title: `Für Bert ${uniqueSuffix()}` });
		const scope = householdScope();
		const fetched = await a.client.send(PLAN, { method: 'GET', query: { scope }, requestKey: null });
		expect(fetched.scope).toBe(scope);
		const suggestedA = fetched.suggestions.find((entry) => entry.id === forA.id);
		expect(suggestedA).toMatchObject({ mode: 'suggest', origin: 'assigned', reasons: ['dir zugewiesen'] });
		expect(fetched.suggestions.some((entry) => entry.id === forB.id && entry.origin === 'assigned')).toBe(false);
		const fetchedB = await b.client.send(PLAN, { method: 'GET', query: { scope }, requestKey: null });
		expect(fetchedB.suggestions.find((entry) => entry.id === forB.id)).toMatchObject({ origin: 'assigned' });

		// The rules of the SPA give the same suggestions from the same tickets and plan.
		const open = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter("scope = {:s} && status != 'done' && deleted_at = ''", { s: scope }), sort: 'created,id' });
		const facts = open.map((ticket) => ({
			id: ticket.id,
			status: ticket.status,
			due: ticket.due ? ticket.due.slice(0, 10) : '',
			kind: ticket.kind,
			recurring: ticket.recurrence !== '',
			series: ticket.recurrence && !ticket.occurrence ? ticket.recurrence : '',
			assignee: ticket.assignee,
			priority: ticket.priority,
			created: ticket.created
		}));
		const items = await superuser
			.collection('day_plan_items')
			.getFullList({ filter: superuser.filter('plan = {:p}', { p: fetched.plan.id }) });
		const web = suggestionsOf(facts, {
			today: fetched.today,
			settings: fetched.settings,
			planned: items.map((item) => item.ticket),
			dismissed: fetched.plan.dismissed,
			leftover: fetched.leftover,
			viewer: a.id
		});
		expect(web).toEqual(fetched.suggestions);
	});

	it('takes the tickets of the viewer into the plan at once in the mode "auto", with the origin "assigned"', async () => {
		const scope = householdScope();
		await a.send(`${PLAN}/settings`, { scope, sources: { assigned: 'auto' } });
		try {
			const ticket = await b.ticket({ household: householdId, assignee: a.id, title: `Automatisch ${uniqueSuffix()}` });
			const fetched = await a.client.send(PLAN, { method: 'GET', query: { scope }, requestKey: null });
			const items = await superuser
				.collection('day_plan_items')
				.getFullList({ filter: superuser.filter('plan = {:p} && ticket = {:t}', { p: fetched.plan.id, t: ticket.id }) });
			expect(items.map((item) => item.origin)).toEqual(['assigned']);
		} finally {
			await a.send(`${PLAN}/settings`, { scope, sources: { assigned: 'suggest' } });
		}
	});
});
