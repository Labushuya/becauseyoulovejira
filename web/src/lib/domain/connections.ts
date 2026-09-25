// Connections of the channels (ADR-0016 section 2, ADR-0018; E4 plan package 10). Pure: types,
// labels and the checks of the form. Access data are Windows user environment variables; a
// connection stores only their names. The name pattern mirrors app/pb_hooks/lib/secrets.js
// (tests/unit/web-connections.test.mjs compares both).

export const CONNECTION_TYPES = ['calendar', 'telegram'] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CONNECTION_TYPE_LABELS: Readonly<Record<ConnectionType, string>> = Object.freeze({
	calendar: 'Google Calendar',
	telegram: 'Telegram-Bot'
});

/** "BYL_" plus capital letters, digits and "_", at most 64 characters (ADR-0018 section 1). */
export const SECRET_NAME_PATTERN = /^BYL_[A-Z0-9_]{1,60}$/;

/** Suggested names of the variables per kind. */
export const DEFAULT_SECRET_NAMES: Readonly<Record<ConnectionType, string>> = Object.freeze({
	calendar: 'BYL_GOOGLE_CALENDAR_URL',
	telegram: 'BYL_TELEGRAM_TOKEN'
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

export interface ConnectionDraft {
	type: ConnectionType;
	label: string;
	secretEnv: string;
	allowlistEnv: string;
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
		allowlistEnv: type === 'telegram' ? DEFAULT_ALLOWLIST_NAME : ''
	};
}

export const SECRET_NAME_MESSAGE =
	'Nur BYL_ mit Großbuchstaben, Ziffern und _, höchstens 64 Zeichen (etwa BYL_TELEGRAM_TOKEN).';

/** Field errors of the form: label, secretEnv and allowlistEnv; empty if the draft is fine. */
export function connectionDraftErrors(
	draft: ConnectionDraft
): Partial<Record<'label' | 'secretEnv' | 'allowlistEnv', string>> {
	const errors: Partial<Record<'label' | 'secretEnv' | 'allowlistEnv', string>> = {};
	const label = draft.label.trim();
	if (label === '') errors.label = 'Pflichtfeld.';
	else if (label.length > LABEL_MAX_LENGTH) errors.label = 'Höchstens 100 Zeichen.';
	if (!isSecretName(draft.secretEnv.trim())) errors.secretEnv = SECRET_NAME_MESSAGE;
	if (draft.type === 'telegram' && !isSecretName(draft.allowlistEnv.trim())) {
		errors.allowlistEnv = SECRET_NAME_MESSAGE;
	}
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
