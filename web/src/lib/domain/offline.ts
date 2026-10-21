// Rules of the outbox of the SPA (OF-2, ADR-0074 and its addenda OF-2, OF-2b and OF-3). Pure: no
// clock, no random source and no storage of its own; the callers pass them in. The rules of the
// server stand in app/pb_hooks/lib/client-ops-rules.js; the identifier, the bounds of the time of the
// device, the six actions and the catalog of the codes are mirrored here, tests/unit/web-offline.test.mjs
// keeps both sides the same.
//
// - An action is one change the user made, never a copy of data: the status of a ticket (the check
//   mark in "Aufgaben", the status in the cell, the panel and the full view; OF-2), its due date in the
//   cell and the panel, and the check mark of an entry of the day plan and its taking back (OF-3). It
//   carries its identifier (`op`) from the first attempt on, so sending it twice changes nothing the
//   second time.
// - Actions follow each other in a chain: the status of a ticket (its changes of the status and the
//   check marks of its entries in the day plan), and its due date. A change that never left the device
//   takes the next one of the same kind in (`expected` stays the one of the first, the wish the one of
//   the last), and one that falls back to the value before goes. Once a request with its identifier
//   may have left the device (`sent`, OF-2b), it is never taken in again: the server answers a known
//   identifier like the first time without comparing the content, so a new wish would be lost. A change
//   behind it, or behind one that waits for a decision, is a new action that waits for it
//   (`dependsOn`), also taking a change back (a counter action, concept §3.3).
// - "Verwerfen" of an action that may have arrived (OF-3) keeps it to the end (`discarded`); since
//   OF-3b the take-backs (`undoes`) follow per value from what the user still wants (`targetOf`,
//   domain/offline-chain.ts), and `fallback` keeps that wish once a discarded action arrived.
// - The display lays the waiting actions over the state of the server (`overlayStatus`,
//   `overlayDue`, `overlayDoneToday`); the stores keep the state of the server.
// - After 48 hours an action is no longer sent on its own (decision of the user 2), after 7 days
//   it goes, never silently: a notice names its ticket (OF-3b round 3), kept on the device until the
//   user closes it (OF-3c, domain/offline-notices.ts).
// - Since OF-4a "＋" creates a ticket or an entry of the inbox (`ticket.create`, `inbox.create`) under
//   an ID of the client (`newRecordId`, ADR-0074 §5): the key comes from the server only, until then
//   the views show "Neu" (`createdTicketOf`, `createdItemOf`). A change of such a ticket goes into the
//   payload of its creation while that never left the device, else it waits for it (`dependsOn`).
//   A creation takes no part in the chains of the values: it names no value before and writes none.
// - Since OF-4b a comment is a creation of its own (`comment.create`) under an ID of the client: it
//   waits for the creation of its ticket "＋" created and for the comment written before it on the
//   same ticket, never taken into another one (concept §3.3); the views show it at once
//   (`keptCommentOf`). Its text is kept until it arrived, was discarded or saved as an entry of the
//   inbox (format 2 of an `inbox.create` with `body`).

import { isCalendarDate, type CalendarDate } from './berlin-date';
import {
	CHECK_MODES,
	checkAction,
	isDone,
	isTicketKind,
	type CheckAction,
	type CheckMode,
	type TicketKind
} from './day-plan';
import { formatBerlinDateTime, formatCalendarDate, toPocketBaseTimestamp } from './format';
import {
	INBOX_BODY_MAX_LENGTH,
	INBOX_TITLE_MAX_LENGTH,
	PRESET_META_KEY,
	presetMeta,
	type InboxItem
} from './inbox';
import { STATUS_LABELS } from './labels';
import { isPriority, isStatus, type Priority, type Status } from './status';
import type { CompletionChoice } from './subtasks';
import {
	COMMENT_MAX_LENGTH,
	TITLE_MAX_LENGTH,
	fromDueInput,
	toDueInput,
	type Comment,
	type Ticket
} from './ticket';

/** The six actions of the first stage (ADR-0074 §2), as the server names them. */
export const OFFLINE_KINDS = Object.freeze([
	'ticket.create',
	'ticket.update',
	'comment.create',
	'inbox.create',
	'dayplan.check',
	'dayplan.uncheck'
] as const);
export type OfflineKind = (typeof OFFLINE_KINDS)[number];

/** Version of `offline_ops` this SPA understands (ADR-0074 §7). */
export const OFFLINE_VERSION = 1;

/** 16 to 64 letters, digits, "_" and "-" (the server); the SPA draws 20 characters a–z0–9. */
export const OP_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
export const OP_LENGTH = 20;
const OP_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** The server keeps the time of the device only from 48 hours before to 5 minutes after its own. */
export const DEVICE_FUTURE_MS = 5 * 60 * 1000;
export const DEVICE_PAST_MS = 48 * 60 * 60 * 1000;

/** Sent on its own until 48 hours after the change (decision of the user 2). */
export const AUTO_SEND_MS = DEVICE_PAST_MS;
/** Kept at most 7 days; the server keeps an identifier 30 days, so it never forgets one first. */
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** At most this many actions and about this many bytes on the device (concept OF-0 §3.2). */
export const OUTBOX_MAX_ACTIONS = 200;
export const OUTBOX_MAX_BYTES = 1_000_000;

/** A write request without an answer after 12 s counts as unknown, not as failed (concept §3.6). */
export const SEND_TIMEOUT_MS = 12_000;
/** The check of the server (`/api/health`) waits 5 s (concept §3.10). */
export const HEALTH_TIMEOUT_MS = 5_000;
/** An action "sending" for longer than this lost its sender (closed or frozen tab). */
export const STALE_SENDING_MS = SEND_TIMEOUT_MS + 3_000;
/**
 * A request may hang longer than its time limit (a proxy, a frozen connection): a lookup that does not
 * find a discarded creation is final only this long after its last request (OF-4a round 2, A5).
 */
export const LOOKUP_FINAL_MS = 5 * 60 * 1000;
/** The lease of the sending tab (concept §3.9): 8 s, renewed every 3 s while there is work. */
export const LEASE_MS = 8_000;
export const LEASE_RENEW_MS = 3_000;
/** Waits after an error of the server (5xx), then at most every 60 s; ±20 % spread. */
export const BACKOFF_STEPS_MS = Object.freeze([2_000, 5_000, 10_000, 30_000, 60_000]);
/** After this many errors of the server in a row the app says "Übertragen gescheitert". */
export const FAILURES_BEFORE_NOTICE = 5;
/** Checks of the server while offline: after 2, 5, 10 and 30 s, then every 60 s (concept §3.10). */
export const CHECK_STEPS_MS = Object.freeze([2_000, 5_000, 10_000, 30_000, 60_000]);

/** The catalog of the codes of the server (ADR-0074 §6), the same texts as the hook. */
export const OFFLINE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_op_invalid: 'Die Kennung der Aktion ist ungültig.',
	validation_op_reused: 'Diese Kennung gehört schon zu einer anderen Aktion.',
	validation_op_applied: 'Diese Aktion wurde schon übertragen.',
	validation_expected_invalid: 'Die erwarteten Werte sind ungültig.',
	validation_ticket_conflict: 'Das Feld wurde inzwischen geändert.',
	validation_dayplan_conflict: 'Der Haken wurde inzwischen geändert.'
});

/** The kind of record a creation makes: "＋" (OF-4a) or a comment (OF-4b). */
export type CreatedKind = 'ticket' | 'inbox' | 'comment';

/**
 * Words of the client for codes PocketBase itself answers to a creation (OF-4a), per kind of the
 * record since round 2 (A10): an ID that is taken (ADR-0074 §5). Not part of the catalog of the hook.
 */
export const CREATE_MESSAGES: Readonly<Record<string, Readonly<Record<CreatedKind, string>>>> =
	Object.freeze({
		validation_not_unique: Object.freeze({
			ticket: 'Die ID des neuen Tickets ist auf dem Server schon vergeben.',
			inbox: 'Die ID des neuen Eingangseintrags ist auf dem Server schon vergeben.',
			comment: 'Die ID des Kommentars ist auf dem Server schon vergeben.'
		})
	});

/**
 * A comment the server refuses without a field (OF-4b): the create rule of `comments` failed, its
 * ticket is not to be seen (not there yet, in the trash, no longer in the area). PocketBase answers
 * 400 without a code.
 */
export const COMMENT_REFUSED_CODE = 'comment_refused';
/**
 * A comment of a ticket "＋" created whose creation the user discarded (OF-4b): it is never sent and
 * waits with its text for "Als Eingangseintrag sichern" or "Verwerfen".
 */
export const SET_ASIDE_CODE = 'ticket_discarded';

/** The message of a conflict as a whole (the hook). */
export const CONFLICT_MESSAGE = 'Das Ticket wurde inzwischen geändert.';

/** Words per field of a conflict (the hook); every other field takes the text of the catalog. */
export const CONFLICT_TEXTS: Readonly<Record<string, string>> = Object.freeze({
	status: 'Der Status wurde inzwischen geändert.',
	due: 'Die Fälligkeit wurde inzwischen geändert.',
	priority: 'Die Priorität wurde inzwischen geändert.',
	assignee: 'Die Zuständigkeit wurde inzwischen geändert.',
	title: 'Der Titel wurde inzwischen geändert.',
	description: 'Die Beschreibung wurde inzwischen geändert.',
	checked: 'Der Haken wurde inzwischen geändert.'
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What GET /api/byl/tickets/create names as `offline_ops`; null before the restart after OF-1. */
export interface OfflineOps {
	version: number;
	kinds: readonly OfflineKind[];
}

function isKind(value: unknown): value is OfflineKind {
	return (OFFLINE_KINDS as readonly unknown[]).includes(value);
}

/** The capability of an answer, null when it is missing, null or of another form. */
export function toOfflineOps(value: unknown): OfflineOps | null {
	if (!isRecord(value)) return null;
	const version = value.version;
	const kinds = value.kinds;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
	if (!Array.isArray(kinds)) return null;
	return { version, kinds: Object.freeze(kinds.filter(isKind)) };
}

/** Whether the server takes the identifier, the time and `expected` for this action. */
export function supportsKind(ops: OfflineOps | null | undefined, kind: OfflineKind): boolean {
	if (ops === null || ops === undefined) return false;
	return ops.version >= OFFLINE_VERSION && ops.kinds.includes(kind);
}

/** A record ID as PocketBase draws it: 15 characters a–z0–9 (ADR-0074 §5). */
export const RECORD_ID_LENGTH = 15;
export const RECORD_ID_PATTERN = /^[a-z0-9]{15}$/;

/**
 * `length` characters a–z0–9 from `fill` (crypto.getRandomValues; there is no randomUUID without a
 * secure context). Bytes of 252 (7 × 36) and above are drawn again (rejection sampling), so every
 * character is equally likely.
 */
function drawn(fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array, length: number): string {
	let id = '';
	while (id.length < length) {
		for (const byte of fill(new Uint8Array(length * 2))) {
			if (byte >= 252) continue;
			id += OP_ALPHABET[byte % OP_ALPHABET.length];
			if (id.length === length) break;
		}
	}
	return id;
}

/** A new identifier of an action: 20 characters a–z0–9 (`drawn`). */
export function newOpId(fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array): string {
	return drawn(fill, OP_LENGTH);
}

/**
 * The ID of a record the client creates (OF-4a, ADR-0074 §5): 15 characters a–z0–9 like PocketBase
 * (about 77 bits), so links /tickets/<id> work before the server has it and every check of a record ID
 * takes it. The server refuses an ID that is taken (`validation_not_unique` at `id`).
 */
export function newRecordId(fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array): string {
	return drawn(fill, RECORD_ID_LENGTH);
}

/** The entry of a list for the `attempt`-th time (1 for the first), the last one from then on. */
function stepOf(steps: readonly number[], attempt: number): number {
	const index = Math.min(Math.max(attempt, 1), steps.length) - 1;
	return steps[index] ?? 60_000;
}

/** The wait after the `attempt`-th error of the server in a row (1 for the first), with its spread. */
export function backoffDelay(attempt: number, random: () => number): number {
	return Math.round(stepOf(BACKOFF_STEPS_MS, attempt) * (0.8 + 0.4 * random()));
}

/** The wait before the `attempt`-th check of the server while offline (1 for the first). */
export function checkDelay(attempt: number): number {
	return stepOf(CHECK_STEPS_MS, attempt);
}

/**
 * queued: waits for the connection; sending: under way; conflict: the field changed meanwhile;
 * refused: the server refused it for good; expired: older than 48 hours, waits for a decision.
 */
export type ActionState = 'queued' | 'sending' | 'conflict' | 'refused' | 'expired';
const ACTION_STATES: readonly ActionState[] = [
	'queued',
	'sending',
	'conflict',
	'refused',
	'expired'
];

/** Why an action waits for a decision: the code of the server and its words. */
export interface ActionOutcome {
	code: string;
	message: string;
	/** A conflict: the value the server has now and when it changed. */
	actual?: string | null;
	updated?: string | null;
	/** Open blocking sub-tasks of a completion (ADR-0033 §2). */
	count?: number;
	/**
	 * The field of a refused creation the user may leave out (OF-4a, concept §3.7: "Ohne Projekt
	 * anlegen"): `project` or `tags`.
	 */
	field?: CreateField;
}

/** The fields of a refused creation of a ticket it may be sent again without (OF-4a). */
export const CREATE_FIELDS = Object.freeze(['project', 'tags'] as const);
export type CreateField = (typeof CREATE_FIELDS)[number];

function isCreateField(value: unknown): value is CreateField {
	return (CREATE_FIELDS as readonly unknown[]).includes(value);
}

/** The code of an entry of the device that this SPA cannot read (another format, damaged). */
export const BROKEN_CODE = 'broken';
/** The code of an action whose time of the device lies in the future (OF-2b): it waits like an old one. */
export const CLOCK_CODE = 'clock';
/** The refusal of a completion with open blocking sub-tasks (ADR-0033 §2). */
export const OPEN_CHILDREN_CODE = 'validation_parent_open_children';
/** The day of the plan is over: read only (ADR-0074 §8, decision of the user 3). */
export const DAY_OVER_CODE = 'validation_dayplan_readonly';
/** The check mark changed meanwhile (ADR-0074 §3): refused for good (OF-3). */
export const CHECK_CONFLICT_CODE = 'validation_dayplan_conflict';

/**
 * The format of an action: 1, or 2 for an entry of the inbox that carries a text (`body`, OF-4b). A
 * build before OF-4b reads only format 1: it would send such an entry without its text, so it shows it
 * as not readable and never sends it.
 */
export type ActionFormat = 1 | 2;

/** What every action kept on the device has (format version 1, see `ActionFormat`). */
export interface ActionBase {
	v: ActionFormat;
	/** The identifier, 20 characters a–z0–9. */
	op: string;
	/** The order on this device. */
	seq: number;
	/** The account; only this account sends it. */
	user: string;
	/** The area at the time of the change (u:… or h:…), '' when unknown. */
	scope: string;
	/** The record the server changes: the ticket, or the entry of the day plan. */
	target: string;
	/** Identifiers that have to arrive first. */
	dependsOn: string[];
	/** Key and title of the ticket at the time of the change, for the list and the dialog. */
	key: string;
	title: string;
	/** Time of the device in ms. */
	createdAt: number;
	state: ActionState;
	attempts: number;
	nextAttemptAt: number;
	sendingSince?: number;
	/**
	 * A request with the identifier may have left the device (set before every attempt, OF-2b): the
	 * action is never taken into another change again.
	 */
	sent?: true;
	/**
	 * The last request with the identifier got no answer (no connection, time limit; OF-3): it may
	 * have arrived. An answer of the server clears it; "Verwerfen" then takes the action back.
	 */
	unanswered?: true;
	/**
	 * A creation "＋" (OF-4a round 2, A5): when its last request left, ms of the device. A lookup that
	 * does not find it is final only LOOKUP_FINAL_MS after it (`mayStillArrive`).
	 */
	lastSentAt?: number;
	/**
	 * A creation the server answered (a refusal) after a request of it got no answer (OF-4a round 2,
	 * A5): that request may still arrive, so "Verwerfen" looks it up instead of deleting it.
	 */
	unansweredBefore?: true;
	/** "Trotzdem übertragen" after 48 hours: sent without the time of the device. */
	late?: boolean;
	outcome?: ActionOutcome;
	/**
	 * "Verwerfen" after the action may have left the device (OF-3): it is still sent to the end with
	 * its identifier, and a refusal drops it without a word (since OF-3b not after 403 or 404); a
	 * take-back behind it brings every value it changes back to what the user wants (OF-3b).
	 */
	discarded?: true;
	/** A take-back (OF-3, "Rücknahme"): the identifier of the action whose change it takes back. */
	undoes?: string;
	/**
	 * What the user wants for a value of this action once it and the later ones are discarded, where
	 * that is not `expected` (OF-3b): a discarded action before it arrived, so the server has its wish.
	 */
	fallback?: Fallback;
}

/** The values a discarded action before an action leaves the user wanting (OF-3b). */
export interface Fallback {
	status?: Status;
	due?: CalendarDate | null;
	/** The mark of the day of the entry of a check mark. */
	doneToday?: boolean;
	/** Per ID the status of a sub-task a completion takes along (round 2). */
	children?: Record<string, Status>;
}

/** A change of the status of a ticket, as kept on the device (format version 1). */
export interface OutboxAction extends ActionBase {
	kind: 'ticket.update';
	/** The wish: only the changed values. */
	payload: { status: Status };
	/** The values the change was based on, per changed field (in the form of the history). */
	expected: { status: Status };
	/** The answer to "N Unteraufgaben sind noch offen – trotzdem erledigen?" (ADR-0033 §2). */
	completion?: CompletionChoice;
	/** The sub-tasks a completion with "complete_children" takes along, for the display. */
	children?: string[];
	/**
	 * Their status before, in the order of `children`, so "Verwerfen" opens them again (OF-3b); null
	 * where it was never seen: no take-back with a guessed value, "Verwerfen" names it (round 2).
	 */
	childrenBefore?: (Status | null)[];
}

/** A change of the due date of a ticket (OF-3): a calendar date or none. */
export interface DueAction extends ActionBase {
	kind: 'ticket.update';
	payload: { due: CalendarDate | null };
	expected: { due: CalendarDate | null };
}

/** The state of an entry of the day plan: its mark of the day and the status of its ticket. */
export interface CheckState {
	doneToday: boolean;
	status: Status;
}

/**
 * The check mark of an entry of the day plan or its taking back (OF-3). `target` is the entry,
 * `ticket` its ticket. `payload.action` is what the check does ("complete" the ticket, or "today"
 * only the mark of the day); a check sends `mode`, taking back sends `action` and `status`.
 */
export interface DayPlanAction extends ActionBase {
	kind: 'dayplan.check' | 'dayplan.uncheck';
	ticket: string;
	/** The kind of the ticket at the time of the change: what the check mark of a task means. */
	ticketKind: TicketKind;
	payload: { action: CheckAction; mode?: CheckMode; status?: Status };
	/** The state the change was based on; the request names it as { checked, status }. */
	expected: CheckState;
	completion?: CompletionChoice;
	children?: string[];
	childrenBefore?: (Status | null)[];
}

/** What "＋" creates as a ticket (OF-4a): the fields of the quick entry and the changes taken in. */
export interface TicketCreatePayload {
	title: string;
	status: Status;
	priority: Priority;
	due: CalendarDate | null;
	project: string | null;
	tags: string[];
	/** The household of the area at the time of the entry, '' for "Privat". */
	household: string;
}

/**
 * A ticket "＋" created (OF-4a): `target` is its ID of the client, sent as `id`; `key` stays '' (the
 * server draws it), `title` is the title for the list and the dialog. It names no value before.
 */
export interface TicketCreateAction extends ActionBase {
	kind: 'ticket.create';
	payload: TicketCreatePayload;
	expected: Record<string, never>;
}

/** What "＋" puts into the inbox (OF-4a): channel "quick", kind "todo", with the chosen values. */
export interface InboxCreatePayload {
	title: string;
	household: string;
	/** Project, tags and priority of the line, the preset of the entry (`source_meta.preset`). */
	preset: { project: string | null; tags: string[]; priority: Priority | null };
	/** The whole text of a comment saved as an entry (OF-4b, "Als Eingangseintrag sichern"). */
	body?: string;
}

/** An entry of the inbox "＋" created (OF-4a): `target` is its ID of the client. */
export interface InboxCreateAction extends ActionBase {
	kind: 'inbox.create';
	payload: InboxCreatePayload;
	expected: Record<string, never>;
}

/** A comment written on a ticket (OF-4b): its text in Markdown, as the editor gives it. */
export interface CommentCreatePayload {
	body: string;
}

/**
 * A comment kept for later (OF-4b, concept §3.3): `target` is its ID of the client, sent as `id`;
 * `ticket` the ticket it belongs to, an ID of the server or of a ticket "＋" created; `key` and `title`
 * name that ticket for the dialog. It waits for the creation of its ticket and for the comment written
 * before it on the same ticket (`dependsOn`); it is never taken into another one.
 */
export interface CommentCreateAction extends ActionBase {
	kind: 'comment.create';
	ticket: string;
	payload: CommentCreatePayload;
	expected: Record<string, never>;
	/**
	 * "Als Eingangseintrag sichern" after it may have arrived (OF-4b round 2, K-3): its text is in the
	 * inbox; it is discarded and only looked up, and found, a notice says that its text is there twice.
	 */
	saved?: true;
}

/**
 * A record created under an ID of the client: "＋" (OF-4a) or a comment (OF-4b). It names no value
 * before and writes none; discarded after it may have left the device, it is only looked up.
 */
export type CreateAction = TicketCreateAction | InboxCreateAction | CommentCreateAction;

/** Every action the device keeps. */
export type KeptAction = OutboxAction | DueAction | DayPlanAction | CreateAction;

/** A ticket "＋" created (OF-4a). */
export function isTicketCreate(action: KeptAction): action is TicketCreateAction {
	return action.kind === 'ticket.create';
}

/** An entry of the inbox "＋" created (OF-4a). */
export function isInboxCreate(action: KeptAction): action is InboxCreateAction {
	return action.kind === 'inbox.create';
}

/** A comment kept for later (OF-4b). */
export function isCommentCreate(action: KeptAction): action is CommentCreateAction {
	return action.kind === 'comment.create';
}

/** A record created under an ID of the client: "＋" (OF-4a) or a comment (OF-4b). */
export function isCreateAction(action: KeptAction): action is CreateAction {
	return isTicketCreate(action) || isInboxCreate(action) || isCommentCreate(action);
}

/**
 * A comment of a ticket "＋" created whose creation the user discarded (OF-4b): it waits with its text
 * for a decision and is never sent.
 */
export function isSetAside(action: KeptAction): boolean {
	return (
		isCommentCreate(action) && action.state === 'refused' && action.outcome?.code === SET_ASIDE_CODE
	);
}

/** A change of the status of a ticket. */
export function isStatusAction(action: KeptAction): action is OutboxAction {
	return action.kind === 'ticket.update' && 'status' in action.payload;
}

/** A change of the due date of a ticket. */
export function isDueAction(action: KeptAction): action is DueAction {
	return action.kind === 'ticket.update' && 'due' in action.payload;
}

/** A check mark of the day plan or its taking back. */
export function isDayPlanAction(action: KeptAction): action is DayPlanAction {
	return action.kind === 'dayplan.check' || action.kind === 'dayplan.uncheck';
}

/**
 * The ticket an action belongs to: its target, or the ticket of the entry of the day plan or of the
 * comment (OF-4b); for an entry of the inbox "＋" created (OF-4a) the ID of that entry, which no ticket
 * has.
 */
export function ticketOf(action: KeptAction): string {
	return isDayPlanAction(action) || isCommentCreate(action) ? action.ticket : action.target;
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function finite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function textOrNullOf(value: unknown): string | null | undefined {
	return typeof value === 'string' || value === null ? value : undefined;
}

function completionOf(value: unknown): CompletionChoice | undefined {
	return value === 'force' || value === 'complete_children' ? value : undefined;
}

function outcomeOf(value: unknown): ActionOutcome | undefined {
	if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') {
		return undefined;
	}
	const actual = textOrNullOf(value.actual);
	const updated = textOrNullOf(value.updated);
	return {
		code: value.code,
		message: value.message,
		...(actual !== undefined && { actual }),
		...(updated !== undefined && { updated }),
		...(finite(value.count) && { count: value.count }),
		...(isCreateField(value.field) && { field: value.field })
	};
}

/** A due date as kept: a calendar date or null; undefined for anything else. */
function dueOf(value: unknown): CalendarDate | null | undefined {
	if (value === null) return null;
	return typeof value === 'string' && isCalendarDate(value) ? value : undefined;
}

/** What a discarded action before leaves the user wanting (OF-3b); null when it is broken. */
function fallbackFrom(value: unknown): Fallback | null | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return null;
	const due = value.due === undefined ? undefined : dueOf(value.due);
	const children = value.children;
	const valid =
		(value.status === undefined || isStatus(value.status)) &&
		(value.due === undefined || due !== undefined) &&
		(value.doneToday === undefined || typeof value.doneToday === 'boolean') &&
		(children === undefined || (isRecord(children) && Object.values(children).every(isStatus)));
	if (!valid) return null;
	const along = isRecord(children) ? (children as Record<string, Status>) : {};
	const fallback: Fallback = {
		...(isStatus(value.status) && { status: value.status }),
		...(due !== undefined && { due }),
		...(typeof value.doneToday === 'boolean' && { doneToday: value.doneToday }),
		...(Object.keys(along).length > 0 && { children: { ...along } })
	};
	return Object.keys(fallback).length === 0 ? undefined : fallback;
}

/** The fields every format of an action shares, null when one of them is broken. */
function baseOf(raw: Record<string, unknown>, op: string, user: string): ActionBase | null {
	const state = ACTION_STATES.find((entry) => entry === raw.state);
	const fallback = fallbackFrom(raw.fallback);
	const valid =
		(raw.v === 1 || raw.v === 2) &&
		typeof raw.target === 'string' &&
		raw.target !== '' &&
		finite(raw.seq) &&
		finite(raw.createdAt) &&
		state !== undefined &&
		isStringList(raw.dependsOn) &&
		fallback !== null &&
		(raw.undoes === undefined || (typeof raw.undoes === 'string' && OP_PATTERN.test(raw.undoes)));
	if (!valid || state === undefined || fallback === null) return null;
	const outcome = outcomeOf(raw.outcome);
	return {
		v: raw.v as ActionFormat,
		op,
		seq: raw.seq as number,
		user,
		scope: typeof raw.scope === 'string' ? raw.scope : '',
		target: raw.target as string,
		dependsOn: [...(raw.dependsOn as string[])],
		key: typeof raw.key === 'string' ? raw.key : '',
		title: typeof raw.title === 'string' ? raw.title : '',
		createdAt: raw.createdAt as number,
		state,
		attempts: finite(raw.attempts) ? raw.attempts : 0,
		nextAttemptAt: finite(raw.nextAttemptAt) ? raw.nextAttemptAt : 0,
		...(finite(raw.sendingSince) && { sendingSince: raw.sendingSince }),
		...(raw.sent === true && { sent: true as const }),
		...(raw.unanswered === true && { unanswered: true as const }),
		...(finite(raw.lastSentAt) && { lastSentAt: raw.lastSentAt }),
		...(raw.unansweredBefore === true && { unansweredBefore: true as const }),
		...(raw.late === true && { late: true }),
		...(outcome !== undefined && { outcome }),
		...(raw.discarded === true && { discarded: true as const }),
		...(typeof raw.undoes === 'string' && { undoes: raw.undoes }),
		...(fallback !== undefined && { fallback })
	};
}

/**
 * The answer to open sub-tasks, the sub-tasks taken along and their status before (OF-3b), null when
 * one of them is broken.
 */
function completionPartOf(
	raw: Record<string, unknown>
): Pick<OutboxAction, 'completion' | 'children' | 'childrenBefore'> | null {
	const completion = completionOf(raw.completion);
	if (raw.completion !== undefined && completion === undefined) return null;
	if (raw.children !== undefined && !isStringList(raw.children)) return null;
	const before = raw.childrenBefore;
	if (before !== undefined) {
		const children = Array.isArray(raw.children) ? raw.children : [];
		const valid =
			Array.isArray(before) &&
			before.length === children.length &&
			before.every((entry) => entry === null || isStatus(entry));
		if (!valid) return null;
	}
	return {
		...(completion !== undefined && { completion }),
		...(raw.children !== undefined && { children: [...(raw.children as string[])] }),
		...(before !== undefined && { childrenBefore: [...(before as (Status | null)[])] })
	};
}

/** The change of a ticket: of the status, or (OF-3) of the due date. */
function ticketActionOf(
	raw: Record<string, unknown>,
	base: ActionBase,
	payload: Record<string, unknown>,
	expected: Record<string, unknown>
): OutboxAction | DueAction | null {
	if ('status' in payload) {
		const part = completionPartOf(raw);
		if (!isStatus(payload.status) || !isStatus(expected.status) || part === null) return null;
		return {
			...base,
			kind: 'ticket.update',
			payload: { status: payload.status },
			expected: { status: expected.status },
			...part
		};
	}
	const due = dueOf(payload.due);
	const before = dueOf(expected.due);
	if (due === undefined || before === undefined) return null;
	return { ...base, kind: 'ticket.update', payload: { due }, expected: { due: before } };
}

function checkActionOf(value: unknown): CheckAction | undefined {
	return value === 'complete' || value === 'today' ? value : undefined;
}

/** A check mark of the day plan or its taking back (OF-3). */
function dayPlanActionOf(
	raw: Record<string, unknown>,
	base: ActionBase,
	payload: Record<string, unknown>,
	expected: Record<string, unknown>
): DayPlanAction | null {
	const kind = raw.kind === 'dayplan.check' ? 'dayplan.check' : 'dayplan.uncheck';
	const action = checkActionOf(payload.action);
	const mode = (CHECK_MODES as readonly unknown[]).includes(payload.mode)
		? (payload.mode as CheckMode)
		: undefined;
	const part = completionPartOf(raw);
	const valid =
		typeof raw.ticket === 'string' &&
		raw.ticket !== '' &&
		isTicketKind(raw.ticketKind) &&
		action !== undefined &&
		(kind === 'dayplan.check' ? mode !== undefined : payload.mode === undefined) &&
		(payload.status === undefined || isStatus(payload.status)) &&
		typeof expected.doneToday === 'boolean' &&
		isStatus(expected.status) &&
		part !== null;
	if (!valid || action === undefined || part === null) return null;
	return {
		...base,
		kind,
		ticket: raw.ticket as string,
		ticketKind: raw.ticketKind as TicketKind,
		payload: {
			action,
			...(mode !== undefined && { mode }),
			...(isStatus(payload.status) && { status: payload.status })
		},
		expected: { doneToday: expected.doneToday as boolean, status: expected.status as Status },
		...part
	};
}

/** A record ID or null; undefined for anything else. */
function recordIdOrNullOf(value: unknown): string | null | undefined {
	if (value === null) return null;
	return typeof value === 'string' && RECORD_ID_PATTERN.test(value) ? value : undefined;
}

/** Record IDs without doubles; null for anything else. */
function recordIdsOf(value: unknown): string[] | null {
	const valid = (entry: unknown) => typeof entry === 'string' && RECORD_ID_PATTERN.test(entry);
	if (!Array.isArray(value) || !value.every(valid)) return null;
	return [...new Set(value as string[])];
}

/** A title of a creation: not empty, at most `max` characters; null for anything else. */
function titleOf(value: unknown, max: number): string | null {
	return typeof value === 'string' && value.trim() !== '' && value.length <= max ? value : null;
}

/**
 * A ticket or an entry of the inbox "＋" created (OF-4a): its ID of the client as `target`, the title,
 * the household ('' or a record ID) and the values of the line. It takes nothing back and depends on
 * nothing; anything else is not one of this build.
 */
function createActionOf(
	raw: Record<string, unknown>,
	base: ActionBase,
	payload: Record<string, unknown>
): CreateAction | null {
	if (!RECORD_ID_PATTERN.test(base.target) || base.undoes !== undefined) return null;
	if (base.dependsOn.length > 0 || base.fallback !== undefined) return null;
	const household = payload.household === '' ? '' : recordIdOrNullOf(payload.household);
	if (typeof household !== 'string') return null;
	if (raw.kind === 'inbox.create') {
		const title = titleOf(payload.title, INBOX_TITLE_MAX_LENGTH);
		const preset = isRecord(payload.preset) ? payload.preset : null;
		const project = recordIdOrNullOf(preset?.project);
		const tags = recordIdsOf(preset?.tags);
		const chosen = preset?.priority;
		const priority = chosen === null ? null : isPriority(chosen) ? chosen : undefined;
		if (title === null || project === undefined || tags === null || priority === undefined) {
			return null;
		}
		// The text of a comment saved as an entry (OF-4b): at most what the server keeps.
		const body = payload.body;
		const textual = typeof body === 'string' && body.length <= INBOX_BODY_MAX_LENGTH;
		if (body !== undefined && !textual) return null;
		return {
			...base,
			kind: 'inbox.create',
			payload: {
				title,
				household,
				preset: { project, tags, priority },
				...(typeof body === 'string' && { body })
			},
			expected: {}
		};
	}
	const title = titleOf(payload.title, TITLE_MAX_LENGTH);
	const due = dueOf(payload.due);
	const project = recordIdOrNullOf(payload.project);
	const tags = recordIdsOf(payload.tags);
	const valid =
		title !== null &&
		isStatus(payload.status) &&
		isPriority(payload.priority) &&
		due !== undefined &&
		project !== undefined &&
		tags !== null;
	if (!valid || title === null || due === undefined || project === undefined || tags === null) {
		return null;
	}
	return {
		...base,
		kind: 'ticket.create',
		payload: {
			title,
			status: payload.status as Status,
			priority: payload.priority as Priority,
			due,
			project,
			tags,
			household
		},
		expected: {}
	};
}

/**
 * A comment kept for later (OF-4b): its ID of the client as `target`, the ID of its ticket, a text that
 * is not empty and not longer than a comment may be; saved as an entry after it may have arrived only
 * once discarded (round 2, K-3). It takes nothing back; anything else is not one of this build.
 */
function commentActionOf(
	raw: Record<string, unknown>,
	base: ActionBase,
	payload: Record<string, unknown>
): CommentCreateAction | null {
	if (!RECORD_ID_PATTERN.test(base.target) || base.undoes !== undefined) return null;
	if (base.fallback !== undefined) return null;
	const ticket = raw.ticket;
	const body = payload.body;
	const valid =
		typeof ticket === 'string' &&
		RECORD_ID_PATTERN.test(ticket) &&
		typeof body === 'string' &&
		body.trim() !== '' &&
		body.length <= COMMENT_MAX_LENGTH &&
		(raw.saved === undefined || (raw.saved === true && base.discarded === true));
	if (!valid) return null;
	return {
		...base,
		kind: 'comment.create',
		ticket,
		payload: { body },
		expected: {},
		...(raw.saved === true && { saved: true as const })
	};
}

/**
 * Whether the format of an action fits its content (OF-4b): format 2 is exactly an entry of the inbox
 * with a text, which a build before OF-4b would send without it.
 */
function formatFits(action: KeptAction): boolean {
	return (action.v === 2) === (isInboxCreate(action) && action.payload.body !== undefined);
}

/**
 * An entry of the device as an action. One of another format or damaged comes back as a refused
 * action with the code BROKEN_CODE, so it is shown with "Verwerfen" and never sent; one without an
 * identifier or an account of its own comes back as null (it belongs to nobody and goes).
 */
export function parseAction(raw: unknown): KeptAction | null {
	if (!isRecord(raw) || typeof raw.op !== 'string' || !OP_PATTERN.test(raw.op)) return null;
	if (typeof raw.user !== 'string' || raw.user === '') return null;
	const base = baseOf(raw, raw.op, raw.user);
	const payload = isRecord(raw.payload) ? raw.payload : null;
	const expected = isRecord(raw.expected) ? raw.expected : null;
	let action: KeptAction | null = null;
	if (base !== null && payload !== null && expected !== null) {
		if (raw.kind === 'ticket.update') action = ticketActionOf(raw, base, payload, expected);
		else if (raw.kind === 'dayplan.check' || raw.kind === 'dayplan.uncheck') {
			action = dayPlanActionOf(raw, base, payload, expected);
		} else if (raw.kind === 'ticket.create' || raw.kind === 'inbox.create') {
			action = createActionOf(raw, base, payload);
		} else if (raw.kind === 'comment.create') {
			action = commentActionOf(raw, base, payload);
		}
	}
	if (action !== null && !formatFits(action)) action = null;
	return action ?? brokenAction(raw.op, raw.user, raw);
}

/**
 * Whether an entry of the device is still the action as `known` (same content and state), for the
 * compare-and-swap of the storage (OF-2b): both are read the same way, so the order of their keys
 * does not matter.
 */
export function sameAction(stored: unknown, known: KeptAction): boolean {
	const parsed = parseAction(stored);
	return parsed !== null && JSON.stringify(parsed) === JSON.stringify(parseAction(known));
}

function brokenAction(op: string, user: string, raw: Record<string, unknown>): OutboxAction {
	return {
		v: 1,
		op,
		seq: finite(raw.seq) ? raw.seq : 0,
		user,
		scope: '',
		kind: 'ticket.update',
		target: typeof raw.target === 'string' ? raw.target : '',
		dependsOn: [],
		payload: { status: 'open' },
		expected: { status: 'open' },
		key: typeof raw.key === 'string' ? raw.key : '',
		title: typeof raw.title === 'string' ? raw.title : '',
		createdAt: finite(raw.createdAt) ? raw.createdAt : 0,
		state: 'refused',
		attempts: 0,
		nextAttemptAt: 0,
		outcome: { code: BROKEN_CODE, message: OFFLINE_TEXTS.broken }
	};
}

/** Whether an action is an entry the SPA cannot read. */
export function isBroken(action: KeptAction): boolean {
	return action.outcome?.code === BROKEN_CODE;
}

/** Waits or is under way: the display lays it over the ticket and marks it. */
export function isWaiting(action: Pick<ActionBase, 'state'>): boolean {
	return action.state === 'queued' || action.state === 'sending';
}

/** Waits for a decision of the user (conflict, refused, expired). */
export function needsDecision(action: Pick<ActionBase, 'state'>): boolean {
	return !isWaiting(action);
}

/** The actions in their order on the device. */
export function inOrder<A extends Pick<ActionBase, 'seq' | 'createdAt'>>(
	actions: Iterable<A>
): A[] {
	return [...actions].sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt);
}

/**
 * The state of an entry after a check mark of the day plan, as the server sets it (OF-3): a check of
 * the day sets the mark, completing sets "done"; taking the mark of the day back clears it, taking a
 * completion back opens the ticket again with the status sent ("Offen" without one), but only when
 * it is done.
 */
export function checkWish(
	action: Pick<DayPlanAction, 'kind' | 'payload' | 'expected'>
): CheckState {
	const { payload, expected } = action;
	if (action.kind === 'dayplan.check') {
		return payload.action === 'today'
			? { doneToday: true, status: expected.status }
			: { doneToday: expected.doneToday, status: 'done' };
	}
	if (payload.action === 'today') return { doneToday: false, status: expected.status };
	const reopened = expected.status === 'done' ? (payload.status ?? 'open') : expected.status;
	return { doneToday: expected.doneToday, status: reopened };
}

/** The status an action gives the ticket `id`, null when it leaves the status alone. */
function statusOf(action: KeptAction, id: string): Status | null {
	if (isStatusAction(action)) return action.target === id ? action.payload.status : null;
	if (isTicketCreate(action)) return action.target === id ? action.payload.status : null;
	if (!isDayPlanAction(action) || action.ticket !== id) return null;
	const status = checkWish(action).status;
	return status === action.expected.status ? null : status;
}

/**
 * Whether an action belongs to the chain of the status of the ticket `id`; since OF-4a also its
 * creation, so a change waits for it (or goes into it, `planTicketStatus`), but not a discarded one,
 * which is only looked up.
 */
function inStatusChain(action: KeptAction, id: string): boolean {
	return (
		(isStatusAction(action) && action.target === id) ||
		(isDayPlanAction(action) && action.ticket === id) ||
		(isTicketCreate(action) && action.target === id && action.discarded !== true)
	);
}

interface StatusTicket {
	id: string;
	status: Status;
	completedAt: string | null;
}

/** Whether a waiting completion with "Unteraufgaben mit erledigen" takes the ticket along. */
function takesAlong(action: KeptAction, id: string): boolean {
	if (!isStatusAction(action) && !isDayPlanAction(action)) return false;
	if (action.completion !== 'complete_children') return false;
	const completes = isStatusAction(action)
		? action.payload.status === 'done'
		: checkWish(action).status === 'done';
	return completes && action.children?.includes(id) === true;
}

/**
 * The ticket as the waiting actions make it: their status in order, `completedAt` from the time of
 * the device of the completion (only for the display; the server sets its own). A check mark of the
 * day plan that completes the ticket or opens it again counts as well (OF-3). A sub-task a waiting
 * completion with "complete_children" takes along shows as done as well. Actions waiting for a
 * decision lay nothing over it. Without such an action the ticket itself comes back.
 */
export function overlayStatus<T extends StatusTicket>(ticket: T, actions: Iterable<KeptAction>): T {
	let status: Status | null = null;
	let at = 0;
	for (const action of inOrder(actions)) {
		if (!isWaiting(action)) continue;
		const own = statusOf(action, ticket.id);
		if (own !== null) {
			status = own;
			at = action.createdAt;
		} else if (takesAlong(action, ticket.id)) {
			status = 'done';
			at = action.createdAt;
		}
	}
	if (status === null || status === ticket.status) return ticket;
	const completedAt = status === 'done' ? (ticket.completedAt ?? toPocketBaseTimestamp(at)) : null;
	return { ...ticket, status, completedAt };
}

/** The ticket with the due date of its last waiting change of the due date (OF-3). */
export function overlayDue<T extends { id: string; due: CalendarDate | null }>(
	ticket: T,
	actions: Iterable<KeptAction>
): T {
	let due: CalendarDate | null | undefined;
	for (const action of inOrder(actions)) {
		if (isWaiting(action) && isDueAction(action) && action.target === ticket.id) {
			due = action.payload.due;
		}
	}
	return due === undefined || due === ticket.due ? ticket : { ...ticket, due };
}

/** The mark of the day of an entry of the day plan as its waiting check marks make it (OF-3). */
export function overlayDoneToday(
	item: { id: string; doneToday: boolean },
	actions: Iterable<KeptAction>
): boolean {
	let doneToday = item.doneToday;
	for (const action of inOrder(actions)) {
		if (isWaiting(action) && isDayPlanAction(action) && action.target === item.id) {
			doneToday = checkWish(action).doneToday;
		}
	}
	return doneToday;
}

/** The status the server will have once every open action of the ticket arrived. */
export function chainedStatus(base: Status, actions: readonly KeptAction[]): Status {
	let status = base;
	for (const action of actions) {
		if (isStatusAction(action)) status = action.payload.status;
		else if (isDayPlanAction(action)) status = checkWish(action).status;
		else if (isTicketCreate(action)) status = action.payload.status;
	}
	return status;
}

// ----- values and what the user wants of them (OF-3b) -----

/**
 * A value the outbox reads or changes (OF-3b): the status or the due date of a ticket, the mark of the
 * day of an entry of the day plan. The sub-tasks a completion takes along are their own tickets.
 */
export type Feature = `status:${string}` | `due:${string}` | `mark:${string}`;
export type FeatureValue = Status | CalendarDate | boolean | null;

export function statusFeature(ticket: string): Feature {
	return `status:${ticket}`;
}

export function dueFeature(ticket: string): Feature {
	return `due:${ticket}`;
}

export function markFeature(entry: string): Feature {
	return `mark:${entry}`;
}

/** The identifiers of the actions, for `isDerived` and `isWill`. */
export function opsOf(actions: readonly KeptAction[]): ReadonlySet<string> {
	return new Set(actions.map((action) => action.op));
}

/** The sub-tasks a completion takes along, each with its status before or null where unknown. */
function alongOf(action: KeptAction): [string, Status | null][] {
	if (!isStatusAction(action) && !isDayPlanAction(action)) return [];
	if (action.completion !== 'complete_children') return [];
	const wish = isStatusAction(action) ? action.payload.status : checkWish(action).status;
	if (wish !== 'done') return [];
	const children = action.children ?? [];
	const before = action.childrenBefore;
	const known = before !== undefined && before.length === children.length;
	return children.map((id, index): [string, Status | null] => [
		id,
		known ? (before[index] ?? null) : null
	]);
}

/** The sub-tasks a completion takes along with their status before, where both are known (OF-3b). */
function takenAlong(action: KeptAction): [string, Status][] {
	return alongOf(action).filter((entry): entry is [string, Status] => entry[1] !== null);
}

/**
 * The sub-tasks a completion takes along whose status before is unknown (OF-3b round 2): never seen,
 * or kept by an older build. "Verwerfen" takes none of them back with a guessed value and says so.
 */
export function unknownChildren(action: KeptAction): string[] {
	return alongOf(action)
		.filter(([, before]) => before === null)
		.map(([id]) => id);
}

/** The status of every sub-task a completion takes along, known before or not (round 2). */
export function childFeaturesOf(action: KeptAction): Feature[] {
	return alongOf(action).map(([id]) => statusFeature(id));
}

/** The sub-tasks a completion with "Unteraufgaben mit erledigen" takes along (round 3). */
export function childrenAlong(action: KeptAction): string[] {
	return alongOf(action).map(([id]) => id);
}

/** The sub-task of `feature` when the action takes it along, else null. */
function childOf(action: KeptAction, feature: Feature): string | null {
	const id = feature.startsWith('status:') ? feature.slice('status:'.length) : null;
	if (id === null || id === ticketOf(action)) return null;
	return alongOf(action).some(([child]) => child === id) ? id : null;
}

/**
 * The action with `value` as the status before of the sub-task of `feature` it takes along (round 2):
 * like `expected`, it follows from the actions before it while it never left the device.
 */
export function withChildBefore<A extends KeptAction>(
	action: A,
	feature: Feature,
	value: FeatureValue
): A {
	const child = childOf(action, feature);
	const completion = isStatusAction(action) || isDayPlanAction(action);
	if (child === null || !completion || !isStatus(value)) return action;
	const children = action.children ?? [];
	const index = children.indexOf(child);
	const before = action.childrenBefore ?? children.map(() => null);
	if (before.length !== children.length || before[index] === value) return action;
	return { ...action, childrenBefore: before.map((entry, at) => (at === index ? value : entry)) };
}

/**
 * The values a request of the action names as the ones before (its `expected`); none for a creation
 * (OF-4a): it takes part in no chain of a value.
 */
export function expectedOf(action: KeptAction): Map<Feature, FeatureValue> {
	if (isCreateAction(action)) return new Map();
	if (isStatusAction(action)) {
		return new Map<Feature, FeatureValue>([[statusFeature(action.target), action.expected.status]]);
	}
	if (isDueAction(action)) {
		return new Map<Feature, FeatureValue>([[dueFeature(action.target), action.expected.due]]);
	}
	return new Map<Feature, FeatureValue>([
		[statusFeature(action.ticket), action.expected.status],
		[markFeature(action.target), action.expected.doneToday]
	]);
}

/** The values before the action: its `expected`, and the status before of the sub-tasks it takes along. */
export function priorOf(action: KeptAction): Map<Feature, FeatureValue> {
	const prior = expectedOf(action);
	for (const [id, status] of takenAlong(action)) {
		if (!prior.has(statusFeature(id))) prior.set(statusFeature(id), status);
	}
	return prior;
}

/**
 * The values the action sets once it arrives: the status or the due date it sends, what a check mark
 * changes (`checkWish`), and "done" for the sub-tasks a completion takes along.
 */
export function writesOf(action: KeptAction): Map<Feature, FeatureValue> {
	const writes = new Map<Feature, FeatureValue>();
	// A creation (OF-4a) changes no value of a record that was there before.
	if (isCreateAction(action)) return writes;
	if (isStatusAction(action)) writes.set(statusFeature(action.target), action.payload.status);
	else if (isDueAction(action)) writes.set(dueFeature(action.target), action.payload.due);
	else {
		const wish = checkWish(action);
		if (wish.doneToday !== action.expected.doneToday) {
			writes.set(markFeature(action.target), wish.doneToday);
		}
		if (wish.status !== action.expected.status) {
			writes.set(statusFeature(action.ticket), wish.status);
		}
	}
	for (const [id] of takenAlong(action)) {
		if (!writes.has(statusFeature(id))) writes.set(statusFeature(id), 'done');
	}
	return writes;
}

/**
 * What the user wants of the values with the action (OF-3b): what it sends; for a check mark what it
 * is for, also where the server has that already (a check of the day the mark, a completion "done",
 * taking a completion back the status it opens the ticket with).
 */
export function intentOf(action: KeptAction): Map<Feature, FeatureValue> {
	if (!isDayPlanAction(action)) return writesOf(action);
	const intent = new Map<Feature, FeatureValue>();
	const { payload } = action;
	if (payload.action === 'today') {
		intent.set(markFeature(action.target), action.kind === 'dayplan.check');
	} else if (action.kind === 'dayplan.check') {
		intent.set(statusFeature(action.ticket), 'done');
	} else if (action.expected.status === 'done') {
		intent.set(statusFeature(action.ticket), payload.status ?? 'open');
	}
	for (const [id] of takenAlong(action)) {
		if (!intent.has(statusFeature(id))) intent.set(statusFeature(id), 'done');
	}
	return intent;
}

/** The action with `value` as the value before of `feature`; itself where it does not name it. */
export function withExpected<A extends KeptAction>(
	action: A,
	feature: Feature,
	value: FeatureValue
): A {
	if (isStatusAction(action)) {
		if (feature !== statusFeature(action.target) || !isStatus(value)) return action;
		return value === action.expected.status ? action : { ...action, expected: { status: value } };
	}
	if (isDueAction(action)) {
		const due = typeof value === 'string' || value === null ? dueOf(value) : undefined;
		if (feature !== dueFeature(action.target) || due === undefined) return action;
		return due === action.expected.due ? action : { ...action, expected: { due } };
	}
	if (!isDayPlanAction(action)) return action;
	if (feature === statusFeature(action.ticket) && isStatus(value)) {
		if (value === action.expected.status) return action;
		return { ...action, expected: { ...action.expected, status: value } };
	}
	if (feature === markFeature(action.target) && typeof value === 'boolean') {
		if (value === action.expected.doneToday) return action;
		return { ...action, expected: { ...action.expected, doneToday: value } };
	}
	return action;
}

/** The key of `feature` in the fallback of the action, null where it has none for it. */
function fallbackKey(
	action: KeptAction,
	feature: Feature
): Exclude<keyof Fallback, 'children'> | null {
	if (isStatusAction(action)) return feature === statusFeature(action.target) ? 'status' : null;
	if (isDueAction(action)) return feature === dueFeature(action.target) ? 'due' : null;
	if (!isDayPlanAction(action)) return null;
	if (feature === statusFeature(action.ticket)) return 'status';
	return feature === markFeature(action.target) ? 'doneToday' : null;
}

/**
 * What the user wants for `feature` once the action and the later ones are discarded, if not
 * `expected`; for a sub-task it takes along, if not its status before (round 2).
 */
export function fallbackOf(action: KeptAction, feature: Feature): FeatureValue | undefined {
	const child = childOf(action, feature);
	if (child !== null) return action.fallback?.children?.[child];
	const key = fallbackKey(action, feature);
	return key === null ? undefined : action.fallback?.[key];
}

/** The action with `value` as its fallback for `feature` (undefined drops it). */
export function withFallback<A extends KeptAction>(
	action: A,
	feature: Feature,
	value: FeatureValue | undefined
): A {
	const child = childOf(action, feature);
	const key = child === null ? fallbackKey(action, feature) : null;
	if ((child === null && key === null) || fallbackOf(action, feature) === value) return action;
	const fallback: Fallback = { ...action.fallback };
	if (child !== null) {
		if (value !== undefined && !isStatus(value)) return action;
		const children: Record<string, Status> = { ...fallback.children };
		if (value === undefined) delete children[child];
		else children[child] = value;
		if (Object.keys(children).length === 0) delete fallback.children;
		else fallback.children = children;
	} else if (value === undefined && key !== null) {
		delete fallback[key];
	} else if (key === 'status' && isStatus(value)) {
		fallback.status = value;
	} else if (key === 'doneToday' && typeof value === 'boolean') {
		fallback.doneToday = value;
	} else if (key === 'due' && (typeof value === 'string' || value === null)) {
		const due = dueOf(value);
		if (due === undefined) return action;
		fallback.due = due;
	} else {
		return action;
	}
	const next = { ...action };
	if (Object.keys(fallback).length === 0) delete next.fallback;
	else next.fallback = fallback;
	return next;
}

/** A take-back ("Rücknahme"): the action of another one taken back. */
export function isTakeBack(action: KeptAction): boolean {
	return action.undoes !== undefined;
}

/** Never left the device and waits: what it is based on may still change (OF-3b). */
export function isFree(action: KeptAction): boolean {
	return (action.state === 'queued' || action.state === 'expired') && action.sent !== true;
}

/**
 * A take-back the outbox keeps in line with the discarded action before it (OF-3b): free, and the
 * action it takes back is still there. Once that one went, the take-back carries what the user wants.
 */
export function isDerived(action: KeptAction, present: ReadonlySet<string>): boolean {
	return action.undoes !== undefined && isFree(action) && present.has(action.undoes);
}

/** Whether the user still wants the change of the action: not discarded, and not derived. */
export function isWill(action: KeptAction, present: ReadonlySet<string>): boolean {
	return action.discarded !== true && !isDerived(action, present);
}

/** The value before `feature` of the first of `members` that names it, with what the user wants of it. */
export function chainBaseOf(
	members: readonly KeptAction[],
	feature: Feature
): { server: FeatureValue; will: FeatureValue; first: KeptAction } | undefined {
	const first = members.find((action) => priorOf(action).has(feature));
	if (first === undefined) return undefined;
	const server = priorOf(first).get(feature) as FeatureValue;
	const fallback = fallbackOf(first, feature);
	return { server, will: fallback === undefined ? server : fallback, first };
}

/**
 * Where the user wants a value once every action of a chain arrived (I1 of OF-3b): the wish of the last
 * action of `members` they keep for it, else the value before the first one; undefined when none
 * names it. Derived take-backs do not count, they follow from it.
 */
export function targetOf(
	members: readonly KeptAction[],
	feature: Feature,
	present: ReadonlySet<string>
): FeatureValue | undefined {
	const list = inOrder(members).filter((action) => !isDerived(action, present));
	const base = chainBaseOf(list, feature);
	if (base === undefined) return undefined;
	for (const action of [...list].reverse()) {
		const intent = intentOf(action);
		if (intent.has(feature) && isWill(action, present)) return intent.get(feature) as FeatureValue;
	}
	return base.will;
}

/** What the user wants for a value without `last` (OF-3b): a change back to it drops `last`. */
function willWithout(
	mine: readonly KeptAction[],
	last: KeptAction,
	feature: Feature,
	present: ReadonlySet<string>
): FeatureValue | undefined {
	const others = mine.filter((action) => action.op !== last.op);
	const target = targetOf(others, feature, present);
	if (target !== undefined) return target;
	const fallback = fallbackOf(last, feature);
	return fallback === undefined ? expectedOf(last).get(feature) : fallback;
}

/** The value the action expects of `feature` as a state of the server (for `rebasedBehind`). */
export function stateBefore(action: KeptAction): ServerState {
	if (isStatusAction(action)) return { status: action.expected.status };
	if (isDueAction(action)) return { due: action.expected.due };
	if (!isDayPlanAction(action)) return {};
	return {
		status: action.expected.status,
		check: { item: action.target, doneToday: action.expected.doneToday }
	};
}

/** The values of `state` for what the action reads. */
export function valuesOfState(action: KeptAction, state: ServerState): Map<Feature, FeatureValue> {
	const values = new Map<Feature, FeatureValue>();
	for (const [feature] of expectedOf(action)) {
		if (feature.startsWith('status:') && state.status !== undefined) {
			values.set(feature, state.status);
		} else if (feature.startsWith('due:') && state.due !== undefined) {
			values.set(feature, state.due);
		} else if (
			isDayPlanAction(action) &&
			feature === markFeature(action.target) &&
			state.check?.item === action.target
		) {
			values.set(feature, state.check.doneToday);
		}
	}
	return values;
}

/** A change of the status the user made. */
export interface StatusChange {
	target: string;
	key: string;
	title: string;
	scope: string;
	/** The status of the server the change is based on. */
	base: Status;
	status: Status;
	completion?: CompletionChoice;
	children?: readonly string[];
	/** The status of each sub-task in `children` before (OF-3b), null where never seen. */
	childrenBefore?: readonly (Status | null)[];
}

/** A change of the due date the user made (OF-3). */
export interface DueChange {
	target: string;
	key: string;
	title: string;
	scope: string;
	/** The due date of the server the change is based on. */
	base: CalendarDate | null;
	due: CalendarDate | null;
}

/** A check mark of the day plan or its taking back the user made (OF-3). */
export interface CheckChange {
	kind: 'dayplan.check' | 'dayplan.uncheck';
	/** The entry. */
	target: string;
	ticket: string;
	ticketKind: TicketKind;
	key: string;
	title: string;
	scope: string;
	/** The state of the server the change is based on: the mark of the day and the status. */
	base: CheckState;
	/** A check: "check", "today" ("Nur für heute abhaken") or "complete" ("Vorhaben abschließen"). */
	mode?: CheckMode;
	/** Taking back: the mark of the day or the completion; without one the mark of the day first. */
	action?: CheckAction;
	/** Taking back a completion: the status to open the ticket with ("Offen" without one). */
	status?: Status;
	completion?: CompletionChoice;
	children?: readonly string[];
	childrenBefore?: readonly (Status | null)[];
}

/** What the outbox does with a change: send it now, keep it, take it into one, or drop one. */
export type ChangePlan<A extends KeptAction = KeptAction> =
	| { kind: 'send'; action: A }
	| { kind: 'queue'; action: A }
	| { kind: 'merge'; action: A }
	| { kind: 'cancel'; op: string }
	| { kind: 'none' };

/** What a new action needs besides the change. */
export interface PlanContext {
	user: string;
	op: string;
	seq: number;
	now: number;
	/** The connection is known to be missing. */
	offline: boolean;
}

/**
 * The answer to the open sub-tasks of a completion, the sub-tasks it takes along and, where known for
 * each of them, their status before (OF-3b).
 */
function completionFields(
	completes: boolean,
	completion: CompletionChoice | undefined,
	children: readonly string[] | undefined,
	before?: readonly (Status | null)[]
): Pick<OutboxAction, 'completion' | 'children' | 'childrenBefore'> {
	if (!completes || completion === undefined) return {};
	if (completion === 'force') return { completion };
	const along = [...(children ?? [])];
	const known = before !== undefined && before.length === along.length && along.length > 0;
	return { completion, children: along, ...(known && { childrenBefore: [...before] }) };
}

/**
 * Whether a later change of the same kind may go into `last`: it waits, never left the device and
 * takes nothing back ("Verwerfen", OF-3).
 */
function mergeable(last: KeptAction): boolean {
	return last.state === 'queued' && last.sent !== true && last.undoes === undefined;
}

/**
 * The creation of the ticket `id` the device keeps (OF-4a), null without one. A discarded one counts
 * as none: it is only looked up, and a ticket the server shows under its ID changes like any other.
 */
export function creationOf(actions: readonly KeptAction[], id: string): TicketCreateAction | null {
	return (
		actions.find((action): action is TicketCreateAction => {
			return isTicketCreate(action) && action.target === id && action.discarded !== true;
		}) ?? null
	);
}

/**
 * A change of a ticket "＋" created (OF-4a, concept §3.3): it goes into the payload of the creation
 * while that never left the device; null when the change is a new action that waits for the creation
 * (or there is none).
 */
function intoCreation(
	open: readonly KeptAction[],
	id: string,
	patch: { status: Status } | { due: CalendarDate | null }
): ChangePlan<TicketCreateAction> | null {
	const creation = creationOf(open, id);
	if (creation === null) return null;
	// A comment that waits for it (OF-4b) changes no value: the change still goes into the creation.
	const later = open.some(
		(action) =>
			action !== creation && !isCommentCreate(action) && action.dependsOn.includes(creation.op)
	);
	if (!mergeable(creation) || later) return null;
	const payload = { ...creation.payload, ...patch };
	if (payload.status === creation.payload.status && payload.due === creation.payload.due) {
		return { kind: 'none' };
	}
	return { kind: 'merge', action: { ...creation, payload } };
}

/** The fields of a new action of the change; `send` marks it as sent before it leaves. */
function common(
	context: PlanContext,
	change: { target: string; key: string; title: string; scope: string },
	dependsOn: string[]
) {
	return {
		v: 1 as const,
		op: context.op,
		seq: context.seq,
		user: context.user,
		scope: change.scope,
		target: change.target,
		dependsOn,
		key: change.key,
		title: change.title,
		createdAt: context.now,
		state: 'queued' as const,
		attempts: 0,
		nextAttemptAt: 0
	};
}

/** At once with a connection and nothing before it, else kept. */
function sendOrQueue<A extends KeptAction>(
	action: A,
	first: boolean,
	context: PlanContext
): ChangePlan<A> {
	if (first && !context.offline) {
		return {
			kind: 'send',
			action: { ...action, state: 'sending', sendingSince: context.now, sent: true }
		};
	}
	return { kind: 'queue', action };
}

/**
 * The plan for a change of the status of `change.target` (concept OF-0 §3.3):
 * - an action of the ticket that waits and never left the device takes the change in (the
 *   completion follows the last wish) or goes, when the wish is the value before again; a completion
 *   with sub-tasks only where that action still makes the step to "done" (round 3: the hook completes
 *   sub-tasks on that step only), else it waits behind it;
 * - behind any other open action of the ticket, also one sent without an answer (`sent`, OF-2b) or a
 *   check mark of the day plan (OF-3), a new one waits for it, based on its wish; taking it back is
 *   such a counter action;
 * - without an open action a change goes at once (`send`, marked as sent before it leaves) or,
 *   offline, is kept (`queue`); offline a change to the value the ticket has does nothing;
 * - behind the creation of a ticket "＋" created (OF-4a) that left the device a change waits for it,
 *   based on the status it creates; one that never left it takes the change in (`planTicketStatus`).
 */
export function planStatusChange(
	open: readonly KeptAction[],
	change: StatusChange,
	context: PlanContext
): ChangePlan<OutboxAction> {
	const mine = inOrder(open.filter((action) => inStatusChain(action, change.target)));
	const last = mine.at(-1);
	const along =
		change.status === 'done' &&
		change.completion === 'complete_children' &&
		(change.children?.length ?? 0) > 0;
	// The hook completes sub-tasks only on the step to "done" (round 3, R2-1): taken into a waiting
	// change whose value before is "done", a completion with sub-tasks would complete none of them, so
	// it waits behind that change as an action of its own.
	const stepless =
		along && last !== undefined && isStatusAction(last) && last.expected.status === 'done';
	if (last !== undefined && isStatusAction(last) && mergeable(last) && !stepless) {
		// Back to what the user wanted before it (OF-3b: after a discarded change that is not its
		// value before) drops it; any other wish goes into it. A completion that takes sub-tasks along
		// is a wish of its own even then (round 2): dropping would leave the sub-tasks open.
		const feature = statusFeature(change.target);
		if (!along && change.status === willWithout(mine, last, feature, opsOf(open))) {
			return { kind: 'cancel', op: last.op };
		}
		const completion = change.completion ?? last.completion;
		const children = change.children ?? last.children;
		const before = change.children === undefined ? last.childrenBefore : change.childrenBefore;
		const merged: OutboxAction = { ...last, payload: { status: change.status } };
		delete merged.completion;
		delete merged.children;
		delete merged.childrenBefore;
		const fields = completionFields(change.status === 'done', completion, children, before);
		return {
			kind: 'merge',
			action: { ...merged, ...fields, key: change.key, title: change.title }
		};
	}
	const expected = chainedStatus(change.base, mine);
	if (mine.length === 0 && context.offline && expected === change.status) return { kind: 'none' };
	const dependsOn = mine.map((entry) => entry.op);
	const action: OutboxAction = {
		...common(context, change, dependsOn),
		kind: 'ticket.update',
		payload: { status: change.status },
		expected: { status: expected },
		...completionFields(
			change.status === 'done',
			change.completion,
			change.children,
			change.childrenBefore
		)
	};
	return sendOrQueue(action, mine.length === 0, context);
}

/**
 * The plan for a change of the status of a ticket the store shows (OF-4a): into the creation of a
 * ticket "＋" created while that never left the device (concept §3.3), else `planStatusChange`.
 */
export function planTicketStatus(
	open: readonly KeptAction[],
	change: StatusChange,
	context: PlanContext
): ChangePlan<OutboxAction | TicketCreateAction> {
	return (
		intoCreation(open, change.target, { status: change.status }) ??
		planStatusChange(open, change, context)
	);
}

/** The plan for a change of the due date of a ticket the store shows (OF-4a), like the status. */
export function planTicketDue(
	open: readonly KeptAction[],
	change: DueChange,
	context: PlanContext
): ChangePlan<DueAction | TicketCreateAction> {
	const waiting = open.some((action) => isDueAction(action) && action.target === change.target);
	const created = waiting ? null : intoCreation(open, change.target, { due: change.due });
	return created ?? planDueChange(open, change, context);
}

/** The due date the server will have once every open change of the due date arrived (OF-3). */
function chainedDue(base: CalendarDate | null, actions: readonly DueAction[]): CalendarDate | null {
	const last = actions.at(-1);
	return last === undefined ? base : last.payload.due;
}

/**
 * The plan for a change of the due date of `change.target` (OF-3), by the rules of the status: taken
 * into a waiting one that never left the device, dropped when it is the value before again, else a
 * new action behind the open ones of the due date. Behind the creation of a ticket "＋" created
 * (OF-4a) that left the device the change waits for it (`planTicketDue` takes it in before).
 */
export function planDueChange(
	open: readonly KeptAction[],
	change: DueChange,
	context: PlanContext
): ChangePlan<DueAction> {
	const mine = inOrder(
		open.filter(
			(action): action is DueAction => isDueAction(action) && action.target === change.target
		)
	);
	const creation = creationOf(open, change.target);
	const last = mine.at(-1);
	if (last !== undefined && mergeable(last)) {
		const feature = dueFeature(change.target);
		if (change.due === willWithout(mine, last, feature, opsOf(open))) {
			return { kind: 'cancel', op: last.op };
		}
		return {
			kind: 'merge',
			action: { ...last, payload: { due: change.due }, key: change.key, title: change.title }
		};
	}
	const expected = chainedDue(creation === null ? change.base : creation.payload.due, mine);
	if (mine.length === 0 && context.offline && expected === change.due) return { kind: 'none' };
	const dependsOn = [...(creation === null ? [] : [creation.op]), ...mine.map((entry) => entry.op)];
	const action: DueAction = {
		...common(context, change, dependsOn),
		kind: 'ticket.update',
		payload: { due: change.due },
		expected: { due: expected }
	};
	return sendOrQueue(action, dependsOn.length === 0, context);
}

/** "＋" as a ticket or into the inbox (OF-4a): the ID of the client, the area and the values. */
export type CreateChange =
	| { kind: 'ticket.create'; target: string; scope: string; payload: TicketCreatePayload }
	| { kind: 'inbox.create'; target: string; scope: string; payload: InboxCreatePayload };

/**
 * The plan for "＋" (OF-4a): a new action under the ID of the client, sent at once with a connection
 * (the first attempt names only the identifier and the ID) and kept without one. It depends on nothing.
 */
export function planCreate(change: CreateChange, context: PlanContext): ChangePlan<CreateAction> {
	const head = common(
		context,
		{ target: change.target, key: '', title: change.payload.title, scope: change.scope },
		[]
	);
	// An entry with the text of a comment is format 2 (OF-4b): an older build never sends it without it.
	const format: ActionFormat =
		change.kind === 'inbox.create' && change.payload.body !== undefined ? 2 : 1;
	const action: CreateAction =
		change.kind === 'ticket.create'
			? { ...head, kind: 'ticket.create', payload: change.payload, expected: {} }
			: { ...head, v: format, kind: 'inbox.create', payload: change.payload, expected: {} };
	return firstRequest(sendOrQueue(action, true, context), context);
}

/** A creation sent at once notes its first request (OF-4a round 2, A5). */
function firstRequest<A extends CreateAction>(
	plan: ChangePlan<A>,
	context: PlanContext
): ChangePlan<A> {
	return plan.kind === 'send'
		? { kind: 'send', action: { ...plan.action, lastSentAt: context.now } }
		: plan;
}

/** A comment written on a ticket (OF-4b): the ID of the client, the ticket and the text. */
export interface CommentChange {
	/** The ID of the client of the comment. */
	target: string;
	/** The ticket: an ID of the server or of a ticket "＋" created. */
	ticket: string;
	/** Key and title of the ticket for the dialog; no key for a ticket "＋" created. */
	key: string;
	title: string;
	scope: string;
	body: string;
}

/**
 * The plan for a comment (OF-4b, concept §3.3): a new action under the ID of the client. It waits for
 * the creation of its ticket "＋" created (first the ticket, then its comments) and for every comment
 * written before it on the same ticket that the device keeps and the user did not discard (the order
 * in which they were written; every one, not only the last: an earlier one that goes without being
 * sent must not let it overtake the ones before). Comments are never taken into each other. Without
 * anything to wait for it goes at once with a connection (only the identifier and the ID) and is kept
 * without one.
 */
export function planComment(
	open: readonly KeptAction[],
	change: CommentChange,
	context: PlanContext
): ChangePlan<CommentCreateAction> {
	const creation = creationOf(open, change.ticket);
	const before = inOrder(open).filter(
		(action): action is CommentCreateAction =>
			isCommentCreate(action) &&
			action.ticket === change.ticket &&
			action.discarded !== true &&
			!isSetAside(action)
	);
	const dependsOn = [
		...(creation === null ? [] : [creation.op]),
		...before.map((action) => action.op)
	];
	const action: CommentCreateAction = {
		...common(context, change, dependsOn),
		kind: 'comment.create',
		ticket: change.ticket,
		payload: { body: change.body },
		expected: {}
	};
	return firstRequest(sendOrQueue(action, dependsOn.length === 0, context), context);
}

function sameState(a: CheckState, b: CheckState): boolean {
	return a.doneToday === b.doneToday && a.status === b.status;
}

/**
 * The plan for a check mark of the day plan or its taking back (OF-3). It waits behind every open
 * action of the status of its ticket, based on their wish (the mark of the day from the open check
 * marks of the same entry). A check and its taking back that never left the device cancel each other
 * (concept §3.3); a change of a check mark is never taken into another one. Taking back without an
 * action takes the mark of the day back first, else the completion, like the server.
 */
export function planCheckChange(
	open: readonly KeptAction[],
	change: CheckChange,
	context: PlanContext
): ChangePlan<DayPlanAction> {
	const mine = inOrder(open.filter((action) => inStatusChain(action, change.ticket)));
	const same = mine.filter(
		(action): action is DayPlanAction => isDayPlanAction(action) && action.target === change.target
	);
	const last = mine.at(-1);
	const before: CheckState = {
		doneToday:
			same.length === 0 ? change.base.doneToday : checkWish(same.at(-1) as DayPlanAction).doneToday,
		status: chainedStatus(change.base.status, mine)
	};
	const payload: DayPlanAction['payload'] =
		change.kind === 'dayplan.check'
			? {
					action: checkAction(change.ticketKind, change.mode ?? 'check') ?? 'complete',
					mode: change.mode ?? 'check'
				}
			: {
					action: change.action ?? (before.doneToday ? 'today' : 'complete'),
					...(change.status !== undefined && { status: change.status })
				};
	const draft = { kind: change.kind, payload, expected: before };
	const wish = checkWish(draft);
	if (
		last !== undefined &&
		isDayPlanAction(last) &&
		last.target === change.target &&
		last.kind !== change.kind &&
		mergeable(last) &&
		sameState(wish, willStateWithout(mine, last, opsOf(open)))
	) {
		return { kind: 'cancel', op: last.op };
	}
	if (mine.length === 0 && context.offline && sameState(wish, before)) return { kind: 'none' };
	const completes = change.kind === 'dayplan.check' && wish.status === 'done';
	const dependsOn = mine.map((entry) => entry.op);
	const action: DayPlanAction = {
		...common(context, change, dependsOn),
		kind: change.kind,
		ticket: change.ticket,
		ticketKind: change.ticketKind,
		payload,
		expected: before,
		...completionFields(completes, change.completion, change.children, change.childrenBefore)
	};
	return sendOrQueue(action, mine.length === 0, context);
}

/** The mark of the day and the status the user wanted before the check mark `last` (OF-3b). */
function willStateWithout(
	mine: readonly KeptAction[],
	last: DayPlanAction,
	present: ReadonlySet<string>
): CheckState {
	const doneToday = willWithout(mine, last, markFeature(last.target), present);
	const status = willWithout(mine, last, statusFeature(last.ticket), present);
	return {
		doneToday: typeof doneToday === 'boolean' ? doneToday : last.expected.doneToday,
		status: isStatus(status) ? status : last.expected.status
	};
}

/** The time of an action lies more than 5 minutes ahead of the clock (OF-2b). */
function ahead(at: number | undefined, now: number): boolean {
	return at !== undefined && at - now > DEVICE_FUTURE_MS;
}

/**
 * Whether an action "sending" lost its sender: longer under way than a request may take, or marked
 * at a time that lies in the future (the clock went back; round 3, R2-6: else a take-back, which
 * never expires, would hang, and a change would wait for a decision about a clock that its own time
 * does not show). It goes again with its identifier, `sent` stays.
 */
function isStale(action: ActionBase, now: number): boolean {
	if (action.state !== 'sending') return false;
	const since = action.sendingSince ?? 0;
	return since > now || now - since >= STALE_SENDING_MS;
}

/**
 * Whether the time of the device of a waiting action lies in the future (OF-2b): it was kept more
 * than 5 minutes after now. The clock went back or was wrong; such an action is neither sent nor
 * deleted on its own, it waits for a decision like an old one. After "Trotzdem übertragen" (`late`)
 * its time no longer counts. A mark "sending" from the future counts as a lost sender (`isStale`).
 */
export function isFromTheFuture(action: KeptAction, now: number): boolean {
	const free = action.state === 'queued' || isStale(action, now);
	return free && action.late !== true && ahead(action.createdAt, now);
}

/**
 * The next action to send: in order, waiting, its time come, every action it depends on arrived
 * (gone from the outbox). An action "sending" for longer than STALE_SENDING_MS lost its sender and
 * counts as waiting again (concept §3.9).
 */
export function nextToSend<A extends KeptAction>(actions: readonly A[], now: number): A | null {
	const present = new Set(actions.map((action) => action.op));
	for (const action of inOrder(actions)) {
		if (action.state !== 'queued' && !isStale(action, now)) continue;
		if (action.nextAttemptAt > now) continue;
		if (action.dependsOn.some((op) => present.has(op))) continue;
		return action;
	}
	return null;
}

/** The time an action waits for: after an error of the server, or while it is under way. */
function wakeOf(action: ActionBase): number {
	if (action.state === 'queued') return action.nextAttemptAt;
	if (action.state === 'sending') return (action.sendingSince ?? 0) + STALE_SENDING_MS;
	return 0;
}

/**
 * The earliest time the worker has to look again, null when nothing waits for a time: an action
 * after an error of the server, or one "sending" whose sender may have died.
 */
export function nextWakeOf(actions: readonly KeptAction[], now: number): number | null {
	let next: number | null = null;
	for (const action of actions) {
		const at = wakeOf(action);
		if (at <= now) continue;
		next = next === null ? at : Math.min(next, at);
	}
	return next;
}

/** Whether a waiting action is older than 48 hours: queued, or "sending" without its sender. */
function isOld(action: ActionBase, now: number): boolean {
	const free = action.state === 'queued' || isStale(action, now);
	return free && action.late !== true && now - action.createdAt >= AUTO_SEND_MS;
}

/**
 * What the time does to the actions: waiting ones older than 48 hours are no longer sent on their
 * own (`expire`; not after "Trotzdem übertragen"), also one "sending" whose sender died (OF-2b), and
 * so are those whose time lies in the future (`isFromTheFuture`); any older than 7 days goes
 * (`drop`). A take-back never expires (OF-3b round 2, S1): it carries out the declared "Verwerfen",
 * and its value before shows a change of someone else as a conflict; the server keeps its time of
 * the device only within its window.
 */
export function agedActions(
	actions: readonly KeptAction[],
	now: number
): { expire: string[]; drop: string[] } {
	const expire: string[] = [];
	const drop: string[] = [];
	for (const action of actions) {
		if (now - action.createdAt >= KEEP_MS) drop.push(action.op);
		else if (isTakeBack(action) || isLookUp(action)) continue;
		else if (isOld(action, now) || isFromTheFuture(action, now)) expire.push(action.op);
	}
	// A creation that goes takes the changes that wait for it along, also through each other (OF-4a
	// round 2, A8): none of them can arrive without it.
	const along = alongDropped(actions, drop);
	return {
		expire: expire.filter((op) => !along.has(op)),
		drop: [...drop, ...[...along.keys()].filter((op) => !drop.includes(op))]
	};
}

/**
 * The changes that wait for a creation of `drop`, also through each other, with the creation they wait
 * for (OF-4a round 2, A8); among them also those of `drop`. Since OF-4b also the comments of a ticket
 * "＋" created; a comment of `drop` takes no other comment along (they wait for each other only for
 * their order).
 */
export function alongDropped(
	actions: readonly KeptAction[],
	drop: readonly string[]
): Map<string, CreateAction> {
	const creationOf = new Map<string, CreateAction>();
	const along = new Map<string, CreateAction>();
	for (const action of inOrder(actions)) {
		if (isTicketCreate(action) || isInboxCreate(action)) {
			if (drop.includes(action.op)) creationOf.set(action.op, action);
			continue;
		}
		const creation = action.dependsOn
			.map((op) => creationOf.get(op))
			.find((found) => found !== undefined);
		if (creation === undefined) continue;
		creationOf.set(action.op, creation);
		along.set(action.op, creation);
	}
	return along;
}

/**
 * A discarded creation that may have arrived (OF-4a): it is only looked up by its ID, never sent
 * again, so its time does not matter; it never expires.
 */
export function isLookUp(action: KeptAction): boolean {
	return isCreateAction(action) && action.discarded === true;
}

/**
 * Whether a request of a creation may still arrive (OF-4a round 2, A5): one of its requests got no
 * answer, and its last request is less than LOOKUP_FINAL_MS ago (or the clock went back). A lookup that
 * does not find it, or a refusal, is not final until then.
 */
export function mayStillArrive(action: KeptAction, now: number): boolean {
	if (!isCreateAction(action)) return false;
	if (action.unanswered !== true && action.unansweredBefore !== true) return false;
	const since = action.lastSentAt ?? 0;
	return now - since < LOOKUP_FINAL_MS;
}

/** When to look a creation up again whose request may still arrive (`mayStillArrive`). */
export function lookUpAgainAt(action: KeptAction, now: number): number {
	return Math.min(action.lastSentAt ?? now, now) + LOOKUP_FINAL_MS;
}

/**
 * The kind of the record of a creation "＋" (OF-4a round 2, A10) or of a comment (OF-4b), null for any
 * other action.
 */
export function createdRecordOf(action: KeptAction): CreatedKind | null {
	if (isTicketCreate(action)) return 'ticket';
	if (isCommentCreate(action)) return 'comment';
	return isInboxCreate(action) ? 'inbox' : null;
}

/**
 * The last known state of the server behind a discarded action, per chain: the status, the due date
 * and the mark of the day of one entry (OF-3).
 */
export interface ServerState {
	status?: Status;
	due?: CalendarDate | null;
	check?: { item: string; doneToday: boolean };
}

/** The state of an action based on `state`, or the action itself when nothing changes. */
function rebasedOn(action: KeptAction, state: ServerState): KeptAction {
	if (isCreateAction(action)) return action;
	if (isStatusAction(action)) {
		const status = state.status;
		return status === undefined || status === action.expected.status
			? action
			: { ...action, expected: { status } };
	}
	if (isDueAction(action)) {
		const due = state.due;
		return due === undefined || due === action.expected.due
			? action
			: { ...action, expected: { due } };
	}
	const expected: CheckState = {
		status: state.status ?? action.expected.status,
		doneToday:
			state.check !== undefined && state.check.item === action.target
				? state.check.doneToday
				: action.expected.doneToday
	};
	return sameState(expected, action.expected) ? action : { ...action, expected };
}

/**
 * The actions right behind `op` (their value before was its wish), now based on `state`, the last
 * known state of the server, once `op` is discarded (OF-2b). A status alone stands for the state of
 * the status. Actions under way keep what they were sent with. Since OF-3b "right behind" is per
 * value: the first later action that names the value `op` names (a later check mark of the same entry
 * as well); without `op` among `actions` the ones whose dependencies end on it.
 */
export function rebasedBehind(
	actions: readonly KeptAction[],
	op: string,
	state: Status | ServerState
): KeptAction[] {
	const known: ServerState = typeof state === 'string' ? { status: state } : state;
	const ordered = inOrder(actions);
	const index = ordered.findIndex((action) => action.op === op);
	const self = ordered[index];
	if (self === undefined) {
		const rebased: KeptAction[] = [];
		for (const action of ordered) {
			if (action.state === 'sending' || action.dependsOn.at(-1) !== op) continue;
			const next = rebasedOn(action, known);
			if (next !== action) rebased.push(next);
		}
		return rebased;
	}
	const changed = new Map<string, KeptAction>();
	const later = ordered.slice(index + 1);
	for (const [feature, value] of valuesOfState(self, known)) {
		const next = later.find((action) => expectedOf(action).has(feature));
		if (next === undefined || next.state === 'sending') continue;
		const current = changed.get(next.op) ?? next;
		const rebased = withExpected(current, feature, value);
		if (rebased !== current) changed.set(next.op, rebased);
	}
	return inOrder(changed.values());
}

/**
 * Whether a request of the action may have reached the server without an answer (OF-3): its last
 * request got none, and it waits. Once the server answered (an error, a conflict, a refusal), it
 * looked the identifier up first: had an earlier request arrived, it would have answered like the
 * first time, so such an action changed nothing.
 */
export function mayHaveArrived(action: KeptAction): boolean {
	return action.unanswered === true && (action.state === 'queued' || action.state === 'expired');
}

/** Whether an action changes anything when it arrives: its wish is not the value before. */
export function changesSomething(action: KeptAction): boolean {
	if (isCreateAction(action)) return true;
	if (isStatusAction(action)) return action.payload.status !== action.expected.status;
	if (isDueAction(action)) return action.payload.due !== action.expected.due;
	return !sameState(checkWish(action), action.expected);
}

/**
 * Whether "Trotzdem erledigen" may turn a refused check mark of a day gone by into the completion of
 * its ticket over the normal way (decision of the user 3, ADR-0074 §8): only the check mark of a task
 * that completes it; an ongoing project, a check of the day and taking back lapse.
 */
export function canCompleteAnyway(action: KeptAction): boolean {
	return (
		isDayPlanAction(action) &&
		action.kind === 'dayplan.check' &&
		action.ticketKind === 'task' &&
		action.payload.action === 'complete' &&
		action.state === 'refused' &&
		action.outcome?.code === DAY_OVER_CODE
	);
}

/**
 * The completion of the ticket instead of the refused check mark (OF-3): a new identifier, the same
 * place in the order, the time of the device of the check mark and its answer to open sub-tasks. A
 * take-back stays one (OF-3b).
 */
export function completionInstead(action: DayPlanAction, op: string): OutboxAction {
	return {
		...insteadOf(action, op),
		payload: { status: 'done' },
		...completionFields(true, action.completion, action.children, action.childrenBefore)
	};
}

/**
 * Whether "Trotzdem wieder öffnen" may turn a refused taking back of a completion on a day gone by into
 * opening the ticket again over the normal way (OF-3b, the counterpart of "Trotzdem erledigen"): only
 * one that would open the ticket again.
 */
export function canReopenAnyway(action: KeptAction): boolean {
	return (
		isDayPlanAction(action) &&
		action.kind === 'dayplan.uncheck' &&
		action.payload.action === 'complete' &&
		checkWish(action).status !== action.expected.status &&
		action.state === 'refused' &&
		action.outcome?.code === DAY_OVER_CODE
	);
}

/** Opening the ticket again instead of the refused taking back of a completion (OF-3b). */
export function reopenInstead(action: DayPlanAction, op: string): OutboxAction {
	return { ...insteadOf(action, op), payload: { status: checkWish(action).status } };
}

/** The status change of the ticket in the place of a refused check mark (OF-3, OF-3b). */
function insteadOf(action: DayPlanAction, op: string): Omit<OutboxAction, 'payload'> {
	return {
		v: 1,
		op,
		seq: action.seq,
		user: action.user,
		scope: action.scope,
		kind: 'ticket.update',
		target: action.ticket,
		dependsOn: [...action.dependsOn],
		expected: { status: action.expected.status },
		key: action.key,
		title: action.title,
		createdAt: action.createdAt,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		...(action.late === true && { late: true }),
		...(action.undoes !== undefined && { undoes: action.undoes })
	};
}

/** The fields of the outbox in a request (ADR-0074 §2 to §4); see data/tickets.ts. */
export interface OutboxFields {
	opId: string;
	/** The time of the device as an ISO time. */
	clientAt?: string;
	/** An action of the outbox without a time ("Trotzdem übertragen"). */
	offline?: boolean;
	expected?: Readonly<Record<string, unknown>>;
}

/** The values before as the server compares them: the history form, a check mark as `checked`. */
function expectedFieldsOf(expected: KeptAction['expected']): Readonly<Record<string, unknown>> {
	if ('doneToday' in expected) {
		return { checked: isDone(expected.doneToday, expected.status), status: expected.status };
	}
	if ('due' in expected) return { due: fromDueInput(expected.due ?? '') };
	return { status: expected.status };
}

/**
 * The fields of a request: the first attempt right after the change sends only the identifier, as
 * a change with a connection is no change of the outbox (the result stays the one of today); every
 * later attempt sends the time of the device and the values before, after "Trotzdem übertragen"
 * only `offline` instead of the time.
 */
export function requestFields(
	action: Pick<KeptAction, 'op' | 'kind' | 'expected' | 'createdAt' | 'late'>,
	first: boolean
): OutboxFields {
	if (first) return { opId: action.op };
	// A creation (OF-4a) and a comment (OF-4b) are based on nothing: only the identifier and the time
	// of the device.
	if (
		action.kind === 'ticket.create' ||
		action.kind === 'inbox.create' ||
		action.kind === 'comment.create'
	) {
		if (action.late === true) return { opId: action.op, offline: true };
		return { opId: action.op, clientAt: new Date(action.createdAt).toISOString() };
	}
	const expected = expectedFieldsOf(action.expected);
	if (action.late === true) return { opId: action.op, expected, offline: true };
	return { opId: action.op, expected, clientAt: new Date(action.createdAt).toISOString() };
}

/** What a failed attempt means for the action, in the words of the outbox. */
export type SendVerdict =
	| { result: 'arrived' }
	| { result: 'conflict'; outcome: ActionOutcome }
	| { result: 'refused'; outcome: ActionOutcome }
	| { result: 'session' }
	| { result: 'server' }
	| { result: 'network' };

interface FieldFacts {
	code: string;
	message: string;
	params?: Readonly<Record<string, unknown>>;
}

/** A failure as the data layer reports it (DataError), only what the outbox reads of it. */
export interface FailureFacts {
	kind: 'aborted' | 'network' | 'not_found' | 'forbidden' | 'validation' | 'session' | 'server';
	status: number;
	message: string;
	fields: Readonly<Record<string, FieldFacts>>;
}

function isApplied([field, error]: [string, FieldFacts]): boolean {
	return field === 'op_id' && error.code === 'validation_op_applied';
}

function isConflict([, error]: [string, FieldFacts]): boolean {
	return error.code === 'validation_ticket_conflict';
}

/**
 * The verdict of a failed attempt (concept §3.7): the identifier known to the server means
 * arrived; a changed check mark of the day plan is refused for good, also next to a changed status
 * (OF-3); a conflict at a field waits for a decision; open sub-tasks wait for the answer to the
 * question; a day of the plan gone by is refused for good with its own words (OF-3); 401 waits for
 * the sign-in; a missing answer (network, time limit, `aborted` by the limit) waits for the
 * connection; 5xx tries again later; every other answer is refused for good. `record`: the kind of the
 * record of a creation, for the words of the codes PocketBase answers itself (OF-4a round 2, A10); a
 * comment refused without a field failed the create rule (OF-4b): its ticket is not to be seen.
 */
export function verdictOf(failure: FailureFacts, record?: CreatedKind | null): SendVerdict {
	if (failure.kind === 'network' || failure.kind === 'aborted') return { result: 'network' };
	if (failure.kind === 'session') return { result: 'session' };
	const serverError = failure.status === 0 || failure.status >= 500;
	if (failure.kind === 'server' && serverError) return { result: 'server' };
	const fields = Object.entries(failure.fields);
	if (fields.some(isApplied)) return { result: 'arrived' };
	const checked = fields.find(([, error]) => error.code === CHECK_CONFLICT_CODE);
	if (checked !== undefined) {
		const message = OFFLINE_MESSAGES[CHECK_CONFLICT_CODE] ?? checked[1].message;
		return { result: 'refused', outcome: { code: CHECK_CONFLICT_CODE, message } };
	}
	const conflict = fields.find(isConflict);
	if (conflict !== undefined) {
		const [field, error] = conflict;
		const outcome: ActionOutcome = {
			code: error.code,
			message: CONFLICT_TEXTS[field] ?? error.message,
			actual: textOrNullOf(error.params?.actual) ?? null,
			updated: textOrNullOf(error.params?.updated) ?? null
		};
		return { result: 'conflict', outcome };
	}
	const first = fields[0];
	if (first === undefined && record === 'comment' && failure.status === 400) {
		const outcome = { code: COMMENT_REFUSED_CODE, message: OFFLINE_TEXTS.commentRefused };
		return { result: 'refused', outcome };
	}
	if (first === undefined) {
		return { result: 'refused', outcome: { code: failure.kind, message: failure.message } };
	}
	const [field, error] = first;
	if (error.code === DAY_OVER_CODE) {
		return {
			result: 'refused',
			outcome: { code: DAY_OVER_CODE, message: OFFLINE_TEXTS.dayOver }
		};
	}
	const count = error.params?.count;
	const own =
		record === undefined || record === null ? undefined : CREATE_MESSAGES[error.code]?.[record];
	const outcome: ActionOutcome = {
		code: error.code,
		message: OFFLINE_MESSAGES[error.code] ?? own ?? error.message,
		...(error.code === OPEN_CHILDREN_CODE && { count: finite(count) ? count : 1 }),
		// The project or the tags of a creation (OF-4a): it may go again without them.
		...(isCreateField(field) && { field })
	};
	return { result: 'refused', outcome };
}

/** Bytes of the actions as the device keeps them, for OUTBOX_MAX_BYTES. */
export function sizeOf(actions: readonly KeptAction[]): number {
	return new TextEncoder().encode(JSON.stringify(actions)).length;
}

/**
 * Whether `next` still fits on the device; taking a change into an action of the same identifier
 * replaces it and is no action more (OF-2b).
 */
export function hasRoom(actions: readonly KeptAction[], next: KeptAction): boolean {
	const rest = actions.filter((action) => action.op !== next.op);
	if (rest.length >= OUTBOX_MAX_ACTIONS) return false;
	return sizeOf([...rest, next]) <= OUTBOX_MAX_BYTES;
}

/** A due date of a conflict as the server names it (the history form), null for none. */
export function dueOfServer(value: string | null | undefined): CalendarDate | null | undefined {
	if (value === null || value === undefined) return value;
	try {
		return toDueInput(value) || null;
	} catch {
		return undefined;
	}
}

function changes(count: number): string {
	return count === 1 ? '1 Änderung' : `${count} Änderungen`;
}

/** "14:03" for a time of today in Berlin, else "18.10.2026 14:03". */
export function deviceTimeText(ms: number, now: number): string {
	const at = formatBerlinDateTime(toPocketBaseTimestamp(ms));
	const today = formatBerlinDateTime(toPocketBaseTimestamp(now));
	return at.slice(0, 10) === today.slice(0, 10) ? at.slice(11) : at;
}

/** A time of the server ("2026-10-20 14:10:00.000Z") like deviceTimeText, null for none. */
export function serverTimeText(timestamp: string | null | undefined, now: number): string | null {
	if (typeof timestamp !== 'string' || timestamp === '') return null;
	const ms = Date.parse(timestamp.replace(' ', 'T'));
	return Number.isFinite(ms) ? deviceTimeText(ms, now) : null;
}

/**
 * What a change does, without its title (OF-3c): enough for its words, so a notice on the device keeps
 * no more of it than the key of its ticket and the value.
 */
export type ChangeRef =
	| { readonly field: 'status'; readonly key: string; readonly status: Status }
	| { readonly field: 'due'; readonly key: string; readonly due: CalendarDate | null }
	| {
			readonly field: 'check';
			readonly key: string;
			readonly check: 'complete' | 'today' | 'uncheck';
	  }
	| {
			/**
			 * A record "＋" created (OF-4a) or a comment (OF-4b, `title` the beginning of its text); never
			 * kept in a notice of a take-back.
			 */
			readonly field: 'create';
			readonly key: string;
			readonly record: CreatedKind;
			readonly title: string;
	  };

/** The length of the beginning of the text of a comment that names it (OF-4b). */
export const COMMENT_EXCERPT_LENGTH = 40;

/**
 * The beginning of the text of a comment that names it in lists, flags and hints (OF-4b): its words on
 * one line, cut with "…" after COMMENT_EXCERPT_LENGTH characters.
 */
export function commentExcerpt(body: string): string {
	return cutText(body, COMMENT_EXCERPT_LENGTH);
}

/** A text on one line, at most `max` characters, cut with "…". */
function cutText(text: string, max: number): string {
	const line = text.replace(/\s+/g, ' ').trim();
	return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** The title of a creation in words; of a comment the beginning of its text (OF-4b). */
export function createdTitleOf(action: CreateAction): string {
	return isCommentCreate(action) ? commentExcerpt(action.payload.body) : action.payload.title;
}

/** What an action does, for its words (`changeText`). */
export function changeOf(action: KeptAction): ChangeRef {
	if (isCreateAction(action)) {
		const record = createdRecordOf(action) ?? 'ticket';
		return { field: 'create', key: action.key, record, title: createdTitleOf(action) };
	}
	if (isDueAction(action)) return { field: 'due', key: action.key, due: action.payload.due };
	if (isDayPlanAction(action)) {
		const check = action.kind === 'dayplan.uncheck' ? 'uncheck' : action.payload.action;
		return { field: 'check', key: action.key, check };
	}
	return { field: 'status', key: action.key, status: action.payload.status };
}

/** A change as stored in a notice, null for anything else (OF-3c: the device may hold anything). */
export function parseChangeRef(raw: unknown): ChangeRef | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const value = raw as Record<string, unknown>;
	if (typeof value.key !== 'string') return null;
	const key = value.key;
	if (value.field === 'status' && isStatus(value.status)) {
		return { field: 'status', key, status: value.status };
	}
	const due = dueOf(value.due);
	if (value.field === 'due' && due !== undefined) return { field: 'due', key, due };
	const check = value.check;
	if (
		value.field === 'check' &&
		(check === 'complete' || check === 'today' || check === 'uncheck')
	) {
		return { field: 'check', key, check };
	}
	return null;
}

/**
 * What a change does, in words: "HAUS-12 erledigt", "HAUS-12 auf „In Arbeit“", "HAUS-12 fällig am
 * 21.10.2026", "HAUS-12 im Tagesplan erledigt".
 */
export function changeText(change: ChangeRef): string {
	if (change.field === 'create') return createdName(change.record, change.title);
	const key = change.key === '' ? 'Ticket' : change.key;
	if (change.field === 'due') {
		const due = change.due;
		return due === null ? `${key} ohne Fälligkeit` : `${key} fällig am ${formatCalendarDate(due)}`;
	}
	if (change.field === 'check') {
		if (change.check === 'uncheck') return `${key} im Tagesplan wieder offen`;
		return change.check === 'today'
			? `${key} im Tagesplan für heute abgehakt`
			: `${key} im Tagesplan erledigt`;
	}
	if (change.status === 'done') return `${key} erledigt`;
	return `${key} auf „${STATUS_LABELS[change.status]}“`;
}

/** What an action does, in words (`changeText`). */
export function actionText(action: KeptAction): string {
	return changeText(changeOf(action));
}

/**
 * "Neues Ticket „Titel“", "Neuer Eingangseintrag „Titel“" (OF-4a) or "Kommentar „Anfang …“" (OF-4b,
 * `title` the beginning of its text).
 */
export function createdName(record: CreatedKind, title: string): string {
	const what =
		record === 'ticket'
			? OFFLINE_TEXTS.newTicket
			: record === 'inbox'
				? OFFLINE_TEXTS.newItem
				: OFFLINE_TEXTS.comment;
	return `${what} „${title}“`;
}

/**
 * A creation in the middle of a sentence (OF-4a round 2, A10): "das neue Ticket „Titel“", "der neue
 * Eingangseintrag „Titel“" or "der Kommentar „Anfang …“" (OF-4b); `accusative` after "auf" ("den neuen
 * Eingangseintrag", "den Kommentar").
 */
export function createdInSentence(record: CreatedKind, title: string, accusative = false): string {
	if (record === 'ticket') return `das neue Ticket „${title}“`;
	if (record === 'comment') return `${accusative ? 'den' : 'der'} Kommentar „${title}“`;
	return `${accusative ? 'den neuen' : 'der neue'} Eingangseintrag „${title}“`;
}

/**
 * The ticket of a comment in a sentence after "zu" (OF-4b): its key, or "dem neuen Ticket „Titel“"
 * while the server has not given it one.
 */
export function commentTicketName(ticket: { key: string; title: string }): string {
	return ticket.key === '' ? `dem neuen Ticket „${ticket.title}“` : ticket.key;
}

/**
 * What the place of the key shows (concept §2.3): the key, or "Neu" for a ticket "＋" created that the
 * server does not have yet (OF-4a).
 */
export function keyLabel(key: string): string {
	return key === '' ? OFFLINE_TEXTS.newKey : key;
}

/**
 * The name of a ticket in words for labels, announcements and flags: its key, or "Neues Ticket
 * „Titel“" while the server has not given it one (OF-4a).
 */
export function ticketName(ticket: { key: string; title: string }): string {
	return ticket.key === '' ? createdName('ticket', ticket.title) : ticket.key;
}

/**
 * The name of an action in the hints of the outbox: a creation by its title (OF-4a), a comment by the
 * beginning of its text (OF-4b), else its key.
 */
export function actionName(action: KeptAction): string {
	if (isCreateAction(action)) {
		return createdName(createdRecordOf(action) ?? 'ticket', createdTitleOf(action));
	}
	return action.key;
}

/**
 * A comment kept for later as the activity shows it until the server has it (OF-4b, concept §2.3): its
 * ID, its ticket, the account as its author and the time of the device as `created`, `updated` and the
 * time "laut Gerät" (`deviceAt`). The views never take it for one of the server.
 */
export function keptCommentOf(action: CommentCreateAction): Comment {
	const at = toPocketBaseTimestamp(action.createdAt);
	return {
		id: action.target,
		ticket: action.ticket,
		author: action.user,
		body: action.payload.body,
		created: at,
		updated: at,
		offline: true,
		deviceAt: at
	};
}

/**
 * "um 14:03", or "am 20.10.2026 um 14:03" when `device` lies on another day than one of `references`
 * (Berlin days).
 */
function whenText(device: string, ...references: string[]): string {
	const at = formatBerlinDateTime(device);
	const day = at.slice(0, 10);
	const same = references.every(
		(reference) => formatBerlinDateTime(reference).slice(0, 10) === day
	);
	return same ? `um ${at.slice(11)}` : `am ${day} um ${at.slice(11)}`;
}

/**
 * The head of a comment from the outbox (OF-4b, concept §2.3): one kept for later "Offline geschrieben
 * um 14:03 (laut Gerät)"; one that arrived "… · übertragen 14:30" with the time of the server, which
 * counts (ADR-0074 §4), and without an accepted time of the device "Offline geschrieben · übertragen
 * 14:30". A time of the device that is not today names its date; since MO-7a (L-3) also once it
 * arrived, not only on another day than the transfer, so "um 20:03" never stands for an earlier day.
 * Since round 2 (K-7) the head stands instead of the time of the comment, so a transfer before today
 * names its date as well ("übertragen 19.10.2026 20:30").
 */
export function offlineCommentText(
	comment: Pick<Comment, 'created' | 'deviceAt'>,
	kept: boolean,
	now: number
): string {
	const today = toPocketBaseTimestamp(now);
	if (kept) {
		const device = comment.deviceAt || comment.created;
		return OFFLINE_TEXTS.writtenOffline(whenText(device, today), null);
	}
	const when = comment.deviceAt ? whenText(comment.deviceAt, comment.created, today) : null;
	const synced = serverTimeText(comment.created, now) ?? formatBerlinDateTime(comment.created);
	return OFFLINE_TEXTS.writtenOffline(when, synced);
}

/**
 * The title of an entry of the inbox that keeps the text of a comment ("Als Eingangseintrag sichern",
 * OF-4b): "Kommentar zu HAUS-12: …" with the beginning of the text on one line, at most as long as a
 * title of the inbox may be; the whole text goes into the entry.
 */
export function savedItemTitle(action: CommentCreateAction): string {
	const head = `${OFFLINE_TEXTS.comment} zu ${commentTicketName(action)}: `;
	return cutText(`${head}${action.payload.body}`, INBOX_TITLE_MAX_LENGTH);
}

/**
 * A ticket "＋" created as the views show it until the server has it (OF-4a, concept §3.5): its ID,
 * no key ("Neu"), the values of the line and the changes taken in; the device time of the entry as
 * `created` and `updated`. The project and the tags by their IDs only (the catalog names them).
 */
export function createdTicketOf(action: TicketCreateAction): Ticket {
	const { payload } = action;
	const at = toPocketBaseTimestamp(action.createdAt);
	return {
		id: action.target,
		key: '',
		title: payload.title,
		status: payload.status,
		priority: payload.priority,
		due: payload.due,
		projectId: payload.project,
		tagIds: [...payload.tags],
		project: null,
		tags: [],
		recurring: false,
		recurrenceId: null,
		parentId: null,
		blocksParent: true,
		parentRef: null,
		source: 'quick',
		...(action.scope !== '' && { scope: action.scope }),
		owner: action.user,
		completedAt: payload.status === 'done' ? at : null,
		created: at,
		updated: at,
		description: '',
		sourceItem: null
	};
}

/** An entry of the inbox "＋" created as the views show it until the server has it (OF-4a). */
export function createdItemOf(action: InboxCreateAction): InboxItem {
	const { preset } = action.payload;
	const meta = presetMeta({
		project: preset.project,
		tagIds: preset.tags,
		priority: preset.priority,
		due: null
	});
	const at = toPocketBaseTimestamp(action.createdAt);
	return {
		id: action.target,
		channel: 'quick',
		kind: 'todo',
		title: action.payload.title,
		sourceUrl: '',
		sourceRef: '',
		sourceDate: null,
		sourceMeta: Object.keys(meta).length === 0 ? {} : { [PRESET_META_KEY]: meta },
		original: '',
		state: 'new',
		ticketId: null,
		ticket: null,
		handledAt: null,
		...(action.scope !== '' && { scope: action.scope }),
		owner: action.user,
		targetProjectId: null,
		created: at,
		updated: at,
		body: ''
	};
}

/**
 * Whether a refused creation of a ticket may go again without its project or its tags (OF-4a,
 * concept §3.7: "Ohne Projekt anlegen"): the server refused it at that field, and it has one.
 */
export function withoutFieldOf(action: KeptAction): CreateField | null {
	if (!isTicketCreate(action) || action.state !== 'refused') return null;
	const field = action.outcome?.field;
	if (field === 'project') return action.payload.project === null ? null : field;
	if (field === 'tags') return action.payload.tags.length === 0 ? null : field;
	return null;
}

/** "1 gemerkte Änderung wartet" or "3 gemerkte Änderungen warten". */
function keptWaiting(count: number): string {
	return count === 1 ? '1 gemerkte Änderung wartet' : `${count} gemerkte Änderungen warten`;
}

/** "wird sie" or "werden sie", after the number of changes. */
function willThey(count: number): string {
	return count === 1 ? 'wird sie' : 'werden sie';
}

/** "1 Kommentar" or "3 Kommentare". */
function comments(count: number): string {
	return count === 1 ? '1 Kommentar' : `${count} Kommentare`;
}

/** The words of the outbox (concept OF-0 §2.1, §2.3, §2.4; since OF-3 also day plan and due date). */
export const OFFLINE_TEXTS = Object.freeze({
	offline:
		'Keine Verbindung zu becauseyoulovejira. Abhaken, Status, Tagesplan, Fälligkeit, Kommentare und ＋ werden gemerkt und später übertragen.',
	/** "＋" without a connection (OF-4a): the words of the record and of the place of its key. */
	newTicket: 'Neues Ticket',
	newItem: 'Neuer Eingangseintrag',
	newKey: 'Neu',
	/** A comment without a connection (OF-4b). */
	comment: 'Kommentar',
	/** The result of a comment kept for later (OF-4b); with a connection (a 5xx) in neutral words. */
	keptComment: (offline: boolean) =>
		offline
			? 'Kommentar gemerkt. Er wird übertragen, sobald die Verbindung zurück ist.'
			: 'Kommentar gemerkt. Er wird später erneut übertragen.',
	/**
	 * The head of a comment from the outbox (concept §2.3): "Offline geschrieben um 14:03 (laut Gerät) ·
	 * übertragen 14:30"; `when` is "um 14:03" or "am 20.10.2026 um 14:03", null without an accepted time
	 * of the device; `synced` the time of the server, null while it is kept.
	 */
	writtenOffline: (when: string | null, synced: string | null) => {
		const written =
			when === null ? 'Offline geschrieben' : `Offline geschrieben ${when} (laut Gerät)`;
		return synced === null ? written : `${written} · übertragen ${synced}`;
	},
	/** The reason of a comment the server refuses without a field (OF-4b, `COMMENT_REFUSED_CODE`). */
	commentRefused:
		'Das Ticket nimmt den Kommentar nicht an: Es ist nicht mehr sichtbar, liegt im Papierkorb oder fehlt auf dem Server.',
	/** A comment of a ticket "＋" created whose creation the user discarded (OF-4b, `SET_ASIDE_CODE`). */
	commentSetAside: (title: string) =>
		`Das neue Ticket „${title}“ wurde verworfen; der Kommentar wird deshalb nicht übertragen.`,
	/** The comments of a creation in its row of the dialog (OF-4b): what "Verwerfen" does to them. */
	withComments: (count: number) =>
		count === 1
			? 'Dazu 1 Kommentar. „Verwerfen“ überträgt ihn nicht, sein Text bleibt hier mit „Als Eingangseintrag sichern“.'
			: `Dazu ${count} Kommentare. „Verwerfen“ überträgt sie nicht, ihr Text bleibt hier mit „Als Eingangseintrag sichern“.`,
	/** The flag after "Verwerfen" of a creation with comments (OF-4b): their text did not go. */
	setAside: (count: number) =>
		`${comments(count)} dazu ${count === 1 ? 'wird' : 'werden'} nicht übertragen; der Text steht unter „Gemerkte Änderungen“ mit „Als Eingangseintrag sichern“.`,
	/** What a comment is about in the dialog (OF-4b): "Kommentar zu HAUS-12", "… zu Neu „Titel“". */
	commentOn: (key: string, title: string) => `Kommentar zu ${key === '' ? `Neu „${title}“` : key}`,
	/** Keeps the text of a comment as an entry of the inbox (concept §2.1, C2). */
	saveAsItem: 'Als Eingangseintrag sichern',
	savedAsItem: (kept: boolean, offline: boolean) =>
		!kept
			? 'Kommentar als Eingangseintrag gesichert.'
			: offline
				? 'Kommentar als Eingangseintrag gemerkt. Er kommt in den Eingang, sobald die Verbindung zurück ist.'
				: 'Kommentar als Eingangseintrag gemerkt. Er wird später erneut übertragen.',
	saveAsItemFailed: 'Der Kommentar ließ sich nicht als Eingangseintrag sichern; er bleibt gemerkt.',
	/**
	 * Why "Trotzdem übertragen" and "Verwerfen" of a comment wait while it is saved as an entry
	 * (MO-7a, L-1): description and title of both buttons.
	 */
	savingAsItemLocked: 'Der Kommentar wird gerade als Eingangseintrag gesichert.',
	/**
	 * A comment saved as an entry after it may have arrived waits for its lookup (OF-4b round 2, K-3);
	 * with a connection in neutral words.
	 */
	savedChecking: (offline: boolean) =>
		offline
			? 'als Eingangseintrag gesichert, wird nachgesehen, sobald eine Verbindung besteht'
			: 'als Eingangseintrag gesichert, wird nachgesehen',
	/** Such a comment that arrived anyway (K-3): a notice that stays, with a link to its ticket. */
	savedAnyway: (title: string, key: string) =>
		`Der als Eingangseintrag gesicherte Kommentar „${title}“ ist schon angekommen${key === '' ? '' : ` (${key})`}; sein Text liegt jetzt zusätzlich im Eingang. Bitte im Ticket prüfen und bei Bedarf löschen.`,
	/** Such a comment the deletion after 7 days took before it was looked up (K-3, C3). */
	droppedSaved: (title: string) =>
		`Ob der als Eingangseintrag gesicherte Kommentar „${title}“ schon angekommen ist, ließ sich nicht mehr nachsehen.`,
	/** The whole text of a comment the deletion after 7 days took (OF-4b, C2). */
	droppedComment: (ticket: string, text: string) => `Text des Kommentars zu ${ticket}: „${text}“`,
	/**
	 * The whole text of an entry that keeps a comment the deletion after 7 days took (OF-4b round 2,
	 * K-1, C2), named by its title.
	 */
	droppedItemText: (title: string, text: string) =>
		`Text des Eingangseintrags „${title}“: „${text}“`,
	/**
	 * The result of "＋" kept for later (OF-4a); kept while the connection is there (a 5xx, an answer
	 * that got lost) in neutral words (OF-4b, B-3).
	 */
	keptTicket: (title: string, offline = true) =>
		offline
			? `Ticket „${title}“ gemerkt. Es wird angelegt, sobald die Verbindung zurück ist.`
			: `Ticket „${title}“ gemerkt. Es wird später erneut übertragen.`,
	keptItem: (title: string, offline = true) =>
		offline
			? `„${title}“ gemerkt. Der Eintrag kommt in den Eingang, sobald die Verbindung zurück ist.`
			: `„${title}“ gemerkt. Der Eintrag wird später erneut übertragen.`,
	/** New `#tags` need the server (concept §2.2, Stufe 2): nothing is kept, the line stays. */
	newTags: (names: string) =>
		`Neue Tags gehen nur mit Verbindung: ${names}. Entferne sie oder wähle vorhandene Tags, dann wird der Eintrag gemerkt.`,
	/** A refused creation of a ticket may go again without its project or its tags (concept §3.7). */
	withoutProject: 'Ohne Projekt anlegen',
	withoutTags: 'Ohne Tags anlegen',
	/**
	 * "Verwerfen" of a creation that may have arrived (OF-4a): it is not sent again, only looked up; in
	 * the words of its kind since round 2 (A10).
	 */
	createCheckHint: (record: CreatedKind) =>
		record === 'ticket'
			? 'Vielleicht ist das neue Ticket schon angekommen. Es wird nicht noch einmal gesendet; sobald eine Verbindung besteht, sieht die App nach und meldet sich, falls es das Ticket schon gibt.'
			: record === 'inbox'
				? 'Vielleicht ist der neue Eingangseintrag schon angekommen. Er wird nicht noch einmal gesendet; sobald eine Verbindung besteht, sieht die App nach und meldet sich, falls es ihn schon gibt.'
				: 'Vielleicht ist der Kommentar schon angekommen. Er wird nicht noch einmal gesendet; sobald eine Verbindung besteht, sieht die App nach und meldet sich, falls es ihn schon gibt.',
	/** A discarded creation waits for its lookup; with a connection in neutral words (OF-4b, B-3). */
	createChecking: (offline: boolean) =>
		offline
			? 'verworfen, wird nachgesehen, sobald eine Verbindung besteht'
			: 'verworfen, wird nachgesehen',
	/**
	 * A creation the server answers as arrived but the account no longer sees, the trash for instance
	 * (`validation_op_applied`, OF-4a round 2, A7): a notice that stays, with a link.
	 */
	createdHidden: (record: CreatedKind, title: string) =>
		record === 'ticket'
			? `Das neue Ticket „${title}“ wurde angelegt, ist aber nicht mehr sichtbar (Papierkorb?). Bitte im Papierkorb prüfen.`
			: record === 'inbox'
				? `Der neue Eingangseintrag „${title}“ wurde angelegt, ist aber nicht mehr sichtbar. Bitte im Eingang prüfen.`
				: `Der Kommentar „${title}“ wurde übertragen, sein Ticket ist aber nicht mehr sichtbar (Papierkorb?). Bitte im Papierkorb prüfen.`,
	/** What needs the server at a ticket "＋" created that it does not have yet (round 2, A6). */
	createdLocked: 'Geht erst, wenn das Ticket übertragen ist.',
	/** A discarded creation that arrived anyway (OF-4a): a notice that stays, with a link. */
	createdAnyway: (record: CreatedKind, title: string, key: string) =>
		record === 'ticket'
			? `Das verworfene Ticket „${title}“ wurde schon angelegt${key === '' ? '' : ` (${key})`}. Bitte im Ticket prüfen und bei Bedarf löschen.`
			: record === 'inbox'
				? `Der verworfene Eintrag „${title}“ liegt schon im Eingang. Bitte dort prüfen und bei Bedarf verwerfen.`
				: `Der verworfene Kommentar „${title}“ ist schon angekommen${key === '' ? '' : ` (${key})`}. Bitte im Ticket prüfen und bei Bedarf löschen.`,
	openItem: 'Eintrag ansehen',
	/** A discarded creation the deletion after 7 days took before it was looked up (OF-4a, C3). */
	droppedCreated: (record: CreatedKind, title: string) =>
		record === 'ticket'
			? `Ob ${createdInSentence(record, title)} trotz „Verwerfen“ schon angelegt wurde, ließ sich nicht mehr nachsehen.`
			: record === 'inbox'
				? `Ob ${createdInSentence(record, title)} trotz „Verwerfen“ schon im Eingang liegt, ließ sich nicht mehr nachsehen.`
				: `Ob ${createdInSentence(record, title)} trotz „Verwerfen“ schon angekommen ist, ließ sich nicht mehr nachsehen.`,
	/** The changes of a new ticket the deletion after 7 days took with its creation (round 2, A8). */
	droppedAlong: (count: number, title: string) =>
		count === 1
			? `Mit dem neuen Ticket „${title}“ wurde auch 1 Änderung daran gelöscht.`
			: `Mit dem neuen Ticket „${title}“ wurden auch ${count} Änderungen daran gelöscht.`,
	/**
	 * A ticket "＋" created that the server does not have yet, in its panel (OF-4a); since OF-4b it takes
	 * comments as well.
	 */
	createdHint:
		'Noch nicht übertragen. Status, Fälligkeit und Kommentare gehen schon, alles andere erst, wenn das Ticket übertragen ist.',
	itemCreatedHint:
		'Noch nicht übertragen. Umwandeln, Verknüpfen und Verwerfen gehen, sobald der Eintrag übertragen ist.',
	offlineWith: (count: number) =>
		count === 1
			? 'Keine Verbindung. 1 Änderung ist gemerkt und wird übertragen, sobald die Verbindung zurück ist.'
			: `Keine Verbindung. ${count} Änderungen sind gemerkt und werden übertragen, sobald die Verbindung zurück ist.`,
	retry: 'Erneut versuchen',
	show: 'Ansehen',
	sending: (count: number) => `Übertrage ${changes(count)} …`,
	progress: (index: number, count: number) =>
		`Verbindung wieder da. Übertrage ${index} von ${changes(count)} …`,
	sent: (count: number) => `${changes(count)} übertragen.`,
	pendingFlag: 'Wird übertragen, sobald die Verbindung zurück ist.',
	/** The flag of a kept completion; a series names that its next ticket comes later (§3.5). */
	pendingDone: (recurring: boolean) =>
		recurring
			? 'Wird übertragen, sobald die Verbindung zurück ist. Das nächste Ticket der Serie erscheint nach dem Abgleich.'
			: 'Wird übertragen, sobald die Verbindung zurück ist.',
	conflicts: (count: number, key: string) =>
		count === 1
			? `1 Änderung braucht deine Entscheidung: ${key} wurde inzwischen geändert.`
			: `${count} Änderungen brauchen deine Entscheidung, darunter ${key}: Es wurde inzwischen geändert.`,
	refusals: (count: number, key: string, reason: string) =>
		count === 1
			? `1 Änderung konnte nicht übertragen werden. ${key}: ${reason}`
			: `${count} Änderungen konnten nicht übertragen werden, darunter ${key}: ${reason}`,
	expired: (count: number) =>
		count === 1
			? '1 Änderung ist älter als 48 Stunden und wurde nicht übertragen.'
			: `${count} Änderungen sind älter als 48 Stunden und wurden nicht übertragen.`,
	/** Changes whose time of the device lies in the future (OF-2b). */
	clockExpired: (count: number) =>
		count === 1
			? 'Bei 1 Änderung liegt die Zeit des Geräts in der Zukunft; sie wurde nicht übertragen.'
			: `Bei ${count} Änderungen liegt die Zeit des Geräts in der Zukunft; sie wurden nicht übertragen.`,
	clockHint:
		'Die Zeit des Geräts liegt in der Zukunft, deshalb nicht von selbst übertragen. „Trotzdem übertragen“ sendet sie ohne die Zeit des Geräts.',
	/** The storage of the device failed (OF-2b); the flag carries "Details". */
	storageFailed: 'Gemerkte Änderungen ließen sich auf diesem Gerät nicht lesen oder speichern.',
	failed:
		'Übertragen gescheitert. Der Server hat mehrmals mit einem Fehler geantwortet; die Änderungen bleiben gemerkt.',
	signIn: (count: number) =>
		`${keptWaiting(count)}. Melde dich mit demselben Konto an, dann ${willThey(count)} übertragen. Mit einem anderen Konto ${willThey(count)} verworfen.`,
	full: 'Zu viele gemerkte Änderungen. Bitte erst wieder mit Verbindung weiterarbeiten.',
	notKept: 'Keine Verbindung. Das geht nur mit Verbindung, nichts wurde gemerkt.',
	broken: 'Dieser gemerkte Eintrag lässt sich nicht lesen und wird nicht übertragen.',
	mark: 'Noch nicht übertragen',
	markDecision: 'Entscheidung nötig',
	dialogTitle: 'Gemerkte Änderungen',
	dialogEmpty: 'Keine gemerkten Änderungen.',
	button: (count: number, offline: boolean) => {
		if (!offline) return `${changes(count)} gemerkt`;
		if (count === 0) return 'Offline, keine gemerkten Änderungen';
		return `Offline, ${changes(count)} gemerkt`;
	},
	waiting: 'wartet',
	underway: 'wird übertragen …',
	waitingFor: (key: string) => `wartet auf ${key}`,
	/** A change that waits for a creation (OF-4a round 2, A10): "wartet auf das neue Ticket „…“". */
	waitingForCreated: (record: CreatedKind, title: string) =>
		`wartet auf ${createdInSentence(record, title, true)}`,
	offlineAt: (time: string) => `offline um ${time}`,
	conflictMine: (time: string, text: string) =>
		`Deine Änderung (offline um ${time} laut Gerät): ${text}`,
	conflictNow: (who: string | null, status: string, time: string | null) => {
		const when = time === null ? '' : ` (${time})`;
		if (who === null) return `Inzwischen: Der Status steht auf „${status}“${when}.`;
		return `Inzwischen: ${who} hat den Status auf „${status}“ gesetzt${when}.`;
	},
	/** What happened to the due date meanwhile (OF-3); `due` is a date as "21.10.2026", null for none. */
	conflictDueNow: (who: string | null, due: string | null, time: string | null) => {
		const when = time === null ? '' : ` (${time})`;
		if (due === null) {
			if (who === null) return `Inzwischen: Das Ticket hat keine Fälligkeit mehr${when}.`;
			return `Inzwischen: ${who} hat die Fälligkeit entfernt${when}.`;
		}
		if (who === null) return `Inzwischen: Die Fälligkeit steht auf ${due}${when}.`;
		return `Inzwischen: ${who} hat die Fälligkeit auf ${due} gesetzt${when}.`;
	},
	takeMine: 'Meine Änderung übernehmen',
	discard: 'Verwerfen',
	openTicket: 'Ticket öffnen',
	sendAnyway: 'Trotzdem übertragen',
	expiredHint:
		'Älter als 48 Stunden, nicht von selbst übertragen. „Trotzdem übertragen“ sendet sie ohne die Zeit des Geräts.',
	openChildren: (count: number) =>
		count === 1 ? '1 Unteraufgabe ist noch offen.' : `${count} Unteraufgaben sind noch offen.`,
	force: 'Trotzdem erledigen',
	completeChildren: 'Unteraufgaben mit erledigen',
	/** The day of the plan is over (OF-3, decision of the user 3): the reason of the refusal. */
	dayOver: 'Der Tag ist vorbei, der Plan dieses Tages bleibt unverändert.',
	/** The question for the check mark of a task on a day gone by. */
	dayOverDone: (key: string) => `Der Tag ist vorbei. ${key} trotzdem erledigen?`,
	/** Every other check mark of a day gone by lapses. */
	dayOverLapsed:
		'Der Tag ist vorbei, der Plan dieses Tages bleibt unverändert. Der Haken verfällt.',
	/** Taking back a completion on a day gone by (OF-3b): the ticket may still be opened again. */
	dayOverReopen: (key: string) => `Der Tag ist vorbei. ${key} trotzdem wieder öffnen?`,
	reopenAnyway: 'Trotzdem wieder öffnen',
	discarded: (text: string) => `${text} verworfen.`,
	/** "Verwerfen" of a change that may have arrived (OF-3). */
	takenBack: (text: string) => `„${text}“ wird zurückgenommen, sobald eine Verbindung besteht.`,
	takenBackHint:
		'Die Änderung ist vielleicht schon angekommen; deshalb wird sie zurückgenommen statt nur gelöscht.',
	takingBack: 'wird zurückgenommen, sobald eine Verbindung besteht',
	/** A discarded change whose value a later change of the same ticket sets anyway (OF-3b). */
	discardedLater: 'verworfen, es gilt die spätere Änderung',
	/** The server refused a discarded change with 403 or 404 (OF-3b): it may stay in effect. */
	refusedMaybeArrived:
		'Die Änderung ist vielleicht schon angekommen und ließ sich nicht zurücknehmen. Bitte im Ticket prüfen.',
	counter: (text: string) => `Rücknahme: ${text}`,
	/**
	 * A take-back that waits or is sent has no "Verwerfen" of its own (OF-3b round 2, S2): setting the
	 * value anew always works, "Rückgängig" only while its flag stands (round 3, R2-5).
	 */
	takeBackHint:
		'Nimmt eine verworfene Änderung zurück. Wer es sich anders überlegt, setzt den Wert neu; direkt nach dem Verwerfen geht auch „Rückgängig“ im Hinweis.',
	/** Sub-tasks a discarded completion took along whose status before is unknown (round 2). */
	childrenUnknown: (count: number) =>
		count === 1
			? '1 Unteraufgabe wurde vielleicht mit erledigt; ihr Status vorher ist unbekannt, deshalb wird sie nicht zurückgenommen. Bitte im Ticket prüfen.'
			: `${count} Unteraufgaben wurden vielleicht mit erledigt; ihr Status vorher ist unbekannt, deshalb werden sie nicht zurückgenommen. Bitte im Ticket prüfen.`,
	/** "Rückgängig" after "Verwerfen" where a later change sets every value anyway (round 2). */
	undoLater: '„Rückgängig“ ändert nichts: Eine spätere Änderung setzt den Wert ohnehin.',
	/** "Rückgängig" after another account signed in (round 2). */
	undoOtherAccount: '„Rückgängig“ geht nicht mehr: Inzwischen ist ein anderes Konto angemeldet.',
	/**
	 * A sub-task a completion should have taken along that is not done once it arrived (round 3,
	 * R2-1): the hook completes sub-tasks on the step to "done" only. Nothing is sent on its own. Without
	 * a key "Eine Unteraufgabe" and "einem Ticket" (OF-3c, R3-5).
	 */
	childNotDone: (child: string, parent: string) =>
		`${child === '' ? 'Eine Unteraufgabe' : `Unteraufgabe ${child}`} ist nicht erledigt, obwohl sie mit ${parent === '' ? 'einem Ticket' : parent} erledigt werden sollte. Bitte im Ticket prüfen.`,
	/**
	 * Changes deleted after 7 days that were not surely sent and answered, with their tickets (round 3,
	 * R2-2); `keys` names them, "ein Ticket" for one without a key.
	 */
	dropped: (count: number, keys: string) =>
		count === 1
			? `1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: ${keys}.`
			: `${count} gemerkte Änderungen waren älter als 7 Tage und wurden gelöscht, ohne sicher übertragen zu sein: ${keys}.`,
	/**
	 * A take-back deleted after 7 days: the discarded change may still be in effect (round 3, R2-2);
	 * `text` is the change in words (`changeText`).
	 */
	droppedDiscard: (text: string) =>
		`Das Verwerfen von „${text}“ wurde nicht ausgeführt; der Server hat vielleicht noch den verworfenen Wert.`,
	/** The same where the discarded change itself was gone already (OF-3c, R3-5: no "von einer"). */
	droppedDiscardOf: (key: string) =>
		`Das Verwerfen einer Änderung an ${key === '' ? 'einem Ticket' : key} wurde nicht ausgeführt; der Server hat vielleicht noch den verworfenen Wert.`,
	checkTickets: (count: number) =>
		count === 1 ? 'Bitte im Ticket prüfen.' : 'Bitte in den Tickets prüfen.',
	/** The button of a notice that stays until it is closed (round 3). */
	closeNotice: 'Schließen',
	/** "Details" of a storage that changed under every write of a step (round 3, R2-9). */
	storageRaced:
		'Die gemerkten Änderungen auf diesem Gerät haben sich dreimal in Folge beim Schreiben geändert.',
	undo: 'Rückgängig',
	reloadTitle: 'Ohne Verbindung neu laden?',
	reloadText: (count: number) =>
		`${count === 1 ? '1 Änderung ist gemerkt und bleibt' : `${count} Änderungen sind gemerkt und bleiben`} erhalten. Ohne Verbindung lässt sich die App aber erst wieder öffnen, wenn der Server erreichbar ist.`,
	reloadConfirm: 'Neu laden',
	logoutTitle: (count: number) =>
		count === 1
			? 'Abmelden und 1 gemerkte Änderung verwerfen?'
			: `Abmelden und ${count} gemerkte Änderungen verwerfen?`,
	logoutText: (count: number) =>
		count === 1
			? 'Sie wurde noch nicht übertragen und geht beim Abmelden verloren.'
			: 'Sie wurden noch nicht übertragen und gehen beim Abmelden verloren.',
	logoutConfirm: 'Abmelden und verwerfen',
	notLoaded:
		'Diese Ansicht ist ohne Verbindung noch nicht geladen. Gemerkte Änderungen bleiben erhalten.',
	back: 'Zurück',
	notLoadedTitle: 'Ohne Verbindung nicht verfügbar'
});

/**
 * What the outbox did when its storage failed, for "Details" (ADR-0071 §3, OF-2b): the intent of
 * the step, with the change in words where there is one.
 */
export const OFFLINE_INTENTS = Object.freeze({
	send: 'Gemerkte Änderungen übertragen',
	read: 'Gemerkte Änderungen auf diesem Gerät lesen',
	retry: 'Gemerkte Änderungen erneut versuchen',
	discard: (text: string) => `Gemerkte Änderung verwerfen: ${text}`,
	restore: (text: string) => `Verwerfen rückgängig machen: ${text}`,
	takeMine: (text: string) => `Meine Änderung übernehmen: ${text}`,
	sendAnyway: (text: string) => `Trotzdem übertragen: ${text}`,
	answerChildren: (text: string) => `Offene Unteraufgaben beantworten: ${text}`,
	completeAnyway: (text: string) => `Trotzdem erledigen: ${text}`,
	reopenAnyway: (text: string) => `Trotzdem wieder öffnen: ${text}`,
	/** "Ohne Projekt anlegen" and "Ohne Tags anlegen" of a refused creation (OF-4a). */
	withoutField: (field: CreateField, text: string) =>
		`${field === 'project' ? 'Ohne Projekt anlegen' : 'Ohne Tags anlegen'}: ${text}`,
	/** Looking up a discarded creation that may have arrived (OF-4a). */
	lookUp: (text: string) => `Nachsehen, ob schon angelegt: ${text}`,
	/** "Als Eingangseintrag sichern" of a comment (OF-4b). */
	saveAsItem: (text: string) => `Als Eingangseintrag sichern: ${text}`,
	/** The notices on the device (OF-3c). */
	keepNotice: 'Hinweis zu gemerkten Änderungen auf diesem Gerät speichern',
	closeNotice: 'Hinweis zu gemerkten Änderungen schließen'
});

/** The words of a refusal for the notice: the reason of the server, or why it waits. */
export function reasonOf(action: KeptAction): string {
	if (action.outcome?.code === OPEN_CHILDREN_CODE) {
		return OFFLINE_TEXTS.openChildren(action.outcome.count ?? 1);
	}
	return action.outcome?.message ?? '';
}
