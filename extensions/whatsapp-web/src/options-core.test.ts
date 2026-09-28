// Settings page and popup (ADR-0038 §3): address only on this machine, the key stored but never
// shown again, "Verbindung testen", the switch off by default with its start time, the chat list
// and the state of WhatsApp Web.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestResult } from './api';
import type { WorkerMessage } from './messages';
import { NO_PAGE_TEXT, PAGE_STATE_TEXT, startOptions, testText } from './options-core';
import { MemoryStorage } from './testing';

const TOKEN = `byl_${'Ab12'.repeat(10)}`;
const PAGE = readFileSync(join(import.meta.dirname, '..', 'static', 'options.html'), 'utf8');

function byId<T extends HTMLElement>(id: string): T {
	return document.getElementById(id) as T;
}

async function open(
	stored: Record<string, unknown> = {},
	session: Record<string, unknown> = {},
	result: TestResult = { status: 'ok', name: 'Laptop', keywords: 2 }
) {
	document.body.innerHTML = new DOMParser().parseFromString(PAGE, 'text/html').body.innerHTML;
	const local = new MemoryStorage(stored);
	const send = vi.fn(async (message: WorkerMessage) => (message.type === 'test' ? result : null));
	await startOptions({
		document,
		local,
		session: new MemoryStorage(session),
		send,
		now: () => 5_000
	});
	return { local, send };
}

/** Submits the form and waits until `done` holds. */
async function submit(done: () => boolean) {
	byId<HTMLFormElement>('connection').requestSubmit();
	await vi.waitFor(() => expect(done()).toBe(true));
}

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('connection', () => {
	it('starts with the address of the app and the switch off', async () => {
		await open();
		expect(byId<HTMLInputElement>('app-url').value).toBe('http://127.0.0.1:8090');
		expect(byId<HTMLInputElement>('token').placeholder).toBe('byl_…');
		expect(byId<HTMLInputElement>('auto').checked).toBe(false);
		expect(byId('page-status').textContent).toBe(NO_PAGE_TEXT);
		expect(byId('app-status').textContent).toBe('Noch nicht geprüft.');
	});

	it('refuses another host and a malformed key at their fields', async () => {
		const { local, send } = await open();
		byId<HTMLInputElement>('app-url').value = 'http://192.168.1.10:8090';
		await submit(() => byId('app-url').getAttribute('aria-invalid') === 'true');
		const url = byId<HTMLInputElement>('app-url');
		expect(url.getAttribute('aria-invalid')).toBe('true');
		expect(url.getAttribute('aria-describedby')).toBe('app-url-hint app-url-error');
		expect(byId('app-url-error').hidden).toBe(false);
		expect(document.activeElement).toBe(url);

		url.value = 'http://localhost:9000';
		byId<HTMLInputElement>('token').value = 'byl_kurz';
		await submit(() => byId('token').getAttribute('aria-invalid') === 'true');
		expect(url.getAttribute('aria-invalid')).toBeNull();
		expect(byId('token-error').textContent).toMatch(/beginnt mit byl_/);
		expect(local.values.size).toBe(0);
		expect(send).not.toHaveBeenCalled();
	});

	it('stores address and key, shows only the start of the key and tests the connection', async () => {
		const { local, send } = await open();
		byId<HTMLInputElement>('app-url').value = 'http://localhost:9000/';
		byId<HTMLInputElement>('token').value = ` ${TOKEN} `;
		await submit(() => (byId('app-status').textContent ?? '').includes('Laptop'));
		expect(local.values.get('appUrl')).toBe('http://localhost:9000');
		expect(local.values.get('token')).toBe(TOKEN);
		expect(byId<HTMLInputElement>('token').value).toBe('');
		expect(byId<HTMLInputElement>('token').placeholder).toBe('gespeichert (byl_Ab12…)');
		expect(document.body.textContent).not.toContain(TOKEN);
		expect(send).toHaveBeenCalledWith({ type: 'test' });
		expect(byId('app-status').textContent).toBe(
			'Verbunden mit dem Schlüssel „Laptop“. Stichwörter für WhatsApp Web: 2.'
		);
	});

	it('keeps the stored key when the field stays empty and removes it on request', async () => {
		const { local } = await open({ token: TOKEN });
		await submit(() => byId('saved').textContent === 'Gespeichert.');
		expect(local.values.get('token')).toBe(TOKEN);
		byId<HTMLButtonElement>('forget').click();
		await vi.waitFor(() => expect(byId<HTMLInputElement>('token').placeholder).toBe('byl_…'));
		expect(local.values.has('token')).toBe(false);
		expect(byId('saved').textContent).toBe('Zugangsschlüssel entfernt.');
	});

	it('says what the test found', async () => {
		expect(testText({ status: 'ok', name: 'Laptop', keywords: 0 })).toContain('Keine Stichwörter');
		await open(
			{ token: TOKEN },
			{},
			{ status: 'error', reason: 'unreachable', message: 'App nicht erreichbar.' }
		);
		byId<HTMLButtonElement>('test').click();
		await vi.waitFor(() => expect(byId('app-status').textContent).toBe('App nicht erreichbar.'));
	});
});

describe('automatic mode', () => {
	it('stores the time the switch was switched on, and nothing while off', async () => {
		const { local } = await open();
		const auto = byId<HTMLInputElement>('auto');
		auto.click();
		await vi.waitFor(() => expect(local.values.get('auto')).toBe(true));
		expect(local.values.get('autoSince')).toBe(5_000);
		auto.click();
		await vi.waitFor(() => expect(local.values.get('auto')).toBe(false));
		expect(local.values.get('autoSince')).toBe(0);
	});

	it('stores the list of chats', async () => {
		const { local } = await open({ chats: ['Familie'] });
		const chats = byId<HTMLTextAreaElement>('chats');
		expect(chats.value).toBe('Familie');
		chats.value = 'Familie\n\nVerein Nord\nfamilie';
		chats.dispatchEvent(new Event('change'));
		await vi.waitFor(() => expect(local.values.get('chats')).toEqual(['Familie', 'Verein Nord']));
		expect(byId('auto-saved').textContent).toBe('Automatisch gilt nur für 2 Chats.');
	});
});

describe('state of WhatsApp Web', () => {
	it('names the last state a tab reported', async () => {
		await open({}, { pageState: { state: 'unknown', at: new Date(2026, 8, 28, 14, 5).getTime() } });
		expect(byId('page-status').textContent).toBe(`${PAGE_STATE_TEXT.unknown} (Stand 14:05)`);
		expect(PAGE_STATE_TEXT.unknown).toBe(
			'Seitenstruktur nicht erkannt – Erweiterung braucht ein Update.'
		);
		expect(PAGE_STATE_TEXT.ok).toBe('WhatsApp Web erkannt.');
	});
});
