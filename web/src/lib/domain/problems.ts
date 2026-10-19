// Failed actions and unexpected errors (FP-1, ADR-0071): the entry behind "Details" of a message
// and behind the list "Fehler dieser Sitzung". One type for both sources, so the page
// "Einstellungen → Protokoll" of FP-3 can show the entries of this tab next to the ones the server
// keeps (FP-2, `problem_events`): `source`, `serverId` and `correlation` are the docking points.
// Pure. Privacy (ADR-0071 §2): an entry holds the intent, the time, the outcome (status, codes and
// message of the server), method and path of the request without query, the build of the app and,
// for unexpected exceptions only, name, message and a short stack. Never a body, a query, a token, a
// header or the content of a field; ticket keys and IDs in a path are allowed. Every text that comes
// from outside passes `sanitizeProblemText`, which also strips queries and token-like values.

import { berlinOffsetHours } from './berlin-date';

/** Where an entry comes from: this tab (FP-1) or the log of the server (FP-2). */
export type ProblemSource = 'client' | 'server';

/**
 * What came back: no connection, an answer with an error status, an answer the app could not
 * read, or an exception in the browser.
 */
export type ProblemResult = 'network' | 'response' | 'answer' | 'exception';

export interface ProblemOutcome {
	readonly result: ProblemResult;
	/** HTTP status of an answer, null without one. */
	readonly status: number | null;
	/** Code(s) of the server, e.g. `title: validation_required` or the reason of a route. */
	readonly code: string | null;
	/** Message of the server, cleaned and shortened. */
	readonly message: string | null;
}

/** The request: method (null when unknown) and path without origin, query and hash. */
export interface ProblemRequest {
	readonly method: string | null;
	readonly path: string;
}

/** An unexpected exception: name, message and at most STACK_MAX_LINES lines of the stack. */
export interface ProblemException {
	readonly name: string;
	readonly message: string;
	readonly stack: readonly string[];
}

export interface ProblemEntry {
	readonly id: string;
	readonly source: ProblemSource;
	/** What was tried, e.g. "Unteraufgaben übertragen". */
	readonly intent: string;
	/** First occurrence, ms since the epoch. */
	readonly at: number;
	/** Last occurrence of the same problem in quick succession (see addProblem). */
	readonly lastAt: number;
	/** Occurrences merged into this entry. */
	readonly count: number;
	readonly outcome: ProblemOutcome;
	readonly request: ProblemRequest | null;
	/** Build of the app (SvelteKit version), null when unknown. */
	readonly app: string | null;
	/** Only for unexpected exceptions. */
	readonly exception: ProblemException | null;
	/** FP-2: ID of the entry in the log of the server, if the server has one. */
	readonly serverId: string | null;
	/** FP-2: what links a request with the log of the server (e.g. a request ID), if known. */
	readonly correlation: string | null;
}

/** Key in sessionStorage: the list of this tab survives a reload, nothing else keeps it. */
export const PROBLEM_LOG_KEY = 'byl-session-errors';
/** At most this many entries; a further one pushes out the oldest. */
export const PROBLEM_LOG_MAX = 100;
/** The same problem within this time counts on its entry ("3×") instead of a new one. */
export const PROBLEM_MERGE_MS = 10_000;
/** Lines of the stack of an unexpected exception. */
export const STACK_MAX_LINES = 10;
/** Longest text of an entry (messages, paths, lines of the stack). */
export const PROBLEM_TEXT_MAX = 300;

/** Intent of the errors the app did not catch (window events "error" and "unhandledrejection"). */
export const UNEXPECTED_INTENT = 'Unerwarteter Fehler';

/** Texts of the details and of the list. */
export const PROBLEM_TEXTS = Object.freeze({
	details: 'Details',
	intent: 'Absicht',
	at: 'Zeitpunkt',
	result: 'Ergebnis',
	code: 'Fehlercode',
	serverMessage: 'Servermeldung',
	request: 'Anfrage',
	app: 'App-Stand',
	count: 'Häufigkeit',
	technical: 'Technische Details',
	copy: 'Kopieren',
	copied: 'Kopiert.',
	copyFailed: 'Kopieren war nicht möglich. Der Bericht ist markiert: mit Strg+C kopieren.',
	listTitle: 'Fehler dieser Sitzung',
	empty: 'In dieser Sitzung ist kein Fehler aufgetreten.',
	copyAll: 'Alle kopieren',
	copiedAll: 'Alle kopiert.',
	clear: 'Liste leeren',
	cleared: 'Liste geleert.',
	unknownApp: 'unbekannt',
	network: 'Keine Verbindung zum Server',
	answer: 'Unerwartete Antwort des Servers',
	exception: 'Unerwartete Ausnahme im Browser'
});

/** "Alle Fehler dieser Sitzung (3)". */
export function allProblemsLabel(count: number): string {
	return `Alle Fehler dieser Sitzung (${count})`;
}

/** Short names of the HTTP status codes of the app. */
const STATUS_LABELS: Readonly<Record<number, string>> = Object.freeze({
	400: 'Ungültige Anfrage',
	401: 'Nicht angemeldet',
	403: 'Keine Berechtigung',
	404: 'Nicht gefunden',
	405: 'Methode nicht erlaubt',
	408: 'Zeitüberschreitung',
	409: 'Konflikt',
	413: 'Zu groß',
	422: 'Nicht verarbeitbar',
	429: 'Zu viele Anfragen',
	500: 'Fehler des Servers',
	502: 'Server nicht erreichbar',
	503: 'Nicht verfügbar',
	504: 'Zeitüberschreitung'
});

/** "HTTP 409 (Konflikt)", "Keine Verbindung zum Server" … */
export function outcomeText(outcome: ProblemOutcome): string {
	switch (outcome.result) {
		case 'network':
			return PROBLEM_TEXTS.network;
		case 'answer':
			return PROBLEM_TEXTS.answer;
		case 'exception':
			return PROBLEM_TEXTS.exception;
		case 'response': {
			if (outcome.status === null) return PROBLEM_TEXTS.answer;
			const label = STATUS_LABELS[outcome.status];
			return label === undefined ? `HTTP ${outcome.status}` : `HTTP ${outcome.status} (${label})`;
		}
	}
}

/**
 * Codes of the record API of PocketBase that only check one input (required, length, format,
 * value, date, address, uniqueness): a refusal with nothing but these is a hint at the field, not
 * a failed action, and gets no details (ADR-0071 §1). Refusals of the hooks (a conflict, a rule of
 * the app) are failed actions.
 */
export const INPUT_VALIDATION_CODES: ReadonlySet<string> = new Set([
	'validation_required',
	'validation_nil_or_not_empty_required',
	'validation_min_text_constraint',
	'validation_max_text_constraint',
	'validation_length_out_of_range',
	'validation_length_too_long',
	'validation_length_too_short',
	'validation_length_invalid',
	'validation_invalid_value',
	'validation_invalid_format',
	'validation_invalid_date',
	'validation_calendar_date',
	'validation_invalid_email',
	'validation_is_email',
	'validation_invalid_url',
	'validation_invalid_number',
	'validation_min_number_constraint',
	'validation_max_number_constraint',
	'validation_not_unique',
	'validation_values_mismatch',
	'validation_match_invalid',
	'validation_in_invalid'
]);

/** Whether a refusal with these codes of fields is only a check of the input (no details). */
export function isInputValidation(codes: readonly string[]): boolean {
	return codes.length > 0 && codes.every((code) => INPUT_VALIDATION_CODES.has(code));
}

const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER = /\b(Bearer|Basic)\s+[^\s"',;]+/gi;
const SECRET_PARAM =
	/\b(token|access_token|key|password|passphrase|secret|auth|authorization|code)=[^\s&"',;]+/gi;
/**
 * A query after a URL or a path: `…/x?token=1` keeps `…/x`. It ends before `:` and parentheses,
 * so a line of a stack (`at f (/_app/x.js?v=1:2:3)`) keeps its line and column.
 */
const QUERY_AFTER_PATH = /((?:[a-z][a-z\d+.-]*:\/\/|\/)[^\s?#"'<>]*)\?[^\s#"'<>():]*/gi;
const REDACTED = '[entfernt]';

/**
 * A text for an entry: queries after paths and URLs, tokens, bearer values and secrets in
 * `name=value` removed, white space collapsed, at most `max` characters.
 */
export function sanitizeProblemText(text: string, max = PROBLEM_TEXT_MAX): string {
	const clean = text
		.replace(JWT, REDACTED)
		.replace(BEARER, `$1 ${REDACTED}`)
		.replace(SECRET_PARAM, `$1=${REDACTED}`)
		.replace(QUERY_AFTER_PATH, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Path of a request without origin, query and hash: `http://127.0.0.1:8090/api/x?filter=…` gives
 * `/api/x`. IDs and keys in the path stay (they are allowed, ADR-0071 §2).
 */
export function requestPathOf(url: string): string {
	let rest = url.trim();
	const origin = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i.exec(rest);
	if (origin !== null) rest = rest.slice(origin[0].length);
	const cut = rest.search(/[?#]/);
	if (cut !== -1) rest = rest.slice(0, cut);
	if (!rest.startsWith('/')) rest = `/${rest}`;
	return rest.length > PROBLEM_TEXT_MAX ? rest.slice(0, PROBLEM_TEXT_MAX) : rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * The codes of an error answer of PocketBase: the reason of a route (`reason`), else the code of
 * every field (`data.<field>.code`, as `field: code`), at most five.
 */
export function responseCodes(response: unknown): string[] {
	if (!isRecord(response)) return [];
	if (typeof response.reason === 'string' && response.reason !== '') {
		return [sanitizeProblemText(response.reason, 60)];
	}
	const data = response.data;
	if (!isRecord(data)) return [];
	return Object.entries(data)
		.filter(([, detail]) => isRecord(detail) && typeof detail.code === 'string')
		.slice(0, 5)
		.map(([field, detail]) =>
			sanitizeProblemText(`${field}: ${String((detail as Record<string, unknown>).code)}`, 80)
		);
}

/** Only the codes of the fields of an error answer (for the line to the input checks). */
export function fieldCodesOf(response: unknown): string[] {
	if (!isRecord(response) || !isRecord(response.data)) return [];
	return Object.values(response.data)
		.map((detail) => (isRecord(detail) && typeof detail.code === 'string' ? detail.code : ''))
		.filter((code) => code !== '');
}

/** The outcome of an error answer with `status`: codes and message of the server. */
export function responseOutcome(status: number, response: unknown): ProblemOutcome {
	const codes = responseCodes(response);
	const message =
		isRecord(response) && typeof response.message === 'string' && response.message.trim() !== ''
			? sanitizeProblemText(response.message)
			: null;
	return {
		result: 'response',
		status,
		code: codes.length === 0 ? null : codes.join(', '),
		message
	};
}

/** Double-quoted parts of a message of an exception, e.g. the text JSON.parse could not read. */
const QUOTED = /"[^"\n]*"/g;

/**
 * Name, message and stack of an exception, cleaned: double-quoted parts of the message (they may
 * hold content, such as the text a JSON parser refused) become `"…"`; the stack keeps at most
 * STACK_MAX_LINES lines without the line of name and message, each without query.
 */
export function exceptionOf(error: unknown): ProblemException {
	if (typeof error === 'string') {
		return { name: 'Error', message: sanitizeProblemText(error.replace(QUOTED, '"…"')), stack: [] };
	}
	if (!isRecord(error)) {
		return { name: typeof error, message: '', stack: [] };
	}
	const name =
		typeof error.name === 'string' && error.name !== ''
			? sanitizeProblemText(error.name, 80)
			: 'Error';
	const rawMessage = typeof error.message === 'string' ? error.message : '';
	const message = sanitizeProblemText(rawMessage.replace(QUOTED, '"…"'));
	const stack = typeof error.stack === 'string' ? stackLines(error.stack, rawMessage) : [];
	return { name, message, stack };
}

/** At most STACK_MAX_LINES lines of a stack, without its first line of name and message. */
export function stackLines(stack: string, message = ''): string[] {
	const lines = stack
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== '');
	// V8 starts with "Name: message", Firefox and Safari with the first frame ("fn@url:1:2").
	const header = (line: string) =>
		!/^at\s|@/.test(line) || (message !== '' && line.includes(message));
	const frames = lines.filter((line, index) => index > 0 || !header(line));
	return frames.slice(0, STACK_MAX_LINES).map((line) => sanitizeProblemText(line, 200));
}

/** What the app knows about a failure when it builds an entry. */
export interface ProblemInput {
	readonly id: string;
	readonly intent: string;
	readonly at: number;
	readonly outcome: ProblemOutcome;
	readonly request: ProblemRequest | null;
	readonly app: string | null;
	readonly exception: ProblemException | null;
}

/** A new entry of this tab, seen once. */
export function clientProblem(input: ProblemInput): ProblemEntry {
	return {
		id: input.id,
		source: 'client',
		intent: sanitizeProblemText(input.intent, 120),
		at: input.at,
		lastAt: input.at,
		count: 1,
		outcome: input.outcome,
		request: input.request,
		app: input.app,
		exception: input.exception,
		serverId: null,
		correlation: null
	};
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/** A point in time in Berlin, `19.10.2026, 14:03:12` (ADR-0005: own daylight saving rule). */
export function formatProblemTime(ms: number): string {
	const local = new Date(ms + berlinOffsetHours(ms) * 3_600_000);
	const date = `${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)}.${local.getUTCFullYear()}`;
	const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
	return `${date}, ${time}`;
}

/** Only the time of day in Berlin, `14:03:12`, for "3× bis 14:03:20". */
function formatProblemClock(ms: number): string {
	return formatProblemTime(ms).slice(-8);
}

/** "POST /api/byl/tickets/abc/subtasks/transfer", or only the path without a known method. */
export function requestText(request: ProblemRequest): string {
	return request.method === null ? request.path : `${request.method} ${request.path}`;
}

/** "3× bis 14:03:20" for a merged entry, null for a single occurrence. */
export function countText(entry: ProblemEntry): string | null {
	return entry.count > 1 ? `${entry.count}× bis ${formatProblemClock(entry.lastAt)}` : null;
}

/** "Build 1760870400000", or "unbekannt". */
export function appText(app: string | null): string {
	return app === null || app === '' ? PROBLEM_TEXTS.unknownApp : `Build ${app}`;
}

/** One row of the details: label and value. */
export interface ProblemFact {
	readonly label: string;
	readonly value: string;
}

/** The facts of an entry as label and value, in the order of the details and of the report. */
export function problemFacts(entry: ProblemEntry): ProblemFact[] {
	const facts: ProblemFact[] = [
		{ label: PROBLEM_TEXTS.intent, value: entry.intent },
		{ label: PROBLEM_TEXTS.at, value: formatProblemTime(entry.at) }
	];
	const count = countText(entry);
	if (count !== null) facts.push({ label: PROBLEM_TEXTS.count, value: count });
	facts.push({ label: PROBLEM_TEXTS.result, value: outcomeText(entry.outcome) });
	if (entry.outcome.code !== null) {
		facts.push({ label: PROBLEM_TEXTS.code, value: entry.outcome.code });
	}
	if (entry.outcome.message !== null) {
		facts.push({ label: PROBLEM_TEXTS.serverMessage, value: entry.outcome.message });
	}
	if (entry.request !== null) {
		facts.push({ label: PROBLEM_TEXTS.request, value: requestText(entry.request) });
	}
	facts.push({ label: PROBLEM_TEXTS.app, value: appText(entry.app) });
	return facts;
}

/**
 * The report of one entry as plain text for the clipboard: exactly the facts of the details, the
 * time also in UTC, and the technical details of an unexpected exception.
 */
export function problemReport(entry: ProblemEntry): string {
	const utc = new Date(entry.at).toISOString();
	const lines = problemFacts(entry).map(({ label, value }) =>
		label === PROBLEM_TEXTS.at ? `${label}: ${value} (${utc})` : `${label}: ${value}`
	);
	if (entry.serverId !== null) lines.push(`Server-ID: ${entry.serverId}`);
	const exception = entry.exception;
	if (exception !== null) {
		const head =
			exception.message === '' ? exception.name : `${exception.name}: ${exception.message}`;
		lines.push(`${PROBLEM_TEXTS.technical}:`, `  ${head}`);
		lines.push(...exception.stack.map((line) => `    ${line}`));
	}
	return lines.join('\n');
}

/** The report of all entries, newest first, for "Alle kopieren". */
export function problemsReport(entries: readonly ProblemEntry[]): string {
	const head = `becauseyoulovejira – ${PROBLEM_TEXTS.listTitle} (${entries.length})`;
	return [head, ...entries.map((entry) => problemReport(entry))].join('\n\n');
}

/** What makes two failures the same problem. */
export function problemFingerprint(entry: ProblemEntry): string {
	return JSON.stringify([
		entry.source,
		entry.intent,
		entry.outcome.result,
		entry.outcome.status,
		entry.outcome.code,
		entry.request?.method ?? null,
		entry.request?.path ?? null,
		entry.exception?.name ?? null,
		entry.exception?.message ?? null
	]);
}

/**
 * The list after a new entry, newest first: the same problem within PROBLEM_MERGE_MS of an entry
 * counts on it (and moves it to the top), so a loop never floods the list; otherwise the entry
 * comes first and the list keeps at most PROBLEM_LOG_MAX entries.
 */
export function addProblem(entries: readonly ProblemEntry[], entry: ProblemEntry): ProblemEntry[] {
	const key = problemFingerprint(entry);
	const index = entries.findIndex(
		(old) => Math.abs(entry.at - old.lastAt) <= PROBLEM_MERGE_MS && problemFingerprint(old) === key
	);
	if (index === -1) return [entry, ...entries].slice(0, PROBLEM_LOG_MAX);
	const old = entries[index] as ProblemEntry;
	const merged: ProblemEntry = {
		...old,
		count: old.count + entry.count,
		lastAt: Math.max(old.lastAt, entry.lastAt)
	};
	return [merged, ...entries.slice(0, index), ...entries.slice(index + 1)];
}

const RESULTS: readonly ProblemResult[] = ['network', 'response', 'answer', 'exception'];

const text = (value: unknown): value is string => typeof value === 'string';
const textOrNull = (value: unknown): value is string | null => value === null || text(value);
const whole = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value);

function toOutcome(value: unknown): ProblemOutcome | null {
	if (!isRecord(value) || !RESULTS.includes(value.result as ProblemResult)) return null;
	if (!(value.status === null || whole(value.status))) return null;
	if (!textOrNull(value.code) || !textOrNull(value.message)) return null;
	return {
		result: value.result as ProblemResult,
		status: value.status,
		code: value.code,
		message: value.message
	};
}

function toRequest(value: unknown): ProblemRequest | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !textOrNull(value.method) || !text(value.path)) return undefined;
	return { method: value.method, path: value.path };
}

function toException(value: unknown): ProblemException | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !text(value.name) || !text(value.message)) return undefined;
	if (!Array.isArray(value.stack) || !value.stack.every(text)) return undefined;
	return { name: value.name, message: value.message, stack: [...value.stack] };
}

/** One stored entry, or null when it is not one (an older or a broken form). */
export function toProblemEntry(value: unknown): ProblemEntry | null {
	if (!isRecord(value) || !text(value.id) || !text(value.intent)) return null;
	if (value.source !== 'client' && value.source !== 'server') return null;
	if (!whole(value.at) || !whole(value.lastAt) || !whole(value.count)) return null;
	if (value.count < 1) return null;
	const outcome = toOutcome(value.outcome);
	const request = toRequest(value.request);
	const exception = toException(value.exception);
	if (outcome === null || request === undefined || exception === undefined) return null;
	if (!textOrNull(value.app) || !textOrNull(value.serverId) || !textOrNull(value.correlation)) {
		return null;
	}
	return {
		id: value.id,
		source: value.source,
		intent: value.intent,
		at: value.at,
		lastAt: value.lastAt,
		count: value.count,
		outcome,
		request,
		app: value.app,
		exception,
		serverId: value.serverId,
		correlation: value.correlation
	};
}

/** The list stored in sessionStorage; anything that is not a list of entries gives none. */
export function parseStoredProblems(stored: string | null): ProblemEntry[] {
	if (stored === null) return [];
	let value: unknown;
	try {
		value = JSON.parse(stored);
	} catch {
		return [];
	}
	if (!Array.isArray(value)) return [];
	return value
		.map(toProblemEntry)
		.filter((entry): entry is ProblemEntry => entry !== null)
		.slice(0, PROBLEM_LOG_MAX);
}

export function serializeProblems(entries: readonly ProblemEntry[]): string {
	return JSON.stringify(entries);
}

/** What the window reports with an event "error". */
export interface GlobalErrorReport {
	readonly message: string;
	readonly filename: string;
	readonly hasError: boolean;
}

const EXTENSION_SCHEMES = /^(?:chrome|moz|safari|safari-web)-extension:/i;

/**
 * Whether an event "error" of the window is noise and stays out of the list: the warning of a
 * ResizeObserver loop, "Script error." of a foreign script without details, and errors of
 * browser extensions.
 */
export function isIgnorableGlobalError(report: GlobalErrorReport): boolean {
	if (/ResizeObserver loop/i.test(report.message)) return true;
	if (!report.hasError && /^Script error\.?$/i.test(report.message.trim())) return true;
	return EXTENSION_SCHEMES.test(report.filename);
}
