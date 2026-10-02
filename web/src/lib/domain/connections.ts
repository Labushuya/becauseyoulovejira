// Connections of the channels (ADR-0016 section 2, ADR-0018, ADR-0020; E4 plan packages 10, 13, 20 and 22;
// Notion since ADR-0041).
// Pure: types, labels and the checks of the form. Access data are Windows user environment variables; a
// connection stores only their names. The name pattern mirrors app/pb_hooks/lib/secrets.js
// and the mail settings mirror app/pb_hooks/lib/connection-rules.js
// (tests/unit/web-connections.test.mjs compares both).

export const CONNECTION_TYPES = ['calendar', 'telegram', 'mail', 'notion'] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CONNECTION_TYPE_LABELS: Readonly<Record<ConnectionType, string>> = Object.freeze({
	calendar: 'Google Calendar',
	telegram: 'Telegram-Bot',
	mail: 'Postfach (IMAP)',
	notion: 'Notion'
});

/**
 * Whether a kind fetches by itself and through "Jetzt abrufen" (ADR-0016) and takes keywords.
 * Notion only imports lists on request (ADR-0041): no run, no keywords.
 */
export function fetchesAutomatically(type: ConnectionType): boolean {
	return type !== 'notion';
}

/** Mail providers; host, port and TLS follow from the provider in byl-mail.exe (ADR-0016 section 4). */
export const MAIL_PROVIDERS = ['webde', 'gmail'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export const MAIL_PROVIDER_LABELS: Readonly<Record<MailProvider, string>> = Object.freeze({
	webde: 'Web.de',
	gmail: 'Gmail'
});

/** Suggested variable for the password (Gmail: the app password) per provider. */
export const MAIL_PROVIDER_SECRET_NAMES: Readonly<Record<MailProvider, string>> = Object.freeze({
	webde: 'BYL_WEBDE_PASSWORD',
	gmail: 'BYL_GMAIL_PASSWORD'
});

export const MAIL_USER_MAX_LENGTH = 254;

/** User name of a mailbox: 1 to 254 characters without white space or control characters. */
export function isMailUser(value: string): boolean {
	return (
		value.length > 0 &&
		value.length <= MAIL_USER_MAX_LENGTH &&
		// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
		!/[\s\u0000-\u001f\u007f]/.test(value)
	);
}

export function isMailProvider(value: unknown): value is MailProvider {
	return typeof value === 'string' && (MAIL_PROVIDERS as readonly string[]).includes(value);
}

/** "BYL_" plus capital letters, digits and "_", at most 64 characters (ADR-0018 section 1). */
export const SECRET_NAME_PATTERN = /^BYL_[A-Z0-9_]{1,60}$/;

/** Suggested names of the variables per kind. */
export const DEFAULT_SECRET_NAMES: Readonly<Record<ConnectionType, string>> = Object.freeze({
	calendar: 'BYL_GOOGLE_CALENDAR_URL',
	telegram: 'BYL_TELEGRAM_TOKEN',
	mail: MAIL_PROVIDER_SECRET_NAMES.webde,
	notion: 'BYL_NOTION_TOKEN'
});
export const DEFAULT_ALLOWLIST_NAME = 'BYL_TELEGRAM_ALLOWED_IDS';

/**
 * The suggested name of a variable that no connection uses yet: `base`, else `base_2`, `base_3`
 * and so on (ADR-0041, addendum of 2026-10-01). Following the assistant for a second connection of
 * a kind must not overwrite the secret of the first one with `setx`.
 */
export function freeVariableName(base: string, taken: readonly string[]): string {
	const used = new Set(taken);
	if (!used.has(base)) return base;
	let number = 2;
	while (used.has(`${base}_${number}`)) number += 1;
	return `${base}_${number}`;
}

export const LABEL_MAX_LENGTH = 100;

export interface Connection {
	id: string;
	type: ConnectionType;
	label: string;
	enabled: boolean;
	/** Name of the variable with the secret (iCal address, bot token). */
	secretEnv: string;
	/** Telegram: name of the variable with the allowed chat or user IDs; '' otherwise. */
	allowlistEnv: string;
	lastRunAt: string | null;
	lastOkAt: string | null;
	/** Cleaned error of the last run (no secrets, ADR-0018 section 5); '' after a good run. */
	lastError: string;
	/** Setup hint of the last run, e.g. the ID of a chat that is not allowed yet. */
	lastHint: string;
	/** Keywords (ADR-0020): only what one of them matches comes into the inbox automatically. */
	keywords: string[];
	/**
	 * Telegram: whether the bot confirms a saved entry in the chat (ADR-0016, addendum of
	 * 2026-10-01); true for other kinds and for a connection from before the switch.
	 */
	replySaved: boolean;
	/** Telegram: whether the bot answers a message without keyword; true for other kinds. */
	replyNoMatch: boolean;
	/** Mail: provider and user name of the mailbox ('' for other kinds). */
	mailProvider: MailProvider | '';
	mailUser: string;
	/** Mail: whether headers and the whole text are searched as well (ADR-0020, addendum 2). */
	matchBody: boolean;
	/** Mail: state of the full scan of the inbox (ADR-0020, addendum 3); null before the first. */
	scan?: MailScan | null;
	runningSince: string | null;
	/**
	 * Target project of the new entries (ADR-0049), null without one. The data layer always sets
	 * it; objects built by hand may leave it out.
	 */
	targetProjectId?: string | null;
	/**
	 * Whether the server knows the target project (migration 1790203100); until then the card shows
	 * the restart hint instead of the setting. Absent counts as known.
	 */
	targetReady?: boolean;
	created: string;
	updated: string;
}

/**
 * State of the full scan of an inbox (connections.scan, written by the mail helper): running,
 * paused at the limit of new entries per run, done, cancelled by the user, or interrupted by an
 * error (it goes on with the next run).
 */
export interface MailScan {
	state: 'running' | 'paused' | 'done' | 'cancelled' | 'error';
	/** Mails checked and mails in the scan. */
	done: number;
	total: number;
	/** Entries the scan created so far. */
	created: number;
	/** The server could not search the text; the mails were loaded instead. */
	fallback: boolean;
}

const MAIL_SCAN_STATES: readonly MailScan['state'][] = [
	'running',
	'paused',
	'done',
	'cancelled',
	'error'
];

function scanCount(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** The scan state of a connection record (connections.scan), or null for none or a broken one. */
export function mailScanOf(value: unknown): MailScan | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const stored = value as Record<string, unknown>;
	const state = MAIL_SCAN_STATES.find((item) => item === stored.state);
	if (state === undefined) return null;
	return {
		state,
		done: scanCount(stored.done),
		total: scanCount(stored.total),
		created: scanCount(stored.created),
		fallback: stored.fallback === true
	};
}

/** A count with a dot between thousands, as German texts write it ("4.800"). */
export function formatCount(value: number): string {
	return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Line "Posteingang" of the card of a mailbox, e.g. "wird durchsucht: 1.200/4.800". */
export function mailScanText(scan: MailScan): string {
	const progress = `${formatCount(scan.done)}/${formatCount(scan.total)}`;
	const created = `${formatCount(scan.created)} ${scan.created === 1 ? 'Eintrag' : 'Einträge'}`;
	switch (scan.state) {
		case 'running':
			return `wird durchsucht: ${progress}`;
		case 'paused':
			return `pausiert bei ${progress}, bisher ${created} übernommen`;
		case 'done':
			return `durchsucht: ${formatCount(scan.total)} ${scan.total === 1 ? 'Mail' : 'Mails'}, ${created} übernommen`;
		case 'cancelled':
			return `abgebrochen bei ${progress}`;
		case 'error':
			return `unterbrochen bei ${progress}, geht beim nächsten Abruf weiter`;
	}
}

/**
 * Answer of "Posteingang neu durchsuchen" and "Abbrechen" (POST /api/byl/connections/{id}/scan):
 * started, another fetch is running, cancelling or cancelled, nothing to cancel, the mail helper
 * does not run, the connection is paused, or an error with the message.
 */
export interface ScanResult {
	status:
		| 'started'
		| 'running'
		| 'cancelling'
		| 'cancelled'
		| 'idle'
		| 'unavailable'
		| 'disabled'
		| 'error';
	message: string;
}

/** Text and tone of the flag after a scan action; only a real error is an error (ADR-0009). */
export function scanResultText(
	label: string,
	result: ScanResult
): { text: string; tone: 'success' | 'info' | 'error' } {
	const name = `„${label}“`;
	switch (result.status) {
		case 'started':
			return { text: `${name}: Der Posteingang wird durchsucht.`, tone: 'info' };
		case 'running':
			return { text: `${name} ruft gerade ab. Bitte gleich noch einmal versuchen.`, tone: 'info' };
		case 'cancelling':
		case 'cancelled':
			return { text: `${name}: Das Durchsuchen wird abgebrochen.`, tone: 'success' };
		case 'idle':
			return { text: `${name}: Es wird gerade nichts durchsucht.`, tone: 'info' };
		case 'disabled':
			return { text: `${name} ist pausiert.`, tone: 'info' };
		case 'unavailable':
			return { text: `${name}: ${result.message}`, tone: 'info' };
		case 'error':
			return { text: `${name}: ${result.message || 'Durchsuchen fehlgeschlagen.'}`, tone: 'error' };
	}
}

/** Whether the variables are set in the environment of the running server. */
export interface SecretStatus {
	secret: boolean;
	/** null for kinds without an allowlist. */
	allowlist: boolean | null;
}

/** The settings a user changes on an existing connection. */
export interface ConnectionSettingsDraft {
	keywords: string[];
	/** Telegram only; ignored for other kinds. */
	replySaved: boolean;
	/** Telegram only; ignored for other kinds. */
	replyNoMatch: boolean;
	/** Mail only; ignored for other kinds. */
	matchBody: boolean;
}

/** The settings of a connection as they are; a change replaces only its own part. */
export function settingsDraftOf(connection: Connection): ConnectionSettingsDraft {
	return {
		keywords: connection.keywords,
		replySaved: connection.replySaved,
		replyNoMatch: connection.replyNoMatch,
		matchBody: connection.matchBody
	};
}

/**
 * The answers of a Telegram bot in the chat (ADR-0016, addendum of 2026-10-01): the same texts as
 * app/pb_hooks/lib/channel-telegram.js (tests/unit/web-connections.test.mjs compares them).
 */
export const TELEGRAM_CONFIRMATION = 'Im Eingang gespeichert';
export const TELEGRAM_NO_MATCH = 'Kein Stichwort erkannt – nicht gespeichert';

/** Names of the two switches of a Telegram connection, each with the text the bot sends. */
export const TELEGRAM_REPLY_SAVED_LABEL = `Bestätigung senden („${TELEGRAM_CONFIRMATION}“)`;
export const TELEGRAM_REPLY_NO_MATCH_LABEL = `Hinweis bei fehlendem Stichwort senden („${TELEGRAM_NO_MATCH}“)`;

/** The honest note next to the switches: the answers are messages in the chat. */
export const TELEGRAM_REPLIES_HINT =
	'Der Bot schreibt diese Antworten in den Chat; in Gruppen sehen sie alle Mitglieder.';

/** A change of one of the two answers of a Telegram bot. */
export type TelegramRepliesChange = { replySaved: boolean } | { replyNoMatch: boolean };

/** What the flag says after a switch of the answers changed (named after the connection). */
export function telegramRepliesAnnouncement(label: string, change: TelegramRepliesChange): string {
	const name = `„${label}“`;
	if ('replySaved' in change) {
		return change.replySaved
			? `${name} bestätigt gespeicherte Nachrichten im Chat.`
			: `${name} bestätigt gespeicherte Nachrichten nicht mehr im Chat.`;
	}
	return change.replyNoMatch
		? `${name} antwortet auf Nachrichten ohne Stichwort.`
		: `${name} antwortet nicht mehr auf Nachrichten ohne Stichwort.`;
}

/** Shown at a connection without keywords (ADR-0020 section 4); neutral, not an error. */
export const NO_KEYWORDS_WARNING =
	'Keine Stichwörter: Diese Verbindung übernimmt nichts automatisch.';

/**
 * What a mailbox takes automatically (user decision of 2026-09-27; ADR-0020, addendum 3): the whole
 * inbox is searched, at the first run, after every change of the keywords and on request; other
 * folders never.
 */
export const MAIL_INBOX_HINT =
	'Der gesamte Posteingang wird durchsucht (nicht Papierkorb/Spam/Gesendet).';

/** Where the keywords of a kind are searched (ADR-0020 section 1 and addendum 2). */
export const KEYWORD_SEARCH_TEXT: Readonly<Record<ConnectionType, string>> = Object.freeze({
	calendar: 'Gesucht wird in Titel und Beschreibung der Termine.',
	telegram: 'Gesucht wird im Text der Nachricht bzw. in der Bildunterschrift.',
	mail: 'Gesucht wird in Betreff und Absender (Name und Adresse), mit „Betreff, Absender, Kopfzeilen und Text durchsuchen“ (Standard) auch in den Kopfzeilen (An, Cc, Antwort an, Liste, Organisation) und im ganzen Text. Neue Stichwörter gelten auch für ältere Mails im Posteingang.',
	notion: 'Notion hat keine Stichwörter: Übernommen wird nur, was du im Import auswählst.'
});

export interface ConnectionDraft {
	type: ConnectionType;
	label: string;
	secretEnv: string;
	allowlistEnv: string;
	/** Mail only. */
	mailProvider: MailProvider;
	mailUser: string;
}

export function isConnectionType(value: unknown): value is ConnectionType {
	return typeof value === 'string' && (CONNECTION_TYPES as readonly string[]).includes(value);
}

export function isSecretName(value: string): boolean {
	return SECRET_NAME_PATTERN.test(value);
}

export function emptyConnectionDraft(type: ConnectionType = 'calendar'): ConnectionDraft {
	return {
		type,
		label: CONNECTION_TYPE_LABELS[type],
		secretEnv: DEFAULT_SECRET_NAMES[type],
		allowlistEnv: type === 'telegram' ? DEFAULT_ALLOWLIST_NAME : '',
		mailProvider: 'webde',
		mailUser: ''
	};
}

/**
 * The draft with another mail provider. Variable and label follow the provider as long as they are
 * still the suggestion of the provider before (or empty); what the user typed stays.
 */
export function withMailProvider(draft: ConnectionDraft, provider: MailProvider): ConnectionDraft {
	const secretEnv = draft.secretEnv.trim();
	const label = draft.label.trim();
	const suggestedLabels = [
		'',
		CONNECTION_TYPE_LABELS.mail,
		MAIL_PROVIDER_LABELS[draft.mailProvider]
	];
	return {
		...draft,
		mailProvider: provider,
		secretEnv:
			secretEnv === '' || secretEnv === MAIL_PROVIDER_SECRET_NAMES[draft.mailProvider]
				? MAIL_PROVIDER_SECRET_NAMES[provider]
				: draft.secretEnv,
		label: suggestedLabels.includes(label) ? MAIL_PROVIDER_LABELS[provider] : draft.label
	};
}

export const SECRET_NAME_MESSAGE =
	'Nur BYL_ mit Großbuchstaben, Ziffern und _, höchstens 64 Zeichen (etwa BYL_TELEGRAM_TOKEN).';

export const MAIL_USER_MESSAGE =
	'Benutzername des Postfachs (meist die E-Mail-Adresse), ohne Leerzeichen, höchstens 254 Zeichen.';

export type ConnectionDraftField = 'label' | 'secretEnv' | 'allowlistEnv' | 'mailUser';

/**
 * Texts of the name of a connection (ADR-0026, addendum KK-3), word for word those of the hook
 * (MESSAGES in app/pb_hooks/lib/connection-rules.js, parity test web-connections.test.mjs).
 */
export const CONNECTION_LABEL_MESSAGES = Object.freeze({
	validation_connection_label: 'Bitte einen Namen eingeben.',
	validation_connection_label_max: 'Höchstens 100 Zeichen.',
	validation_connection_rename_only:
		'Beim Umbenennen ändert sich nur der Name; andere Einstellungen bitte getrennt speichern.'
});

/** Error of a new name: empty after trimming, or longer than LABEL_MAX_LENGTH; null if fine. */
export function labelError(label: string): string | null {
	const value = label.trim();
	if (value === '') return CONNECTION_LABEL_MESSAGES.validation_connection_label;
	return value.length > LABEL_MAX_LENGTH
		? CONNECTION_LABEL_MESSAGES.validation_connection_label_max
		: null;
}

/** Neutral note while the new name equals that of another connection (allowed, KK-3). */
export const SAME_LABEL_HINT =
	'Eine andere Verbindung heißt auch so. Das ist erlaubt; ein eindeutiger Name hilft beim Wiederfinden.';

/** SAME_LABEL_HINT when `label` equals one of `others` (case and white space at the ends aside). */
export function sameLabelHint(label: string, others: readonly string[]): string | null {
	const value = label.trim().toLowerCase();
	if (value === '') return null;
	return others.some((other) => other.trim().toLowerCase() === value) ? SAME_LABEL_HINT : null;
}

/** Flag after renaming: „Gmail“ heißt jetzt „Gmail Arbeit“. */
export function renamedText(before: string, after: string): string {
	return `„${before}“ heißt jetzt „${after}“.`;
}

/** The name of a connection as the inbox and the sources of a ticket show it (KK-3). */
export interface ConnectionName {
	id: string;
	label: string;
}

/**
 * The channel of an entry with the name of its connection, e.g. "Mail · Gmail Arbeit"; the channel
 * alone without a name or when the name says nothing more ("Notion" of a connection "Notion").
 */
export function withConnectionName(channel: string, name: string | null): string {
	const value = name?.trim() ?? '';
	if (value === '' || value.toLowerCase() === channel.toLowerCase()) return channel;
	return `${channel} · ${value}`;
}

/** Field errors of the form; empty if the draft is fine. */
export function connectionDraftErrors(
	draft: ConnectionDraft
): Partial<Record<ConnectionDraftField, string>> {
	const errors: Partial<Record<ConnectionDraftField, string>> = {};
	const label = draft.label.trim();
	if (label === '') errors.label = 'Pflichtfeld.';
	else if (label.length > LABEL_MAX_LENGTH) errors.label = 'Höchstens 100 Zeichen.';
	if (!isSecretName(draft.secretEnv.trim())) errors.secretEnv = SECRET_NAME_MESSAGE;
	if (draft.type === 'telegram' && !isSecretName(draft.allowlistEnv.trim())) {
		errors.allowlistEnv = SECRET_NAME_MESSAGE;
	}
	if (draft.type === 'mail' && !isMailUser(draft.mailUser.trim()))
		errors.mailUser = MAIL_USER_MESSAGE;
	return errors;
}

/**
 * State of the access data as text (ADR-0018 section 4): set, or which variable is missing and
 * what to do. null while the status is unknown.
 */
export function secretStatusText(
	connection: Pick<Connection, 'secretEnv' | 'allowlistEnv'>,
	status: SecretStatus | null
): { ok: boolean; text: string } | null {
	if (status === null) return null;
	const missing = [
		status.secret ? null : connection.secretEnv,
		status.allowlist === false ? connection.allowlistEnv : null
	].filter((name): name is string => name !== null);
	if (missing.length === 0) return { ok: true, text: 'Zugangsdaten gesetzt.' };
	const names = missing.join(' und ');
	const variable = missing.length === 1 ? 'Variable' : 'Variablen';
	return {
		ok: false,
		text: `Zugangsdaten fehlen: ${variable} ${names} anlegen, dann die App neu starten (neu-starten.bat).`
	};
}

/**
 * Answer of "Jetzt abrufen" (E4 plan, package 15): the counts of the run or why it did not run.
 * "unavailable": the mail helper that fetches a mailbox does not run (package A, item 4).
 */
export interface RunResult {
	status: 'ok' | 'error' | 'running' | 'missing' | 'disabled' | 'unsupported' | 'unavailable';
	created: number;
	duplicates: number;
	updated: number;
	skipped: number;
	failed: number;
	/** Not saved because no keyword matched (ADR-0020). */
	unmatched: number;
	/** Cleaned error of the run (no secrets). */
	error: string;
	/** Names of the variables that are not set. */
	missing: string[];
}

/** Counts of a good run, e.g. "3 neu, 1 schon vorhanden". */
export function runCounts(result: RunResult): string {
	const parts = [`${result.created} neu`];
	if (result.duplicates > 0) parts.push(`${result.duplicates} schon vorhanden`);
	if (result.updated > 0) parts.push(`${result.updated} aktualisiert`);
	if (result.skipped > 0) parts.push(`${result.skipped} übersprungen`);
	if (result.failed > 0) parts.push(`${result.failed} mit Fehler`);
	if (result.unmatched > 0) parts.push(`${result.unmatched} ohne Stichwort`);
	return parts.join(', ');
}

/** Text of a run for the live region, e.g. "„Kalender“: 3 neu, 1 schon vorhanden." */
export function runResultText(label: string, result: RunResult): string {
	const name = `„${label}“`;
	switch (result.status) {
		case 'ok':
			return `${name}: ${runCounts(result)}.`;
		case 'error':
			return `${name}: Abruf fehlgeschlagen. ${result.error}`;
		case 'running':
			return `${name} ruft gerade ab. Bitte gleich noch einmal versuchen.`;
		case 'missing':
			return `${name}: Zugangsdaten fehlen (${result.missing.join(', ')}). Variable anlegen, dann die App neu starten.`;
		case 'disabled':
			return `${name} ist pausiert.`;
		case 'unsupported':
			return `${name}: Diese Art ruft noch nicht ab.`;
		case 'unavailable':
			return `${name}: ${result.error}`;
	}
}

/**
 * Line "Ergebnis" of a card: the answer of "Jetzt abrufen" on this page if there is one, else what
 * the connection knows of its last run (counts are not stored). null before the first run.
 */
export function lastResultText(
	connection: Pick<Connection, 'lastRunAt' | 'lastError'>,
	lastRun: RunResult | null
): string | null {
	if (lastRun !== null) {
		switch (lastRun.status) {
			case 'ok':
				return runCounts(lastRun);
			case 'error':
				return 'fehlgeschlagen';
			case 'running':
				return 'ein Abruf lief schon';
			case 'missing':
				return 'Zugangsdaten fehlen';
			case 'disabled':
				return 'pausiert';
			case 'unsupported':
				return 'ruft nicht ab';
			case 'unavailable':
				return 'Hilfsprozess läuft nicht';
		}
	}
	if (connection.lastRunAt === null) return null;
	return connection.lastError === '' ? 'ohne Fehler' : 'fehlgeschlagen';
}

/** Whether the mail helper runs (GET /api/byl/mail-helper, package A item 4). */
export interface MailHelperStatus {
	/**
	 * "refused": it runs, but with another token than the app; "outdated": it runs in a version
	 * before 0.5.0 without "Jetzt abrufen" (a restart starts the new one).
	 */
	state: 'running' | 'stopped' | 'refused' | 'outdated';
	version: string;
	message: string;
}

/** Line "Hilfsprozess" of the card of a mailbox; null while the probe runs. */
export function mailHelperText(status: MailHelperStatus | null): string {
	if (status === null) return 'wird geprüft …';
	switch (status.state) {
		case 'running':
			return status.version === '' ? 'läuft' : `läuft (byl-mail ${status.version})`;
		case 'stopped':
			return 'läuft nicht. Mit einer eingeschalteten Postfach-Verbindung startet start.bat bzw. neu-starten.bat ihn mit.';
		case 'refused':
			return 'läuft, kennt aber den Zugang der App nicht (BYL_INGEST_TOKEN). Bitte neu-starten.bat.';
		case 'outdated':
			return 'läuft in einer älteren Version ohne „Jetzt abrufen“. Bitte neu-starten.bat.';
	}
}
