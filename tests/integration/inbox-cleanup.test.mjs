// Cleaning discarded inbox items after 30 days (OF-E4-6, E4 plan package 24) against a disposable
// PocketBase. The date of discarding is moved back directly in data.db of the instance, because
// the record hook sets handled_at itself and keeps it on every save. The cron job runs through
// POST /api/crons/byl-inbox-cleanup.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { loadHookLib } from '../support/hook-lib.mjs';
import { allLogEntries } from '../support/logs.mjs';
import { LOG_WRITE_MS, scaled } from '../support/timing.mjs';

const cleanup = loadHookLib('inbox-cleanup.js');
const TOKEN = randomBytes(24).toString('base64');
const DAY_MS = 24 * 60 * 60 * 1000;

let instance;
let superuser;
let owner;
let other;
let mailbox;

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function user() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return { id: record.id, pb };
}

const unique = () => randomBytes(6).toString('hex');

/** PocketBase date text `days` days before now. */
function daysAgo(days) {
	return new Date(Date.now() - days * DAY_MS).toISOString().replace('T', ' ');
}

/** Writes columns of inbox_items directly, as if the item had been discarded earlier. */
function writeRow(id, values) {
	const db = new DatabaseSync(join(instance.dataDir, 'data.db'), { timeout: scaled(10_000) });
	try {
		const columns = Object.keys(values);
		db.prepare(`UPDATE inbox_items SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`).run(
			...columns.map((column) => values[column]),
			id
		);
	} finally {
		db.close();
	}
}

async function discard(who, item, days) {
	await who.pb.collection('inbox_items').update(item.id, { state: 'discarded' });
	writeRow(item.id, { handled_at: daysAgo(days) });
}

async function runCleanup() {
	const response = await fetch(`${instance.url}/api/crons/byl-inbox-cleanup`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token }
	});
	expect(response.status).toBe(204);
}

/** A mail from the mailbox through the ingest route of the mail helper, with its original. */
async function mailFromMailbox(title, messageId) {
	const form = new FormData();
	form.set(
		'draft',
		JSON.stringify({
			connection: mailbox.id,
			origin: 'selected',
			title,
			body: 'Vertraulicher Text der Mail.',
			source_ref: messageId,
			source_date: '2026-08-01 08:00:00.000Z',
			source_meta: { from: 'Bert <bert@example.com>', to: 'anna@example.com', attachments: 1 }
		})
	);
	form.set('original', new Blob([`Subject: ${title}\r\nMessage-ID: ${messageId}\r\n\r\nText\r\n`]), 'mail.eml');
	const response = await fetch(`${instance.url}/api/byl/ingest/items`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${TOKEN}` },
		body: form
	});
	const answer = await response.json();
	expect(answer.status).toBe('created');
	return owner.pb.collection('inbox_items').getOne(answer.item);
}

function storagePath(item) {
	return join(instance.dataDir, 'storage', item.collectionId, item.id, item.original);
}

beforeAll(async () => {
	instance = await startPocketBase({ env: { BYL_INGEST_TOKEN: TOKEN, BYL_TEST_MAIL_PASSWORD: 'geheim-1234' } });
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await user();
	other = await user();
	mailbox = await owner.pb.collection('connections').create({
		owner: owner.id,
		type: 'mail',
		label: 'Web.de',
		enabled: true,
		secret_env: 'BYL_TEST_MAIL_PASSWORD',
		settings: { provider: 'webde', user: 'anna@example.com', keywords: ['todo'] }
	});
});

afterAll(async () => {
	await instance?.stop();
});

describe('cleanup of discarded items after 30 days (OF-E4-6)', () => {
	it('keeps a tombstone of old discarded items of every channel and scope and leaves the rest alone', async () => {
		const messageId = `<${unique()}@example.com>`;
		const mail = await mailFromMailbox('Rechnung Handwerker für die Renovierung im Erdgeschoss', messageId);
		expect(existsSync(storagePath(mail))).toBe(true);
		await discard(owner, mail, 31);

		const event = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'ics',
			kind: 'event',
			title: 'Zahnarzt',
			body: 'Praxis Dr. Beispiel',
			source_ref: `${unique()}@google.com`,
			source_date: '2026-08-02 07:00:00.000Z',
			source_meta: { location: 'Hauptstraße 1', recurrence_id: '20260802', all_day: false, keyword: 'arzt' }
		});
		await discard(owner, event, 45);

		const foreign = await other.pb.collection('inbox_items').create({
			owner: other.id,
			channel: 'telegram',
			kind: 'message',
			title: 'Nachricht von Bert',
			body: 'Privater Text',
			source_ref: `4242:${unique()}`,
			source_meta: { chat: 'Bert', sender: 'Bert' }
		});
		await discard(other, foreign, 100);

		const recent = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'link',
			kind: 'link',
			title: 'Artikel',
			body: 'Auszug',
			source_url: `https://example.com/${unique()}`
		});
		await discard(owner, recent, 29);

		const fresh = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'manual',
			kind: 'todo',
			title: 'Noch neu',
			body: 'Text bleibt'
		});
		writeRow(fresh.id, { created: daysAgo(60) });

		const converted = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'clipboard',
			kind: 'todo',
			title: 'Umgewandelt',
			body: 'Text des Tickets'
		});
		await owner.pb.collection('tickets').create({ owner: owner.id, title: 'Umgewandelt', source_item: converted.id });
		writeRow(converted.id, { handled_at: daysAgo(90) });

		const before = await owner.pb.collection('inbox_items').getOne(mail.id);
		await runCleanup();
		await expect
			.poll(async () => (await owner.pb.collection('inbox_items').getOne(mail.id)).body, { timeout: scaled(10_000) })
			.toBe(cleanup.PURGED_BODY);

		const cleanedMail = await owner.pb.collection('inbox_items').getOne(mail.id);
		expect(cleanedMail).toMatchObject({
			state: 'discarded',
			channel: 'mail',
			kind: 'mail',
			title: 'Rechnung Handwerker für die Renovierung…',
			body: cleanup.PURGED_BODY,
			original: '',
			source_ref: messageId,
			source_date: '2026-08-01 08:00:00.000Z',
			connection: mailbox.id,
			fingerprint: before.fingerprint,
			handled_at: before.handled_at
		});
		expect(cleanedMail.source_meta).toEqual({});
		expect(existsSync(storagePath(mail))).toBe(false);

		expect(await owner.pb.collection('inbox_items').getOne(event.id)).toMatchObject({
			title: 'Zahnarzt',
			body: cleanup.PURGED_BODY,
			source_meta: { recurrence_id: '20260802', all_day: false, keyword: 'arzt' },
			state: 'discarded'
		});
		expect(await other.pb.collection('inbox_items').getOne(foreign.id)).toMatchObject({
			body: cleanup.PURGED_BODY,
			source_meta: {},
			state: 'discarded'
		});
		expect(await owner.pb.collection('inbox_items').getOne(recent.id)).toMatchObject({ title: 'Artikel', body: 'Auszug' });
		expect(await owner.pb.collection('inbox_items').getOne(fresh.id)).toMatchObject({ state: 'new', body: 'Text bleibt' });
		expect(await owner.pb.collection('inbox_items').getOne(converted.id)).toMatchObject({
			state: 'converted',
			body: 'Text des Tickets'
		});
	});

	it('keeps the tombstone: the mailbox selection and a second file bring nothing back', async () => {
		const messageId = `<${unique()}@example.com>`;
		const mail = await mailFromMailbox('Todo: verworfen', messageId);
		await discard(owner, mail, 40);
		await runCleanup();
		await expect
			.poll(async () => (await owner.pb.collection('inbox_items').getOne(mail.id)).body, { timeout: scaled(10_000) })
			.toBe(cleanup.PURGED_BODY);

		const form = new FormData();
		form.set(
			'draft',
			JSON.stringify({ connection: mailbox.id, origin: 'selected', title: 'Todo: verworfen', body: 'x', source_ref: messageId })
		);
		const again = await fetch(`${instance.url}/api/byl/ingest/items`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${TOKEN}` },
			body: form
		});
		expect(await again.json()).toMatchObject({ status: 'duplicate', item: mail.id, state: 'discarded' });

		const lookup = await owner.pb.send('/api/byl/inbox/lookup', {
			method: 'POST',
			body: { items: [{ channel: 'eml', kind: 'mail', title: 'Todo: verworfen', source_ref: messageId }] }
		});
		expect(lookup.items).toEqual([{ state: 'discarded', message: 'Schon verworfen.' }]);
		await expect(
			owner.pb.collection('inbox_items').create({
				owner: owner.id,
				channel: 'eml',
				kind: 'mail',
				title: 'Todo: verworfen',
				source_ref: messageId
			})
		).rejects.toMatchObject({ status: 400 });

		// Restoring still works; the item then has the placeholder text.
		const restored = await owner.pb.collection('inbox_items').update(mail.id, { state: 'new' });
		expect(restored).toMatchObject({ state: 'new', handled_at: '', body: cleanup.PURGED_BODY });
	});

	it('is idempotent and does not let one failing item stop the others', async () => {
		const broken = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'manual',
			kind: 'todo',
			title: 'Kaputt',
			body: 'Text'
		});
		const good = await owner.pb.collection('inbox_items').create({
			owner: owner.id,
			channel: 'manual',
			kind: 'todo',
			title: 'Heil',
			body: 'Text'
		});
		await discard(owner, broken, 50);
		await discard(owner, good, 50);
		// A value the select field refuses, so saving this item fails.
		writeRow(broken.id, { kind: 'unbekannt' });

		await runCleanup();
		await expect
			.poll(async () => (await owner.pb.collection('inbox_items').getOne(good.id)).body, { timeout: scaled(10_000) })
			.toBe(cleanup.PURGED_BODY);
		expect((await superuser.collection('inbox_items').getOne(broken.id)).body).toBe('Text');
		// PocketBase writes its log in batches; all entries, not only the oldest page.
		const skipped = superuser.filter('message ~ {:text}', { text: 'verworfenen Eintrag nicht bereinigt' });
		await expect.poll(async () => (await allLogEntries(superuser, skipped)).length, { timeout: LOG_WRITE_MS }).toBeGreaterThan(0);

		const cleaned = await owner.pb.collection('inbox_items').getOne(good.id);
		await runCleanup();
		await runCleanup();
		// The job runs in the background; give it the time of a run before comparing.
		await new Promise((resolve) => setTimeout(resolve, 1_000));
		expect((await owner.pb.collection('inbox_items').getOne(good.id)).updated).toBe(cleaned.updated);
	});
});
