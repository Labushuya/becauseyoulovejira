// Deleting a ticket with sources (ADR-0031, addendum B, package HK-6; since the trash ADR-0037):
// the sources are never deleted and never left as converted items without a ticket. Every way to
// delete moves the ticket to the trash and gives the sources back to the inbox; the route "Ticket
// löschen mit Quellenbehandlung" can keep them with the ticket instead ("Quellen verwerfen"),
// hidden until it is restored; since ADR-0047 they block deleting it for good until the decision
// help gives them back or discards them (a discarded entry keeps the fingerprint). Everything runs
// atomically.

import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, rejectionOf, statusOf, superuserClient } from '../support/api.mjs';
import { FAIL_SOURCE_SETTLE, createOwner, createScenario, uniqueSuffix } from '../support/scenario.mjs';
import { deleteTicket } from '../../web/src/lib/data/tickets.ts';

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
const deleteWith = (client, ticketId, sources) =>
	client.send(`/api/byl/tickets/${ticketId}/delete`, { method: 'POST', body: { sources } });
const purge = (client, ticketId) => client.send(`/api/byl/trash/${ticketId}/purge`, { method: 'POST' });
const resolve = (client, ticketId, actions) =>
	client.send(`/api/byl/trash/${ticketId}/resolve`, { method: 'POST', body: { actions } });
const inTrash = async (ticketId) => (await superuser.collection('tickets').getOne(ticketId)).deleted_at !== '';

/** A ticket made from one item with a second item linked to it. */
async function ticketWithSources(who = owner) {
	const main = await createItem(who);
	const ticket = await who.ticket({ source_item: main.id });
	const linked = await createItem(who);
	await link(who, linked.id, ticket.id);
	return { ticket, main: await itemOf(main.id), linked: await itemOf(linked.id) };
}

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
	other = await createOwner(superuser);
});

describe('delete through the record API (safe default)', () => {
	it('gives every source back to the inbox with a note of the deleted ticket', async () => {
		const { ticket, main, linked } = await ticketWithSources();
		await owner.client.collection('tickets').delete(ticket.id);
		expect(await inTrash(ticket.id)).toBe(true);
		for (const before of [main, linked]) {
			const after = await itemOf(before.id);
			expect(after).toMatchObject({ state: 'new', ticket: '', handled_at: '', fingerprint: before.fingerprint });
			expect(after.source_meta.ticket_deleted.key).toBe(ticket.key);
			expect(after.source_meta.ticket_deleted.ticket).toBe(ticket.id);
			expect(after.source_meta.ticket_deleted.at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
		}
		// Still a duplicate: the same message is not taken in a second time.
		const again = await rejectionOf(createItem(owner, { source_ref: main.source_ref, title: main.title }));
		expect(again.codes).toEqual({ fingerprint: 'validation_inbox_duplicate' });
	});

	it('does the same for a superuser in the admin UI', async () => {
		const { ticket, linked } = await ticketWithSources();
		await superuser.collection('tickets').delete(ticket.id);
		expect(await inTrash(ticket.id)).toBe(true);
		expect(await itemOf(linked.id)).toMatchObject({ state: 'new', ticket: '' });
	});

	it('moves a ticket without sources to the trash', async () => {
		const ticket = await owner.ticket();
		await owner.client.collection('tickets').delete(ticket.id);
		expect(await statusOf(owner.client.collection('tickets').getOne(ticket.id))).toBe(404);
		expect(await inTrash(ticket.id)).toBe(true);
	});

	it('keeps the other keys of source_meta and forgets the note once the entry is linked again', async () => {
		const main = await createItem(owner, { source_meta: { chat: 'Familie', sender: 'Ben' } });
		const ticket = await owner.ticket({ source_item: main.id });
		await owner.client.collection('tickets').delete(ticket.id);
		const back = await itemOf(main.id);
		expect(back.source_meta).toMatchObject({ chat: 'Familie', sender: 'Ben' });
		const next = await owner.ticket();
		const linked = await link(owner, main.id, next.id);
		expect(linked.source_meta).toEqual({ chat: 'Familie', sender: 'Ben' });
	});
});

describe('route "Ticket löschen mit Quellenbehandlung"', () => {
	it('gives the sources back to the inbox with "inbox"', async () => {
		const { ticket, main, linked } = await ticketWithSources();
		const moved = await deleteWith(owner.client, ticket.id, 'inbox');
		expect(moved).toMatchObject({ id: ticket.id, tickets: [{ id: ticket.id, key: ticket.key }] });
		expect(await inTrash(ticket.id)).toBe(true);
		for (const item of [main, linked]) {
			expect(await itemOf(item.id)).toMatchObject({ state: 'new', ticket: '', handled_at: '' });
		}
	});

	it('keeps the sources with "discard" with the ticket; deleting for good waits until they are discarded, which keeps the fingerprint', async () => {
		const { ticket, main, linked } = await ticketWithSources();
		await deleteWith(owner.client, ticket.id, 'discard');
		for (const before of [main, linked]) {
			expect(await itemOf(before.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
			expect(await statusOf(owner.client.collection('inbox_items').getOne(before.id))).toBe(404);
		}
		expect((await rejectionOf(purge(owner.client, ticket.id))).codes).toEqual({ id: 'validation_trash_blocked' });
		await resolve(owner.client, ticket.id, [
			{ action: 'complete', ticket: ticket.id },
			{ action: 'discard', item: main.id },
			{ action: 'discard', item: linked.id }
		]);
		await purge(owner.client, ticket.id);
		for (const before of [main, linked]) {
			const after = await itemOf(before.id);
			expect(after).toMatchObject({ state: 'discarded', ticket: '', fingerprint: before.fingerprint });
			expect(after.handled_at).not.toBe('');
		}
		const again = await rejectionOf(createItem(owner, { source_ref: linked.source_ref, title: linked.title }));
		expect(again.codes).toEqual({ fingerprint: 'validation_inbox_duplicate' });
		// A discarded source can be restored like any discarded entry.
		const restored = await owner.client.collection('inbox_items').update(linked.id, { state: 'new' });
		expect(restored.state).toBe('new');
	});

	it('goes through the data layer of the SPA, with and without a choice', async () => {
		const first = await ticketWithSources();
		const moved = await deleteTicket(owner.client, first.ticket.id, { sources: 'discard' });
		expect(moved).toMatchObject({ id: first.ticket.id });
		expect(await itemOf(first.linked.id)).toMatchObject({ state: 'converted', ticket: first.ticket.id });
		const second = await ticketWithSources();
		await deleteTicket(owner.client, second.ticket.id);
		expect((await itemOf(second.linked.id)).state).toBe('new');
		await expect(deleteTicket(owner.client, second.ticket.id, { sources: 'inbox' })).rejects.toMatchObject({
			kind: 'not_found'
		});
	});

	it('refuses an unknown choice and leaves ticket and sources alone', async () => {
		const { ticket, linked } = await ticketWithSources();
		for (const sources of ['delete', '', undefined]) {
			expect((await rejectionOf(deleteWith(owner.client, ticket.id, sources))).status).toBe(400);
		}
		expect(await inTrash(ticket.id)).toBe(false);
		expect(await itemOf(linked.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
	});

	it('answers 404 for a foreign or missing ticket and 401 without a session', async () => {
		const { ticket } = await ticketWithSources(other);
		expect((await rejectionOf(deleteWith(owner.client, ticket.id, 'inbox'))).status).toBe(404);
		expect((await rejectionOf(deleteWith(owner.client, 'abcdefghijklmno', 'inbox'))).status).toBe(404);
		expect((await rejectionOf(deleteWith(createClient(), ticket.id, 'inbox'))).status).toBe(401);
		expect(await inTrash(ticket.id)).toBe(false);
	});

	it('lets every member of the household delete a household ticket with its sources', async () => {
		const s = await createScenario();
		const item = await s.a.collection('inbox_items').create({
			owner: s.ids.a,
			household: s.h1.id,
			channel: 'manual',
			kind: 'todo',
			title: 'Haushalt'
		});
		const ticket = await s.a
			.collection('tickets')
			.create({ owner: s.ids.a, household: s.h1.id, title: 'Aus Eintrag', source_item: item.id });
		expect((await rejectionOf(deleteWith(s.c, ticket.id, 'discard'))).status).toBe(404);
		await deleteWith(s.b, ticket.id, 'discard');
		expect(await statusOf(s.a.collection('inbox_items').getOne(item.id))).toBe(404);
		await resolve(s.a, ticket.id, [
			{ action: 'complete', ticket: ticket.id },
			{ action: 'discard', item: item.id }
		]);
		await purge(s.a, ticket.id);
		expect((await s.a.collection('inbox_items').getOne(item.id)).state).toBe('discarded');
	});

	it('keeps ticket and sources when settling a source fails (one transaction)', async () => {
		const main = await createItem(owner);
		const ticket = await owner.ticket({ source_item: main.id });
		const failing = await createItem(owner, { title: FAIL_SOURCE_SETTLE });
		await link(owner, failing.id, ticket.id);
		expect((await rejectionOf(deleteWith(owner.client, ticket.id, 'inbox'))).status).toBe(400);
		expect((await rejectionOf(owner.client.collection('tickets').delete(ticket.id))).status).toBe(400);
		const kept = await superuser.collection('tickets').getOne(ticket.id);
		expect(kept).toMatchObject({ source_item: main.id, deleted_at: '' });
		for (const id of [main.id, failing.id]) {
			expect(await itemOf(id)).toMatchObject({ state: 'converted', ticket: ticket.id });
		}
	});
});
