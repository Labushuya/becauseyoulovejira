// The running instance loads new hooks at once, but runs new migrations only at its next start
// (E4 plan, package 1). The hooks of E4 must therefore work on the schema before the E4
// migrations: tickets without source/source_item and no inbox_items collection.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { listRules } from '../../web/src/lib/data/recurrence.ts';
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
}, 60_000);

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
			'Der Eingang steht nach dem nächsten Start der App bereit (start.bat).'
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
			'Die Verbindungen stehen nach dem nächsten Start der App bereit (start.bat).'
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
		const logs = JSON.stringify(await superuser.send('/api/logs', { query: { perPage: 200 } }));
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
		const logs = JSON.stringify(await superuser.send('/api/logs', { query: { perPage: 200 } }));
		expect(logs).not.toMatch(/byl-inbox-cleanup|verworfen/);
	});

	it('answers the ingest routes of the mail helper with the hint (package 22)', async () => {
		const headers = { Authorization: `Bearer ${INGEST_TOKEN}`, 'Content-Type': 'application/json' };
		const list = await fetch(`${instance.url}/api/byl/ingest/connections`, { headers });
		expect(list.status).toBe(503);
		expect((await list.json()).message).toMatch(/nach dem nächsten Start/);
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
	}, 60_000);

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
	}, 60_000);

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
	}, 60_000);

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
		await items.delete(item.id);
		await expect(items.getOne(item.id)).rejects.toMatchObject({ status: 404 });
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
	}, 60_000);

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
	}, 60_000);

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
