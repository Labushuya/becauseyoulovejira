// API rules with positive and negative cases for several users (E1 plan, package 4;
// ADR-0004 section 4). Scenario: A and B are members of H1, C is the only member of H2.
//
// PocketBase behaviour when a rule does not match (documented in docs/plan/e1.md):
// list -> 200 with the matching records only, view/update/delete -> 404,
// create -> 400, rule null (locked) -> 403 for everyone except superusers.

import { beforeAll, describe, expect, it } from 'vitest';
import { createAppUser, statusOf, userClient } from '../support/api.mjs';
import { createScenario, ownedPayload, uniqueSuffix } from '../support/scenario.mjs';

async function listIds(client, collection) {
	const records = await client.collection(collection).getFullList({ batch: 500 });
	return records.map((record) => record.id);
}

const OWNED_COLLECTIONS = ['projects', 'tags', 'recurrence_rules', 'tickets', 'inbox_items'];

let s;

beforeAll(async () => {
	s = await createScenario();
});

describe.each(OWNED_COLLECTIONS)('%s', (collection) => {
	/** @type {Record<string, any>} */
	let rec;

	const create = (client, ownerId, householdId) =>
		client.collection(collection).create(ownedPayload(collection, ownerId, householdId));

	beforeAll(async () => {
		rec = {
			aPrivate: await create(s.a, s.ids.a),
			aH1: await create(s.a, s.ids.a, s.h1.id),
			bPrivate: await create(s.b, s.ids.b),
			cH2: await create(s.c, s.ids.c, s.h2.id)
		};
	});

	it('lists own private and household records only', async () => {
		const a = await listIds(s.a, collection);
		expect(a).toEqual(expect.arrayContaining([rec.aPrivate.id, rec.aH1.id]));
		expect(a).not.toContain(rec.bPrivate.id);
		expect(a).not.toContain(rec.cH2.id);

		const b = await listIds(s.b, collection);
		expect(b).toEqual(expect.arrayContaining([rec.bPrivate.id, rec.aH1.id]));
		expect(b).not.toContain(rec.aPrivate.id);
		expect(b).not.toContain(rec.cH2.id);

		const c = await listIds(s.c, collection);
		expect(c).toContain(rec.cH2.id);
		expect(c).not.toContain(rec.aPrivate.id);
		expect(c).not.toContain(rec.aH1.id);
	});

	it('returns 404 on view, update and delete of records outside the own scopes', async () => {
		const other = s.b.collection(collection);
		// Inbox items cannot be deleted through the API at all (deleteRule null, ADR-0014 addendum
		// of 2026-10-01): every app user gets 403, which says nothing about the record either.
		const deleteRefused = collection === 'inbox_items' ? 403 : 404;
		expect(await statusOf(other.getOne(rec.aPrivate.id))).toBe(404);
		expect(await statusOf(other.update(rec.aPrivate.id, {}))).toBe(404);
		expect(await statusOf(other.delete(rec.aPrivate.id))).toBe(deleteRefused);
		expect(await statusOf(s.c.collection(collection).getOne(rec.aH1.id))).toBe(404);
		expect(await statusOf(s.c.collection(collection).delete(rec.aH1.id))).toBe(deleteRefused);
		expect(await statusOf(s.a.collection(collection).getOne(rec.cH2.id))).toBe(404);
		expect(await statusOf(s.a.collection(collection).update(rec.cH2.id, {}))).toBe(404);

		const stillThere = await s.superuser.collection(collection).getOne(rec.aPrivate.id);
		expect(stillThere.id).toBe(rec.aPrivate.id);
	});

	it('lets household members view and update household records', async () => {
		expect((await s.b.collection(collection).getOne(rec.aH1.id)).id).toBe(rec.aH1.id);
		expect(await statusOf(s.b.collection(collection).update(rec.aH1.id, {}))).toBe(200);
	});

	it('rejects anonymous access', async () => {
		expect(await listIds(s.anonymous, collection)).toEqual([]);
		expect(await statusOf(s.anonymous.collection(collection).getOne(rec.aPrivate.id))).toBe(404);
		expect(
			await statusOf(s.anonymous.collection(collection).create(ownedPayload(collection, s.ids.a)))
		).toBe(400);
	});

	it('rejects create with a foreign owner', async () => {
		expect(await statusOf(create(s.b, s.ids.a))).toBe(400);
		expect(await statusOf(create(s.b, s.ids.a, s.h1.id))).toBe(400);
	});

	it('rejects create in a household without membership', async () => {
		expect(await statusOf(create(s.a, s.ids.a, s.h2.id))).toBe(400);
		expect(await statusOf(create(s.c, s.ids.c, s.h1.id))).toBe(400);
		expect(await statusOf(create(s.b, s.ids.b, s.h1.id))).toBe(200);
	});

	it('rejects updates that change the owner', async () => {
		expect(await statusOf(s.a.collection(collection).update(rec.aPrivate.id, { owner: s.ids.b }))).toBe(
			404
		);
		expect(await statusOf(s.b.collection(collection).update(rec.aH1.id, { owner: s.ids.b }))).toBe(
			404
		);
		expect(
			await statusOf(s.a.collection(collection).update(rec.aPrivate.id, { owner: s.ids.a }))
		).toBe(200);
		const record = await s.superuser.collection(collection).getOne(rec.aPrivate.id);
		expect(record.owner).toBe(s.ids.a);
	});

	it('allows moving into own households only', async () => {
		const own = s.a.collection(collection);
		expect(await statusOf(own.update(rec.aPrivate.id, { household: s.h2.id }))).toBe(404);
		const moved = await own.update(rec.aPrivate.id, { household: s.h1.id });
		expect(moved.household).toBe(s.h1.id);
		const back = await own.update(rec.aPrivate.id, { household: '' });
		expect(back.household).toBe('');
	});

	it('lets a member move a household record between own households', async () => {
		// Needs a separate join alias for the submitted household (see the migration). A fresh
		// user D (member of H1 and H3) keeps the membership lists of A, B and C unchanged.
		const userD = await createAppUser(s.superuser);
		const h3 = await s.superuser.collection('households').create({ name: `H3 ${uniqueSuffix()}` });
		const memberships = s.superuser.collection('household_members');
		await memberships.create({ household: s.h1.id, user: userD.record.id, role: 'member' });
		await memberships.create({ household: h3.id, user: userD.record.id, role: 'member' });
		const d = (await userClient(userD)).collection(collection);

		const record = await create(s.a, s.ids.a, s.h1.id);
		const moved = await d.update(record.id, { household: h3.id });
		expect(moved.household).toBe(h3.id);
		expect(moved.owner).toBe(s.ids.a);
		expect(await statusOf(d.update(record.id, { household: s.h2.id }))).toBe(404);
		expect(await statusOf(s.b.collection(collection).getOne(record.id))).toBe(404);
	});

	it('lets the owner update and delete own records', async () => {
		const record = await create(s.a, s.ids.a);
		expect(await statusOf(s.a.collection(collection).update(record.id, {}))).toBe(200);
		if (collection === 'inbox_items') {
			// An inbox item is discarded, never deleted (ADR-0014, addendum of 2026-10-01).
			expect(await statusOf(s.a.collection(collection).delete(record.id))).toBe(403);
			expect((await s.superuser.collection(collection).getOne(record.id)).id).toBe(record.id);
			return;
		}
		expect(await statusOf(s.a.collection(collection).delete(record.id))).toBe(200);
		if (collection === 'tickets') {
			// Deleting moves a ticket to the trash (ADR-0037): hidden for everyone, kept for the trash.
			expect(await statusOf(s.a.collection(collection).getOne(record.id))).toBe(404);
			expect((await s.superuser.collection(collection).getOne(record.id)).deleted_at).not.toBe('');
		} else {
			expect(await statusOf(s.superuser.collection(collection).getOne(record.id))).toBe(404);
		}
	});
});

describe('comments', () => {
	let aTicket;
	let h1Ticket;
	let aComment;
	let aH1Comment;

	const comment = (client, ticket, author) =>
		client.collection('comments').create({ ticket, author, body: `Kommentar ${uniqueSuffix()}` });

	beforeAll(async () => {
		aTicket = await s.a.collection('tickets').create(ownedPayload('tickets', s.ids.a));
		h1Ticket = await s.a.collection('tickets').create(ownedPayload('tickets', s.ids.a, s.h1.id));
		aComment = await comment(s.a, aTicket.id, s.ids.a);
		aH1Comment = await comment(s.a, h1Ticket.id, s.ids.a);
	});

	it('requires author = own ID and access to the ticket on create', async () => {
		expect(await statusOf(comment(s.b, h1Ticket.id, s.ids.b))).toBe(200);
		expect(await statusOf(comment(s.b, h1Ticket.id, s.ids.a))).toBe(400);
		expect(await statusOf(comment(s.b, aTicket.id, s.ids.b))).toBe(400);
		expect(await statusOf(comment(s.c, h1Ticket.id, s.ids.c))).toBe(400);
		expect(await statusOf(comment(s.anonymous, aTicket.id, s.ids.a))).toBe(400);
	});

	it('follows the visibility of the ticket', async () => {
		const b = await listIds(s.b, 'comments');
		expect(b).toContain(aH1Comment.id);
		expect(b).not.toContain(aComment.id);
		expect(await listIds(s.c, 'comments')).not.toContain(aH1Comment.id);
		expect(await statusOf(s.b.collection('comments').getOne(aComment.id))).toBe(404);
		expect(await statusOf(s.c.collection('comments').getOne(aH1Comment.id))).toBe(404);
		expect((await s.b.collection('comments').getOne(aH1Comment.id)).id).toBe(aH1Comment.id);
	});

	it('lets only the author update and delete', async () => {
		const other = s.b.collection('comments');
		expect(await statusOf(other.update(aH1Comment.id, { body: 'fremd' }))).toBe(404);
		expect(await statusOf(other.delete(aH1Comment.id))).toBe(404);
		expect(await statusOf(other.update(aComment.id, { body: 'fremd' }))).toBe(404);

		const own = s.a.collection('comments');
		expect(await statusOf(own.update(aH1Comment.id, { author: s.ids.b }))).toBe(404);
		expect(await statusOf(own.update(aH1Comment.id, { ticket: aTicket.id }))).toBe(404);
		expect((await own.update(aH1Comment.id, { body: 'geändert' })).body).toBe('geändert');

		const temporary = await comment(s.a, h1Ticket.id, s.ids.a);
		expect(await statusOf(own.delete(temporary.id))).toBe(200);
	});
});

describe('ticket_history', () => {
	let aEntry;
	let h1Entry;
	let aTicket;

	beforeAll(async () => {
		aTicket = await s.a.collection('tickets').create(ownedPayload('tickets', s.ids.a));
		const h1Ticket = await s.a
			.collection('tickets')
			.create(ownedPayload('tickets', s.ids.a, s.h1.id));
		const history = s.superuser.collection('ticket_history');
		aEntry = await history.create({ ticket: aTicket.id, field: 'created', user: s.ids.a });
		h1Entry = await history.create({ ticket: h1Ticket.id, field: 'created', user: s.ids.a });
	});

	it('is readable like the ticket', async () => {
		expect(await listIds(s.a, 'ticket_history')).toEqual(
			expect.arrayContaining([aEntry.id, h1Entry.id])
		);
		const b = await listIds(s.b, 'ticket_history');
		expect(b).toContain(h1Entry.id);
		expect(b).not.toContain(aEntry.id);
		expect(await listIds(s.c, 'ticket_history')).not.toContain(h1Entry.id);
		expect(await statusOf(s.b.collection('ticket_history').getOne(aEntry.id))).toBe(404);
	});

	it('cannot be created, updated or deleted through the API', async () => {
		const history = s.a.collection('ticket_history');
		expect(await statusOf(history.create({ ticket: aTicket.id, field: 'title' }))).toBe(403);
		expect(await statusOf(history.update(aEntry.id, { field: 'title' }))).toBe(403);
		expect(await statusOf(history.delete(aEntry.id))).toBe(403);
	});
});

describe('dependencies', () => {
	let aDependency;
	let h1Dependency;
	let tickets;

	beforeAll(async () => {
		const create = (householdId) =>
			s.a.collection('tickets').create(ownedPayload('tickets', s.ids.a, householdId));
		tickets = [await create(), await create(), await create(s.h1.id), await create(s.h1.id)];
		const dependencies = s.superuser.collection('dependencies');
		aDependency = await dependencies.create({
			blocker: tickets[0].id,
			blocked: tickets[1].id,
			owner: s.ids.a
		});
		h1Dependency = await dependencies.create({
			blocker: tickets[2].id,
			blocked: tickets[3].id,
			owner: s.ids.a,
			household: s.h1.id
		});
	});

	it('is readable within the own scopes', async () => {
		expect(await listIds(s.a, 'dependencies')).toEqual(
			expect.arrayContaining([aDependency.id, h1Dependency.id])
		);
		const b = await listIds(s.b, 'dependencies');
		expect(b).toContain(h1Dependency.id);
		expect(b).not.toContain(aDependency.id);
		expect(await listIds(s.c, 'dependencies')).toEqual([]);
		expect(await statusOf(s.b.collection('dependencies').getOne(aDependency.id))).toBe(404);
	});

	it('cannot be written through the API until stage 2', async () => {
		const dependencies = s.a.collection('dependencies');
		expect(
			await statusOf(
				dependencies.create({ blocker: tickets[1].id, blocked: tickets[0].id, owner: s.ids.a })
			)
		).toBe(403);
		expect(await statusOf(dependencies.update(aDependency.id, {}))).toBe(403);
		expect(await statusOf(dependencies.delete(aDependency.id))).toBe(403);
	});
});

describe('ticket_counters', () => {
	it('is locked for every operation, including the owner of the scope', async () => {
		const counter = await s.superuser
			.collection('ticket_counters')
			.create({ key: `test-${uniqueSuffix()}`, value: 3 });
		const counters = s.a.collection('ticket_counters');
		expect(await statusOf(counters.getList())).toBe(403);
		expect(await statusOf(counters.getOne(counter.id))).toBe(403);
		expect(await statusOf(counters.create({ key: `x-${uniqueSuffix()}`, value: 1 }))).toBe(403);
		expect(await statusOf(counters.update(counter.id, { value: 99 }))).toBe(403);
		expect(await statusOf(counters.delete(counter.id))).toBe(403);
		expect(await statusOf(s.anonymous.collection('ticket_counters').getList())).toBe(403);
		expect((await s.superuser.collection('ticket_counters').getOne(counter.id)).value).toBe(3);
	});
});

describe('households and household_members', () => {
	it('shows households only to their members', async () => {
		expect(await listIds(s.a, 'households')).toEqual([s.h1.id]);
		expect(await listIds(s.b, 'households')).toEqual([s.h1.id]);
		expect(await listIds(s.c, 'households')).toEqual([s.h2.id]);
		expect(await listIds(s.anonymous, 'households')).toEqual([]);
		expect(await statusOf(s.a.collection('households').getOne(s.h2.id))).toBe(404);
		expect(await statusOf(s.c.collection('households').getOne(s.h1.id))).toBe(404);
	});

	it('keeps households read-only', async () => {
		const households = s.a.collection('households');
		expect(await statusOf(households.create({ name: 'neu' }))).toBe(403);
		expect(await statusOf(households.update(s.h1.id, { name: 'neu' }))).toBe(403);
		expect(await statusOf(households.delete(s.h1.id))).toBe(403);
	});

	it('shows the memberships of the own households (E7-1) and keeps them read-only', async () => {
		// Every row of H1 (the tests above add further members D to H1, and D to H3 as well).
		const ofH1 = (
			await s.superuser
				.collection('household_members')
				.getFullList({ filter: s.superuser.filter('household = {:id}', { id: s.h1.id }) })
		)
			.map((row) => row.id)
			.sort();
		expect(ofH1).toEqual(expect.arrayContaining([s.members.aH1.id, s.members.bH1.id]));
		expect((await listIds(s.a, 'household_members')).sort()).toEqual(ofH1);
		expect((await listIds(s.b, 'household_members')).sort()).toEqual(ofH1);
		expect(await listIds(s.c, 'household_members')).toEqual([s.members.cH2.id]);
		expect(await listIds(s.anonymous, 'household_members')).toEqual([]);
		expect(await statusOf(s.a.collection('household_members').getOne(s.members.bH1.id))).toBe(200);
		expect(await statusOf(s.a.collection('household_members').getOne(s.members.cH2.id))).toBe(404);
		expect(await statusOf(s.c.collection('household_members').getOne(s.members.aH1.id))).toBe(404);

		const members = s.a.collection('household_members');
		expect(
			await statusOf(members.create({ household: s.h2.id, user: s.ids.a, role: 'member' }))
		).toBe(403);
		expect(await statusOf(members.update(s.members.aH1.id, { role: 'member' }))).toBe(403);
		expect(await statusOf(members.delete(s.members.aH1.id))).toBe(403);
	});
});

describe('users', () => {
	it('exposes the own record and those of the own households (E7-1), without e-mail addresses', async () => {
		// The members of H1: A, B and the users D the tests of the owned collections add.
		const membersOfH1 = (
			await s.superuser
				.collection('household_members')
				.getFullList({ filter: s.superuser.filter('household = {:id}', { id: s.h1.id }) })
		)
			.map((row) => row.user)
			.sort();
		expect(membersOfH1).toEqual(expect.arrayContaining([s.ids.a, s.ids.b]));
		expect((await listIds(s.a, 'users')).sort()).toEqual(membersOfH1);
		expect(await listIds(s.c, 'users')).toEqual([s.ids.c]);
		expect(await listIds(s.anonymous, 'users')).toEqual([]);
		const member = await s.a.collection('users').getOne(s.ids.b);
		expect(member.id).toBe(s.ids.b);
		expect(member.email).toBeUndefined();
		expect(await statusOf(s.a.collection('users').getOne(s.ids.c))).toBe(404);
		expect(await statusOf(s.c.collection('users').getOne(s.ids.a))).toBe(404);
		expect(await statusOf(s.a.collection('users').update(s.ids.b, { name: 'fremd' }))).toBe(404);
		expect((await s.a.collection('users').update(s.ids.a, { name: 'A' })).name).toBe('A');
	});

	it('forbids self-registration and account deletion through the API', async () => {
		const password = `pw-${uniqueSuffix()}`;
		const payload = {
			email: `self-${uniqueSuffix()}@example.com`,
			password,
			passwordConfirm: password
		};
		expect(await statusOf(s.anonymous.collection('users').create(payload))).toBe(403);
		expect(await statusOf(s.a.collection('users').create(payload))).toBe(403);
		expect(await statusOf(s.a.collection('users').delete(s.ids.a))).toBe(403);
	});
});
