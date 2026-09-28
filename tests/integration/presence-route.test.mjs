// Presence and attention routes (ADR-0035 section 4; plan start-fenster, SF-1) against an own
// disposable instance, so no other test file shares the in-memory state or the gap of 2 s between
// two messages. Requests go through node:http, because fetch adds Sec-Fetch-Mode by itself; the
// headers are exactly the ones a script (byl-control.ps1), the landing page (file://, Origin "null")
// or a web page sends. The tabs are SDK clients with a realtime subscription over EventSource.

import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { ackAttention, subscribeAttention } from '../../web/src/lib/data/attention.ts';

const TOPIC = 'byl/attention';
const GAP_MS = 2100;
const EVENT_TIMEOUT_MS = 5_000;
const QUIET_PERIOD_MS = 400;

const FILE_PAGE = { Origin: 'null', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' };
const WEB_PAGE = { Origin: 'https://example.com', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' };
const APP_PAGE = { Origin: 'http://127.0.0.1:8090', 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' };

let instance;
let superuser;
let lastMessageAt = 0;
const clients = [];

/** One request with exactly the given headers; the body parsed as JSON when there is one. */
function call(path, { method = 'GET', headers = {} } = {}) {
	const url = new URL(path, instance.url);
	return new Promise((resolve, reject) => {
		const req = request(url, { method, headers: { ...headers, Connection: 'close' } }, (res) => {
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				let body = null;
				try {
					body = text === '' ? null : JSON.parse(text);
				} catch {
					body = text;
				}
				resolve({ status: res.statusCode, headers: res.headers, body, text });
			});
		});
		req.on('error', reject);
		req.end();
	});
}

/** Waits until the next message is allowed (at most one per 2 s). */
async function nextSlot() {
	const wait = lastMessageAt + GAP_MS - Date.now();
	if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function sendAttention(reason, headers = {}) {
	await nextSlot();
	const response = await call(`/api/byl/attention?reason=${reason}`, { method: 'POST', headers });
	if (response.status === 200) lastMessageAt = Date.now();
	return response;
}

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	clients.push(pb);
	return pb;
}

async function user() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return pb;
}

/** A tab: subscribes to the topic and collects the messages. */
async function tab(pb, topic = TOPIC) {
	const messages = [];
	await pb.realtime.subscribe(topic, (data) => messages.push(data));
	return messages;
}

async function until(check) {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > EVENT_TIMEOUT_MS) throw new Error('No realtime message in time');
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

const quiet = () => new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = new PocketBase(instance.url);
	superuser.autoCancellation(false);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
}, 60_000);

afterAll(async () => {
	for (const pb of clients) await pb.realtime.unsubscribe().catch(() => undefined);
	await instance?.stop();
});

describe('presence and attention (ADR-0035, SF-1)', () => {
	let first;
	let second;
	let firstMessages;
	let secondMessages;
	let anonymousMessages;
	let otherTopicMessages;

	it('reports no tabs and no landing page on a fresh instance', async () => {
		const response = await call('/api/byl/presence');
		expect(response.status).toBe(200);
		expect(response.body).toEqual({ tabs: 0, landingAgoMs: null });
	});

	it.each([
		['a web page', WEB_PAGE],
		['the landing page', FILE_PAGE],
		['the app itself', APP_PAGE],
		['a navigation', { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate' }],
		['a request with Sec-Fetch-Site only', { 'Sec-Fetch-Site': 'same-site' }]
	])('refuses the presence to %s without telling anything', async (_name, headers) => {
		const response = await call('/api/byl/presence', { headers });
		expect(response.status).toBe(403);
		expect(response.text).not.toMatch(/tabs|landing/);
	});

	it('counts only signed-in app tabs subscribed to byl/attention', async () => {
		first = await user();
		second = await user();
		const other = await user();
		const anonymous = client();
		firstMessages = await tab(first);
		secondMessages = await tab(second);
		otherTopicMessages = await tab(other, 'byl/other');
		anonymousMessages = await tab(anonymous);
		const superuserMessages = await tab(superuser);
		void superuserMessages;

		const response = await call('/api/byl/presence');
		expect(response.status).toBe(200);
		expect(response.body.tabs).toBe(2);
	});

	it('sends the message to both tabs and records the confirmation of one', async () => {
		const response = await sendAttention('start');
		expect(response.status).toBe(200);
		expect(response.body.notified).toBe(2);
		expect(response.body.nonce).toMatch(/^[A-Za-z0-9]{24}$/);
		const { nonce } = response.body;

		await until(() => firstMessages.length === 1 && secondMessages.length === 1);
		expect(firstMessages[0]).toEqual({ nonce, reason: 'start' });
		expect(secondMessages[0]).toEqual({ nonce, reason: 'start' });
		await quiet();
		expect(anonymousMessages).toEqual([]);
		expect(otherTopicMessages).toEqual([]);

		expect((await call(`/api/byl/attention/${nonce}`)).body).toEqual({ acked: false });
		await first.send(`/api/byl/attention/${nonce}/ack`, { method: 'POST' });
		expect((await call(`/api/byl/attention/${nonce}`)).body).toEqual({ acked: true });
		expect((await call(`/api/byl/attention/${nonce}`, { headers: FILE_PAGE })).body).toEqual({ acked: true });
	});

	it('refuses a second message within 2 s with 429', async () => {
		const response = await call('/api/byl/attention?reason=start', { method: 'POST' });
		expect(response.status).toBe(429);
	});

	it('lets the landing page send, marks it as seen and answers it with CORS', async () => {
		const response = await sendAttention('datei', FILE_PAGE);
		expect(response.status).toBe(200);
		expect(response.body.notified).toBe(2);
		expect(response.headers['access-control-allow-origin']).toBeDefined();
		await until(() => firstMessages.length === 2 && secondMessages.length === 2);
		expect(firstMessages[1]).toMatchObject({ reason: 'datei' });

		const presence = await call('/api/byl/presence');
		expect(presence.body.tabs).toBe(2);
		expect(presence.body.landingAgoMs).toBeGreaterThanOrEqual(0);
		expect(presence.body.landingAgoMs).toBeLessThan(10_000);
	});

	it('marks the landing page as seen even when its message comes too soon', async () => {
		await nextSlot();
		const script = await sendAttention('stop');
		expect(script.status).toBe(200);
		await until(() => firstMessages.length === 3);
		expect(firstMessages[2]).toMatchObject({ reason: 'stop' });

		await new Promise((resolve) => setTimeout(resolve, 300));
		const before = (await call('/api/byl/presence')).body.landingAgoMs;
		const landing = await call('/api/byl/attention?reason=datei', { method: 'POST', headers: FILE_PAGE });
		expect(landing.status).toBe(429);
		const after = (await call('/api/byl/presence')).body.landingAgoMs;
		expect(after).toBeLessThan(before);
	});

	it.each([
		['a web page', WEB_PAGE],
		['the app itself', APP_PAGE],
		['a navigation', { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate' }]
	])('refuses the message and its state to %s', async (_name, headers) => {
		expect((await call('/api/byl/attention?reason=start', { method: 'POST', headers })).status).toBe(403);
		expect((await call(`/api/byl/attention/${'a'.repeat(24)}`, { headers })).status).toBe(403);
	});

	it('refuses an unknown reason and unknown or malformed nonces', async () => {
		expect((await call('/api/byl/attention?reason=restart', { method: 'POST' })).status).toBe(400);
		expect((await call('/api/byl/attention', { method: 'POST' })).status).toBe(400);
		expect((await call(`/api/byl/attention/${'a'.repeat(24)}`)).status).toBe(404);
		expect((await call('/api/byl/attention/kurz')).status).toBe(404);
	});

	it('accepts a confirmation only from a signed-in app user and for a known nonce', async () => {
		const response = await sendAttention('start');
		const { nonce } = response.body;
		const ack = `/api/byl/attention/${nonce}/ack`;

		expect((await call(ack, { method: 'POST' })).status).toBe(401);
		expect((await call(ack, { method: 'POST', headers: FILE_PAGE })).status).toBe(401);
		await expect(superuser.send(ack, { method: 'POST' })).rejects.toMatchObject({ status: 403 });
		await expect(first.send(`/api/byl/attention/${'b'.repeat(24)}/ack`, { method: 'POST' })).rejects.toMatchObject({
			status: 404
		});
		expect((await call(`/api/byl/attention/${nonce}`)).body).toEqual({ acked: false });

		await second.send(ack, { method: 'POST' });
		expect((await call(`/api/byl/attention/${nonce}`)).body).toEqual({ acked: true });
	});

	it('forgets a tab that unsubscribed', async () => {
		await second.realtime.unsubscribe(TOPIC);
		expect((await call('/api/byl/presence')).body.tabs).toBe(1);
	});

	it('works with the data layer of the SPA (SF-3)', async () => {
		const pb = await user();
		const messages = [];
		const stop = await subscribeAttention(pb, (message) => messages.push(message));
		expect((await call('/api/byl/presence')).body.tabs).toBe(2);

		const response = await sendAttention('datei');
		const { nonce } = response.body;
		await until(() => messages.length === 1);
		expect(messages[0]).toEqual({ nonce, reason: 'datei' });

		await ackAttention(pb, nonce);
		expect((await call(`/api/byl/attention/${nonce}`)).body).toEqual({ acked: true });
		await expect(ackAttention(pb, '../x')).rejects.toThrow('Invalid nonce');
		await stop();
		expect((await call('/api/byl/presence')).body.tabs).toBe(1);
	});
});
