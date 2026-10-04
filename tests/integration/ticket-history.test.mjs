// Ticket history (E1 plan, package 6; CLAUDE.md section 5; OF-4 variant A, OF-12, OF-15).
// History entries are written in the transaction of the ticket hook: a failing entry rolls back
// the ticket change, including a newly drawn key.

import { beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf, statusOf } from '../support/api.mjs';
import {
	FAIL_HISTORY,
	counterValue,
	createOwner,
	createScenario,
	historyOf,
	scopeOf,
	uniqueCode,
	uniqueSuffix
} from '../support/scenario.mjs';

let s;

beforeAll(async () => {
	s = await createScenario();
});

/** Entries as { field, old_value, new_value, user }, sorted by field for stable comparison. */
async function entries(ticketId) {
	const list = await historyOf(s.superuser, ticketId);
	return list
		.map(({ field, old_value, new_value, user }) => ({ field, old_value, new_value, user }))
		.sort((x, y) => x.field.localeCompare(y.field));
}

describe('ticket history', () => {
	it('records the creation with key and acting user', async () => {
		const owner = await createOwner(s.superuser);
		const ticket = await owner.ticket();
		expect(await entries(ticket.id)).toEqual([
			{ field: 'created', old_value: '', new_value: 'TASK-1', user: owner.id }
		]);
	});

	it('writes one entry per changed field and none for unchanged ones', async () => {
		const owner = await createOwner(s.superuser);
		const [tagA, tagB] = [await owner.tag(`a-${uniqueSuffix()}`), await owner.tag(`b-${uniqueSuffix()}`)];
		const ticket = await owner.ticket({
			title: 'Alt',
			description: 'Text',
			priority: 'low',
			tags: [tagA.id, tagB.id]
		});
		const tickets = owner.client.collection('tickets');

		await tickets.update(ticket.id, {
			title: 'Neu',
			description: 'Text',
			status: 'done',
			priority: 'low',
			due: '2026-10-01',
			tags: [tagB.id, tagA.id],
			blocks_parent: false
		});
		const updates = (await entries(ticket.id)).filter((entry) => entry.field !== 'created');
		expect(updates).toEqual([
			{ field: 'blocks_parent', old_value: 'true', new_value: 'false', user: owner.id },
			{ field: 'due', old_value: '', new_value: '2026-10-01 00:00:00.000Z', user: owner.id },
			{ field: 'status', old_value: 'open', new_value: 'done', user: owner.id },
			{ field: 'title', old_value: 'Alt', new_value: 'Neu', user: owner.id }
		]);

		await tickets.update(ticket.id, {});
		await tickets.update(ticket.id, { title: 'Neu', tags: [tagA.id, tagB.id] });
		expect(await entries(ticket.id)).toHaveLength(5);

		await tickets.update(ticket.id, { tags: [tagA.id] });
		expect((await entries(ticket.id)).find((entry) => entry.field === 'tags')).toEqual({
			field: 'tags',
			old_value: JSON.stringify([tagA.id, tagB.id].sort()),
			new_value: JSON.stringify([tagA.id]),
			user: owner.id
		});
	});

	it('records the old key when the project changes (package 5 addendum)', async () => {
		const owner = await createOwner(s.superuser);
		const project = await owner.project('ABC');
		const ticket = await owner.ticket();
		await owner.client.collection('tickets').update(ticket.id, { project: project.id });

		const changes = (await entries(ticket.id)).filter((entry) => entry.field !== 'created');
		expect(changes).toEqual([
			{ field: 'key', old_value: 'TASK-1', new_value: 'ABC-1', user: owner.id },
			{ field: 'project', old_value: '', new_value: project.id, user: owner.id }
		]);
	});

	it('records household moves with the new key', async () => {
		// Two private tickets first: the key text then differs from the first key of the household
		// counter (an identical text, e.g. TASK-1 in both scopes, is no key change and not logged).
		// A client moves no ticket through the Record API (scope-guard.pb.js, ADR-0058); the superuser
		// moves it here, so the entries carry no user.
		const tickets = s.a.collection('tickets');
		await tickets.create({ owner: s.ids.a, title: 'Vorlauf' });
		const ticket = await tickets.create({ owner: s.ids.a, title: 'zieht um' });
		const moved = await s.superuser.collection('tickets').update(ticket.id, { household: s.h1.id });
		expect(moved.key).not.toBe(ticket.key);
		const changes = (await entries(ticket.id)).filter((entry) => entry.field !== 'created');
		expect(changes).toEqual([
			{ field: 'household', old_value: '', new_value: s.h1.id, user: '' },
			{ field: 'key', old_value: ticket.key, new_value: moved.key, user: '' }
		]);
		expect(moved.scope).toBe(scopeOf(s.ids.a, s.h1.id));
	});

	it('names the household member who changed the ticket, not the owner', async () => {
		const ticket = await s.a
			.collection('tickets')
			.create({ owner: s.ids.a, household: s.h1.id, title: 'gemeinsam' });
		await s.b.collection('tickets').update(ticket.id, { status: 'in_progress' });
		const status = (await entries(ticket.id)).find((entry) => entry.field === 'status');
		expect(status).toMatchObject({ new_value: 'in_progress', user: s.ids.b });
	});

	it('leaves the user empty for superuser and system changes', async () => {
		const owner = await createOwner(s.superuser);
		const tag = await owner.tag(`weg-${uniqueSuffix()}`);
		const ticket = await owner.ticket({ tags: [tag.id] });

		await s.superuser.collection('tickets').update(ticket.id, { priority: 'high' });
		expect((await entries(ticket.id)).find((entry) => entry.field === 'priority')).toEqual({
			field: 'priority',
			old_value: 'medium',
			new_value: 'high',
			user: ''
		});

		// Deleting a tag removes it from the ticket inside PocketBase (no request, no actor).
		await owner.client.collection('tags').delete(tag.id);
		expect((await owner.client.collection('tickets').getOne(ticket.id)).tags).toEqual([]);
		expect((await entries(ticket.id)).find((entry) => entry.field === 'tags')).toEqual({
			field: 'tags',
			old_value: JSON.stringify([tag.id]),
			new_value: '',
			user: ''
		});
	});

	it('keeps the actor transient: not settable, not stored, not returned', async () => {
		const owner = await createOwner(s.superuser);
		const other = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const created = await owner.ticket({ '@actor': other.id });
		const updated = await tickets.update(created.id, { title: 'neu', '@actor': other.id });

		for (const record of [
			created,
			updated,
			await tickets.getOne(created.id),
			...(await tickets.getFullList()),
			await s.superuser.collection('tickets').getOne(created.id)
		]) {
			expect(Object.keys(record)).not.toContain('@actor');
		}
		const users = (await entries(created.id)).map((entry) => entry.user);
		expect(users).toEqual([owner.id, owner.id]);
	});

	it('is read-only through the API', async () => {
		const owner = await createOwner(s.superuser);
		const ticket = await owner.ticket();
		const [entry] = await historyOf(s.superuser, ticket.id);
		const history = owner.client.collection('ticket_history');
		expect((await history.getOne(entry.id)).field).toBe('created');
		expect(await statusOf(history.create({ ticket: ticket.id, field: 'title' }))).toBe(403);
		expect(await statusOf(history.update(entry.id, { new_value: 'x' }))).toBe(403);
		expect(await statusOf(history.delete(entry.id))).toBe(403);
	});
});

describe('history failures roll back the ticket change (OF-15)', () => {
	it('rolls back an update including its new key', async () => {
		const owner = await createOwner(s.superuser);
		const project = await owner.project(uniqueCode());
		const ticket = await owner.ticket({ title: 'bleibt' });
		const tickets = owner.client.collection('tickets');
		const historyBefore = await entries(ticket.id);

		expect(
			await statusOf(
				tickets.update(ticket.id, { title: FAIL_HISTORY, project: project.id, status: 'done' })
			)
		).toBe(400);

		const after = await tickets.getOne(ticket.id);
		expect(after).toMatchObject({
			title: 'bleibt',
			key: 'TASK-1',
			project: '',
			status: 'open',
			completed_at: ''
		});
		expect(await counterValue(s.superuser, `u:${owner.id}:${project.id}`)).toBe(0);
		expect(await entries(ticket.id)).toEqual(historyBefore);

		expect((await tickets.update(ticket.id, { project: project.id })).key).toBe(`${project.code}-1`);
	});

	it('rolls back a creation including its counter', async () => {
		const owner = await createOwner(s.superuser);
		await owner.ticket();
		expect(await rejectionOf(owner.ticket({ title: FAIL_HISTORY }))).toMatchObject({ status: 400 });

		const titles = (await owner.client.collection('tickets').getFullList()).map((t) => t.title);
		expect(titles).not.toContain(FAIL_HISTORY);
		expect(await counterValue(s.superuser, `u:${owner.id}:TASK`)).toBe(1);
		expect((await owner.ticket()).key).toBe('TASK-2');
	});
});
