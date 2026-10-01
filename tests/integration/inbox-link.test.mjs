// Sources of a ticket (ADR-0031 sections 1 to 3, package HK-1): linking an inbox item to any
// ticket of its scope and releasing it again go through the record API; the hook writes the
// history of the ticket in the same transaction. The main source is never released, and no item is
// deleted through the API (since the addendum of 2026-10-01 to ADR-0014 not even a free one).

import { beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf, superuserClient } from '../support/api.mjs';
import { FAIL_SOURCE_LINK, createOwner, createScenario, historyOf, uniqueSuffix } from '../support/scenario.mjs';

let superuser;
let owner;
let other;

function createItem(who, data = {}) {
	return who.client.collection('inbox_items').create({
		owner: who.id,
		channel: 'telegram',
		kind: 'message',
		title: `Nachricht ${uniqueSuffix()}`,
		source_ref: `42:${uniqueSuffix()}`,
		...data
	});
}

const itemOf = (id) => superuser.collection('inbox_items').getOne(id);
const link = (who, itemId, ticketId) =>
	who.client.collection('inbox_items').update(itemId, { state: 'converted', ticket: ticketId });
const release = (who, itemId) => who.client.collection('inbox_items').update(itemId, { state: 'new', ticket: '' });
const sourceEntries = async (ticketId) =>
	(await historyOf(superuser, ticketId)).filter((entry) => entry.field === 'source_link');

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
	other = await createOwner(superuser);
});

describe('link', () => {
	it('links a new item to a ticket created by hand and records it in the history', async () => {
		const ticket = await owner.ticket({ source: 'manual' });
		const item = await createItem(owner);
		const linked = await link(owner, item.id, ticket.id);
		expect(linked.state).toBe('converted');
		expect(linked.ticket).toBe(ticket.id);
		expect(linked.handled_at).not.toBe('');

		const entries = await sourceEntries(ticket.id);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ old_value: '', user: owner.id });
		expect(JSON.parse(entries[0].new_value)).toEqual({ item: item.id, channel: 'telegram', title: item.title });

		// The ticket itself does not change.
		const after = await owner.client.collection('tickets').getOne(ticket.id);
		expect(after.updated).toBe(ticket.updated);
		expect(after.source_item).toBe('');
	});

	it('gives a ticket several sources', async () => {
		const ticket = await owner.ticket();
		const items = [await createItem(owner), await createItem(owner), await createItem(owner)];
		for (const item of items) await link(owner, item.id, ticket.id);
		const sources = await owner.client.collection('inbox_items').getFullList({
			filter: owner.client.filter('ticket = {:id}', { id: ticket.id })
		});
		expect(sources.map((item) => item.id).sort()).toEqual(items.map((item) => item.id).sort());
		expect(await sourceEntries(ticket.id)).toHaveLength(3);
	});

	it('writes no link entry when a ticket is created from the item', async () => {
		const item = await createItem(owner);
		const ticket = await owner.ticket({ source_item: item.id });
		expect((await itemOf(item.id)).ticket).toBe(ticket.id);
		expect((await historyOf(superuser, ticket.id)).map((entry) => entry.field)).toEqual(['created']);
	});

	it('refuses a missing and a foreign ticket with the same message and leaves the item new', async () => {
		const item = await createItem(owner);
		const foreign = await other.ticket();
		for (const ticketId of [foreign.id, 'abcdefghijklmno']) {
			expect(await rejectionOf(link(owner, item.id, ticketId))).toEqual({
				status: 400,
				codes: { ticket: 'validation_scope_mismatch' }
			});
		}
		expect((await itemOf(item.id)).state).toBe('new');
		expect(await sourceEntries(foreign.id)).toEqual([]);
	});

	it('keeps a linked item on a ticket: no empty ticket, no discarding', async () => {
		const first = await owner.ticket();
		const item = await createItem(owner);
		await link(owner, item.id, first.id);
		const items = owner.client.collection('inbox_items');
		for (const change of [{ ticket: '' }, { state: 'discarded', ticket: '' }, { state: 'new' }]) {
			expect((await rejectionOf(items.update(item.id, change))).codes).toEqual({
				state: 'validation_inbox_item_handled'
			});
		}
		expect((await itemOf(item.id)).ticket).toBe(first.id);
	});

	it('leaves the item new when the history entry fails (one transaction)', async () => {
		const ticket = await owner.ticket();
		const item = await createItem(owner, { title: FAIL_SOURCE_LINK });
		expect((await rejectionOf(link(owner, item.id, ticket.id))).status).toBe(400);
		const after = await itemOf(item.id);
		expect(after.state).toBe('new');
		expect(after.ticket).toBe('');
		expect(after.handled_at).toBe('');
	});

	it('links household items for every member with the member as author', async () => {
		const s = await createScenario();
		const item = await s.a.collection('inbox_items').create({
			owner: s.ids.a,
			household: s.h1.id,
			channel: 'manual',
			kind: 'todo',
			title: 'Haushalt'
		});
		const ticket = await s.b.collection('tickets').create({ owner: s.ids.b, household: s.h1.id, title: 'Ziel' });
		const privateTicket = await s.a.collection('tickets').create({ owner: s.ids.a, title: 'Privat' });
		expect((await rejectionOf(link({ client: s.a }, item.id, privateTicket.id))).codes).toEqual({
			ticket: 'validation_scope_mismatch'
		});
		expect((await rejectionOf(link({ client: s.c }, item.id, ticket.id))).status).toBe(404);
		await link({ client: s.b }, item.id, ticket.id);
		const entries = await sourceEntries(ticket.id);
		expect(entries.map((entry) => entry.user)).toEqual([s.ids.b]);
	});
});

describe('release', () => {
	it('gives a linked item back to the inbox and records it in the history', async () => {
		const ticket = await owner.ticket();
		const item = await createItem(owner);
		await link(owner, item.id, ticket.id);
		const released = await release(owner, item.id);
		expect(released.state).toBe('new');
		expect(released.ticket).toBe('');
		expect(released.handled_at).toBe('');

		const entries = await sourceEntries(ticket.id);
		expect(entries.map((entry) => [entry.old_value === '', entry.new_value === ''])).toEqual([
			[true, false],
			[false, true]
		]);
		expect(JSON.parse(entries[1].old_value)).toEqual({ item: item.id, channel: 'telegram', title: item.title });
		expect(entries[1].user).toBe(owner.id);

		// It can be linked again, also to another ticket.
		const next = await owner.ticket();
		expect((await link(owner, item.id, next.id)).ticket).toBe(next.id);
	});

	it('never releases the main source of a ticket', async () => {
		const item = await createItem(owner);
		const ticket = await owner.ticket({ source_item: item.id });
		expect(await rejectionOf(release(owner, item.id))).toEqual({
			status: 400,
			codes: { state: 'validation_inbox_primary_source' }
		});
		const after = await itemOf(item.id);
		expect(after.state).toBe('converted');
		expect(after.ticket).toBe(ticket.id);
	});

	it('finds a linked item back in the inbox once its ticket is deleted (addendum B)', async () => {
		const ticket = await owner.ticket();
		const item = await createItem(owner);
		await link(owner, item.id, ticket.id);
		await owner.client.collection('tickets').delete(ticket.id);
		expect(await itemOf(item.id)).toMatchObject({ state: 'new', ticket: '', handled_at: '' });
	});

	it('keeps the item linked when the history entry fails', async () => {
		const ticket = await owner.ticket();
		const item = await createItem(owner);
		await link(owner, item.id, ticket.id);
		// Editing the title of a linked item is no link change and writes no history.
		await owner.client.collection('inbox_items').update(item.id, { title: FAIL_SOURCE_LINK });
		expect((await rejectionOf(release(owner, item.id))).status).toBe(400);
		const after = await itemOf(item.id);
		expect(after.state).toBe('converted');
		expect(after.ticket).toBe(ticket.id);
	});
});

describe('move (ADR-0031 addendum)', () => {
	const move = (who, itemId, ticketId) => who.client.collection('inbox_items').update(itemId, { ticket: ticketId });

	it('moves a linked item directly to another ticket with a history entry in both', async () => {
		const [from, to] = [await owner.ticket(), await owner.ticket()];
		const item = await createItem(owner);
		const linked = await link(owner, item.id, from.id);
		const moved = await move(owner, item.id, to.id);
		expect(moved.state).toBe('converted');
		expect(moved.ticket).toBe(to.id);
		expect(moved.handled_at).toBe(linked.handled_at);

		const [fromEntries, toEntries] = [await sourceEntries(from.id), await sourceEntries(to.id)];
		expect(fromEntries).toHaveLength(2);
		expect(fromEntries[1]).toMatchObject({ new_value: '', user: owner.id });
		expect(JSON.parse(fromEntries[1].old_value)).toEqual({
			item: item.id,
			channel: 'telegram',
			title: item.title,
			moved_to: { ticket: to.id, key: to.key }
		});
		expect(toEntries).toHaveLength(1);
		expect(toEntries[0]).toMatchObject({ old_value: '', user: owner.id });
		expect(JSON.parse(toEntries[0].new_value)).toEqual({
			item: item.id,
			channel: 'telegram',
			title: item.title,
			moved_from: { ticket: from.id, key: from.key }
		});

		// The tickets themselves do not change.
		for (const ticket of [from, to]) {
			expect((await owner.client.collection('tickets').getOne(ticket.id)).updated).toBe(ticket.updated);
		}
	});

	it('never moves the main source and says why', async () => {
		const item = await createItem(owner);
		const ticket = await owner.ticket({ source_item: item.id });
		const other = await owner.ticket();
		expect(await rejectionOf(move(owner, item.id, other.id))).toEqual({
			status: 400,
			codes: { ticket: 'validation_inbox_primary_source' }
		});
		expect((await itemOf(item.id)).ticket).toBe(ticket.id);
		expect(await sourceEntries(other.id)).toEqual([]);
	});

	it('refuses a missing and a foreign ticket and keeps the item where it was', async () => {
		const ticket = await owner.ticket();
		const item = await createItem(owner);
		await link(owner, item.id, ticket.id);
		const foreign = await other.ticket();
		for (const ticketId of [foreign.id, 'abcdefghijklmno']) {
			expect(await rejectionOf(move(owner, item.id, ticketId))).toEqual({
				status: 400,
				codes: { ticket: 'validation_scope_mismatch' }
			});
		}
		expect((await itemOf(item.id)).ticket).toBe(ticket.id);
		expect(await sourceEntries(ticket.id)).toHaveLength(1);
	});

	it('rolls back the move when a history entry fails (one transaction)', async () => {
		const [from, to] = [await owner.ticket(), await owner.ticket()];
		const item = await createItem(owner);
		await link(owner, item.id, from.id);
		await owner.client.collection('inbox_items').update(item.id, { title: FAIL_SOURCE_LINK });
		expect((await rejectionOf(move(owner, item.id, to.id))).status).toBe(400);
		expect((await itemOf(item.id)).ticket).toBe(from.id);
		expect(await sourceEntries(from.id)).toHaveLength(1);
		expect(await sourceEntries(to.id)).toEqual([]);
	});

	it('moves a household item for another member of the household only within it', async () => {
		const s = await createScenario();
		const item = await s.a.collection('inbox_items').create({
			owner: s.ids.a,
			household: s.h1.id,
			channel: 'manual',
			kind: 'todo',
			title: 'Haushalt'
		});
		const first = await s.a.collection('tickets').create({ owner: s.ids.a, household: s.h1.id, title: 'Erst' });
		const second = await s.b.collection('tickets').create({ owner: s.ids.b, household: s.h1.id, title: 'Dann' });
		const privateTicket = await s.b.collection('tickets').create({ owner: s.ids.b, title: 'Privat' });
		await link({ client: s.a }, item.id, first.id);
		expect((await rejectionOf(move({ client: s.b }, item.id, privateTicket.id))).codes).toEqual({
			ticket: 'validation_scope_mismatch'
		});
		expect((await rejectionOf(move({ client: s.c }, item.id, second.id))).status).toBe(404);
		expect((await move({ client: s.b }, item.id, second.id)).ticket).toBe(second.id);
		expect((await sourceEntries(second.id)).map((entry) => entry.user)).toEqual([s.ids.b]);
	});
});

describe('delete guard', () => {
	it('refuses to delete a linked item; the ticket keeps its source', async () => {
		const ticket = await owner.ticket();
		const item = await createItem(owner);
		await link(owner, item.id, ticket.id);
		// No app user may delete an item (deleteRule null, ADR-0014 addendum of 2026-10-01); the hook
		// tells the superuser why a source stays.
		expect((await rejectionOf(owner.client.collection('inbox_items').delete(item.id))).status).toBe(403);
		expect(await rejectionOf(superuser.collection('inbox_items').delete(item.id))).toEqual({
			status: 400,
			codes: { ticket: 'validation_inbox_item_linked' }
		});
		expect((await itemOf(item.id)).ticket).toBe(ticket.id);
	});

	it('refuses to delete new, discarded and released items as well, also to a superuser (ADR-0014, addendum of 2026-10-01)', async () => {
		const ticket = await owner.ticket();
		const fresh = await createItem(owner);
		const discarded = await createItem(owner);
		await owner.client.collection('inbox_items').update(discarded.id, { state: 'discarded' });
		const released = await createItem(owner);
		await link(owner, released.id, ticket.id);
		await release(owner, released.id);
		for (const item of [fresh, discarded, released]) {
			const refused = await rejectionOf(owner.client.collection('inbox_items').delete(item.id));
			expect(refused.status, item.title).toBe(403);
			// A superuser (API or admin UI) gets the reason: discard instead, the block stays.
			const error = await superuser.collection('inbox_items').delete(item.id).catch((failure) => failure);
			expect(error?.status, item.title).toBe(400);
			expect(error?.response?.data?.state?.code).toBe('validation_inbox_item_delete');
			expect(error?.response?.message).toBe(
				'Eingangseinträge lassen sich nicht löschen, nur verwerfen. So bleibt die Sperre gegen erneutes Eintreffen erhalten.'
			);
			expect((await itemOf(item.id)).fingerprint).toBe(item.fingerprint);
		}
		// Another user gets the same answer as the owner, so it says nothing about the item.
		expect((await rejectionOf(other.client.collection('inbox_items').delete(fresh.id))).status).toBe(403);
		// The discarded item keeps blocking the same message.
		expect((await rejectionOf(createItem(owner, { source_ref: discarded.source_ref }))).codes).toEqual({
			fingerprint: 'validation_inbox_duplicate'
		});
	});

	it('leaves deletes of the server itself alone ($app.delete, ADR-0014 addendum of 2026-10-01)', async () => {
		const item = await createItem(owner);
		await superuser.send(`/api/byl-test/inbox/${item.id}/delete`, { method: 'POST' });
		expect((await rejectionOf(itemOf(item.id))).status).toBe(404);
	});
});
