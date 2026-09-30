// Sub-tickets (ADR-0033; plan Unteraufgaben, package UA-1): completing a ticket whose open
// sub-tickets block it needs `force` or `complete_children`, the latter completes them in the same
// transaction with their history; follow-up tickets of a series have no parent. The one-level
// guard, the scope of the parent and deleting a parent are covered in ticket-guards.test.mjs.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf } from '../support/api.mjs';
import { FAIL_CHILD_DONE, createOwner, createScenario, historyOf } from '../support/scenario.mjs';

let s;
/** Rules created here; they are paused afterwards, so no later run of the cron touches them. */
const rulesToPause = [];

beforeAll(async () => {
	s = await createScenario();
});

afterAll(async () => {
	for (const rule of rulesToPause) {
		await s.superuser.collection('recurrence_rules').update(rule, { active: false });
	}
});

const openChildrenError = { status: 400, codes: { status: 'validation_parent_open_children' } };

/** The error data of a rejected request (the field errors with code, message and params). */
async function errorDataOf(promise) {
	try {
		await promise;
	} catch (error) {
		return error.response?.data ?? {};
	}
	throw new Error('Expected the request to be rejected, but it succeeded.');
}

describe('completing a ticket with open sub-tickets (ADR-0033 section 2)', () => {
	it('refuses without force or complete_children, names the blocking ones and changes nothing', async () => {
		const owner = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const parent = await owner.ticket();
		const blocking = await owner.ticket({ parent: parent.id });
		const free = await owner.ticket({ parent: parent.id, blocks_parent: false });
		await owner.ticket({ parent: parent.id, status: 'done' });

		expect(await rejectionOf(tickets.update(parent.id, { status: 'done' }))).toEqual(openChildrenError);
		const data = await errorDataOf(tickets.update(parent.id, { status: 'done' }));
		expect(data.status.params).toEqual({ count: 1, keys: [blocking.key] });

		const stored = await tickets.getOne(parent.id);
		expect(stored).toMatchObject({ status: 'open', completed_at: '', updated: parent.updated });
		expect((await historyOf(s.superuser, parent.id)).map((entry) => entry.field)).toEqual(['created']);
		expect((await tickets.getOne(free.id)).status).toBe('open');
	});

	it('names at most five keys and counts them all', async () => {
		const owner = await createOwner(s.superuser);
		const parent = await owner.ticket();
		const children = [];
		for (let index = 0; index < 6; index++) children.push(await owner.ticket({ parent: parent.id }));

		const data = await errorDataOf(owner.client.collection('tickets').update(parent.id, { status: 'done' }));
		expect(data.status.params).toEqual({ count: 6, keys: children.slice(0, 5).map((child) => child.key) });
	});

	it('completes a ticket whose sub-tickets do not block it or are done', async () => {
		const owner = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const parent = await owner.ticket();
		await owner.ticket({ parent: parent.id, blocks_parent: false });
		await owner.ticket({ parent: parent.id, status: 'done' });

		expect((await tickets.update(parent.id, { status: 'done' })).status).toBe('done');
	});

	it('completes it anyway with force; the sub-tickets stay open and nothing is stored', async () => {
		const owner = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id });

		const saved = await tickets.update(parent.id, { status: 'done', force: true });
		expect(saved.status).toBe('done');
		expect(saved.completed_at).not.toBe('');
		expect(saved).not.toHaveProperty('force');
		expect(await tickets.getOne(parent.id)).not.toHaveProperty('force');
		expect((await tickets.getOne(child.id)).status).toBe('open');
	});

	it('completes the blocking sub-tickets in the same transaction with complete_children', async () => {
		const owner = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const parent = await owner.ticket();
		const first = await owner.ticket({ parent: parent.id, status: 'in_progress' });
		const second = await owner.ticket({ parent: parent.id, status: 'waiting' });
		const free = await owner.ticket({ parent: parent.id, blocks_parent: false });

		const saved = await tickets.update(parent.id, { status: 'done', complete_children: 'true' });
		expect(saved.status).toBe('done');
		expect(saved).not.toHaveProperty('complete_children');

		for (const [child, before] of [
			[first, 'in_progress'],
			[second, 'waiting']
		]) {
			const stored = await tickets.getOne(child.id);
			expect(stored.status).toBe('done');
			expect(stored.completed_at).not.toBe('');
			const entry = (await historyOf(s.superuser, child.id)).find((item) => item.field === 'status');
			expect(entry).toMatchObject({ old_value: before, new_value: 'done', user: owner.id });
		}
		expect((await tickets.getOne(free.id)).status).toBe('open');
	});

	it('rolls the whole completion back when a sub-ticket cannot be completed', async () => {
		const owner = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const parent = await owner.ticket();
		const first = await owner.ticket({ parent: parent.id });
		const failing = await owner.ticket({ parent: parent.id, title: FAIL_CHILD_DONE });

		const rejection = await rejectionOf(tickets.update(parent.id, { status: 'done', complete_children: true }));
		expect(rejection.status).toBe(400);

		expect((await tickets.getOne(parent.id)).status).toBe('open');
		expect((await tickets.getOne(first.id)).status).toBe('open');
		expect((await tickets.getOne(failing.id)).status).toBe('open');
		expect((await historyOf(s.superuser, first.id)).map((entry) => entry.field)).toEqual(['created']);
	});

	it('leaves reopening and other changes of a done ticket alone', async () => {
		const owner = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const parent = await owner.ticket();
		await tickets.update(parent.id, { status: 'done' });
		await owner.ticket({ parent: parent.id });

		expect((await tickets.update(parent.id, { title: 'Umbenannt' })).status).toBe('done');
		expect((await tickets.update(parent.id, { status: 'open' })).status).toBe('open');
		expect(await rejectionOf(tickets.update(parent.id, { status: 'done' }))).toEqual(openChildrenError);
	});
});

describe('series and sub-tickets (ADR-0033 section 3)', () => {
	/** "Wiederholen…" on a sub-ticket: one day after completion, the follow-up within the lead time. */
	async function childInSeries(owner) {
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id, title: `Serie ${parent.id}` });
		const rule = await owner.client.collection('recurrence_rules').create({
			owner: owner.id,
			title: child.title,
			mode: 'after_completion',
			freq: 'daily',
			interval: 1,
			lead_days: 3,
			initial_status: 'open',
			ticket: child.id
		});
		rulesToPause.push(rule.id);
		return { parent, child, rule };
	}

	const openOf = (owner, rule) =>
		owner.client.collection('tickets').getFullList({
			filter: owner.client.filter("recurrence = {:rule} && status != 'done'", { rule: rule.id })
		});

	it('gives the follow-up of a sub-ticket no parent', async () => {
		const owner = await createOwner(s.superuser);
		const { child, rule } = await childInSeries(owner);
		expect((await owner.client.collection('tickets').getOne(child.id)).recurrence).toBe(rule.id);

		await owner.client.collection('tickets').update(child.id, { status: 'done' });

		const [followUp] = await openOf(owner, rule);
		expect(followUp).toMatchObject({ parent: '', blocks_parent: true, title: child.title });
	});

	it('creates the follow-up of a sub-ticket completed with its parent, again without a parent', async () => {
		const owner = await createOwner(s.superuser);
		const { parent, child, rule } = await childInSeries(owner);

		await owner.client.collection('tickets').update(parent.id, { status: 'done', complete_children: true });

		expect((await owner.client.collection('tickets').getOne(child.id)).status).toBe('done');
		const followUps = await openOf(owner, rule);
		expect(followUps).toHaveLength(1);
		expect(followUps[0].parent).toBe('');
	});
});
