// Realtime through the web data layer (E2 plan, package 12; ADR-0007 section 2): a second client
// of the same user changes and deletes, the first receives it, a foreign user receives nothing.
// The subscriptions carry the fields of list and panel and are filtered to one ticket where the
// panel needs it. Projects and tags follow for the catalog (E3 plan, package 4). Node 24
// provides EventSource only with --experimental-eventsource, which vitest.config.mjs passes to
// the integration workers.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { superuserClient, userClient } from '../support/api.mjs';
import { createOwner, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { createComment } from '../../web/src/lib/data/comments.ts';
import {
	createProject,
	deleteProject,
	setProjectArchived,
	updateProject
} from '../../web/src/lib/data/projects.ts';
import {
	onReconnect,
	subscribeComments,
	subscribeHistory,
	subscribeProjects,
	subscribeTags,
	subscribeTicket,
	subscribeTickets
} from '../../web/src/lib/data/realtime.ts';
import { createTag, deleteTag, renameTag } from '../../web/src/lib/data/tags.ts';
import { createTicket, deleteTicket, updateTicket } from '../../web/src/lib/data/tickets.ts';

const EVENT_TIMEOUT_MS = 5_000;
const QUIET_PERIOD_MS = 500;

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

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Collects the changes of one subscription and waits for matching ones. */
function collector() {
	const changes = [];
	const waiters = [];
	return {
		changes,
		onChange(change) {
			changes.push(change);
			for (const waiter of [...waiters]) waiter();
		},
		/** Resolves with the first change matching `predicate`. */
		waitFor(predicate, label) {
			const found = () => changes.find(predicate);
			if (found()) return Promise.resolve(found());
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					waiters.splice(waiters.indexOf(check), 1);
					reject(new Error(`No realtime change "${label}" within ${EVENT_TIMEOUT_MS} ms`));
				}, EVENT_TIMEOUT_MS);
				const check = () => {
					const change = found();
					if (!change) return;
					clearTimeout(timer);
					waiters.splice(waiters.indexOf(check), 1);
					resolve(change);
				};
				waiters.push(check);
			});
		}
	};
}

const idOf = (change) => (change.action === 'delete' ? change.id : change.record.id);

describe('web data layer: realtime', () => {
	let owner;
	let first;
	let second;
	let foreign;
	const unsubscribes = [];

	beforeAll(async () => {
		const superuser = await superuserClient();
		owner = await createOwner(superuser);
		first = owner.client;
		second = await userClient(owner);
		foreign = (await createOwner(superuser)).client;
	});

	afterAll(async () => {
		for (const unsubscribe of unsubscribes) await unsubscribe().catch(() => undefined);
		for (const client of [first, second, foreign]) await client?.realtime.unsubscribe();
	});

	async function subscribe(start) {
		const unsubscribe = await start;
		unsubscribes.push(unsubscribe);
		return unsubscribe;
	}

	it('delivers changes and deletions of a second client, and nothing to a foreign user', async () => {
		const own = collector();
		const other = collector();
		await subscribe(subscribeTickets(first, own.onChange));
		await subscribe(subscribeTickets(foreign, other.onChange));

		const ticket = await createTicket(second, draft());
		const created = await own.waitFor(
			(change) => change.action === 'create' && change.record.id === ticket.id,
			'create'
		);
		await updateTicket(second, ticket.id, { title: 'Im zweiten Fenster geändert' });
		const updated = await own.waitFor(
			(change) => change.action === 'update' && change.record.id === ticket.id,
			'update'
		);
		await deleteTicket(second, ticket.id);
		await own.waitFor((change) => change.action === 'delete' && change.id === ticket.id, 'delete');
		await delay(QUIET_PERIOD_MS);

		expect(created.record).toMatchObject({ key: ticket.key, status: 'open', priority: 'medium' });
		expect(updated.record.title).toBe('Im zweiten Fenster geändert');
		expect(other.changes.filter((change) => idOf(change) === ticket.id)).toEqual([]);
	});

	it('carries the list fields with the expanded project, without the description', async () => {
		const events = collector();
		await subscribe(subscribeTickets(first, events.onChange));
		const code = uniqueCode();
		const project = await owner.project(code);
		const ticket = await createTicket(second, draft({ description: 'geheim lang' }));

		await second.collection('tickets').update(ticket.id, { project: project.id });
		const change = await events.waitFor(
			(item) => item.action === 'update' && item.record.id === ticket.id,
			'update with project'
		);

		expect(change.record).toMatchObject({
			key: `${code}-1`,
			projectId: project.id,
			tagIds: [],
			project: { id: project.id, name: `Projekt ${code}`, code, archived: false },
			tags: [],
			recurring: false
		});
		expect(change.record).not.toHaveProperty('description');
	});

	it('carries the parent of a sub-task with its key and title (ADR-0033)', async () => {
		const events = collector();
		await subscribe(subscribeTickets(first, events.onChange));
		const parent = await createTicket(second, draft({ title: 'Umzug' }));
		const child = await createTicket(second, draft({ parent: parent.id }));

		const change = await events.waitFor(
			(item) => item.action === 'create' && item.record.id === child.id,
			'create of the sub-task'
		);

		expect(change.record).toMatchObject({
			parentId: parent.id,
			blocksParent: true,
			parentRef: { id: parent.id, key: parent.key, title: 'Umzug' }
		});
	});

	it('follows one ticket with its description for the panel', async () => {
		const ticket = await createTicket(first, draft());
		const events = collector();
		await subscribe(subscribeTicket(first, ticket.id, events.onChange));

		await updateTicket(second, ticket.id, { description: '**Neu** aus dem zweiten Fenster' });
		const change = await events.waitFor((item) => item.action === 'update', 'update');
		await deleteTicket(second, ticket.id);
		await events.waitFor((item) => item.action === 'delete' && item.id === ticket.id, 'delete');

		expect(change.record.description).toBe('**Neu** aus dem zweiten Fenster');
	});

	it('follows the pinned comment of the shown ticket in every tab (ADR-0044)', async () => {
		const ticket = await createTicket(first, draft());
		const comment = await createComment(first, ticket.id, 'Wichtig');
		const events = collector();
		await subscribe(subscribeTicket(first, ticket.id, events.onChange));

		await updateTicket(second, ticket.id, { pinnedComment: comment.id });
		const pinned = await events.waitFor(
			(item) => item.action === 'update' && item.record.pinnedComment === comment.id,
			'pinned'
		);
		// Deleting the pinned comment in the second tab releases the pin for the first as well.
		await second.collection('comments').delete(comment.id);
		const released = await events.waitFor(
			(item) => item.action === 'update' && item.record.pinnedComment === null,
			'released'
		);

		expect(pinned.record.id).toBe(ticket.id);
		expect(released.record.updated >= pinned.record.updated).toBe(true);
	});

	it('delivers only comments and history of the filtered ticket', async () => {
		const shown = await createTicket(first, draft());
		const elsewhere = await createTicket(first, draft());
		const comments = collector();
		const history = collector();
		await subscribe(subscribeComments(first, shown.id, comments.onChange));
		await subscribe(subscribeHistory(first, shown.id, history.onChange));

		await createComment(second, elsewhere.id, 'woanders');
		await updateTicket(second, elsewhere.id, { status: 'waiting' });
		const comment = await createComment(second, shown.id, 'hier');
		await updateTicket(second, shown.id, { status: 'in_progress' });
		const added = await comments.waitFor((item) => item.action === 'create', 'comment');
		const entry = await history.waitFor(
			(item) => item.action === 'create' && item.record.field === 'status',
			'history'
		);
		await delay(QUIET_PERIOD_MS);

		expect(added.record).toMatchObject({ id: comment.id, ticket: shown.id, body: 'hier' });
		expect(entry.record).toMatchObject({
			ticket: shown.id,
			oldValue: 'open',
			newValue: 'in_progress',
			user: owner.id
		});
		expect(comments.changes.every((item) => item.record?.ticket === shown.id)).toBe(true);
		expect(history.changes.every((item) => item.record?.ticket === shown.id)).toBe(true);
	});

	it('reports a reconnection but not the first connection, and keeps delivering', async () => {
		const client = await userClient(owner);
		try {
			let reconnects = 0;
			await onReconnect(client, () => {
				reconnects += 1;
			});
			const events = collector();
			await subscribeTickets(client, events.onChange);
			await delay(QUIET_PERIOD_MS);
			expect(reconnects).toBe(0);
			const before = client.realtime.clientId;

			// Simulates a dropped connection the way the SDK sees it (EventSource error event).
			client.realtime.eventSource.onerror(new Event('error'));
			await vi.waitFor(() => expect(reconnects).toBe(1), { timeout: EVENT_TIMEOUT_MS });
			const ticket = await createTicket(second, draft());

			expect(client.realtime.clientId).not.toBe(before);
			await events.waitFor(
				(change) => change.action === 'create' && change.record.id === ticket.id,
				'create after reconnect'
			);
		} finally {
			await client.realtime.unsubscribe();
		}
	});

	it('delivers project changes of a second client with the catalog fields, none to a foreign user', async () => {
		const own = collector();
		const other = collector();
		await subscribe(subscribeProjects(first, own.onChange));
		await subscribe(subscribeProjects(foreign, other.onChange));
		const code = uniqueCode();

		const project = await createProject(second, { name: 'Keller', code });
		const created = await own.waitFor(
			(change) => change.action === 'create' && change.record.id === project.id,
			'create project'
		);
		await updateProject(second, project.id, { name: 'Dachboden' });
		const renamed = await own.waitFor(
			(change) => change.action === 'update' && change.record.name === 'Dachboden',
			'rename project'
		);
		await setProjectArchived(second, project.id, true);
		const archived = await own.waitFor(
			(change) => change.action === 'update' && change.record.archived === true,
			'archive project'
		);
		await deleteProject(second, project.id);
		await own.waitFor(
			(change) => change.action === 'delete' && change.id === project.id,
			'delete project'
		);
		await delay(QUIET_PERIOD_MS);

		expect(created.record).toEqual(project);
		// Since ADR-0034 with the stored parent (null for a top-level project), since ADR-0052 with
		// the color (null for none).
		expect(Object.keys(created.record).sort()).toEqual([
			'archived',
			'code',
			'color',
			'id',
			'name',
			'parentId',
			'updated'
		]);
		expect(created.record.parentId).toBeNull();
		expect(created.record.color).toBeNull();
		expect(renamed.record).toMatchObject({ id: project.id, name: 'Dachboden', code });
		expect(archived.record.updated >= renamed.record.updated).toBe(true);
		expect(other.changes.filter((change) => idOf(change) === project.id)).toEqual([]);
	});

	it('delivers a new color of a project and of a ticket to every tab (ADR-0052)', async () => {
		const projectEvents = collector();
		const ticketEvents = collector();
		await subscribe(subscribeProjects(first, projectEvents.onChange));
		await subscribe(subscribeTickets(first, ticketEvents.onChange));
		const project = await createProject(second, { name: 'Garage', code: uniqueCode() });
		const ticket = await createTicket(second, draft({ project: project.id }));

		await updateProject(second, project.id, { color: 'tuerkis' });
		const colored = await projectEvents.waitFor(
			(change) => change.action === 'update' && change.record.color === 'tuerkis',
			'project color'
		);
		await updateTicket(second, ticket.id, { color: 'senf' });
		const own = await ticketEvents.waitFor(
			(change) => change.action === 'update' && change.record.color === 'senf',
			'ticket color'
		);
		await updateTicket(second, ticket.id, { color: null });
		const back = await ticketEvents.waitFor(
			(change) =>
				change.action === 'update' && change.record.id === ticket.id && change.record.color === null,
			'ticket color removed'
		);

		expect(colored.record).toMatchObject({ id: project.id, color: 'tuerkis' });
		expect(own.record).toMatchObject({ id: ticket.id, color: 'senf' });
		// The expanded project carries its color as well (a fallback while the catalog loads).
		expect(back.record.project).toMatchObject({ id: project.id, color: 'tuerkis' });
	});

	it('delivers tag changes of a second client, none to a foreign user', async () => {
		const own = collector();
		const other = collector();
		await subscribe(subscribeTags(first, own.onChange));
		await subscribe(subscribeTags(foreign, other.onChange));

		const tag = await createTag(second, `Einkauf-${uniqueSuffix()}`);
		const created = await own.waitFor(
			(change) => change.action === 'create' && change.record.id === tag.id,
			'create tag'
		);
		await renameTag(second, tag.id, 'Wocheneinkauf');
		const renamed = await own.waitFor(
			(change) => change.action === 'update' && change.record.name === 'Wocheneinkauf',
			'rename tag'
		);
		await deleteTag(second, tag.id);
		await own.waitFor((change) => change.action === 'delete' && change.id === tag.id, 'delete tag');
		await delay(QUIET_PERIOD_MS);

		expect(created.record).toEqual(tag);
		expect(Object.keys(renamed.record).sort()).toEqual(['id', 'name', 'updated']);
		expect(other.changes.filter((change) => idOf(change) === tag.id)).toEqual([]);
	});

	it('delivers nothing after unsubscribing', async () => {
		const ticket = await createTicket(first, draft());
		const events = collector();
		const unsubscribe = await subscribe(subscribeTicket(first, ticket.id, events.onChange));
		await updateTicket(second, ticket.id, { title: 'noch abonniert' });
		await events.waitFor((item) => item.action === 'update', 'update before unsubscribe');

		await unsubscribe();
		const before = events.changes.length;
		await updateTicket(second, ticket.id, { title: 'nicht mehr abonniert' });
		await delay(QUIET_PERIOD_MS);

		expect(events.changes).toHaveLength(before);
	});
});
