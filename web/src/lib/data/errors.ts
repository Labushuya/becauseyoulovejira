// Error kinds of the data layer (ADR-0006 section 4). Errors are recognised by their structure
// (`status`, `isAbort`, `response`) instead of `instanceof ClientResponseError`, because the
// root integration tests and the web app each load their own copy of the SDK.
// Since FP-1 (ADR-0071) this is also the one place that turns a failure into the entry behind
// "Details" of a message (`problemOf`): the client of the app notes method and path of every
// failed request (`noteRequest`, lib/pocketbase.ts), an action may name its intent
// (`withIntent`), otherwise the catalog of domain/problem-intents.ts names it.

import { ACCOUNT_MESSAGES } from '../domain/accounts';
import { SCOPE_FIELD_MESSAGES, SCOPE_MESSAGE } from '../domain/area';
import { ASSIGNEE_MESSAGES } from '../domain/assignee';
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
import { TRANSFER_MESSAGES } from '../domain/subtask-transfer';
import { TARGET_MESSAGES } from '../domain/target-project';
import { CREATE_MESSAGES } from '../domain/ticket-create';
import { TICKET_SOURCE_MESSAGES, cycleMessage, cyclePathOf } from '../domain/ticket-origins';
import { unreachableHint } from '../domain/context';
import { TRASH_MESSAGES } from '../domain/trash';
import { UNKNOWN_INTENT, intentOf } from '../domain/problem-intents';
import {
	UNEXPECTED_INTENT,
	clientProblem,
	exceptionOf,
	fieldCodesOf,
	isInputValidation,
	requestPathOf,
	responseOutcome,
	sanitizeProblemText,
	type ProblemEntry,
	type ProblemOutcome,
	type ProblemRequest
} from '../domain/problems';
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
	...TICKET_SOURCE_MESSAGES,
	// "Zuständig" (ADR-0068), the same texts as the hook.
	...ASSIGNEE_MESSAGES,
	// "Neues Ticket" with everything at once (ADR-0069), the same texts as the route.
	...CREATE_MESSAGES,
	// "Auf Unteraufgaben übertragen …" (ADR-0070), the same texts as the route.
	...TRANSFER_MESSAGES
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
	// Sources of "Neues Ticket" (ADR-0069): an entry or a ticket of another area.
	'sources:validation_scope_mismatch':
		'Ein Eintrag liegt in einem anderen Bereich (Privat oder Haushalt).',
	'ticket_sources:validation_scope_mismatch': SCOPE_FIELD_MESSAGES.source ?? SCOPE_MESSAGE,
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
	/** When it happened (ms since the epoch), for "Zeitpunkt" of the details (ADR-0071). */
	readonly occurredAt: number;

	constructor(
		kind: DataErrorKind,
		options: { status?: number; fields?: Record<string, FieldError>; cause?: unknown } = {}
	) {
		super(DATA_ERROR_MESSAGES[kind], { cause: options.cause });
		this.name = 'DataError';
		this.kind = kind;
		this.status = options.status ?? 0;
		this.fields = Object.freeze({ ...options.fields });
		this.occurredAt = Date.now();
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

// Details of failed actions (FP-1, ADR-0071). Method, path and intent are noted beside the error
// objects (WeakMaps), so neither the SDK error nor a DataError changes its form, and the root
// tests that load this module without the client of the app keep working (then there is only the
// path of an error answer, without the method).

const requests = new WeakMap<object, ProblemRequest>();
const intents = new WeakMap<object, string>();
const problems = new WeakMap<object, ProblemEntry | null>();
let problemCount = 0;
let appVersion: string | null = null;

/** The build of the app for "App-Stand", set once by the app (stores/problem-log.svelte.ts). */
export function provideAppVersion(version: string | null): void {
	appVersion = version === null || version === '' ? null : version;
}

/**
 * Notes method and path of the request that failed with `error` (the client of the app calls it
 * for every failure of `send`). Only the path is kept: no query, no body, no header.
 */
export function noteRequest(error: unknown, method: string, path: string): void {
	if (isRecord(error) && !requests.has(error)) {
		requests.set(error, { method: method.toUpperCase(), path: requestPathOf(path) });
	}
}

/**
 * Runs an action that names its intent (e.g. "Kanal verbinden"): a failure carries it to the
 * details instead of the intent of the catalog. The outermost intent wins, it is closest to what
 * the user did.
 */
export async function withIntent<T>(intent: string, run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (isRecord(error)) intents.set(error, intent);
		throw error;
	}
}

/** The error and its causes, outermost first (a DataError, then the error of the SDK). */
function chainOf(error: Record<string, unknown>): Record<string, unknown>[] {
	const chain = [error];
	let current: unknown = error.cause;
	while (isRecord(current) && !chain.includes(current) && chain.length < 5) {
		chain.push(current);
		current = current.cause;
	}
	return chain;
}

/** An error of the SDK (ClientResponseError or the like): a numeric status and an answer. */
function isSdkLike(value: unknown): value is Record<string, unknown> & { status: number } {
	return (
		isRecord(value) &&
		typeof value.status === 'number' &&
		('response' in value || 'url' in value || 'isAbort' in value)
	);
}

function nextProblemId(at: number): string {
	problemCount += 1;
	const random = Math.random().toString(36).slice(2, 7);
	return `p-${at.toString(36)}-${problemCount.toString(36)}-${random}`;
}

const NO_ANSWER = { status: null, code: null, message: null } as const;

/** What came back, from the error of the SDK or else from the DataError and its cause. */
function outcomeOf(failure: DataError | null, raw: unknown): ProblemOutcome {
	if (isSdkLike(raw)) {
		return raw.status === 0
			? { result: 'network', ...NO_ANSWER }
			: responseOutcome(raw.status, raw.response);
	}
	if (failure?.kind === 'network') return { result: 'network', ...NO_ANSWER };
	// A DataError of the data layer with a status or fields: the codes of its fields.
	if (failure !== null && (failure.status > 0 || Object.keys(failure.fields).length > 0)) {
		const outcome = responseOutcome(failure.status, { data: failure.fields });
		return failure.status > 0 ? outcome : { ...outcome, status: null };
	}
	// An exception of the browser behind the failure, or no failure of the data layer at all.
	if (failure === null || (raw !== undefined && raw !== null)) {
		return { result: 'exception', ...NO_ANSWER };
	}
	// A DataError of the data layer itself: it could not read the answer.
	return { result: 'answer', ...NO_ANSWER };
}

function buildProblem(error: Record<string, unknown>): ProblemEntry | null {
	const failure = isDataError(error) ? error : null;
	if (failure?.kind === 'aborted') return null;
	const raw: unknown = failure === null ? error : failure.cause;
	if (failure === null && isAbortLike(error)) return null;
	// A refusal that only checks inputs is a hint at the field, not a failed action (ADR-0071 §1).
	const codes =
		failure?.kind === 'validation'
			? Object.values(failure.fields).map((field) => field.code)
			: isSdkLike(raw) && raw.status === 400
				? fieldCodesOf(raw.response)
				: [];
	if (isInputValidation(codes)) return null;

	const chain = chainOf(error);
	const noted = chain.map((part) => requests.get(part)).find((request) => request !== undefined);
	const url = isSdkLike(raw) && typeof raw.url === 'string' && raw.url !== '' ? raw.url : null;
	const request = noted ?? (url === null ? null : { method: null, path: requestPathOf(url) });
	const outcome = outcomeOf(failure, raw);
	const explicit = chain.map((part) => intents.get(part)).find((intent) => intent !== undefined);
	const known = request === null ? null : intentOf(request.method, request.path);
	const at = failure?.occurredAt ?? Date.now();
	return clientProblem({
		id: nextProblemId(at),
		intent: explicit ?? known ?? UNKNOWN_INTENT,
		at,
		outcome,
		request,
		app: appVersion,
		exception: outcome.result === 'exception' ? exceptionOf(raw ?? error) : null
	});
}

/**
 * The entry behind "Details" of a message about `error`, or null when there is none: nothing was
 * thrown, the request was aborted, or the server only checked an input. The same error always
 * gives the same entry (same ID), so the list "Fehler dieser Sitzung" takes it once.
 */
export function problemOf(error: unknown): ProblemEntry | null {
	if (!isRecord(error)) return null;
	if (problems.has(error)) return problems.get(error) ?? null;
	const problem = buildProblem(error);
	problems.set(error, problem);
	return problem;
}

/**
 * The entry of a failure the server reports in a successful answer, e.g. "Jetzt abrufen" of a
 * channel whose run failed (200 with `status: 'error'` and the cleaned error): the request worked,
 * the action did not. `code` and `message` are those of the answer.
 */
export function reportedProblem(input: {
	intent: string;
	method: string;
	path: string;
	code: string | null;
	message: string | null;
}): ProblemEntry {
	const at = Date.now();
	const message = input.message === null ? null : sanitizeProblemText(input.message);
	return clientProblem({
		id: nextProblemId(at),
		intent: input.intent,
		at,
		outcome: {
			result: 'reported',
			status: null,
			code: input.code === null ? null : sanitizeProblemText(input.code, 60),
			message: message === '' ? null : message
		},
		request: { method: input.method.toUpperCase(), path: requestPathOf(input.path) },
		app: appVersion,
		exception: null
	});
}

/**
 * `{ problem }` for the result of an action when the failure has an entry, nothing otherwise, so a
 * result keeps its form for a hint at an input: `{ ok: false, message, ...problemDetails(failure) }`.
 */
export function problemDetails(error: unknown): { problem?: ProblemEntry } {
	const problem = problemOf(error);
	return problem === null ? {} : { problem };
}

/**
 * An error nobody caught (window events "error" and "unhandledrejection"): "Unerwarteter Fehler"
 * with what is known about it, or null for an aborted request.
 */
export function unexpectedProblem(error: unknown): ProblemEntry | null {
	if (isRecord(error)) {
		if (isAbortLike(error) || (isDataError(error) && error.kind === 'aborted')) return null;
		const known = problemOf(error);
		if (known !== null) return { ...known, intent: UNEXPECTED_INTENT };
	}
	const at = Date.now();
	return clientProblem({
		id: nextProblemId(at),
		intent: UNEXPECTED_INTENT,
		at,
		outcome: { result: 'exception', status: null, code: null, message: null },
		request: null,
		app: appVersion,
		exception: exceptionOf(error)
	});
}
