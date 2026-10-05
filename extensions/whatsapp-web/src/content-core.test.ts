// Content script on a hand-built WhatsApp Web page (ADR-0038 §3): one own button per message
// with text and nothing else changed, "In den Eingang" by hand with feedback, the automatic mode
// only for new messages (never the history) and only when switched on, the chat list, and the
// state of the page.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startContent, type ContentDeps } from './content-core';
import type { WorkerMessage } from './messages';
import { sha256Hex } from './payload';
import { OWN_ATTRIBUTE } from './selectors';
import { chatKey } from './settings';
import { MemoryStorage, showFixture } from './testing';

const ANNA = 'false_000000000@g.us_AAAA0000000000000001_000000001@c.us';
const at = (hours: number, minutes: number, seconds = 0) =>
	new Date(2026, 8, 28, hours, minutes, seconds).getTime();

let running: ReturnType<typeof startContent> | null = null;

function start(stored: Record<string, unknown> = {}, answer: unknown = { status: 'created' }) {
	const storage = new MemoryStorage(stored);
	const sent: WorkerMessage[] = [];
	const send = vi.fn(async (message: WorkerMessage) => {
		sent.push(message);
		return message.type === 'ingest' ? answer : { status: 'ok' };
	});
	const deps: ContentDeps = {
		document,
		storage,
		onStorageChanged: () => undefined,
		send,
		locale: 'de-DE',
		now: () => at(14, 40)
	};
	running = startContent(deps);
	const ingests = () =>
		sent.flatMap((message) => (message.type === 'ingest' ? [message.payload] : []));
	return { storage, send, sent, ingests, scan: running.scan };
}

function ownElements(): Element[] {
	return Array.from(document.querySelectorAll(`[${OWN_ATTRIBUTE}]`));
}

function buttonOf(id: string): HTMLButtonElement {
	const button = document.querySelector<HTMLButtonElement>(
		`[data-id="${id}"] [${OWN_ATTRIBUTE}] button`
	);
	if (button === null) throw new Error(`No button at ${id}`);
	return button;
}

beforeEach(() => {
	showFixture('chat-de.html');
});

afterEach(() => {
	running?.stop();
	running = null;
});

describe('by hand', () => {
	it('adds one own button per message with text and changes nothing else', async () => {
		const original = document.body.innerHTML;
		const { scan } = start();
		await scan();
		await scan();
		expect(ownElements()).toHaveLength(3);
		expect(
			document.querySelector(`[data-id$="0002_000000002@c.us"] [${OWN_ATTRIBUTE}]`)
		).toBeNull();
		for (const element of ownElements()) element.remove();
		expect(document.body.innerHTML).toBe(original);
	});

	it('sends a message with the hash of its ID and says what happened', async () => {
		const { scan, ingests } = start();
		await scan();
		const button = buttonOf(ANNA);
		expect(button.getAttribute('aria-label')).toBe(
			'In den Eingang: Nachricht von Anna Beispiel, 14:32'
		);
		expect(button.textContent).toBe('In den Eingang');
		button.click();
		await vi.waitFor(() => expect(button.textContent).toBe('Im Eingang'));
		const [payload] = ingests();
		expect(payload).toEqual({
			channel: 'whatsapp-web',
			mode: 'manual',
			text: 'Bitte Milch kaufen 🥛\nund Brot',
			sender: 'Anna Beispiel',
			chat: 'Familie Beispiel',
			sent_at: expect.stringMatching(/^2026-09-28T14:32:00[+-]\d{2}:\d{2}$/),
			external_id: `wa:${await sha256Hex(ANNA)}`
		});
		// No ID or number of WhatsApp leaves the browser.
		expect(JSON.stringify(payload)).not.toMatch(/c\.us|g\.us|000000001/);
		expect(button.parentElement?.querySelector('[role="status"]')?.textContent).toBe('Angelegt.');
	});

	it('reports a duplicate and a failure, and lets the user try again', async () => {
		const duplicate = start({}, { status: 'duplicate', state: 'discarded' });
		await duplicate.scan();
		buttonOf(ANNA).click();
		await vi.waitFor(() =>
			expect(buttonOf(ANNA).parentElement?.textContent).toContain('Schon da (verworfen).')
		);
		running?.stop();
		showFixture('chat-de.html');
		const failing = start(
			{},
			{ status: 'error', reason: 'unreachable', message: 'App nicht erreichbar.' }
		);
		await failing.scan();
		buttonOf(ANNA).click();
		await vi.waitFor(() => expect(buttonOf(ANNA).textContent).toBe('Erneut versuchen'));
		expect(buttonOf(ANNA).parentElement?.textContent).toContain('App nicht erreichbar.');
		buttonOf(ANNA).click();
		await vi.waitFor(() => expect(failing.ingests()).toHaveLength(2));
	});

	it('names a message whose entry moved into another area of the app (E7-4b, AR-4)', async () => {
		const moved = start({}, { status: 'duplicate', state: 'moved' });
		await moved.scan();
		buttonOf(ANNA).click();
		await vi.waitFor(() =>
			expect(buttonOf(ANNA).parentElement?.querySelector('[role="status"]')?.textContent).toBe(
				'In einen anderen Bereich verschoben.'
			)
		);
		expect(buttonOf(ANNA).parentElement?.textContent).not.toContain('Schon im Eingang.');
	});

	it('keeps keys and clicks of the button away from WhatsApp', async () => {
		const { scan } = start();
		await scan();
		const seen: string[] = [];
		const listener = (event: Event) => seen.push(event.type);
		for (const type of ['keydown', 'click', 'mousedown']) document.addEventListener(type, listener);
		const button = buttonOf(ANNA);
		button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		button.click();
		for (const type of ['keydown', 'click', 'mousedown'])
			document.removeEventListener(type, listener);
		expect(seen).toEqual([]);
	});
});

describe('automatically', () => {
	it('sends nothing while the switch is off', async () => {
		const { scan, ingests } = start();
		await scan();
		expect(ingests()).toEqual([]);
	});

	it('sends only messages from the switch on, as "auto", and remembers the last one', async () => {
		const { scan, ingests, storage } = start({ auto: true, autoSince: at(14, 34, 20) });
		await scan();
		expect(ingests().map((payload) => [payload.mode, payload.text])).toEqual([
			['auto', '#byl Rechnung Kindergarten'],
			['auto', 'Mache ich morgen']
		]);
		const key = await sha256Hex(chatKey('Familie Beispiel'));
		expect(storage.values.get('lastSeen')).toEqual({ [key]: at(14, 36) });

		// A new message arrives; the history is not sent again.
		const row = document.createElement('div');
		row.setAttribute('role', 'row');
		row.innerHTML =
			'<div data-id="false_000000000@g.us_AAAA0000000000000005_000000001@c.us"><div data-pre-plain-text="[14:41, 28.9.2026] Anna Beispiel: "><span dir="ltr">todo Kuchen backen</span></div></div>';
		document.querySelector('[role="application"]')?.append(row);
		await scan();
		expect(ingests().map((payload) => payload.text)).toEqual([
			'#byl Rechnung Kindergarten',
			'Mache ich morgen',
			'todo Kuchen backen'
		]);
		expect(storage.values.get('lastSeen')).toEqual({ [key]: at(14, 41) });
	});

	it('starts after the last message seen in the chat when the page loads again', async () => {
		const key = await sha256Hex(chatKey('Familie Beispiel'));
		const { scan, ingests } = start({
			auto: true,
			autoSince: at(9, 0),
			lastSeen: { [key]: at(14, 36) }
		});
		await scan();
		// The message of the same minute goes again; the app reports it as duplicate.
		expect(ingests().map((payload) => payload.text)).toEqual(['Mache ich morgen']);
	});

	it('keeps to the list of chats', async () => {
		const { scan, ingests } = start({ auto: true, autoSince: at(9, 0), chats: ['Verein Nord'] });
		await scan();
		expect(ingests()).toEqual([]);
	});

	it('tries a failed message again at the next change of the page', async () => {
		const { scan, ingests, send, sent } = start(
			{ auto: true, autoSince: at(14, 36) },
			{ status: 'error', reason: 'rate_limited', message: 'Zu viele Anfragen.' }
		);
		await scan();
		expect(ingests()).toHaveLength(1);
		send.mockImplementation(async (message: WorkerMessage) => {
			sent.push(message);
			return { status: 'created' };
		});
		await scan();
		expect(ingests()).toHaveLength(2);
		await scan();
		expect(ingests()).toHaveLength(2);
	});
});

describe('the state of the page', () => {
	it('reports it and adds nothing to a page it does not understand', async () => {
		showFixture('chat-changed.html');
		const original = document.body.innerHTML;
		const { scan, sent } = start({ auto: true, autoSince: at(9, 0) });
		await scan();
		expect(sent).toEqual([{ type: 'page-state', state: 'unknown' }]);
		expect(ownElements()).toEqual([]);
		expect(document.body.innerHTML).toBe(original);
	});

	it('reports a page it understands once', async () => {
		const { scan, sent } = start();
		await scan();
		await scan();
		expect(sent.filter((message) => message.type === 'page-state')).toEqual([
			{ type: 'page-state', state: 'ok' }
		]);
	});
});
