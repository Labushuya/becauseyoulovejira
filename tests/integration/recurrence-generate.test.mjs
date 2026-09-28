// Generating the tickets of recurrence rules (E5 plan, package 3; ADR-0022, ADR-0023 sections 2,
// 3, 6 and 8) against an own disposable PocketBase: its runs do not reach the rules of other test
// files. The clock of a run comes through the test route POST /api/byl-test/recurrence/run
// (tests/fixtures/pb_hooks/recurrence-clock.pb.js); completing, reopening and deleting run with
// the real clock, like the app.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FAIL_HISTORY, FAIL_TICKET_INSERT } from '../support/scenario.mjs';
import { addDays, berlinToday } from '../../web/src/lib/domain/berlin-date.ts';
import { after, latestOnOrBefore } from '../../web/src/lib/domain/recurrence.ts';

let instance;
let superuser;
let owner;

const unique = () => randomBytes(6).toString('hex');
const dateOf = (value) => (value ? value.slice(0, 10) : '');
const today = () => berlinToday(Date.now());

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	const email = `user-${unique()}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	owner = { id: record.id, pb };
}, 60_000);

afterAll(async () => {
	await instance?.stop();
});

// Every test leaves its rules paused, so a later run with another clock does not touch them.
afterEach(async () => {
	const active = await superuser.collection('recurrence_rules').getFullList({ filter: 'active = true' });
	for (const rule of active) await superuser.collection('recurrence_rules').update(rule.id, { active: false });
});

const rules = () => owner.pb.collection('recurrence_rules');
const tickets = () => owner.pb.collection('tickets');
const createRule = (data = {}) =>
	rules().create({ owner: owner.id, title: `Regel ${unique()}`, mode: 'calendar', freq: 'daily', lead_days: 0, ...data });

async function run(iso) {
	const response = await fetch(`${instance.url}/api/byl-test/recurrence/run`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ now: Date.parse(iso) })
	});
	expect(response.status).toBe(200);
	return response.json();
}

async function cron() {
	const response = await fetch(`${instance.url}/api/crons/byl-recurrence`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token }
	});
	expect(response.status).toBe(204);
}

const instancesOf = (ruleId) =>
	superuser.collection('tickets').getFullList({ filter: superuser.filter('recurrence = {:rule}', { rule: ruleId }), sort: 'created,id' });
const openOf = async (ruleId) => (await instancesOf(ruleId)).filter((ticket) => ticket.status !== 'done');
const ruleOf = (ruleId) => superuser.collection('recurrence_rules').getOne(ruleId);
const historyOf = (ticketId) =>
	superuser.collection('ticket_history').getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticketId }), sort: 'created,id' });

describe('generation by the clock (ADR-0022 sections 2 and 3)', () => {
	it('creates the ticket once the lead time is reached, with template, key and history', async () => {
		const code = `R${unique().slice(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X')}`;
		const project = await owner.pb.collection('projects').create({ owner: owner.id, name: 'Haus', code });
		const tag = await owner.pb.collection('tags').create({ owner: owner.id, name: `t-${unique()}` });
		const rule = await createRule({
			title: 'Müll rausbringen',
			description: 'Gelbe Tonne',
			project: project.id,
			tags: [tag.id],
			priority: 'high',
			freq: 'weekly',
			weekdays: ['MO'],
			anchor: '2030-01-07',
			lead_days: 3
		});
		expect(await instancesOf(rule.id)).toEqual([]);

		// Thursday before: one day too early; Friday: three days ahead of Monday.
		expect((await run('2030-01-03T12:00:00Z')).created).toBe(0);
		expect(await instancesOf(rule.id)).toEqual([]);
		expect((await run('2030-01-04T12:00:00Z')).created).toBe(1);

		const [ticket] = await instancesOf(rule.id);
		expect(ticket).toMatchObject({
			title: 'Müll rausbringen',
			description: 'Gelbe Tonne',
			project: project.id,
			tags: [tag.id],
			priority: 'high',
			status: 'open',
			key: `${code}-1`,
			recurrence: rule.id,
			owner: owner.id,
			source: '',
			blocks_parent: true
		});
		expect(dateOf(ticket.due)).toBe('2030-01-07');
		const history = await historyOf(ticket.id);
		// Created without a user, with the rule as old value: the history names "Wiederholung" (T-9).
		expect(history.map(({ field, old_value, new_value, user }) => ({ field, old_value, new_value, user }))).toEqual([
			{ field: 'created', old_value: rule.id, new_value: `${code}-1`, user: '' }
		]);
		const stored = await ruleOf(rule.id);
		expect(dateOf(stored.next_due)).toBe('2030-01-14');
		expect(stored.last_generated_at).toBe('2030-01-04 12:00:00.000Z');
		expect(stored.last_hint).toBe('');

		// The same run again finds the open instance and does nothing.
		expect((await run('2030-01-04T12:00:00Z')).created).toBe(0);
		expect(await instancesOf(rule.id)).toHaveLength(1);
	});

	it('creates exactly one ticket with the latest missed date after 3 weeks and after 2 years', async () => {
		const params = { mode: 'calendar', freq: 'weekly', weekdays: ['MO'], anchor: '2031-01-06' };
		const weeks = await createRule(params);
		await run('2031-01-29T12:00:00Z');
		const [late] = await instancesOf(weeks.id);
		expect(dateOf(late.due)).toBe('2031-01-27');
		expect(dateOf((await ruleOf(weeks.id)).next_due)).toBe('2031-02-03');
		await run('2031-01-29T12:00:00Z');
		expect(await instancesOf(weeks.id)).toHaveLength(1);

		const years = await createRule(params);
		await superuser.collection('recurrence_rules').update(weeks.id, { active: false });
		await run('2033-01-29T12:00:00Z');
		const created = await instancesOf(years.id);
		expect(created).toHaveLength(1);
		const latest = latestOnOrBefore(params, '2033-01-29');
		expect(dateOf(created[0].due)).toBe(latest);
		expect(dateOf((await ruleOf(years.id)).next_due)).toBe(after(params, latest));
	});

	it('never creates a second open instance: repeated, parallel and cron runs', async () => {
		const rule = await createRule({ anchor: '2034-03-01' });
		const results = await Promise.all(Array.from({ length: 5 }, () => run('2034-03-01T12:00:00Z')));
		expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(1);
		await Promise.all([cron(), cron(), run('2034-03-01T12:00:00Z')]);
		expect(await instancesOf(rule.id)).toHaveLength(1);
	});

	it('counts the Berlin day at both clock changes, with lead time 0', async () => {
		// Summer time starts on 31 March 2030: the Berlin 1 April begins at 22:00 UTC.
		const spring = await createRule({ anchor: '2030-04-01' });
		await run('2030-03-31T21:59:00Z');
		expect(await instancesOf(spring.id)).toEqual([]);
		await run('2030-03-31T22:00:00Z');
		expect((await instancesOf(spring.id)).map((ticket) => dateOf(ticket.due))).toEqual(['2030-04-01']);

		// Summer time ends on 27 October 2030: the Berlin 28 October begins at 23:00 UTC.
		const autumn = await createRule({ anchor: '2030-10-28' });
		await run('2030-10-27T22:00:00Z');
		await run('2030-10-27T22:59:00Z');
		expect(await instancesOf(autumn.id)).toEqual([]);
		await run('2030-10-27T23:00:00Z');
		expect((await instancesOf(autumn.id)).map((ticket) => dateOf(ticket.due))).toEqual(['2030-10-28']);
	});
});

describe('several weekdays with an open instance (plan OR-1)', () => {
	const MON_WED_FRI = { freq: 'weekly', weekdays: ['MO', 'WE', 'FR'], anchor: '2037-06-01' };

	it('waits for the open Monday, then catches up to the latest date only', async () => {
		const rule = await createRule({ ...MON_WED_FRI, lead_days: 0 });
		expect((await run('2037-06-01T10:00:00Z')).created).toBe(1);
		const [monday] = await instancesOf(rule.id);
		expect(dateOf(monday.due)).toBe('2037-06-01');
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe('2037-06-03');

		// Wednesday and Saturday with the Monday still open: nothing new, the date waits.
		expect((await run('2037-06-03T10:00:00Z')).created).toBe(0);
		expect((await run('2037-06-06T10:00:00Z')).created).toBe(0);
		expect(await instancesOf(rule.id)).toHaveLength(1);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe('2037-06-03');

		// Done (with the real clock nothing is due yet); on Saturday one ticket for Friday, no stack.
		await tickets().update(monday.id, { status: 'done' });
		expect(await openOf(rule.id)).toEqual([]);
		expect((await run('2037-06-06T10:00:00Z')).created).toBe(1);
		const open = await openOf(rule.id);
		expect(open.map((ticket) => dateOf(ticket.due))).toEqual(['2037-06-05']);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe('2037-06-08');
	});

	it('shows the next weekday within the lead time only after the open one is done', async () => {
		const rule = await createRule({ ...MON_WED_FRI, lead_days: 2 });
		// Saturday before: two days ahead of Monday.
		expect((await run('2037-05-30T10:00:00Z')).created).toBe(1);
		const [monday] = await instancesOf(rule.id);
		expect(dateOf(monday.due)).toBe('2037-06-01');

		// Monday is two days ahead of Wednesday, but the Monday ticket is open.
		expect((await run('2037-06-01T10:00:00Z')).created).toBe(0);
		await tickets().update(monday.id, { status: 'done' });
		expect((await run('2037-06-01T10:00:00Z')).created).toBe(1);
		expect((await openOf(rule.id)).map((ticket) => dateOf(ticket.due))).toEqual(['2037-06-03']);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe('2037-06-05');
	});
});

describe('"Jeden Termin einzeln anlegen" (plan OR-5, ADR-0022 addendum 2)', () => {
	const MON_WED_FRI = { freq: 'weekly', weekdays: ['MO', 'WE', 'FR'], anchor: '2037-06-01' };
	const dues = (list) => list.map((ticket) => dateOf(ticket.due)).sort();
	const occurrences = (list) => list.map((ticket) => dateOf(ticket.occurrence)).sort();

	async function refusal(promise) {
		try {
			await promise;
		} catch (error) {
			return error;
		}
		throw new Error('expected a refusal');
	}

	it('gives every weekday its own ticket while earlier ones are still open, never one twice', async () => {
		const rule = await createRule({ ...MON_WED_FRI, lead_days: 0, each_occurrence: true });
		expect(rule.each_occurrence).toBe(true);
		expect((await run('2037-06-01T10:00:00Z')).tickets).toBe(1);
		// Wednesday with the Monday open: the Wednesday comes anyway.
		expect((await run('2037-06-03T10:00:00Z')).tickets).toBe(1);
		const open = await openOf(rule.id);
		expect(dues(open)).toEqual(['2037-06-01', '2037-06-03']);
		expect(occurrences(open)).toEqual(['2037-06-01', '2037-06-03']);

		// The PC was off on Friday: on Saturday the Friday comes, as a ticket of its own.
		expect((await run('2037-06-06T10:00:00Z')).tickets).toBe(1);
		expect(dues(await openOf(rule.id))).toEqual(['2037-06-01', '2037-06-03', '2037-06-05']);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe('2037-06-08');
		expect((await run('2037-06-06T10:00:00Z')).tickets).toBe(0);

		// Parallel runs and the cron job a week later: Monday and Wednesday exactly once.
		const results = await Promise.all(Array.from({ length: 5 }, () => run('2037-06-10T10:00:00Z')));
		await cron();
		expect(results.reduce((sum, result) => sum + result.tickets, 0)).toBe(2);
		const all = await instancesOf(rule.id);
		expect(dues(all)).toEqual(['2037-06-01', '2037-06-03', '2037-06-05', '2037-06-08', '2037-06-10']);
		expect(new Set(occurrences(all)).size).toBe(5);
		// One timestamp in created and updated of each of them (ADR-0022 addendum, flake guard).
		expect(all.every((ticket) => ticket.updated === ticket.created)).toBe(true);
	});

	it('catches up one ticket per missed date after a gap, at most 20 per run, with a hint', async () => {
		const rule = await createRule({ freq: 'daily', anchor: '2038-01-01', lead_days: 0, each_occurrence: true });
		const first = await run('2038-01-26T10:00:00Z');
		expect(first).toMatchObject({ created: 1, tickets: 20 });
		let stored = await ruleOf(rule.id);
		expect(dateOf(stored.next_due)).toBe('2038-01-21');
		expect(stored.last_hint).toBe(
			'Viele Termine auf einmal: 20 Tickets angelegt, die übrigen folgen beim nächsten Lauf (stündlich).'
		);
		expect(dues(await openOf(rule.id))[19]).toBe('2038-01-20');

		// The next run brings the rest and clears the hint.
		expect((await run('2038-01-26T11:07:00Z')).tickets).toBe(6);
		stored = await ruleOf(rule.id);
		expect(dateOf(stored.next_due)).toBe('2038-01-27');
		expect(stored.last_hint).toBe('');
		const open = await openOf(rule.id);
		expect(open).toHaveLength(26);
		expect(dues(open)[25]).toBe('2038-01-26');
	});

	it('reopens a ticket freely: the other open tickets stay and nothing is removed', async () => {
		const rule = await createRule({ ...MON_WED_FRI, anchor: '2037-07-06', lead_days: 0, each_occurrence: true });
		await run('2037-07-10T10:00:00Z');
		const open = await openOf(rule.id);
		expect(dues(open)).toEqual(['2037-07-06', '2037-07-08', '2037-07-10']);
		const monday = open.find((ticket) => dateOf(ticket.due) === '2037-07-06');

		await tickets().update(monday.id, { status: 'done' });
		const reopened = await tickets().update(monday.id, { status: 'open' });
		expect(reopened.status).toBe('open');
		expect(dues(await openOf(rule.id))).toEqual(['2037-07-06', '2037-07-08', '2037-07-10']);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe('2037-07-13');
	});

	it('undoes an untouched follow-up of before the switch, and refuses once it was edited', async () => {
		for (const touch of [false, true]) {
			const anchor = touch ? '2039-04-01' : '2039-03-01';
			const rule = await createRule({ freq: 'daily', anchor, lead_days: 0 });
			await run(`${anchor}T10:00:00Z`);
			const [first] = await instancesOf(rule.id);
			await tickets().update(first.id, { status: 'done' });
			await run(`${anchor.slice(0, 8)}02T10:00:00Z`);
			const followUp = (await openOf(rule.id))[0];
			expect(followUp.occurrence).toBe('');
			if (touch) await tickets().update(followUp.id, { title: 'Schon bearbeitet' });

			// Switched on now: both have no date of the series, so the index still sees them as one.
			await rules().update(rule.id, { each_occurrence: true });
			if (touch) {
				const error = await refusal(tickets().update(first.id, { status: 'open' }));
				expect(error.response.data.status).toMatchObject({
					code: 'validation_recurrence_open_instance',
					params: { key: followUp.key, ticket: followUp.id }
				});
			} else {
				await tickets().update(first.id, { status: 'open' });
				expect((await openOf(rule.id)).map((ticket) => ticket.id)).toEqual([first.id]);
				// next_due stays with each date its own ticket.
				expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(`${anchor.slice(0, 8)}03`);
			}
		}
	});

	it('refuses to reopen once the switch is off again and another ticket is open', async () => {
		const rule = await createRule({ ...MON_WED_FRI, anchor: '2037-08-03', lead_days: 0, each_occurrence: true });
		await run('2037-08-05T10:00:00Z');
		const open = await openOf(rule.id);
		const monday = open.find((ticket) => dateOf(ticket.due) === '2037-08-03');
		const wednesday = open.find((ticket) => dateOf(ticket.due) === '2037-08-05');
		await rules().update(rule.id, { each_occurrence: false });

		await tickets().update(monday.id, { status: 'done' });
		const error = await refusal(tickets().update(monday.id, { status: 'open' }));
		expect(error.response.data.status.code).toBe('validation_recurrence_open_instance');
		expect(error.response.data.status.params.key).toBe(wednesday.key);
		// One open instance per rule again: Friday waits for Wednesday.
		expect((await run('2037-08-07T10:00:00Z')).tickets).toBe(0);
	});

	it('counts a new rhythm from the latest date of the series, not from a due date moved back', async () => {
		const rule = await createRule({ ...MON_WED_FRI, anchor: '2037-09-07', lead_days: 0, each_occurrence: true });
		await run('2037-09-12T10:00:00Z');
		const friday = (await openOf(rule.id)).find((ticket) => dateOf(ticket.due) === '2037-09-11');
		await tickets().update(friday.id, { due: '2037-08-20' });
		const changed = await rules().update(rule.id, { weekdays: ['MO'] });
		expect(dateOf(changed.next_due)).toBe('2037-09-14');
	});

	it('is only for a fixed rhythm', async () => {
		const error = await refusal(
			createRule({ mode: 'after_completion', freq: 'daily', interval: 2, anchor: today(), each_occurrence: true })
		);
		expect(error.status).toBe(400);
		expect(error.response.data.each_occurrence.code).toBe('validation_recurrence_each_mode');
		const rule = await createRule({ ...MON_WED_FRI, anchor: '2037-10-05', each_occurrence: true });
		const change = await refusal(rules().update(rule.id, { mode: 'after_completion', weekdays: [] }));
		expect(change.response.data.each_occurrence.code).toBe('validation_recurrence_each_mode');
	});

	it('keeps the date of the series in the hands of the server', async () => {
		const own = await tickets().create({ owner: owner.id, title: 'Eigen', occurrence: '2037-01-01' });
		expect(own.occurrence).toBe('');
		const rule = await createRule({ ...MON_WED_FRI, anchor: '2037-11-02', lead_days: 0, each_occurrence: true });
		await run('2037-11-02T10:00:00Z');
		const [instance] = await openOf(rule.id);
		const edited = await tickets().update(instance.id, { occurrence: '2037-12-24', title: 'Neu' });
		expect(dateOf(edited.occurrence)).toBe('2037-11-02');
		const released = await tickets().update(instance.id, { recurrence: '' });
		expect(released.occurrence).toBe('');
	});
});

describe('completing, reopening and releasing instances (ADR-0023 sections 2, 3 and 6)', () => {
	it('fixes the next date on completion and shows the follow-up when it is within the lead time', async () => {
		const rule = await createRule({ mode: 'after_completion', freq: 'daily', interval: 2, lead_days: 3, anchor: today() });
		const [first] = await instancesOf(rule.id);
		expect(dateOf(first.due)).toBe(today());

		await tickets().update(first.id, { status: 'done' });
		const all = await instancesOf(rule.id);
		expect(all).toHaveLength(2);
		const followUp = all.find((ticket) => ticket.id !== first.id);
		expect(followUp.status).toBe('open');
		expect(dateOf(followUp.due)).toBe(addDays(today(), 2));
		expect((await ruleOf(rule.id)).next_due).toBe('');
	});

	it('only fixes the date when the follow-up is still ahead of its lead time', async () => {
		const rule = await createRule({ mode: 'after_completion', freq: 'daily', interval: 10, lead_days: 3, anchor: today() });
		const [first] = await instancesOf(rule.id);
		await tickets().update(first.id, { status: 'done' });
		expect(await openOf(rule.id)).toEqual([]);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(addDays(today(), 10));
	});

	it('removes an untouched follow-up when the instance is reopened (after completion)', async () => {
		const rule = await createRule({ mode: 'after_completion', freq: 'daily', interval: 1, lead_days: 3, anchor: today() });
		const [first] = await instancesOf(rule.id);
		await tickets().update(first.id, { status: 'done' });
		expect(await instancesOf(rule.id)).toHaveLength(2);

		const reopened = await tickets().update(first.id, { status: 'open' });
		expect(reopened.status).toBe('open');
		expect((await instancesOf(rule.id)).map((ticket) => ticket.id)).toEqual([first.id]);
		expect((await ruleOf(rule.id)).next_due).toBe('');
	});

	// PocketBase reads the clock once per autodate field; for about one ticket in 200 created and
	// updated differed by a millisecond, and reopening then took the follow-up for edited.
	it('writes one timestamp into created and updated of every generated ticket', async () => {
		const rule = await createRule({ mode: 'after_completion', freq: 'daily', interval: 1, lead_days: 3, anchor: today() });
		const differing = [];
		const start = Date.now();
		for (let round = 0; round < 60; round += 1) {
			const [open] = await openOf(rule.id);
			const created = Date.parse(open.created.replace(' ', 'T'));
			expect(created).toBeGreaterThanOrEqual(start - 1_000);
			expect(created).toBeLessThanOrEqual(Date.now());
			if (open.updated !== open.created) differing.push([open.created, open.updated]);
			await tickets().update(open.id, { status: 'done' });
		}
		expect(differing).toEqual([]);
		expect(await instancesOf(rule.id)).toHaveLength(61);
	}, 60_000);

	it('removes an untouched follow-up when the instance is reopened (calendar)', async () => {
		const ticket = await tickets().create({ owner: owner.id, title: 'Täglich', due: today() });
		const rule = await createRule({ lead_days: 3, ticket: ticket.id });
		expect(dateOf(rule.next_due)).toBe(addDays(today(), 1));
		await tickets().update(ticket.id, { status: 'done' });
		const followUps = (await instancesOf(rule.id)).filter((item) => item.id !== ticket.id);
		expect(followUps.map((item) => dateOf(item.due))).toEqual([addDays(today(), 1)]);

		await tickets().update(ticket.id, { status: 'in_progress' });
		expect((await instancesOf(rule.id)).map((item) => item.id)).toEqual([ticket.id]);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(addDays(today(), 1));
	});

	it('refuses to reopen when the follow-up was edited or commented', async () => {
		for (const touch of ['edit', 'comment']) {
			const rule = await createRule({ mode: 'after_completion', freq: 'daily', interval: 1, lead_days: 3, anchor: today() });
			const [first] = await instancesOf(rule.id);
			await tickets().update(first.id, { status: 'done' });
			const followUp = (await instancesOf(rule.id)).find((item) => item.id !== first.id);
			if (touch === 'edit') {
				await tickets().update(followUp.id, { title: 'Schon bearbeitet' });
			} else {
				await owner.pb.collection('comments').create({ ticket: followUp.id, author: owner.id, body: 'Notiz' });
			}
			let error;
			try {
				await tickets().update(first.id, { status: 'open' });
			} catch (caught) {
				error = caught;
			}
			expect(error?.status, touch).toBe(400);
			const field = error.response.data.status;
			expect(field.code).toBe('validation_recurrence_open_instance');
			expect(field.message).toBe(
				`Von dieser Serie ist schon ${followUp.key} offen. Erledige es zuerst oder löse ein Ticket aus der Serie.`
			);
			expect(field.params).toMatchObject({ key: followUp.key, ticket: followUp.id });
			expect((await tickets().getOne(first.id)).status).toBe('done');
			expect(await openOf(rule.id)).toHaveLength(1);
		}
	});

	it('allows reopening without a follow-up; an after-completion rule waits for it again', async () => {
		const rule = await createRule({ mode: 'after_completion', freq: 'daily', interval: 10, lead_days: 3, anchor: today() });
		const [first] = await instancesOf(rule.id);
		await tickets().update(first.id, { status: 'done' });
		await tickets().update(first.id, { status: 'open' });
		expect((await ruleOf(rule.id)).next_due).toBe('');
		expect(await openOf(rule.id)).toHaveLength(1);
	});

	it('creates no replacement at once when the open instance is deleted or released', async () => {
		// After completion: as if done today.
		const completion = await createRule({ mode: 'after_completion', freq: 'daily', interval: 5, lead_days: 3, anchor: today() });
		const [instanceA] = await instancesOf(completion.id);
		await tickets().delete(instanceA.id);
		expect(await instancesOf(completion.id)).toEqual([]);
		expect(dateOf((await ruleOf(completion.id)).next_due)).toBe(addDays(today(), 5));

		// Calendar: the date counts as skipped.
		const ticket = await tickets().create({ owner: owner.id, title: 'Kalender', due: today() });
		const calendar = await createRule({ lead_days: 3, ticket: ticket.id });
		await tickets().delete(ticket.id);
		expect(await instancesOf(calendar.id)).toEqual([]);
		expect((await ruleOf(calendar.id)).next_due).toBe(calendar.next_due);

		// "Aus der Serie lösen": the ticket stays as a normal ticket.
		const released = await createRule({ mode: 'after_completion', freq: 'weekly', interval: 1, lead_days: 3, anchor: today() });
		const [instanceB] = await instancesOf(released.id);
		const plain = await tickets().update(instanceB.id, { recurrence: '' });
		expect(plain.recurrence).toBe('');
		expect(await instancesOf(released.id)).toEqual([]);
		expect(dateOf((await ruleOf(released.id)).next_due)).toBe(addDays(today(), 7));
		expect((await historyOf(instanceB.id)).at(-1)).toMatchObject({ field: 'recurrence', old_value: released.id, new_value: '' });
	});
});

describe('failures (ADR-0022 section 2, ADR-0023 section 8)', () => {
	it('pauses a rule whose project is archived, with a neutral hint and without a ticket', async () => {
		const project = await owner.pb.collection('projects').create({ owner: owner.id, name: 'Alt', code: 'ALTPRJ' });
		const rule = await createRule({ project: project.id, anchor: '2035-06-01' });
		await owner.pb.collection('projects').update(project.id, { archived: true });
		const result = await run('2035-06-01T12:00:00Z');
		expect(result.paused).toBe(1);
		expect(await instancesOf(rule.id)).toEqual([]);
		expect(await ruleOf(rule.id)).toMatchObject({ active: false, last_hint: 'Projekt archiviert – Regel pausiert.' });
	});

	it('pauses a rule of a sub project once its parent is archived (ADR-0034)', async () => {
		const projects = owner.pb.collection('projects');
		const parent = await projects.create({ owner: owner.id, name: 'Haus', code: 'HAUSUP' });
		const child = await projects.create({ owner: owner.id, name: 'Garten', code: 'GARTUP', parent: parent.id });
		const rule = await createRule({ project: child.id, anchor: '2036-06-01' });
		await projects.update(parent.id, { archived: true });
		const result = await run('2036-06-01T12:00:00Z');
		expect(result.paused).toBe(1);
		expect(await instancesOf(rule.id)).toEqual([]);
		expect(await ruleOf(rule.id)).toMatchObject({ active: false, last_hint: 'Projekt archiviert – Regel pausiert.' });
	});

	it('rolls a failed ticket back completely and keeps the other rules running', async () => {
		const counterKey = `u:${owner.id}:TASK`;
		const counter = async () => {
			const found = await superuser
				.collection('ticket_counters')
				.getFullList({ filter: superuser.filter('key = {:key}', { key: counterKey }) });
			return found.length === 0 ? 0 : found[0].value;
		};
		// History fails inside the nested transaction of the ticket hook; the insert fails after the key.
		const history = await createRule({ title: FAIL_HISTORY, anchor: '2036-02-01' });
		const insert = await createRule({ title: FAIL_TICKET_INSERT, anchor: '2036-02-01' });
		const good = await createRule({ title: 'Läuft', anchor: '2036-02-01' });
		const before = await counter();

		const result = await run('2036-02-01T12:00:00Z');
		expect(result).toMatchObject({ checked: 3, created: 1, failed: 2 });
		for (const failed of [history, insert]) {
			expect(await instancesOf(failed.id)).toEqual([]);
			const stored = await ruleOf(failed.id);
			expect(stored.active).toBe(true);
			expect(dateOf(stored.next_due)).toBe('2036-02-01');
			expect(stored.last_hint).toMatch(/^Ticket nicht erzeugt: /);
		}
		// Only the good ticket used a number; its key and history came in the same commit.
		expect(await counter()).toBe(before + 1);
		const [ticket] = await instancesOf(good.id);
		expect(ticket.key).toBe(`TASK-${before + 1}`);
		expect((await historyOf(ticket.id)).map((entry) => entry.field)).toEqual(['created']);
		expect(dateOf((await ruleOf(good.id)).next_due)).toBe('2036-02-02');
	});
});
