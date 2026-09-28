// Requests of the service worker to the own inbox (ADR-0038 §1): the key only in the header,
// every answer of the app mapped to what the extension shows.

import { describe, expect, it, vi } from 'vitest';
import { FAILURE_MESSAGES, INGEST_PATH, sendEntry, testConnection } from './api';
import type { IngestPayload } from './payload';

const TOKEN = `byl_${'Ab12'.repeat(10)}`;
const SETTINGS = { appUrl: 'http://127.0.0.1:8090', token: TOKEN };
const PAYLOAD: IngestPayload = {
	channel: 'whatsapp-web',
	mode: 'manual',
	text: 'Milch kaufen',
	external_id: `wa:${'a'.repeat(64)}`
};

function answer(status: number, body: unknown) {
	return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('sendEntry', () => {
	it('posts the payload with the key in the header only', async () => {
		const fetchFn = answer(201, { status: 'created', item: 'x' });
		expect(await sendEntry(fetchFn, SETTINGS, PAYLOAD)).toEqual({ status: 'created' });
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`http://127.0.0.1:8090${INGEST_PATH}`);
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({
			'Content-Type': 'application/json',
			Authorization: `Bearer ${TOKEN}`
		});
		expect(init.credentials).toBe('omit');
		expect(init.redirect).toBe('error');
		expect(JSON.parse(String(init.body))).toEqual(PAYLOAD);
		expect(String(init.body)).not.toContain(TOKEN);
	});

	it('maps duplicate, filtered and every failure', async () => {
		expect(
			await sendEntry(answer(200, { status: 'duplicate', state: 'discarded' }), SETTINGS, PAYLOAD)
		).toEqual({
			status: 'duplicate',
			state: 'discarded'
		});
		expect(await sendEntry(answer(422, { status: 'filtered' }), SETTINGS, PAYLOAD)).toEqual({
			status: 'filtered'
		});
		const cases: [number, unknown, string][] = [
			[401, {}, 'unauthorized'],
			[403, {}, 'forbidden'],
			[429, { status: 'rate_limited' }, 'rate_limited'],
			[503, {}, 'unavailable'],
			[400, { status: 'invalid', message: 'text fehlt.' }, 'invalid'],
			[500, {}, 'server'],
			[200, { status: 'seltsam' }, 'server']
		];
		for (const [status, body, reason] of cases) {
			const result = await sendEntry(answer(status, body), SETTINGS, PAYLOAD);
			expect(result, String(status)).toMatchObject({ status: 'error', reason });
		}
		expect(
			await sendEntry(answer(400, { message: 'text fehlt.' }), SETTINGS, PAYLOAD)
		).toMatchObject({
			message: 'text fehlt.'
		});
	});

	it('does not ask without a key and says when the app is not reachable', async () => {
		const fetchFn = vi.fn();
		expect(await sendEntry(fetchFn, { ...SETTINGS, token: '' }, PAYLOAD)).toEqual({
			status: 'error',
			reason: 'not_configured',
			message: FAILURE_MESSAGES.not_configured
		});
		expect(fetchFn).not.toHaveBeenCalled();
		const failing = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		expect(await sendEntry(failing, SETTINGS, PAYLOAD)).toMatchObject({ reason: 'unreachable' });
		expect(FAILURE_MESSAGES.unreachable).toContain('App nicht erreichbar');
	});
});

describe('testConnection', () => {
	it('names the key and the keywords of WhatsApp Web', async () => {
		const fetchFn = answer(200, {
			status: 'ok',
			name: 'Laptop',
			keywords: { api: 1, 'whatsapp-web': 3 }
		});
		expect(await testConnection(fetchFn, SETTINGS)).toEqual({
			status: 'ok',
			name: 'Laptop',
			keywords: 3
		});
		expect((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('GET');
		expect(await testConnection(answer(401, {}), SETTINGS)).toMatchObject({
			reason: 'unauthorized'
		});
	});
});
