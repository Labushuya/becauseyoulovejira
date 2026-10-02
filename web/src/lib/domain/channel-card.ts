// Texts of the channel cards (ADR-0026, addendum of 2026-09-30, plan kanal-karten KK-2): the one
// info line of each card, the relative time in it and the state of the cards without a
// connection (own inbox, WhatsApp Web). Pure: the card passes the current time.

import { addDays, berlinToday } from './berlin-date';
import { lastResultText, mailScanText, type Connection, type RunResult } from './connections';
import { berlinDateOf, formatBerlinDateTime } from './format';
import type { InboxKey } from './inbox-keys';
import { importedSummary, type NotionImportedSource } from './notion';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** State of a card as lozenge; "danger" only for a real error (ADR-0009). */
export interface CardStatus {
	label: string;
	tone: 'neutral' | 'brand' | 'danger' | 'muted';
	icon: 'refresh' | 'pause' | 'pending' | 'error' | 'check' | 'warning';
}

/** The states the user approved for every card (spec of 2026-09-30), besides a running request. */
export const CARD_STATUS = Object.freeze({
	connected: { label: 'Verbunden', tone: 'brand', icon: 'check' },
	paused: { label: 'Pausiert', tone: 'muted', icon: 'pause' },
	error: { label: 'Fehler', tone: 'danger', icon: 'error' },
	setup: { label: 'Einrichtung offen', tone: 'neutral', icon: 'pending' },
	restart: { label: 'Neustart nötig', tone: 'neutral', icon: 'warning' }
} satisfies Record<string, CardStatus>);

/**
 * A point in time as the cards say it: "gerade eben", "vor 5 Min.", "heute, 10:15",
 * "gestern, 18:02", else "25.09.2026 10:15". A time in the future (another clock) is "gerade eben".
 */
export function relativeTime(timestamp: string, now: number): string {
	const full = formatBerlinDateTime(timestamp);
	const age = now - Date.parse(timestamp.replace(' ', 'T'));
	if (age < MINUTE_MS) return 'gerade eben';
	if (age < HOUR_MS) return `vor ${Math.floor(age / MINUTE_MS)} Min.`;
	const time = full.slice(-5);
	const day = berlinDateOf(timestamp);
	const today = berlinToday(now);
	if (day === today) return `heute, ${time}`;
	if (day === addDays(today, -1)) return `gestern, ${time}`;
	return full;
}

/**
 * Info line of a connection that fetches by itself (calendar, Telegram, mailbox), e.g.
 * "Zuletzt abgerufen vor 5 Min. · 3 neu, 1 schon vorhanden". While the inbox of a mailbox is
 * searched, the line says how far.
 */
export function connectionInfo(
	connection: Pick<Connection, 'type' | 'lastRunAt' | 'lastError' | 'scan'>,
	lastRun: RunResult | null,
	now: number
): string {
	const scan = connection.type === 'mail' ? (connection.scan ?? null) : null;
	if (scan?.state === 'running') return `Posteingang ${mailScanText(scan)}`;
	const last =
		connection.lastRunAt === null
			? 'Noch nie abgerufen'
			: `Zuletzt abgerufen ${relativeTime(connection.lastRunAt, now)}`;
	const result = lastResultText(connection, lastRun);
	return result === null ? last : `${last} · ${result}`;
}

/**
 * Info line of a GitHub connection (ADR-0050 §7), e.g. "3 Repositorys · Zuletzt abgerufen vor
 * 5 Min. · 1 neu"; without a repository "Noch kein Repository".
 */
export function githubInfo(
	connection: Pick<Connection, 'type' | 'lastRunAt' | 'lastError' | 'scan' | 'github'>,
	lastRun: RunResult | null,
	now: number
): string {
	const repos = connection.github?.repos.length ?? 0;
	if (repos === 0) return 'Noch kein Repository';
	const count = repos === 1 ? '1 Repository' : `${repos} Repositorys`;
	return `${count} · ${connectionInfo(connection, lastRun, now)}`;
}

/** Info line of a Notion connection, e.g. "8 Einträge aus 2 Quellen übernommen · zuletzt …". */
export function notionInfo(
	imports: readonly NotionImportedSource[] | null,
	lastRunAt: string | null,
	now: number
): string {
	const taken =
		imports === null
			? 'Übernommene Listen werden geladen …'
			: imports.length === 0
				? 'Noch nichts übernommen'
				: `${importedSummary(imports)} übernommen`;
	return lastRunAt === null
		? taken
		: `${taken} · zuletzt abgerufen ${relativeTime(lastRunAt, now)}`;
}

/** Info line of the own inbox, e.g. "2 Schlüssel, zuletzt benutzt vor 5 Min.". */
export function inboxKeysInfo(keys: readonly Pick<InboxKey, 'lastUsedAt'>[], now: number): string {
	if (keys.length === 0) return 'Noch kein Zugangsschlüssel';
	const count = keys.length === 1 ? '1 Schlüssel' : `${keys.length} Schlüssel`;
	const used = keys
		.map((key) => key.lastUsedAt)
		.filter((at): at is string => at !== null)
		.sort();
	const last = used.at(-1);
	return last === undefined
		? `${count}, noch nie benutzt`
		: `${count}, zuletzt benutzt ${relativeTime(last, now)}`;
}

/**
 * State of the own inbox: before the migration a restart, a failed load an error, without a
 * key or before any program used one the setup is open, else connected. null while loading.
 */
export function inboxKeysStatus(
	state: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable',
	keys: readonly Pick<InboxKey, 'lastUsedAt'>[]
): CardStatus | null {
	if (state === 'unavailable') return CARD_STATUS.restart;
	if (state === 'error') return CARD_STATUS.error;
	if (state !== 'ready') return null;
	return keys.some((key) => key.lastUsedAt !== null) ? CARD_STATUS.connected : CARD_STATUS.setup;
}

/**
 * State of WhatsApp Web, as far as the app can see it (ADR-0038 §4): the app does not see the
 * extension in the browser. It knows a restart is due before the migration of the own inbox,
 * and that the setup is open without a key or without a built extension. Otherwise it says
 * nothing (null) rather than claim a connection.
 */
export function whatsAppWebStatus(
	state: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable' | null,
	keyCount: number,
	built: boolean | null
): CardStatus | null {
	if (state === 'unavailable') return CARD_STATUS.restart;
	if (built === false) return CARD_STATUS.setup;
	if (state === 'ready' && keyCount === 0) return CARD_STATUS.setup;
	return null;
}
