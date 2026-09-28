// Messages to the service worker (ADR-0038 §3). The content script asks it to send an entry and
// reports the state of the page; the settings page asks for "Verbindung testen". Only the
// service worker reads the key and talks to the app.

import { isIngestPayload, type IngestPayload } from './payload';
import type { PageState } from './extract';

export type WorkerMessage =
	| { type: 'ingest'; payload: IngestPayload }
	| { type: 'page-state'; state: PageState }
	| { type: 'test' };

/** Key of chrome.storage.session with the last state a WhatsApp Web tab reported. */
export const PAGE_STATE_KEY = 'pageState';

export interface StoredPageState {
	state: PageState;
	/** Time of the report in ms. */
	at: number;
}

const PAGE_STATES: readonly PageState[] = ['ok', 'waiting', 'unknown'];

/** The message if it has one of the known shapes, else null. */
export function workerMessageOf(value: unknown): WorkerMessage | null {
	if (typeof value !== 'object' || value === null) return null;
	const message = value as Record<string, unknown>;
	if (message.type === 'test') return { type: 'test' };
	if (message.type === 'ingest' && isIngestPayload(message.payload)) {
		return { type: 'ingest', payload: message.payload };
	}
	if (message.type === 'page-state' && PAGE_STATES.includes(message.state as PageState)) {
		return { type: 'page-state', state: message.state as PageState };
	}
	return null;
}

/** The stored state of the page, or null. */
export function storedPageStateOf(value: unknown): StoredPageState | null {
	if (typeof value !== 'object' || value === null) return null;
	const stored = value as Record<string, unknown>;
	if (!PAGE_STATES.includes(stored.state as PageState) || typeof stored.at !== 'number') {
		return null;
	}
	return { state: stored.state as PageState, at: stored.at };
}
