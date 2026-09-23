// Scope and atomic key assignment (E1 plan, package 5; CLAUDE.md section 5; OF-1, OF-3 c,
// OF-6, OF-8, OF-11, OF-14). Every test works with fresh users or the scenario of this file, so
// counters start at 1 regardless of other test files sharing the instance.

import { beforeAll, describe, expect, it } from 'vitest';
import { createAppUser, rejectionOf, statusOf, userClient } from '../support/api.mjs';
import { createScenario, scopeOf, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';

/** Marker title of tests/fixtures/pb_hooks/fault-injection.pb.js (fails after key assignment). */
const FAIL_TICKET_INSERT = '__byl_fail_ticket_insert__';

let s;

beforeAll(async () => {
	s = await createScenario();
});

/** Fresh user with its own private scope, so all counters of the scope start empty. */
async function freshUser() {
	const user = await createAppUser(s.superuser);
	const client = await userClient(user);
	const id = user.record.id;
	return {
		id,
		client,
		ticket: (data = {}) =>
			client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data }),
		project: (code, data = {}) =>
			client.collection('projects').create({ owner: id, name: `Projekt ${code}`, code, ...data }),
		tag: (name, data = {}) => client.collection('tags').create({ owner: id, name, ...data })
	};
}

async function counterValue(key) {
	const found = await s.superuser
		.collection('ticket_counters')
		.getFullList({ filter: s.superuser.filter('key = {:key}', { key }) });
	return found.length === 0 ? 0 : found[0].value;
}

describe('ticket keys', () => {
	it('starts with TASK-1 without project and ABC-1 with project, in separate counters', async () => {
		const u = await freshUser();
		const abc = await u.project('ABC');

		const first = await u.ticket();
		expect(first).toMatchObject({ key: 'TASK-1', number: 1, scope: `u:${u.id}` });
		const inProject = await u.ticket({ project: abc.id });
		expect(inProject).toMatchObject({ key: 'ABC-1', number: 1, scope: `u:${u.id}` });
		expect((await u.ticket()).key).toBe('TASK-2');
		expect((await u.ticket({ project: abc.id })).key).toBe('ABC-2');

		expect(await counterValue(`u:${u.id}:TASK`)).toBe(2);
		expect(await counterValue(`u:${u.id}:${abc.id}`)).toBe(2);
	});

	it('numbers household tickets in the household scope', async () => {
		const tickets = s.a.collection('tickets');
		const first = await tickets.create({ owner: s.ids.a, household: s.h1.id, title: 'H1 eins' });
		expect(first).toMatchObject({ key: 'TASK-1', scope: scopeOf(s.ids.a, s.h1.id) });
		const second = await s.b
			.collection('tickets')
			.create({ owner: s.ids.b, household: s.h1.id, title: 'H1 zwei' });
		expect(second).toMatchObject({ key: 'TASK-2', scope: scopeOf(s.ids.b, s.h1.id) });
	});

	it('gives 25 parallel creations 25 distinct, gapless keys', async () => {
		const u = await freshUser();
		const created = await Promise.all(Array.from({ length: 25 }, () => u.ticket()));
		const numbers = created.map((ticket) => ticket.number).sort((x, y) => x - y);
		expect(numbers).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
		expect(new Set(created.map((ticket) => ticket.key)).size).toBe(25);
		for (const ticket of created) expect(ticket.key).toBe(`TASK-${ticket.number}`);
		expect(await counterValue(`u:${u.id}:TASK`)).toBe(25);
	});

	it('does not advance the counter when a creation fails', async () => {
		const u = await freshUser();
		await u.ticket();

		// Validation error inside the transaction (after the counter update).
		expect(await rejectionOf(u.ticket({ title: '' }))).toEqual({
			status: 400,
			codes: { title: 'validation_required' }
		});
		// Injected failure after validation, right before the insert.
		expect(await statusOf(u.ticket({ title: FAIL_TICKET_INSERT }))).toBe(400);
		expect(await counterValue(`u:${u.id}:TASK`)).toBe(1);

		expect((await u.ticket()).key).toBe('TASK-2');
		const titles = (await u.client.collection('tickets').getFullList()).map((t) => t.title);
		expect(titles).not.toContain(FAIL_TICKET_INSERT);
	});

	it('ignores scope, key and number sent by the client', async () => {
		const u = await freshUser();
		const created = await u.ticket({ scope: `u:${s.ids.b}`, key: 'HACK-9', number: 99 });
		expect(created).toMatchObject({ key: 'TASK-1', number: 1, scope: `u:${u.id}` });

		const updated = await u.client
			.collection('tickets')
			.update(created.id, { scope: 'h:fremd', key: 'HACK-10', number: 100, title: 'neu' });
		expect(updated).toMatchObject({ key: 'TASK-1', number: 1, scope: `u:${u.id}`, title: 'neu' });

		const project = await u.project(uniqueCode(), { scope: `u:${s.ids.b}` });
		expect(project.scope).toBe(`u:${u.id}`);
		const tag = await u.tag(`tag-${uniqueSuffix()}`, { scope: 'h:fremd' });
		expect(tag.scope).toBe(`u:${u.id}`);
		expect((await u.client.collection('tags').update(tag.id, { scope: 'x' })).scope).toBe(
			`u:${u.id}`
		);
	});

	it('draws a new key in the target counter when the project changes', async () => {
		const u = await freshUser();
		const abc = await u.project('ABC');
		const xyz = await u.project('XYZ');
		const tickets = u.client.collection('tickets');
		const ticket = await u.ticket();
		expect(ticket.key).toBe('TASK-1');

		expect((await tickets.update(ticket.id, { project: abc.id })).key).toBe('ABC-1');
		expect((await tickets.update(ticket.id, { project: xyz.id })).key).toBe('XYZ-1');
		expect((await tickets.update(ticket.id, { project: abc.id })).key).toBe('ABC-2');
		const withoutProject = await tickets.update(ticket.id, { project: '' });
		expect(withoutProject).toMatchObject({ key: 'TASK-2', number: 2 });
		expect((await tickets.update(ticket.id, { title: 'nur Titel' })).key).toBe('TASK-2');
	});

	it('draws a new key in the target scope when the household changes', async () => {
		const tickets = s.a.collection('tickets');
		const ticket = await tickets.create({ owner: s.ids.a, title: 'wandert' });
		const privateKey = ticket.key;
		const moved = await tickets.update(ticket.id, { household: s.h1.id });
		expect(moved.scope).toBe(scopeOf(s.ids.a, s.h1.id));
		expect(moved.key).toMatch(/^TASK-\d+$/);
		expect(await counterValue(`${scopeOf(s.ids.a, s.h1.id)}:TASK`)).toBe(moved.number);

		const back = await tickets.update(ticket.id, { household: '' });
		expect(back.scope).toBe(scopeOf(s.ids.a));
		expect(back.key).not.toBe(privateKey);
		expect(back.number).toBe(await counterValue(`${scopeOf(s.ids.a)}:TASK`));
	});
});

describe('ticket defaults (OF-11)', () => {
	it('sets status open, priority medium and blocks_parent true when not sent', async () => {
		const u = await freshUser();
		expect(await u.ticket()).toMatchObject({
			status: 'open',
			priority: 'medium',
			blocks_parent: true
		});
	});

	it('keeps values sent by the client', async () => {
		const u = await freshUser();
		expect(
			await u.ticket({ status: 'backlog', priority: 'urgent', blocks_parent: false })
		).toMatchObject({ status: 'backlog', priority: 'urgent', blocks_parent: false });
	});
});

describe('projects', () => {
	it('rejects the reserved code TASK on create and update (OF-14)', async () => {
		const u = await freshUser();
		expect(await rejectionOf(u.project('TASK'))).toEqual({
			status: 400,
			codes: { code: 'validation_reserved_code' }
		});
		const project = await u.project('ABC');
		expect(
			await rejectionOf(u.client.collection('projects').update(project.id, { code: 'TASK' }))
		).toEqual({ status: 400, codes: { code: 'validation_reserved_code' } });
	});

	it('rejects a duplicate code in the same scope and allows it in another scope', async () => {
		const u = await freshUser();
		const other = await freshUser();
		await u.project('DUP');
		expect(await statusOf(u.project('DUP'))).toBe(400);
		expect((await other.project('DUP')).code).toBe('DUP');
	});

	it('cannot be deleted while tickets use it, but can be archived (OF-6)', async () => {
		const u = await freshUser();
		const used = await u.project('USED');
		const ticket = await u.ticket({ project: used.id });
		const projects = u.client.collection('projects');

		expect(await rejectionOf(projects.delete(used.id))).toEqual({
			status: 400,
			codes: { id: 'validation_project_in_use' }
		});
		expect((await projects.update(used.id, { archived: true })).archived).toBe(true);
		expect((await u.client.collection('tickets').getOne(ticket.id)).project).toBe(used.id);

		const unused = await u.project('FREE');
		expect(await statusOf(projects.delete(unused.id))).toBe(200);
	});

	it('keeps code and scope of a project with tickets', async () => {
		const own = s.a.collection('projects');
		const project = await own.create({ owner: s.ids.a, name: 'fest', code: uniqueCode() });
		await s.a.collection('tickets').create({ owner: s.ids.a, title: 'x', project: project.id });

		expect(await rejectionOf(own.update(project.id, { code: uniqueCode() }))).toEqual({
			status: 400,
			codes: { code: 'validation_project_in_use' }
		});
		expect(await rejectionOf(own.update(project.id, { household: s.h1.id }))).toEqual({
			status: 400,
			codes: { household: 'validation_project_in_use' }
		});
		expect((await own.update(project.id, { name: 'umbenannt' })).name).toBe('umbenannt');
	});
});

describe('tags (OF-8)', () => {
	it('are unique per scope without regard to case', async () => {
		const tags = s.a.collection('tags');
		const name = `Einkauf-${uniqueSuffix()}`;
		const privateTag = await tags.create({ owner: s.ids.a, name });
		expect(privateTag.scope).toBe(scopeOf(s.ids.a));

		expect(await statusOf(tags.create({ owner: s.ids.a, name: name.toUpperCase() }))).toBe(400);
		expect(await statusOf(tags.create({ owner: s.ids.a, name: name.toLowerCase() }))).toBe(400);

		const householdTag = await tags.create({ owner: s.ids.a, household: s.h1.id, name });
		expect(householdTag.scope).toBe(scopeOf(s.ids.a, s.h1.id));
		expect(
			await statusOf(
				s.b.collection('tags').create({ owner: s.ids.b, household: s.h1.id, name: name.toLowerCase() })
			)
		).toBe(400);
		expect((await s.b.collection('tags').create({ owner: s.ids.b, name })).scope).toBe(
			scopeOf(s.ids.b)
		);
	});

	it('keep their scope while tickets use them', async () => {
		const tag = await s.a.collection('tags').create({ owner: s.ids.a, name: `t-${uniqueSuffix()}` });
		await s.a.collection('tickets').create({ owner: s.ids.a, title: 'mit Tag', tags: [tag.id] });
		expect(
			await rejectionOf(s.a.collection('tags').update(tag.id, { household: s.h1.id }))
		).toEqual({ status: 400, codes: { household: 'validation_tag_in_use' } });
	});
});

describe('relations across scopes (OF-3 c)', () => {
	let rec;

	beforeAll(async () => {
		const create = (client, collection, data) => client.collection(collection).create(data);
		rec = {
			aProject: await create(s.a, 'projects', { owner: s.ids.a, name: 'p', code: uniqueCode() }),
			aH1Project: await create(s.a, 'projects', {
				owner: s.ids.a,
				household: s.h1.id,
				name: 'p',
				code: uniqueCode()
			}),
			bProject: await create(s.b, 'projects', { owner: s.ids.b, name: 'p', code: uniqueCode() }),
			aTag: await create(s.a, 'tags', { owner: s.ids.a, name: `t-${uniqueSuffix()}` }),
			aH1Tag: await create(s.a, 'tags', {
				owner: s.ids.a,
				household: s.h1.id,
				name: `t-${uniqueSuffix()}`
			}),
			aRule: await create(s.a, 'recurrence_rules', {
				owner: s.ids.a,
				title: 'Regel',
				mode: 'calendar'
			}),
			aH1Rule: await create(s.a, 'recurrence_rules', {
				owner: s.ids.a,
				household: s.h1.id,
				title: 'Regel',
				mode: 'calendar'
			})
		};
	});

	const privateTicket = (data) =>
		s.a.collection('tickets').create({ owner: s.ids.a, title: 'privat', ...data });
	const householdTicket = (data) =>
		s.a.collection('tickets').create({ owner: s.ids.a, household: s.h1.id, title: 'H1', ...data });

	it('accepts relations within the own scope', async () => {
		const ticket = await privateTicket({
			project: rec.aProject.id,
			tags: [rec.aTag.id],
			recurrence: rec.aRule.id
		});
		expect(ticket.key).toBe(`${rec.aProject.code}-1`);
		const h1 = await householdTicket({
			project: rec.aH1Project.id,
			tags: [rec.aH1Tag.id],
			recurrence: rec.aH1Rule.id
		});
		expect(h1.key).toBe(`${rec.aH1Project.code}-1`);
	});

	it('rejects a project of another scope, even of the same owner', async () => {
		const mismatch = { status: 400, codes: { project: 'validation_scope_mismatch' } };
		expect(await rejectionOf(privateTicket({ project: rec.bProject.id }))).toEqual(mismatch);
		expect(await rejectionOf(privateTicket({ project: rec.aH1Project.id }))).toEqual(mismatch);
		expect(await rejectionOf(householdTicket({ project: rec.aProject.id }))).toEqual(mismatch);
	});

	it('rejects tags and recurrence rules of another scope', async () => {
		expect(await rejectionOf(privateTicket({ tags: [rec.aTag.id, rec.aH1Tag.id] }))).toEqual({
			status: 400,
			codes: { tags: 'validation_scope_mismatch' }
		});
		expect(await rejectionOf(householdTicket({ recurrence: rec.aRule.id }))).toEqual({
			status: 400,
			codes: { recurrence: 'validation_scope_mismatch' }
		});
	});

	it('rejects updates that leave relations in the old scope', async () => {
		const tickets = s.a.collection('tickets');
		const ticket = await privateTicket({ project: rec.aProject.id, tags: [rec.aTag.id] });
		expect(await rejectionOf(tickets.update(ticket.id, { household: s.h1.id }))).toEqual({
			status: 400,
			codes: { project: 'validation_scope_mismatch', tags: 'validation_scope_mismatch' }
		});
		expect(await rejectionOf(tickets.update(ticket.id, { project: rec.bProject.id }))).toEqual({
			status: 400,
			codes: { project: 'validation_scope_mismatch' }
		});

		const moved = await tickets.update(ticket.id, {
			household: s.h1.id,
			project: rec.aH1Project.id,
			tags: [rec.aH1Tag.id]
		});
		expect(moved.scope).toBe(scopeOf(s.ids.a, s.h1.id));
		expect(moved.key).toMatch(new RegExp(`^${rec.aH1Project.code}-\\d+$`));
	});

	it('does not reveal whether a foreign record exists', async () => {
		const missing = await rejectionOf(privateTicket({ project: 'aaaaaaaaaaaaaaa' }));
		const foreign = await rejectionOf(privateTicket({ project: rec.bProject.id }));
		expect(missing).toEqual(foreign);
	});
});
