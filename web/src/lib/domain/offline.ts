// Rules of the outbox of the SPA (OF-2, ADR-0074 and its addendum OF-2). Pure: no clock, no random
// source and no storage of its own; the callers pass them in. The rules of the server stand in
// app/pb_hooks/lib/client-ops-rules.js; the identifier, the bounds of the time of the device, the
// six actions and the catalog of the codes are mirrored here, tests/unit/web-offline.test.mjs keeps
// both sides the same.
//
// - An action is one change the user made, never a copy of data: in OF-2 the status of a ticket
//   (the check mark in "Aufgaben", the status in the cell, the panel and the full view). It carries
//   its identifier (`op`) from the first attempt on, so sending it twice changes nothing the second
//   time.
// - Actions of one ticket follow each other: a change that never left the device takes the next one
//   in (`expected` stays the one of the first, the wish the one of the last), and one that falls
//   back to the value before goes. Once a request with its identifier may have left the device
//   (`sent`, OF-2b), it is never taken in again: the server answers a known identifier like the
//   first time without comparing the content, so a new wish would be lost. A change behind it, or
//   behind one that waits for a decision, is a new action that waits for it (`dependsOn`), also
//   taking a change back (a counter action, concept §3.3).
// - The display lays the waiting actions over the state of the server (`overlayStatus`); the
//   stores keep the state of the server.
// - After 48 hours an action is no longer sent on its own (decision of the user 2), after 7 days
//   it goes.

import { formatBerlinDateTime, toPocketBaseTimestamp } from './format';
import { STATUS_LABELS } from './labels';
import { isStatus, type Status } from './status';
import type { CompletionChoice } from './subtasks';

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

/**
 * A new identifier: 20 characters a–z0–9 from `fill` (crypto.getRandomValues; there is no
 * randomUUID without a secure context). Bytes of 252 and above are drawn again, so every character
 * is equally likely.
 */
export function newOpId(fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array): string {
	let id = '';
	while (id.length < OP_LENGTH) {
		for (const byte of fill(new Uint8Array(OP_LENGTH * 2))) {
			if (byte >= 252) continue;
			id += OP_ALPHABET[byte % OP_ALPHABET.length];
			if (id.length === OP_LENGTH) break;
		}
	}
	return id;
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
}

/** The code of an entry of the device that this SPA cannot read (another format, damaged). */
export const BROKEN_CODE = 'broken';
/** The code of an action whose time of the device lies in the future (OF-2b): it waits like an old one. */
export const CLOCK_CODE = 'clock';
/** The refusal of a completion with open blocking sub-tasks (ADR-0033 §2). */
export const OPEN_CHILDREN_CODE = 'validation_parent_open_children';

/** A change of the status of a ticket, as kept on the device (format version 1). */
export interface OutboxAction {
	v: 1;
	/** The identifier, 20 characters a–z0–9. */
	op: string;
	/** The order on this device. */
	seq: number;
	/** The account; only this account sends it. */
	user: string;
	/** The area at the time of the change (u:… or h:…), '' when unknown. */
	scope: string;
	kind: 'ticket.update';
	/** The record ID of the ticket. */
	target: string;
	/** Identifiers that have to arrive first. */
	dependsOn: string[];
	/** The wish: only the changed values. */
	payload: { status: Status };
	/** The values the change was based on, per changed field (in the form of the history). */
	expected: { status: Status };
	/** The answer to "N Unteraufgaben sind noch offen – trotzdem erledigen?" (ADR-0033 §2). */
	completion?: CompletionChoice;
	/** The sub-tasks a completion with "complete_children" takes along, for the display. */
	children?: string[];
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
	/** "Trotzdem übertragen" after 48 hours: sent without the time of the device. */
	late?: boolean;
	outcome?: ActionOutcome;
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
		...(finite(value.count) && { count: value.count })
	};
}

/**
 * An entry of the device as an action. One of another format or damaged comes back as a refused
 * action with the code BROKEN_CODE, so it is shown with "Verwerfen" and never sent; one without an
 * identifier or an account of its own comes back as null (it belongs to nobody and goes).
 */
export function parseAction(raw: unknown): OutboxAction | null {
	if (!isRecord(raw) || typeof raw.op !== 'string' || !OP_PATTERN.test(raw.op)) return null;
	if (typeof raw.user !== 'string' || raw.user === '') return null;
	const payload = isRecord(raw.payload) ? raw.payload : null;
	const expected = isRecord(raw.expected) ? raw.expected : null;
	const state = ACTION_STATES.find((entry) => entry === raw.state);
	const completion = completionOf(raw.completion);
	const outcome = outcomeOf(raw.outcome);
	const valid =
		raw.v === 1 &&
		raw.kind === 'ticket.update' &&
		typeof raw.target === 'string' &&
		raw.target !== '' &&
		finite(raw.seq) &&
		finite(raw.createdAt) &&
		state !== undefined &&
		payload !== null &&
		isStatus(payload.status) &&
		expected !== null &&
		isStatus(expected.status) &&
		isStringList(raw.dependsOn) &&
		(raw.children === undefined || isStringList(raw.children)) &&
		(raw.completion === undefined || completion !== undefined);
	if (!valid || payload === null || expected === null || state === undefined) {
		return brokenAction(raw.op, raw.user, raw);
	}
	return {
		v: 1,
		op: raw.op,
		seq: raw.seq as number,
		user: raw.user,
		scope: typeof raw.scope === 'string' ? raw.scope : '',
		kind: 'ticket.update',
		target: raw.target as string,
		dependsOn: [...(raw.dependsOn as string[])],
		payload: { status: payload.status as Status },
		expected: { status: expected.status as Status },
		...(completion !== undefined && { completion }),
		...(raw.children !== undefined && { children: [...(raw.children as string[])] }),
		key: typeof raw.key === 'string' ? raw.key : '',
		title: typeof raw.title === 'string' ? raw.title : '',
		createdAt: raw.createdAt as number,
		state,
		attempts: finite(raw.attempts) ? raw.attempts : 0,
		nextAttemptAt: finite(raw.nextAttemptAt) ? raw.nextAttemptAt : 0,
		...(finite(raw.sendingSince) && { sendingSince: raw.sendingSince }),
		...(raw.sent === true && { sent: true as const }),
		...(raw.late === true && { late: true }),
		...(outcome !== undefined && { outcome })
	};
}

/**
 * Whether an entry of the device is still the action as `known` (same content and state), for the
 * compare-and-swap of the storage (OF-2b): both are read the same way, so the order of their keys
 * does not matter.
 */
export function sameAction(stored: unknown, known: OutboxAction): boolean {
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
export function isBroken(action: OutboxAction): boolean {
	return action.outcome?.code === BROKEN_CODE;
}

/** Waits or is under way: the display lays it over the ticket and marks it. */
export function isWaiting(action: OutboxAction): boolean {
	return action.state === 'queued' || action.state === 'sending';
}

/** Waits for a decision of the user (conflict, refused, expired). */
export function needsDecision(action: OutboxAction): boolean {
	return !isWaiting(action);
}

/** The actions in their order on the device. */
export function inOrder(actions: Iterable<OutboxAction>): OutboxAction[] {
	return [...actions].sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt);
}

interface StatusTicket {
	id: string;
	status: Status;
	completedAt: string | null;
}

/** Whether a waiting completion with "Unteraufgaben mit erledigen" takes the ticket along. */
function takesAlong(action: OutboxAction, id: string): boolean {
	if (action.payload.status !== 'done' || action.completion !== 'complete_children') return false;
	return action.children?.includes(id) === true;
}

/**
 * The ticket as the waiting actions make it: their status in order, `completedAt` from the time of
 * the device of the completion (only for the display; the server sets its own). A sub-task a
 * waiting completion with "complete_children" takes along shows as done as well. Actions waiting
 * for a decision lay nothing over it. Without such an action the ticket itself comes back.
 */
export function overlayStatus<T extends StatusTicket>(
	ticket: T,
	actions: Iterable<OutboxAction>
): T {
	let status: Status | null = null;
	let at = 0;
	for (const action of inOrder(actions)) {
		if (!isWaiting(action)) continue;
		if (action.target === ticket.id) {
			status = action.payload.status;
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

/** The status the server will have once every open action of the ticket arrived. */
export function chainedStatus(base: Status, actions: readonly OutboxAction[]): Status {
	const last = actions.at(-1);
	return last === undefined ? base : last.payload.status;
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
}

/** What the outbox does with a change: send it now, keep it, take it into one, or drop one. */
export type ChangePlan =
	| { kind: 'send'; action: OutboxAction }
	| { kind: 'queue'; action: OutboxAction }
	| { kind: 'merge'; action: OutboxAction }
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

/** The answer to the open sub-tasks of a completion, and the sub-tasks it takes along. */
function completionFields(
	status: Status,
	completion: CompletionChoice | undefined,
	children: readonly string[] | undefined
): Pick<OutboxAction, 'completion' | 'children'> {
	if (status !== 'done' || completion === undefined) return {};
	if (completion === 'force') return { completion };
	return { completion, children: [...(children ?? [])] };
}

/**
 * The plan for a change of the status of `change.target` (concept OF-0 §3.3):
 * - an action of the ticket that waits and never left the device takes the change in (the
 *   completion follows the last wish) or goes, when the wish is the value before again;
 * - behind any other open action of the ticket, also one sent without an answer (`sent`, OF-2b), a
 *   new one waits for it, based on its wish; taking it back is such a counter action;
 * - without an open action a change goes at once (`send`, marked as sent before it leaves) or,
 *   offline, is kept (`queue`); offline a change to the value the ticket has does nothing.
 */
export function planStatusChange(
	open: readonly OutboxAction[],
	change: StatusChange,
	context: PlanContext
): ChangePlan {
	const mine = inOrder(open.filter((action) => action.target === change.target));
	const last = mine.at(-1);
	if (last !== undefined && last.state === 'queued' && last.sent !== true) {
		if (change.status === last.expected.status) return { kind: 'cancel', op: last.op };
		const completion = change.completion ?? last.completion;
		const children = change.children ?? last.children;
		const merged: OutboxAction = { ...last, payload: { status: change.status } };
		delete merged.completion;
		delete merged.children;
		const fields = completionFields(change.status, completion, children);
		return {
			kind: 'merge',
			action: { ...merged, ...fields, key: change.key, title: change.title }
		};
	}
	const expected = chainedStatus(change.base, mine);
	if (mine.length === 0 && context.offline && expected === change.status) return { kind: 'none' };
	const action: OutboxAction = {
		v: 1,
		op: context.op,
		seq: context.seq,
		user: context.user,
		scope: change.scope,
		kind: 'ticket.update',
		target: change.target,
		dependsOn: mine.map((entry) => entry.op),
		payload: { status: change.status },
		expected: { status: expected },
		...completionFields(change.status, change.completion, change.children),
		key: change.key,
		title: change.title,
		createdAt: context.now,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0
	};
	if (mine.length === 0 && !context.offline) {
		return {
			kind: 'send',
			action: { ...action, state: 'sending', sendingSince: context.now, sent: true }
		};
	}
	return { kind: 'queue', action };
}

/** The time of an action lies more than 5 minutes ahead of the clock (OF-2b). */
function ahead(at: number | undefined, now: number): boolean {
	return at !== undefined && at - now > DEVICE_FUTURE_MS;
}

/** Whether an action "sending" lost its sender: longer under way than a request may take. */
function isStale(action: OutboxAction, now: number): boolean {
	if (action.state !== 'sending') return false;
	return now - (action.sendingSince ?? 0) >= STALE_SENDING_MS;
}

/**
 * Whether the time of the device of a waiting action lies in the future (OF-2b): it was kept, or
 * marked as under way, more than 5 minutes after now. The clock went back or was wrong; such an
 * action is neither sent nor deleted on its own, it waits for a decision like an old one. After
 * "Trotzdem übertragen" (`late`) its time no longer counts.
 */
export function isFromTheFuture(action: OutboxAction, now: number): boolean {
	if (action.state === 'sending' && ahead(action.sendingSince, now)) return true;
	const free = action.state === 'queued' || isStale(action, now);
	return free && action.late !== true && ahead(action.createdAt, now);
}

/**
 * The next action to send: in order, waiting, its time come, every action it depends on arrived
 * (gone from the outbox). An action "sending" for longer than STALE_SENDING_MS lost its sender and
 * counts as waiting again (concept §3.9).
 */
export function nextToSend(actions: readonly OutboxAction[], now: number): OutboxAction | null {
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
function wakeOf(action: OutboxAction): number {
	if (action.state === 'queued') return action.nextAttemptAt;
	if (action.state === 'sending') return (action.sendingSince ?? 0) + STALE_SENDING_MS;
	return 0;
}

/**
 * The earliest time the worker has to look again, null when nothing waits for a time: an action
 * after an error of the server, or one "sending" whose sender may have died.
 */
export function nextWakeOf(actions: readonly OutboxAction[], now: number): number | null {
	let next: number | null = null;
	for (const action of actions) {
		const at = wakeOf(action);
		if (at <= now) continue;
		next = next === null ? at : Math.min(next, at);
	}
	return next;
}

/** Whether a waiting action is older than 48 hours: queued, or "sending" without its sender. */
function isOld(action: OutboxAction, now: number): boolean {
	const free = action.state === 'queued' || isStale(action, now);
	return free && action.late !== true && now - action.createdAt >= AUTO_SEND_MS;
}

/**
 * What the time does to the actions: waiting ones older than 48 hours are no longer sent on their
 * own (`expire`; not after "Trotzdem übertragen"), also one "sending" whose sender died (OF-2b), and
 * so are those whose time lies in the future (`isFromTheFuture`); any older than 7 days goes
 * (`drop`).
 */
export function agedActions(
	actions: readonly OutboxAction[],
	now: number
): { expire: string[]; drop: string[] } {
	const expire: string[] = [];
	const drop: string[] = [];
	for (const action of actions) {
		if (now - action.createdAt >= KEEP_MS) drop.push(action.op);
		else if (isOld(action, now) || isFromTheFuture(action, now)) expire.push(action.op);
	}
	return { expire, drop };
}

/**
 * The actions right behind `op` (their value before was its wish), now based on `status`, the last
 * known state of the server, once `op` is discarded (OF-2b); back on its wish when it returns.
 * Actions under way keep what they were sent with.
 */
export function rebasedBehind(
	actions: readonly OutboxAction[],
	op: string,
	status: Status
): OutboxAction[] {
	return actions
		.filter((action) => action.state !== 'sending' && action.dependsOn.at(-1) === op)
		.filter((action) => action.expected.status !== status)
		.map((action) => ({ ...action, expected: { status } }));
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

/**
 * The fields of a request: the first attempt right after the change sends only the identifier, as
 * a change with a connection is no change of the outbox (the result stays the one of today); every
 * later attempt sends the time of the device and the values before, after "Trotzdem übertragen"
 * only `offline` instead of the time.
 */
export function requestFields(
	action: Pick<OutboxAction, 'op' | 'expected' | 'createdAt' | 'late'>,
	first: boolean
): OutboxFields {
	if (first) return { opId: action.op };
	const expected = { status: action.expected.status };
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
 * arrived; a conflict at the status waits for a decision; open sub-tasks wait for the answer to
 * the question; 401 waits for the sign-in; a missing answer (network, time limit, `aborted` by the
 * limit) waits for the connection; 5xx tries again later; every other answer is refused for good.
 */
export function verdictOf(failure: FailureFacts): SendVerdict {
	if (failure.kind === 'network' || failure.kind === 'aborted') return { result: 'network' };
	if (failure.kind === 'session') return { result: 'session' };
	const serverError = failure.status === 0 || failure.status >= 500;
	if (failure.kind === 'server' && serverError) return { result: 'server' };
	const fields = Object.entries(failure.fields);
	if (fields.some(isApplied)) return { result: 'arrived' };
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
	if (first === undefined) {
		return { result: 'refused', outcome: { code: failure.kind, message: failure.message } };
	}
	const [, error] = first;
	const count = error.params?.count;
	const outcome: ActionOutcome = {
		code: error.code,
		message: OFFLINE_MESSAGES[error.code] ?? error.message,
		...(error.code === OPEN_CHILDREN_CODE && { count: finite(count) ? count : 1 })
	};
	return { result: 'refused', outcome };
}

/** Bytes of the actions as the device keeps them, for OUTBOX_MAX_BYTES. */
export function sizeOf(actions: readonly OutboxAction[]): number {
	return new TextEncoder().encode(JSON.stringify(actions)).length;
}

/**
 * Whether `next` still fits on the device; taking a change into an action of the same identifier
 * replaces it and is no action more (OF-2b).
 */
export function hasRoom(actions: readonly OutboxAction[], next: OutboxAction): boolean {
	const rest = actions.filter((action) => action.op !== next.op);
	if (rest.length >= OUTBOX_MAX_ACTIONS) return false;
	return sizeOf([...rest, next]) <= OUTBOX_MAX_BYTES;
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

/** What an action does, in words: "HAUS-12 erledigt", "HAUS-12 auf „In Arbeit“". */
export function actionText(action: Pick<OutboxAction, 'key' | 'payload'>): string {
	const key = action.key === '' ? 'Ticket' : action.key;
	const status = action.payload.status;
	if (status === 'done') return `${key} erledigt`;
	return `${key} auf „${STATUS_LABELS[status]}“`;
}

/** "1 gemerkte Änderung wartet" or "3 gemerkte Änderungen warten". */
function keptWaiting(count: number): string {
	return count === 1 ? '1 gemerkte Änderung wartet' : `${count} gemerkte Änderungen warten`;
}

/** "wird sie" or "werden sie", after the number of changes. */
function willThey(count: number): string {
	return count === 1 ? 'wird sie' : 'werden sie';
}

/** The words of the outbox (concept OF-0 §2.1, §2.3, §2.4; OF-2 keeps check marks and status). */
export const OFFLINE_TEXTS = Object.freeze({
	offline:
		'Keine Verbindung zu becauseyoulovejira. Abhaken und Status werden gemerkt und später übertragen.',
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
	offlineAt: (time: string) => `offline um ${time}`,
	conflictMine: (time: string, text: string) =>
		`Deine Änderung (offline um ${time} laut Gerät): ${text}`,
	conflictNow: (who: string | null, status: string, time: string | null) => {
		const when = time === null ? '' : ` (${time})`;
		if (who === null) return `Inzwischen: Der Status steht auf „${status}“${when}.`;
		return `Inzwischen: ${who} hat den Status auf „${status}“ gesetzt${when}.`;
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
	discarded: (text: string) => `${text} verworfen.`,
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
	answerChildren: (text: string) => `Offene Unteraufgaben beantworten: ${text}`
});

/** The words of a refusal for the notice: the reason of the server, or why it waits. */
export function reasonOf(action: OutboxAction): string {
	if (action.outcome?.code === OPEN_CHILDREN_CODE) {
		return OFFLINE_TEXTS.openChildren(action.outcome.count ?? 1);
	}
	return action.outcome?.message ?? '';
}
