// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070) against the shared disposable instance: the route
// POST /api/byl/tickets/{id}/subtasks/transfer gives sub-tasks the values of chosen fields of their
// parent, read by the server, in one transaction or not at all. Covered: the fields with "all open"
// and a chosen list, sub-tasks that have every value already (not saved, not counted), new keys for a
// new project, the history with the acting account, all or nothing when a hook refuses one sub-task
// (named in the answer), 409 when the parent changed, foreign and unrelated tickets, the limit, the
// rights of the areas, one notice per assignee for all sub-tasks given to him, and the parts of the
// route that UE-2 will use: moving due dates (`shift`) and removing tags (`remove`).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, rejectionOf, statusOf } from '../support/api.mjs';
import { createScenario, historyOf, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import { fetchCreateSupport } from '../../web/src/lib/data/ticket-create.ts';
import { transferToSubtasks } from '../../web/src/lib/data/subtask-transfer.ts';

const TOPIC = 'byl/assigned';
const EVENT_TIMEOUT_MS = scaled(5_000);
const route = (id) => `/api/byl/tickets/${id}/subtasks/transfer`;

let s;
const stops = [];

beforeAll(async () => {
	s = await createScenario();
	await s.superuser.collection('users').update(s.ids.a, { name: 'Anna Beispiel' });
	await s.superuser.collection('users').update(s.ids.b, { name: 'Bert Beispiel' });
});

afterAll(async () => {
	for (const stop of stops) await stop().catch(() => undefined);
});

const ticketOf = (id) => s.superuser.collection('tickets').getOne(id);
const stored = (date) => `${date} 00:00:00.000Z`;

/** Sends the route as the SPA would, with the `updated` of the parent it knows. */
function transfer(client, parent, body) {
	return client.send(route(parent.id), {
		method: 'POST',
		body: { expected_updated: parent.updated, targets: 'open', ...body },
		requestKey: null
	});
}

/** A ticket of `who` (a client of the scenario) with `data`; `owner` is its account. */
function ticket(who, owner, data = {}) {
	return who.collection('tickets').create({ owner, title: `Ticket ${uniqueSuffix()}`, ...data });
}

/** A parent with its sub-tasks (`children` are the data of each), all of `who`. */
async function family(who, owner, parentData = {}, children = [{}, {}]) {
	const parent = await ticket(who, owner, parentData);
	const subtasks = [];
	for (const data of children) {
		subtasks.push(await ticket(who, owner, { household: parentData.household ?? '', parent: parent.id, ...data }));
	}
	return { parent: await who.collection('tickets').getOne(parent.id), subtasks };
}

/** Status, field codes and the full data of a refused call. */
async function refusalOf(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return { status: error.status, message: error.response?.message ?? '', data: error.response?.data ?? {} };
	}
	throw new Error('Expected the request to be refused, but it succeeded.');
}

async function until(ready, label) {
	const deadline = Date.now() + EVENT_TIMEOUT_MS;
	while (!(await ready())) {
		if (Date.now() > deadline) throw new Error(`Not reached within ${EVENT_TIMEOUT_MS} ms: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

/** The notices of the topic byl/assigned for the tabs of `client`. */
async function notices(client) {
	const received = [];
	stops.push(await client.realtime.subscribe(TOPIC, (data) => received.push(data)));
	return received;
}

describe('transferring the fields of a ticket to its sub-tasks', () => {
	it('gives every open sub-task the chosen values of the parent and leaves done ones and other fields alone', async () => {
		const tag = await s.a.collection('tags').create({ owner: s.ids.a, name: `garten-${uniqueSuffix()}` });
		const own = await s.a.collection('tags').create({ owner: s.ids.a, name: `eigen-${uniqueSuffix()}` });
		const { parent, subtasks } = await family(
			s.a,
			s.ids.a,
			{ due: '2026-11-20', priority: 'high', status: 'in_progress', tags: [tag.id], title: 'Umzug', description: 'Text' },
			[
				{ title: 'Küche', status: 'open', tags: [own.id] },
				{ title: 'Keller', status: 'waiting', due: '2026-12-01' },
				{ title: 'Erledigt', status: 'done' }
			]
		);
		const [kitchen, cellar, done] = subtasks;

		const answer = await transfer(s.a, parent, {
			fields: { due: { mode: 'same' }, priority: true, status: true, tags: { add: [tag.id] } }
		});

		expect(answer).toEqual({
			parent: { id: parent.id, key: parent.key },
			changed: 2,
			unchanged: 0,
			tickets: [
				{ id: kitchen.id, key: kitchen.key, previous_key: kitchen.key },
				{ id: cellar.id, key: cellar.key, previous_key: cellar.key }
			]
		});
		for (const child of [kitchen, cellar]) {
			const now = await ticketOf(child.id);
			expect(now).toMatchObject({ due: stored('2026-11-20'), priority: 'high', status: 'in_progress', description: '' });
			expect(now.title).toBe(child.title);
		}
		// Tags are added, the own ones stay.
		expect((await ticketOf(kitchen.id)).tags).toEqual([own.id, tag.id]);
		expect((await ticketOf(cellar.id)).tags).toEqual([tag.id]);
		// The done one is no target of "Alle offenen".
		expect(await ticketOf(done.id)).toMatchObject({ status: 'done', updated: done.updated, priority: 'medium' });
		// The parent stays as it is.
		expect((await ticketOf(parent.id)).updated).toBe(parent.updated);
	});

	it('writes the normal history of each sub-task with the acting account', async () => {
		const { parent, subtasks } = await family(s.a, s.ids.a, { priority: 'urgent', due: '2026-11-03' }, [{}]);
		await transfer(s.a, parent, { fields: { priority: true, due: { mode: 'same' } } });
		// Entries of one save share their time; sorted by field, so their IDs do not decide.
		const entries = (await historyOf(s.superuser, subtasks[0].id))
			.filter((entry) => entry.field !== 'created')
			.map((entry) => [entry.field, entry.old_value, entry.new_value, entry.user])
			.sort((x, y) => x[0].localeCompare(y[0]));
		expect(entries).toEqual([
			['due', '', stored('2026-11-03'), s.ids.a],
			['priority', 'medium', 'urgent', s.ids.a]
		]);
	});

	it('neither saves nor counts a sub-task that has every chosen value already', async () => {
		const { parent, subtasks } = await family(s.a, s.ids.a, { priority: 'low' }, [{ priority: 'low' }, {}]);
		const answer = await transfer(s.a, parent, { fields: { priority: true } });
		expect(answer).toMatchObject({ changed: 1, unchanged: 1 });
		expect(answer.tickets.map((entry) => entry.id)).toEqual([subtasks[1].id]);
		expect((await ticketOf(subtasks[0].id)).updated).toBe(subtasks[0].updated);
		expect((await historyOf(s.superuser, subtasks[0].id)).map((entry) => entry.field)).toEqual(['created']);
	});

	it('takes a chosen list, done sub-tasks included, and completes them like a single change', async () => {
		const { parent, subtasks } = await family(s.a, s.ids.a, { status: 'done' }, [{}, { status: 'done' }, {}]);
		const answer = await transfer(s.a, await ticketOf(parent.id), {
			fields: { status: true },
			targets: [subtasks[0].id, subtasks[1].id]
		});
		expect(answer).toMatchObject({ changed: 1, unchanged: 1 });
		const completed = await ticketOf(subtasks[0].id);
		expect(completed.status).toBe('done');
		expect(completed.completed_at).not.toBe('');
		expect((await ticketOf(subtasks[2].id)).status).toBe('open');
	});

	it('gives the sub-tasks the project of the parent with new keys of its counter', async () => {
		const code = uniqueCode();
		const project = await s.a.collection('projects').create({ owner: s.ids.a, name: `Projekt ${code}`, code });
		const { parent, subtasks } = await family(s.a, s.ids.a, { project: project.id }, [{}, {}]);
		const answer = await transfer(s.a, parent, { fields: { project: true } });
		expect(answer.tickets.map((entry) => entry.previous_key)).toEqual(subtasks.map((child) => child.key));
		expect(answer.tickets.map((entry) => entry.key)).toEqual([`${code}-2`, `${code}-3`]);
		for (const entry of answer.tickets) {
			const now = await ticketOf(entry.id);
			expect(now).toMatchObject({ project: project.id, key: entry.key });
			const keyEntry = (await historyOf(s.superuser, entry.id)).find((item) => item.field === 'key');
			expect(keyEntry).toMatchObject({ old_value: entry.previous_key, new_value: entry.key, user: s.ids.a });
		}
	});

	it('moves due dates by a number of days (`shift`, for UE-2) and leaves sub-tasks without one alone', async () => {
		const { parent, subtasks } = await family(s.a, s.ids.a, { due: '2026-11-10' }, [{ due: '2026-10-30' }, {}, { due: '2027-01-01' }]);
		const answer = await transfer(s.a, parent, { fields: { due: { mode: 'shift', days: 3 } } });
		expect(answer).toMatchObject({ changed: 2, unchanged: 1 });
		expect((await ticketOf(subtasks[0].id)).due).toBe(stored('2026-11-02'));
		expect((await ticketOf(subtasks[1].id)).due).toBe('');
		expect((await ticketOf(subtasks[2].id)).due).toBe(stored('2027-01-04'));
		await transfer(s.a, await ticketOf(parent.id), { fields: { due: { mode: 'shift', days: -40 } }, targets: [subtasks[0].id] });
		expect((await ticketOf(subtasks[0].id)).due).toBe(stored('2026-09-23'));
	});

	it('removes tags the parent no longer has (`remove`, for UE-2) and refuses tags against the parent', async () => {
		const kept = await s.a.collection('tags').create({ owner: s.ids.a, name: `bleibt-${uniqueSuffix()}` });
		const gone = await s.a.collection('tags').create({ owner: s.ids.a, name: `weg-${uniqueSuffix()}` });
		const { parent, subtasks } = await family(s.a, s.ids.a, { tags: [kept.id] }, [{ tags: [kept.id, gone.id] }, { tags: [gone.id] }]);
		const answer = await transfer(s.a, parent, { fields: { tags: { remove: [gone.id] } } });
		expect(answer.changed).toBe(2);
		expect((await ticketOf(subtasks[0].id)).tags).toEqual([kept.id]);
		expect((await ticketOf(subtasks[1].id)).tags).toEqual([]);
		const fresh = await ticketOf(parent.id);
		// Removing a tag the parent has, adding one it lacks: refused, nothing written.
		expect(await rejectionOf(transfer(s.a, fresh, { fields: { tags: { remove: [kept.id] } } }))).toEqual({
			status: 400,
			codes: { tags: 'validation_transfer_tags' }
		});
		expect(await rejectionOf(transfer(s.a, fresh, { fields: { tags: { add: [gone.id] } } }))).toEqual({
			status: 400,
			codes: { tags: 'validation_transfer_tags' }
		});
	});
});

describe('all or nothing', () => {
	it('changes no sub-task when a hook refuses one of them, and names it', async () => {
		const code = uniqueCode();
		const project = await s.a.collection('projects').create({ owner: s.ids.a, name: `Projekt ${code}`, code });
		const { parent, subtasks } = await family(s.a, s.ids.a, { project: project.id, priority: 'high' }, [
			{ project: project.id },
			{}
		]);
		await s.a.collection('projects').update(project.id, { archived: true });
		const before = await Promise.all(subtasks.map((child) => ticketOf(child.id)));

		const refused = await refusalOf(transfer(s.a, parent, { fields: { priority: true, project: true } }));
		expect(refused.status).toBe(400);
		expect(refused.data.targets).toMatchObject({
			code: 'validation_project_archived',
			params: { id: subtasks[1].id, key: subtasks[1].key, field: 'project' }
		});
		expect(refused.data.targets.message).toBe(`${subtasks[1].key}: Das Projekt ist archiviert.`);
		// The first sub-task was saved before the refusal and rolled back with it.
		for (const [index, child] of subtasks.entries()) {
			expect(await ticketOf(child.id)).toMatchObject({ priority: 'medium', updated: before[index].updated, key: child.key });
			expect((await historyOf(s.superuser, child.id)).map((entry) => entry.field)).toEqual(['created']);
		}
	});

	it('answers 409 when the parent changed after the dialog read it, and changes nothing', async () => {
		const { parent, subtasks } = await family(s.a, s.ids.a, { priority: 'high' }, [{}]);
		await s.a.collection('tickets').update(parent.id, { priority: 'urgent' });
		const refused = await refusalOf(transfer(s.a, parent, { fields: { priority: true } }));
		expect(refused).toMatchObject({ status: 409, message: 'Das Hauptticket wurde inzwischen geändert. Bitte erneut öffnen.' });
		expect((await ticketOf(subtasks[0].id)).priority).toBe('medium');
	});
});

describe('targets, limit and rights', () => {
	it('refuses tickets that are no sub-task of this parent: another one, the parent itself, one in the trash', async () => {
		const { parent, subtasks } = await family(s.a, s.ids.a, { priority: 'high' }, [{}]);
		const other = await family(s.a, s.ids.a, {}, [{}]);
		const loose = await ticket(s.a, s.ids.a);
		for (const [index, id] of [other.subtasks[0].id, parent.id, loose.id].entries()) {
			const refused = await refusalOf(transfer(s.a, parent, { fields: { priority: true }, targets: [subtasks[0].id, id] }));
			expect(refused.status, `case ${index}`).toBe(400);
			expect(refused.data.targets).toMatchObject({ code: 'validation_transfer_target', params: { index: 1, id } });
		}
		const trashed = await ticket(s.a, s.ids.a, { parent: parent.id });
		await s.a.collection('tickets').delete(trashed.id);
		const refused = await refusalOf(transfer(s.a, await ticketOf(parent.id), { fields: { priority: true }, targets: [trashed.id] }));
		expect(refused.data.targets?.code).toBe('validation_transfer_target');
		expect((await ticketOf(subtasks[0].id)).priority).toBe('medium');
	});

	it('takes at most 200 sub-tasks at once and needs at least one field and one target', async () => {
		const { parent } = await family(s.a, s.ids.a, {}, [{}]);
		const ids = Array.from({ length: 201 }, (_, index) => `t${String(index).padStart(14, '0')}`);
		expect(await rejectionOf(transfer(s.a, parent, { fields: { priority: true }, targets: ids }))).toEqual({
			status: 400,
			codes: { targets: 'validation_transfer_targets_max' }
		});
		expect(await rejectionOf(transfer(s.a, parent, { fields: {} }))).toEqual({ status: 400, codes: { fields: 'validation_transfer_fields' } });
		expect(await rejectionOf(transfer(s.a, parent, { fields: { title: true } }))).toEqual({ status: 400, codes: { fields: 'validation_transfer_field' } });
		expect(await rejectionOf(transfer(s.a, parent, { fields: { priority: true }, targets: [] }))).toEqual({
			status: 400,
			codes: { targets: 'validation_transfer_targets' }
		});
		expect(await rejectionOf(transfer(s.a, parent, { fields: { due: { mode: 'shift', days: 0 } } }))).toEqual({
			status: 400,
			codes: { due: 'validation_transfer_due' }
		});
		// A ticket without open sub-tasks has no target for "Alle offenen".
		const lonely = await ticket(s.a, s.ids.a);
		expect(await rejectionOf(transfer(s.a, lonely, { fields: { priority: true } }))).toEqual({
			status: 400,
			codes: { targets: 'validation_transfer_targets' }
		});
		expect(await rejectionOf(s.a.send(route(parent.id), { method: 'POST', body: { fields: { priority: true }, targets: 'open' } }))).toEqual({
			status: 400,
			codes: { expected_updated: 'validation_transfer_expected' }
		});
	});

	it('refuses "Alle offenen" for more than 200 open sub-tasks and changes none of them', async () => {
		const parent = await ticket(s.a, s.ids.a, { priority: 'high' });
		for (let start = 0; start < 201; start += 25) {
			const size = Math.min(25, 201 - start);
			await Promise.all(Array.from({ length: size }, () => ticket(s.a, s.ids.a, { parent: parent.id })));
		}
		expect(await rejectionOf(transfer(s.a, parent, { fields: { priority: true } }))).toEqual({
			status: 400,
			codes: { targets: 'validation_transfer_targets_max' }
		});
		const changed = await s.superuser
			.collection('tickets')
			.getList(1, 1, { filter: s.superuser.filter("parent = {:id} && priority = 'high'", { id: parent.id }) });
		expect(changed.totalItems).toBe(0);
	});

	it('lets every member of the household transfer, nobody else, and nobody without an account', async () => {
		const { parent, subtasks } = await family(s.a, s.ids.a, { household: s.h1.id, priority: 'high' }, [{}]);
		// C belongs to another household: the ticket does not exist for him (404 with the field ticket).
		const foreign = await refusalOf(transfer(s.c, parent, { fields: { priority: true } }));
		expect(foreign.status).toBe(404);
		expect(foreign.data.ticket?.code).toBe('validation_transfer_missing');
		// A private ticket of A neither for B.
		const own = await family(s.a, s.ids.a, { priority: 'high' }, [{}]);
		expect(await statusOf(transfer(s.b, own.parent, { fields: { priority: true } }))).toBe(404);
		expect(await statusOf(transfer(createClient(), parent, { fields: { priority: true } }))).toBe(401);
		expect((await ticketOf(subtasks[0].id)).priority).toBe('medium');
		// B is a member: he may.
		expect((await transfer(s.b, parent, { fields: { priority: true } })).changed).toBe(1);
		const entry = (await historyOf(s.superuser, subtasks[0].id)).find((item) => item.field === 'priority');
		expect(entry?.user).toBe(s.ids.b);
	});

	it('is named by GET /api/byl/tickets/create, so the dialog knows the route exists', async () => {
		expect((await fetchCreateSupport(s.a))?.subtaskTransfer).toBe(true);
	});
});

describe('the notice of the assignee', () => {
	it('tells each person once of all sub-tasks given to him and makes them new for him', async () => {
		const toB = await notices(s.b);
		const toA = await notices(s.a);
		const { parent, subtasks } = await family(
			s.a,
			s.ids.a,
			{ household: s.h1.id, assignee: s.ids.b, title: 'Garten winterfest' },
			[{ title: 'Laub' }, { title: 'Wasser abstellen' }, { title: 'Rosen' }]
		);
		// B read the sub-tasks before; the assignment makes them new for him again.
		for (const child of subtasks) await s.b.collection('ticket_reads').create({ user: s.ids.b, ticket: child.id });
		// The notice of the parent itself (created for B by A) comes first.
		await until(() => toB.some((notice) => notice.ticket === parent.id), 'notice of the parent');

		const answer = await transfer(s.a, parent, { fields: { assignee: true } });
		expect(answer.changed).toBe(3);
		await until(() => toB.some((notice) => notice.parent === parent.id), 'notice of the sub-tasks');
		// A marker afterwards: nothing else came in between (one tab gets its messages in order).
		const marker = await ticket(s.a, s.ids.a, { household: s.h1.id, assignee: s.ids.b });
		await until(() => toB.some((notice) => notice.ticket === marker.id), 'marker');
		const between = toB.filter((notice) => notice.ticket !== parent.id && notice.ticket !== marker.id);
		expect(between).toEqual([
			{
				ticket: subtasks[0].id,
				key: subtasks[0].key,
				title: 'Laub',
				scope: `h:${s.h1.id}`,
				by: s.ids.a,
				by_name: 'Anna Beispiel',
				count: 3,
				parent: parent.id,
				parent_key: parent.key,
				parent_title: 'Garten winterfest'
			}
		]);
		expect(toA).toEqual([]);
		for (const child of subtasks) {
			const now = await ticketOf(child.id);
			expect(now.assignee).toBe(s.ids.b);
			expect(now.assigned_at).not.toBe('');
			const reads = await s.superuser
				.collection('ticket_reads')
				.getFullList({ filter: s.superuser.filter('user = {:u} && ticket = {:t}', { u: s.ids.b, t: child.id }) });
			expect(reads).toEqual([]);
		}
	});

	it('sends a single sub-task as the notice of one ticket, and nothing for an own assignment', async () => {
		const toB = await notices(s.b);
		const { parent, subtasks } = await family(s.b, s.ids.b, { household: s.h1.id, assignee: s.ids.b }, [{ title: 'Einzeln' }]);
		// Own assignment of B: no notice.
		await transfer(s.b, parent, { fields: { assignee: true } });
		const other = await family(s.a, s.ids.a, { household: s.h1.id, assignee: s.ids.b }, [{ title: 'Nur eine' }]);
		await transfer(s.a, other.parent, { fields: { assignee: true } });
		await until(() => toB.some((notice) => notice.ticket === other.subtasks[0].id), 'notice of the sub-task');
		expect(toB.find((notice) => notice.ticket === other.subtasks[0].id)).toEqual({
			ticket: other.subtasks[0].id,
			key: other.subtasks[0].key,
			title: 'Nur eine',
			scope: `h:${s.h1.id}`,
			by: s.ids.a,
			by_name: 'Anna Beispiel'
		});
		expect(toB.some((notice) => notice.ticket === subtasks[0].id)).toBe(false);
	});
});

describe('the data layer of the SPA', () => {
	it('sends the request of the dialog and reads the answer', async () => {
		const { parent, subtasks } = await family(s.a, s.ids.a, { priority: 'high' }, [{}]);
		const outcome = await transferToSubtasks(s.a, parent.id, {
			expectedUpdated: parent.updated,
			fields: { due: null, priority: true, status: false, assignee: false, project: false, tags: null },
			targets: 'open'
		});
		expect(outcome).toEqual({
			parent: { id: parent.id, key: parent.key },
			changed: 1,
			unchanged: 0,
			tickets: [{ id: subtasks[0].id, key: subtasks[0].key, previousKey: subtasks[0].key }]
		});
	});
});
