// Own inbox with access keys (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1) against the
// shared disposable instance: keys are shown once and stored as hash only, belong to one user,
// create only inbox entries of that user, follow the keywords of their channel for "auto", find
// duplicates and tombstones, refuse web pages, count requests per key and stop with the revoke.

import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAppUser, pocketBaseUrl, superuserClient, userClient } from '../support/api.mjs';
import { createInboxKey, listInboxKeys, revokeInboxKey } from '../../web/src/lib/data/inbox-keys.ts';

const EXTENSION = `chrome-extension://${'abcdefghijklmnop'.repeat(2)}`;

let superuser;
let owner;
let ownerPb;
let other;
let otherPb;

async function call(path, { method = 'GET', token, json, origin, raw } = {}) {
	const headers = {};
	if (token !== undefined) headers.Authorization = `Bearer ${token}`;
	if (origin !== undefined) headers.Origin = origin;
	let body;
	if (json !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify(json);
	} else if (raw !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = raw;
	}
	const response = await fetch(`${pocketBaseUrl()}${path}`, { method, headers, body });
	const text = await response.text();
	let parsed;
	try {
		parsed = text === '' ? null : JSON.parse(text);
	} catch {
		throw new Error(`${response.status} ${text}`);
	}
	return { status: response.status, headers: response.headers, text, json: parsed };
}

const ingest = (token, json, options = {}) => call('/api/byl/inbox/ingest', { method: 'POST', token, json, ...options });
const unique = () => randomBytes(6).toString('hex');

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createAppUser(superuser);
	other = await createAppUser(superuser);
	ownerPb = await userClient(owner);
	otherPb = await userClient(other);
	await ownerPb.collection('users').update(owner.record.id, {
		import_keywords: { api: { keywords: ['todo'] }, 'whatsapp-web': { keywords: ['#byl', 'Einkauf'] } }
	});
});

describe('keys', () => {
	it('shows a new key once and stores only its hash', async () => {
		const created = await createInboxKey(ownerPb, '  Mein   Rechner ');
		expect(created.name).toBe('Mein Rechner');
		expect(created.token).toMatch(/^byl_[A-Za-z0-9]{40}$/);
		expect(created.tokenHint).toBe(created.token.slice(0, 8));
		expect(created.lastUsedAt).toBeNull();

		const listed = await listInboxKeys(ownerPb);
		expect(listed.find((key) => key.id === created.id)).toEqual({
			id: created.id,
			name: 'Mein Rechner',
			tokenHint: created.tokenHint,
			created: created.created,
			lastUsedAt: null
		});
		const raw = await ownerPb.collection('inbox_keys').getOne(created.id);
		expect(JSON.stringify(raw)).not.toContain(created.token);
		expect(raw.token_hash).toBeUndefined();
		const stored = await superuser.collection('inbox_keys').getOne(created.id);
		expect(stored.token_hash).toBe(createHash('sha256').update(created.token).digest('hex'));
	});

	it('keeps keys to their owner and refuses creating or changing them through the Record API', async () => {
		const created = await createInboxKey(ownerPb, 'Privat');
		expect((await listInboxKeys(otherPb)).map((key) => key.id)).not.toContain(created.id);
		await expect(otherPb.collection('inbox_keys').getOne(created.id)).rejects.toMatchObject({ status: 404 });
		await expect(revokeInboxKey(otherPb, created.id)).rejects.toMatchObject({ kind: 'not_found' });
		await expect(
			ownerPb.collection('inbox_keys').create({ owner: owner.record.id, name: 'x', token_hash: 'a'.repeat(64), token_hint: 'byl_x' })
		).rejects.toMatchObject({ status: 403 });
		await expect(ownerPb.collection('inbox_keys').update(created.id, { name: 'y' })).rejects.toMatchObject({ status: 403 });
		// The hidden hash cannot even be filtered on.
		await expect(ownerPb.collection('inbox_keys').getFullList({ filter: `token_hash != ""` })).rejects.toMatchObject({ status: 400 });
	});

	it('needs a signed-in app user and a valid name', async () => {
		expect((await call('/api/byl/inbox/keys', { method: 'POST', json: { name: 'x' } })).status).toBe(401);
		await expect(createInboxKey(ownerPb, '   ')).rejects.toMatchObject({
			kind: 'validation',
			fields: { name: { code: 'validation_inbox_key_name', message: 'Bitte einen Namen mit 1 bis 60 Zeichen eingeben.' } }
		});
		await expect(createInboxKey(ownerPb, 'x'.repeat(61))).rejects.toMatchObject({ kind: 'validation' });
	});

	it('allows at most 20 keys per user', async () => {
		const user = await createAppUser(superuser);
		const pb = await userClient(user);
		for (let i = 0; i < 20; i++) await createInboxKey(pb, `Schlüssel ${i}`);
		await expect(createInboxKey(pb, 'Einer zu viel')).rejects.toMatchObject({
			fields: { name: { code: 'validation_inbox_key_limit' } }
		});
	});
});

describe('ingest', () => {
	let token;
	let keyId;

	beforeAll(async () => {
		const created = await createInboxKey(ownerPb, 'Erweiterung');
		token = created.token;
		keyId = created.id;
	});

	it('refuses a missing, malformed, unknown or foreign-scheme key without saying more', async () => {
		for (const value of [undefined, '', 'byl_kurz', `byl_${'a'.repeat(40)}`, token.toLowerCase(), `${token}x`]) {
			const answer = await ingest(value, { mode: 'manual', text: 'x', external_id: unique() });
			expect(answer.status, String(value)).toBe(401);
			expect(answer.text).not.toContain(token);
		}
		const basic = await fetch(`${pocketBaseUrl()}/api/byl/inbox/ingest`, { headers: { Authorization: `Basic ${token}` } });
		expect(basic.status).toBe(401);
	});

	it('answers "Verbindung testen" with the name of the key and the number of keywords', async () => {
		const answer = await call('/api/byl/inbox/ingest', { token });
		expect(answer.status).toBe(200);
		expect(answer.json).toEqual({ status: 'ok', name: 'Erweiterung', keywords: { api: 1, 'whatsapp-web': 2 } });
		const [listed] = (await listInboxKeys(ownerPb)).filter((key) => key.id === keyId);
		expect(listed.lastUsedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	});

	it('creates a private entry of the owner of the key, always for "manual"', async () => {
		const id = `wa:${unique()}`;
		const answer = await ingest(
			token,
			{
				channel: 'whatsapp-web',
				mode: 'manual',
				text: 'Bitte Milch kaufen\nund Brot',
				sender: 'Anna Beispiel',
				chat: 'Familie',
				sent_at: '2026-09-28T14:30:00+02:00',
				external_id: id
			},
			{ origin: EXTENSION }
		);
		expect(answer.status).toBe(201);
		expect(answer.json).toEqual({ status: 'created', item: expect.stringMatching(/^[a-z0-9]{15}$/) });
		const item = await ownerPb.collection('inbox_items').getOne(answer.json.item);
		expect(item).toMatchObject({
			channel: 'whatsapp-web',
			kind: 'message',
			title: 'Bitte Milch kaufen',
			body: 'Bitte Milch kaufen\nund Brot',
			source_ref: id,
			source_date: '2026-09-28 12:30:00.000Z',
			source_meta: { sender: 'Anna Beispiel', chat: 'Familie' },
			state: 'new',
			owner: owner.record.id,
			household: '',
			scope: `u:${owner.record.id}`
		});
		await expect(otherPb.collection('inbox_items').getOne(answer.json.item)).rejects.toMatchObject({ status: 404 });
	});

	it('takes "auto" only with a keyword of its channel and keeps the keyword', async () => {
		const filtered = await ingest(token, { channel: 'whatsapp-web', mode: 'auto', text: 'todo: Milch', external_id: unique() });
		expect(filtered.status).toBe(422);
		expect(filtered.json).toEqual({ status: 'filtered', message: 'Kein Stichwort erkannt – nicht gespeichert.' });

		const matched = await ingest(token, { channel: 'whatsapp-web', mode: 'auto', text: 'EINKAUF am Samstag', external_id: unique() });
		expect(matched.status).toBe(201);
		const item = await ownerPb.collection('inbox_items').getOne(matched.json.item);
		expect(item.source_meta).toEqual({ keyword: 'Einkauf' });

		const api = await ingest(token, { mode: 'auto', title: 'todo Steuer', text: 'Unterlagen', url: 'https://example.com/a', external_id: unique() });
		expect(api.status).toBe(201);
		expect(await ownerPb.collection('inbox_items').getOne(api.json.item)).toMatchObject({
			channel: 'api',
			kind: 'todo',
			title: 'todo Steuer',
			source_url: 'https://example.com/a'
		});
	});

	it('reports a duplicate, and a discarded entry does not come back', async () => {
		const id = unique();
		const first = await ingest(token, { mode: 'manual', text: 'Einmal', external_id: id });
		expect(first.status).toBe(201);
		const again = await ingest(token, { mode: 'manual', text: 'Anderer Text', external_id: id });
		expect(again.status).toBe(200);
		expect(again.json).toEqual({ status: 'duplicate', item: first.json.item, state: 'new' });

		await ownerPb.collection('inbox_items').update(first.json.item, { state: 'discarded' });
		const tombstone = await ingest(token, { mode: 'auto', text: 'todo Einmal', external_id: id });
		expect(tombstone.json).toEqual({ status: 'duplicate', item: first.json.item, state: 'discarded' });
		// The same ID in the other channel is another entry.
		expect((await ingest(token, { channel: 'whatsapp-web', mode: 'manual', text: 'x', external_id: id })).status).toBe(201);
	});

	it('refuses invalid payloads with a German message and saves nothing', async () => {
		const before = (await ownerPb.collection('inbox_items').getFullList()).length;
		for (const [json, message] of [
			[{ mode: 'manual', text: '', external_id: 'x' }, /text fehlt/],
			[{ mode: 'sofort', text: 'x', external_id: 'x' }, /mode muss/],
			[{ channel: 'mail', mode: 'manual', text: 'x', external_id: 'x' }, /channel muss/],
			[{ mode: 'manual', text: 'x' }, /external_id fehlt/],
			[{ mode: 'manual', text: 'x', external_id: 'x', url: 'javascript:alert(1)' }, /url muss/],
			[{ mode: 'manual', text: 'x', external_id: 'x', sent_at: 'gestern' }, /sent_at muss/]
		]) {
			const answer = await ingest(token, json);
			expect(answer.status, JSON.stringify(json)).toBe(400);
			expect(answer.json.status).toBe('invalid');
			expect(answer.json.message).toMatch(message);
		}
		expect((await call('/api/byl/inbox/ingest', { method: 'POST', token, raw: '{kein json' })).status).toBe(400);
		expect((await ownerPb.collection('inbox_items').getFullList()).length).toBe(before);
	});

	it('refuses requests of web pages and lets the extension through the preflight', async () => {
		for (const origin of ['https://web.whatsapp.com', 'null', 'http://127.0.0.1:8090']) {
			const answer = await ingest(token, { mode: 'manual', text: 'x', external_id: unique() }, { origin });
			expect(answer.status, origin).toBe(403);
		}
		const preflight = await fetch(`${pocketBaseUrl()}/api/byl/inbox/ingest`, {
			method: 'OPTIONS',
			headers: {
				Origin: EXTENSION,
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'authorization,content-type'
			}
		});
		expect(preflight.status).toBeLessThan(300);
		expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
	});

	it('limits the requests per key and minute', async () => {
		const own = await createInboxKey(ownerPb, 'Viele Anfragen');
		const answers = await Promise.all(Array.from({ length: 61 }, () => call('/api/byl/inbox/ingest', { token: own.token })));
		const statuses = answers.map((answer) => answer.status);
		expect(statuses.filter((status) => status === 200)).toHaveLength(60);
		const refused = answers.find((answer) => answer.status === 429);
		expect(refused.json).toEqual({ status: 'rate_limited', message: expect.stringContaining('Zu viele Anfragen') });
		expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
		// Other keys are not affected.
		expect((await call('/api/byl/inbox/ingest', { token })).status).toBe(200);
	});

	it('stops working once the key is revoked', async () => {
		const own = await createInboxKey(ownerPb, 'Wird widerrufen');
		expect((await call('/api/byl/inbox/ingest', { token: own.token })).status).toBe(200);
		await revokeInboxKey(ownerPb, own.id);
		expect((await call('/api/byl/inbox/ingest', { token: own.token })).status).toBe(401);
		expect((await ingest(own.token, { mode: 'manual', text: 'x', external_id: unique() })).status).toBe(401);
		expect((await listInboxKeys(ownerPb)).map((key) => key.id)).not.toContain(own.id);
	});
});
