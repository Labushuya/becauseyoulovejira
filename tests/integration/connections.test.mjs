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
	listConnectionNames,
	listConnections,
	renameConnection,
	saveConnectionSettings,
	setConnectionEnabled,
	subscribeConnectionNames
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
		// The confirmation of a saved entry is a switch as well (ADR-0016, addendum of 2026-10-01).
		const quiet = await owner.pb
			.collection('connections')
			.update(record.id, { settings: { ...record.settings, reply_saved: false } });
		expect(quiet.settings).toMatchObject({ reply_saved: false, reply_no_match: false });
		for (const value of ['nein', 0, null]) {
			expect(
				(await codesOf(owner.pb.collection('connections').update(record.id, { settings: { allowed_env: 'BYL_TEST_ALLOWED', reply_saved: value } })))
					.codes,
				JSON.stringify(value)
			).toEqual({ settings: 'validation_connection_settings' });
		}
		expect((await codesOf(calendar(owner, { settings: { reply_saved: false } }))).codes).toEqual({
			settings: 'validation_connection_settings'
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
		expect(await connections.update(record.id, { label: 'Privat' })).toMatchObject({ label: 'Privat' });
		expect(await connections.update(record.id, { enabled: false })).toMatchObject({ label: 'Privat', enabled: false });
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

describe('connections: renaming (ADR-0026, addendum KK-3)', () => {
	it('changes only the name: fetching, access data, keywords and cursor stay', async () => {
		const record = await telegram(owner, { settings: { allowed_env: 'BYL_TEST_ALLOWED', keywords: ['todo'], reply_no_match: false } });
		await superuser.collection('connections').update(record.id, {
			cursor: '41',
			last_run_at: '2026-10-01 08:00:00.000Z',
			last_ok_at: '2026-10-01 08:00:00.000Z',
			last_hint: 'Hinweis'
		});
		const before = await owner.pb.collection('connections').getOne(record.id);
		const renamed = await owner.pb.collection('connections').update(record.id, { label: '  Familienchat  ' });
		expect(renamed.label).toBe('Familienchat');
		for (const field of ['type', 'enabled', 'secret_env', 'settings', 'cursor', 'last_run_at', 'last_ok_at', 'last_error', 'last_hint', 'running_since', 'owner', 'household', 'scope']) {
			expect(renamed[field], field).toEqual(before[field]);
		}
	});

	it('refuses an empty or too long name and a rename that changes anything else', async () => {
		const record = await calendar(owner, { settings: { keywords: ['termin'] } });
		const connections = owner.pb.collection('connections');
		for (const label of ['', '   ']) {
			expect((await codesOf(connections.update(record.id, { label }))).codes).toEqual({ label: 'validation_connection_label' });
		}
		expect((await codesOf(connections.update(record.id, { label: 'x'.repeat(101) }))).codes).toEqual({
			label: 'validation_connection_label_max'
		});
		expect(await connections.update(record.id, { label: `  ${'y'.repeat(100)}  ` })).toMatchObject({ label: 'y'.repeat(100) });
		for (const [change, field] of [
			[{ enabled: false }, 'enabled'],
			[{ secret_env: 'BYL_TEST_OTHER' }, 'secret_env'],
			[{ settings: { keywords: [] } }, 'settings']
		]) {
			const answer = await codesOf(connections.update(record.id, { label: 'Neu', ...change }));
			expect(answer, field).toEqual({ status: 400, codes: { [field]: 'validation_connection_rename_only' } });
		}
		expect((await connections.getOne(record.id)).label).toBe('y'.repeat(100));
		// Creating checks the name the same way.
		expect((await codesOf(calendar(owner, { label: ' ' }))).codes).toEqual({ label: 'validation_connection_label' });
		// The administration stays free.
		expect(await superuser.collection('connections').update(record.id, { label: 'Admin', enabled: false })).toMatchObject({
			label: 'Admin',
			enabled: false
		});
	});

	it('allows renaming to whoever may edit the connection, also in a household', async () => {
		const [member, outsider] = [await user(), await user()];
		const household = await superuser.collection('households').create({ name: `H ${randomBytes(4).toString('hex')}` });
		for (const who of [owner, member]) {
			await superuser.collection('household_members').create({ household: household.id, user: who.id, role: 'member' });
		}
		const shared = await calendar(owner, { household: household.id });
		expect(await member.pb.collection('connections').update(shared.id, { label: 'Familie' })).toMatchObject({ label: 'Familie' });
		expect((await codesOf(outsider.pb.collection('connections').update(shared.id, { label: 'Fremd' }))).status).toBe(404);
		expect((await superuser.collection('connections').getOne(shared.id)).label).toBe('Familie');
	});

	it('sends the new name to every open tab of the owner at once', async () => {
		const record = await calendar(owner);
		const events = [];
		const unsubscribe = await owner.pb.collection('connections').subscribe(record.id, (event) => events.push(event));
		await owner.pb.collection('connections').update(record.id, { label: 'Arbeit' });
		await expect.poll(() => events.map((event) => event.record.label), { timeout: 5_000 }).toContain('Arbeit');
		await unsubscribe();
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
		expect(created).toMatchObject({ keywords: [], replySaved: true, replyNoMatch: true });
		const saved = await saveConnectionSettings(fresh.pb, created, {
			keywords: [' todo ', '#byl'],
			replySaved: true,
			replyNoMatch: false,
			matchBody: false
		});
		expect(saved).toMatchObject({ keywords: ['todo', '#byl'], replySaved: true, replyNoMatch: false, allowlistEnv: 'BYL_TEST_UNSET' });
		// The confirmation is stored only while it is off (ADR-0016, addendum of 2026-10-01).
		expect((await fresh.pb.collection('connections').getOne(created.id)).settings).not.toHaveProperty('reply_saved');
		const quiet = await saveConnectionSettings(fresh.pb, created, { ...saved, replySaved: false });
		expect(quiet).toMatchObject({ replySaved: false, replyNoMatch: false, keywords: ['todo', '#byl'] });
		expect((await fresh.pb.collection('connections').getOne(created.id)).settings).toMatchObject({ reply_saved: false });
		expect(await saveConnectionSettings(fresh.pb, created, { ...quiet, replySaved: true })).toMatchObject({ replySaved: true });
		expect((await fresh.pb.collection('connections').getOne(created.id)).settings).not.toHaveProperty('reply_saved');
		await expect(
			saveConnectionSettings(fresh.pb, created, { keywords: ['x'.repeat(101)], replySaved: true, replyNoMatch: true, matchBody: false })
		).rejects.toMatchObject({ kind: 'validation', fields: { settings: expect.anything() } });
		expect(await setConnectionEnabled(fresh.pb, created.id, false)).toMatchObject({ enabled: false, keywords: ['todo', '#byl'] });
		await deleteConnection(fresh.pb, created.id);
		expect(await listConnections(fresh.pb)).toEqual([]);
		await expect(
			createConnection(fresh.pb, { type: 'calendar', label: 'x', secretEnv: 'PATH', allowlistEnv: '' })
		).rejects.toMatchObject({ kind: 'validation', fields: { secret_env: expect.anything() } });
	});

	it('renames a connection and follows the names through realtime (KK-3)', async () => {
		const fresh = await user();
		const bot = await createConnection(fresh.pb, {
			type: 'telegram',
			label: 'Bot',
			secretEnv: 'BYL_TEST_TOKEN',
			allowlistEnv: 'BYL_TEST_ALLOWED'
		});
		const changes = [];
		const unsubscribe = await subscribeConnectionNames(fresh.pb, (change) => changes.push(change));
		const renamed = await renameConnection(fresh.pb, bot.id, ' Familienchat ');
		expect(renamed).toMatchObject({ id: bot.id, label: 'Familienchat', secretEnv: 'BYL_TEST_TOKEN', allowlistEnv: 'BYL_TEST_ALLOWED' });
		await expect
			.poll(() => changes, { timeout: 5_000 })
			.toContainEqual({ action: 'update', record: { id: bot.id, label: 'Familienchat' } });
		await expect(renameConnection(fresh.pb, bot.id, '   ')).rejects.toMatchObject({
			kind: 'validation',
			fields: { label: { code: 'validation_connection_label', message: 'Bitte einen Namen eingeben.' } }
		});
		expect(await listConnectionNames(fresh.pb)).toEqual([{ id: bot.id, label: 'Familienchat' }]);
		await deleteConnection(fresh.pb, bot.id);
		await expect.poll(() => changes, { timeout: 5_000 }).toContainEqual({ action: 'delete', id: bot.id });
		await unsubscribe();
		expect(await listConnectionNames(fresh.pb)).toEqual([]);
	});
});
