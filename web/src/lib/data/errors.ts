// Error kinds of the data layer (ADR-0006 section 4). Errors are recognised by their structure
// (`status`, `isAbort`, `response`) instead of `instanceof ClientResponseError`, because the
// root integration tests and the web app each load their own copy of the SDK.

import { ACCOUNT_MESSAGES } from '../domain/accounts';
import { SCOPE_FIELD_MESSAGES, SCOPE_MESSAGE } from '../domain/area';
import { PIN_MESSAGES } from '../domain/comments';
import { CONNECTION_LABEL_MESSAGES } from '../domain/connections';
import { DAY_PLAN_MESSAGES, DAY_PLAN_SCOPE_TEXT } from '../domain/day-plan';
import { DUPLICATE_MESSAGES } from '../domain/duplicate';
import { FOLDER_MESSAGES } from '../domain/folders';
import { GITHUB_MESSAGES } from '../domain/github';
import { INBOX_KEY_MESSAGES } from '../domain/inbox-keys';
import { TICKET_PIN_MESSAGES } from '../domain/pins';
import { PROJECT_PARENT_MESSAGES } from '../domain/project-tree';
import {
	RECURRENCE_MESSAGES,
	openInstanceMessage,
	reopenOlderMessage
} from '../domain/recurrence-rule';
import { SUBTASK_MESSAGES, openChildrenMessage } from '../domain/subtasks';
import { TARGET_MESSAGES } from '../domain/target-project';
import { TICKET_SOURCE_MESSAGES, cycleMessage, cyclePathOf } from '../domain/ticket-origins';
import { unreachableHint } from '../domain/context';
import { TRASH_MESSAGES } from '../domain/trash';
import { currentCapabilities } from './context';

export type DataErrorKind =
	'aborted' | 'network' | 'not_found' | 'forbidden' | 'validation' | 'session' | 'server';

export interface FieldError {
	/** Validation code of the server, e.g. `validation_required`. */
	code: string;
	/** German text for the field. */
	message: string;
	/** Details of the server (e.g. state and ticket key of a duplicate, ADR-0014 section 3). */
	params?: Readonly<Record<string, unknown>>;
}

/**
 * German default texts per kind; the UI may use more specific ones. "network" names start.bat only
 * for the administrator on the machine of the app (KOB-1, ADR-0057).
 */
export const DATA_ERROR_MESSAGES: Readonly<Record<DataErrorKind, string>> = Object.freeze({
	aborted: 'Die Anfrage wurde abgebrochen.',
	get network(): string {
		return `Server nicht erreichbar. ${unreachableHint(currentCapabilities())}`;
	},
	not_found: 'Nicht gefunden. Der Eintrag wurde gelöscht oder ist nicht sichtbar.',
	forbidden: 'Dafür fehlt die Berechtigung.',
	validation: 'Bitte die markierten Eingaben prüfen.',
	session: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.',
	server: 'Der Server hat mit einem Fehler geantwortet. Bitte später erneut versuchen.'
});

const FIELD_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_required: 'Pflichtfeld.',
	validation_max_text_constraint: 'Zu lang.',
	validation_min_text_constraint: 'Zu kurz.',
	validation_length_out_of_range: 'Länge nicht zulässig.',
	validation_invalid_value: 'Ungültiger Wert.',
	validation_calendar_date: 'Ungültiges Datum.',
	validation_invalid_date: 'Ungültiges Datum.',
	// A reference across the border of an area (E7-3, ADR-0059 §4), the same text as the hook.
	validation_scope_mismatch: SCOPE_MESSAGE,
	validation_connection_private_only: 'Verbindungen gibt es nur im privaten Bereich.',
	// Unique indexes, e.g. projects(scope, code) and tags(scope, name COLLATE NOCASE).
	validation_not_unique: 'Schon vergeben.',
	validation_invalid_format: 'Ungültiges Format.',
	// Hook codes (E1 plan, OF-6 and OF-14; E3 plan, T-11).
	validation_reserved_code: 'Der Code TASK ist reserviert.',
	validation_project_in_use: 'Das Projekt wird von Tickets verwendet.',
	validation_project_archived: 'Das Projekt ist archiviert.',
	// Inbox and ticket source (ADR-0014; E4 plan, package 1).
	validation_inbox_duplicate: 'Schon im Eingang.',
	validation_inbox_immutable: 'Lässt sich nach dem Eingang nicht ändern.',
	validation_inbox_transition: 'Dieser Zustandswechsel ist nicht erlaubt.',
	validation_inbox_item_handled: 'Dieser Eintrag wurde schon bearbeitet.',
	validation_inbox_ticket_required: 'Zum Zuordnen fehlt das Ticket.',
	// Sources of a ticket (ADR-0031 sections 2 and 3), the same texts as the hook.
	validation_inbox_primary_source:
		'Die Hauptquelle bleibt bei dem Ticket, das aus ihr entstanden ist; sie lässt sich weder lösen noch verschieben.',
	validation_inbox_item_linked:
		'Dieser Eintrag ist die Quelle eines Tickets und lässt sich nicht löschen.',
	validation_invalid_url: 'Nur http- und https-Adressen.',
	validation_source_not_allowed: 'Diese Quelle lässt sich nicht direkt setzen.',
	validation_source_immutable: 'Die Quelle eines Tickets lässt sich nicht ändern.',
	// Guard against overwriting the description (ADR-0032 section 6), the same text as the hook.
	validation_description_stale: 'Die Beschreibung wurde inzwischen geändert.',
	// Connections (ADR-0018; E4 plan, package 10).
	validation_secret_name:
		'Nur BYL_ mit Großbuchstaben, Ziffern und _, höchstens 64 Zeichen (etwa BYL_TELEGRAM_TOKEN).',
	validation_connection_type: 'Diese Verbindungsart gibt es noch nicht.',
	validation_connection_immutable: 'Die Art einer Verbindung lässt sich nicht ändern.',
	validation_connection_server_field: 'Dieses Feld setzt nur der Server.',
	validation_connection_settings: 'Unbekannte Einstellung.',
	validation_keywords: 'Stichwörter: höchstens 50, je 1 bis 100 Zeichen, ohne Zeilenumbruch.',
	// The name of a connection (ADR-0026, addendum KK-3), the same texts as the hook.
	...CONNECTION_LABEL_MESSAGES,
	// Recurrence rules (ADR-0021 to ADR-0023; E5 plan, package 4), the same texts as the hook.
	...RECURRENCE_MESSAGES,
	// Sub-tasks (ADR-0033), the same texts as the hook.
	...SUBTASK_MESSAGES,
	// Sub projects (ADR-0034), the same texts as the hook.
	...PROJECT_PARENT_MESSAGES,
	// Trash (ADR-0037), the same texts as the hook.
	...TRASH_MESSAGES,
	// Access keys of the own inbox (ADR-0038), the same texts as the hook.
	...INBOX_KEY_MESSAGES,
	// The pinned comment (ADR-0044), the same texts as the hook.
	...PIN_MESSAGES,
	// Pinned tickets (ADR-0064), the same texts as the hook.
	...TICKET_PIN_MESSAGES,
	// "Ticket duplizieren" (ADR-0045), the same texts as the hook.
	...DUPLICATE_MESSAGES,
	// Target projects (ADR-0049), the GitHub channel (ADR-0050) and the folders (ADR-0051), the same
	// texts as the hooks.
	...TARGET_MESSAGES,
	...GITHUB_MESSAGES,
	...FOLDER_MESSAGES,
	validation_connection_secret_none: 'Diese Verbindungsart braucht keine Zugangsdaten.',
	// Accounts and the administrator of the app (ADR-0056), the same texts as the hooks.
	validation_connection_admin_only:
		'Kanäle mit Zugangsdaten und Ordner richtet nur der Verwalter der App ein.',
	...ACCOUNT_MESSAGES,
	// The day plan (ADR-0065), the same texts as the hook.
	...DAY_PLAN_MESSAGES,
	// Tickets as sources (ADR-0067), the same texts as the hook; a circle names its chain below.
	...TICKET_SOURCE_MESSAGES
});

/** Texts that depend on the field as well, keyed by `<field>:<code>`; they win over the above. */
const FIELD_CODE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'code:validation_invalid_format': 'Nur 2 bis 6 Großbuchstaben (A–Z).',
	'code:validation_project_in_use': 'Der Code bleibt fest, weil Tickets das Projekt verwenden.',
	'id:validation_project_in_use':
		'Ein Projekt mit Tickets lässt sich nicht löschen. Bitte archivieren.',
	'ticket:validation_scope_mismatch': 'Das Ticket ist nicht verfügbar.',
	'source_item:validation_scope_mismatch': 'Der Eintrag ist nicht verfügbar.',
	// Taking suggestions of another area into a day plan (ADR-0065).
	'tickets:validation_scope_mismatch': DAY_PLAN_SCOPE_TEXT,
	// Per field (E7-3, ADR-0059 §4): what lies in another area.
	...Object.fromEntries(
		Object.entries(SCOPE_FIELD_MESSAGES).map(([field, text]) => [
			`${field}:validation_scope_mismatch`,
			text
		])
	)
});
const DEFAULT_FIELD_MESSAGE = 'Ungültige Eingabe.';

function fieldMessage(field: string, code: string): string {
	const specific = `${field}:${code}`;
	if (Object.hasOwn(FIELD_CODE_MESSAGES, specific)) {
		return FIELD_CODE_MESSAGES[specific] ?? DEFAULT_FIELD_MESSAGE;
	}
	return Object.hasOwn(FIELD_MESSAGES, code)
		? (FIELD_MESSAGES[code] ?? DEFAULT_FIELD_MESSAGE)
		: DEFAULT_FIELD_MESSAGE;
}

export class DataError extends Error {
	readonly kind: DataErrorKind;
	/** HTTP status, 0 without a response. */
	readonly status: number;
	/** Field errors of a validation error, keyed by field name. */
	readonly fields: Readonly<Record<string, FieldError>>;

	constructor(
		kind: DataErrorKind,
		options: { status?: number; fields?: Record<string, FieldError>; cause?: unknown } = {}
	) {
		super(DATA_ERROR_MESSAGES[kind], { cause: options.cause });
		this.name = 'DataError';
		this.kind = kind;
		this.status = options.status ?? 0;
		this.fields = Object.freeze({ ...options.fields });
	}
}

export function isDataError(error: unknown): error is DataError {
	return error instanceof DataError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isAbortLike(error: Record<string, unknown>): boolean {
	return error.isAbort === true || error.name === 'AbortError';
}

/** Field errors from `response.data` of a PocketBase error response. */
function fieldErrorsOf(response: unknown): Record<string, FieldError> {
	const data = isRecord(response) ? response.data : undefined;
	const fields: Record<string, FieldError> = {};
	if (!isRecord(data)) return fields;
	for (const [field, detail] of Object.entries(data)) {
		const code = isRecord(detail) && typeof detail.code === 'string' ? detail.code : '';
		const params = isRecord(detail) && isRecord(detail.params) ? { ...detail.params } : undefined;
		// Reopening with an edited follow-up or an older instance names the open ticket (ADR-0023
		// section 3 and addendum 4); completing with open blocking sub-tasks names their number
		// (ADR-0033 section 2).
		// A refused circle of source tickets names its chain (ADR-0067 §3).
		const key = typeof params?.key === 'string' ? params.key : null;
		const path = code === 'validation_ticket_source_cycle' ? cyclePathOf(params) : null;
		const message =
			code === 'validation_recurrence_open_instance' && key !== null
				? openInstanceMessage(key)
				: code === 'validation_recurrence_reopen_older' && key !== null
					? reopenOlderMessage(key)
					: code === 'validation_parent_open_children' && typeof params?.count === 'number'
						? openChildrenMessage(params.count)
						: path !== null
							? cycleMessage(path)
							: fieldMessage(field, code);
		fields[field] = { code, message, ...(params && { params }) };
	}
	return fields;
}

/**
 * Maps any error of an SDK call to a DataError. `signal` is the signal of the call: once it is
 * aborted, the failure counts as "aborted" whatever the runtime reports.
 */
export function toDataError(error: unknown, signal?: AbortSignal): DataError {
	if (isDataError(error)) return error;
	if (signal?.aborted) return new DataError('aborted', { cause: error });
	if (!isRecord(error)) return new DataError('server', { cause: error });
	if (isAbortLike(error)) return new DataError('aborted', { cause: error });
	if (typeof error.status !== 'number') return new DataError('server', { cause: error });

	const status = error.status;
	switch (status) {
		case 0:
			return new DataError('network', { status, cause: error });
		case 401:
			return new DataError('session', { status, cause: error });
		case 403:
			return new DataError('forbidden', { status, cause: error });
		case 404:
			return new DataError('not_found', { status, cause: error });
	}
	const fields = status === 400 ? fieldErrorsOf(error.response) : {};
	if (Object.keys(fields).length > 0) {
		return new DataError('validation', { status, fields, cause: error });
	}
	return new DataError('server', { status, cause: error });
}

/** Runs one SDK call and turns every failure into a DataError. */
export async function withDataErrors<T>(
	signal: AbortSignal | undefined,
	call: () => Promise<T>
): Promise<T> {
	try {
		return await call();
	} catch (error) {
		throw toDataError(error, signal);
	}
}
