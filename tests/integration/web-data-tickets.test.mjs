// Data layer of the web app against the disposable instance (E2 plan, package 4; ADR-0006).
// The TypeScript modules from web/src/lib/data are imported directly; Vite translates them in
// the root Vitest. Every call gets the SDK client of the root tests as its PocketBase instance.

import PocketBase from 'pocketbase';
import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, historyOf, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { DataError } from '../../web/src/lib/data/errors.ts';
import { listHistory } from '../../web/src/lib/data/history.ts';
import { listProjects } from '../../web/src/lib/data/projects.ts';
import { createTag, listTags } from '../../web/src/lib/data/tags.ts';
import {
	describeHistoryEntry,
	historyLookups
} from '../../web/src/lib/domain/history-format.ts';
import {
	createTicket,
	deleteTicket,
	getTicket,
	listDoneTickets,
	listOpenTickets,
	listSubtaskTickets,
	setTicketDone,
	updateTicket
} from '../../web/src/lib/data/tickets.ts';

function draft(overrides = {}) {
	return {
		title: `Ticket ${uniqueSuffix()}`,
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		...overrides
	};
}

/** The DataError a call fails with; fails the test if the call succeeds. */
async function dataErrorOf(promise) {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(DataError);
		return error;
	}
	throw new Error('Expected the call to fail, but it succeeded.');
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('web data layer: tickets', () => {
	let superuser;
	let a;
	let b;

	beforeAll(async () => {
		superuser = await superuserClient();
		[a, b] = await Promise.all([createOwner(superuser), createOwner(superuser)]);
	});

	it('loads the TypeScript modules of web/src/lib/data in the root Vitest', () => {
		expect(typeof listOpenTickets).toBe('function');
		expect(new DataError('network').kind).toBe('network');
	});

	it('creates a private ticket with key, default status and priority', async () => {
		const owner = await createOwner(superuser);
		const title = `Erstes Ticket ${uniqueSuffix()}`;

		const ticket = await createTicket(owner.client, draft({ title, description: '**Text**' }));

		expect(ticket).toMatchObject({
			key: 'TASK-1',
			title,
			description: '**Text**',
			status: 'open',
			priority: 'medium',
			due: null,
			projectId: null,
			tagIds: [],
			project: null,
			tags: [],
			recurring: false,
			completedAt: null
		});
		expect(ticket.id).toMatch(/^[a-z0-9]{15}$/);
		const stored = await superuser.collection('tickets').getOne(ticket.id);
		expect(stored).toMatchObject({ owner: owner.id, household: '', scope: `u:${owner.id}` });
	});

	it('lists open tickets without done tickets and without tickets of other users', async () => {
		const open = await createTicket(a.client, draft());
		const done = await createTicket(a.client, draft());
		await setTicketDone(a.client, done.id, true);
		const foreign = await createTicket(b.client, draft());

		const ids = (await listOpenTickets(a.client)).map((ticket) => ticket.id);

		expect(ids).toContain(open.id);
		expect(ids).not.toContain(done.id);
		expect(ids).not.toContain(foreign.id);
		expect((await listOpenTickets(b.client)).map((ticket) => ticket.id)).not.toContain(open.id);
	});

	it('creates sub-tasks and lists all of them, open and done, with their parent (ADR-0033)', async () => {
		const owner = await createOwner(superuser);
		const parent = await createTicket(owner.client, draft({ title: 'Umzug' }));
		expect(parent).toMatchObject({ parentId: null, blocksParent: true, parentRef: null });

		const open = await createTicket(owner.client, draft({ title: 'Kartons', parent: parent.id }));
		const closed = await createTicket(owner.client, draft({ title: 'Küche', parent: parent.id }));
		await setTicketDone(owner.client, closed.id, true);
		await createTicket(owner.client, draft());

		expect(open).toMatchObject({
			parentId: parent.id,
			blocksParent: true,
			parentRef: { id: parent.id, key: parent.key, title: 'Umzug' }
		});
		const listed = await listSubtaskTickets(owner.client);
		expect(listed.map((ticket) => ticket.id).sort()).toEqual([open.id, closed.id].sort());
		expect(listed.find((ticket) => ticket.id === closed.id)).toMatchObject({
			status: 'done',
			parentId: parent.id
		});
		expect((await listSubtaskTickets(a.client)).map((ticket) => ticket.id)).not.toContain(open.id);
	});

	it('releases a sub-task from its parent through the patch (ADR-0033)', async () => {
		const owner = await createOwner(superuser);
		const parent = await createTicket(owner.client, draft());
		const child = await createTicket(owner.client, draft({ parent: parent.id }));

		const loose = await updateTicket(owner.client, child.id, { blocksParent: false });
		expect(loose).toMatchObject({ parentId: parent.id, blocksParent: false });

		const released = await updateTicket(owner.client, child.id, { parent: null });

		expect(released).toMatchObject({ parentId: null, parentRef: null });
		expect(await listSubtaskTickets(owner.client)).toEqual([]);
		const again = await updateTicket(owner.client, child.id, { parent: parent.id });
		expect(again.parentRef).toMatchObject({ id: parent.id, key: parent.key });
	});

	it('answers the question about open sub-tasks with complete_children or force (ADR-0033)', async () => {
		const owner = await createOwner(superuser);
		const parent = await createTicket(owner.client, draft());
		const child = await createTicket(owner.client, draft({ parent: parent.id }));

		const refused = await dataErrorOf(setTicketDone(owner.client, parent.id, true));
		expect(refused.fields.status).toMatchObject({
			code: 'validation_parent_open_children',
			message: '1 Unteraufgabe ist noch offen.',
			params: { count: 1, keys: [child.key] }
		});

		const done = await setTicketDone(owner.client, parent.id, true, {
			completion: 'complete_children'
		});
		expect(done.status).toBe('done');
		expect((await getTicket(owner.client, child.id)).status).toBe('done');

		const other = await createTicket(owner.client, draft());
		const open = await createTicket(owner.client, draft({ parent: other.id }));
		const forced = await updateTicket(owner.client, other.id, { status: 'done' }, { completion: 'force' });
		expect(forced.status).toBe('done');
		expect((await getTicket(owner.client, open.id)).status).toBe('open');
	});

	it('returns list entries without the description', async () => {
		const created = await createTicket(a.client, draft({ description: 'nur im Detail' }));

		const listed = (await listOpenTickets(a.client)).find((ticket) => ticket.id === created.id);

		expect(listed).toBeDefined();
		expect(listed).not.toHaveProperty('description');
		expect((await getTicket(a.client, created.id)).description).toBe('nur im Detail');
	});

	it('pages done tickets, most recently completed first', async () => {
		const owner = await createOwner(superuser);
		const created = [];
		for (let index = 0; index < 5; index += 1) {
			created.push(await createTicket(owner.client, draft({ title: `Erledigt ${index}` })));
		}
		for (const ticket of created) {
			await setTicketDone(owner.client, ticket.id, true);
			await delay(5);
		}
		const expected = created.map((ticket) => ticket.id).reverse();

		const first = await listDoneTickets(owner.client, 1, { perPage: 2 });
		const second = await listDoneTickets(owner.client, 2, { perPage: 2 });
		const third = await listDoneTickets(owner.client, 3, { perPage: 2 });

		expect(first.items.map((ticket) => ticket.id)).toEqual(expected.slice(0, 2));
		expect(second.items.map((ticket) => ticket.id)).toEqual(expected.slice(2, 4));
		expect(third.items.map((ticket) => ticket.id)).toEqual(expected.slice(4));
		expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
		const completed = [...first.items, ...second.items, ...third.items].map((t) => t.completedAt);
		expect(completed).toEqual([...completed].sort().reverse());
		expect(completed.every((value) => typeof value === 'string' && value !== '')).toBe(true);
		expect((await listOpenTickets(owner.client)).length).toBe(0);
	});

	it('sets and clears completed_at with the check mark', async () => {
		const ticket = await createTicket(a.client, draft({ status: 'in_progress' }));

		const done = await setTicketDone(a.client, ticket.id, true);
		expect(done.status).toBe('done');
		expect(done.completedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);

		const reopened = await setTicketDone(a.client, ticket.id, false);
		expect(reopened.status).toBe('open');
		expect(reopened.completedAt).toBeNull();
	});

	it('stores a due date given as YYYY-MM-DD in the calendar format and clears it', async () => {
		const ticket = await createTicket(a.client, draft());

		const updated = await updateTicket(a.client, ticket.id, { due: '2026-10-01' });
		expect(updated.due).toBe('2026-10-01');
		expect((await superuser.collection('tickets').getOne(ticket.id)).due).toBe(
			'2026-10-01 00:00:00.000Z'
		);

		const cleared = await updateTicket(a.client, ticket.id, { due: null });
		expect(cleared.due).toBeNull();
		expect((await superuser.collection('tickets').getOne(ticket.id)).due).toBe('');
	});

	it('creates a ticket with a due date', async () => {
		const ticket = await createTicket(a.client, draft({ due: '2028-02-29', priority: 'urgent' }));

		expect(ticket).toMatchObject({ due: '2028-02-29', priority: 'urgent' });
	});

	it('changes only the sent fields', async () => {
		const ticket = await createTicket(a.client, draft({ description: 'bleibt' }));

		const updated = await updateTicket(a.client, ticket.id, { priority: 'high' });

		expect(updated).toMatchObject({
			title: ticket.title,
			description: 'bleibt',
			priority: 'high',
			status: 'open'
		});
		const fields = (await historyOf(superuser, ticket.id)).map((entry) => entry.field);
		expect(fields).toEqual(['created', 'priority']);
	});

	it.each([
		['an empty title', '', 'validation_required'],
		['a title that is too long', 'x'.repeat(201), 'validation_max_text_constraint']
	])('reports %s as a validation error of the field title', async (_name, title, code) => {
		const ticket = await createTicket(a.client, draft());

		const error = await dataErrorOf(updateTicket(a.client, ticket.id, { title }));

		expect(error.kind).toBe('validation');
		expect(error.status).toBe(400);
		expect(Object.keys(error.fields)).toEqual(['title']);
		expect(error.fields.title.code).toBe(code);
		expect(error.fields.title.message).not.toBe('');
	});

	it('rejects a ticket without title on creation', async () => {
		const error = await dataErrorOf(createTicket(a.client, draft({ title: '' })));

		expect(error.kind).toBe('validation');
		expect(error.fields.title.code).toBe('validation_required');
	});

	it('moves a ticket to the trash, and deleting it for good takes its comments and history', async () => {
		const ticket = await createTicket(a.client, draft());
		// Done, so nothing blocks deleting it for good (ADR-0047).
		await updateTicket(a.client, ticket.id, { title: 'geändert', status: 'done' });
		await a.client.collection('comments').create({ ticket: ticket.id, author: a.id, body: 'x' });
		expect((await historyOf(superuser, ticket.id)).length).toBe(3);

		await deleteTicket(a.client, ticket.id);
		expect((await dataErrorOf(getTicket(a.client, ticket.id))).kind).toBe('not_found');
		const filter = superuser.filter('ticket = {:id}', { id: ticket.id });
		expect((await a.client.collection('comments').getFullList({ filter }))).toEqual([]);
		expect((await superuser.collection('comments').getFullList({ filter })).length).toBe(1);

		await a.client.send(`/api/byl/trash/${ticket.id}/purge`, { method: 'POST' });
		expect(await superuser.collection('comments').getFullList({ filter })).toEqual([]);
		expect(await superuser.collection('ticket_history').getFullList({ filter })).toEqual([]);
	});

	it('reports tickets of other users as not found', async () => {
		const foreign = await createTicket(b.client, draft());

		expect((await dataErrorOf(getTicket(a.client, foreign.id))).kind).toBe('not_found');
		expect((await dataErrorOf(updateTicket(a.client, foreign.id, { title: 'x' }))).kind).toBe(
			'not_found'
		);
		expect((await dataErrorOf(deleteTicket(a.client, foreign.id))).kind).toBe('not_found');
	});

	it('shows project and tags through expand and in the lookup lists', async () => {
		const owner = await createOwner(superuser);
		const code = uniqueCode();
		const project = await superuser
			.collection('projects')
			.create({ owner: owner.id, name: `Projekt ${code}`, code });
		const tag = await superuser.collection('tags').create({ owner: owner.id, name: 'garten' });
		const ticket = await createTicket(owner.client, draft());
		await superuser
			.collection('tickets')
			.update(ticket.id, { project: project.id, tags: [tag.id] });

		const [listed] = await listOpenTickets(owner.client);
		const detail = await getTicket(owner.client, ticket.id);

		const projectRef = { id: project.id, name: `Projekt ${code}`, code, archived: false };
		const tagRef = { id: tag.id, name: 'garten' };
		const relations = { projectId: project.id, tagIds: [tag.id] };
		expect(listed).toMatchObject({
			key: `${code}-1`,
			...relations,
			project: projectRef,
			tags: [tagRef]
		});
		expect(detail).toMatchObject({ ...relations, project: projectRef, tags: [tagRef] });
		expect(await listProjects(owner.client)).toEqual([
			{ ...projectRef, updated: project.updated, parentId: null }
		]);
		expect(await listTags(owner.client)).toEqual([{ ...tagRef, updated: tag.updated }]);
		expect((await listProjects(a.client)).map((entry) => entry.id)).not.toContain(project.id);
	});

	it('moves a ticket into a project and back with new keys and history (E3 plan, T-13)', async () => {
		const owner = await createOwner(superuser);
		const code = uniqueCode();
		const project = await owner.project(code);
		await createTicket(owner.client, draft());
		const ticket = await createTicket(owner.client, draft());
		expect(ticket.key).toBe('TASK-2');

		const moved = await updateTicket(owner.client, ticket.id, { project: project.id });
		expect(moved).toMatchObject({
			id: ticket.id,
			key: `${code}-1`,
			projectId: project.id,
			project: { id: project.id, code }
		});

		const back = await updateTicket(owner.client, ticket.id, { project: null });
		expect(back).toMatchObject({ id: ticket.id, key: 'TASK-3', projectId: null, project: null });

		// Entries of one change share their timestamp, so their order is not fixed.
		const history = (await historyOf(superuser, ticket.id))
			.filter((entry) => entry.field !== 'created')
			.map((entry) => [entry.field, entry.old_value, entry.new_value]);
		expect(history).toHaveLength(4);
		expect(history).toEqual(
			expect.arrayContaining([
				['project', '', project.id],
				['key', 'TASK-2', `${code}-1`],
				['project', project.id, ''],
				['key', `${code}-1`, 'TASK-3']
			])
		);
	});

	it('saves the whole tag list and records "Tag hinzugefügt" (E3 plan, T-14)', async () => {
		const owner = await createOwner(superuser);
		const garden = await createTag(owner.client, `garten-${uniqueSuffix()}`);
		const call = await createTag(owner.client, `anrufen-${uniqueSuffix()}`);
		const ticket = await createTicket(owner.client, draft({ tags: [garden.id] }));
		expect(ticket.tagIds).toEqual([garden.id]);

		const added = await updateTicket(owner.client, ticket.id, { tags: [garden.id, call.id] });
		expect(added.tagIds).toEqual([garden.id, call.id]);
		expect(added.tags.map((tag) => tag.name)).toEqual([garden.name, call.name]);
		const removed = await updateTicket(owner.client, ticket.id, { tags: [call.id] });
		expect(removed.tagIds).toEqual([call.id]);

		const lookups = historyLookups([], [garden, call]);
		const texts = (await listHistory(owner.client, ticket.id))
			.filter((entry) => entry.field === 'tags')
			.map((entry) => describeHistoryEntry(entry, lookups, owner.id).text);
		expect(texts).toEqual([`Tag entfernt: ${garden.name}`, `Tag hinzugefügt: ${call.name}`]);
	});

	it('creates a ticket in a project and refuses an archived one at the field project', async () => {
		const owner = await createOwner(superuser);
		const code = uniqueCode();
		const project = await owner.project(code);

		const created = await createTicket(owner.client, draft({ project: project.id }));
		expect(created).toMatchObject({ key: `${code}-1`, projectId: project.id });

		await owner.client.collection('projects').update(project.id, { archived: true });
		const error = await dataErrorOf(createTicket(owner.client, draft({ project: project.id })));
		expect(error.kind).toBe('validation');
		expect(error.fields.project.code).toBe('validation_project_archived');
		expect(error.fields.project.message).toBe('Das Projekt ist archiviert.');
	});

	it('reports an aborted call as "aborted", not as "network"', async () => {
		const before = new AbortController();
		before.abort();
		const early = await dataErrorOf(listOpenTickets(a.client, { signal: before.signal }));
		expect(early.kind).toBe('aborted');

		const during = new AbortController();
		const pending = listOpenTickets(a.client, { signal: during.signal });
		during.abort();
		expect((await dataErrorOf(pending)).kind).toBe('aborted');
	});

	it('reports a missing server as "network"', async () => {
		// Port 9 (discard) is not served on the test machine: the connection is refused.
		const unreachable = new PocketBase('http://127.0.0.1:9');
		unreachable.autoCancellation(false);

		const error = await dataErrorOf(listOpenTickets(unreachable));

		expect(error.kind).toBe('network');
		expect(error.status).toBe(0);
	});

	it('reports a creation without session as "session" without a request', async () => {
		const anonymous = new PocketBase('http://127.0.0.1:9');

		expect((await dataErrorOf(createTicket(anonymous, draft()))).kind).toBe('session');
	});
});
