// Connections of the channels (ADR-0016 section 2, ADR-0018; E4 plan package 10) against an own
// disposable instance whose process environment holds invented access data. No response and no
// realtime event may contain a value; only the names of the variables are stored.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import {
	createConnection,
	deleteConnection,
	getSecretStatus,
	listConnections,
	saveConnectionSettings,
	setConnectionEnabled
} from '../../web/src/lib/data/connections.ts';

const CALENDAR_VALUE = `http://127.0.0.1:9/private-${randomBytes(12).toString('hex')}/basic.ics`;
const TOKEN_VALUE = `123456789:AA${randomBytes(18).toString('hex')}`;
const ALLOWED_VALUE = '424242, -100123';
const ENV = {
	BYL_TEST_CALENDAR: CALENDAR_VALUE,
	BYL_TEST_TOKEN: TOKEN_VALUE,
	BYL_TEST_ALLOWED: ALLOWED_VALUE
};
const VALUES = Object.values(ENV);

let instance;
let superuser;
let owner;
let other;

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

function calendar(who, data = {}) {
	return who.pb.collection('connections').create({
		owner: who.id,
		type: 'calendar',
		label: 'Google Kalender',
		enabled: true,
		secret_env: 'BYL_TEST_CALENDAR',
		...data
	});
}

function telegram(who, data = {}) {
	return who.pb.collection('connections').create({
		owner: who.id,
		type: 'telegram',
		label: 'Telegram-Bot',
		enabled: true,
		secret_env: 'BYL_TEST_TOKEN',
		settings: { allowed_env: 'BYL_TEST_ALLOWED' },
		...data
	});
}

async function codesOf(promise) {
	try {
		await promise;
	} catch (error) {
		const data = error.response?.data ?? {};
		return { status: error.status, codes: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.code])) };
	}
	throw new Error('Expected a rejection.');
}

async function status(who, id) {
	const response = await fetch(`${instance.url}/api/byl/connections/${id}/secret-status`, {
		headers: who ? { Authorization: who.pb.authStore.token } : {}
	});
	const body = await response.text();
	return { status: response.status, text: body, json: response.ok ? JSON.parse(body) : null };
}

function expectNoValues(text) {
	for (const value of VALUES) expect(text).not.toContain(value);
	expect(text).not.toContain('private-');
}

beforeAll(async () => {
	instance = await startPocketBase({ env: ENV });
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await user();
	other = await user();
}, 60_000);

afterAll(async () => {
	await instance?.stop();
});

describe('connections: create and guard', () => {
	it('creates a calendar connection with scope and empty server fields', async () => {
		const record = await calendar(owner);
		expect(record).toMatchObject({
			type: 'calendar',
			secret_env: 'BYL_TEST_CALENDAR',
			scope: `u:${owner.id}`,
			cursor: '',
			last_error: '',
			running_since: ''
		});
		expectNoValues(JSON.stringify(record));
	});

	it('refuses invalid variable names such as PATH or lower case', async () => {
		for (const name of ['PATH', 'byl_x', 'BYL_', 'BYL_A B']) {
			const rejected = await codesOf(calendar(owner, { secret_env: name }));
			expect(rejected.status, name).toBe(400);
			expect(rejected.codes.secret_env, name).toBeTruthy();
		}
		const allowlist = await codesOf(telegram(owner, { settings: { allowed_env: 'PATH' } }));
		expect(allowlist.codes).toEqual({ settings: 'validation_secret_name' });
		const missing = await codesOf(telegram(owner, { settings: {} }));
		expect(missing.codes).toEqual({ settings: 'validation_secret_name' });
	});

	it('refuses server fields, unknown settings and kinds that do not exist', async () => {
		expect((await codesOf(calendar(owner, { cursor: '17' }))).codes).toEqual({
			cursor: 'validation_connection_server_field'
		});
		expect((await codesOf(calendar(owner, { last_error: 'x' }))).codes).toEqual({
			last_error: 'validation_connection_server_field'
		});
		expect((await codesOf(calendar(owner, { settings: { url: 'https://example.com' } }))).codes).toEqual({
			settings: 'validation_connection_settings'
		});
		expect((await codesOf(calendar(owner, { type: 'slack' }))).codes).toEqual({
			type: 'validation_connection_type'
		});
	});

	it('creates a Notion connection with its variable only (ADR-0041)', async () => {
		const record = await calendar(owner, { type: 'notion', label: 'Notion', secret_env: 'BYL_NOTION_TOKEN', settings: {} });
		expect(record).toMatchObject({ type: 'notion', secret_env: 'BYL_NOTION_TOKEN', enabled: true });
		expect((await codesOf(calendar(owner, { type: 'notion', settings: { keywords: ['todo'] } }))).codes).toEqual({
			settings: 'validation_connection_settings'
		});
	});

	it('takes keywords and the answer switch, and refuses bad lists (ADR-0020)', async () => {
		const record = await telegram(owner, {
			settings: { allowed_env: 'BYL_TEST_ALLOWED', keywords: ['todo', 'zu erledigen'], reply_no_match: false }
		});
		expect(record.settings).toEqual({
			allowed_env: 'BYL_TEST_ALLOWED',
			keywords: ['todo', 'zu erledigen'],
			reply_no_match: false
		});
		const tooMany = Array.from({ length: 51 }, (_, i) => `k${i}`);
		for (const keywords of ['todo', [3], ['x'.repeat(101)], tooMany]) {
			expect((await codesOf(calendar(owner, { settings: { keywords } }))).codes).toEqual({
				settings: 'validation_keywords'
			});
		}
		expect(
			(await codesOf(owner.pb.collection('connections').update(record.id, { settings: { allowed_env: 'BYL_TEST_ALLOWED', reply_no_match: 1 } })))
				.codes
		).toEqual({ settings: 'validation_connection_settings' });
		expect((await codesOf(calendar(owner, { settings: { reply_no_match: true } }))).codes).toEqual({
			settings: 'validation_connection_settings'
		});
	});

	it('lets the owner change label, switch and variable, but not kind or server fields', async () => {
		const record = await calendar(owner);
		const connections = owner.pb.collection('connections');
		const updated = await connections.update(record.id, { label: 'Privat', enabled: false });
		expect(updated).toMatchObject({ label: 'Privat', enabled: false });
		expect((await codesOf(connections.update(record.id, { type: 'telegram' }))).codes).toEqual({
			type: 'validation_connection_immutable'
		});
		expect((await codesOf(connections.update(record.id, { running_since: '2026-09-25 10:00:00.000Z' }))).codes).toEqual({
			running_since: 'validation_connection_server_field'
		});
	});

	it('starts over when the variable changes: cursor, error and hint are cleared', async () => {
		const record = await telegram(owner);
		await superuser.collection('connections').update(record.id, {
			cursor: '41',
			last_error: 'alt',
			last_hint: 'Hinweis',
			running_since: '2026-09-25 10:00:00.000Z'
		});
		const renamed = await owner.pb.collection('connections').update(record.id, { secret_env: 'BYL_TEST_OTHER' });
		expect(renamed).toMatchObject({ cursor: '', last_error: '', last_hint: '' });
		const same = await owner.pb.collection('connections').update(record.id, { label: 'Bot' });
		expect(same.cursor).toBe('');
	});
});

describe('connections: secret status', () => {
	it('says only yes or no, per variable', async () => {
		const cal = await calendar(owner);
		expect((await status(owner, cal.id)).json).toEqual({ secret: true, allowlist: null });
		const bot = await telegram(owner);
		expect((await status(owner, bot.id)).json).toEqual({ secret: true, allowlist: true });
		const missing = await telegram(owner, { secret_env: 'BYL_TEST_UNSET', settings: { allowed_env: 'BYL_TEST_UNSET_TOO' } });
		const answer = await status(owner, missing.id);
		expect(answer.json).toEqual({ secret: false, allowlist: false });
		for (const id of [cal.id, bot.id]) expectNoValues((await status(owner, id)).text);
	});

	it('hides foreign and unknown connections and refuses guests', async () => {
		const cal = await calendar(owner);
		expect((await status(other, cal.id)).status).toBe(404);
		expect((await status(owner, 'abcdefghijklmno')).status).toBe(404);
		expect((await status(null, cal.id)).status).toBe(401);
		await expect(other.pb.collection('connections').getOne(cal.id)).rejects.toMatchObject({ status: 404 });
		expect(await other.pb.collection('connections').getFullList()).toEqual([]);
	});
});

describe('connections: no values anywhere', () => {
	it('keeps values out of lists, records and realtime events', async () => {
		const events = [];
		const unsubscribe = await owner.pb.collection('connections').subscribe('*', (event) => events.push(event));
		const bot = await telegram(owner);
		await owner.pb.collection('connections').update(bot.id, { label: 'Umbenannt' });
		await expect.poll(() => events.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
		await unsubscribe();
		expectNoValues(JSON.stringify(events));
		expectNoValues(JSON.stringify(await owner.pb.collection('connections').getFullList()));
		expectNoValues(JSON.stringify(await superuser.collection('connections').getFullList()));
		expectNoValues(JSON.stringify(await superuser.send('/api/logs', { query: { perPage: 500 } })));
		expectNoValues(instance.output());
	});

	it('keeps inbox items when their connection is deleted', async () => {
		const cal = await calendar(owner);
		const item = await superuser.collection('inbox_items').create({
			owner: owner.id,
			channel: 'calendar',
			kind: 'event',
			title: 'Termin',
			source_ref: `uid-${randomBytes(4).toString('hex')}`,
			connection: cal.id
		});
		expect(item.connection).toBe(cal.id);
		await owner.pb.collection('connections').delete(cal.id);
		const kept = await owner.pb.collection('inbox_items').getOne(item.id);
		expect(kept.connection).toBe('');
		expect(kept.state).toBe('new');
	});
});

describe('data layer of the web app', () => {
	it('creates, lists, switches and deletes connections and reads the state of the variables', async () => {
		const fresh = await user();
		const created = await createConnection(fresh.pb, {
			type: 'telegram',
			label: ' Bot ',
			secretEnv: 'BYL_TEST_TOKEN',
			allowlistEnv: 'BYL_TEST_UNSET'
		});
		expect(created).toMatchObject({
			type: 'telegram',
			label: 'Bot',
			enabled: true,
			secretEnv: 'BYL_TEST_TOKEN',
			allowlistEnv: 'BYL_TEST_UNSET',
			lastRunAt: null,
			lastError: ''
		});
		expect(await getSecretStatus(fresh.pb, created.id)).toEqual({ secret: true, allowlist: false });
		expect((await listConnections(fresh.pb)).map((item) => item.id)).toEqual([created.id]);
		expect(created).toMatchObject({ keywords: [], replyNoMatch: true });
		const saved = await saveConnectionSettings(fresh.pb, created, { keywords: [' todo ', '#byl'], replyNoMatch: false });
		expect(saved).toMatchObject({ keywords: ['todo', '#byl'], replyNoMatch: false, allowlistEnv: 'BYL_TEST_UNSET' });
		await expect(
			saveConnectionSettings(fresh.pb, created, { keywords: ['x'.repeat(101)], replyNoMatch: true })
		).rejects.toMatchObject({ kind: 'validation', fields: { settings: expect.anything() } });
		expect(await setConnectionEnabled(fresh.pb, created.id, false)).toMatchObject({ enabled: false, keywords: ['todo', '#byl'] });
		await deleteConnection(fresh.pb, created.id);
		expect(await listConnections(fresh.pb)).toEqual([]);
		await expect(
			createConnection(fresh.pb, { type: 'calendar', label: 'x', secretEnv: 'PATH', allowlistEnv: '' })
		).rejects.toMatchObject({ kind: 'validation', fields: { secret_env: expect.anything() } });
	});
});
