// Telegram bot (ADR-0016 section 2 and addendum of 2026-10-01, ADR-0020; E4 plan packages 17 and 20)
// against a fake Bot API on 127.0.0.1 instead of api.telegram.org: messages, the answers in the
// chat and their switches. The bot of the tests has the keywords KEYWORDS; "mull"
// and "uber" also check that umlauts do not count. An own disposable instance gets an invented token, the allowlist
// and the address of the fake server (BYL_TELEGRAM_API_BASE) as variables. The token may appear
// nowhere: not in responses, not in last_error, not in the server log and not in the console.
// The cron job runs every minute in the instance as well; the tests therefore check the state
// after a run (entries, confirmations, offset) instead of the counts of one particular run.

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writtenLogs } from '../support/logs.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';

const TOKEN = `7${randomBytes(4).readUInt32BE()}:AA${randomBytes(18).toString('hex')}`;
const BROKEN_TOKEN = `8${randomBytes(4).readUInt32BE()}:AA${randomBytes(18).toString('hex')}`;
const OWN_ID = 424242;
const GROUP_ID = -100123;
const KEYWORDS = ['milch', 'rechnung', 'mull', 'zahnarzt', 'uber'];

/** Updates the fake server offers, in the order Telegram would. */
const updates = [];
const confirmations = [];
const offsets = [];
let failConfirmations = false;
let nextUpdate = 1000;
let nextMessage = 1;

function readBody(request) {
	return new Promise((resolve) => {
		let body = '';
		request.on('data', (chunk) => (body += chunk));
		request.on('end', () => resolve(body === '' ? {} : JSON.parse(body)));
	});
}

function reply(response, status, json) {
	response.writeHead(status, { 'Content-Type': 'application/json' });
	response.end(JSON.stringify(json));
}

const fake = createServer(async (request, response) => {
	const match = /^\/bot([^/]+)\/(\w+)$/.exec(request.url ?? '');
	const body = await readBody(request);
	if (!match) return reply(response, 404, { ok: false, error_code: 404, description: 'Not Found' });
	const [, token, method] = match;
	if (token === BROKEN_TOKEN) {
		request.socket.destroy();
		return;
	}
	if (token !== TOKEN) return reply(response, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
	if (method === 'getUpdates') {
		offsets.push(body.offset);
		expect(body.allowed_updates).toEqual(['message']);
		expect(body.timeout).toBe(0);
		return reply(response, 200, { ok: true, result: updates.filter((item) => item.update_id >= (body.offset ?? 0)) });
	}
	if (method === 'sendMessage') {
		if (failConfirmations) return reply(response, 500, { ok: false, error_code: 500, description: 'Internal Server Error' });
		confirmations.push(body);
		return reply(response, 200, { ok: true, result: { message_id: 1 } });
	}
	return reply(response, 404, { ok: false, description: 'Not Found' });
});

function send(chat, message) {
	const update = {
		update_id: nextUpdate++,
		message: {
			message_id: nextMessage++,
			date: Math.floor(Date.now() / 1000),
			chat,
			from: { id: chat.id > 0 ? chat.id : OWN_ID, is_bot: false, first_name: 'Anna' },
			...message
		}
	};
	updates.push(update);
	return update;
}

const PRIVATE = { id: OWN_ID, type: 'private', first_name: 'Anna' };
const GROUP = { id: GROUP_ID, type: 'supergroup', title: 'Familie' };
const STRANGER = { id: 555001, type: 'private', first_name: 'Fremd' };

let instance;
let superuser;
let owner;
let bot;

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

function connection(who, secret, data = {}) {
	return who.pb.collection('connections').create({
		owner: who.id,
		type: 'telegram',
		label: 'Telegram-Bot',
		enabled: true,
		secret_env: secret,
		settings: { allowed_env: 'BYL_TEST_TG_ALLOWED', keywords: KEYWORDS },
		...data
	});
}

async function runNow(who, id) {
	for (let attempt = 0; attempt < 40; attempt++) {
		const response = await fetch(`${instance.url}/api/byl/connections/${id}/run`, {
			method: 'POST',
			headers: { Authorization: who.pb.authStore.token }
		});
		const text = await response.text();
		expect(text).not.toContain(TOKEN);
		const result = JSON.parse(text);
		if (result.status !== 'running') return result;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error('The connection stayed locked.');
}

function telegramItems(who) {
	return who.pb.collection('inbox_items').getFullList({
		filter: who.pb.filter('channel = {:channel}', { channel: 'telegram' }),
		sort: 'source_date,source_ref'
	});
}

beforeAll(async () => {
	await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
	instance = await startPocketBase({
		env: {
			BYL_TELEGRAM_API_BASE: `http://127.0.0.1:${fake.address().port}`,
			BYL_TEST_TG_TOKEN: TOKEN,
			BYL_TEST_TG_BROKEN: BROKEN_TOKEN,
			BYL_TEST_TG_WRONG: '9999:AAwrongwrongwrongwrongwrongwrongwrong',
			BYL_TEST_TG_ALLOWED: `${OWN_ID}, 777`
		}
	});
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await user();
	bot = await connection(owner, 'BYL_TEST_TG_TOKEN');
});

afterAll(async () => {
	fake.closeAllConnections();
	await new Promise((resolve) => fake.close(resolve));
	await instance?.stop();
});

describe('Telegram: messages into the inbox', () => {
	it('saves allowed messages, confirms each and leaves others out', async () => {
		send(PRIVATE, { text: 'Milch kaufen\nund Brot' });
		send(STRANGER, { text: 'Werbung' });
		send(GROUP, { caption: 'Rechnung bezahlen', photo: [{ file_id: 'x' }] });
		send(PRIVATE, { photo: [{ file_id: 'y' }] });
		const last = send(GROUP, { text: 'Müll rausbringen' });
		expect(await runNow(owner, bot.id)).toMatchObject({ status: 'ok' });

		const items = await telegramItems(owner);
		expect(items.map((item) => item.title).sort()).toEqual(['Milch kaufen', 'Müll rausbringen', 'Rechnung bezahlen']);
		const milk = items.find((item) => item.title === 'Milch kaufen');
		expect(milk).toMatchObject({
			kind: 'message',
			body: 'Milch kaufen\nund Brot',
			connection: bot.id,
			source_meta: { chat: 'Anna', sender: 'Anna', chat_id: String(OWN_ID), keyword: 'milch' }
		});
		expect(confirmations.map((item) => [item.chat_id, item.text])).toEqual([
			[OWN_ID, 'Im Eingang gespeichert'],
			[GROUP_ID, 'Im Eingang gespeichert'],
			[GROUP_ID, 'Im Eingang gespeichert']
		]);
		const record = await owner.pb.collection('connections').getOne(bot.id);
		expect(record.cursor).toBe(String(last.update_id));
		expect(record.last_hint).toMatch(/Chat-ID 555001/);
		expect(record.last_hint).toMatch(/BYL_TEST_TG_ALLOWED/);
		expect(record.last_hint).not.toContain('Werbung');
		expect(record.last_error).toBe('');
	});

	it('asks with the next offset and creates nothing twice', async () => {
		await runNow(owner, bot.id);
		expect(offsets.at(-1)).toBe(updates.at(-1).update_id + 1);
		expect(await telegramItems(owner)).toHaveLength(3);
		expect(confirmations).toHaveLength(3);

		// Telegram offers a message again (e.g. after a lost offset): a duplicate, no second confirmation.
		const again = { ...updates[0], update_id: nextUpdate++ };
		updates.push(again);
		await runNow(owner, bot.id);
		expect(await telegramItems(owner)).toHaveLength(3);
		expect(confirmations).toHaveLength(3);
	});

	it('keeps the entry when the confirmation fails and shows the error', async () => {
		failConfirmations = true;
		try {
			send(PRIVATE, { text: 'Zahnarzt anrufen' });
			await runNow(owner, bot.id);
			await expect.poll(async () => (await telegramItems(owner)).length).toBe(4);
			const record = await owner.pb.collection('connections').getOne(bot.id);
			expect(record.last_error).toMatch(/Bestätigung „Im Eingang gespeichert“ ging nicht raus/);
			expect(record.last_error).toMatch(/HTTP 500/);
			expect(record.cursor).toBe(String(updates.at(-1).update_id));
		} finally {
			failConfirmations = false;
		}
	});

	it('leaves out messages without keyword and answers them unless switched off (ADR-0020)', async () => {
		const before = confirmations.length;
		const hello = send(PRIVATE, { text: 'Hallo, wie geht es?' });
		await runNow(owner, bot.id);
		expect((await telegramItems(owner)).map((item) => item.title)).not.toContain('Hallo, wie geht es?');
		expect(confirmations.slice(before).map((item) => [item.chat_id, item.text, item.reply_parameters.message_id])).toEqual([
			[OWN_ID, 'Kein Stichwort erkannt – nicht gespeichert', hello.message.message_id]
		]);
		const record = await owner.pb.collection('connections').getOne(bot.id);
		expect(record.cursor).toBe(String(hello.update_id));
		expect(record.last_error).toBe('');

		await owner.pb.collection('connections').update(bot.id, { settings: { ...record.settings, reply_no_match: false } });
		const quiet = send(PRIVATE, { text: 'Noch ein Gruß' });
		await runNow(owner, bot.id);
		await expect
			.poll(async () => (await owner.pb.collection('connections').getOne(bot.id)).cursor)
			.toBe(String(quiet.update_id));
		expect(confirmations.length).toBe(before + 1);
		expect(await telegramItems(owner)).toHaveLength(4);
		await owner.pb.collection('connections').update(bot.id, { settings: record.settings });
	});

	it('switches each answer off on its own; a connection without the switches answers (ADR-0016, addendum of 2026-10-01)', async () => {
		const connections = owner.pb.collection('connections');
		const record = await connections.getOne(bot.id);
		// Data of before: the bot was created without the switches and confirmed and answered above.
		expect(record.settings).not.toHaveProperty('reply_saved');
		expect(record.settings).not.toHaveProperty('reply_no_match');
		const cursorOf = async () => (await connections.getOne(bot.id)).cursor;
		const titles = async () => (await telegramItems(owner)).map((item) => item.title);
		const answers = (from) => confirmations.slice(from).map((item) => [item.chat_id, item.text, item.reply_parameters.message_id]);
		try {
			// Confirmation off: the entry is saved without an answer, the hint without keyword stays.
			const before = confirmations.length;
			await connections.update(bot.id, { settings: { ...record.settings, reply_saved: false } });
			send(PRIVATE, { text: 'Milch ohne Bestätigung' });
			const hello = send(PRIVATE, { text: 'Guten Morgen' });
			await runNow(owner, bot.id);
			await expect.poll(cursorOf).toBe(String(hello.update_id));
			expect(await titles()).toContain('Milch ohne Bestätigung');
			expect(answers(before)).toEqual([[OWN_ID, 'Kein Stichwort erkannt – nicht gespeichert', hello.message.message_id]]);

			// Both off: nothing goes into the chat, the entry is saved all the same.
			const quiet = confirmations.length;
			await connections.update(bot.id, { settings: { ...record.settings, reply_saved: false, reply_no_match: false } });
			send(GROUP, { text: 'Rechnung ohne Antwort' });
			const greeting = send(PRIVATE, { text: 'Noch ein Gruß ohne Antwort' });
			await runNow(owner, bot.id);
			await expect.poll(cursorOf).toBe(String(greeting.update_id));
			expect(await titles()).toContain('Rechnung ohne Antwort');
			expect(confirmations.length).toBe(quiet);

			// Hint off, confirmation on (stored as true): only the confirmation.
			const loud = confirmations.length;
			await connections.update(bot.id, { settings: { ...record.settings, reply_saved: true, reply_no_match: false } });
			const dentist = send(PRIVATE, { text: 'Zahnarzt mit Bestätigung' });
			const last = send(PRIVATE, { text: 'Kein Treffer hier' });
			await runNow(owner, bot.id);
			await expect.poll(cursorOf).toBe(String(last.update_id));
			expect(answers(loud)).toEqual([[OWN_ID, 'Im Eingang gespeichert', dentist.message.message_id]]);
			expect((await connections.getOne(bot.id)).last_error).toBe('');
		} finally {
			await connections.update(bot.id, { settings: record.settings });
		}
	});

	it('fetches through the cron job as well', async () => {
		send(PRIVATE, { text: 'Über den Cron-Job' });
		const response = await fetch(`${instance.url}/api/crons/byl-telegram`, {
			method: 'POST',
			headers: { Authorization: superuser.authStore.token }
		});
		expect(response.status).toBe(204);
		await expect
			.poll(async () => (await telegramItems(owner)).map((item) => item.title), { timeout: scaled(10_000) })
			.toContain('Über den Cron-Job');
	});
});

describe('Telegram: errors without the token', () => {
	it('stores a refused token and a broken connection cleaned, and keeps the offset', async () => {
		const who = await user();
		const wrong = await connection(who, 'BYL_TEST_TG_WRONG');
		const refused = await runNow(who, wrong.id);
		expect(refused).toMatchObject({
			status: 'error',
			error: 'Telegram antwortet auf getUpdates mit HTTP 401: Unauthorized'
		});
		const broken = await connection(who, 'BYL_TEST_TG_BROKEN');
		const result = await runNow(who, broken.id);
		expect(result.status).toBe('error');
		expect(result.error).toMatch(/^Post "http:\/\/127\.0\.0\.1:\d+"/);
		expect(result.error).not.toContain(BROKEN_TOKEN);
		const stored = await who.pb.collection('connections').getOne(broken.id);
		expect(stored).toMatchObject({ cursor: '', last_ok_at: '', last_error: result.error });
	});

	it('does nothing without the allowlist variable', async () => {
		const who = await user();
		const record = await connection(who, 'BYL_TEST_TG_TOKEN', { settings: { allowed_env: 'BYL_TEST_TG_UNSET' } });
		const calls = offsets.length;
		expect(await runNow(who, record.id)).toMatchObject({ status: 'missing', missing: ['BYL_TEST_TG_UNSET'] });
		expect(offsets.length).toBe(calls);
	});

	it('never writes the token to the log or the console', async () => {
		// PocketBase writes its log in batches: everything up to now, with the warnings of the failed
		// runs, and all entries, not only the first page.
		const logs = JSON.stringify(await writtenLogs(superuser));
		expect(logs).toContain('byl-telegram');
		for (const secret of [TOKEN, BROKEN_TOKEN]) {
			expect(logs).not.toContain(secret);
			expect(instance.output()).not.toContain(secret);
			expect(JSON.stringify(await superuser.collection('connections').getFullList())).not.toContain(secret);
		}
	});
});
