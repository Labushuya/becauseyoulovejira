// Connections of the channels (ADR-0016 section 2, ADR-0018, ADR-0020; E4 plan packages 10, 13, 20 and 22).
// Pure: types, labels and the checks of the form. Access data are Windows user environment variables; a
// connection stores only their names. The name pattern mirrors app/pb_hooks/lib/secrets.js
// and the mail settings mirror app/pb_hooks/lib/connection-rules.js
// (tests/unit/web-connections.test.mjs compares both).

export const CONNECTION_TYPES = ['calendar', 'telegram', 'mail'] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CONNECTION_TYPE_LABELS: Readonly<Record<ConnectionType, string>> = Object.freeze({
	calendar: 'Google Calendar',
	telegram: 'Telegram-Bot',
	mail: 'Postfach (IMAP)'
});

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
	mail: MAIL_PROVIDER_SECRET_NAMES.webde
});
export const DEFAULT_ALLOWLIST_NAME = 'BYL_TELEGRAM_ALLOWED_IDS';

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
	/** Telegram: whether the bot answers a message without keyword; true for other kinds. */
	replyNoMatch: boolean;
	/** Mail: provider and user name of the mailbox ('' for other kinds). */
	mailProvider: MailProvider | '';
	mailUser: string;
	/** Mail: whether the first 500 characters of the text are searched as well (ADR-0020). */
	matchBody: boolean;
	runningSince: string | null;
	created: string;
	updated: string;
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
	replyNoMatch: boolean;
	/** Mail only; ignored for other kinds. */
	matchBody: boolean;
}

/** Shown at a connection without keywords (ADR-0020 section 4); neutral, not an error. */
export const NO_KEYWORDS_WARNING =
	'Keine Stichwörter: Diese Verbindung übernimmt nichts automatisch.';

/** Where the keywords of a kind are searched (ADR-0020 section 1). */
export const KEYWORD_SEARCH_TEXT: Readonly<Record<ConnectionType, string>> = Object.freeze({
	calendar: 'Gesucht wird in Titel und Beschreibung der Termine.',
	telegram: 'Gesucht wird im Text der Nachricht bzw. in der Bildunterschrift.',
	mail: 'Gesucht wird im Betreff, auf Wunsch auch in den ersten 500 Zeichen des Textes.'
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
		text: `Zugangsdaten fehlen: ${variable} ${names} anlegen, dann die App neu starten (stop.bat, dann start.bat).`
	};
}

/** Answer of "Jetzt abrufen" (E4 plan, package 15): the counts of the run or why it did not run. */
export interface RunResult {
	status: 'ok' | 'error' | 'running' | 'missing' | 'disabled' | 'unsupported';
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

/** Text of a run for the live region, e.g. "„Kalender“: 3 neu, 1 schon vorhanden." */
export function runResultText(label: string, result: RunResult): string {
	const name = `„${label}“`;
	switch (result.status) {
		case 'ok': {
			const parts = [`${result.created} neu`];
			if (result.duplicates > 0) parts.push(`${result.duplicates} schon vorhanden`);
			if (result.updated > 0) parts.push(`${result.updated} aktualisiert`);
			if (result.skipped > 0) parts.push(`${result.skipped} übersprungen`);
			if (result.failed > 0) parts.push(`${result.failed} mit Fehler`);
			if (result.unmatched > 0) parts.push(`${result.unmatched} ohne Stichwort`);
			return `${name}: ${parts.join(', ')}.`;
		}
		case 'error':
			return `${name}: Abruf fehlgeschlagen. ${result.error}`;
		case 'running':
			return `${name} ruft gerade ab. Bitte gleich noch einmal versuchen.`;
		case 'missing':
			return `${name}: Zugangsdaten fehlen (${result.missing.join(', ')}). Variable anlegen, dann die App neu starten.`;
		case 'disabled':
			return `${name} ist ausgeschaltet.`;
		case 'unsupported':
			return `${name}: Diese Art ruft noch nicht ab.`;
	}
}
