// "Ticket duplizieren" (ADR-0045) against the shared disposable instance: the route creates the
// duplicate with everything chosen in one transaction (sub-tickets, comments, the copy of the main
// source) or nothing; every option, the new key, the history of both tickets, the rights, the
// trash, and the copy of a source with a fingerprint of its own, so the duplicate check of the
// original is neither blocked nor answered by it.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, rejectionOf, statusOf, superuserClient, userClient } from '../support/api.mjs';
import {
	FAIL_DUPLICATE,
	counterValue,
	createOwner,
	createScenario,
	historyOf,
	scopeOf,
	uniqueCode,
	uniqueSuffix
} from '../support/scenario.mjs';
import { DataError } from '../../web/src/lib/data/errors.ts';
import { duplicateTicket } from '../../web/src/lib/data/tickets.ts';

let superuser;
let owner;
const rulesToPause = [];

const NOTHING = { description: false, priority: false, tags: false, due: false, parent: false, subtasks: false, comments: false };
const EVERYTHING = { description: true, priority: true, tags: true, due: true, parent: true, subtasks: true, comments: true };

/** Sends the route with the body as the SPA would, flags and status first. */
function duplicate(client, ticketId, body) {
	return client.send(`/api/byl/tickets/${ticketId}/duplicate`, {
		method: 'POST',
		body: { title: 'Kopie', status: 'open', source: 'none', ...NOTHING, ...body }
	});
}

const ticketOf = (id) => superuser.collection('tickets').getOne(id);
const itemOf = (id) => superuser.collection('inbox_items').getOne(id);
const childrenOf = (id) =>
	superuser.collection('tickets').getFullList({ filter: superuser.filter('parent = {:id}', { id }), sort: 'created,@rowid' });
const commentsOf = (id) =>
	superuser.collection('comments').getFullList({ filter: superuser.filter('ticket = {:id}', { id }), sort: 'created,@rowid' });
const duplicateEntries = async (id) =>
	(await historyOf(superuser, id))
		.filter((entry) => entry.field === 'duplicate')
		.map((entry) => ({ value: JSON.parse(entry.new_value), user: entry.user, old: entry.old_value }));

/** Everything of an owner the duplication could have created. */
async function countsOf(who) {
	const filter = superuser.filter('owner = {:id}', { id: who.id });
	const tickets = await superuser.collection('tickets').getList(1, 1, { filter });
	const items = await superuser.collection('inbox_items').getList(1, 1, { filter });
	const comments = await superuser
		.collection('comments')
		.getList(1, 1, { filter: superuser.filter('ticket.owner = {:id}', { id: who.id }) });
	return { tickets: tickets.totalItems, items: items.totalItems, comments: comments.totalItems };
}

/** A mail entry with its original file, and a ticket made from it (the main source). */
async function ticketFromMail(who, data = {}) {
	const messageId = `<${uniqueSuffix()}@example.com>`;
	const form = new FormData();
	form.set('owner', who.id);
	form.set('channel', 'eml');
	form.set('kind', 'mail');
	form.set('title', `Rechnung ${uniqueSuffix()}`);
	form.set('body', 'Guten Tag, anbei die Rechnung.');
	form.set('source_ref', messageId);
	form.set('source_meta', JSON.stringify({ from: 'anna@example.com' }));
	form.set('original', new Blob([`Subject: Rechnung\r\nMessage-ID: ${messageId}\r\n\r\nText\r\n`]), 'mail.eml');
	const item = await who.client.collection('inbox_items').create(form);
	const ticket = await who.ticket({ source_item: item.id, ...data });
	return { item: await itemOf(item.id), ticket, messageId };
}

/** The same mail once more, as a new import would bring it. */
function importAgain(who, messageId) {
	return who.client.collection('inbox_items').create({
		owner: who.id,
		channel: 'mail',
		kind: 'mail',
		title: 'Rechnung, noch einmal',
		source_ref: messageId
	});
}

async function download(who, record) {
	const token = await who.client.files.getToken();
	const response = await fetch(who.client.files.getURL(record, record.original, { token }));
	expect(response.status).toBe(200);
	return response.text();
}

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
});

afterAll(async () => {
	for (const id of rulesToPause) {
		await superuser.collection('recurrence_rules').update(id, { active: false });
	}
});

describe('the duplicate and what it takes over', () => {
	it('creates a new ticket with only title and status, and leaves the original alone', async () => {
		const project = await owner.project(uniqueCode());
		const tag = await owner.tag(`tag-${uniqueSuffix()}`);
		const original = await owner.ticket({
			title: 'Rasen mähen',
			description: 'Mit Fangkorb',
			priority: 'high',
			status: 'waiting',
			due: '2026-10-05 00:00:00.000Z',
			project: project.id,
			tags: [tag.id]
		});
		const answer = await duplicate(owner.client, original.id, { title: '  Rasen mähen (Kopie) ', status: 'backlog' });

		const copy = await ticketOf(answer.id);
		expect(copy).toMatchObject({
			title: 'Rasen mähen (Kopie)',
			description: '',
			status: 'backlog',
			priority: 'medium',
			due: '',
			project: '',
			tags: [],
			parent: '',
			recurrence: '',
			source: 'manual',
			source_item: '',
			owner: owner.id,
			scope: scopeOf(owner.id)
		});
		expect(copy.key).toMatch(/^TASK-\d+$/);
		expect(answer).toMatchObject({ key: copy.key, title: copy.title, original: { id: original.id, key: original.key }, subtasks: [], comments: 0, source: '' });
		const after = await ticketOf(original.id);
		expect(after.updated).toBe(original.updated);
		expect(after.status).toBe('waiting');
	});

	it('takes description, priority, tags, due date and project over, with a new key in the project', async () => {
		const project = await owner.project(uniqueCode());
		const tag = await owner.tag(`tag-${uniqueSuffix()}`);
		const original = await owner.ticket({
			description: 'Mit **Fangkorb**',
			priority: 'urgent',
			due: '2026-10-05 00:00:00.000Z',
			project: project.id,
			tags: [tag.id]
		});
		const answer = await duplicate(owner.client, original.id, {
			...EVERYTHING,
			subtasks: false,
			comments: false,
			project: project.id,
			status: 'in_progress'
		});
		const copy = await ticketOf(answer.id);
		expect(copy).toMatchObject({
			description: 'Mit **Fangkorb**',
			priority: 'urgent',
			due: '2026-10-05 00:00:00.000Z',
			project: project.id,
			tags: [tag.id],
			status: 'in_progress',
			completed_at: ''
		});
		expect(original.key).toBe(`${project.code}-1`);
		expect(copy.key).toBe(`${project.code}-2`);
		expect(await counterValue(superuser, `${scopeOf(owner.id)}:${project.id}`)).toBe(2);
	});

	it('puts the duplicate into another project, and refuses an archived one', async () => {
		const from = await owner.project(uniqueCode());
		const to = await owner.project(uniqueCode());
		const archived = await owner.project(uniqueCode(), { archived: true });
		const original = await owner.ticket({ project: from.id });
		const answer = await duplicate(owner.client, original.id, { project: to.id });
		expect(answer.key).toBe(`${to.code}-1`);
		const refused = await rejectionOf(duplicate(owner.client, original.id, { project: archived.id }));
		expect(refused).toEqual({ status: 400, codes: { project: 'validation_project_archived' } });
	});

	it('asks for the status: none, "done" or an unknown one create nothing', async () => {
		const original = await owner.ticket({ status: 'done' });
		const before = await countsOf(owner);
		expect(await rejectionOf(duplicate(owner.client, original.id, { status: '' }))).toEqual({
			status: 400,
			codes: { status: 'validation_duplicate_status_required' }
		});
		expect(await rejectionOf(duplicate(owner.client, original.id, { status: undefined }))).toEqual({
			status: 400,
			codes: { status: 'validation_duplicate_status_required' }
		});
		for (const status of ['done', 'fertig']) {
			expect((await rejectionOf(duplicate(owner.client, original.id, { status }))).codes).toEqual({
				status: 'validation_duplicate_status'
			});
		}
		expect((await rejectionOf(duplicate(owner.client, original.id, { title: '   ' }))).codes).toEqual({
			title: 'validation_duplicate_title'
		});
		expect((await rejectionOf(duplicate(owner.client, original.id, { source: 'alle' }))).codes).toEqual({
			source: 'validation_duplicate_source'
		});
		expect(await countsOf(owner)).toEqual(before);
		// A done original may start again as open work.
		const answer = await duplicate(owner.client, original.id, { status: 'open' });
		expect(await ticketOf(answer.id)).toMatchObject({ status: 'open', completed_at: '' });
	});

	it('never takes the series along: the duplicate is a plain ticket', async () => {
		const original = await owner.ticket({ title: `Serie ${uniqueSuffix()}` });
		const rule = await owner.client.collection('recurrence_rules').create({
			owner: owner.id,
			title: original.title,
			mode: 'after_completion',
			freq: 'weekly',
			interval: 1,
			initial_status: 'open',
			ticket: original.id
		});
		rulesToPause.push(rule.id);
		expect((await ticketOf(original.id)).recurrence).toBe(rule.id);
		const answer = await duplicate(owner.client, original.id, EVERYTHING);
		expect(await ticketOf(answer.id)).toMatchObject({ recurrence: '', occurrence: '' });
	});

	it('keeps a sub-ticket below its parent only when asked', async () => {
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id, blocks_parent: false });
		const below = await duplicate(owner.client, child.id, { parent: true });
		expect(await ticketOf(below.id)).toMatchObject({ parent: parent.id, blocks_parent: false });
		const alone = await duplicate(owner.client, child.id, { parent: false, subtasks: true });
		expect(await ticketOf(alone.id)).toMatchObject({ parent: '', blocks_parent: true });
		expect(alone.subtasks).toEqual([]);
	});

	it('writes "Dupliziert aus" into the duplicate and "Dupliziert nach" into the original, with the user', async () => {
		const original = await owner.ticket();
		const answer = await duplicate(owner.client, original.id, {});
		const created = (await historyOf(superuser, answer.id)).map((entry) => entry.field);
		expect(created.sort()).toEqual(['created', 'duplicate']);
		expect(await duplicateEntries(answer.id)).toEqual([
			{ value: { direction: 'from', ticket: original.id, key: original.key }, user: owner.id, old: '' }
		]);
		expect(await duplicateEntries(original.id)).toEqual([
			{ value: { direction: 'to', ticket: answer.id, key: answer.key }, user: owner.id, old: '' }
		]);
		// The original itself does not change (a follow-up of a series stays untouched).
		expect((await ticketOf(original.id)).updated).toBe(original.updated);
	});

	it('tells open tabs about the duplicate and its sub-tickets by realtime after the commit', async () => {
		const tab = await userClient(owner);
		const created = new Set();
		await tab.collection('tickets').subscribe('*', (event) => {
			if (event.action === 'create') created.add(event.record.id);
		});
		try {
			const original = await owner.ticket();
			await owner.ticket({ parent: original.id });
			const answer = await duplicate(owner.client, original.id, { subtasks: true });
			const expected = [answer.id, ...answer.subtasks.map((child) => child.id)];
			await vi.waitFor(() => expect(expected.every((id) => created.has(id))).toBe(true), { timeout: 5_000 });
		} finally {
			await tab.realtime.unsubscribe();
		}
	});

	it('goes through the data layer of the SPA', async () => {
		const original = await owner.ticket({ description: 'Text' });
		const take = { ...NOTHING, description: true };
		const outcome = await duplicateTicket(owner.client, original.id, {
			title: 'Über die SPA',
			status: 'waiting',
			project: null,
			take,
			source: 'none'
		});
		expect(outcome).toMatchObject({ title: 'Über die SPA', original: { id: original.id }, source: null });
		expect(await ticketOf(outcome.id)).toMatchObject({ description: 'Text', status: 'waiting' });
		let failure;
		try {
			await duplicateTicket(owner.client, original.id, { title: '', status: 'open', project: null, take, source: 'none' });
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(DataError);
		expect(failure.fields.title).toMatchObject({
			code: 'validation_duplicate_title',
			message: 'Bitte einen Titel mit höchstens 200 Zeichen angeben.'
		});
	});
});

describe('sub-tickets and comments', () => {
	it('makes new, open sub-tickets in the order of the original, in the project of the duplicate', async () => {
		const project = await owner.project(uniqueCode());
		const tag = await owner.tag(`tag-${uniqueSuffix()}`);
		const original = await owner.ticket({ project: project.id });
		const first = await owner.ticket({ parent: original.id, title: 'Erst', status: 'done', priority: 'high', tags: [tag.id] });
		const second = await owner.ticket({ parent: original.id, title: 'Dann', blocks_parent: false, description: 'Notiz' });
		const target = await owner.project(uniqueCode());

		const answer = await duplicate(owner.client, original.id, { subtasks: true, priority: true, tags: true, project: target.id });
		const children = await childrenOf(answer.id);
		expect(children.map((child) => child.title)).toEqual(['Erst', 'Dann']);
		expect(children[0]).toMatchObject({ status: 'open', completed_at: '', priority: 'high', tags: [tag.id], project: target.id, blocks_parent: true, recurrence: '' });
		expect(children[1]).toMatchObject({ status: 'open', blocks_parent: false, description: '', project: target.id });
		expect(answer.subtasks).toEqual(children.map((child) => ({ id: child.id, key: child.key })));
		expect(children.map((child) => child.key)).toEqual([`${target.code}-2`, `${target.code}-3`]);
		// The sub-tickets of the original stay where they are.
		expect((await childrenOf(original.id)).map((child) => child.id)).toEqual([first.id, second.id]);
		const without = await duplicate(owner.client, original.id, {});
		expect(await childrenOf(without.id)).toEqual([]);
	});

	it('copies the comments with a note, their author and time, and pins the copy of the pinned one', async () => {
		const original = await owner.ticket();
		const older = await owner.client.collection('comments').create({ ticket: original.id, author: owner.id, body: 'Erster' });
		const pinned = await owner.client.collection('comments').create({ ticket: original.id, author: owner.id, body: 'Wichtig' });
		await owner.client.collection('tickets').update(original.id, { pinned_comment: pinned.id });

		const answer = await duplicate(owner.client, original.id, { comments: true });
		expect(answer.comments).toBe(2);
		const copies = await commentsOf(answer.id);
		const note = `_Kopiert aus [${original.key}](/tickets/${original.id})._\n\n`;
		expect(copies.map((comment) => comment.body)).toEqual([`${note}Erster`, `${note}Wichtig`]);
		expect(copies.map((comment) => [comment.author, comment.created, comment.updated])).toEqual(
			[older, pinned].map((comment) => [comment.author, comment.created, comment.updated])
		);
		const copy = await ticketOf(answer.id);
		expect(copy.pinned_comment).toBe(copies[1].id);
		const fields = (await historyOf(superuser, answer.id)).map((entry) => `${entry.field}:${entry.user}`);
		expect(fields.sort()).toEqual([`created:${owner.id}`, `duplicate:${owner.id}`, `pinned_comment:${owner.id}`]);
		// The originals stay, and the author may still change the copy of the text.
		expect((await commentsOf(original.id)).map((comment) => comment.id)).toEqual([older.id, pinned.id]);
		const edited = await owner.client.collection('comments').update(copies[0].id, { body: 'Geändert' });
		expect(edited.body).toBe('Geändert');
		const none = await duplicate(owner.client, original.id, {});
		expect(await commentsOf(none.id)).toEqual([]);
		expect((await ticketOf(none.id)).pinned_comment).toBe('');
	});
});

describe('the source of the duplicate', () => {
	it('takes no source by default', async () => {
		const { ticket, item } = await ticketFromMail(owner);
		const answer = await duplicate(owner.client, ticket.id, {});
		expect(await ticketOf(answer.id)).toMatchObject({ source: 'manual', source_item: '' });
		expect(await itemOf(item.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
	});

	it('copies the main source as a new entry of its own: text, details and original file, marked as copy', async () => {
		const { ticket, item } = await ticketFromMail(owner);
		const answer = await duplicate(owner.client, ticket.id, { source: 'copy' });
		expect(answer.source).not.toBe('');
		const copy = await itemOf(answer.source);
		expect(copy).toMatchObject({
			channel: item.channel,
			kind: item.kind,
			title: item.title,
			body: item.body,
			source_ref: item.source_ref,
			source_date: item.source_date,
			state: 'converted',
			ticket: answer.id,
			connection: '',
			owner: owner.id,
			scope: item.scope
		});
		expect(copy.id).not.toBe(item.id);
		expect(copy.fingerprint).not.toBe(item.fingerprint);
		expect(copy.handled_at).not.toBe('');
		expect(copy.source_meta).toMatchObject({
			from: 'anna@example.com',
			copy_of: { item: item.id, ticket: ticket.id, key: ticket.key }
		});
		expect(await download(owner, copy)).toBe(await download(owner, item));
		expect(await ticketOf(answer.id)).toMatchObject({ source: 'eml', source_item: copy.id });
		// The original keeps its source.
		expect(await itemOf(item.id)).toMatchObject({ state: 'converted', ticket: ticket.id, fingerprint: item.fingerprint });
		expect((await ticketOf(ticket.id)).source_item).toBe(item.id);
	});

	it('neither blocks nor answers the duplicate check of the original, also as tombstones', async () => {
		const { ticket, item, messageId } = await ticketFromMail(owner);
		const first = await duplicate(owner.client, ticket.id, { source: 'copy' });
		const second = await duplicate(owner.client, ticket.id, { source: 'copy' });
		const copies = [await itemOf(first.source), await itemOf(second.source)];
		expect(new Set([item.fingerprint, ...copies.map((copy) => copy.fingerprint)]).size).toBe(3);

		const again = await rejectionOf(importAgain(owner, messageId));
		expect(again.codes).toEqual({ fingerprint: 'validation_inbox_duplicate' });

		// The duplicate goes to the trash with its source discarded, and for good: the copy becomes a
		// tombstone of its own. A new import still meets the original entry.
		await owner.client.send(`/api/byl/tickets/${first.id}/delete`, { method: 'POST', body: { sources: 'discard' } });
		await owner.client.send(`/api/byl/trash/${first.id}/purge`, { method: 'POST' });
		expect(await itemOf(first.source)).toMatchObject({ state: 'discarded', fingerprint: copies[0].fingerprint });
		let failure;
		try {
			await importAgain(owner, messageId);
		} catch (error) {
			failure = error;
		}
		expect(failure.response.data.fingerprint.params).toMatchObject({ item: item.id, ticketKey: ticket.key });

		// The original goes for good with its sources discarded: its tombstone still blocks.
		await owner.client.send(`/api/byl/tickets/${ticket.id}/delete`, { method: 'POST', body: { sources: 'discard' } });
		await owner.client.send(`/api/byl/trash/${ticket.id}/purge`, { method: 'POST' });
		failure = undefined;
		try {
			await importAgain(owner, messageId);
		} catch (error) {
			failure = error;
		}
		expect(failure.response.data.fingerprint.params).toMatchObject({ state: 'discarded', item: item.id });
		// The second duplicate keeps its copy.
		expect(await itemOf(second.source)).toMatchObject({ state: 'converted', ticket: second.id });
	});

	it('copies a source without a file, and refuses to copy what is not there', async () => {
		const item = await owner.client.collection('inbox_items').create({
			owner: owner.id,
			channel: 'telegram',
			kind: 'message',
			title: 'Nachricht',
			body: 'Bitte anrufen',
			source_ref: `42:${uniqueSuffix()}`,
			source_meta: { chat: 'Familie', sender: 'Ben' }
		});
		const ticket = await owner.ticket({ source_item: item.id });
		const answer = await duplicate(owner.client, ticket.id, { source: 'copy' });
		expect(await itemOf(answer.source)).toMatchObject({ original: '', body: 'Bitte anrufen', source_meta: { chat: 'Familie', sender: 'Ben' } });

		const plain = await owner.ticket();
		const before = await countsOf(owner);
		expect(await rejectionOf(duplicate(owner.client, plain.id, { source: 'copy' }))).toEqual({
			status: 400,
			codes: { source: 'validation_duplicate_source_missing' }
		});
		expect(await countsOf(owner)).toEqual(before);
	});
});

describe('one transaction', () => {
	it('keeps nothing when the last write fails: no ticket, sub-ticket, comment, copied source, key or history', async () => {
		const { ticket: original, item } = await ticketFromMail(owner, { title: FAIL_DUPLICATE });
		await owner.ticket({ parent: original.id });
		await owner.client.collection('comments').create({ ticket: original.id, author: owner.id, body: 'Kommentar' });
		const counter = await counterValue(superuser, `${scopeOf(owner.id)}:TASK`);
		const before = await countsOf(owner);

		let refused;
		try {
			await duplicate(owner.client, original.id, { ...EVERYTHING, parent: false, source: 'copy' });
		} catch (error) {
			refused = error;
		}
		// The injected failure of the very last write, not an earlier refusal.
		expect(refused).toMatchObject({ status: 400, response: { message: 'Injected duplicate failure.' } });
		expect(await countsOf(owner)).toEqual(before);
		expect(await counterValue(superuser, `${scopeOf(owner.id)}:TASK`)).toBe(counter);
		expect(await duplicateEntries(original.id)).toEqual([]);
		expect(await itemOf(item.id)).toMatchObject({ state: 'converted', ticket: original.id });
	});
});

describe('who may duplicate', () => {
	let s;

	beforeAll(async () => {
		s = await createScenario();
	});

	it('answers 404 for a foreign or missing ticket and 401 without a session', async () => {
		const other = await createOwner(superuser);
		const foreign = await other.ticket();
		expect((await rejectionOf(duplicate(owner.client, foreign.id, {}))).status).toBe(404);
		expect((await rejectionOf(duplicate(owner.client, 'abcdefghijklmno', {}))).status).toBe(404);
		expect((await rejectionOf(duplicate(createClient(), foreign.id, {}))).status).toBe(401);
	});

	it('lets a member of the household duplicate into the household, as owner of the duplicate', async () => {
		const ticket = await s.a.collection('tickets').create({ owner: s.ids.a, household: s.h1.id, title: 'Haushalt' });
		const comment = await s.a.collection('comments').create({ ticket: ticket.id, author: s.ids.a, body: 'Von A' });
		const answer = await duplicate(s.b, ticket.id, { comments: true });
		expect(await ticketOf(answer.id)).toMatchObject({ owner: s.ids.b, household: s.h1.id, scope: scopeOf(s.ids.b, s.h1.id) });
		const [copy] = await commentsOf(answer.id);
		expect(copy).toMatchObject({ author: s.ids.a, created: comment.created });
		// A sees the duplicate of B, C does not see the original.
		expect(await statusOf(s.a.collection('tickets').getOne(answer.id))).toBe(200);
		expect((await rejectionOf(duplicate(s.c, ticket.id, {}))).status).toBe(404);
	});

	it('refuses an owner who left the household: seeing is not creating (403)', async () => {
		const scenario = await createScenario();
		const ticket = await scenario.a
			.collection('tickets')
			.create({ owner: scenario.ids.a, household: scenario.h1.id, title: 'Vor dem Austritt' });
		await scenario.superuser.collection('household_members').delete(scenario.members.aH1.id);
		expect(await statusOf(scenario.a.collection('tickets').getOne(ticket.id))).toBe(200);
		expect((await rejectionOf(duplicate(scenario.a, ticket.id, {}))).status).toBe(403);
	});

	it('does not duplicate a ticket in the trash', async () => {
		const ticket = await owner.ticket();
		await owner.client.collection('tickets').delete(ticket.id);
		expect((await ticketOf(ticket.id)).deleted_at).not.toBe('');
		const before = await countsOf(owner);
		expect((await rejectionOf(duplicate(owner.client, ticket.id, {}))).status).toBe(404);
		expect(await countsOf(owner)).toEqual(before);
	});
});
