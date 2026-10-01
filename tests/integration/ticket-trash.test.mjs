// Trash for tickets (ADR-0037, package PB-1) against an own disposable PocketBase: its daily run
// with a test clock (tests/fixtures/pb_hooks/trash-clock.pb.js) does not reach the tickets of
// other test files. Every way to delete moves a ticket with its sub-tickets to the trash; the API
// rules hide it everywhere, the trash routes read, restore and delete it for good. Since ADR-0047
// every way to delete for good (route, emptying, daily run, admin UI) refuses or skips a group with
// dependencies, and the decision help resolves them.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { uniqueCode } from '../support/scenario.mjs';

let instance;
let superuser;
let owner;
let other;

const unique = () => randomBytes(6).toString('hex');

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function createUser() {
	const email = `user-${unique()}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	const id = record.id;
	return {
		id,
		pb,
		ticket: (data = {}) => pb.collection('tickets').create({ owner: id, title: `Ticket ${unique()}`, ...data }),
		project: (data = {}) => pb.collection('projects').create({ owner: id, name: `Projekt ${unique()}`, code: uniqueCode(), ...data }),
		item: (data = {}) =>
			pb.collection('inbox_items').create({
				owner: id,
				channel: 'telegram',
				kind: 'message',
				title: `Nachricht ${unique()}`,
				source_ref: `42:${unique()}`,
				...data
			})
	};
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await createUser();
	other = await createUser();
});

afterAll(async () => {
	await instance?.stop();
});

/** Status and validation codes of a rejected call. */
async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		const data = error.response?.data ?? {};
		return {
			status: error.status,
			codes: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.code])),
			params: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.params])),
			message: error.response?.message
		};
	}
	throw new Error('Expected the request to be rejected, but it succeeded.');
}

async function statusOf(promise) {
	try {
		await promise;
		return 200;
	} catch (error) {
		return error.status;
	}
}

const route = (who, path, body, method = 'POST') => who.pb.send(path, { method, body });
const deleteWith = (who, id, sources) => route(who, `/api/byl/tickets/${id}/delete`, { sources });
const trashOf = (who) => route(who, '/api/byl/trash', undefined, 'GET');
const previewOf = (who, id) => route(who, `/api/byl/trash/${id}`, undefined, 'GET');
const restore = (who, id, body = {}) => route(who, `/api/byl/trash/${id}/restore`, body);
const purge = (who, id) => route(who, `/api/byl/trash/${id}/purge`, {});
const stored = (collection, id) => superuser.collection(collection).getOne(id);
const historyOf = (ticketId) =>
	superuser
		.collection('ticket_history')
		.getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticketId }), sort: 'created,id' });
const link = (who, itemId, ticketId) => who.pb.collection('inbox_items').update(itemId, { state: 'converted', ticket: ticketId });

async function runTrash(iso) {
	const response = await fetch(`${instance.url}/api/byl-test/trash/run`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ now: Date.parse(iso) })
	});
	expect(response.status).toBe(200);
	return response.json();
}

/** A ticket made from one item with a second item linked to it. */
async function ticketWithSources(who = owner, data = {}) {
	const main = await who.item();
	const ticket = await who.ticket({ source_item: main.id, ...data });
	const linked = await who.item();
	await link(who, linked.id, ticket.id);
	return { ticket, main, linked };
}

describe('moving to the trash (ADR-0037 §2 and §3)', () => {
	it('hides a deleted ticket from every read of the client and keeps it for the trash', async () => {
		const project = await owner.project();
		const tag = await owner.pb.collection('tags').create({ owner: owner.id, name: `tag-${unique()}` });
		const ticket = await owner.ticket({ project: project.id, tags: [tag.id], title: `Papierkorb ${unique()}` });
		const comment = await owner.pb.collection('comments').create({ ticket: ticket.id, author: owner.id, body: 'Hallo' });
		await owner.pb.collection('ticket_reads').create({ user: owner.id, ticket: ticket.id });

		await owner.pb.collection('tickets').delete(ticket.id);

		const tickets = owner.pb.collection('tickets');
		expect(await statusOf(tickets.getOne(ticket.id))).toBe(404);
		const byFilter = await tickets.getList(1, 50, { filter: owner.pb.filter('id = {:id} || title ~ {:q}', { id: ticket.id, q: ticket.title }) });
		expect(byFilter.items).toEqual([]);
		const inProject = await tickets.getList(1, 50, { filter: owner.pb.filter('project = {:p}', { p: project.id }) });
		expect(inProject.totalItems).toBe(0);
		const withTag = await tickets.getList(1, 50, { filter: owner.pb.filter('tags.id ?= {:t}', { t: tag.id }) });
		expect(withTag.totalItems).toBe(0);
		expect(await statusOf(owner.pb.collection('comments').getOne(comment.id))).toBe(404);
		const history = await owner.pb.collection('ticket_history').getList(1, 50, { filter: owner.pb.filter('ticket = {:id}', { id: ticket.id }) });
		expect(history.totalItems).toBe(0);
		const reads = await owner.pb.collection('ticket_reads').getList(1, 50, { filter: owner.pb.filter('ticket = {:id}', { id: ticket.id }) });
		expect(reads.totalItems).toBe(0);
		expect(await statusOf(tickets.update(ticket.id, { title: 'Neu' }))).toBe(404);
		expect(await statusOf(tickets.delete(ticket.id))).toBe(404);
		expect((await rejection(owner.pb.collection('comments').create({ ticket: ticket.id, author: owner.id, body: 'x' }))).status).toBe(400);

		const kept = await stored('tickets', ticket.id);
		expect(kept).toMatchObject({ key: ticket.key, project: '', deleted_by: owner.id, tags: [tag.id] });
		expect(kept.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
		expect(kept.trash).toMatchObject({ project: project.id, project_code: project.code, sources: { handling: 'inbox', items: [] } });

		const { items, retention } = await trashOf(owner);
		expect(retention).toBe('');
		const entry = items.find((item) => item.id === ticket.id);
		expect(entry).toMatchObject({
			key: ticket.key,
			title: ticket.title,
			project: { id: project.id, code: project.code, name: project.name, exists: true },
			children: 0,
			deleted_by: owner.id,
			days_left: 30
		});
		expect((await trashOf(other)).items.find((item) => item.id === ticket.id)).toBeUndefined();
		expect((await historyOf(ticket.id)).at(-1)).toMatchObject({ field: 'trash', old_value: '', new_value: 'trashed', user: owner.id });
	});

	it('answers the route with the base of "Rückgängig" and takes the sub-tickets along', async () => {
		const parent = await owner.ticket();
		const open = await owner.ticket({ parent: parent.id });
		const done = await owner.ticket({ parent: parent.id, status: 'done' });

		const moved = await deleteWith(owner, parent.id, 'inbox');
		expect(moved.id).toBe(parent.id);
		expect(moved.updated).toBe((await stored('tickets', parent.id)).updated);
		expect(moved.tickets.map((ticket) => ticket.id).sort()).toEqual([parent.id, open.id, done.id].sort());

		for (const id of [open.id, done.id]) {
			expect(await statusOf(owner.pb.collection('tickets').getOne(id))).toBe(404);
			expect((await stored('tickets', id)).parent).toBe(parent.id);
		}
		const { items } = await trashOf(owner);
		expect(items.find((item) => item.id === parent.id).children).toBe(2);
		expect(items.find((item) => item.id === open.id)).toBeUndefined();
		// A sub-ticket of a group comes back only with its parent.
		const refused = await rejection(restore(owner, open.id));
		expect(refused.codes).toEqual({ id: 'validation_trash_group_member' });
		expect((await previewOf(owner, open.id)).group).toBe(parent.id);
		const preview = await previewOf(owner, parent.id);
		expect(preview.subtasks.map((child) => child.id).sort()).toEqual([open.id, done.id].sort());
	});

	it('takes a single sub-ticket out of its parent: it blocks and counts no more', async () => {
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id });
		await owner.pb.collection('tickets').delete(child.id);

		const children = await owner.pb.collection('tickets').getList(1, 10, { filter: owner.pb.filter('parent = {:p}', { p: parent.id }) });
		expect(children.totalItems).toBe(0);
		expect((await stored('tickets', child.id)).trash.parent).toBe(parent.id);
		expect((await stored('tickets', child.id)).parent).toBe('');
		const completed = await owner.pb.collection('tickets').update(parent.id, { status: 'done' });
		expect(completed.status).toBe('done');
	});

	it('gives the sources back to the inbox and notes the ticket in the trash', async () => {
		const { ticket, main, linked } = await ticketWithSources();
		await deleteWith(owner, ticket.id, 'inbox');
		for (const item of [main, linked]) {
			const back = await owner.pb.collection('inbox_items').getOne(item.id);
			expect(back).toMatchObject({ state: 'new', ticket: '' });
			expect(back.source_meta.ticket_deleted).toMatchObject({ key: ticket.key, ticket: ticket.id });
		}
		expect((await stored('tickets', ticket.id)).source_item).toBe('');
		// No "Quelle gelöst" in the history of the ticket, only the move to the trash.
		expect((await historyOf(ticket.id)).filter((entry) => entry.field === 'source_link' && entry.old_value !== '')).toEqual([]);
	});

	it('keeps discarded sources with the ticket, hidden from the inbox', async () => {
		const { ticket, main, linked } = await ticketWithSources();
		await deleteWith(owner, ticket.id, 'discard');
		for (const item of [main, linked]) {
			expect(await stored('inbox_items', item.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
			expect(await statusOf(owner.pb.collection('inbox_items').getOne(item.id))).toBe(404);
		}
		const all = await owner.pb.collection('inbox_items').getFullList({ filter: owner.pb.filter('ticket = {:t}', { t: ticket.id }) });
		expect(all).toEqual([]);
		expect((await stored('tickets', ticket.id)).source_item).toBe(main.id);
		// A duplicate names no key that cannot be opened.
		const again = await rejection(owner.item({ source_ref: main.source_ref, title: main.title }));
		expect(again.codes).toEqual({ fingerprint: 'validation_inbox_duplicate' });
		expect(again.params.fingerprint).toMatchObject({ state: 'converted', ticket: '', ticketKey: '' });
	});

	it('treats a ticket in the trash as missing for links, parents and "Wiederholen…"', async () => {
		const ticket = await owner.ticket();
		await owner.pb.collection('tickets').delete(ticket.id);
		const item = await owner.item();
		expect((await rejection(link(owner, item.id, ticket.id))).codes).toEqual({ ticket: 'validation_scope_mismatch' });
		expect((await rejection(owner.ticket({ parent: ticket.id }))).codes).toEqual({ parent: 'validation_scope_mismatch' });
		const rule = await rejection(
			owner.pb
				.collection('recurrence_rules')
				.create({ owner: owner.id, title: 'Regel', mode: 'calendar', freq: 'daily', initial_status: 'open', ticket: ticket.id })
		);
		expect(rule.codes).toEqual({ ticket: 'validation_recurrence_ticket_missing' });
	});

	it('lets no client set the fields of the trash', async () => {
		const created = await rejection(owner.ticket({ deleted_at: '2026-09-01 10:00:00.000Z' }));
		expect(created.codes).toEqual({ deleted_at: 'validation_trash_managed' });
		const ticket = await owner.ticket();
		const updated = await rejection(owner.pb.collection('tickets').update(ticket.id, { trash: { project: 'x' } }));
		expect(updated.codes).toEqual({ trash: 'validation_trash_managed' });
		expect((await stored('tickets', ticket.id)).deleted_at).toBe('');
	});

	it('sends open tabs the delete event of every hidden record and a hint of the trash', async () => {
		const { ticket, linked } = await ticketWithSources();
		const seen = [];
		const foreign = [];
		const hints = [];
		const tab = client();
		tab.authStore.save(owner.pb.authStore.token, owner.pb.authStore.record);
		const stops = [
			await tab.collection('tickets').subscribe('*', (event) => seen.push(['tickets', event.action, event.record.id]), { fields: 'id,key' }),
			await tab.collection('tickets').subscribe(ticket.id, (event) => seen.push(['ticket', event.action, event.record.id])),
			await tab.collection('inbox_items').subscribe('*', (event) => seen.push(['inbox', event.action, event.record.id])),
			await tab.realtime.subscribe('byl/trash', () => hints.push('trash')),
			await other.pb.collection('tickets').subscribe('*', (event) => foreign.push(event.record.id))
		];
		try {
			await deleteWith(owner, ticket.id, 'discard');
			const expected = [
				['tickets', 'delete', ticket.id],
				['ticket', 'delete', ticket.id],
				['inbox', 'delete', linked.id]
			];
			for (let attempt = 0; attempt < 50 && !(expected.every((entry) => seen.some((item) => item.join() === entry.join())) && hints.length > 0); attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			for (const entry of expected) expect(seen.map((item) => item.join())).toContain(entry.join());
			expect(hints.length).toBeGreaterThan(0);
			expect(foreign).toEqual([]);
		} finally {
			for (const stop of stops) await stop();
		}
	});

	it('answers 404 for a foreign or missing ticket and 401 without a session', async () => {
		const foreign = await other.ticket();
		expect(await statusOf(deleteWith(owner, foreign.id, 'inbox'))).toBe(404);
		await deleteWith(other, foreign.id, 'inbox');
		expect(await statusOf(restore(owner, foreign.id))).toBe(404);
		expect(await statusOf(purge(owner, foreign.id))).toBe(404);
		expect(await statusOf(previewOf(owner, foreign.id))).toBe(404);
		const live = await owner.ticket();
		expect(await statusOf(restore(owner, live.id))).toBe(404);
		expect(await statusOf(client().send('/api/byl/trash', { method: 'GET' }))).toBe(401);
		expect((await stored('tickets', foreign.id)).deleted_at).not.toBe('');
	});
});

describe('restoring (ADR-0037 §4 to §7)', () => {
	it('brings a ticket back with its key, project, sub-tickets and sources', async () => {
		const project = await owner.project();
		const { ticket, main, linked } = await ticketWithSources(owner, { project: project.id });
		const child = await owner.ticket({ parent: ticket.id, project: project.id });
		await deleteWith(owner, ticket.id, 'inbox');

		const result = await restore(owner, ticket.id);
		expect(result).toMatchObject({ id: ticket.id, key: ticket.key, new_keys: [], sources_skipped: [], parent_detached: false });
		const back = await owner.pb.collection('tickets').getOne(ticket.id);
		expect(back).toMatchObject({ key: ticket.key, project: project.id, source_item: main.id, deleted_at: '' });
		expect(back.trash).toBeNull();
		expect((await owner.pb.collection('tickets').getOne(child.id)).parent).toBe(ticket.id);
		for (const item of [main, linked]) {
			const source = await owner.pb.collection('inbox_items').getOne(item.id);
			expect(source).toMatchObject({ state: 'converted', ticket: ticket.id });
			expect(source.source_meta.ticket_deleted).toBeUndefined();
		}
		const entries = (await historyOf(ticket.id)).filter((entry) => entry.field === 'trash');
		expect(entries.map((entry) => entry.new_value)).toEqual(['trashed', 'restored']);
		expect((await historyOf(ticket.id)).filter((entry) => entry.field === 'project')).toEqual([]);
		expect((await trashOf(owner)).items.find((item) => item.id === ticket.id)).toBeUndefined();
	});

	it('restores discarded sources with their ticket', async () => {
		const { ticket, linked } = await ticketWithSources();
		await deleteWith(owner, ticket.id, 'discard');
		await restore(owner, ticket.id);
		expect(await owner.pb.collection('inbox_items').getOne(linked.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
	});

	it('checks expected_updated like "Rückgängig" and changes nothing on a conflict', async () => {
		const ticket = await owner.ticket();
		const moved = await deleteWith(owner, ticket.id, 'inbox');
		const stale = await rejection(restore(owner, ticket.id, { expected_updated: '2020-01-01 00:00:00.000Z' }));
		expect(stale.codes).toEqual({ id: 'validation_trash_stale' });
		expect((await stored('tickets', ticket.id)).deleted_at).not.toBe('');
		await restore(owner, ticket.id, { expected_updated: moved.updated });
		expect((await owner.pb.collection('tickets').getOne(ticket.id)).id).toBe(ticket.id);
		// Restored already: a second "Rückgängig" finds nothing.
		expect(await statusOf(restore(owner, ticket.id, { expected_updated: moved.updated }))).toBe(404);
	});

	it('skips sources that were converted, linked or discarded meanwhile and names them', async () => {
		const { ticket, main, linked } = await ticketWithSources();
		const third = await owner.item();
		await link(owner, third.id, ticket.id);
		await deleteWith(owner, ticket.id, 'inbox');
		const elsewhere = await owner.ticket({ source_item: main.id });
		await owner.pb.collection('inbox_items').update(linked.id, { state: 'discarded' });

		const result = await restore(owner, ticket.id);
		expect(result.sources_skipped.map(({ id, reason }) => ({ id, reason })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
			[
				{ id: main.id, reason: 'converted' },
				{ id: linked.id, reason: 'discarded' }
			].sort((a, b) => a.id.localeCompare(b.id))
		);
		const back = await owner.pb.collection('tickets').getOne(ticket.id);
		expect(back.source_item).toBe('');
		expect((await owner.pb.collection('inbox_items').getOne(main.id)).ticket).toBe(elsewhere.id);
		expect(await owner.pb.collection('inbox_items').getOne(third.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
	});

	it('puts a single sub-ticket back to its parent, or restores it on its own', async () => {
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id });
		await owner.pb.collection('tickets').delete(child.id);
		expect((await restore(owner, child.id)).parent_detached).toBe(false);
		expect((await owner.pb.collection('tickets').getOne(child.id)).parent).toBe(parent.id);

		await owner.pb.collection('tickets').delete(child.id);
		await owner.pb.collection('tickets').delete(parent.id);
		const alone = await restore(owner, child.id);
		expect(alone.parent_detached).toBe(true);
		expect((await owner.pb.collection('tickets').getOne(child.id)).parent).toBe('');
		const parentEntry = (await historyOf(child.id)).filter((entry) => entry.field === 'parent').at(-1);
		expect(parentEntry).toMatchObject({ old_value: parent.id, new_value: '' });
	});

	it('asks for a target project when the project is gone or has another code', async () => {
		const project = await owner.project();
		const ticket = await owner.ticket({ project: project.id });
		const child = await owner.ticket({ project: project.id, parent: ticket.id });
		await owner.pb.collection('tickets').delete(ticket.id);
		// The project has no visible tickets any more: its code may change and it may be deleted.
		const renamed = await owner.pb.collection('projects').update(project.id, { code: uniqueCode() });

		const asked = await rejection(restore(owner, ticket.id));
		expect(asked.codes).toEqual({ project: 'validation_trash_project_required' });
		expect(asked.params.project).toMatchObject({ code: project.code, reason: 'changed', key: ticket.key });

		const archived = await owner.project({ archived: true });
		expect((await rejection(restore(owner, ticket.id, { project: archived.id }))).codes).toEqual({
			project: 'validation_trash_project_invalid'
		});
		const foreign = await other.project();
		expect((await rejection(restore(owner, ticket.id, { project: foreign.id }))).codes).toEqual({
			project: 'validation_trash_project_invalid'
		});

		const result = await restore(owner, ticket.id, { project: renamed.id });
		expect(result.new_keys.map((entry) => entry.previous).sort()).toEqual([ticket.key, child.key].sort());
		const back = await owner.pb.collection('tickets').getOne(ticket.id);
		expect(back.project).toBe(renamed.id);
		expect(back.key.startsWith(`${renamed.code}-`)).toBe(true);
		expect((await historyOf(ticket.id)).filter((entry) => entry.field === 'key').at(-1)).toMatchObject({
			old_value: ticket.key,
			new_value: back.key
		});

		await owner.pb.collection('tickets').delete(ticket.id);
		await owner.pb.collection('projects').delete(renamed.id);
		expect((await rejection(restore(owner, ticket.id))).params.project.reason).toBe('missing');
		const plain = await restore(owner, ticket.id, { project: '' });
		expect(plain.key.startsWith('TASK-')).toBe(true);
		expect((await owner.pb.collection('tickets').getOne(child.id)).key.startsWith('TASK-')).toBe(true);
	});
});

describe('series (ADR-0037 §5, ADR-0022/0023)', () => {
	const rules = () => owner.pb.collection('recurrence_rules');
	const linkRule = async (ticketId, ruleId) => {
		const response = await fetch(`${instance.url}/api/byl-test/tickets/${ticketId}/link`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ rule: ruleId })
		});
		return response.status;
	};

	it('frees the unique index for the next instance and never doubles on restore', async () => {
		const instanceTicket = await owner.ticket();
		const rule = await rules().create({
			owner: owner.id,
			title: 'Blumen',
			mode: 'calendar',
			freq: 'daily',
			lead_days: 0,
			active: false,
			initial_status: 'open',
			ticket: instanceTicket.id
		});
		const second = await owner.ticket();
		expect(await linkRule(second.id, rule.id)).toBe(400);

		await owner.pb.collection('tickets').delete(instanceTicket.id);
		expect((await stored('tickets', instanceTicket.id)).trash.recurrence).toBe(rule.id);
		expect(await linkRule(second.id, rule.id)).toBe(200);
		// The index ignores the trash even with the rule set on a ticket in it.
		expect(await linkRule(instanceTicket.id, rule.id)).toBe(200);
		expect(await linkRule(instanceTicket.id, '')).toBe(200);

		const conflict = await rejection(restore(owner, instanceTicket.id));
		expect(conflict.codes).toEqual({ recurrence: 'validation_trash_series_conflict' });
		expect(conflict.params.recurrence).toMatchObject({ key: second.key, ticket: second.id });
		expect((await stored('tickets', instanceTicket.id)).deleted_at).not.toBe('');

		const detached = await restore(owner, instanceTicket.id, { detach_series: true });
		expect(detached.series_detached).toEqual([instanceTicket.key]);
		expect((await owner.pb.collection('tickets').getOne(instanceTicket.id)).recurrence).toBe('');
		expect((await owner.pb.collection('tickets').getOne(second.id)).recurrence).toBe(rule.id);
	});

	it('restores an instance into its series when nothing stands against it and keeps next_due', async () => {
		const ticket = await owner.ticket();
		const rule = await rules().create({
			owner: owner.id,
			title: 'Nach Erledigung',
			mode: 'after_completion',
			freq: 'weekly',
			interval: 2,
			lead_days: 0,
			active: false,
			initial_status: 'open',
			ticket: ticket.id
		});
		const before = (await stored('recurrence_rules', rule.id)).next_due;
		await owner.pb.collection('tickets').delete(ticket.id);
		// Like deleting the open instance: "nach Erledigung" waits as if it was done today.
		const released = (await stored('recurrence_rules', rule.id)).next_due;
		expect(released).not.toBe(before);

		await restore(owner, ticket.id);
		expect((await owner.pb.collection('tickets').getOne(ticket.id)).recurrence).toBe(rule.id);
		expect((await stored('recurrence_rules', rule.id)).next_due).toBe(released);

		await owner.pb.collection('tickets').delete(ticket.id);
		await rules().delete(rule.id);
		const result = await restore(owner, ticket.id);
		expect(result.rule_missing).toEqual([ticket.key]);
		expect((await owner.pb.collection('tickets').getOne(ticket.id)).recurrence).toBe('');
	});
});

describe('deleting for good (ADR-0037 §8 and §9)', () => {
	it('deletes a done group with history, comments and read rows; sources given back stay in the inbox', async () => {
		const { ticket, main, linked } = await ticketWithSources(owner, { status: 'done' });
		const child = await owner.ticket({ parent: ticket.id, status: 'done' });
		const comment = await owner.pb.collection('comments').create({ ticket: ticket.id, author: owner.id, body: 'Weg' });
		await owner.pb.collection('ticket_reads').create({ user: owner.id, ticket: ticket.id });
		await deleteWith(owner, ticket.id, 'inbox');

		await purge(owner, ticket.id);
		for (const id of [ticket.id, child.id]) {
			expect(await statusOf(stored('tickets', id))).toBe(404);
		}
		expect(await statusOf(stored('comments', comment.id))).toBe(404);
		expect(await historyOf(ticket.id)).toEqual([]);
		for (const item of [main, linked]) {
			expect(await owner.pb.collection('inbox_items').getOne(item.id)).toMatchObject({ state: 'new', ticket: '' });
		}
		expect(await statusOf(purge(owner, ticket.id))).toBe(404);
	});

	it('empties only the own trash', async () => {
		const user = await createUser();
		const mine = await user.ticket({ status: 'done' });
		const theirs = await other.ticket({ status: 'done' });
		await user.pb.collection('tickets').delete(mine.id);
		await other.pb.collection('tickets').delete(theirs.id);
		const { purged, blocked } = await route(user, '/api/byl/trash/empty', {});
		expect({ purged, blocked }).toEqual({ purged: 1, blocked: [] });
		expect((await trashOf(user)).items).toEqual([]);
		expect(await statusOf(stored('tickets', mine.id))).toBe(404);
		expect((await stored('tickets', theirs.id)).deleted_at).not.toBe('');
	});

	it('deletes after the retention of the owner, daily and idempotent', async () => {
		const user = await createUser();
		const ticket = await user.ticket({ status: 'done' });
		await user.pb.collection('tickets').delete(ticket.id);
		const deletedAt = (await stored('tickets', ticket.id)).deleted_at;
		const day = (offset) => new Date(Date.parse(deletedAt.replace(' ', 'T')) + offset * 86_400_000).toISOString();

		expect((await trashOf(user)).items[0].days_left).toBe(30);
		await runTrash(day(20));
		expect((await stored('tickets', ticket.id)).id).toBe(ticket.id);

		await user.pb.collection('users').update(user.id, { trash_retention: '7' });
		expect((await trashOf(user)).retention).toBe('7');
		expect((await trashOf(user)).items[0].days_left).toBe(7);
		await user.pb.collection('users').update(user.id, { trash_retention: 'never' });
		expect((await trashOf(user)).items[0].days_left).toBeNull();
		await runTrash(day(400));
		expect((await stored('tickets', ticket.id)).id).toBe(ticket.id);

		await user.pb.collection('users').update(user.id, { trash_retention: '7' });
		const run = await runTrash(day(8));
		expect(run.purged).toBeGreaterThanOrEqual(1);
		expect(await statusOf(stored('tickets', ticket.id))).toBe(404);
		expect((await runTrash(day(8))).failed).toBe(0);
		expect((await rejection(user.pb.collection('users').update(user.id, { trash_retention: '14' }))).status).toBe(400);
	});

	it('deletes a ticket of the trash for good through the admin UI', async () => {
		const ticket = await owner.ticket({ status: 'done' });
		await owner.pb.collection('tickets').delete(ticket.id);
		await superuser.collection('tickets').delete(ticket.id);
		expect(await statusOf(stored('tickets', ticket.id))).toBe(404);
	});
});

describe('dependencies before deleting for good (ADR-0047)', () => {
	const resolve = (who, id, actions) => route(who, `/api/byl/trash/${id}/resolve`, { actions });

	/** An open ticket with an open sub-task, a done one, and both sources discarded with it. */
	async function blockedGroup(who = owner) {
		const { ticket, main, linked } = await ticketWithSources(who);
		const open = await who.ticket({ parent: ticket.id });
		const done = await who.ticket({ parent: ticket.id, status: 'done' });
		await deleteWith(who, ticket.id, 'discard');
		return { ticket, open, done, main, linked };
	}

	it('counts and lists the dependencies with the options our rules allow', async () => {
		const { ticket, open, main, linked } = await blockedGroup();
		expect((await trashOf(owner)).items.find((item) => item.id === ticket.id).dependencies).toBe(4);
		const { dependency_list: list } = await previewOf(owner, ticket.id);
		expect(list.map((entry) => [entry.kind, entry.ticket, entry.item ?? '', entry.options])).toEqual([
			['ticket', ticket.id, '', ['complete_children', 'restore']],
			['ticket', open.id, '', ['complete', 'restore', 'detach']],
			['source', ticket.id, main.id, ['inbox', 'discard']],
			['source', ticket.id, linked.id, ['inbox', 'discard', 'move']]
		]);
		expect(list[2]).toMatchObject({ primary: true, key: ticket.key, channel: 'telegram', scope: `u:${owner.id}` });
		// A sub-task of a group has none of its own: its group decides.
		expect((await previewOf(owner, open.id)).dependency_list).toEqual([]);
	});

	it('refuses "Endgültig löschen" with the list and changes nothing', async () => {
		const { ticket, open, linked } = await blockedGroup();
		const refused = await rejection(purge(owner, ticket.id));
		expect(refused.status).toBe(400);
		expect(refused.codes).toEqual({ id: 'validation_trash_blocked' });
		expect(refused.params.id).toMatchObject({ key: ticket.key, ticket: ticket.id, count: 4, tickets: 2, sources: 2 });
		expect(refused.params.id.dependencies.map((entry) => entry.kind)).toEqual(['ticket', 'ticket', 'source', 'source']);
		for (const id of [ticket.id, open.id]) {
			expect((await stored('tickets', id)).deleted_at).not.toBe('');
		}
		expect(await stored('inbox_items', linked.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
		// The admin UI deletes nothing blocked either.
		expect((await rejection(superuser.collection('tickets').delete(ticket.id))).codes).toEqual({ id: 'validation_trash_blocked' });
		expect((await stored('tickets', ticket.id)).id).toBe(ticket.id);
	});

	it('blocks a done ticket for an open sub-task and for a source discarded with it', async () => {
		const parent = await owner.ticket({ status: 'done' });
		await owner.ticket({ parent: parent.id });
		await deleteWith(owner, parent.id, 'inbox');
		expect((await rejection(purge(owner, parent.id))).params.id).toMatchObject({ tickets: 1, sources: 0 });

		const { ticket } = await ticketWithSources(owner, { status: 'done' });
		await deleteWith(owner, ticket.id, 'discard');
		expect((await rejection(purge(owner, ticket.id))).params.id).toMatchObject({ tickets: 0, sources: 2 });
	});

	it('keeps blocked tickets when emptying the trash and names them', async () => {
		const user = await createUser();
		const free = await user.ticket({ status: 'done' });
		const open = await user.ticket();
		await user.pb.collection('tickets').delete(free.id);
		await user.pb.collection('tickets').delete(open.id);
		const result = await route(user, '/api/byl/trash/empty', {});
		expect(result).toEqual({ purged: 1, blocked: [{ id: open.id, key: open.key, count: 1 }] });
		expect((await trashOf(user)).items.map((item) => item.id)).toEqual([open.id]);
	});

	it('lets the daily run skip blocked tickets until they are decided', async () => {
		const user = await createUser();
		const ticket = await user.ticket();
		await user.pb.collection('tickets').delete(ticket.id);
		await user.pb.collection('users').update(user.id, { trash_retention: '7' });
		const deletedAt = (await stored('tickets', ticket.id)).deleted_at;
		const later = new Date(Date.parse(deletedAt.replace(' ', 'T')) + 9 * 86_400_000).toISOString();

		const kept = await runTrash(later);
		expect(kept.blocked).toBeGreaterThanOrEqual(1);
		expect((await stored('tickets', ticket.id)).deleted_at).not.toBe('');
		expect((await trashOf(user)).items[0]).toMatchObject({ id: ticket.id, dependencies: 1 });

		await resolve(user, ticket.id, [{ action: 'complete', ticket: ticket.id }]);
		await runTrash(later);
		expect(await statusOf(stored('tickets', ticket.id))).toBe(404);
	});

	it('marks done in the trash with the rules of sub-tasks and the history of the user', async () => {
		const { ticket, open, done } = await blockedGroup();
		const refused = await rejection(resolve(owner, ticket.id, [{ action: 'complete', ticket: ticket.id }]));
		expect(refused.codes).toEqual({ status: 'validation_parent_open_children' });
		expect(refused.params.status).toMatchObject({ count: 1, keys: [open.key] });
		expect((await stored('tickets', ticket.id)).status).toBe('open');

		const after = await resolve(owner, ticket.id, [{ action: 'complete', ticket: ticket.id, complete_children: true }]);
		expect(after.dependency_list.map((entry) => entry.kind)).toEqual(['source', 'source']);
		for (const id of [ticket.id, open.id]) {
			const ticketNow = await stored('tickets', id);
			expect(ticketNow).toMatchObject({ status: 'done' });
			expect(ticketNow.completed_at).not.toBe('');
			expect(ticketNow.deleted_at).not.toBe('');
			expect((await historyOf(id)).at(-1)).toMatchObject({ field: 'status', new_value: 'done', user: owner.id });
		}
		expect((await stored('tickets', done.id)).status).toBe('done');
		// Still hidden from every read of the client.
		expect(await statusOf(owner.pb.collection('tickets').getOne(ticket.id))).toBe(404);
	});

	it('gives sources back, discards or moves them, but never moves the main source', async () => {
		const { ticket, main, linked } = await blockedGroup();
		const target = await owner.ticket();

		const primary = await rejection(resolve(owner, ticket.id, [{ action: 'move', item: main.id, target: target.id }]));
		expect(primary.codes).toEqual({ actions: 'validation_trash_resolve_primary' });
		const trashed = await rejection(resolve(owner, ticket.id, [{ action: 'move', item: linked.id, target: ticket.id }]));
		expect(trashed.codes).toEqual({ actions: 'validation_trash_resolve_target' });
		const foreign = await other.ticket();
		const scope = await rejection(resolve(owner, ticket.id, [{ action: 'move', item: linked.id, target: foreign.id }]));
		expect(scope.codes).toEqual({ ticket: 'validation_scope_mismatch' });
		expect((await rejection(resolve(owner, ticket.id, []))).codes).toEqual({ actions: 'validation_trash_resolve_empty' });
		expect((await rejection(resolve(owner, ticket.id, [{ action: 'delete', item: main.id }]))).codes).toEqual({
			actions: 'validation_trash_resolve_action'
		});
		expect(await stored('inbox_items', linked.id)).toMatchObject({ state: 'converted', ticket: ticket.id });

		await resolve(owner, ticket.id, [{ action: 'move', item: linked.id, target: target.id }]);
		expect(await owner.pb.collection('inbox_items').getOne(linked.id)).toMatchObject({ state: 'converted', ticket: target.id });
		const movedTo = (await historyOf(ticket.id)).find((entry) => entry.field === 'source_link' && entry.old_value.includes('moved_to'));
		expect(JSON.parse(movedTo.old_value)).toMatchObject({ item: linked.id, moved_to: { ticket: target.id, key: target.key } });
		const movedFrom = (await historyOf(target.id)).find((entry) => entry.field === 'source_link');
		expect(JSON.parse(movedFrom.new_value)).toMatchObject({ item: linked.id, moved_from: { ticket: ticket.id } });

		const after = await resolve(owner, ticket.id, [{ action: 'discard', item: main.id }]);
		expect(after.dependency_list.filter((entry) => entry.kind === 'source')).toEqual([]);
		const discarded = await owner.pb.collection('inbox_items').getOne(main.id);
		expect(discarded).toMatchObject({ state: 'discarded', ticket: '' });
		expect(discarded.source_meta.ticket_deleted).toMatchObject({ key: ticket.key, ticket: ticket.id });
		expect(discarded.title).toBe(main.title);
		expect((await stored('tickets', ticket.id)).source_item).toBe('');
		expect((await historyOf(ticket.id)).at(-1)).toMatchObject({ field: 'source_link', new_value: '', user: owner.id });
		// The same entry twice: no longer a dependency.
		expect((await rejection(resolve(owner, ticket.id, [{ action: 'inbox', item: main.id }]))).codes).toEqual({
			actions: 'validation_trash_resolve_target'
		});
	});

	it('links sources given back one by one again on restore, the main source as main source', async () => {
		const { ticket, main, linked } = await blockedGroup();
		await resolve(owner, ticket.id, [
			{ action: 'inbox', item: main.id },
			{ action: 'inbox', item: linked.id }
		]);
		for (const item of [main, linked]) {
			expect(await owner.pb.collection('inbox_items').getOne(item.id)).toMatchObject({ state: 'new', ticket: '' });
		}
		expect((await stored('tickets', ticket.id)).trash.sources.returned).toEqual([main.id, linked.id]);
		const result = await restore(owner, ticket.id);
		expect(result.sources_skipped).toEqual([]);
		expect((await owner.pb.collection('tickets').getOne(ticket.id)).source_item).toBe(main.id);
		for (const item of [main, linked]) {
			expect(await owner.pb.collection('inbox_items').getOne(item.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
		}
	});

	it('restores a sub-task of a group on its own and leaves the group in the trash', async () => {
		const { ticket, open } = await blockedGroup();
		expect((await rejection(restore(owner, open.id))).codes).toEqual({ id: 'validation_trash_group_member' });
		const result = await restore(owner, open.id, { detach_parent: true });
		expect(result).toMatchObject({ id: open.id, parent_detached: true });
		expect(await owner.pb.collection('tickets').getOne(open.id)).toMatchObject({ parent: '', deleted_at: '' });
		expect((await historyOf(open.id)).filter((entry) => entry.field === 'parent').at(-1)).toMatchObject({
			old_value: ticket.id,
			new_value: ''
		});
		const preview = await previewOf(owner, ticket.id);
		expect(preview.children).toBe(1);
		expect(preview.dependency_list.filter((entry) => entry.kind === 'ticket').map((entry) => entry.ticket)).toEqual([ticket.id]);
	});

	it('deletes for good once everything is decided in one request', async () => {
		const { ticket, open, done, main, linked } = await blockedGroup();
		await resolve(owner, ticket.id, [
			{ action: 'complete', ticket: open.id },
			{ action: 'complete', ticket: ticket.id },
			{ action: 'discard', item: main.id },
			{ action: 'inbox', item: linked.id }
		]);
		expect((await previewOf(owner, ticket.id)).dependency_list).toEqual([]);
		await purge(owner, ticket.id);
		for (const id of [ticket.id, open.id, done.id]) {
			expect(await statusOf(stored('tickets', id))).toBe(404);
		}
		expect(await owner.pb.collection('inbox_items').getOne(main.id)).toMatchObject({ state: 'discarded' });
		expect(await owner.pb.collection('inbox_items').getOne(linked.id)).toMatchObject({ state: 'new', ticket: '' });
	});

	it('answers 404 for a foreign ticket and refuses a sub-task of a group', async () => {
		const { ticket, open } = await blockedGroup();
		expect(await statusOf(resolve(other, ticket.id, [{ action: 'complete', ticket: open.id }]))).toBe(404);
		expect((await rejection(resolve(owner, open.id, [{ action: 'complete', ticket: open.id }]))).codes).toEqual({
			id: 'validation_trash_group_member'
		});
	});
});
