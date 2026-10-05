// "Duplizieren" into the other area (MV-2, ADR-0045 addendum MV-2) against an own disposable PocketBase:
// A and B share a household (A founds it), C is alone. The copy of an own private ticket goes into the
// household with a project of the household, tags by name (a missing one created there), its sub-tasks,
// charm and kind, without sources; a ticket of the household goes into the private area of any member
// who sees it. The original stays as it is; both history entries name the area of the other ticket.
// The refusals (area, source, project, rights) come before the first write, and a failing write leaves
// nothing behind. The route of the target names the projects and tags of the other area first; the
// data layer of the SPA reads both routes strictly.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FAIL_DUPLICATE, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { duplicateTicket, fetchDuplicateTarget } from '../../web/src/lib/data/tickets.ts';

const ROUTE = '/api/byl/household';

let instance;
let superuser;
let a;
let b;
let c;
let householdId;

function createClient() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

/** A new app account with random credentials (in memory only), signed in. */
async function createAccount(name) {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password, name })).id;
	const client = createClient();
	await client.collection('users').authWithPassword(email, password);
	return {
		id,
		client,
		send: (path, body, method = 'POST') => client.send(path, { method, body, requestKey: null }),
		target: (ticketId, to) =>
			client.send(`/api/byl/tickets/${ticketId}/duplicate-target`, { method: 'GET', query: { to }, requestKey: null }),
		duplicate: (ticketId, body) =>
			client.send(`/api/byl/tickets/${ticketId}/duplicate`, { method: 'POST', body: { status: 'open', ...body }, requestKey: null }),
		ticket: (data = {}) => client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data }),
		project: (data = {}) =>
			client.collection('projects').create({ owner: id, name: `Projekt ${uniqueSuffix()}`, code: uniqueCode(), ...data }),
		tag: (data = {}) => client.collection('tags').create({ owner: id, name: `tag-${uniqueSuffix()}`, ...data })
	};
}

const privateScope = (person) => `u:${person.id}`;
const householdScope = () => `h:${householdId}`;

/** Status and the validation code per field of a refused call. */
async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		const data = error.response?.data ?? {};
		return { status: error.status, codes: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.code])) };
	}
	throw new Error('Expected the request to be rejected, but it succeeded.');
}

async function statusOf(promise) {
	try {
		await promise;
		return 200;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return error.status;
	}
}

const ticketOf = (id) => superuser.collection('tickets').getOne(id);
const historyOf = (id) =>
	superuser.collection('ticket_history').getFullList({ filter: superuser.filter('ticket = {:id}', { id }), sort: 'created,id' });
const childrenOf = (id) =>
	superuser.collection('tickets').getFullList({ filter: superuser.filter('parent = {:p}', { p: id }), sort: 'created,id' });
const tagsNamed = (scope, name) =>
	superuser.collection('tags').getFullList({ filter: superuser.filter('scope = {:s} && name = {:n}', { s: scope, n: name }) });
const ticketsTitled = (title) =>
	superuser.collection('tickets').getFullList({ filter: superuser.filter('title ~ {:t}', { t: title }) });

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = createClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	a = await createAccount('Anna Beispiel');
	b = await createAccount('Bert Beispiel');
	c = await createAccount('Clara Beispiel');
	householdId = (await a.send(ROUTE, { name: `Haus ${uniqueSuffix()}` })).household.id;
	const { code } = await a.send(`${ROUTE}/invites`, {});
	await b.send(`${ROUTE}/join`, { code });
});

afterAll(async () => {
	await instance?.stop();
});

/**
 * An own private ticket of A with everything a copy could take: a project, a tag the household has by
 * name and one it does not, two sub-tasks, a comment, a charm, the kind "Laufendes Vorhaben", a main
 * source from the inbox and a source ticket.
 */
async function richPrivateTicket() {
	const shared = `garten-${uniqueSuffix()}`;
	const fresh = `einkauf-${uniqueSuffix()}`;
	await b.tag({ household: householdId, name: shared });
	const tagShared = await a.tag({ name: shared });
	const tagFresh = await a.tag({ name: fresh });
	const project = await a.project();
	const item = await a.client.collection('inbox_items').create({ owner: a.id, channel: 'manual', kind: 'todo', title: `Notiz ${uniqueSuffix()}` });
	const source = await a.ticket();
	const original = await a.ticket({
		title: `Hecke schneiden ${uniqueSuffix()}`,
		project: project.id,
		tags: [tagShared.id, tagFresh.id],
		charm: 'garten',
		kind: 'ongoing',
		priority: 'high',
		description: 'Mit der großen Schere.',
		source_item: item.id
	});
	await a.send(`/api/byl/tickets/${original.id}/ticket-sources`, { source: source.id });
	const sub1 = await a.ticket({ parent: original.id, project: project.id, tags: [tagFresh.id], title: 'Schere schärfen' });
	const sub2 = await a.ticket({ parent: original.id, project: project.id, title: 'Grünschnitt wegbringen', status: 'done' });
	await a.client.collection('comments').create({ ticket: original.id, author: a.id, body: 'Erst nach dem Regen.' });
	return { original: await ticketOf(original.id), project, shared, fresh, sub1, sub2, item, source };
}

describe('into the household (own private ticket)', () => {
	it('names the projects and tags of the household first, without writing', async () => {
		const { original, shared, fresh } = await richPrivateTicket();
		const parent = await a.project({ household: householdId, name: `Haus ${uniqueSuffix()}` });
		const child = await a.project({ household: householdId, parent: parent.id });
		const archived = await a.project({ household: householdId, archived: true });
		const target = await a.target(original.id, 'household');
		expect(target).toMatchObject({ to: 'household', scope: householdScope(), tags: { reused: [shared], created: [fresh] } });
		expect(target.name).toMatch(/^Haus /);
		const ids = target.projects.map((entry) => entry.id);
		expect(ids).toEqual(expect.arrayContaining([parent.id, child.id]));
		expect(ids).not.toContain(archived.id);
		expect(target.projects.find((entry) => entry.id === child.id).parent).toBe(parent.id);
		// Nothing was written: the household has no tag of the new name yet.
		expect(await tagsNamed(householdScope(), fresh)).toHaveLength(0);
		// The area of the original names its own projects and no mapping.
		const own = await a.target(original.id, 'private');
		expect(own).toMatchObject({ to: 'private', scope: privateScope(a), name: '', tags: { reused: [], created: [] } });
		expect(own.projects.map((entry) => entry.id)).toContain(original.project);
	});

	it('copies into a project of the household with tags by name, sub-tasks, comments, charm and kind; no source', async () => {
		const { original, shared, fresh, sub1, sub2 } = await richPrivateTicket();
		const home = await a.project({ household: householdId });
		const before = await ticketOf(original.id);
		const result = await a.duplicate(original.id, {
			title: 'Hecke schneiden (Kopie)',
			to: 'household',
			project: home.id,
			description: true,
			priority: true,
			tags: true,
			subtasks: true,
			comments: true,
			parent: true,
			source: 'none'
		});
		expect(result.scope).toBe(householdScope());
		expect(result.key).toBe(`${home.code}-1`);
		expect(result).toMatchObject({ source: '', ticket_sources: 0, comments: 1 });
		const copy = await ticketOf(result.id);
		const [sharedTag] = await tagsNamed(householdScope(), shared);
		const [freshTag] = await tagsNamed(householdScope(), fresh);
		expect(freshTag.owner).toBe(a.id);
		expect(copy).toMatchObject({
			owner: a.id,
			household: householdId,
			scope: householdScope(),
			project: home.id,
			parent: '',
			priority: 'high',
			description: 'Mit der großen Schere.',
			charm: 'garten',
			kind: 'ongoing',
			source: 'manual',
			source_item: '',
			recurrence: ''
		});
		expect(copy.tags.sort()).toEqual([sharedTag.id, freshTag.id].sort());
		// The sub-tasks: new, open, in the household with the project of the copy and mapped tags.
		const children = await childrenOf(copy.id);
		expect(children.map((child) => [child.title, child.status, child.scope, child.project])).toEqual([
			[sub1.title, 'open', householdScope(), home.id],
			[sub2.title, 'open', householdScope(), home.id]
		]);
		expect(children[0].tags).toEqual([freshTag.id]);
		// No source: no entry of the inbox, no source ticket.
		expect(await superuser.collection('inbox_items').getFullList({ filter: superuser.filter('ticket = {:t}', { t: copy.id }) })).toHaveLength(0);
		expect(await superuser.collection('ticket_sources').getFullList({ filter: superuser.filter('ticket = {:t}', { t: copy.id }) })).toHaveLength(0);
		// History: both name the area of the other ticket and its key, no ID across the border.
		const from = (await historyOf(copy.id)).find((entry) => entry.field === 'duplicate');
		const to = (await historyOf(original.id)).find((entry) => entry.field === 'duplicate');
		expect(JSON.parse(from.new_value)).toEqual({ direction: 'from', ticket: '', key: original.key, area: 'private' });
		expect(JSON.parse(to.new_value)).toEqual({ direction: 'to', ticket: '', key: copy.key, area: 'household' });
		// The original stays as it is, private.
		const after = await ticketOf(original.id);
		expect([after.scope, after.key, after.updated, after.tags, after.source_item]).toEqual([
			before.scope,
			before.key,
			before.updated,
			before.tags,
			before.source_item
		]);
		// B sees the copy and its sub-tasks; C nothing.
		expect((await b.client.collection('tickets').getOne(copy.id)).key).toBe(copy.key);
		expect(await statusOf(c.client.collection('tickets').getOne(copy.id))).toBe(404);
		expect(await statusOf(b.client.collection('tickets').getOne(original.id))).toBe(404);
	});

	it('copies without a project, and a sub-task as a top-level ticket of the target', async () => {
		const parentTicket = await a.ticket();
		const sub = await a.ticket({ parent: parentTicket.id, title: `Teil ${uniqueSuffix()}` });
		const result = await a.duplicate(sub.id, { title: 'Teil (Kopie)', to: 'household', project: '', parent: true });
		expect(result.key).toMatch(/^TASK-\d+$/);
		expect(await ticketOf(result.id)).toMatchObject({ scope: householdScope(), parent: '', project: '' });
		expect((await ticketOf(sub.id)).parent).toBe(parentTicket.id);
	});

	it('refuses a source, a project of another area or archived, before anything is written', async () => {
		const { original, project, fresh } = await richPrivateTicket();
		const archived = await a.project({ household: householdId, archived: true });
		const cases = [
			[{ source: 'copy' }, { source: 'validation_duplicate_source_area' }],
			[{ project: project.id }, { project: 'validation_duplicate_project_area' }],
			[{ project: archived.id }, { project: 'validation_duplicate_project_area' }],
			[{ to: 'garten' }, { to: 'validation_duplicate_area' }]
		];
		for (const [extra, codes] of cases) {
			const refused = await rejection(a.duplicate(original.id, { title: 'Abgelehnt', to: 'household', tags: true, ...extra }));
			expect(refused, JSON.stringify(extra)).toEqual({ status: 400, codes });
		}
		expect(await ticketsTitled('Abgelehnt')).toHaveLength(0);
		expect(await tagsNamed(householdScope(), fresh)).toHaveLength(0);
	});

	it('copies only an own private ticket; without a household there is no other area', async () => {
		const own = await a.ticket();
		expect(await statusOf(b.duplicate(own.id, { title: 'Fremd', to: 'household' }))).toBe(404);
		expect(await statusOf(b.target(own.id, 'household'))).toBe(404);
		const alone = await c.ticket();
		expect(await rejection(c.duplicate(alone.id, { title: 'Allein', to: 'household' }))).toEqual({
			status: 400,
			codes: { to: 'validation_duplicate_no_household' }
		});
		expect(await rejection(c.target(alone.id, 'household'))).toEqual({
			status: 400,
			codes: { to: 'validation_duplicate_no_household' }
		});
		expect(await ticketsTitled('Allein')).toHaveLength(0);
	});
});

describe('into the private area (ticket of the household)', () => {
	it('lets every member who sees it copy it into the own private area; the original stays in the household', async () => {
		const tag = await a.tag({ household: householdId, name: `küche-${uniqueSuffix()}` });
		const original = await a.ticket({ household: householdId, tags: [tag.id], title: `Herd putzen ${uniqueSuffix()}` });
		const sub = await a.ticket({ household: householdId, parent: original.id, title: 'Ceranfeld' });
		const comment = await b.client.collection('comments').create({ ticket: original.id, author: b.id, body: 'Mit Schaber.' });
		// B created none of it and has no "move_out": copying is not moving.
		const target = await b.target(original.id, 'private');
		expect(target).toMatchObject({ to: 'private', scope: privateScope(b), name: 'Privat', tags: { reused: [], created: [tag.name] } });
		const result = await b.duplicate(original.id, { title: 'Herd putzen (Kopie)', to: 'private', tags: true, subtasks: true, comments: true });
		const copy = await ticketOf(result.id);
		expect(copy).toMatchObject({ owner: b.id, household: '', scope: privateScope(b) });
		const [mine] = await tagsNamed(privateScope(b), tag.name);
		expect(copy.tags).toEqual([mine.id]);
		expect((await childrenOf(copy.id)).map((child) => [child.title, child.scope])).toEqual([[sub.title, privateScope(b)]]);
		expect(result.comments).toBe(1);
		const original2 = await ticketOf(original.id);
		expect(original2).toMatchObject({ scope: householdScope(), owner: a.id });
		expect((await ticketOf(sub.id)).parent).toBe(original.id);
		expect((await superuser.collection('comments').getOne(comment.id)).ticket).toBe(original.id);
		// A does not see the private copy; the history of the original names it without a link.
		expect(await statusOf(a.client.collection('tickets').getOne(copy.id))).toBe(404);
		const to = (await historyOf(original.id)).find((entry) => entry.field === 'duplicate');
		expect(JSON.parse(to.new_value)).toEqual({ direction: 'to', ticket: '', key: copy.key, area: 'private' });
		// C is no member: not found.
		expect(await statusOf(c.duplicate(original.id, { title: 'Fremd', to: 'private' }))).toBe(404);
	});

	it('keeps the area of the original without "to" or with its own area', async () => {
		const original = await a.ticket({ household: householdId });
		const same = await b.duplicate(original.id, { title: 'Gleich', to: 'household' });
		expect(same.scope).toBe(householdScope());
		const plain = await b.duplicate(original.id, { title: 'Ohne Ziel' });
		expect(plain.scope).toBe(householdScope());
		const entry = (await historyOf(plain.id)).find((item) => item.field === 'duplicate');
		expect(JSON.parse(entry.new_value)).toEqual({ direction: 'from', ticket: original.id, key: original.key });
	});
});

describe('one transaction', () => {
	it('leaves nothing behind when the last write fails: no copy, no sub-task, no new tag, no number', async () => {
		const fresh = `neu-${uniqueSuffix()}`;
		const tag = await a.tag({ name: fresh });
		const original = await a.ticket({ title: FAIL_DUPLICATE, tags: [tag.id] });
		await a.ticket({ parent: original.id, title: `Teil ${uniqueSuffix()}` });
		const counter = async () =>
			(await superuser.collection('ticket_counters').getFullList({ filter: superuser.filter('key = {:k}', { k: `${householdScope()}:TASK` }) })).map(
				(row) => row.value
			);
		const before = await counter();
		const title = `Kopie ${uniqueSuffix()}`;
		expect(await statusOf(a.duplicate(original.id, { title, to: 'household', tags: true, subtasks: true }))).toBe(400);
		expect(await ticketsTitled(title)).toHaveLength(0);
		expect(await tagsNamed(householdScope(), fresh)).toHaveLength(0);
		expect(await counter()).toEqual(before);
		expect((await historyOf(original.id)).some((entry) => entry.field === 'duplicate')).toBe(false);
	});
});

describe('data layer of the SPA (web/src/lib/data/tickets.ts)', () => {
	it('reads the target and the duplicate into the other area strictly, and a refusal at its field', async () => {
		const project = await a.project({ household: householdId });
		const original = await a.ticket();
		const target = await fetchDuplicateTarget(a.client, original.id, 'household');
		expect(target.to).toBe('household');
		expect(target.projects.map((entry) => entry.id)).toContain(project.id);
		const outcome = await duplicateTicket(a.client, original.id, {
			title: 'Über die Datenschicht',
			status: 'backlog',
			project: project.id,
			take: { description: true, priority: true, tags: true, due: true, parent: false, subtasks: false, comments: false, color: true },
			source: 'none',
			to: 'household'
		});
		expect(outcome.scope).toBe(householdScope());
		expect(outcome.key).toBe(`${project.code}-1`);
		await expect(fetchDuplicateTarget(c.client, original.id, 'household')).rejects.toMatchObject({ kind: 'not_found' });
		const alone = await c.ticket();
		await expect(fetchDuplicateTarget(c.client, alone.id, 'household')).rejects.toMatchObject({
			kind: 'validation',
			fields: { to: { code: 'validation_duplicate_no_household' } }
		});
	});
});
