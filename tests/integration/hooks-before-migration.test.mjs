// The running instance loads new hooks at once, but runs new migrations only at its next start
// (E4 plan, package 1). The hooks of E4 must therefore work on the schema before the E4
// migrations: tickets without source/source_item and no inbox_items collection.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writtenLogs } from '../support/logs.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { fetchAccounts } from '../../web/src/lib/data/accounts.ts';
import { adminOf } from '../../web/src/lib/domain/accounts.ts';
import { fetchHousehold, foundHousehold } from '../../web/src/lib/data/household.ts';
import { createInboxKey, listInboxKeys } from '../../web/src/lib/data/inbox-keys.ts';
import { createProject, listProjects, updateProject } from '../../web/src/lib/data/projects.ts';
import { createComment, deleteComment } from '../../web/src/lib/data/comments.ts';
import {
	eachOccurrenceReady,
	initialStatusReady,
	listRules,
	templateSubtasksReady
} from '../../web/src/lib/data/recurrence.ts';
import { createTicket, deleteTicket, getTicket, updateTicket } from '../../web/src/lib/data/tickets.ts';
import { unreadSinceOf } from '../../web/src/lib/domain/unread.ts';

// First migration of E4; the instance runs only the migrations before it.
const E4_FIRST_MIGRATION = '1790201200_create_inbox_items.js';
// Invented token of the mail helper (package 22).
const INGEST_TOKEN = randomBytes(24).toString('base64');

let instance;
let client;
let userId;

function newClient() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

/** Log entries of the server itself (hooks, jobs), without those of the requests. */
const jobEntries = (entries) => entries.filter((entry) => entry.data?.type !== 'request');

beforeAll(async () => {
	instance = await startPocketBase({
		migrationFilter: (name) => name < E4_FIRST_MIGRATION,
		env: { BYL_INGEST_TOKEN: INGEST_TOKEN }
	});
	const superuser = newClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	userId = (await superuser.collection('users').create({ email, password, passwordConfirm: password }))
		.id;
	client = newClient();
	await client.collection('users').authWithPassword(email, password);
});

afterAll(async () => {
	await instance?.stop();
});

describe('E4 hooks on the schema before the E4 migrations', () => {
	it('has no inbox yet', async () => {
		await expect(client.collection('inbox_items').getList(1, 1)).rejects.toMatchObject({ status: 404 });
	});

	it('has no read rows and no base line yet, so the app marks nothing as new', async () => {
		await expect(client.collection('ticket_reads').getList(1, 1)).rejects.toMatchObject({
			status: 404
		});
		expect(client.authStore.record).not.toHaveProperty('unread_since');
		expect(unreadSinceOf(client.authStore.record)).toBeNull();
	});

	it('creates, updates and deletes tickets; the new fields are ignored', async () => {
		const tickets = client.collection('tickets');
		const ticket = await tickets.create({
			owner: userId,
			title: 'Vor der Migration',
			source: 'manual',
			source_item: 'abcdefghijklmno'
		});
		expect(ticket.key).toBe('TASK-1');
		expect(ticket.source).toBeUndefined();
		expect(ticket.source_item).toBeUndefined();

		const quick = await tickets.create({ owner: userId, title: 'Schnell', source: 'quick' });
		expect(quick.key).toBe('TASK-2');

		const updated = await tickets.update(ticket.id, { title: 'Geändert', status: 'done', source: 'eml' });
		expect(updated.title).toBe('Geändert');
		expect(updated.completed_at).not.toBe('');

		await tickets.delete(ticket.id);
		await expect(tickets.getOne(ticket.id)).rejects.toMatchObject({ status: 404 });
	});

	it('answers the .ics route with a hint instead of an error', async () => {
		const form = new FormData();
		form.append('file', new Blob(['BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n']), 'kalender.ics');
		const response = await fetch(`${instance.url}/api/byl/inbox/ics`, {
			method: 'POST',
			body: form,
			headers: { Authorization: client.authStore.token }
		});
		expect(response.status).toBe(503);
		expect((await response.json()).message).toBe(
			'Der Eingang steht nach dem nächsten Neustart der App bereit (neu-starten.bat).'
		);
	});

	it('answers the preview and the lookup of the file selection with the hint (package 21)', async () => {
		const form = new FormData();
		form.append('file', new Blob(['BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n']), 'kalender.ics');
		const preview = await fetch(`${instance.url}/api/byl/inbox/ics/preview`, {
			method: 'POST',
			body: form,
			headers: { Authorization: client.authStore.token }
		});
		expect(preview.status).toBe(503);
		const lookup = await fetch(`${instance.url}/api/byl/inbox/lookup`, {
			method: 'POST',
			body: JSON.stringify({ items: [] }),
			headers: { Authorization: client.authStore.token, 'Content-Type': 'application/json' }
		});
		expect(lookup.status).toBe(503);
	});

	it('lets users change their record without the keyword field', async () => {
		const updated = await client.collection('users').update(userId, { name: 'Anna' });
		expect(updated.name).toBe('Anna');
		expect(updated.import_keywords).toBeUndefined();
	});

	it('has no connections yet and answers their route with a hint', async () => {
		await expect(client.collection('connections').getList(1, 1)).rejects.toMatchObject({ status: 404 });
		const response = await fetch(`${instance.url}/api/byl/connections/abcdefghijklmno/secret-status`, {
			headers: { Authorization: client.authStore.token }
		});
		expect(response.status).toBe(503);
		expect((await response.json()).message).toBe(
			'Die Verbindungen stehen nach dem nächsten Neustart der App bereit (neu-starten.bat).'
		);
	});

	it('answers "Jetzt abrufen" with the hint and lets the calendar job do nothing', async () => {
		const response = await fetch(`${instance.url}/api/byl/connections/abcdefghijklmno/run`, {
			method: 'POST',
			headers: { Authorization: client.authStore.token }
		});
		expect(response.status).toBe(503);
		const superuser = newClient();
		await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
		const cron = await fetch(`${instance.url}/api/crons/byl-calendar`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token }
		});
		expect(cron.status).toBe(204);
		// The job runs in the background and PocketBase writes its log in batches: read the log once
		// a request after the job is written, so an entry of the job would be there too. Only the
		// entries of the server count; the request that started the job names it in its address.
		const logs = JSON.stringify(jobEntries(await writtenLogs(superuser)));
		expect(logs).not.toMatch(/byl-calendar/);
	});

	it('lets the cleanup of discarded items do nothing without the inbox (package 24)', async () => {
		const superuser = newClient();
		await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
		const cron = await fetch(`${instance.url}/api/crons/byl-inbox-cleanup`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token }
		});
		expect(cron.status).toBe(204);
		const logs = JSON.stringify(jobEntries(await writtenLogs(superuser)));
		expect(logs).not.toMatch(/byl-inbox-cleanup|verworfen/);
	});

	it('answers the ingest routes of the mail helper with the hint (package 22)', async () => {
		const headers = { Authorization: `Bearer ${INGEST_TOKEN}`, 'Content-Type': 'application/json' };
		const list = await fetch(`${instance.url}/api/byl/ingest/connections`, { headers });
		expect(list.status).toBe(503);
		expect((await list.json()).message).toMatch(/nach dem nächsten Neustart der App bereit \(neu-starten\.bat\)/);
		const item = await fetch(`${instance.url}/api/byl/ingest/items`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ connection: 'abcdefghijklmno', origin: 'auto', title: 'Todo' })
		});
		expect(item.status).toBe(503);
		const status = await fetch(`${instance.url}/api/byl/ingest/connections/abcdefghijklmno/status`, {
			method: 'POST',
			headers,
			body: '{}'
		});
		expect(status.status).toBe(503);
	});
});

// The instance of the user after the merge of package 21, before its next start: every
// migration but 1790201500. The selection of .ics files works without keywords.
describe('package 21 hooks before the migration of the import keywords', () => {
	const KEYWORDS_MIGRATION = '1790201500_users_import_keywords.js';
	let before;
	let who;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < KEYWORDS_MIGRATION });
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('previews and imports a chosen event without keywords', async () => {
		const calendar = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:vorher-1\r\nSUMMARY:Todo: Termin\r\nDTSTART;VALUE=DATE:20261001\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
		const send = async (route, select) => {
			const form = new FormData();
			form.append('file', new Blob([calendar]), 'kalender.ics');
			if (select !== undefined) form.append('select', JSON.stringify(select));
			const response = await fetch(`${before.url}${route}`, {
				method: 'POST',
				body: form,
				headers: { Authorization: who.authStore.token }
			});
			return { status: response.status, body: await response.json() };
		};
		const preview = await send('/api/byl/inbox/ics/preview');
		expect(preview.status).toBe(200);
		expect(preview.body.items).toMatchObject([{ index: 0, title: 'Todo: Termin', keyword: '' }]);
		const imported = await send('/api/byl/inbox/ics', [0]);
		expect(imported.body).toMatchObject({ created: 1 });
	});

	it('lets users change their record; the keyword field is not there yet', async () => {
		const updated = await who.collection('users').update(who.userId, { name: 'Ben' });
		expect(updated.name).toBe('Ben');
		expect(updated.import_keywords).toBeUndefined();
	});
});

// The instance of the user after the merge of E5 package 2, before its next start: the schema of
// E4 with the hooks of E5. Rules and tickets.recurrence behave as in E4 (E5 plan, section 2).
describe('E5 hooks before the E5 migrations', () => {
	const E5_FIRST_MIGRATION = '1790201600_recurrence_rule_params.js';
	let before;
	let who;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < E5_FIRST_MIGRATION });
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('creates and edits rules without the rhythm checks (package 2)', async () => {
		const rules = who.collection('recurrence_rules');
		const rule = await rules.create({
			owner: who.userId,
			title: 'Vor der Migration',
			mode: 'calendar',
			next_due: '2026-10-01',
			freq: 'weekly'
		});
		expect(rule.freq).toBeUndefined();
		expect(rule.scope).toBeUndefined();
		expect(rule.next_due).toBe('2026-10-01 00:00:00.000Z');
		expect(rule.active).toBe(false);
		const updated = await rules.update(rule.id, { title: 'Geändert', next_due: '2026-11-01' });
		expect(updated.next_due).toBe('2026-11-01 00:00:00.000Z');
	});

	it('lets clients set and clear tickets.recurrence as in E4 (package 2)', async () => {
		const rule = await who
			.collection('recurrence_rules')
			.create({ owner: who.userId, title: 'Serie', mode: 'after_completion' });
		const tickets = who.collection('tickets');
		const ticket = await tickets.create({ owner: who.userId, title: 'In der Serie', recurrence: rule.id });
		expect(ticket.recurrence).toBe(rule.id);
		const other = await tickets.create({ owner: who.userId, title: 'Auch in der Serie' });
		expect((await tickets.update(other.id, { recurrence: rule.id })).recurrence).toBe(rule.id);
		expect((await tickets.update(ticket.id, { recurrence: '' })).recurrence).toBe('');
	});

	it('lets the web app see that the rules come with the next start (package 4)', async () => {
		expect(await listRules(who)).toBeNull();
	});

	it('lets completing, reopening, deleting, the cron job and the start create nothing (package 3)', async () => {
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const rule = await who
			.collection('recurrence_rules')
			.create({ owner: who.userId, title: 'Serie', mode: 'after_completion', next_due: '2026-01-01' });
		const tickets = who.collection('tickets');
		const ticket = await tickets.create({ owner: who.userId, title: 'Instanz', recurrence: rule.id });
		const count = async () => (await superuser.collection('tickets').getFullList()).length;
		const initial = await count();

		const done = await tickets.update(ticket.id, { status: 'done' });
		expect(done.completed_at).not.toBe('');
		expect((await tickets.update(ticket.id, { status: 'open' })).completed_at).toBe('');
		const cron = await fetch(`${before.url}/api/crons/byl-recurrence`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token }
		});
		expect(cron.status).toBe(204);
		await tickets.delete(ticket.id);

		expect(await count()).toBe(initial - 1);
		expect((await superuser.collection('recurrence_rules').getOne(rule.id)).next_due).toBe('2026-01-01 00:00:00.000Z');
		// The start of this instance ran the catch-up on the old schema; it answered and changed nothing.
		expect((await fetch(`${before.url}/api/health`)).status).toBe(200);
	});
});

// The instance of the user after the merge of HK-1, before its next start: the old deleteRule of
// inbox_items with the new hooks (ADR-0031 sections 2 and 3). Linking, releasing and the delete
// guard work through the hooks alone.
describe('HK-1 hooks before the delete guard migration', () => {
	const DELETE_GUARD_MIGRATION = '1790201800_inbox_items_delete_guard.js';
	let before;
	let who;
	let superuser;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < DELETE_GUARD_MIGRATION });
		superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('has the old deleteRule still', async () => {
		const collection = await superuser.collections.getOne('inbox_items');
		expect(collection.deleteRule).not.toContain('ticket = ""');
	});

	it('links and releases with history, and the hook alone refuses to delete a source', async () => {
		const items = who.collection('inbox_items');
		const ticket = await who.collection('tickets').create({ owner: who.userId, title: 'Ziel' });
		const item = await items.create({ owner: who.userId, channel: 'manual', kind: 'todo', title: 'Quelle' });
		await items.update(item.id, { state: 'converted', ticket: ticket.id });

		const refused = await items.delete(item.id).then(
			() => null,
			(error) => error
		);
		expect(refused?.status).toBe(400);
		expect(refused?.response?.data?.ticket?.code).toBe('validation_inbox_item_linked');

		const main = await items.create({ owner: who.userId, channel: 'manual', kind: 'todo', title: 'Hauptquelle' });
		await who.collection('tickets').create({ owner: who.userId, title: 'Aus Eintrag', source_item: main.id });
		expect((await items.delete(main.id).catch((error) => error))?.status).toBe(400);

		expect((await items.update(item.id, { state: 'new', ticket: '' })).state).toBe('new');
		const history = await superuser.collection('ticket_history').getFullList({
			filter: superuser.filter('ticket = {:id} && field = "source_link"', { id: ticket.id })
		});
		expect(history).toHaveLength(2);
		// Since the addendum of 2026-10-01 to ADR-0014 the hook refuses a free item as well.
		const free = await items.delete(item.id).catch((error) => error);
		expect(free?.status).toBe(400);
		expect(free?.response?.data?.state?.code).toBe('validation_inbox_item_delete');
		expect((await items.getOne(item.id)).state).toBe('new');
	});
});

// The instance of the user after the merge of the delete lock (ADR-0014, addendum of 2026-10-01),
// before its next start: the deleteRule still lets the owner reach a free item, the hook alone
// refuses every delete, for the owner and the superuser, and leaves the item in place.
describe('hooks before the migration of the delete lock of inbox items (ADR-0014, addendum of 2026-10-01)', () => {
	const NO_DELETE_MIGRATION = '1790202800_inbox_items_no_delete.js';
	let before;
	let who;
	let superuser;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < NO_DELETE_MIGRATION });
		superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('has the deleteRule of the sources still', async () => {
		const collection = await superuser.collections.getOne('inbox_items');
		expect(collection.deleteRule).toContain('ticket = ""');
	});

	it('refuses to delete a new and a discarded item through the hook alone', async () => {
		const items = who.collection('inbox_items');
		const fresh = await items.create({ owner: who.userId, channel: 'manual', kind: 'todo', title: 'Neu' });
		const discarded = await items.create({ owner: who.userId, channel: 'manual', kind: 'todo', title: 'Weg' });
		await items.update(discarded.id, { state: 'discarded' });
		for (const item of [fresh, discarded]) {
			for (const client of [who, superuser]) {
				const refused = await client
					.collection('inbox_items')
					.delete(item.id)
					.catch((error) => error);
				expect(refused?.status, item.title).toBe(400);
				expect(refused?.response?.data?.state?.code, item.title).toBe('validation_inbox_item_delete');
			}
			expect((await items.getOne(item.id)).id).toBe(item.id);
		}
	});
});

describe('HK-6 hooks before the migration of the orphaned sources', () => {
	const ORPHANS_MIGRATION = '1790201900_inbox_items_orphans.js';
	let before;
	let who;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < ORPHANS_MIGRATION });
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('gives the sources of a deleted ticket back or discards them, through both ways', async () => {
		const items = who.collection('inbox_items');
		const create = (title) => items.create({ owner: who.userId, channel: 'manual', kind: 'todo', title });
		const main = await create('Hauptquelle');
		const first = await who.collection('tickets').create({ owner: who.userId, title: 'Eins', source_item: main.id });
		await who.collection('tickets').delete(first.id);
		expect(await items.getOne(main.id)).toMatchObject({ state: 'new', ticket: '' });

		const second = await who.collection('tickets').create({ owner: who.userId, title: 'Zwei', source_item: main.id });
		await who.send(`/api/byl/tickets/${second.id}/delete`, { method: 'POST', body: { sources: 'discard' } });
		const discarded = await items.getOne(main.id);
		expect(discarded).toMatchObject({ state: 'discarded', ticket: '' });
		expect(discarded.source_meta.ticket_deleted.key).toBe(second.key);
	});
});

describe('UP-1 hooks before the migration of the sub projects (ADR-0034)', () => {
	const PARENT_MIGRATION = '1790202100_projects_parent.js';
	let before;
	let who;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < PARENT_MIGRATION });
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('creates, archives, restores and deletes projects as before; parent is ignored', async () => {
		const projects = who.collection('projects');
		const house = await projects.create({ owner: who.userId, name: 'Haus', code: 'HAUS' });
		const garden = await projects.create({ owner: who.userId, name: 'Garten', code: 'GART', parent: house.id });
		expect(house.parent).toBeUndefined();
		expect(garden.parent).toBeUndefined();

		// No cascade and no guard without the field.
		await projects.update(house.id, { archived: true });
		expect((await projects.getOne(garden.id)).archived).toBe(false);
		expect((await projects.update(house.id, { archived: false })).archived).toBe(false);

		const ticket = await who.collection('tickets').create({ owner: who.userId, title: 'Beet', project: garden.id });
		expect(ticket.key).toBe('GART-1');
		await expect(projects.delete(garden.id)).rejects.toMatchObject({ status: 400 });
		await projects.delete(house.id);
		await expect(projects.getOne(house.id)).rejects.toMatchObject({ status: 404 });
	});

	it('lets the SPA read and write projects; it learns that sub projects wait for the restart (UP-2)', async () => {
		const created = await createProject(who, { name: 'Keller', code: 'KELL' });
		expect(created).toMatchObject({ name: 'Keller', parentId: null, withoutParentField: true });
		const listed = await listProjects(who);
		expect(listed.find((project) => project.id === created.id)).toEqual(created);
		// A draft without parentId sends no parent at all.
		expect((await updateProject(who, created.id, { name: 'Kellerraum' })).name).toBe('Kellerraum');
	});

	it('answers a filter on the missing field with 400, so the SPA must not send it before the restart', async () => {
		await expect(
			who.collection('tickets').getList(1, 1, { filter: who.filter('project.parent = {:id}', { id: 'abcdefghijklmno' }) })
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('HK-8 hooks before the migration of the 25 MB originals', () => {
	const SIZE_MIGRATION = '1790202000_inbox_items_original_size.js';
	let before;
	let who;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < SIZE_MIGRATION });
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('keeps the old limit of 10 MB until the restart and takes smaller files as before', async () => {
		const items = who.collection('inbox_items');
		const form = (name, size) => {
			const data = new FormData();
			data.set('owner', who.userId);
			data.set('channel', 'eml');
			data.set('kind', 'mail');
			data.set('title', name);
			data.set('source_ref', `<${randomBytes(6).toString('hex')}@example.com>`);
			data.set('original', new Blob([`Subject: ${name}\r\n\r\n`, 'x'.repeat(size)]), `${name}.eml`);
			return data;
		};
		const small = await items.create(form('klein', 1024));
		expect(small.original).toMatch(/^klein_\w+\.eml$/);
		const refused = await items.create(form('mittel', 12 * 1024 * 1024)).catch((error) => error);
		expect(refused?.status).toBe(400);
		expect(refused?.response?.data?.original).toBeTruthy();
	});
});

// The instance of the user after the merge of OR-5, before its next start: rules without
// each_occurrence, tickets without occurrence and the old index (one open instance per rule). The
// new hooks keep exactly the behaviour of before; the SPA offers no switch yet.
describe('OR-5 hooks before the migration of "Jeden Termin einzeln anlegen"', () => {
	const EACH_MIGRATION = '1790202200_recurrence_each_occurrence.js';
	let before;
	let who;
	let superuser;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < EACH_MIGRATION });
		superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	async function run(iso) {
		const response = await fetch(`${before.url}/api/byl-test/recurrence/run`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ now: Date.parse(iso) })
		});
		expect(response.status).toBe(200);
		return response.json();
	}

	it('ignores the switch and keeps one open instance per rule, with catching up to the latest date', async () => {
		const rules = who.collection('recurrence_rules');
		const rule = await rules.create({
			owner: who.userId,
			title: 'Blumen',
			mode: 'calendar',
			freq: 'weekly',
			weekdays: ['MO', 'WE', 'FR'],
			anchor: '2037-06-01',
			lead_days: 0,
			each_occurrence: true
		});
		expect(rule.each_occurrence).toBeUndefined();
		// Even after completion the switch is not refused: the server does not know it yet.
		const later = await rules.create({ owner: who.userId, title: 'Später', mode: 'after_completion', freq: 'daily', each_occurrence: true });
		expect(later.each_occurrence).toBeUndefined();
		await rules.update(later.id, { active: false });

		await run('2037-06-01T10:00:00Z');
		await run('2037-06-06T10:00:00Z');
		const open = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter("recurrence = {:rule} && status != 'done'", { rule: rule.id }) });
		expect(open.map((ticket) => ticket.due.slice(0, 10))).toEqual(['2037-06-01']);
		expect(open[0].occurrence).toBeUndefined();

		// Reopening works as in E5: done, a new instance for Friday, reopening removes it again.
		await who.collection('tickets').update(open[0].id, { status: 'done' });
		await run('2037-06-06T10:00:00Z');
		const reopened = await who.collection('tickets').update(open[0].id, { status: 'open' });
		expect(reopened.status).toBe('open');
		await rules.update(rule.id, { active: false });
	});

	it('lets tickets be created and changed; occurrence is ignored', async () => {
		const tickets = who.collection('tickets');
		const ticket = await tickets.create({ owner: who.userId, title: 'Eigen', occurrence: '2037-01-01' });
		expect(ticket.occurrence).toBeUndefined();
		expect((await tickets.update(ticket.id, { title: 'Neu', occurrence: '2037-01-02' })).title).toBe('Neu');
	});

	it('lets the SPA load the rules and learn that the switch waits for the restart', async () => {
		const rules = await listRules(who);
		expect(rules?.length).toBeGreaterThan(0);
		expect(rules?.every((rule) => rule.eachOccurrence === false)).toBe(true);
		expect(await eachOccurrenceReady(who)).toBe(false);
	});
});

describe('PB-1 hooks before the migration of the trash (ADR-0037)', () => {
	const TRASH_MIGRATION = '1790202300_tickets_trash.js';
	let before;
	let who;
	let superuser;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < TRASH_MIGRATION });
		superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('deletes tickets for good through both ways as before, with the sources settled', async () => {
		const items = who.collection('inbox_items');
		const main = await items.create({ owner: who.userId, channel: 'manual', kind: 'todo', title: 'Quelle' });
		const first = await who.collection('tickets').create({ owner: who.userId, title: 'Eins', source_item: main.id });
		const child = await who.collection('tickets').create({ owner: who.userId, title: 'Kind', parent: first.id });
		await who.collection('tickets').delete(first.id);
		await expect(superuser.collection('tickets').getOne(first.id)).rejects.toMatchObject({ status: 404 });
		expect((await who.collection('tickets').getOne(child.id)).parent).toBe('');
		expect(await items.getOne(main.id)).toMatchObject({ state: 'new', ticket: '' });

		const second = await who.collection('tickets').create({ owner: who.userId, title: 'Zwei', source_item: main.id });
		const answer = await deleteTicket(who, second.id, { sources: 'discard' });
		expect(answer).toBeNull();
		await expect(superuser.collection('tickets').getOne(second.id)).rejects.toMatchObject({ status: 404 });
		expect((await items.getOne(main.id)).state).toBe('discarded');
	});

	it('duplicates a ticket with sub-tickets and comments before the migrations of the trash and the pin (ADR-0045)', async () => {
		const original = await who.collection('tickets').create({ owner: who.userId, title: 'Original' });
		await who.collection('tickets').create({ owner: who.userId, title: 'Kind', parent: original.id });
		await who.collection('comments').create({ ticket: original.id, author: who.userId, body: 'Notiz' });
		const answer = await who.send(`/api/byl/tickets/${original.id}/duplicate`, {
			method: 'POST',
			body: { title: 'Kopie', status: 'open', subtasks: true, comments: true }
		});
		expect(answer).toMatchObject({ title: 'Kopie', comments: 1, subtasks: [{ key: expect.stringMatching(/^TASK-/) }] });
		const copy = await who.collection('tickets').getOne(answer.id);
		expect(copy).toMatchObject({ title: 'Kopie', status: 'open' });
		expect(copy.pinned_comment).toBeUndefined();
	});

	it('answers the routes of the trash with the restart hint and ignores its fields', async () => {
		await expect(who.send('/api/byl/trash', { method: 'GET' })).rejects.toMatchObject({ status: 503 });
		const ticket = await who.collection('tickets').create({ owner: who.userId, title: 'Feld', deleted_at: '2037-01-01 00:00:00.000Z' });
		expect(ticket.deleted_at).toBeUndefined();
		const user = await who.collection('users').update(who.userId, { trash_retention: '7' });
		expect(user.trash_retention).toBeUndefined();
	});
});

describe('EI-1 hooks before the migration of the own inbox (ADR-0038)', () => {
	const OWN_INBOX_MIGRATION = '1790202400_inbox_keys.js';
	let before;
	let who;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < OWN_INBOX_MIGRATION });
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('answers the routes with the restart hint, lists no keys and keeps the keywords of the file imports', async () => {
		await expect(createInboxKey(who, 'Rechner')).rejects.toMatchObject({ status: 503 });
		expect(await listInboxKeys(who)).toBeNull();
		const token = `byl_${'a'.repeat(40)}`;
		const ping = await fetch(`${before.url}/api/byl/inbox/ingest`, { headers: { Authorization: `Bearer ${token}` } });
		expect(ping.status).toBe(503);
		const user = await who.collection('users').update(who.userId, {
			import_keywords: { eml: { keywords: ['todo'] }, api: { keywords: ['todo'] } }
		});
		expect(user.import_keywords).toEqual({ eml: { keywords: ['todo'] }, api: { keywords: ['todo'] } });
	});
});

// The instance of the user after the merge of plan WV, before its next start: rules without
// initial_status. The new hooks make every ticket "open" as before, a sent status is dropped by
// PocketBase (also "done", which the hook refuses only after the migration), and the SPA offers
// no "Status beim Anlegen" yet.
describe('WV hooks before the migration of "Status beim Anlegen"', () => {
	const STATUS_MIGRATION = '1790202500_recurrence_initial_status.js';
	let before;
	let who;
	let superuser;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < STATUS_MIGRATION });
		superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('ignores the status of the template and starts every ticket "open"', async () => {
		const rules = who.collection('recurrence_rules');
		const rule = await rules.create({
			owner: who.userId,
			title: 'Blumen',
			priority: 'high',
			mode: 'calendar',
			freq: 'daily',
			anchor: '2038-06-01',
			lead_days: 0,
			initial_status: 'waiting'
		});
		expect(rule.initial_status).toBeUndefined();
		const done = await rules.create({ owner: who.userId, title: 'Erledigt', mode: 'calendar', freq: 'daily', anchor: '2038-06-01', initial_status: 'done' });
		expect(done.initial_status).toBeUndefined();
		await rules.update(done.id, { active: false });

		const response = await fetch(`${before.url}/api/byl-test/recurrence/run`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ now: Date.parse('2038-06-01T10:00:00Z') })
		});
		expect(response.status).toBe(200);
		const tickets = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('recurrence = {:rule}', { rule: rule.id }) });
		expect(tickets.map(({ status, priority }) => ({ status, priority }))).toEqual([{ status: 'open', priority: 'high' }]);
		await rules.update(rule.id, { active: false });
	});

	it('asks for no status before the migration (ADR-0022 addendum 9)', async () => {
		// Without the field there is nothing to choose: a rule without "Status beim Anlegen" is created.
		const rules = who.collection('recurrence_rules');
		const rule = await rules.create({ owner: who.userId, title: 'Ohne Wahl', mode: 'calendar', freq: 'daily', anchor: '2038-07-01' });
		expect(rule.initial_status).toBeUndefined();
		await rules.update(rule.id, { active: false });
	});

	it('lets the SPA load the rules as "open" and learn that the field waits for the restart', async () => {
		const rules = await listRules(who);
		expect(rules?.length).toBeGreaterThan(0);
		expect(rules?.every((rule) => rule.initialStatus === 'open')).toBe(true);
		expect(await initialStatusReady(who)).toBe(false);
		expect(await eachOccurrenceReady(who)).toBe(true);
	});
});

// The instance of the user after the merge of WV-3, before its next start: rules without
// template_subtasks. The new hooks give no ticket sub-tasks, a sent list is dropped by PocketBase
// (also one the hook would refuse after the migration), reopening works as before, and the SPA
// offers no list yet.
describe('WV-3 hooks before the migration of the sub-tasks of the template', () => {
	const SUBTASKS_MIGRATION = '1790202700_recurrence_template_subtasks.js';
	let before;
	let who;
	let superuser;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < SUBTASKS_MIGRATION });
		superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
		who.userId = id;
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('drops a sent list and makes tickets without sub-tasks; reopening removes the follow-up as before', async () => {
		const rules = who.collection('recurrence_rules');
		const rule = await rules.create({
			owner: who.userId,
			title: 'Kaffeemaschine',
			mode: 'calendar',
			freq: 'daily',
			anchor: '2038-06-01',
			lead_days: 0,
			initial_status: 'open',
			template_subtasks: [{ title: 'Entkalken' }, { title: '' }]
		});
		expect(rule.template_subtasks).toBeUndefined();

		const response = await fetch(`${before.url}/api/byl-test/recurrence/run`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ now: Date.parse('2038-06-01T10:00:00Z') })
		});
		expect(response.status).toBe(200);
		const [ticket] = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('recurrence = {:rule}', { rule: rule.id }) });
		const children = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('parent = {:id}', { id: ticket.id }) });
		expect(children).toEqual([]);
		const history = await superuser
			.collection('ticket_history')
			.getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticket.id }) });
		expect(history.map((entry) => entry.field)).toEqual(['created']);

		// Done, the next run makes the follow-up, reopened: the untouched follow-up goes as before.
		await who.collection('tickets').update(ticket.id, { status: 'done' });
		const next = await fetch(`${before.url}/api/byl-test/recurrence/run`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ now: Date.parse('2038-06-02T10:00:00Z') })
		});
		expect((await next.json()).tickets).toBe(1);
		const openOf = () =>
			superuser
				.collection('tickets')
				.getFullList({ filter: superuser.filter("recurrence = {:rule} && status != 'done'", { rule: rule.id }) });
		expect((await openOf()).map((entry) => entry.id)).not.toContain(ticket.id);
		await who.collection('tickets').update(ticket.id, { status: 'open' });
		expect((await openOf()).map((entry) => entry.id)).toEqual([ticket.id]);
		await rules.update(rule.id, { active: false });
	});

	it('lets the SPA load the rules without sub-tasks and learn that the list waits for the restart', async () => {
		const rules = await listRules(who);
		expect(rules?.length).toBeGreaterThan(0);
		expect(rules?.every((rule) => rule.templateSubtasks?.length === 0)).toBe(true);
		expect(await templateSubtasksReady(who)).toBe(false);
		expect(await initialStatusReady(who)).toBe(true);
	});
});

// The instance of the user after the merge of KO-1 (ADR-0044), before its next start: tickets
// without pinned_comment. The new hooks read the field as empty, so tickets and comments work as
// before; the SPA sees no field and offers no pinning yet.
describe('KO-1 hooks before the migration of the pinned comment (ADR-0044)', () => {
	const PIN_MIGRATION = '1790202600_tickets_pinned_comment.js';
	let before;
	let who;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < PIN_MIGRATION });
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		await superuser.collection('users').create({ email, password, passwordConfirm: password });
		who = new PocketBase(before.url);
		who.autoCancellation(false);
		await who.collection('users').authWithPassword(email, password);
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('creates, changes and comments tickets as before; a sent pin is dropped', async () => {
		const draft = { title: 'Vor dem Neustart', description: '', status: 'open', priority: 'medium', due: null };
		const ticket = await createTicket(who, draft);
		// Without the field on the server the SPA knows no pin and offers none.
		expect(ticket).not.toHaveProperty('pinnedComment');
		const comment = await createComment(who, ticket.id, 'Wichtig');

		const changed = await updateTicket(who, ticket.id, { title: 'Geändert', pinnedComment: comment.id });
		expect(changed.title).toBe('Geändert');
		expect(changed).not.toHaveProperty('pinnedComment');

		// Deleting a comment releases nothing: there is no pin to release.
		await deleteComment(who, comment.id);
		expect((await getTicket(who, ticket.id)).title).toBe('Geändert');
		await deleteTicket(who, ticket.id);
	});
});

// The instance of the user after the merge of E7-1, before its next start: users without the right
// and the switch, the old read rules. The new hooks keep the rule of ADR-0043 §3 (the account
// created first is the administrator), the page "Konten" waits for the restart, and the SPA keeps
// listing the pages of the administrator (the server decides).
describe('E7-1 hooks before the migration of the accounts (ADR-0056)', () => {
	const ACCOUNTS_MIGRATION = '1790203700_accounts_admin.js';
	let before;
	const accounts = [];

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < ACCOUNTS_MIGRATION });
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		for (let i = 0; i < 2; i++) {
			const email = `user-${randomBytes(12).toString('hex')}@example.com`;
			const password = randomBytes(24).toString('base64url');
			const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
			const pb = new PocketBase(before.url);
			pb.autoCancellation(false);
			await pb.collection('users').authWithPassword(email, password);
			accounts.push({ id, pb });
		}
	});

	afterAll(async () => {
		await before?.stop();
	});

	/** A request of the app with the Origin of its address. */
	async function asApp(who, method, path, body) {
		const response = await fetch(`${before.url}${path}`, {
			method,
			headers: {
				Authorization: who.pb.authStore.token,
				Origin: new URL(before.url).origin,
				...(body ? { 'Content-Type': 'application/json' } : {})
			},
			body: body ? JSON.stringify(body) : undefined
		});
		return { status: response.status, body: await response.json() };
	}

	it('keeps the account created first as the administrator of the routes', async () => {
		const [first, second] = accounts;
		expect((await asApp(first, 'GET', '/api/byl/storage')).body.reason).not.toBe('owner');
		expect(await asApp(second, 'GET', '/api/byl/storage')).toMatchObject({ status: 403, body: { reason: 'owner' } });
		expect(first.pb.authStore.record).not.toHaveProperty('instance_admin');
		expect(adminOf(first.pb.authStore.record)).toBe(true);
	});

	it('answers the page "Konten" with the restart hint and leaves the record as it was', async () => {
		const [first, second] = accounts;
		expect(await fetchAccounts(first.pb)).toEqual({ kind: 'denied', reason: 'missing' });
		const disable = await asApp(first, 'POST', `/api/byl/accounts/${second.id}/disabled`, { disabled: true });
		expect(disable.body.reason).toBe('missing');
		expect((await second.pb.collection('users').update(second.id, { name: 'Zweites Konto' })).name).toBe('Zweites Konto');
		expect(await second.pb.collection('users').getFullList()).toHaveLength(1);
	});

	it('lets only the account created first set up a channel with access data', async () => {
		const [first, second] = accounts;
		const calendar = { type: 'calendar', label: 'Kalender', enabled: true, secret_env: 'BYL_TEST_CALENDAR' };
		const refused = await second.pb
			.collection('connections')
			.create({ ...calendar, owner: second.id })
			.catch((error) => error);
		expect(refused.response?.data?.type?.code).toBe('validation_connection_admin_only');
		expect((await first.pb.collection('connections').create({ ...calendar, owner: first.id })).type).toBe('calendar');
	});
});

describe('E7-2 hooks before the migrations of managing a household (ADR-0058)', () => {
	const HOUSEHOLD_MIGRATION = '1790203800_household_invites.js';
	let before;
	let pb;
	let userId;

	beforeAll(async () => {
		before = await startPocketBase({ migrationFilter: (name) => name < HOUSEHOLD_MIGRATION });
		const superuser = new PocketBase(before.url);
		superuser.autoCancellation(false);
		await superuser.collection('_superusers').authWithPassword(before.email, before.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		userId = (await superuser.collection('users').create({ email, password, passwordConfirm: password })).id;
		pb = new PocketBase(before.url);
		pb.autoCancellation(false);
		await pb.collection('users').authWithPassword(email, password);
	});

	afterAll(async () => {
		await before?.stop();
	});

	it('answers the page "Haushalt" with the restart hint and founds nothing', async () => {
		expect(await fetchHousehold(pb)).toEqual({ kind: 'missing' });
		expect(await foundHousehold(pb, 'Haus')).toEqual({ kind: 'missing' });
		const response = await fetch(`${before.url}/api/byl/household/join`, {
			method: 'POST',
			headers: { Authorization: pb.authStore.token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: 'ABCD-EFGH' })
		});
		expect(response.status).toBe(503);
		expect((await response.json()).reason).toBe('missing');
		expect(await pb.collection('households').getFullList()).toEqual([]);
		// The rules of before still hold: a private ticket of the account is its own.
		const ticket = await pb.collection('tickets').create({ owner: userId, title: 'Vor dem Neustart' });
		expect((await pb.collection('tickets').getOne(ticket.id)).id).toBe(ticket.id);
	});
});
