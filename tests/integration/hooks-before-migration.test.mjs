// The running instance loads new hooks at once, but runs new migrations only at its next start
// (E4 plan, package 1). The hooks of E4 must therefore work on the schema before the E4
// migrations: tickets without source/source_item and no inbox_items collection.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { unreadSinceOf } from '../../web/src/lib/domain/unread.ts';

// First migration of E4; the instance runs only the migrations before it.
const E4_FIRST_MIGRATION = '1790201200_create_inbox_items.js';

let instance;
let client;
let userId;

function newClient() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

beforeAll(async () => {
	instance = await startPocketBase({ migrationFilter: (name) => name < E4_FIRST_MIGRATION });
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
});
