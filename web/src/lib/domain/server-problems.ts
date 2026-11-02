// The error log of the server in the SPA (FP-2, ADR-0077): an entry of `problem_events` as read
// through the record API, as an entry of the same type as those of this tab (ProblemEntry with source
// "server"), so the dialog "Fehler" shows both with the same building blocks. Also the address of an
// entry (`?fehler=<id>`, the deep link of "Details" at a card) and the header of an answer that names
// its entry. Pure.

import { intentOf } from './problem-intents';
import { sanitizeProblemText, type ProblemArea, type ProblemEntry } from './problems';

/** Where an entry of the server came from: a request, a channel in the background, another job. */
export type ServerProblemSource = 'request' | 'channel' | 'job';

/** The context of an entry: only these keys, each in a fixed shape (lib/problem-rules.js). */
export interface ServerProblemContext {
	readonly connection?: string;
	readonly channel?: string;
	readonly rule?: string;
	readonly job?: string;
	readonly method?: string;
	readonly route?: string;
	readonly status?: number;
}

/** One entry of the log of the server as the record API gives it. */
export interface ServerProblemRecord {
	readonly id: string;
	readonly source: ServerProblemSource;
	readonly area: ProblemArea;
	readonly code: string;
	readonly message: string;
	readonly context: ServerProblemContext;
	readonly count: number;
	/** First and last occurrence, ms since the epoch. */
	readonly firstAt: number;
	readonly lastAt: number;
}

/**
 * The header of an answer with an unexpected failure that names its entry (the Server-ID): a 5xx, or
 * a 400 the server keeps as `http_400_unexpected` (a failure of the app, not a refusal).
 */
export const SERVER_PROBLEM_HEADER = 'X-Byl-Problem';
/** The parameter of the address that opens an entry of the log: `?fehler=<id>`. */
export const SERVER_PROBLEM_PARAM = 'fehler';
/** Entries the dialog loads at once, newest first. */
export const SERVER_PROBLEMS_PAGE = 50;

/** Texts of the log of the server in the dialog, at the cards and in the help. */
export const SERVER_PROBLEM_TEXTS = Object.freeze({
	title: 'Fehlerprotokoll des Servers',
	session: 'Diese Sitzung',
	server: 'Server',
	views: 'Welche Fehler',
	loading: 'Fehlerprotokoll wird geladen …',
	noProblems: 'Der Server hat keinen Fehler festgehalten, den du sehen darfst.',
	offline: 'Ohne Verbindung zum Server lässt sich das Fehlerprotokoll nicht laden.',
	failed: 'Das Fehlerprotokoll ließ sich nicht laden.',
	retry: 'Erneut laden',
	missing:
		'Diesen Eintrag gibt es nicht mehr, oder er ist für dein Konto nicht sichtbar. Einträge bleiben 30 Tage nach dem letzten Auftreten.',
	linked: 'Verlinkter Eintrag',
	signedOut: 'Das Fehlerprotokoll des Servers steht nach der Anmeldung bereit.',
	details: 'Details',
	open: 'Fehlerprotokoll des Servers anzeigen',
	limits: 'Der Server behält einen Eintrag 30 Tage nach seinem letzten Auftreten, höchstens 5000.'
});

/**
 * What screen readers hear after "Details" at the last error of a card, so the link is told apart
 * from the details of the card: "Details: Kalender im Fehlerprotokoll".
 */
export function detailsSuffix(name: string): string {
	return `: ${name} im Fehlerprotokoll`;
}

const ID_PATTERN = /^[a-z0-9]{15}$/;

/** Whether `value` is the ID of an entry (15 characters a-z0-9, like every ID of PocketBase). */
export function isServerProblemId(value: unknown): value is string {
	return typeof value === 'string' && ID_PATTERN.test(value);
}

/** The ID of the entry the address names (`?fehler=<id>`), or null. */
export function serverProblemIdOf(params: URLSearchParams): string | null {
	const value = params.get(SERVER_PROBLEM_PARAM);
	return isServerProblemId(value) ? value : null;
}

const SOURCES: readonly ServerProblemSource[] = ['request', 'channel', 'job'];
const AREAS: readonly ProblemArea[] = ['private', 'household', 'system'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A date of PocketBase (`YYYY-MM-DD HH:MM:SS.mmmZ`) in ms, NaN for anything else. */
function msOf(value: unknown): number {
	return typeof value === 'string' && value !== '' ? Date.parse(value.replace(' ', 'T')) : NaN;
}

function contextOf(value: unknown): ServerProblemContext {
	if (!isRecord(value)) return {};
	const text = (key: string, max: number): Record<string, string> =>
		typeof value[key] === 'string' && value[key] !== ''
			? { [key]: sanitizeProblemText(value[key], max) }
			: {};
	return {
		...text('connection', 15),
		...text('channel', 20),
		...text('rule', 15),
		...text('job', 40),
		...text('method', 10),
		...text('route', 200),
		...(typeof value.status === 'number' && Number.isInteger(value.status)
			? { status: value.status }
			: {})
	};
}

/** A card with the last error of a run in the background, as "Details" asks for its entry. */
export interface ChannelProblemCard {
	readonly connection: string;
	readonly lastError: string;
	/** Time of the last run (form of PocketBase), the run that failed with `lastError`. */
	readonly lastRunAt: string | null;
}

/** An entry of a failed run of a connection, as the query of the page "Kanäle" finds it. */
export interface ChannelProblemHit {
	readonly id: string;
	readonly connection: string;
	/** Last occurrence, ms since the epoch. */
	readonly lastAt: number;
}

/**
 * How far the last occurrence of an entry may lie before the run of the card and still be its error.
 * The server writes both, the entry right after the card (`last_run_at`, then the entry, milliseconds
 * apart), so `last_at` is never older; the second only covers a correction of the clock of the server
 * between the two writes. A failure of a run before lies further back (a run takes longer than that),
 * so "Details" never names an older, other error.
 */
export const CHANNEL_PROBLEM_TOLERANCE_MS = 1000;
/** Connections one query of the page asks for at most; a card beyond them shows no link. */
export const CHANNEL_PROBLEM_CONNECTIONS_MAX = 40;
/** Entries one query of the page reads at most, newest first. */
export const CHANNEL_PROBLEM_HITS_MAX = 200;

/**
 * The key of the error of a card: the same text of the same connection is the same entry (the server
 * counts the same failure on its entry), so a new run with it asks nothing new.
 */
export function channelProblemKey(
	card: Pick<ChannelProblemCard, 'connection' | 'lastError'>
): string {
	return `${card.connection}\n${card.lastError}`;
}

/** The earliest time an entry of these cards may have (ms), or null when no card has a run. */
export function channelProblemsSince(cards: readonly ChannelProblemCard[]): number | null {
	const times = cards.map((card) => msOf(card.lastRunAt)).filter((ms) => !Number.isNaN(ms));
	return times.length === 0 ? null : Math.min(...times) - CHANNEL_PROBLEM_TOLERANCE_MS;
}

/** A hit of the query (`id`, `context.connection`, `last_at` of the record API), or null. */
export function parseChannelProblemHit(raw: unknown): ChannelProblemHit | null {
	if (!isRecord(raw) || !isServerProblemId(raw.id) || !isRecord(raw.context)) return null;
	const connection = raw.context.connection;
	const lastAt = msOf(raw.last_at);
	if (!isServerProblemId(connection) || Number.isNaN(lastAt)) return null;
	return { id: raw.id, connection, lastAt };
}

/**
 * The entry behind "Details" of every card (by channelProblemKey): the newest hit of its connection,
 * only if its last occurrence is not older than the run of the card (CHANNEL_PROBLEM_TOLERANCE_MS).
 * A card without a run, or whose error has no entry yet, gets none.
 */
export function matchChannelProblems(
	cards: readonly ChannelProblemCard[],
	hits: readonly ChannelProblemHit[]
): Map<string, string> {
	const found = new Map<string, string>();
	for (const card of cards) {
		const runAt = msOf(card.lastRunAt);
		if (Number.isNaN(runAt)) continue;
		const newest = hits
			.filter((hit) => hit.connection === card.connection)
			.reduce<ChannelProblemHit | null>(
				(best, hit) => (best === null || hit.lastAt > best.lastAt ? hit : best),
				null
			);
		if (newest !== null && newest.lastAt >= runAt - CHANNEL_PROBLEM_TOLERANCE_MS) {
			found.set(channelProblemKey(card), newest.id);
		}
	}
	return found;
}

/** An entry from the record API, or null when it is none (an older or a broken form). */
export function parseServerProblem(raw: unknown): ServerProblemRecord | null {
	if (!isRecord(raw) || !isServerProblemId(raw.id)) return null;
	const source = SOURCES.find((value) => value === raw.source);
	const area = AREAS.find((value) => value === raw.area);
	const firstAt = msOf(raw.first_at);
	const lastAt = msOf(raw.last_at);
	if (source === undefined || area === undefined || Number.isNaN(firstAt) || Number.isNaN(lastAt)) {
		return null;
	}
	const count =
		typeof raw.count === 'number' && Number.isInteger(raw.count) && raw.count > 0 ? raw.count : 1;
	return {
		id: raw.id,
		source,
		area,
		code: typeof raw.code === 'string' ? sanitizeProblemText(raw.code, 60) : '',
		message: typeof raw.message === 'string' ? sanitizeProblemText(raw.message) : '',
		context: contextOf(raw.context),
		count,
		firstAt,
		lastAt: Math.max(firstAt, lastAt)
	};
}

/** Names of the kinds of channels in the intent of a failed run. */
const CHANNEL_LABELS: Readonly<Record<string, string>> = Object.freeze({
	calendar: 'Google Calendar',
	telegram: 'Telegram',
	mail: 'Postfach',
	notion: 'Notion',
	github: 'GitHub',
	folder: 'Ordner'
});

/** What a job of the server tried, by its name in the context. */
const JOB_INTENTS: Readonly<Record<string, string>> = Object.freeze({
	recurrence: 'Wiederholungen erzeugen',
	trash: 'Papierkorb aufräumen',
	'client-ops': 'Gemerkte Änderungen aufräumen',
	'login-failures': 'Fehlgeschlagene Anmeldungen aufräumen',
	'startup-recurrence': 'Wiederholungen beim Start nachholen',
	'startup-inbox': 'Eingang beim Start bereinigen',
	'startup-trash': 'Papierkorb beim Start aufräumen'
});

/** Intent of an entry without a known request or job. */
export const SERVER_INTENTS = Object.freeze({
	request: 'Anfrage an den Server',
	channel: 'Kanal im Hintergrund abrufen',
	job: 'Aufgabe im Hintergrund'
});

function intentOfRecord(record: ServerProblemRecord): string {
	const { context } = record;
	if (record.source === 'request') {
		const known =
			context.route === undefined ? null : intentOf(context.method ?? null, context.route);
		return known ?? SERVER_INTENTS.request;
	}
	if (record.source === 'channel') {
		const label = context.channel === undefined ? undefined : CHANNEL_LABELS[context.channel];
		return label === undefined ? SERVER_INTENTS.channel : `${SERVER_INTENTS.channel}: ${label}`;
	}
	return (context.job === undefined ? undefined : JOB_INTENTS[context.job]) ?? SERVER_INTENTS.job;
}

/**
 * An entry of the server as an entry of the dialog: its intent from the request (catalog of
 * intents), the channel or the job; a failed request with its status and route, every other with the
 * result "Vom Server gemeldeter Fehler"; first and last occurrence, count, area and the Server-ID.
 */
export function serverProblemEntry(record: ServerProblemRecord): ProblemEntry {
	const request = record.source === 'request' && record.context.route !== undefined;
	return {
		id: `server-${record.id}`,
		source: 'server',
		intent: intentOfRecord(record),
		at: record.firstAt,
		lastAt: record.lastAt,
		count: record.count,
		outcome: {
			result: record.source === 'request' ? 'response' : 'reported',
			status: record.source === 'request' ? (record.context.status ?? null) : null,
			code: record.code === '' ? null : record.code,
			message: record.message === '' ? null : record.message
		},
		request: request
			? { method: record.context.method ?? null, path: record.context.route ?? '' }
			: null,
		app: null,
		exception: null,
		serverId: record.id,
		correlation: null,
		area: record.area
	};
}
