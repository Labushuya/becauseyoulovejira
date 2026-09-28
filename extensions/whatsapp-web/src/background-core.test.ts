// Service worker (ADR-0038 §3): answers only its own content script on WhatsApp Web and its own
// settings page, reads the key itself and stores the state of the page.

import { describe, expect, it, vi } from 'vitest';
import { WHATSAPP_ORIGIN, handleMessage, type WorkerDeps } from './background-core';
import { PAGE_STATE_KEY } from './messages';
import { MemoryStorage } from './testing';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const TOKEN = `byl_${'Ab12'.repeat(10)}`;
const PAYLOAD = {
	channel: 'whatsapp-web',
	mode: 'manual',
	text: 'Hallo',
	external_id: `wa:${'b'.repeat(64)}`
};
const FROM_PAGE = { id: ID, url: `${WHATSAPP_ORIGIN}` };
const FROM_SETTINGS = { id: ID, url: `chrome-extension://${ID}/options.html` };

function deps(
	local = new MemoryStorage({ appUrl: 'http://localhost:9000', token: TOKEN })
): WorkerDeps & {
	fetch: ReturnType<typeof vi.fn>;
	session: MemoryStorage;
} {
	return {
		local,
		session: new MemoryStorage(),
		fetch: vi.fn(async () => new Response(JSON.stringify({ status: 'created' }), { status: 201 })),
		extensionId: ID,
		now: () => 42
	};
}

describe('handleMessage', () => {
	it('sends an entry of the content script with the stored address and key', async () => {
		const worker = deps();
		expect(await handleMessage({ type: 'ingest', payload: PAYLOAD }, FROM_PAGE, worker)).toEqual({
			status: 'created'
		});
		const [url, init] = worker.fetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('http://localhost:9000/api/byl/inbox/ingest');
		expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
	});

	it('ignores other extensions, other pages and unknown or invalid messages', async () => {
		const worker = deps();
		const cases: [unknown, chrome.runtime.MessageSender][] = [
			[
				{ type: 'ingest', payload: PAYLOAD },
				{ id: 'other', url: WHATSAPP_ORIGIN }
			],
			[
				{ type: 'ingest', payload: PAYLOAD },
				{ id: ID, url: 'https://example.com/' }
			],
			[{ type: 'ingest', payload: PAYLOAD }, FROM_SETTINGS],
			[{ type: 'ingest', payload: { ...PAYLOAD, external_id: 'false_491234@c.us_X' } }, FROM_PAGE],
			[{ type: 'ingest', payload: { ...PAYLOAD, channel: 'api' } }, FROM_PAGE],
			[{ type: 'ingest', payload: { ...PAYLOAD, text: ' ' } }, FROM_PAGE],
			[{ type: 'test' }, FROM_PAGE],
			[{ type: 'token' }, FROM_SETTINGS],
			['test', FROM_SETTINGS]
		];
		for (const [message, sender] of cases) {
			expect(await handleMessage(message, sender, worker), JSON.stringify(message)).toBeNull();
		}
		expect(worker.fetch).not.toHaveBeenCalled();
	});

	it('stores the state of the page for the settings page', async () => {
		const worker = deps();
		expect(
			await handleMessage({ type: 'page-state', state: 'unknown' }, FROM_PAGE, worker)
		).toEqual({ status: 'ok' });
		expect(worker.session.values.get(PAGE_STATE_KEY)).toEqual({ state: 'unknown', at: 42 });
		expect(
			await handleMessage({ type: 'page-state', state: 'kaputt' }, FROM_PAGE, worker)
		).toBeNull();
	});

	it('tests the connection for the settings page only', async () => {
		const worker = deps();
		worker.fetch.mockResolvedValueOnce(
			new Response(
				JSON.stringify({ status: 'ok', name: 'Laptop', keywords: { 'whatsapp-web': 2 } }),
				{ status: 200 }
			)
		);
		expect(await handleMessage({ type: 'test' }, FROM_SETTINGS, worker)).toEqual({
			status: 'ok',
			name: 'Laptop',
			keywords: 2
		});
		const unset = deps(new MemoryStorage());
		expect(await handleMessage({ type: 'test' }, FROM_SETTINGS, unset)).toMatchObject({
			reason: 'not_configured'
		});
	});
});
