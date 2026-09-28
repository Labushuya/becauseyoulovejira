// Settings page and popup of the extension (ADR-0038 §3): address of the app (only this
// machine), access key, "Verbindung testen", the switch "Automatisch (nur mit Stichwort)"
// (off by default) with the optional chat list, and the state of WhatsApp Web and of the app. The
// key is stored in chrome.storage.local and never shown again; the field stays empty.

import type { TestResult } from './api';
import type { PageState } from './extract';
import { PAGE_STATE_KEY, storedPageStateOf, type WorkerMessage } from './messages';
import {
	DEFAULT_APP_URL,
	KEYS,
	autoOf,
	connectionOf,
	normalizeAppUrl,
	parseChatList,
	tokenError
} from './settings';

export interface OptionsDeps {
	document: Document;
	local: chrome.storage.StorageArea;
	session: chrome.storage.StorageArea;
	send: (message: WorkerMessage) => Promise<unknown>;
	now: () => number;
}

export const PAGE_STATE_TEXT: Readonly<Record<PageState, string>> = Object.freeze({
	ok: 'WhatsApp Web erkannt.',
	waiting: 'WhatsApp Web lädt oder ist nicht angemeldet.',
	unknown: 'Seitenstruktur nicht erkannt – Erweiterung braucht ein Update.'
});

export const NO_PAGE_TEXT =
	'Noch keine Rückmeldung. Öffne web.whatsapp.com in einem Tab (oder lade ihn neu).';

/** Text of the app state after "Verbindung testen". */
export function testText(result: TestResult): string {
	if (result.status !== 'ok') return result.message;
	const keywords =
		result.keywords === 0
			? 'Keine Stichwörter für WhatsApp Web: „Automatisch“ übernimmt nichts, „In den Eingang“ schon.'
			: `Stichwörter für WhatsApp Web: ${result.keywords}.`;
	return `Verbunden mit dem Schlüssel „${result.name}“. ${keywords}`;
}

function element<T extends HTMLElement>(doc: Document, id: string): T {
	const found = doc.getElementById(id);
	if (found === null) throw new Error(`Missing #${id}`);
	return found as T;
}

function time(ms: number): string {
	return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export async function startOptions(deps: OptionsDeps): Promise<void> {
	const doc = deps.document;
	const form = element<HTMLFormElement>(doc, 'connection');
	const url = element<HTMLInputElement>(doc, 'app-url');
	const token = element<HTMLInputElement>(doc, 'token');
	const urlError = element<HTMLElement>(doc, 'app-url-error');
	const tokenErrorText = element<HTMLElement>(doc, 'token-error');
	const saved = element<HTMLElement>(doc, 'saved');
	const test = element<HTMLButtonElement>(doc, 'test');
	const forget = element<HTMLButtonElement>(doc, 'forget');
	const auto = element<HTMLInputElement>(doc, 'auto');
	const chats = element<HTMLTextAreaElement>(doc, 'chats');
	const autoSaved = element<HTMLElement>(doc, 'auto-saved');
	const pageStatus = element<HTMLElement>(doc, 'page-status');
	const appStatus = element<HTMLElement>(doc, 'app-status');

	/** Field error below the field, named by aria-describedby after the hint of the field. */
	function showError(input: HTMLInputElement, output: HTMLElement, text: string | null) {
		output.hidden = text === null;
		output.textContent = text ?? '';
		const hint = `${input.id}-hint`;
		input.setAttribute('aria-describedby', text === null ? hint : `${hint} ${output.id}`);
		if (text === null) input.removeAttribute('aria-invalid');
		else input.setAttribute('aria-invalid', 'true');
	}

	async function showStoredToken() {
		const connection = connectionOf(await deps.local.get([KEYS.appUrl, KEYS.token]));
		token.value = '';
		token.placeholder =
			connection.token === '' ? 'byl_…' : `gespeichert (${connection.token.slice(0, 8)}…)`;
		forget.disabled = connection.token === '';
	}

	async function runTest() {
		appStatus.textContent = 'Wird geprüft …';
		let answer: unknown;
		try {
			answer = await deps.send({ type: 'test' });
		} catch {
			answer = null;
		}
		appStatus.textContent =
			typeof answer === 'object' && answer !== null && 'status' in answer
				? testText(answer as TestResult)
				: 'Die Erweiterung antwortet nicht. Bitte die Seite neu öffnen.';
	}

	async function showPageState() {
		const stored = storedPageStateOf((await deps.session.get(PAGE_STATE_KEY))[PAGE_STATE_KEY]);
		pageStatus.textContent =
			stored === null
				? NO_PAGE_TEXT
				: `${PAGE_STATE_TEXT[stored.state]} (Stand ${time(stored.at)})`;
	}

	const stored = await deps.local.get([KEYS.appUrl, KEYS.auto, KEYS.autoSince, KEYS.chats]);
	url.value = connectionOf(stored).appUrl;
	const autoSettings = autoOf(stored);
	auto.checked = autoSettings.auto;
	chats.value = autoSettings.chats.join('\n');
	await showStoredToken();
	await showPageState();

	form.addEventListener('submit', (event) => {
		event.preventDefault();
		void (async () => {
			saved.textContent = '';
			const address = normalizeAppUrl(url.value === '' ? DEFAULT_APP_URL : url.value);
			const key = token.value.trim();
			const keyError = key === '' ? null : tokenError(key);
			showError(url, urlError, 'error' in address ? address.error : null);
			showError(token, tokenErrorText, keyError);
			if ('error' in address) {
				url.focus();
				return;
			}
			if (keyError !== null) {
				token.focus();
				return;
			}
			const items: Record<string, unknown> = { [KEYS.appUrl]: address.url };
			if (key !== '') items[KEYS.token] = key;
			await deps.local.set(items);
			url.value = address.url;
			await showStoredToken();
			saved.textContent = 'Gespeichert.';
			await runTest();
		})();
	});

	test.addEventListener('click', () => void runTest());

	forget.addEventListener('click', () => {
		void (async () => {
			await deps.local.remove(KEYS.token);
			await showStoredToken();
			saved.textContent = 'Zugangsschlüssel entfernt.';
			appStatus.textContent = 'Noch nicht geprüft.';
		})();
	});

	auto.addEventListener('change', () => {
		void (async () => {
			const on = auto.checked;
			await deps.local.set({ [KEYS.auto]: on, [KEYS.autoSince]: on ? deps.now() : 0 });
			autoSaved.textContent = on
				? 'Automatisch ist an: neue Nachrichten mit Stichwort kommen in den Eingang.'
				: 'Automatisch ist aus.';
		})();
	});

	chats.addEventListener('change', () => {
		void (async () => {
			const list = parseChatList(chats.value);
			await deps.local.set({ [KEYS.chats]: list });
			chats.value = list.join('\n');
			autoSaved.textContent =
				list.length === 0
					? 'Automatisch gilt für alle Chats.'
					: `Automatisch gilt nur für ${list.length === 1 ? 'einen Chat' : `${list.length} Chats`}.`;
		})();
	});
}
