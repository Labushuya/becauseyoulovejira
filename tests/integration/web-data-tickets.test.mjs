// Data layer of the web app against the disposable instance (E2 plan, package 4; ADR-0006).
// The TypeScript modules from web/src/lib/data are imported directly; Vite translates them in
// the root Vitest. Every call gets the SDK client of the root tests as its PocketBase instance.

import PocketBase from 'pocketbase';
import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, historyOf, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { DataError } from '../../web/src/lib/data/errors.ts';
import { listProjects } from '../../web/src/lib/data/projects.ts';
import { listTags } from '../../web/src/lib/data/tags.ts';
import {
	createTicket,
	deleteTicket,
	getTicket,
	listDoneTickets,
	listOpenTickets,
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

	it('deletes a ticket together with its comments and history', async () => {
		const ticket = await createTicket(a.client, draft());
		await updateTicket(a.client, ticket.id, { title: 'geändert' });
		await a.client.collection('comments').create({ ticket: ticket.id, author: a.id, body: 'x' });
		expect((await historyOf(superuser, ticket.id)).length).toBe(2);

		await deleteTicket(a.client, ticket.id);

		const filter = superuser.filter('ticket = {:id}', { id: ticket.id });
		expect(await superuser.collection('comments').getFullList({ filter })).toEqual([]);
		expect(await superuser.collection('ticket_history').getFullList({ filter })).toEqual([]);
		expect((await dataErrorOf(getTicket(a.client, ticket.id))).kind).toBe('not_found');
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
			{ ...projectRef, updated: project.updated }
		]);
		expect(await listTags(owner.client)).toEqual([{ ...tagRef, updated: tag.updated }]);
		expect((await listProjects(a.client)).map((entry) => entry.id)).not.toContain(project.id);
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
