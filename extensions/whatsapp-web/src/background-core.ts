// Logic of the service worker (ADR-0038 §3): the only part of the extension that reads the key
// and talks to the app. It answers messages of its own content script on WhatsApp Web (send an
// entry, report the state of the page) and of its own settings page (test the connection);
// everything else is ignored.

import { sendEntry, testConnection, type IngestResult, type TestResult } from './api';
import { PAGE_STATE_KEY, workerMessageOf } from './messages';
import { KEYS, connectionOf } from './settings';

export const WHATSAPP_ORIGIN = 'https://web.whatsapp.com/';

export interface WorkerDeps {
	local: chrome.storage.StorageArea;
	session: chrome.storage.StorageArea;
	fetch: (input: string, init: RequestInit) => Promise<Response>;
	extensionId: string;
	now: () => number;
}

export type WorkerAnswer = IngestResult | TestResult | { status: 'ok' } | null;

async function connection(deps: WorkerDeps) {
	return connectionOf(await deps.local.get([KEYS.appUrl, KEYS.token]));
}

/** Answer to one message; null for anything that does not come from this extension. */
export async function handleMessage(
	raw: unknown,
	sender: chrome.runtime.MessageSender,
	deps: WorkerDeps
): Promise<WorkerAnswer> {
	if (sender.id !== deps.extensionId) return null;
	const message = workerMessageOf(raw);
	if (message === null) return null;
	const url = sender.url ?? '';
	const fromWhatsApp = url.startsWith(WHATSAPP_ORIGIN);
	const fromSettings = url.startsWith(`chrome-extension://${deps.extensionId}/`);
	switch (message.type) {
		case 'ingest':
			if (!fromWhatsApp) return null;
			return sendEntry(deps.fetch, await connection(deps), message.payload);
		case 'page-state':
			if (!fromWhatsApp) return null;
			await deps.session.set({ [PAGE_STATE_KEY]: { state: message.state, at: deps.now() } });
			return { status: 'ok' };
		case 'test':
			if (!fromSettings) return null;
			return testConnection(deps.fetch, await connection(deps));
	}
}
