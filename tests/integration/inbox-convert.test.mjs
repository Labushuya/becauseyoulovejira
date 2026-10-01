// Converting an inbox item into a ticket (ADR-0014 sections 2 and 4, E4 plan package 1): the
// ticket hook sets the source and marks the item as converted in the same transaction; a failed
// create leaves the item new, and an item is converted at most once.

import { beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf, superuserClient } from '../support/api.mjs';
import {
	FAIL_HISTORY,
	FAIL_TICKET_INSERT,
	counterValue,
	createOwner,
	createScenario,
	uniqueCode,
	uniqueSuffix
} from '../support/scenario.mjs';

let superuser;
let owner;
let other;

function createItem(who, data = {}) {
	return who.client.collection('inbox_items').create({
		owner: who.id,
		channel: 'eml',
		kind: 'mail',
		title: `Mail ${uniqueSuffix()}`,
		source_ref: `<${uniqueSuffix()}@example.com>`,
		...data
	});
}

const itemOf = (id) => superuser.collection('inbox_items').getOne(id);

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
	other = await createOwner(superuser);
});

describe('convert', () => {
	it('sets the source from the channel and marks the item converted', async () => {
		const item = await createItem(owner);
		const ticket = await owner.ticket({ title: item.title, source: 'manual', source_item: item.id });
		expect(ticket.source).toBe('eml');
		expect(ticket.source_item).toBe(item.id);

		const converted = await itemOf(item.id);
		expect(converted.state).toBe('converted');
		expect(converted.ticket).toBe(ticket.id);
		expect(converted.handled_at).not.toBe('');
	});

	it('reports a later duplicate with the key of the ticket', async () => {
		const ref = `<${uniqueSuffix()}@example.com>`;
		const item = await createItem(owner, { source_ref: ref });
		const ticket = await owner.ticket({ source_item: item.id });
		try {
			await createItem(owner, { source_ref: ref, channel: 'mail' });
			throw new Error('Expected a duplicate.');
		} catch (error) {
			expect(error.response?.data?.fingerprint).toEqual({
				code: 'validation_inbox_duplicate',
				message: `Schon Ticket ${ticket.key}.`,
				params: { state: 'converted', item: item.id, ticket: ticket.id, ticketKey: ticket.key }
			});
		}
	});

	it('accepts only an empty source, manual or quick without an item', async () => {
		expect((await owner.ticket()).source).toBe('');
		expect((await owner.ticket({ source: 'manual' })).source).toBe('manual');
		expect((await owner.ticket({ source: 'quick' })).source).toBe('quick');
		for (const source of ['eml', 'telegram']) {
			expect(await rejectionOf(owner.ticket({ source }))).toEqual({
				status: 400,
				codes: { source: 'validation_source_not_allowed' }
			});
		}
	});

	it('keeps source and source_item fixed after the create', async () => {
		const tickets = owner.client.collection('tickets');
		const item = await createItem(owner);
		const ticket = await owner.ticket({ source_item: item.id });
		const second = await createItem(owner);
		expect(await rejectionOf(tickets.update(ticket.id, { source: 'manual' }))).toEqual({
			status: 400,
			codes: { source: 'validation_source_immutable' }
		});
		expect(await rejectionOf(tickets.update(ticket.id, { source_item: second.id }))).toEqual({
			status: 400,
			codes: { source_item: 'validation_source_immutable' }
		});
		expect(await rejectionOf(tickets.update(ticket.id, { source_item: '' }))).toMatchObject({
			codes: { source_item: 'validation_source_immutable' }
		});
		const plain = await owner.ticket({ source: 'quick' });
		expect(await rejectionOf(tickets.update(plain.id, { source: 'manual' }))).toMatchObject({
			codes: { source: 'validation_source_immutable' }
		});
		const same = await tickets.update(ticket.id, { title: 'Neu', source: 'eml', source_item: item.id });
		expect(same.title).toBe('Neu');
	});

	it('records no history entries for the source fields', async () => {
		const item = await createItem(owner);
		const ticket = await owner.ticket({ source_item: item.id });
		const history = await superuser.collection('ticket_history').getFullList({
			filter: superuser.filter('ticket = {:id}', { id: ticket.id })
		});
		expect(history.map((entry) => entry.field)).toEqual(['created']);
	});
});

describe('atomic', () => {
	it('leaves the item new when the ticket is rejected (archived project)', async () => {
		const project = await owner.project(uniqueCode(), { archived: true });
		const item = await createItem(owner);
		const rejection = await rejectionOf(owner.ticket({ project: project.id, source_item: item.id }));
		expect(rejection.codes).toEqual({ project: 'validation_project_archived' });
		expect((await itemOf(item.id)).state).toBe('new');
		expect(await counterValue(superuser, `u:${owner.id}:${project.id}`)).toBe(0);
	});

	it('leaves the item new when the insert or the history entry fails', async () => {
		for (const title of [FAIL_TICKET_INSERT, FAIL_HISTORY]) {
			const item = await createItem(owner);
			expect((await rejectionOf(owner.ticket({ title, source_item: item.id }))).status).toBe(400);
			const after = await itemOf(item.id);
			expect(after.state, title).toBe('new');
			expect(after.ticket, title).toBe('');
			const tickets = await superuser.collection('tickets').getFullList({
				filter: superuser.filter('source_item = {:id}', { id: item.id })
			});
			expect(tickets, title).toEqual([]);
		}
	});

	it('uses no number when the item is already handled', async () => {
		const fresh = await createOwner(superuser);
		const item = await createItem(fresh);
		await fresh.client.collection('inbox_items').update(item.id, { state: 'discarded' });
		expect(await rejectionOf(fresh.ticket({ source_item: item.id }))).toEqual({
			status: 400,
			codes: { source_item: 'validation_inbox_item_handled' }
		});
		expect(await counterValue(superuser, `u:${fresh.id}:TASK`)).toBe(0);
	});
});

describe('once', () => {
	it('rejects a second conversion of the same item', async () => {
		const item = await createItem(owner);
		await owner.ticket({ source_item: item.id });
		expect(await rejectionOf(owner.ticket({ source_item: item.id }))).toEqual({
			status: 400,
			codes: { source_item: 'validation_inbox_item_handled' }
		});
	});

	it('lets exactly one of two parallel conversions win', async () => {
		for (let round = 0; round < 3; round += 1) {
			const item = await createItem(owner);
			const results = await Promise.allSettled([
				owner.ticket({ source_item: item.id }),
				owner.ticket({ source_item: item.id })
			]);
			const won = results.filter((result) => result.status === 'fulfilled');
			const lost = results.filter((result) => result.status === 'rejected');
			expect(won).toHaveLength(1);
			expect(lost).toHaveLength(1);
			expect(lost[0].reason.status).toBe(400);
			expect(lost[0].reason.response.data.source_item.code).toBe('validation_inbox_item_handled');
			const converted = await itemOf(item.id);
			expect(converted.ticket).toBe(won[0].value.id);
			const tickets = await superuser.collection('tickets').getFullList({
				filter: superuser.filter('source_item = {:id}', { id: item.id })
			});
			expect(tickets).toHaveLength(1);
		}
	});
});

describe('scopes', () => {
	it('rejects items of other users and of another scope', async () => {
		const foreign = await createItem(other);
		expect(await rejectionOf(owner.ticket({ source_item: foreign.id }))).toEqual({
			status: 400,
			codes: { source_item: 'validation_scope_mismatch' }
		});
		expect((await itemOf(foreign.id)).state).toBe('new');

		const s = await createScenario();
		const householdItem = await s.a.collection('inbox_items').create({
			owner: s.ids.a,
			household: s.h1.id,
			channel: 'manual',
			kind: 'todo',
			title: 'Haushalt'
		});
		const privateTicket = s.a
			.collection('tickets')
			.create({ owner: s.ids.a, title: 'Privat', source_item: householdItem.id });
		expect((await rejectionOf(privateTicket)).codes).toEqual({
			source_item: 'validation_scope_mismatch'
		});
		const householdTicket = await s.b.collection('tickets').create({
			owner: s.ids.b,
			household: s.h1.id,
			title: 'Haushalt',
			source_item: householdItem.id
		});
		expect(householdTicket.source).toBe('manual');
	});
});

describe('deleting', () => {
	it('gives the item back to the inbox when the ticket is deleted (ADR-0031, addendum B)', async () => {
		const ref = `<${uniqueSuffix()}@example.com>`;
		const item = await createItem(owner, { source_ref: ref });
		const ticket = await owner.ticket({ source_item: item.id });
		const converted = await itemOf(item.id);
		await owner.client.collection('tickets').delete(ticket.id);

		const after = await itemOf(item.id);
		expect(after.state).toBe('new');
		expect(after.ticket).toBe('');
		expect(after.handled_at).toBe('');
		expect(after.fingerprint).toBe(converted.fingerprint);
		expect(after.source_meta.ticket_deleted.key).toBe(ticket.key);
		const again = await rejectionOf(createItem(owner, { source_ref: ref }));
		expect(again.codes).toEqual({ fingerprint: 'validation_inbox_duplicate' });
	});

	it('keeps the item the ticket came from: it cannot be deleted (ADR-0031 section 3)', async () => {
		const item = await createItem(owner);
		const ticket = await owner.ticket({ source_item: item.id });
		// The deleteRule refuses the owner; the hook refuses the superuser as well and says why.
		expect((await rejectionOf(owner.client.collection('inbox_items').delete(item.id))).status).toBe(403);
		expect(await rejectionOf(superuser.collection('inbox_items').delete(item.id))).toEqual({
			status: 400,
			codes: { ticket: 'validation_inbox_item_linked' }
		});
		const after = await owner.client.collection('tickets').getOne(ticket.id);
		expect(after.source_item).toBe(item.id);
		expect(after.source).toBe('eml');

		// Once the ticket is gone, the item is back in the inbox and still not deletable: its
		// fingerprint keeps the same mail out (ADR-0014, addendum of 2026-10-01).
		await owner.client.collection('tickets').delete(ticket.id);
		expect((await itemOf(item.id)).state).toBe('new');
		expect((await rejectionOf(owner.client.collection('inbox_items').delete(item.id))).status).toBe(403);
		expect(await rejectionOf(superuser.collection('inbox_items').delete(item.id))).toEqual({
			status: 400,
			codes: { state: 'validation_inbox_item_delete' }
		});
		expect((await itemOf(item.id)).id).toBe(item.id);
	});
});
