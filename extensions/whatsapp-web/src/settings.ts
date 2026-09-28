// Settings of the extension (ADR-0038 §3), kept in chrome.storage.local: the address of the app
// (only this machine), the access key, the switch "Automatisch (nur mit Stichwort)" with the time
// it was switched on, the optional chat list and, per chat, the time of the last message seen by
// the automatic mode. Pure: reading, checking and normalising values.

/** The address of the app as start.bat serves it (CLAUDE.md §3). */
export const DEFAULT_APP_URL = 'http://127.0.0.1:8090';

/**
 * Hosts of this machine, the same as host_permissions of manifest.json (every port); others are
 * refused while the platforms are postponed (ADR-0028).
 */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Shape of an access key of the own inbox (app/pb_hooks/lib/inbox-key-rules.js). */
export const TOKEN_PATTERN = /^byl_[A-Za-z0-9]{40}$/;

/** At most this many chats in the list and characters per name. */
export const CHATS_MAX = 50;
export const CHAT_NAME_MAX = 200;
/** Chats the automatic mode remembers a last message for. */
export const LAST_SEEN_MAX = 200;

/** Keys of chrome.storage.local. */
export const KEYS = {
	appUrl: 'appUrl',
	token: 'token',
	auto: 'auto',
	autoSince: 'autoSince',
	chats: 'chats',
	lastSeen: 'lastSeen'
} as const;

/** Keys the content script reads: never the key. */
export const CONTENT_KEYS: readonly string[] = [
	KEYS.auto,
	KEYS.autoSince,
	KEYS.chats,
	KEYS.lastSeen
];

export interface ConnectionSettings {
	appUrl: string;
	token: string;
}

export interface AutoSettings {
	auto: boolean;
	/** Time the switch was switched on (ms), 0 while off. */
	autoSince: number;
	chats: string[];
	/** Last message seen per chat (key: chatKey), time in ms. */
	lastSeen: Record<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The address as the extension stores it (origin without a slash), or an error text: only http
 * on this machine, any port, no user, path, query or fragment.
 */
export function normalizeAppUrl(input: string): { url: string } | { error: string } {
	const value = input.trim();
	const refused = {
		error:
			'Nur eine Adresse auf diesem Rechner, etwa http://127.0.0.1:8090 oder http://localhost:8090.'
	};
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return refused;
	}
	if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(url.hostname)) return refused;
	if (url.username !== '' || url.password !== '') return refused;
	if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') {
		return refused;
	}
	return { url: url.origin };
}

/** Why `token` is no access key, or null. */
export function tokenError(token: string): string | null {
	return TOKEN_PATTERN.test(token.trim())
		? null
		: 'Der Zugangsschlüssel beginnt mit byl_ und hat danach 40 Buchstaben und Ziffern.';
}

/** The stored connection; an invalid address counts as the default, an invalid key as none. */
export function connectionOf(stored: Record<string, unknown>): ConnectionSettings {
	const raw = typeof stored[KEYS.appUrl] === 'string' ? (stored[KEYS.appUrl] as string) : '';
	const url = normalizeAppUrl(raw);
	const token = typeof stored[KEYS.token] === 'string' ? (stored[KEYS.token] as string) : '';
	return {
		appUrl: 'url' in url ? url.url : DEFAULT_APP_URL,
		token: TOKEN_PATTERN.test(token) ? token : ''
	};
}

/** The list of chats from the text field: one name per line, trimmed, without duplicates. */
export function parseChatList(text: string): string[] {
	const seen = new Set<string>();
	const chats: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const name = line.trim().slice(0, CHAT_NAME_MAX);
		const key = chatKey(name);
		if (name === '' || seen.has(key)) continue;
		seen.add(key);
		chats.push(name);
		if (chats.length >= CHATS_MAX) break;
	}
	return chats;
}

/** Key of a chat name: trimmed, lower case, white space collapsed. */
export function chatKey(name: string): string {
	return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The stored settings of the automatic mode; invalid parts count as not set. */
export function autoOf(stored: Record<string, unknown>): AutoSettings {
	const chats = Array.isArray(stored[KEYS.chats])
		? parseChatList(
				(stored[KEYS.chats] as unknown[]).filter((entry) => typeof entry === 'string').join('\n')
			)
		: [];
	const lastSeen: Record<string, number> = {};
	const rawSeen = stored[KEYS.lastSeen];
	if (isRecord(rawSeen)) {
		for (const [key, value] of Object.entries(rawSeen)) {
			if (typeof value === 'number' && Number.isFinite(value)) lastSeen[key] = value;
		}
	}
	const auto = stored[KEYS.auto] === true;
	const since = stored[KEYS.autoSince];
	return {
		auto,
		autoSince: auto && typeof since === 'number' && Number.isFinite(since) ? since : 0,
		chats,
		lastSeen
	};
}

/** The map of last messages with `key` at `time`, keeping only the most recent LAST_SEEN_MAX. */
export function withLastSeen(
	lastSeen: Record<string, number>,
	key: string,
	time: number
): Record<string, number> {
	const next = { ...lastSeen, [key]: Math.max(lastSeen[key] ?? 0, time) };
	const entries = Object.entries(next).sort((a, b) => b[1] - a[1]);
	return Object.fromEntries(entries.slice(0, LAST_SEEN_MAX));
}
