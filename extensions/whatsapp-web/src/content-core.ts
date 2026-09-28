// Content script on WhatsApp Web (ADR-0038 §3). It reads the open chat and adds exactly one own
// element per message with text: the button "In den Eingang" with its status. Nothing else of
// the page changes; the extension never sends, clicks or edits anything in WhatsApp. With the
// switch "Automatisch (nur mit Stichwort)" new messages go to the app as "auto", where only a
// keyword of the channel lets them in. The key never reaches this script: the service worker
// sends.

import type { IngestResult } from './api';
import { autoAllowed, autoThreshold, isNewMessage } from './auto';
import {
	chatTitle,
	messageElements,
	pageState,
	readMessage,
	type ChatMessage,
	type PageState
} from './extract';
import type { WorkerMessage } from './messages';
import { payloadOf, sha256Hex, type Mode } from './payload';
import { OWN_ATTRIBUTE } from './selectors';
import { CONTENT_KEYS, KEYS, autoOf, chatKey, withLastSeen, type AutoSettings } from './settings';

export interface ContentDeps {
	document: Document;
	storage: chrome.storage.StorageArea;
	onStorageChanged: (
		listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
	) => void;
	send: (message: WorkerMessage) => Promise<unknown>;
	locale: string;
	now: () => number;
}

/** Wait after changes of the page before it is read again. */
export const SCAN_DELAY_MS = 300;
/** A page without chat list counts as unknown after this time (extract.ts). */
const SETTLE_MS = 31_000;

type ButtonState = 'idle' | 'sending' | 'done' | 'error';

const LABELS: Readonly<Record<ButtonState, string>> = {
	idle: 'In den Eingang',
	sending: 'Wird gesendet …',
	done: 'Im Eingang',
	error: 'Erneut versuchen'
};

function resultOf(answer: unknown): IngestResult {
	if (typeof answer === 'object' && answer !== null && 'status' in answer) {
		return answer as IngestResult;
	}
	return {
		status: 'error',
		reason: 'unreachable',
		message: 'Die Erweiterung wurde neu geladen. Bitte WhatsApp Web neu laden (F5).'
	};
}

/** Text of the status next to the button after a send. */
export function statusText(result: IngestResult): string {
	switch (result.status) {
		case 'created':
			return 'Angelegt.';
		case 'duplicate':
			return result.state === 'discarded' ? 'Schon da (verworfen).' : 'Schon im Eingang.';
		case 'filtered':
			return 'Kein Stichwort – nicht übernommen.';
		case 'error':
			return result.message;
	}
}

function nameOf(message: ChatMessage): string {
	const who = message.outgoing
		? 'eigene Nachricht'
		: `Nachricht von ${message.sender || 'unbekannt'}`;
	const at =
		message.time === null
			? ''
			: `, ${new Date(message.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
	return `In den Eingang: ${who}${at}`;
}

export function startContent(deps: ContentDeps): { scan: () => Promise<void>; stop: () => void } {
	const doc = deps.document;
	const startedAt = deps.now();
	let settings: AutoSettings = autoOf({});
	let lastState: PageState | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let scanning: Promise<void> | null = null;
	let again = false;
	let stopped = false;
	// IDs the automatic mode has decided on in this tab (sent or older than the threshold).
	const considered = new Set<string>();

	async function loadSettings() {
		settings = autoOf(await deps.storage.get([...CONTENT_KEYS]));
	}

	async function send(message: ChatMessage, mode: Mode): Promise<IngestResult> {
		try {
			return resultOf(await deps.send({ type: 'ingest', payload: await payloadOf(message, mode) }));
		} catch {
			return resultOf(null);
		}
	}

	function setButton(own: Element, state: ButtonState, status: string) {
		own.setAttribute('data-state', state);
		const button = own.querySelector('button');
		const output = own.querySelector('[role="status"]');
		if (button !== null) {
			button.textContent = LABELS[state];
			button.setAttribute('aria-disabled', state === 'sending' ? 'true' : 'false');
		}
		if (output !== null) output.textContent = status;
	}

	function ensureButton(message: ChatMessage) {
		const element = message.element;
		if (Array.from(element.children).some((child) => child.hasAttribute(OWN_ATTRIBUTE))) return;
		const own = doc.createElement('span');
		own.setAttribute(OWN_ATTRIBUTE, '');
		own.className = 'byl-wa';
		const button = doc.createElement('button');
		button.type = 'button';
		button.className = 'byl-wa-button';
		button.setAttribute('aria-label', nameOf(message));
		button.title = 'In den Eingang von becauseyoulovejira übernehmen';
		const output = doc.createElement('span');
		output.className = 'byl-wa-status';
		output.setAttribute('role', 'status');
		own.append(button, output);
		setButton(own, 'idle', '');
		// WhatsApp must not see these events (no selection, no menu, no shortcut).
		for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'pointerdown', 'dblclick']) {
			own.addEventListener(type, (event) => event.stopPropagation());
		}
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (own.getAttribute('data-state') === 'sending') return;
			const current = readMessage(element, chatTitle(doc), deps.locale) ?? message;
			setButton(own, 'sending', '');
			void send(current, 'manual').then((result) => {
				const done = result.status === 'created' || result.status === 'duplicate';
				setButton(own, done ? 'done' : 'error', statusText(result));
			});
		});
		element.append(own);
	}

	async function maybeAuto(message: ChatMessage) {
		if (!autoAllowed(settings, message.chat)) return;
		const key = await sha256Hex(chatKey(message.chat));
		const threshold = autoThreshold(settings.autoSince, settings.lastSeen[key]);
		if (!isNewMessage(message.time, threshold)) return;
		const result = await send(message, 'auto');
		if (result.status === 'error') {
			// Tried again at the next change of the page (e.g. after a pause because of 429).
			considered.delete(message.id);
			return;
		}
		settings = { ...settings, lastSeen: withLastSeen(settings.lastSeen, key, message.time ?? 0) };
		await deps.storage.set({ [KEYS.lastSeen]: settings.lastSeen });
		const own = Array.from(message.element.children).find((child) =>
			child.hasAttribute(OWN_ATTRIBUTE)
		);
		if (own !== undefined && result.status !== 'filtered') {
			setButton(own, 'done', `Automatisch: ${statusText(result)}`);
		}
	}

	async function scanOnce() {
		await ready;
		const state = pageState(doc, deps.now() - startedAt);
		if (state !== lastState) {
			lastState = state;
			void deps.send({ type: 'page-state', state }).catch(() => undefined);
		}
		if (state !== 'ok') return;
		const chat = chatTitle(doc);
		for (const element of messageElements(doc)) {
			const message = readMessage(element, chat, deps.locale);
			if (message === null) continue;
			ensureButton(message);
			if (considered.has(message.id)) continue;
			considered.add(message.id);
			await maybeAuto(message);
		}
	}

	/** Reads the page; a call during a running scan runs once more afterwards. */
	async function scan(): Promise<void> {
		if (scanning !== null) {
			again = true;
			return scanning;
		}
		scanning = (async () => {
			do {
				again = false;
				await scanOnce();
			} while (again && !stopped);
		})().finally(() => {
			scanning = null;
		});
		return scanning;
	}

	function schedule() {
		if (stopped) return;
		clearTimeout(timer);
		timer = setTimeout(() => void scan(), SCAN_DELAY_MS);
	}

	// Without the settings a scan would count every message as seen with the switch off.
	const ready = loadSettings().catch(() => undefined);
	const observer = new MutationObserver(schedule);
	observer.observe(doc.body, { childList: true, subtree: true });
	deps.onStorageChanged((changes, area) => {
		if (area === 'local' && CONTENT_KEYS.some((key) => key in changes)) {
			void loadSettings().then(schedule);
		}
	});
	const settle = setTimeout(schedule, SETTLE_MS);
	void ready.then(schedule);

	return {
		scan,
		stop() {
			stopped = true;
			observer.disconnect();
			clearTimeout(timer);
			clearTimeout(settle);
		}
	};
}
