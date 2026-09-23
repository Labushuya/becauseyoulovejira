// Parent guard and scope of the parent relation (E1 plan, package 6; CLAUDE.md section 5:
// parent at most one level; OF-3 c). Relations to project, tags and recurrence are covered in
// ticket-keys.test.mjs.

import { beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf } from '../support/api.mjs';
import { createOwner, createScenario, historyOf } from '../support/scenario.mjs';

let s;

beforeAll(async () => {
	s = await createScenario();
});

const parentError = (code) => ({ status: 400, codes: { parent: code } });

describe('parent', () => {
	it('accepts a top-level ticket of the same scope as parent', async () => {
		const owner = await createOwner(s.superuser);
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id });
		expect(child.parent).toBe(parent.id);
	});

	it('rejects the ticket itself as parent', async () => {
		const owner = await createOwner(s.superuser);
		const ticket = await owner.ticket();
		expect(
			await rejectionOf(owner.client.collection('tickets').update(ticket.id, { parent: ticket.id }))
		).toEqual(parentError('validation_parent_self'));
	});

	it('allows one level only', async () => {
		const owner = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id });
		const other = await owner.ticket();

		expect(await rejectionOf(owner.ticket({ parent: child.id }))).toEqual(
			parentError('validation_parent_nested')
		);
		expect(await rejectionOf(tickets.update(parent.id, { parent: other.id }))).toEqual(
			parentError('validation_parent_has_children')
		);
		expect((await tickets.update(other.id, { parent: parent.id })).parent).toBe(parent.id);
	});

	it('rejects cycles', async () => {
		const owner = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const first = await owner.ticket();
		const second = await owner.ticket({ parent: first.id });
		const rejection = await rejectionOf(tickets.update(first.id, { parent: second.id }));
		expect(rejection.status).toBe(400);
		expect(Object.keys(rejection.codes)).toEqual(['parent']);
		expect((await tickets.getOne(first.id)).parent).toBe('');
	});

	it('rejects a parent of another scope', async () => {
		const tickets = s.a.collection('tickets');
		const privateParent = await tickets.create({ owner: s.ids.a, title: 'privat' });
		const foreignParent = await s.b.collection('tickets').create({ owner: s.ids.b, title: 'B' });
		const mismatch = parentError('validation_scope_mismatch');

		expect(
			await rejectionOf(
				tickets.create({ owner: s.ids.a, household: s.h1.id, title: 'H1', parent: privateParent.id })
			)
		).toEqual(mismatch);
		expect(
			await rejectionOf(tickets.create({ owner: s.ids.a, title: 'x', parent: foreignParent.id }))
		).toEqual(mismatch);
	});

	it('keeps parent and sub-tickets in one scope when moving', async () => {
		const tickets = s.a.collection('tickets');
		const parent = await tickets.create({ owner: s.ids.a, title: 'Eltern' });
		const child = await tickets.create({ owner: s.ids.a, title: 'Kind', parent: parent.id });

		expect(await rejectionOf(tickets.update(parent.id, { household: s.h1.id }))).toEqual({
			status: 400,
			codes: { household: 'validation_ticket_has_children' }
		});
		expect(await rejectionOf(tickets.update(child.id, { household: s.h1.id }))).toEqual(
			parentError('validation_scope_mismatch')
		);

		const detached = await tickets.update(child.id, { household: s.h1.id, parent: '' });
		expect(detached).toMatchObject({ household: s.h1.id, parent: '' });
		expect((await tickets.update(parent.id, { household: s.h1.id })).household).toBe(s.h1.id);
	});

	it('clears the parent of sub-tickets when the parent is deleted', async () => {
		const owner = await createOwner(s.superuser);
		const tickets = owner.client.collection('tickets');
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id });
		await tickets.delete(parent.id);

		expect((await tickets.getOne(child.id)).parent).toBe('');
		const entry = (await historyOf(s.superuser, child.id)).find((item) => item.field === 'parent');
		expect(entry).toMatchObject({ old_value: parent.id, new_value: '', user: '' });
	});
});
