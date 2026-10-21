// The outbox of the SPA (OF-2, ADR-0074 and its addenda OF-2, OF-2b and OF-3; concept OF-0 §3). It
// keeps single changes that could not reach the server and sends them later over the normal way (data
// layer → Record API or route → hooks), with the identifier of the action, the time of the device and
// the value before: the status of a ticket (OF-2), its due date and the check mark of an entry of the
// day plan with its taking back (OF-3). Never a copy of data: the stores keep the state of the server,
// the outbox lays its waiting actions over it (`apply`, `checkRow`) and marks tickets and entries
// (`markOf`).
//
// - It works only while the server reports `offline_ops` and the phone frame applies (switch
//   "Handy-Ansicht (Vorschau)" on and a narrow window, `setFrame`). Otherwise every change goes the
//   way of today, without identifier, time limit or notice. Actions kept in the frame are still sent
//   and shown when the frame no longer applies (the phone turned), so nothing hangs; outside of the
//   frame a change of a ticket goes through the outbox only behind one that waits to be sent.
// - A change with a connection is sent at once, with its identifier only (the result and the
//   messages stay the ones of today); only when the answer does not come (no connection, 12 s
//   limit) it stays in the outbox, and the store gets the value as a provisional answer. An action
//   is marked as sent before every attempt and is never taken into another change after that
//   (OF-2b): marking and taking in are compare-and-swaps of the storage, so they never overwrite
//   each other, in one tab or across tabs. After a first attempt that arrived the worker looks for a
//   change that waits behind it (OF-3).
// - "Verwerfen" of an action that may have arrived keeps it to the end (OF-3). Since OF-3b the take-
//   backs behind it follow from every change of a chain (`settleChains` in domain/offline-chain.ts):
//   every value ends on what the user wants, a refusal of a discarded one passes its value before on,
//   and a 403 or 404 of one shows. Every write of the device is a compare-and-swap against the state
//   just read; after a request the worker decides on the action as it is stored now, not on its copy.
//   Since round 2 a take-back never expires and has no "Verwerfen" of its own; "Rückgängig" always
//   leads back to what the user wanted before "Verwerfen".
// - Nothing goes without a word (round 3): what the deletion after 7 days takes, and a sub-task a
//   completion should have taken along that the server did not complete, show as notices that stay
//   until the user closes them (`notices`); every 5xx counts as "may have arrived"; reading a ticket
//   again has the time limit of a request. Since OF-3c the notices stay on the device per account
//   (store "meta", domain/offline-notices.ts): every tab of the account shows them, also after a
//   reload, until "Schließen" in one of them; a deleted action and its notice go in one transaction.
//   Only an app without the way of a kind keeps an error without a status as "not arrived".
// - The actions belong to the signed-in account: another account never sends them, and they are
//   deleted when another account signs in (decision of the user 4). "Abmelden" deletes them after
//   the question (`clearUser`), also when this tab never read the device; an ended session keeps
//   them. Before every request the client has to be signed in with the account of the action.
// - One tab sends (OutboxRunner with the lease of the device); the BroadcastChannel "byl-outbox"
//   tells the other tabs to read the device again. Its identifier and the channel come with the
//   first watch, so without the capability nothing is created in the browser.
// - A failing storage of the device shows as an error flag with "Details", never as an uncaught
//   rejection.
// - Since OF-4a "＋" creates a ticket or an entry of the inbox under an ID of the client, the same way:
//   kept before the first attempt, sent with `id` and `op_id`. Until the server has it, the stores show
//   it from here (`createdTickets`, `createdItems`, "Neu" instead of the key); its answer replaces it
//   under the same ID before the action goes. A change of such a ticket goes into the creation while it
//   never left the device, else it waits for it. "Verwerfen" of a creation that never left the device
//   deletes it with its changes; one that may have arrived is never sent again and never deleted on
//   the server: it is only looked up by its ID, and where it is there a notice that stays names it with
//   a link (C1 to C4 of ADR-0074 addendum OF-4a). Since round 2 a 5xx at the first attempt keeps a
//   creation like a missing answer (A1); a lookup that does not find it, also after a refusal that
//   followed a request without an answer, is final only 5 minutes after its last request (A5); a
//   repetition the server answers with `validation_op_applied` names it in a notice (A7).

import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { CheckedTicket, DayPlanItem } from '$lib/data/day-plan';
import { DataError, problemOf, toDataError, withIntent } from '$lib/data/errors';
import type { CalendarDate } from '$lib/domain/berlin-date';
import { kindOf, type CheckAction, type CheckMode } from '$lib/domain/day-plan';
import {
	CLOCK_CODE,
	FAILURES_BEFORE_NOTICE,
	OFFLINE_INTENTS,
	OFFLINE_TEXTS,
	SEND_TIMEOUT_MS,
	actionText,
	agedActions,
	backoffDelay,
	canCompleteAnyway,
	canReopenAnyway,
	childrenAlong,
	completionInstead,
	createdItemOf,
	createdRecordOf,
	createdTicketOf,
	dueOfServer,
	hasRoom,
	inOrder,
	isCreateAction,
	isDayPlanAction,
	isDueAction,
	isFromTheFuture,
	isInboxCreate,
	isStatusAction,
	isTakeBack,
	isTicketCreate,
	isWaiting,
	lookUpAgainAt,
	mayStillArrive,
	newOpId,
	newRecordId,
	nextToSend,
	nextWakeOf,
	overlayDoneToday,
	overlayDue,
	overlayStatus,
	parseAction,
	planCheckChange,
	planCreate,
	planTicketDue,
	planTicketStatus,
	reopenInstead,
	requestFields,
	sameAction,
	supportsKind,
	ticketOf,
	unknownChildren,
	verdictOf,
	withoutFieldOf,
	type ActionOutcome,
	type ChangePlan,
	type CheckChange,
	type CreateAction,
	type CreateChange,
	type CreateField,
	type DayPlanAction,
	type DueAction,
	type InboxCreateAction,
	type KeptAction,
	type OfflineOps,
	type OutboxAction,
	type OutboxFields,
	type PlanContext,
	type ServerState,
	type TicketCreateAction
} from '$lib/domain/offline';
import {
	coveredAtExpiry,
	leaveChain,
	mayBeThere,
	settleChains,
	wishAgain,
	type ChainContext,
	type Fresh,
	type Leave
} from '$lib/domain/offline-chain';
import {
	childNotice,
	createdNotice,
	decidesInstead,
	droppedEntries,
	noticeText,
	parseNotices,
	settledBy,
	withDropped,
	withNotices,
	withoutDecided,
	withoutNotice,
	type OfflineNotice
} from '$lib/domain/offline-notices';
import type { InboxItem, InboxItemSummary } from '$lib/domain/inbox';
import type { ProblemEntry } from '$lib/domain/problems';
import { isStatus, type Priority, type Status } from '$lib/domain/status';
import type { CompletionChoice } from '$lib/domain/subtasks';
import type { Ticket, TicketDraft, TicketSummary } from '$lib/domain/ticket';
import type { RequestOutcome } from '$lib/pocketbase';
import type { FlagSink } from '$lib/stores/flags.svelte';
import { WINDOW_TIMERS, type ConnectivityStore, type Timers } from './connectivity.svelte';
import { OutboxRunner } from './outbox-runner';
import type { OutboxStorage } from './outbox-storage';

export const OUTBOX_CHANNEL = 'byl-outbox';

/** How often a change is planned again when the device changed meanwhile (another step or tab). */
const PLAN_ROUNDS = 3;
/** How often in a row the worker may find an action changed before it gives the run up. */
const SWAP_MISSES = 3;
/** Numbers of the order of the probe in `#pure`: after any the device hands out (it counts from 1). */
const PROBE_SEQ = Number.MAX_SAFE_INTEGER - 1_000_000;

/** The messages between the tabs: only "read the device again", never a value. */
export interface OutboxChannel {
	post(): void;
	listen(onmessage: () => void): () => void;
}

/** The BroadcastChannel of the browser, null where there is none (then a tab reads on focus). */
export function broadcastChannel(name: string): OutboxChannel | null {
	if (typeof BroadcastChannel !== 'function') return null;
	const channel = new BroadcastChannel(name);
	return {
		post: () => channel.postMessage({ type: 'changed' }),
		listen: (onmessage) => {
			const handler = () => onmessage();
			channel.addEventListener('message', handler);
			return () => channel.removeEventListener('message', handler);
		}
	};
}

/** The answer of a check mark of the day plan (OF-3); `kept`: the outbox keeps it for later. */
export interface CheckAnswer {
	item: DayPlanItem;
	ticket: CheckedTicket;
	action: CheckAction;
	kept?: true;
}

/** What the outbox needs from the app; tests pass fakes. */
export interface OutboxDeps {
	/** The storage of the device; null without IndexedDB (the outbox then never works). */
	storage: OutboxStorage | null;
	/** Whether the device already has the storage, without creating it (`indexedDB.databases()`). */
	exists?: () => Promise<boolean>;
	connectivity: ConnectivityStore;
	/** Sends the status of `action` over the Record API with the fields of the outbox. */
	send(action: OutboxAction, fields: OutboxFields, signal: AbortSignal): Promise<Ticket>;
	/** Sends the due date of `action` (OF-3); without it the outbox keeps no due date. */
	sendDue?(action: DueAction, fields: OutboxFields, signal: AbortSignal): Promise<Ticket>;
	/** Sends a check mark of the day plan or its taking back (OF-3); without it none is kept. */
	sendDayPlan?(
		action: DayPlanAction,
		fields: OutboxFields,
		signal: AbortSignal
	): Promise<CheckAnswer>;
	/**
	 * Creates a ticket of "＋" under the ID of the client (OF-4a); without it "＋" keeps no ticket.
	 */
	sendCreate?(
		action: TicketCreateAction,
		fields: OutboxFields,
		signal: AbortSignal
	): Promise<Ticket>;
	/** Puts an entry of "＋" into the inbox under the ID of the client (OF-4a). */
	sendItem?(
		action: InboxCreateAction,
		fields: OutboxFields,
		signal: AbortSignal
	): Promise<InboxItem>;
	/** Reads an entry of the inbox (a discarded creation that may have arrived, OF-4a). */
	getItem?(id: string, signal?: AbortSignal): Promise<InboxItem>;
	/** The area of the client for new records ('u:…' or 'h:…'), null without one (OF-4a). */
	area?: () => string | null;
	/**
	 * Reads a ticket again (after a conflict, a refusal, an action that arrived before); `signal` ends
	 * it after the time limit of a request (round 3).
	 */
	get(id: string, signal?: AbortSignal): Promise<Ticket>;
	/** The identifier of this tab, or where to get it on the first watch (sessionStorage). */
	tab: string | (() => string);
	/** The account the client is signed in with now (`pb.authStore`); without it the attached one. */
	account?: () => string | null;
	now?: () => number;
	random?: () => number;
	fill?: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;
	timers?: Timers;
	/** The channel between the tabs, or where to open it on the first watch; null without one. */
	channel?: OutboxChannel | null | (() => OutboxChannel | null);
	win?: Window | null;
	/** Lets the monitor watch every request of the SDK (lib/pocketbase.ts), null stops it. */
	observe?: (note: ((outcome: RequestOutcome) => void) | null) => void;
	/** Calls `check` when the realtime connection ends (`pb.realtime.onDisconnect`), null stops it. */
	watchRealtime?: (check: (() => void) | null) => void;
}

/** Where the outbox reports to the app (the layout). */
export interface OutboxSink {
	/** A ticket as the server has it now, or as it was before a discarded action. */
	upsert(ticket: TicketSummary): void;
	flags: FlagSink;
	/** The server answered 401 while sending: the session ended, the actions stay. */
	sessionEnded(): void;
	/** The open blocking sub-tasks a completion takes along ("Unteraufgaben mit erledigen"). */
	childrenOf?(id: string): readonly string[];
	/** An entry of the inbox as the server has it now (a creation of "＋" arrived, OF-4a). */
	upsertItem?(item: InboxItemSummary): void;
	/** A ticket created one by one counts as read (ADR-0015 §3), also once "＋" arrived later (OF-4a). */
	markRead?(ticket: Ticket): void;
}

/** What "＋" puts into the inbox (OF-4a): the title and the values of the line. */
export interface QuickItemDraft {
	title: string;
	project: string | null;
	tags: readonly string[];
	priority: Priority | null;
}

/** What "＋" gives back (OF-4a): the record of the server, or the one kept for later (`kept`). */
export interface Created<T> {
	value: T;
	kept: boolean;
}

/** The device holds as many actions as it may (concept §3.2). */
export class OutboxFullError extends DataError {
	constructor() {
		super('network');
		this.name = 'OutboxFullError';
		this.message = OFFLINE_TEXTS.full;
	}
}

/**
 * The storage of the device failed while a change was kept (round 2): nothing was kept. Without an
 * exception of the storage, the device changed under every write of a step; its cause says so, so
 * "Details" names the storage, not the server or the connection (round 3, R2-9).
 */
export class OutboxStorageError extends DataError {
	constructor(cause: unknown = storageRaced()) {
		super('server', { cause });
		this.name = 'OutboxStorageError';
		this.message = OFFLINE_TEXTS.storageFailed;
	}
}

/** The cause of an OutboxStorageError where the storage changed under every write (round 3). */
function storageRaced(): Error {
	const error = new Error(OFFLINE_TEXTS.storageRaced);
	error.name = 'OutboxStorageError';
	return error;
}

/**
 * The app has no way to send this kind of action (an app without it, OF-3c, R3-2): nothing left the
 * device, so unlike every other error of the server it never makes an action "may have arrived".
 */
export class OutboxNoWayError extends DataError {
	constructor() {
		super('server');
		this.name = 'OutboxNoWayError';
	}
}

/**
 * A notice that stays until the user closes it (round 3; since OF-3c on the device, in every tab):
 * what went or did not happen, in words made when it shows.
 */
export interface OutboxNotice {
	readonly id: string;
	readonly text: string;
	/** The record a notice names (OF-4a: a discarded creation that arrived anyway). */
	readonly link?: { readonly record: 'ticket' | 'inbox'; readonly id: string };
}

/** A change of the status a store asks for. */
export interface StatusRequest {
	status: Status;
	completion?: CompletionChoice;
	/** The sub-tasks "complete_children" takes along, for the display. */
	children?: readonly string[];
}

/** A check mark of the day plan or its taking back a store asks for (OF-3). */
export type CheckRequest =
	| {
			kind: 'dayplan.check';
			mode: CheckMode;
			completion?: CompletionChoice;
			children?: readonly string[];
	  }
	| { kind: 'dayplan.uncheck'; action?: CheckAction; status?: Status };

/** An entry of the day plan with its ticket, as the server has them. */
export interface CheckEntry {
	item: DayPlanItem;
	ticket: TicketSummary;
}

/** The kinds of changes the outbox takes: the status, the due date, the check mark (OF-3). */
export type ChangeKind = 'status' | 'due' | 'check';

/** The mark of a ticket or an entry: a change not sent yet, or one that waits for a decision. */
export type OutboxMark = 'pending' | 'decision' | null;

type Answer = Ticket | CheckAnswer | InboxItem;
type Attempt = { ok: true; value: Answer } | { ok: false; failure: DataError };

/** What became of an action after a request, as it is stored now (OF-3b). */
type Resolution =
	| { kind: 'arrived'; action: KeptAction; value: Answer | null }
	| { kind: 'kept' }
	| { kind: 'session' }
	| { kind: 'later'; attempts: number }
	| { kind: 'decision'; action: KeptAction }
	| { kind: 'dropped'; action: KeptAction }
	| { kind: 'refused'; failure: DataError }
	/** A discarded creation not found while a request of it may still arrive (OF-4a round 2, A5). */
	| { kind: 'lookLater' }
	| { kind: 'gone' };

/**
 * The change of the notices that goes with the deletion of an action (OF-3c): `device` on the notices
 * as stored, in the same transaction; `unsaved` on those the storage failed to keep, which only this
 * tab shows (round 2, C-6).
 */
interface Noting {
	device: (current: unknown) => unknown[] | null;
	unsaved?: (notices: readonly OfflineNotice[]) => readonly OfflineNotice[];
}

/**
 * A plan of a change of the device: the actions as they should be, the one that goes last, and per
 * action that goes the change of the notices written in the same transaction (OF-3c).
 */
interface Planned<R> {
	after: readonly KeptAction[];
	last?: string;
	result: R;
	noted?: ReadonlyMap<string, Noting>;
}

/**
 * What "Verwerfen" did, for its flag and its "Rückgängig" (OF-3b); `along` are the changes of a ticket
 * "＋" created that went with its creation (OF-4a).
 */
type Discarded = {
	kind: 'marked' | 'deleted';
	action: KeptAction;
	along?: readonly KeptAction[];
};

/** What "Rückgängig" did (round 2): something, nothing to do, or why nothing could happen. */
type Undone = 'done' | 'later' | 'full';

function withoutSending<A extends KeptAction>(action: A): A {
	const copy = { ...action };
	delete copy.sendingSince;
	return copy;
}

function replaced(actions: readonly KeptAction[], next: KeptAction): KeptAction[] {
	return replacedBy(actions, next.op, next);
}

/** The actions with `op` replaced by `next`, which may carry another identifier. */
function replacedBy(actions: readonly KeptAction[], op: string, next: KeptAction): KeptAction[] {
	return actions.map((action) => (action.op === op ? next : action));
}

/** The IDs without doubles, in their order. */
function unique(ids: readonly string[]): string[] {
	return ids.filter((id, index) => ids.indexOf(id) === index);
}

/**
 * The changes that wait for a creation "＋" made (OF-4a), also through each other: none of them left
 * the device while it is there; they go with a discarded one. A change made after "Verwerfen" (of a
 * ticket the server shows under the same ID) waits for none of it and stays.
 */
function alongCreation(actions: readonly KeptAction[], creation: CreateAction): KeptAction[] {
	const waiting = [creation.op];
	const along: KeptAction[] = [];
	for (const entry of inOrder(actions)) {
		if (entry.op === creation.op || !entry.dependsOn.some((op) => waiting.includes(op))) continue;
		waiting.push(entry.op);
		along.push(entry);
	}
	return along;
}

/** 403 and 404: the rules of the Record API and the entry of the day plan come before the identifier. */
function isMissing(failure: DataError): boolean {
	return failure.kind === 'not_found' || failure.kind === 'forbidden';
}

function randomFill(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
	return crypto.getRandomValues(bytes);
}

export class OutboxStore {
	readonly #storage: OutboxStorage | null;
	readonly #deps: OutboxDeps;
	readonly #connectivity: ConnectivityStore;
	readonly #now: () => number;
	readonly #random: () => number;
	readonly #fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;
	readonly #timers: Timers;

	#user = $state<string | null>(null);
	#support = $state.raw<OfflineOps | null>(null);
	#frame = $state(false);
	#actions = $state.raw<readonly KeptAction[]>([]);
	#loaded = $state(false);
	#watching = $state(false);
	#progress = $state.raw<{ index: number; count: number } | null>(null);
	/** The entry of the last error of the server after FAILURES_BEFORE_NOTICE attempts in a row. */
	#failing = $state.raw<{ problem: ProblemEntry | null } | null>(null);
	/** The entries behind conflicts and refusals ("Details"), only in this tab. */
	readonly #problems = new SvelteMap<string, ProblemEntry | null>();
	/** The notices of the account on the device as last read (round 3; OF-3c), oldest first. */
	#notices = $state.raw<readonly OfflineNotice[]>([]);
	/** Notices the storage failed to keep: shown in this tab at least (OF-3c, never silently). */
	#unsaved = $state.raw<readonly OfflineNotice[]>([]);
	/** Notices closed here whose deletion on the device is under way: a read meanwhile keeps them out. */
	readonly #closing = new SvelteSet<string>();
	/**
	 * Arrived completions whose sub-tasks this tab reads again (round 2, C-5): until the reading decided
	 * about a notice they decide instead, it stays hidden here as while they were kept.
	 */
	#reading = $state.raw<readonly KeptAction[]>([]);
	/**
	 * The notices in words, made when they show (OF-3c); not one about a sub-task while a later change
	 * of the user decides about it (R3-4: that change shows instead).
	 */
	readonly #shownNotices = $derived(
		[...this.#notices, ...this.#unsaved]
			.filter(
				(notice) =>
					![...this.#actions, ...this.#reading].some((action) => decidesInstead(notice, action))
			)
			.map((notice) => ({
				id: notice.id,
				text: noticeText(notice),
				...(notice.kind === 'created' && { link: { record: notice.record, id: notice.target } })
			}))
	);
	/**
	 * Tickets and entries "＋" created that the server does not have yet (OF-4a, concept §3.5), with the
	 * changes of a ticket laid over it; a discarded one shows no more. Made from the device, never taken
	 * as the state of the server (`#provisional`).
	 */
	readonly #createdTickets = $derived.by(() => {
		const shown = new SvelteMap<string, Ticket>();
		for (const action of this.#actions) {
			if (!isTicketCreate(action) || action.discarded === true) continue;
			shown.set(action.target, this.#createdView(action));
		}
		return shown;
	});
	readonly #createdItems = $derived.by(() => {
		const shown = new SvelteMap<string, { item: InboxItem; scope: string }>();
		for (const action of this.#actions) {
			if (!isInboxCreate(action) || action.discarded === true) continue;
			const item = createdItemOf(action);
			this.#createdViews.add(item);
			shown.set(action.target, { item, scope: action.scope });
		}
		return shown;
	});

	#sink: OutboxSink | null = null;
	#loading: Promise<void> | null = null;
	#loadingFor: string | null = null;
	#runner: OutboxRunner | null = null;
	#stopWatching: (() => void) | null = null;
	#stopChannel: (() => void) | null = null;
	#sentInRun = 0;
	#swapMisses = 0;
	/** The identifier of the tab and the channel, made on the first watch (G1). */
	#opened = false;
	#tab = '';
	#channel: OutboxChannel | null = null;
	/** The flag about a failing storage of the device while it is shown, so it comes once. */
	#storageFlag: string | null = null;
	/** The state of the server per ticket as last seen, for the display after a discarded action. */
	readonly #base = new SvelteMap<string, TicketSummary>();
	/** Who waits for the answers of kept check marks: the day plan of the view (OF-3). */
	readonly #checkWatchers = new SvelteSet<(answer: CheckAnswer | null) => void>();
	/** Tickets the outbox made itself (overlays), never taken as the state of the server. */
	readonly #provisional = new WeakSet<object>();
	/** Tickets and entries "＋" created as the outbox shows them (OF-4a): never one of the server. */
	readonly #createdViews = new WeakSet<object>();
	/** The steps that write the device run one after another in this tab (OF-3b). */
	#queue: Promise<unknown> = Promise.resolve();

	constructor(deps: OutboxDeps) {
		this.#deps = deps;
		this.#storage = deps.storage;
		this.#connectivity = deps.connectivity;
		this.#now = deps.now ?? Date.now;
		this.#random = deps.random ?? Math.random;
		this.#fill = deps.fill ?? randomFill;
		this.#timers = deps.timers ?? WINDOW_TIMERS;
		this.#connectivity.onChange((offline) => {
			if (!offline) this.#runner?.kick();
		});
	}

	// ----- state -----

	/** The server takes the actions of the outbox, a storage and an account are there. */
	get #canSend(): boolean {
		if (this.#storage === null || this.#user === null) return false;
		return supportsKind(this.#support, 'ticket.update');
	}

	/** Whether the outbox takes this kind of change: the server and the app can send it (OF-3). */
	#supports(change: ChangeKind): boolean {
		if (!this.#canSend) return false;
		if (change === 'due') return this.#deps.sendDue !== undefined;
		if (change === 'check') {
			return (
				this.#deps.sendDayPlan !== undefined &&
				supportsKind(this.#support, 'dayplan.check') &&
				supportsKind(this.#support, 'dayplan.uncheck')
			);
		}
		return true;
	}

	/**
	 * New changes go through the outbox: it can send, the device storage is read and the phone frame
	 * applies. A storage that fails keeps it off, so every change goes the way of today.
	 */
	get armed(): boolean {
		return this.#canSend && this.#loaded && this.#frame;
	}

	/** The outbox watches the connection: armed, or actions of the account wait on the device. */
	get watching(): boolean {
		return this.#watching;
	}

	/** The outbox worked in this tab or keeps changes; the error page then watches the connection. */
	get inUse(): boolean {
		return this.armed || this.#actions.length > 0;
	}

	/** The server reports the outbox for the change of the status (`offline_ops`). */
	get supported(): boolean {
		return supportsKind(this.#support, 'ticket.update');
	}

	/** The connection is missing (only while the outbox watches; otherwise false). */
	get offline(): boolean {
		return this.watching && this.#connectivity.offline;
	}

	/** A check of the server runs. */
	get checking(): boolean {
		return this.#connectivity.checking;
	}

	/** The actions of the signed-in account in their order. */
	get actions(): readonly KeptAction[] {
		return this.#actions;
	}

	get count(): number {
		return this.#actions.length;
	}

	/** Actions that wait for the connection or are under way. */
	get waiting(): readonly KeptAction[] {
		return this.#actions.filter(isWaiting);
	}

	get conflicts(): readonly KeptAction[] {
		return this.#actions.filter((action) => action.state === 'conflict');
	}

	get refusals(): readonly KeptAction[] {
		return this.#actions.filter((action) => action.state === 'refused');
	}

	get expired(): readonly KeptAction[] {
		return this.#actions.filter((action) => action.state === 'expired');
	}

	/** "Übertrage 2 von 3 Änderungen …" while a run sends, null otherwise. */
	get progress(): { index: number; count: number } | null {
		return this.#progress;
	}

	/** The server answered with errors several times in a row; with the entry for "Details". */
	get failing(): { problem: ProblemEntry | null } | null {
		return this.#failing;
	}

	/** The entry behind a conflict or a refusal, null without one (or after a reload of the tab). */
	problemOf(op: string): ProblemEntry | null {
		return this.#problems.get(op) ?? null;
	}

	/**
	 * Notices that stay until the user closes them (round 3): changes the deletion after 7 days took,
	 * sub-tasks a completion should have taken along that are not done. Since OF-3c they are kept on
	 * the device per account and show in every tab of the signed-in account, also after a reload.
	 */
	get notices(): readonly OutboxNotice[] {
		return this.#shownNotices;
	}

	/**
	 * "Schließen" of a notice: it goes at once here, on the device as a compare-and-swap against what
	 * was shown (I5; a notice that changed meanwhile shows anew), and the other tabs read again.
	 */
	async closeNotice(id: string): Promise<void> {
		const unsaved = this.#unsaved.find((notice) => notice.id === id);
		if (unsaved !== undefined) {
			this.#unsaved = this.#unsaved.filter((notice) => notice !== unsaved);
			return;
		}
		const shown = this.#notices.find((notice) => notice.id === id);
		const storage = this.#storage;
		const user = this.#user;
		if (shown === undefined || storage === null || user === null) return;
		this.#closing.add(id);
		this.#notices = this.#notices.filter((notice) => notice !== shown);
		try {
			await this.#guard(OFFLINE_INTENTS.closeNotice, async () => {
				const stored = await this.#locked(() =>
					storage.notices(user, (current) => withoutNotice(current, shown))
				);
				this.#closing.delete(id);
				this.#post();
				if (this.#user === user) this.#showNotices(stored);
			});
		} finally {
			if (this.#closing.delete(id) && this.#user === user) {
				// The device failed (its flag says so): the notice stays as the device holds it.
				await this.#guard(OFFLINE_INTENTS.read, () => this.#readNotices(storage, user));
			}
		}
	}

	/** Shows the notices of the account as the device holds them, without those being closed. */
	#showNotices(stored: unknown): void {
		this.#notices = parseNotices(stored).filter((notice) => !this.#closing.has(notice.id));
	}

	async #readNotices(storage: OutboxStorage, user: string): Promise<void> {
		const stored = await storage.notices(user);
		if (this.#user === user) this.#showNotices(stored);
	}

	/**
	 * Keeps notices on the device (OF-3c) and tells the other tabs; the same notice twice shows once.
	 * Where the storage fails, they show in this tab at least, and the flag of the storage says why.
	 */
	async #keepNotices(notices: readonly OfflineNotice[]): Promise<void> {
		if (notices.length === 0) return;
		const storage = this.#storage;
		const user = this.#user;
		if (storage === null || user === null) return;
		try {
			const stored = await withIntent(OFFLINE_INTENTS.keepNotice, () =>
				this.#locked(() => storage.notices(user, (current) => withNotices(current, notices)))
			);
			this.#post();
			if (this.#user === user) this.#showNotices(stored);
		} catch (error) {
			if (this.#user !== user) return;
			const shown = [...this.#notices, ...this.#unsaved];
			const missing = notices.filter((notice) => !shown.some((other) => other.id === notice.id));
			this.#unsaved = [...this.#unsaved, ...missing];
			this.#report(error);
		}
	}

	/** Reloading the page now would leave the app unopenable until the server is back. */
	get reloadRisky(): boolean {
		return this.offline && this.#actions.length > 0;
	}

	/**
	 * Whether a change of this ticket goes through the outbox: the outbox takes this kind of change
	 * and is armed, or, outside of the frame, a change of the ticket waits to be sent and asks for the
	 * order (G2). Behind one that waits for a decision a change goes the way of before OF-2. A check
	 * mark of the day plan asks with the ID of its ticket (OF-3).
	 */
	routes(id: string, change: ChangeKind = 'status'): boolean {
		if (!this.#supports(change)) return false;
		if (this.armed) return true;
		if (!this.#loaded) return false;
		return this.#actions.some(
			(action) => (action.target === id || ticketOf(action) === id) && isWaiting(action)
		);
	}

	/**
	 * The mark of a ticket for rows, cards, the panel and the sub-tasks, and of an entry of the day
	 * plan (OF-3); a waiting check mark that completes a ticket marks the ticket as well. A discarded
	 * creation that is only looked up marks nothing (OF-4a): it is no change of the user any more.
	 */
	markOf(id: string): OutboxMark {
		let mark: OutboxMark = null;
		for (const action of this.#actions) {
			if (isCreateAction(action) && action.discarded === true) continue;
			const child =
				(isStatusAction(action) || isDayPlanAction(action)) &&
				action.completion === 'complete_children' &&
				action.children?.includes(id) === true;
			const completes =
				isDayPlanAction(action) && action.ticket === id && action.payload.action === 'complete';
			if (action.target !== id && !child && !completes) continue;
			if (isWaiting(action)) return 'pending';
			if (action.target === id) mark = 'decision';
		}
		return mark;
	}

	/** A change of this ticket or entry waits to be sent. */
	isPending(id: string): boolean {
		return this.markOf(id) === 'pending';
	}

	// ----- "＋" (OF-4a) -----

	/** Whether a record of the area of the client: the area of the tab, or every one without it. */
	#inArea(scope: string): boolean {
		const area = this.#deps.area?.() ?? null;
		return area === null || scope === '' || scope === area;
	}

	/**
	 * Tickets "＋" created that the server does not have yet, in the area of the tab (concept §3.5):
	 * the stores show them next to the ones of the server until it delivers one under the same ID.
	 */
	createdTickets(): Ticket[] {
		return [...this.#createdTickets.values()].filter((ticket) => this.#inArea(ticket.scope ?? ''));
	}

	/** The ticket "＋" created under `id` as the views show it, null without one (OF-4a). */
	createdTicket(id: string): Ticket | null {
		return this.#createdTickets.get(id) ?? null;
	}

	/** Entries "＋" put into the inbox that the server does not have yet, in the area of the tab. */
	createdItems(): InboxItem[] {
		return [...this.#createdItems.values()]
			.filter((entry) => this.#inArea(entry.scope))
			.map((entry) => entry.item);
	}

	/** The entry "＋" put into the inbox under `id`, null without one (OF-4a). */
	createdItem(id: string): InboxItem | null {
		return this.#createdItems.get(id)?.item ?? null;
	}

	/** Whether this is a ticket or an entry "＋" created as the outbox shows it (OF-4a). */
	isCreatedView(record: object): boolean {
		return this.#createdViews.has(record);
	}

	/**
	 * Whether "＋" goes through the outbox (OF-4a): it is armed, the server takes the creation of this
	 * kind and the app can send it. Otherwise "＋" goes the way of today.
	 */
	takes(record: 'ticket' | 'inbox'): boolean {
		if (!this.armed) return false;
		if (record === 'ticket') {
			return this.#deps.sendCreate !== undefined && supportsKind(this.#support, 'ticket.create');
		}
		return this.#deps.sendItem !== undefined && supportsKind(this.#support, 'inbox.create');
	}

	/**
	 * "＋" as a ticket (OF-4a): kept under a new ID of the client, sent at once with a connection.
	 * Resolves to the ticket of the server, or to the one kept for later (`kept`); rejects like the data
	 * layer when the server refuses (the quick entry shows its message, the line stays).
	 */
	async createTicket(draft: TicketDraft): Promise<Created<Ticket>> {
		await this.#begin();
		const user = this.#user as string;
		const scope = this.#deps.area?.() ?? `u:${user}`;
		const change: CreateChange = {
			kind: 'ticket.create',
			target: newRecordId(this.#fill),
			scope,
			payload: {
				title: draft.title,
				status: draft.status,
				priority: draft.priority,
				due: draft.due,
				project: draft.project,
				tags: unique(draft.tags),
				household: scope.startsWith('h:') ? scope.slice(2) : ''
			}
		};
		let planned: CreateAction | null = null;
		const kept = (): Created<Ticket> => {
			const own = planned !== null && isTicketCreate(planned) ? this.#createdView(planned) : null;
			const view = this.createdTicket(change.target) ?? own;
			if (view === null) throw new OutboxStorageError();
			return { value: view, kept: true };
		};
		return this.#change(
			(context) => {
				const plan = planCreate(change, context);
				if (plan.kind === 'send' || plan.kind === 'queue') planned = plan.action;
				return plan;
			},
			async (action, keep) => {
				const answer = await this.#sendFirst(action, keep);
				return answer === null ? kept() : { value: answer as Ticket, kept: false };
			},
			kept,
			kept
		);
	}

	/** "＋" into the inbox (OF-4a), like `createTicket`. */
	async createItem(draft: QuickItemDraft): Promise<Created<InboxItem>> {
		await this.#begin();
		const user = this.#user as string;
		const scope = this.#deps.area?.() ?? `u:${user}`;
		const change: CreateChange = {
			kind: 'inbox.create',
			target: newRecordId(this.#fill),
			scope,
			payload: {
				title: draft.title,
				household: scope.startsWith('h:') ? scope.slice(2) : '',
				preset: { project: draft.project, tags: unique(draft.tags), priority: draft.priority }
			}
		};
		let planned: CreateAction | null = null;
		const kept = (): Created<InboxItem> => {
			const own = planned !== null && isInboxCreate(planned) ? createdItemOf(planned) : null;
			const view = this.createdItem(change.target) ?? own;
			if (view === null) throw new OutboxStorageError();
			this.#createdViews.add(view);
			return { value: view, kept: true };
		};
		return this.#change(
			(context) => {
				const plan = planCreate(change, context);
				if (plan.kind === 'send' || plan.kind === 'queue') planned = plan.action;
				return plan;
			},
			async (action, keep) => {
				const answer = await this.#sendFirst(action, keep);
				return answer === null ? kept() : { value: answer as InboxItem, kept: false };
			},
			kept,
			kept
		);
	}

	// ----- wiring -----

	/** The answer of the server about `offline_ops` (null without it). */
	setSupport(ops: OfflineOps | null): void {
		this.#support = ops;
		this.#update();
	}

	/** Whether the phone frame applies now (MobileLayoutStore.active). */
	setFrame(active: boolean): void {
		this.#frame = active;
		this.#update();
	}

	/**
	 * The signed-in account, null without one. Another account than before drops what this tab knew
	 * and reads the device again; the actions of other accounts are deleted there (decision 4).
	 */
	attach(user: string | null): void {
		if (user === this.#user) return;
		this.#user = user;
		this.#actions = [];
		this.#loaded = false;
		this.#loading = null;
		this.#loadingFor = null;
		this.#base.clear();
		this.#problems.clear();
		// The notices name tickets of the account before; the device keeps them for its next sign-in,
		// the reading of the device brings those of this account (OF-3c).
		this.#notices = [];
		this.#unsaved = [];
		this.#closing.clear();
		this.#reading = [];
		this.#failing = null;
		this.#update();
	}

	/**
	 * Connects the outbox to the layout and reads the device again (another tab may have changed it
	 * meanwhile); returns the cleanup, which stops the work but keeps the state.
	 */
	connect(sink: OutboxSink): () => void {
		this.#sink = sink;
		this.#loaded = false;
		this.#loading = null;
		this.#loadingFor = null;
		this.#update();
		return () => {
			if (this.#sink === sink) this.#sink = null;
			this.#halt();
		};
	}

	/** The answers of kept check marks once sent, null to read the plan again (OF-3); the cleanup. */
	watchChecks(listener: (answer: CheckAnswer | null) => void): () => void {
		this.#checkWatchers.add(listener);
		return () => {
			this.#checkWatchers.delete(listener);
		};
	}

	#notifyChecks(answer: CheckAnswer | null): void {
		for (const listener of this.#checkWatchers) listener(answer);
	}

	#update(): void {
		if (this.#sink === null) return;
		if (this.#canSend && !this.#loaded) void this.#load();
		const watch = this.#canSend && this.#loaded && (this.#frame || this.#actions.length > 0);
		if (watch && this.#stopWatching === null) this.#watch();
		else if (!watch && this.#stopWatching !== null) {
			this.#halt();
			this.#connectivity.reset();
		}
		if (this.#canSend && this.#loaded && this.#stopChannel === null) this.#listen();
		if (!this.#canSend && this.#stopChannel !== null) {
			this.#stopChannel();
			this.#stopChannel = null;
		}
	}

	/** Reads the device once per account, in the frame always, else only when it has the storage. */
	async #load(): Promise<void> {
		const user = this.#user;
		const storage = this.#storage;
		if (user === null || storage === null || this.#loadingFor === user) return;
		this.#loadingFor = user;
		const exists = this.#deps.exists;
		const run = withIntent(OFFLINE_INTENTS.read, async () => {
			// A browser that cannot say whether it has the storage counts as one without it.
			if (!this.#frame && exists !== undefined && !(await exists().catch(() => false))) {
				this.#loadingFor = null;
				return;
			}
			await this.#read(storage, user, true);
			if (this.#user !== user) return;
			this.#loaded = true;
			this.#update();
			this.#runner?.kick();
		});
		this.#loading = run;
		try {
			await run;
		} catch (error) {
			// Without its storage the outbox stays off; every change goes the way of today, and the
			// flag of the storage says so (round 2), never silently.
			this.#loadingFor = null;
			this.#report(error);
		}
	}

	/**
	 * Reads the actions and the notices of the account on the device (since OF-3c in every tab).
	 * `start`: entries of other accounts and older than 7 days go, those older than 48 hours wait for
	 * a decision; the notices of other accounts stay for their next sign-in.
	 */
	async #read(storage: OutboxStorage, user: string, start: boolean): Promise<void> {
		const raw = await storage.list();
		const mine: KeptAction[] = [];
		const gone: string[] = [];
		for (const entry of raw) {
			const action = parseAction(entry);
			if (action === null) {
				const op = (entry as { op?: unknown } | null)?.op;
				if (typeof op === 'string') gone.push(op);
			} else if (action.user === user) mine.push(action);
			else if (start) gone.push(action.op);
		}
		// Entries of other accounts and unreadable ones belong to nobody here: deleted unconditionally.
		if (gone.length > 0) await storage.remove(gone);
		// Read last and shown right away: a notice written meanwhile by this tab is never shown older.
		const notices = await storage.notices(user);
		if (this.#user !== user) return;
		const before = this.#actions;
		this.#actions = inOrder(mine);
		this.#showNotices(notices);
		if (start) {
			await this.#locked(async () => {
				await this.#age(this.#now());
				// An older build or a closed tab may have left the take-backs behind (OF-3b).
				await this.#transform(async (actions) => ({
					after: await this.#pure((context) => settleChains(actions, context)),
					result: true
				}));
			});
		}
		this.#refreshChanged(before, this.#actions);
	}

	/** Shows the tickets whose actions changed elsewhere anew (with the overlay of now). */
	#refreshChanged(before: readonly KeptAction[], after: readonly KeptAction[]): void {
		const key = (actions: readonly KeptAction[], ticket: string) =>
			JSON.stringify(actions.filter((action) => ticketOf(action) === ticket));
		const tickets = new SvelteSet([...before, ...after].map(ticketOf));
		for (const ticket of tickets) {
			if (key(before, ticket) === key(after, ticket)) continue;
			this.#refreshTicket(ticket);
		}
	}

	/** Shows the ticket as the server had it, with the actions of now laid over it. */
	#refreshTicket(id: string): void {
		const base = this.#base.get(id);
		if (base !== undefined) this.#sink?.upsert(base);
	}

	/**
	 * The identifier of the tab and the channel between the tabs, made on the first watch (G1): a
	 * tab whose outbox never works creates neither. A listener that started before the channel
	 * existed starts again with it (`#update` right after).
	 */
	#open(): void {
		if (this.#opened) return;
		this.#opened = true;
		const { tab, channel } = this.#deps;
		this.#tab = typeof tab === 'function' ? tab() : tab;
		this.#channel = typeof channel === 'function' ? channel() : (channel ?? null);
		if (this.#channel !== null && this.#stopChannel !== null) {
			this.#stopChannel();
			this.#stopChannel = null;
		}
	}

	#watch(): void {
		const storage = this.#storage;
		if (storage === null) return;
		this.#open();
		const stops: (() => void)[] = [];
		stops.push(this.#connectivity.start(this.#deps.win ?? null));
		this.#deps.observe?.((outcome) => this.#connectivity.note(outcome));
		stops.push(() => this.#deps.observe?.(null));
		this.#deps.watchRealtime?.(() => void this.#connectivity.check());
		stops.push(() => this.#deps.watchRealtime?.(null));
		const runner = new OutboxRunner({
			storage,
			tab: this.#tab,
			now: this.#now,
			timers: this.#timers,
			ready: () => this.#ready(),
			step: () => withIntent(OFFLINE_INTENTS.send, () => this.#step()),
			settled: () => this.#settled(),
			failed: (error) => this.#report(error)
		});
		this.#runner = runner;
		stops.push(() => runner.stop());
		this.#stopWatching = () => {
			for (const stop of stops.reverse()) stop();
		};
		this.#watching = true;
		runner.kick();
	}

	#listen(): void {
		const storage = this.#storage;
		const user = this.#user;
		if (storage === null || user === null) return;
		const reread = () => {
			if (this.#user !== user) return;
			void this.#guard(OFFLINE_INTENTS.read, () => this.#read(storage, user, false)).then(() =>
				this.#update()
			);
		};
		const stops: (() => void)[] = [];
		if (this.#channel !== null) stops.push(this.#channel.listen(reread));
		const win = this.#deps.win ?? null;
		const onvisible = () => {
			if (win?.document.visibilityState === 'visible') reread();
		};
		win?.document.addEventListener('visibilitychange', onvisible);
		stops.push(() => win?.document.removeEventListener('visibilitychange', onvisible));
		this.#stopChannel = () => {
			for (const stop of stops) stop();
		};
	}

	/** Stops watching and sending; the actions and the state of the connection stay. */
	#halt(): void {
		this.#stopWatching?.();
		this.#stopWatching = null;
		this.#watching = false;
		this.#runner = null;
		this.#stopChannel?.();
		this.#stopChannel = null;
		this.#progress = null;
	}

	#post(): void {
		this.#channel?.post();
	}

	/** The client is signed in with `user` (pb.authStore, G3); without the hook the attached account. */
	#signedIn(user: string): boolean {
		const account = this.#deps.account;
		return (account === undefined ? this.#user : account()) === user;
	}

	/**
	 * An error of the storage of the device as an error flag with "Details" (G6b), one at a time;
	 * the intent of the step comes with the error (`withIntent`).
	 */
	#report(error: unknown): void {
		const sink = this.#sink;
		if (sink === null || this.#storageFlag !== null) return;
		this.#storageFlag = sink.flags.show({
			tone: 'error',
			title: OFFLINE_TEXTS.storageFailed,
			problem: problemOf(error),
			onclose: () => {
				this.#storageFlag = null;
			}
		});
	}

	/** Runs a step on the device; a failure shows as the flag of `#report` instead of a rejection. */
	async #guard(intent: string, run: () => Promise<void>): Promise<void> {
		try {
			await withIntent(intent, run);
		} catch (error) {
			this.#report(error);
		}
	}

	// ----- the overlay -----

	/** Remembers the state of the server of a ticket (answers, events, loads), never an overlay. */
	#remember(ticket: TicketSummary): void {
		if (this.#provisional.has(ticket)) return;
		const known = this.#base.get(ticket.id);
		if (known === undefined || known.updated <= ticket.updated) this.#base.set(ticket.id, ticket);
	}

	/** A ticket "＋" created with the changes that wait behind its creation (OF-4a). */
	#createdView(action: TicketCreateAction): Ticket {
		const ticket = createdTicketOf(action);
		const view = overlayDue(overlayStatus(ticket, this.#actions), this.#actions);
		this.#provisional.add(ticket);
		this.#provisional.add(view);
		this.#createdViews.add(ticket);
		this.#createdViews.add(view);
		return view;
	}

	/** The ticket with the waiting actions laid over it; a changed one is marked as made here. */
	#shown<T extends TicketSummary>(base: T): T {
		const shown = overlayDue(overlayStatus(base, this.#actions), this.#actions);
		if (shown !== base) this.#provisional.add(shown);
		return shown;
	}

	/**
	 * The ticket as the stores show it: the state of the server with the waiting actions laid over
	 * it. Called by the stores for every ticket they take in; without an action the ticket itself.
	 */
	apply<T extends TicketSummary>(ticket: T): T {
		this.#remember(ticket);
		if (this.#actions.length === 0) return ticket;
		return this.#shown(ticket);
	}

	/** Whether a waiting action keeps this ticket as the stores show it (a reconciliation keeps it). */
	holds(id: string): boolean {
		return this.isPending(id);
	}

	/**
	 * The ticket as the outbox last saw it from the server, with its actions laid over it; null when
	 * it never saw it. "Rückgängig" of a kept completion needs it, the list no longer holds the ticket.
	 */
	current(id: string): TicketSummary | null {
		const base = this.#base.get(id);
		return base === undefined ? null : this.#shown(base);
	}

	/**
	 * An entry of the day plan and its ticket as the plan shows them (OF-3): the kept check marks and
	 * changes of the ticket laid over the state of the server. Pure for the derivations of the store.
	 */
	checkRow(
		item: DayPlanItem,
		ticket: TicketSummary | null
	): { doneToday: boolean; ticket: TicketSummary | null } {
		if (this.#actions.length === 0) return { doneToday: item.doneToday, ticket };
		return {
			doneToday: overlayDoneToday(item, this.#actions),
			ticket: ticket === null ? null : this.#shown(ticket)
		};
	}

	// ----- changes -----

	/** Throws without a storage or an account; waits until the device is read. */
	async #begin(): Promise<void> {
		if (this.#storage === null || this.#user === null) throw new DataError('session');
		await this.#loading?.catch(() => undefined);
	}

	/**
	 * The status of sub-tasks as last seen, for "Verwerfen" of a completion that takes them along
	 * (OF-3b): only IDs and these statuses are kept, like "Rückgängig" online keeps them; null for one
	 * never seen, so no take-back guesses its value (round 2).
	 */
	#statusesOf(ids: readonly string[]): (Status | null)[] {
		return ids.map((id) => this.#base.get(id)?.status ?? null);
	}

	/** The key of a ticket as last seen, for the take-back of a sub-task (OF-3b). */
	readonly #label = (id: string): string | null => this.#base.get(id)?.key ?? null;

	/** The state of the server a change of the ticket is based on: as last seen while actions wait. */
	#baseOf<T extends TicketSummary>(ticket: T): T {
		const open = this.#actions.some((action) => ticketOf(action) === ticket.id);
		const known = this.#base.get(ticket.id);
		return (open && known !== undefined ? known : ticket) as T;
	}

	/**
	 * A change of the status of `ticket` (as the store shows it). Resolves to the answer of the
	 * server, or to the ticket with the kept change laid over it; rejects like the data layer when
	 * the server refuses (the store shows its message as today).
	 */
	async changeStatus<T extends TicketSummary>(ticket: T, request: StatusRequest): Promise<T> {
		await this.#begin();
		const base = this.#baseOf(ticket);
		this.#remember(base);
		return this.#change(
			(context) =>
				planTicketStatus(
					this.#actions,
					{
						target: ticket.id,
						key: ticket.key,
						title: ticket.title,
						scope: ticket.scope ?? '',
						base: base.status,
						status: request.status,
						...(request.completion !== undefined && { completion: request.completion }),
						...(request.children !== undefined && {
							children: request.children,
							childrenBefore: this.#statusesOf(request.children)
						})
					},
					context
				),
			async (action, keep) => {
				const answer = await this.#sendFirst(action, keep);
				return answer === null ? this.#shown(base) : this.apply(answer as unknown as T);
			},
			() => this.#keptView(base),
			() => ticket
		);
	}

	/**
	 * The ticket after a change kept for later: the waiting actions over the state of the server, or
	 * for a ticket "＋" created (OF-4a) the creation with the change.
	 */
	#keptView<T extends TicketSummary>(base: T): T {
		const created = this.createdTicket(base.id);
		return created === null ? this.#shown(base) : (created as unknown as T);
	}

	/** A change of the due date of `ticket` (OF-3), like the status. */
	async changeDue<T extends TicketSummary>(ticket: T, due: CalendarDate | null): Promise<T> {
		await this.#begin();
		const base = this.#baseOf(ticket);
		this.#remember(base);
		return this.#change(
			(context) =>
				planTicketDue(
					this.#actions,
					{
						target: ticket.id,
						key: ticket.key,
						title: ticket.title,
						scope: ticket.scope ?? '',
						base: base.due,
						due
					},
					context
				),
			async (action, keep) => {
				const answer = await this.#sendFirst(action, keep);
				return answer === null ? this.#shown(base) : this.apply(answer as unknown as T);
			},
			() => this.#keptView(base),
			() => ticket
		);
	}

	/**
	 * A check mark of the day plan or its taking back (OF-3). Resolves to the answer of the route, or,
	 * kept, to the entry and the ticket as the server has them with `kept` (the overlay shows the
	 * change); rejects like the data layer when the server refuses.
	 */
	async changeCheck(entry: CheckEntry, request: CheckRequest): Promise<CheckAnswer> {
		await this.#begin();
		const ticket = this.#baseOf(entry.ticket);
		this.#remember(ticket);
		const change: CheckChange = {
			kind: request.kind,
			target: entry.item.id,
			ticket: ticket.id,
			ticketKind: kindOf(ticket.kind),
			key: ticket.key,
			title: ticket.title,
			scope: ticket.scope ?? '',
			base: { doneToday: entry.item.doneToday, status: ticket.status },
			...(request.kind === 'dayplan.check'
				? {
						mode: request.mode,
						...(request.completion !== undefined && { completion: request.completion }),
						...(request.children !== undefined && {
							children: request.children,
							childrenBefore: this.#statusesOf(request.children)
						})
					}
				: {
						...(request.action !== undefined && { action: request.action }),
						...(request.status !== undefined && { status: request.status })
					})
		};
		let planned: DayPlanAction | null = null;
		const kept = (): CheckAnswer => ({
			item: entry.item,
			ticket: {
				id: ticket.id,
				key: ticket.key,
				status: ticket.status,
				previousStatus: planned?.expected.status ?? ticket.status
			},
			action:
				planned?.payload.action ??
				(request.kind === 'dayplan.uncheck' ? (request.action ?? 'complete') : 'complete'),
			kept: true
		});
		return this.#change(
			(context) => {
				const plan = planCheckChange(this.#actions, change, context);
				if (plan.kind === 'send' || plan.kind === 'queue') planned = plan.action;
				return plan;
			},
			async (action, keep) => {
				const answer = await this.#sendFirst(action, keep);
				if (answer !== null) return answer as CheckAnswer;
				this.#refreshTicket(ticket.id);
				return kept();
			},
			() => {
				this.#refreshTicket(ticket.id);
				return kept();
			},
			kept
		);
	}

	/**
	 * Plans and writes a change (H1: planned again when the device changed meanwhile): `first` sends
	 * an action at once, `kept` answers after it is kept, `unchanged` when nothing is to do.
	 */
	async #change<R, A extends KeptAction>(
		plan: (context: PlanContext) => ChangePlan<A>,
		first: (action: A, keep: boolean) => Promise<R>,
		kept: () => R,
		unchanged: () => R
	): Promise<R> {
		const storage = this.#storage;
		const user = this.#user;
		if (storage === null || user === null) throw new DataError('session');
		// A storage that fails keeps nothing: a change with a connection then goes as today.
		const seq = await storage.nextSeq().catch(() => 0);
		const op = newOpId(this.#fill);
		const now = this.#now();
		type Outcome = { kind: 'none' } | { kind: 'send'; action: A; room: boolean } | { kind: 'kept' };
		let outcome: Outcome;
		try {
			outcome = await this.#locked(async (): Promise<Outcome> => {
				for (let round = 1; ; round += 1) {
					const before = this.#actions;
					const planned = plan({ user, op, seq, now, offline: this.offline });
					if (planned.kind === 'none') return { kind: 'none' };
					// A full device keeps nothing more; with a connection the change goes as before OF-2 (G4).
					if (planned.kind === 'send') {
						return { kind: 'send', action: planned.action, room: hasRoom(before, planned.action) };
					}
					if (planned.kind !== 'cancel' && !hasRoom(before, planned.action)) {
						throw new OutboxFullError();
					}
					// The take-backs and the values before of the chain follow from the change (OF-3b).
					const after = await this.#pure((context) =>
						settleChains(this.#planned(before, planned, context), context)
					);
					if (await this.#commit(before, after)) {
						this.#refreshChanged(before, this.#actions);
						return { kind: 'kept' };
					}
					// The device changed meanwhile (the worker marked the action, another tab): read it and
					// plan again, so a change never goes into an action that left the device (H1). After
					// PLAN_ROUNDS rounds the storage counts as failing (round 2), not the connection.
					if (round >= PLAN_ROUNDS) throw new OutboxStorageError();
					await this.#read(storage, user, false);
				}
			});
		} catch (error) {
			// The device keeps nothing: nothing was noted, and the store names the storage (round 2).
			if (error instanceof DataError) throw error;
			throw new OutboxStorageError(error);
		}
		if (outcome.kind === 'none') return unchanged();
		if (outcome.kind === 'send') return first(outcome.action, outcome.room);
		this.#runner?.kick();
		return kept();
	}

	/**
	 * The actions with the plan of a change that is not sent at once: a new action, one taken into the
	 * waiting one, or that one dropped; a dropped one passes on what the user wants (OF-3b).
	 */
	#planned(
		before: readonly KeptAction[],
		plan: Exclude<ChangePlan, { kind: 'none' | 'send' }>,
		context: ChainContext
	): KeptAction[] {
		if (plan.kind === 'queue') return [...before, plan.action];
		if (plan.kind === 'merge') return replaced(before, plan.action);
		return leaveChain(before, plan.op, { how: 'nothing' }, context);
	}

	/**
	 * The first attempt right after the change, kept first, so a closed tab loses nothing; on a full
	 * device (`keep` false) as before OF-2, without keeping it (G4). Resolves to the answer, or null
	 * when there is none and the change stays for later; any answer of the server counts as today
	 * (refused: an error). Only with the account of the action (G3). After an answer the worker looks
	 * for a change that waited behind this one (OF-3). The answer is taken on the action as it is
	 * stored then: "Verwerfen" may have come meanwhile (OF-3b).
	 */
	async #sendFirst(action: KeptAction, keep: boolean): Promise<Answer | null> {
		if (!this.#signedIn(action.user)) throw new DataError('session');
		const created = keep ? this.#locked(() => this.#create(action)) : Promise.resolve(false);
		const kept = await created.catch(() => false);
		const result = await this.#attempt(action, true);
		if (!kept) {
			if (result.ok) {
				this.#runner?.kick();
				return result.value;
			}
			if (verdictOf(result.failure).result === 'network') void this.#connectivity.check();
			throw result.failure;
		}
		const resolved = this.#locked(() => this.#resolve(action, result, true));
		const resolution = await resolved.catch((error: unknown) => {
			// The answer is there, only the device failed: the caller gets it as today.
			this.#report(error);
			return null;
		});
		if (resolution?.kind === 'arrived') {
			// A notice the completion decides goes only once its sub-task is read done (round 2, C-5);
			// the answer goes to the view meanwhile, as today.
			const arrived = resolution.action;
			void this.#guard(OFFLINE_INTENTS.keepNotice, () => this.#checkChildren(arrived, true));
		}
		if (result.ok) {
			this.#runner?.kick();
			return result.value;
		}
		if (resolution?.kind === 'kept') {
			void this.#connectivity.check();
			return null;
		}
		if (resolution?.kind === 'dropped' || resolution?.kind === 'decision') {
			// Discarded meanwhile (OF-3b): the worker's way, the store shows the change as kept.
			this.#runner?.kick();
			return null;
		}
		const later = resolution?.kind === 'later' || resolution?.kind === 'lookLater';
		if (later && isCreateAction(action)) {
			// A creation after a 5xx (OF-4a round 2, A1): kept like one without an answer, sent again
			// later under its identifier and its ID; "＋" says that it is kept.
			this.#runner?.kick();
			return null;
		}
		if (verdictOf(result.failure).result === 'network') void this.#connectivity.check();
		throw result.failure;
	}

	/** One request of the action over the way of its kind. */
	#transmit(action: KeptAction, fields: OutboxFields, signal: AbortSignal): Promise<Answer> {
		if (isStatusAction(action)) return this.#deps.send(action, fields, signal);
		// Without the way of its kind (an app without it) the action waits like after an error; nothing
		// left the device (OF-3c, R3-2).
		const missing = () => Promise.reject(new OutboxNoWayError());
		if (isDueAction(action)) {
			const send = this.#deps.sendDue;
			return send === undefined ? missing() : send(action, fields, signal);
		}
		if (isTicketCreate(action)) {
			const send = this.#deps.sendCreate;
			return send === undefined ? missing() : send(action, fields, signal);
		}
		if (isInboxCreate(action)) {
			const send = this.#deps.sendItem;
			return send === undefined ? missing() : send(action, fields, signal);
		}
		const send = this.#deps.sendDayPlan;
		return send === undefined ? missing() : send(action, fields, signal);
	}

	/**
	 * Looks up a discarded creation that may have arrived, by its ID (OF-4a, C4): it is never sent
	 * again. Found, it arrived; 404 says it did not (or no longer is to be seen).
	 */
	async #lookUp(action: CreateAction): Promise<Attempt> {
		const controller = new AbortController();
		const limit = this.#timers.set(() => controller.abort(), SEND_TIMEOUT_MS);
		const read = (): Promise<Answer> => {
			if (isTicketCreate(action)) return this.#deps.get(action.target, controller.signal);
			const get = this.#deps.getItem;
			return get === undefined
				? Promise.reject(new OutboxNoWayError())
				: get(action.target, controller.signal);
		};
		try {
			const value = await withIntent(OFFLINE_INTENTS.lookUp(actionText(action)), read);
			return { ok: true, value };
		} catch (error) {
			return { ok: false, failure: toDataError(error, controller.signal) };
		} finally {
			this.#timers.clear(limit);
		}
	}

	async #attempt(action: KeptAction, first: boolean): Promise<Attempt> {
		const controller = new AbortController();
		const limit = this.#timers.set(() => controller.abort(), SEND_TIMEOUT_MS);
		const send = () => this.#transmit(action, requestFields(action, first), controller.signal);
		try {
			// A kept change names what it was for in "Details" (ADR-0071 §3).
			const value = first
				? await send()
				: await withIntent(`Gemerkte Änderung übertragen: ${actionText(action)}`, send);
			return { ok: true, value };
		} catch (error) {
			return { ok: false, failure: toDataError(error, controller.signal) };
		} finally {
			this.#timers.clear(limit);
		}
	}

	/** Takes a stored or changed action of the signed-in account in and tells the other tabs. */
	#held(action: KeptAction): void {
		if (action.user !== this.#user) return;
		const rest = this.#actions.filter((entry) => entry.op !== action.op);
		this.#actions = inOrder([...rest, action]);
		this.#post();
		this.#update();
	}

	/** Lets deleted actions go and tells the other tabs. */
	#gone(ops: readonly string[]): void {
		this.#actions = this.#actions.filter((action) => !ops.includes(action.op));
		for (const op of ops) this.#problems.delete(op);
		this.#post();
		this.#update();
	}

	/**
	 * Stores a new action of the signed-in account, but only while the device has none of its
	 * identifier (OF-3b); false otherwise.
	 */
	async #create(action: KeptAction): Promise<boolean> {
		const storage = this.#storage;
		if (storage === null) throw new DataError('network');
		const wrote = await storage.swap(action.op, (current) => current === undefined, action);
		if (wrote) this.#held(action);
		return wrote;
	}

	/**
	 * Replaces `before` by `next` (deletes it for null), but only while the device still holds it as
	 * it is (OF-2b); false when another step or tab changed it meanwhile.
	 */
	async #swap(before: KeptAction, next: KeptAction | null): Promise<boolean> {
		const storage = this.#storage;
		if (storage === null) throw new DataError('network');
		const wrote = await storage.swap(before.op, (current) => sameAction(current, before), next);
		if (!wrote) return false;
		if (next === null) this.#gone([before.op]);
		else this.#held(next);
		return true;
	}

	/**
	 * Deletes `before` like `#swap` and changes the notices of its account in the same transaction
	 * (OF-3c): the other tabs hear of both at once. This tab shows the notices as that transaction left
	 * them, and those only it shows (`#unsaved`) changed alike, before the action goes (round 2, C-2 and
	 * C-6): a notice the action decided never shows for a moment.
	 */
	async #dropNoting(before: KeptAction, noting: Noting): Promise<boolean> {
		const storage = this.#storage;
		if (storage === null) throw new DataError('network');
		const matches = (current: unknown) => sameAction(current, before);
		const written = { done: false, notices: undefined as unknown };
		const note = (current: unknown) => {
			const next = noting.device(current);
			written.done = true;
			written.notices = next === null ? current : next;
			return next;
		};
		const wrote = await storage.swapNoting(before.op, matches, null, before.user, note);
		if (!wrote) return false;
		if (before.user === this.#user) {
			if (written.done) this.#showNotices(written.notices);
			if (noting.unsaved !== undefined) this.#unsaved = noting.unsaved(this.#unsaved);
		}
		this.#gone([before.op]);
		return true;
	}

	/**
	 * Deletes every action of the account without a comparison ("Abmelden und verwerfen", decision 4)
	 * and tells the other tabs. One of three writes of the device without a compare-and-swap (OF-3b,
	 * round 2): this one and `clearUser` in a tab that never read the device delete everything of the
	 * account on purpose, whatever its state (since round 3 as read from the device, R2-7); `#read`
	 * deletes entries of other accounts and unreadable ones, which no step of this account plans with.
	 * Every other write is `#create` or `#swap` (`#dropNoting` with the notice); the notices change in
	 * one transaction against what is stored (OF-3c), `clearUser` deletes those of the account.
	 */
	async #forget(ops: readonly string[]): Promise<void> {
		if (ops.length === 0) return;
		await this.#storage?.remove(ops);
		this.#gone(ops);
	}

	/** Runs `run` after the steps of this tab that write the device before it (OF-3b). */
	#locked<T>(run: () => Promise<T>): Promise<T> {
		const next = this.#queue.then(run, run);
		this.#queue = next.then(
			() => undefined,
			() => undefined
		);
		return next;
	}

	/**
	 * Writes `after` over `before`, a reading of the device (OF-3b): new actions first, then the
	 * changed ones, then the ones that go, `last` at the very end, each as a compare-and-swap. An action
	 * that goes with a change of the notices (`noted`, OF-3c) writes it in the same transaction. False
	 * when the device changed meanwhile; what was written until then is in line with `after`.
	 */
	async #commit(
		before: readonly KeptAction[],
		after: readonly KeptAction[],
		last?: string,
		noted?: ReadonlyMap<string, Noting>
	): Promise<boolean> {
		const known = (op: string) => before.find((action) => action.op === op);
		for (const action of after) {
			if (known(action.op) === undefined && !(await this.#create(action))) return false;
		}
		for (const action of after) {
			const old = known(action.op);
			if (old === undefined || sameAction(action, old)) continue;
			if (!(await this.#swap(old, action))) return false;
		}
		const gone = before.filter((action) => !after.some((next) => next.op === action.op));
		const ordered = [
			...gone.filter((action) => action.op !== last),
			...gone.filter((action) => action.op === last)
		];
		for (const action of ordered) {
			const note = noted?.get(action.op);
			const wrote =
				note === undefined ? await this.#swap(action, null) : await this.#dropNoting(action, note);
			if (!wrote) return false;
		}
		return true;
	}

	/**
	 * Plans a change of the device on the actions as read and writes it (OF-3b); reads the device again
	 * and plans anew when another step or tab changed it meanwhile. Null when `plan` finds nothing to
	 * do; after PLAN_ROUNDS rounds the storage counts as failing (round 3, R2-9: not the connection).
	 * The caller holds `#locked`.
	 */
	async #transform<R>(
		plan: (actions: readonly KeptAction[]) => Promise<Planned<R> | null>
	): Promise<R | null> {
		const storage = this.#storage;
		const user = this.#user;
		if (storage === null || user === null) return null;
		for (let round = 1; round <= PLAN_ROUNDS; round += 1) {
			const before = this.#actions;
			const planned = await plan(before);
			if (planned === null) return null;
			if (await this.#commit(before, planned.after, planned.last, planned.noted)) {
				this.#refreshChanged(before, this.#actions);
				return planned.result;
			}
			await this.#read(storage, user, false);
		}
		throw new OutboxStorageError();
	}

	/**
	 * Runs a pure plan of the chains with new identifiers (OF-3b): once to count how many it needs,
	 * then with as many numbers of the order from the device. The probe numbers its new actions after
	 * every existing one, in the order it asks for them, like the device does (round 2), so it sorts
	 * them as the real run does and asks for as many.
	 */
	async #pure<T>(compute: (context: ChainContext) => T): Promise<T> {
		let needed = 0;
		const now = this.#now();
		const probe = compute({
			fresh: () => ({ op: `probe${needed}`, seq: PROBE_SEQ + needed++, now }),
			label: this.#label
		});
		if (needed === 0) return probe;
		const storage = this.#storage;
		if (storage === null) throw new DataError('network');
		const pool: Fresh[] = [];
		for (let index = 0; index < needed; index += 1) {
			pool.push({ op: newOpId(this.#fill), seq: await storage.nextSeq(), now: this.#now() });
		}
		let next = 0;
		return compute({
			fresh: () => {
				const fresh = pool[next++];
				if (fresh === undefined) throw new Error('The plan of the outbox asked for more actions.');
				return fresh;
			},
			label: this.#label
		});
	}

	/**
	 * Waiting actions older than 48 hours, or whose time lies in the future, wait for a decision; an
	 * action from the future names the clock (G4). Those older than 7 days go, never without a word: a
	 * notice that stays names their tickets and every "Verwerfen" a deleted take-back leaves undone
	 * (round 3, R2-2). A discarded one asks nothing (OF-3b): no request of it can be under way any
	 * more, so it goes where its take-backs hold whatever the server has (`coveredAtExpiry`), else it is
	 * sent to the end without the time of the device; one orphaned while "sending" may have arrived,
	 * also when it waits for a decision (round 3). A take-back never expires (round 2, S1); one an
	 * older build let expire waits to be sent again. Since OF-3c each deleted action is written into the
	 * notice of its run on the device in the transaction that deletes it, so no tab and no reload loses
	 * it; a discarded one whose take-back stays and is sent counts no more (R3-6). The caller holds
	 * `#locked`.
	 */
	async #age(now: number): Promise<void> {
		const expiredBacks = (actions: readonly KeptAction[]) =>
			actions.filter((action) => isTakeBack(action) && action.state === 'expired');
		const aged = agedActions(this.#actions, now);
		const idle = (actions: readonly KeptAction[], found: typeof aged) =>
			found.expire.length === 0 && found.drop.length === 0 && expiredBacks(actions).length === 0;
		if (idle(this.#actions, aged)) return;
		// One notice per run, also over the rounds of a compare-and-swap that missed.
		const run: { head: { id: string; at: number } | null } = { head: null };
		await this.#transform(async (before) => {
			const found = agedActions(before, now);
			if (idle(before, found)) return null;
			const { expire, drop } = found;
			const after = await this.#pure((context) => {
				let actions = before.filter((action) => !drop.includes(action.op));
				for (const back of expiredBacks(actions)) {
					const queued: KeptAction = { ...back, state: 'queued', attempts: 0, nextAttemptAt: 0 };
					delete queued.outcome;
					actions = replaced(actions, queued);
				}
				for (const op of expire) {
					const action = actions.find((entry) => entry.op === op);
					if (action === undefined) continue;
					if (action.discarded === true) {
						if (coveredAtExpiry(actions, action)) {
							actions = leaveChain(actions, op, { how: 'arrived' }, context);
						} else {
							const orphaned = action.state === 'sending' ? { unanswered: true as const } : {};
							const late = { ...withoutSending(action), state: 'queued' as const, late: true };
							actions = replaced(actions, { ...late, ...orphaned });
						}
						continue;
					}
					const clock = isFromTheFuture(action, now);
					const expired = withoutSending({
						...action,
						state: 'expired' as const,
						// Orphaned while "sending": it may have arrived, so "Verwerfen" takes it back.
						...(action.state === 'sending' && { unanswered: true as const }),
						...(clock && { outcome: { code: CLOCK_CODE, message: OFFLINE_TEXTS.clockHint } })
					});
					actions = replaced(actions, expired);
				}
				return settleChains(actions, context);
			});
			const entries = droppedEntries(before, drop, after);
			const first = entries[0];
			if (first === undefined) return { after, result: true };
			const notice = (run.head ??= { id: `dropped-${first.op}`, at: now });
			const noted = new SvelteMap<string, Noting>(
				entries.map((entry) => [
					entry.op,
					{ device: (current: unknown) => withDropped(current, notice, entry) }
				])
			);
			return { after, result: true, noted };
		});
		// The other tabs heard of each deletion; this one shows the notice as the device holds it.
		const storage = this.#storage;
		const user = this.#user;
		if (run.head !== null && storage !== null && user !== null) {
			await this.#readNotices(storage, user);
		}
	}

	// ----- the worker -----

	#ready(): boolean {
		return (
			this.#canSend &&
			this.#loaded &&
			this.#user !== null &&
			this.#signedIn(this.#user) &&
			!this.#connectivity.offline &&
			nextToSend(this.#actions, this.#now()) !== null
		);
	}

	async #step(): Promise<boolean> {
		const now = this.#now();
		type Prepared = { go: boolean } | { sending: KeptAction };
		const prepared = await this.#locked(async (): Promise<Prepared> => {
			await this.#age(now);
			const next = nextToSend(this.#actions, now);
			const user = this.#user;
			const storage = this.#storage;
			if (next === null || this.#connectivity.offline || user === null || storage === null) {
				return { go: false };
			}
			if (!this.#signedIn(next.user)) return { go: false };
			// Marked as sent before the request, in one transaction with the check that nobody changed
			// it meanwhile; a change of the same ticket then becomes an action of its own (H1). A creation
			// notes when its request left (OF-4a round 2, A5); a lookup is no request of it.
			const request = isCreateAction(next) && next.discarded !== true;
			const sending: KeptAction = {
				...next,
				state: 'sending',
				sendingSince: now,
				sent: true,
				...(request && { lastSentAt: now })
			};
			if (!(await this.#swap(next, sending))) {
				this.#swapMisses += 1;
				await this.#read(storage, user, false);
				return { go: this.#swapMisses < SWAP_MISSES };
			}
			this.#swapMisses = 0;
			return { sending };
		});
		if (!('sending' in prepared)) return prepared.go;
		const sending = prepared.sending;
		this.#progress = {
			index: this.#sentInRun + 1,
			count: this.#sentInRun + this.#actions.filter(isWaiting).length
		};
		// A discarded creation that may have arrived is only looked up, never sent again (OF-4a, C4).
		const result =
			isCreateAction(sending) && sending.discarded === true
				? await this.#lookUp(sending)
				: await this.#attempt(sending, false);
		// Decided on the action as stored now (OF-3b, H2): "Verwerfen" or "Rückgängig" may have come.
		const resolution = await this.#locked(() => this.#resolve(sending, result, false, now));
		const failure = result.ok ? null : result.failure;
		const created = isCreateAction(sending);
		switch (resolution.kind) {
			case 'arrived':
				// Looking a discarded creation up transfers nothing; its notice says what it found.
				if (!created || sending.discarded !== true) this.#sentInRun += 1;
				this.#failing = null;
				try {
					if (resolution.value !== null) await this.#arrived(resolution.action, resolution.value);
					else if (!created) {
						await this.#reread(ticketOf(resolution.action));
						if (isDayPlanAction(resolution.action)) this.#notifyChecks(null);
					}
				} finally {
					await this.#checkChildren(resolution.action);
				}
				return true;
			case 'kept':
				void this.#connectivity.check();
				return false;
			case 'session':
				this.#sink?.sessionEnded();
				return false;
			case 'later':
				if (resolution.attempts >= FAILURES_BEFORE_NOTICE && failure !== null) {
					this.#failing = { problem: problemOf(failure) };
				}
				return true;
			case 'decision':
				if (failure !== null) this.#problems.set(resolution.action.op, problemOf(failure));
				if (!created) await this.#reread(ticketOf(resolution.action));
				return true;
			case 'dropped':
				if (!created) await this.#reread(ticketOf(resolution.action));
				return true;
			case 'refused':
			case 'lookLater':
			case 'gone':
				return true;
		}
	}

	/**
	 * What an answer means for the action as it is stored now (OF-3b, H2): read fresh after the
	 * request, decided on that, written as a compare-and-swap. Arrived: it goes, and the actions behind
	 * it are based on its wish. No answer: it may have arrived (`unanswered`). A discarded one that the
	 * server refused or met with a conflict changed nothing: it goes without a word, and the actions
	 * behind it are based on its value before, so a change of someone else shows as a conflict there
	 * (H3); after 403 or 404 it stays refused, it may have arrived anyway (M2). `first`: the attempt
	 * right after the change, whose refusal goes back to the store. The caller holds `#locked`.
	 */
	async #resolve(
		sent: KeptAction,
		result: Attempt,
		first: boolean,
		now = this.#now()
	): Promise<Resolution> {
		const storage = this.#storage;
		const user = this.#user;
		if (storage === null || user === null) return { kind: 'gone' };
		// The record a creation made shows before the creation goes (OF-4a): the same ID, no gap.
		if (result.ok && isCreateAction(sent)) this.#showCreated(sent, result.value);
		await this.#read(storage, user, false);
		// A completion that takes sub-tasks along keeps the notices it decides hidden until its
		// sub-tasks are read (`#checkChildren`, round 2, C-5); only an arrival reads them.
		const fresh = this.#actions.find((action) => action.op === sent.op);
		const arrives = result.ok || verdictOf(result.failure).result === 'arrived';
		const reading =
			fresh !== undefined && arrives && childrenAlong(fresh).length > 0 ? fresh : null;
		if (reading !== null) this.#reading = [...this.#reading, reading];
		let resolution: Resolution | null = null;
		// A discarded creation was looked up, not sent (OF-4a, C4).
		const lookedUp = !first && isCreateAction(sent) && sent.discarded === true;
		try {
			resolution = await this.#transform((before) =>
				this.#resolution(before, sent.op, result, { first, lookedUp }, now)
			);
		} finally {
			if (reading !== null && resolution?.kind !== 'arrived') this.#unread(reading.op);
		}
		// An arrival that took a notice along shows the notices as its transaction left them already
		// (`#dropNoting`, round 2, C-2).
		return resolution ?? { kind: 'gone' };
	}

	/**
	 * The plan of `#resolve` on the actions as read. `lookedUp`: the request was the lookup of a
	 * discarded creation, not one of the creation itself (OF-4a, C4).
	 */
	async #resolution(
		before: readonly KeptAction[],
		op: string,
		result: Attempt,
		{ first, lookedUp }: { first: boolean; lookedUp: boolean },
		now: number
	): Promise<Planned<Resolution>> {
		const fresh = before.find((action) => action.op === op);
		if (fresh === undefined) return { after: before, result: { kind: 'gone' } };
		const settle = (actions: readonly KeptAction[]) =>
			this.#pure((context) => settleChains(actions, context));
		// A discarded creation takes changes of its ticket a failed write left behind along (OF-4a).
		const along =
			isCreateAction(fresh) && fresh.discarded === true ? alongCreation(before, fresh) : [];
		const kept = before.filter((action) => !along.includes(action));
		const leave = (how: Leave) =>
			this.#pure((context) => settleChains(leaveChain(kept, op, how, context), context));
		// Arrived: the notices about a sub-task it settled go with it, in one transaction (R3-4), and so do
		// those the storage failed to keep (round 2, C-6). One it takes along waits for the reading.
		const retire = new SvelteMap<string, Noting>([
			[
				op,
				{
					device: (current: unknown) => withoutDecided(current, fresh),
					unsaved: (notices) => notices.filter((notice) => !settledBy(notice, fresh))
				}
			]
		]);
		if (result.ok) {
			const after = await leave({ how: 'arrived' });
			const arrived = { kind: 'arrived', action: fresh, value: result.value } as const;
			// A discarded creation that is there anyway (OF-4a, C4): a notice that stays names it with
			// a link, written in the transaction that lets the action go; nothing is deleted.
			if (isCreateAction(fresh) && fresh.discarded === true) {
				const key = isTicketCreate(fresh) ? ((result.value as Ticket).key ?? '') : '';
				const notice = createdNotice(fresh, key, now);
				const noted = new SvelteMap<string, Noting>([
					[op, { device: (current: unknown) => withNotices(current, [notice]) }]
				]);
				return { after, last: op, result: arrived, noted };
			}
			return { after, last: op, result: arrived, noted: retire };
		}
		const failure = result.failure;
		const verdict = verdictOf(failure, createdRecordOf(fresh));
		if (verdict.result === 'arrived') {
			const after = await leave({ how: 'arrived' });
			const arrived = { kind: 'arrived', action: fresh, value: null } as const;
			if (isCreateAction(fresh)) {
				// Arrived, but the account no longer sees it (`validation_op_applied`, the trash for
				// instance): a notice that stays names it with a link, never silently (round 2, A7).
				const notice = createdNotice(fresh, '', now, true);
				const noted = new SvelteMap<string, Noting>([
					[op, { device: (current: unknown) => withNotices(current, [notice]) }]
				]);
				return { after, last: op, result: arrived, noted };
			}
			return { after, last: op, result: arrived, noted: retire };
		}
		const queued: KeptAction = withoutSending({ ...fresh, state: 'queued' });
		if (verdict.result === 'network') {
			const after = await settle(replaced(before, { ...queued, unanswered: true }));
			return { after, result: { kind: 'kept' } };
		}
		// A creation after a 5xx at its first attempt stays like one without an answer (round 2, A1): the
		// server may have taken it, a new "＋" under another ID would make a second one (C1).
		const keptAfter5xx = isCreateAction(fresh) && verdict.result === 'server';
		if (first && fresh.discarded !== true && !keptAfter5xx) {
			// As today: the store shows the refusal, nothing stays.
			const after = await leave({ how: 'nothing' });
			return { after, last: op, result: { kind: 'refused', failure } };
		}
		if (verdict.result === 'session') {
			return { after: await settle(replaced(before, queued)), result: { kind: 'session' } };
		}
		if (verdict.result === 'server') {
			// A 5xx does not say that the server looked the identifier up (a proxy may answer it): an
			// earlier request without an answer may still have arrived (round 2, M-3), and so may this
			// one, which a proxy may have answered after the server took it (round 3, R2-11: every 5xx;
			// only an answer with 2xx or 4xx is final). So may one that failed without a status, an
			// exception in the client after the answer of the server, say (OF-3c, R3-2). Only an app
			// without the way of the kind sent nothing (`OutboxNoWayError`): it stays as it was.
			const attempts = fresh.attempts + 1;
			const nextAttemptAt = now + backoffDelay(attempts, this.#random);
			const maybe = failure instanceof OutboxNoWayError ? {} : { unanswered: true as const };
			const after = await settle(
				replaced(before, { ...queued, attempts, nextAttemptAt, ...maybe })
			);
			return { after, result: { kind: 'later', attempts } };
		}
		// An answer after the lookup of the identifier: nothing arrived unseen (OF-3); a discarded one
		// stays kept. A creation keeps that a request of it got no answer before: that request may still
		// arrive (round 2, A5).
		const answered: KeptAction = { ...queued };
		const hanging = fresh.unanswered === true || fresh.unansweredBefore === true;
		if (isCreateAction(fresh) && hanging && !lookedUp) answered.unansweredBefore = true;
		if (fresh.discarded !== true) delete answered.unanswered;
		// A discarded creation the server refused, or that the lookup does not find, is not there: it
		// goes without a word (OF-4a, C4); nothing of it is to be taken back. While a request of it may
		// still arrive, it is looked up again once that is 5 minutes ago (round 2, A5).
		const absent = isCreateAction(fresh);
		if (fresh.discarded === true && (absent || !isMissing(failure))) {
			if (absent && mayStillArrive(answered, now)) {
				// The time of its last request is "now" at most (OF-4b, B-4): after the clock went back,
				// the next lookup 5 minutes later is final instead of every 5 minutes until it caught up.
				const lastSentAt = Math.min(answered.lastSentAt ?? now, now);
				const again: KeptAction = {
					...answered,
					lastSentAt,
					nextAttemptAt: lookUpAgainAt({ ...answered, lastSentAt }, now)
				};
				delete again.outcome;
				const after = await settle(replaced(before, again));
				return { after, result: { kind: 'lookLater' } };
			}
			// "Verwerfen" was asked for: it changed nothing, so it goes without a word (OF-3).
			const after = await leave({ how: 'nothing' });
			return { after, last: op, result: { kind: 'dropped', action: fresh } };
		}
		const decided: KeptAction = { ...answered, state: verdict.result, outcome: verdict.outcome };
		const after = await settle(replaced(before, decided));
		return { after, result: { kind: 'decision', action: decided } };
	}

	/** What arrived: the ticket in the list and the panel, a check mark in the day plan (OF-3). */
	async #arrived(action: KeptAction, value: Answer): Promise<void> {
		if (isDayPlanAction(action)) {
			this.#notifyChecks(value as CheckAnswer);
			await this.#reread(action.ticket);
			return;
		}
		if (isCreateAction(action)) {
			this.#showCreated(action, value);
			// A ticket "＋" created counts as read, like one created with a connection (ADR-0015 §3);
			// not one the user discarded.
			if (isTicketCreate(action) && action.discarded !== true) {
				this.#sink?.markRead?.(value as Ticket);
			}
			return;
		}
		const ticket = value as Ticket;
		this.#remember(ticket);
		this.#sink?.upsert(ticket);
	}

	/** The record of the server for a creation (OF-4a), in the list and the panel or in the inbox. */
	#showCreated(action: CreateAction, value: Answer): void {
		if (isInboxCreate(action)) {
			this.#sink?.upsertItem?.(value as InboxItem);
			return;
		}
		const ticket = value as Ticket;
		this.#remember(ticket);
		this.#sink?.upsert(ticket);
	}

	/**
	 * Shows the ticket as the server has it now and resolves to it; without an answer within the time
	 * limit of a request (round 3, R2-10) or after an error as it was before, and to null: the worker
	 * never hangs on it.
	 */
	async #reread(id: string): Promise<Ticket | null> {
		const controller = new AbortController();
		let limit: unknown = null;
		const late = new Promise<never>((_, reject) => {
			limit = this.#timers.set(() => {
				controller.abort();
				reject(new DataError('aborted'));
			}, SEND_TIMEOUT_MS);
		});
		try {
			const ticket = await Promise.race([this.#deps.get(id, controller.signal), late]);
			this.#remember(ticket);
			this.#sink?.upsert(ticket);
			return ticket;
		} catch {
			this.#refreshTicket(id);
			return null;
		} finally {
			this.#timers.clear(limit);
		}
	}

	/**
	 * "Unteraufgaben mit erledigen" changed the sub-tasks as well: their status as the server has it
	 * now is the one later changes are based on (round 2), read side by side (round 3, R2-10). The hook
	 * completes them only on the step to "done": one that is not done although the completion the user
	 * keeps should have taken it along shows as a notice that stays; nothing is sent on its own (round
	 * 3, R2-1). A discarded completion is not what the user wants and names none. Since OF-3c the notice
	 * is kept on the device; while a later change of the user sets the status of the sub-task, that
	 * change decides and the notice does not show (R3-4, `decidesInstead`). Since round 2 (C-5) a notice
	 * such a completion decides goes only for a sub-task read done; at the first attempt (`first`) only
	 * the sub-tasks of such a notice are read, and nothing new is named, as before.
	 */
	async #checkChildren(action: KeptAction, first = false): Promise<void> {
		try {
			const shown = [...this.#notices, ...this.#unsaved];
			const asked = (child: string) =>
				shown.some(
					(notice) =>
						notice.kind === 'childNotDone' &&
						notice.child === child &&
						decidesInstead(notice, action)
				);
			const children = childrenAlong(action).filter((child) => !first || asked(child));
			if (children.length === 0) return;
			const read = await Promise.all(children.map((child) => this.#reread(child)));
			if (action.discarded === true || action.user !== this.#user) return;
			const done = read.flatMap((ticket) => (ticket?.status === 'done' ? [ticket.id] : []));
			await this.#retireAlong(action, done);
			if (first) return;
			const at = this.#now();
			const notices = read.flatMap((ticket) =>
				ticket === null || ticket.status === 'done' ? [] : [childNotice(action, ticket, at)]
			);
			await this.#keepNotices(notices);
		} finally {
			this.#unread(action.op);
		}
	}

	/** The reading of the sub-tasks of an arrived completion is over (round 2, C-5). */
	#unread(op: string): void {
		if (this.#reading.some((action) => action.op === op)) {
			this.#reading = this.#reading.filter((action) => action.op !== op);
		}
	}

	/**
	 * The notices an arrived completion decides that name a sub-task read done (`done`, round 2, C-5):
	 * they go on the device in one transaction against what is stored, and from those only this tab
	 * shows. A failing storage shows its flag; the notice then stays.
	 */
	async #retireAlong(action: KeptAction, done: readonly string[]): Promise<void> {
		if (done.length === 0) return;
		this.#unsaved = this.#unsaved.filter((notice) => !settledBy(notice, action, done));
		const storage = this.#storage;
		const user = this.#user;
		if (storage === null || user === null) return;
		try {
			const stored = await withIntent(OFFLINE_INTENTS.keepNotice, () =>
				this.#locked(() =>
					storage.notices(user, (current) => withoutDecided(current, action, done))
				)
			);
			this.#post();
			if (this.#user === user) this.#showNotices(stored);
		} catch (error) {
			this.#report(error);
		}
	}

	#settled(): void {
		const now = this.#now();
		const waiting = this.#actions.filter(isWaiting).length;
		if (waiting === 0 || this.#connectivity.offline) this.#progress = null;
		if (waiting === 0 && this.#sentInRun > 0) {
			this.#sink?.flags.show({ tone: 'success', title: OFFLINE_TEXTS.sent(this.#sentInRun) });
			this.#sentInRun = 0;
		}
		const wake = nextWakeOf(this.#actions, now);
		if (wake !== null) this.#runner?.wakeAt(wake);
	}

	// ----- decisions of the user -----

	#find(op: string): KeptAction | undefined {
		return this.#actions.find((action) => action.op === op);
	}

	/** "Erneut versuchen": asks the server and sends what waits, also after errors of the server. */
	async retry(): Promise<void> {
		this.#failing = null;
		const waits = (action: KeptAction) => action.state === 'queued' && action.nextAttemptAt > 0;
		await this.#guard(OFFLINE_INTENTS.retry, async () => {
			await this.#locked(() =>
				this.#transform(async (before) => {
					if (!before.some(waits)) return null;
					const again = { nextAttemptAt: 0 };
					const after = before.map((action) => (waits(action) ? { ...action, ...again } : action));
					return { after, result: true };
				})
			);
		});
		await this.#connectivity.check();
		this.#runner?.kick();
	}

	/**
	 * The last known state of the server behind an action that waits for a decision: of its conflict,
	 * else as last seen. The mark of the day of an entry is the one the action was based on: it changed
	 * nothing (a conflict is one of the status, a changed mark is refused), and the device knows no later
	 * mark of the server (round 2; OF-3 took the mark as at the last change, which may be older).
	 */
	#serverStateOf(
		action: KeptAction,
		outcome: ActionOutcome | undefined = action.outcome
	): ServerState {
		const actual = outcome?.actual;
		const ticket = this.#base.get(ticketOf(action));
		if (isDueAction(action)) {
			const due = actual === undefined ? undefined : dueOfServer(actual);
			const known = due !== undefined ? due : ticket?.due;
			return known === undefined ? {} : { due: known };
		}
		const status = isStatus(actual) ? actual : ticket?.status;
		const state: ServerState = status === undefined ? {} : { status };
		if (isDayPlanAction(action)) {
			state.check = { item: action.target, doneToday: action.expected.doneToday };
		}
		return state;
	}

	/** The words of an action in a flag: a take-back says so (OF-3b). */
	#textOf(action: KeptAction): string {
		const text = actionText(action);
		return isTakeBack(action) ? OFFLINE_TEXTS.counter(text) : text;
	}

	/**
	 * "Verwerfen" (concept §2.1, OF-2b, OF-3, OF-3b). One that never left the device, or whose last
	 * request got an answer, goes; the ones behind it are based on its value before, after a conflict or
	 * a refusal on the last known state of the server (G6c). One whose request may be on its way or may
	 * have arrived, also while it is sent, stays marked as discarded and is brought to the end with its
	 * identifier; the take-backs behind it follow (`settleChains`). A take-back that waits or is sent
	 * has no "Verwerfen" of its own (round 2, S2): nothing happens, the dialog offers none. A discarded
	 * one that the server refused with 403 or 404 goes. Every way shows a flag with "Rückgängig"; a
	 * failing storage shows its flag (G6b).
	 */
	async discard(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined) return;
		await this.#guard(OFFLINE_INTENTS.discard(actionText(action)), () =>
			this.#locked(async () => {
				const done = await this.#transform((before) => this.#discardPlan(before, op));
				if (done !== null) this.#discardFlag(done);
			})
		);
		this.#runner?.kick();
	}

	/** The plan of "Verwerfen" of `op` on the actions as read (OF-3b). */
	async #discardPlan(
		before: readonly KeptAction[],
		op: string
	): Promise<Planned<Discarded> | null> {
		const action = before.find((entry) => entry.op === op);
		if (action === undefined) return null;
		if (isCreateAction(action)) return this.#discardCreation(before, action);
		// A take-back carries out "Verwerfen": no "Verwerfen" of its own while it waits (round 2, S2).
		if (isTakeBack(action) && isWaiting(action)) return null;
		const state = this.#serverStateOf(action);
		// After a conflict the user takes what the server has. After a refusal the ones behind it are
		// based on the state read after it, and what the user wants without it still counts. One older
		// than 48 hours was not sent and nothing was read about it: it goes as one that changed nothing
		// (round 2, H-1; the last state read may be older than the chain).
		let decided: Leave = { how: 'nothing' };
		if (action.state === 'conflict') decided = { how: 'decided', state };
		else if (action.state === 'refused') decided = { how: 'refused', state };
		const deleted = async (): Promise<Planned<Discarded>> => ({
			after: await this.#pure((context) =>
				settleChains(leaveChain(before, op, decided, context), context)
			),
			last: op,
			result: { kind: 'deleted', action }
		});
		const marked = async (): Promise<Planned<Discarded>> => ({
			after: await this.#pure((context) => this.#marked(before, action, context)),
			result: { kind: 'marked', action }
		});
		if (action.discarded === true) {
			// Refused with 403 or 404 after "Verwerfen" (M2): the user saw it and lets it go.
			if (action.state === 'refused') return deleted();
			// Older than 48 hours (an older build let it expire): it goes on as `#age` does it.
			return action.state === 'expired' ? marked() : null;
		}
		return mayBeThere(action) ? marked() : deleted();
	}

	/**
	 * "Verwerfen" of a creation "＋" (OF-4a). The changes of its ticket go with it: they wait for it, so
	 * none of them left the device. One that never left the device, or whose last request got an answer
	 * (the server refused it), goes: it never reaches the server (C4). One that may be on its way or may
	 * have arrived stays discarded: it is never sent again and never deleted on the server, only looked
	 * up by its ID (`#lookUp`); found, a notice that stays names it (C1, C3, C4).
	 */
	async #discardCreation(
		before: readonly KeptAction[],
		action: CreateAction
	): Promise<Planned<Discarded> | null> {
		const along = alongCreation(before, action);
		if (action.discarded === true && along.length === 0) return null;
		const rest = before.filter((entry) => !along.includes(entry));
		if (action.discarded === true) {
			// A round after a write that failed half way: only its changes are left to go.
			return { after: rest, result: { kind: 'marked', action, along } };
		}
		// A request of it may still arrive although the server answered a later one (refused after a
		// request without an answer, round 2, A5): it stays to be looked up, like one that may be there.
		if (!mayBeThere(action) && !mayStillArrive(action, this.#now())) {
			const after = await this.#pure((context) =>
				settleChains(
					rest.filter((entry) => entry.op !== action.op),
					context
				)
			);
			return { after, last: action.op, result: { kind: 'deleted', action, along } };
		}
		// Older than 48 hours, it waited for a decision: the lookup asks nothing (no time of the device).
		// A refused one is looked up the same way (round 2, A5).
		const marked: KeptAction = { ...action, discarded: true };
		if (marked.state === 'expired' || marked.state === 'refused') {
			Object.assign(marked, { state: 'queued', nextAttemptAt: 0 });
			delete marked.outcome;
		}
		const after = await this.#pure((context) => settleChains(replaced(rest, marked), context));
		return { after, result: { kind: 'marked', action, along } };
	}

	/**
	 * The actions with `action` discarded (OF-3b): the take-backs follow; one older than 48 hours goes
	 * where they hold whatever the server has, else it is sent to the end without the time of the device.
	 */
	#marked(before: readonly KeptAction[], action: KeptAction, context: ChainContext): KeptAction[] {
		let after = settleChains(replaced(before, { ...action, discarded: true }), context);
		const marked = after.find((entry) => entry.op === action.op);
		if (marked === undefined || marked.state !== 'expired') return after;
		if (coveredAtExpiry(after, marked)) {
			after = leaveChain(after, marked.op, { how: 'arrived' }, context);
		} else {
			const late: KeptAction = { ...marked, state: 'queued', late: true };
			Object.assign(late, { attempts: 0, nextAttemptAt: 0 });
			delete late.outcome;
			after = replaced(after, late);
		}
		return settleChains(after, context);
	}

	/**
	 * The flag after "Verwerfen" with "Rückgängig" (OF-3b). It names sub-tasks a discarded completion
	 * may have done whose status before is unknown, so nobody takes them back (round 2).
	 */
	#discardFlag(done: Discarded): void {
		const { action } = done;
		const text = this.#textOf(action);
		if (isCreateAction(action)) {
			const record = isTicketCreate(action) ? 'ticket' : 'inbox';
			this.#sink?.flags.show({
				tone: 'success',
				title: OFFLINE_TEXTS.discarded(text),
				...(done.kind === 'marked' && { description: OFFLINE_TEXTS.createCheckHint(record) }),
				action: { label: OFFLINE_TEXTS.undo, run: () => void this.#undoCreation(done) }
			});
			return;
		}
		const takenBack =
			done.kind === 'marked' &&
			!isTakeBack(action) &&
			this.#actions.some((entry) => entry.undoes === action.op);
		const unknown = done.kind === 'marked' ? unknownChildren(action).length : 0;
		const hints = [
			...(takenBack ? [OFFLINE_TEXTS.takenBackHint] : []),
			...(unknown > 0 ? [OFFLINE_TEXTS.childrenUnknown(unknown)] : [])
		];
		const undo = () => (done.kind === 'marked' ? this.#undoDiscard(action) : this.#restore(action));
		this.#sink?.flags.show({
			tone: 'success',
			title: takenBack ? OFFLINE_TEXTS.takenBack(text) : OFFLINE_TEXTS.discarded(text),
			...(hints.length > 0 && { description: hints.join(' ') }),
			action: { label: OFFLINE_TEXTS.undo, run: () => void undo() }
		});
	}

	/**
	 * Runs a change of "Rückgängig" on the device and lets the worker look (OF-3b). Where it cannot do
	 * anything, a flag says why, never without a word (round 2).
	 */
	async #undoing(
		action: KeptAction,
		plan: (before: readonly KeptAction[]) => Promise<Planned<Undone> | null>
	): Promise<void> {
		if (action.user !== this.#user) {
			this.#sink?.flags.show({ tone: 'info', title: OFFLINE_TEXTS.undoOtherAccount });
			return;
		}
		let undone: Undone | null = null;
		await this.#guard(OFFLINE_INTENTS.restore(actionText(action)), async () => {
			undone = await this.#locked(() => this.#transform(plan));
		});
		if (undone === 'later') {
			this.#sink?.flags.show({ tone: 'info', title: OFFLINE_TEXTS.undoLater });
		} else if (undone === 'full') {
			this.#sink?.flags.show({ tone: 'error', title: OFFLINE_TEXTS.full });
		}
		this.#runner?.kick();
	}

	/** Whether the device has room for every action `after` adds to `before` (concept §3.2). */
	#roomFor(before: readonly KeptAction[], after: readonly KeptAction[]): boolean {
		const added = after.filter((action) => !before.some((entry) => entry.op === action.op));
		let kept = [...before];
		for (const action of added) {
			if (!hasRoom(kept, action)) return false;
			kept = [...kept, action];
		}
		return true;
	}

	/**
	 * "Rückgängig" after "Verwerfen" of a change that may have arrived (OF-3b, round 2 H-2c): what the
	 * user wanted before "Verwerfen" comes back. While the change is there, it counts again. Once it
	 * went, its wish comes anew as a normal change at the end of its chain (`wishAgain`), also when its
	 * take-back was sent, arrived, met a conflict or was refused; a later change that sets the value
	 * anyway keeps it. Nothing is skipped (M6).
	 */
	#undoDiscard(original: KeptAction): Promise<void> {
		return this.#undoing(original, async (before) => {
			const present = before.find((entry) => entry.op === original.op);
			if (present !== undefined) {
				if (present.discarded !== true) return null;
				const kept = { ...present };
				delete kept.discarded;
				return {
					after: await this.#pure((context) => settleChains(replaced(before, kept), context)),
					result: 'done'
				};
			}
			const after = await this.#pure((context) => {
				const again = wishAgain(before, original, context);
				return again === null ? null : settleChains(again, context);
			});
			if (after === null) return { after: before, result: 'later' };
			if (!this.#roomFor(before, after)) return { after: before, result: 'full' };
			return { after, result: 'done' };
		});
	}

	/**
	 * "Rückgängig" after "Verwerfen" of a creation "＋" (OF-4a): it counts again with the changes of its
	 * ticket, under its identifier and its ID (C1: the server answers a repetition like the first time,
	 * also where the lookup found it meanwhile). One that never left the device comes back as it was.
	 */
	#undoCreation(done: Discarded): Promise<void> {
		const original = done.action;
		const along = done.along ?? [];
		return this.#undoing(original, async (before) => {
			let after: KeptAction[] = [...before];
			const present = before.find((entry) => entry.op === original.op);
			if (present?.discarded === true) {
				const kept: KeptAction = { ...present };
				delete kept.discarded;
				after = replaced(after, kept);
			} else if (present === undefined && done.kind === 'deleted') {
				after.push(original);
			} else if (present === undefined) {
				const again: KeptAction = { ...original, state: 'queued', attempts: 0, nextAttemptAt: 0 };
				delete again.discarded;
				delete again.outcome;
				delete again.sendingSince;
				after.push(again);
			}
			for (const entry of along) {
				if (!after.some((other) => other.op === entry.op)) after.push(entry);
			}
			if (
				after.every((entry, index) => entry === before[index]) &&
				after.length === before.length
			) {
				return null;
			}
			const settled = await this.#pure((context) => settleChains(after, context));
			if (!this.#roomFor(before, settled)) return { after: before, result: 'full' };
			return { after: settled, result: 'done' };
		});
	}

	/** "Rückgängig" after "Verwerfen" deleted an action: it comes back at its place in the order. */
	#restore(action: KeptAction): Promise<void> {
		return this.#undoing(action, async (before) => {
			if (before.some((entry) => entry.op === action.op)) return null;
			const after = await this.#pure((context) => settleChains([...before, action], context));
			if (!this.#roomFor(before, after)) return { after: before, result: 'full' };
			return { after, result: 'done' };
		});
	}

	/** "Meine Änderung übernehmen": the same identifier again, now based on the value of the server. */
	async takeMine(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'conflict') return;
		await this.#guard(OFFLINE_INTENTS.takeMine(actionText(action)), () =>
			this.#requeue(op, (current) => {
				if (current.state !== 'conflict' || isCreateAction(current)) return null;
				const actual = current.outcome?.actual;
				if (isDueAction(current)) {
					const due = dueOfServer(actual);
					return due === undefined ? null : { ...current, expected: { due } };
				}
				if (!isStatus(actual)) return null;
				if (isDayPlanAction(current)) {
					return { ...current, expected: { ...current.expected, status: actual } };
				}
				return { ...current, expected: { status: actual } };
			})
		);
	}

	/**
	 * "Ohne Projekt anlegen" and "Ohne Tags anlegen" of a refused creation of a ticket (OF-4a, concept
	 * §3.7): sent again without that field, under its identifier and its ID. The refusal came after the
	 * lookup of the identifier, so nothing of it arrived; the ID still guards against a second ticket.
	 */
	async createWithout(op: string, field: CreateField): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || withoutFieldOf(action) !== field) return;
		await this.#guard(OFFLINE_INTENTS.withoutField(field, actionText(action)), () =>
			this.#requeue(op, (current) => {
				if (!isTicketCreate(current) || withoutFieldOf(current) !== field) return null;
				const payload =
					field === 'project'
						? { ...current.payload, project: null }
						: { ...current.payload, tags: [] };
				return { ...current, payload };
			})
		);
	}

	/** "Trotzdem übertragen" after 48 hours: sent without the time of the device (decision 2). */
	async sendAnyway(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'expired') return;
		await this.#guard(OFFLINE_INTENTS.sendAnyway(actionText(action)), () =>
			this.#requeue(op, (current) =>
				current.state === 'expired' ? { ...current, late: true } : null
			)
		);
	}

	/** The answer to the open sub-tasks of a completion: "Trotzdem erledigen" or "… mit erledigen". */
	async answerChildren(op: string, choice: CompletionChoice): Promise<void> {
		const action = this.#find(op);
		const completes = (entry: KeptAction) => isStatusAction(entry) || isDayPlanAction(entry);
		if (action === undefined || action.state !== 'refused' || !completes(action)) return;
		const children =
			choice === 'complete_children' ? [...(this.#sink?.childrenOf?.(ticketOf(action)) ?? [])] : [];
		const childrenBefore = this.#statusesOf(children);
		await this.#guard(OFFLINE_INTENTS.answerChildren(actionText(action)), () =>
			this.#requeue(op, (current) => {
				if (current.state !== 'refused') return null;
				if (!isStatusAction(current) && !isDayPlanAction(current)) return null;
				const next: OutboxAction | DayPlanAction = {
					...current,
					completion: choice,
					...(choice === 'complete_children' && {
						children,
						...(children.length > 0 && { childrenBefore })
					})
				};
				if (choice === 'force') {
					delete next.children;
					delete next.childrenBefore;
				}
				return next;
			})
		);
	}

	/**
	 * "Trotzdem erledigen" of a check mark of a task on a day gone by (decision of the user 3, OF-3):
	 * the ticket is completed over the normal way, the plan of that day stays as it is. The completion
	 * takes the place of the check mark in the order; actions behind it wait for it instead.
	 */
	async completeAnyway(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || !isDayPlanAction(action) || !canCompleteAnyway(action)) return;
		await this.#guard(OFFLINE_INTENTS.completeAnyway(actionText(action)), () =>
			this.#instead(op, canCompleteAnyway, completionInstead)
		);
		this.#runner?.kick();
	}

	/**
	 * "Trotzdem wieder öffnen" of taking back a completion on a day gone by (OF-3b, M4): the ticket is
	 * opened again over the normal way, like "Trotzdem erledigen", only on a click.
	 */
	async reopenAnyway(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || !isDayPlanAction(action) || !canReopenAnyway(action)) return;
		await this.#guard(OFFLINE_INTENTS.reopenAnyway(actionText(action)), () =>
			this.#instead(op, canReopenAnyway, reopenInstead)
		);
		this.#runner?.kick();
	}

	/**
	 * A refused check mark replaced by a change of the status of its ticket, at its place (OF-3, OF-3b):
	 * the new action first, then every action behind it waits for it too, the check mark goes last; each
	 * write a compare-and-swap whose result counts, so nothing behind it can go before the new one.
	 */
	async #instead(
		op: string,
		may: (action: KeptAction) => boolean,
		make: (action: DayPlanAction, op: string) => OutboxAction
	): Promise<void> {
		const next = newOpId(this.#fill);
		await this.#locked(() =>
			this.#transform(async (before) => {
				const action = before.find((entry) => entry.op === op);
				if (action === undefined || !isDayPlanAction(action) || !may(action)) return null;
				const instead = make(action, next);
				// A round after a missed compare-and-swap finds it written already.
				const others = before.filter((entry) => entry.op !== next);
				const after = others.map((entry) => {
					if (entry.op === op) return instead;
					if (!entry.dependsOn.includes(op) || entry.dependsOn.includes(next)) return entry;
					return { ...entry, dependsOn: [...entry.dependsOn, next] };
				});
				return {
					after: await this.#pure((context) => settleChains(after, context)),
					last: op,
					result: true
				};
			})
		);
	}

	/**
	 * Sends an action that waits for a decision again (OF-2b): `change` on the action as read now,
	 * written as a compare-and-swap; null from it leaves the action as it is.
	 */
	async #requeue(op: string, change: (current: KeptAction) => KeptAction | null): Promise<void> {
		await this.#locked(() =>
			this.#transform(async (before) => {
				const current = before.find((entry) => entry.op === op);
				const next = current === undefined ? null : change(current);
				if (next === null) return null;
				const queued: KeptAction = { ...next, state: 'queued', attempts: 0, nextAttemptAt: 0 };
				delete queued.outcome;
				this.#problems.delete(op);
				return {
					after: await this.#pure((context) => settleChains(replaced(before, queued), context)),
					result: true
				};
			})
		);
		this.#runner?.kick();
	}

	// ----- signing out -----

	/**
	 * "Abmelden" has to read the device itself (G3): this tab never read it (the server without
	 * `offline_ops`, outside of the frame), but it may hold changes of the account.
	 */
	get readsOnSignOut(): boolean {
		return !this.#loaded && this.#storage !== null && this.#user !== null;
	}

	/** The identifiers of the changes of the signed-in account on the device, without creating it. */
	async #opsOfAccount(): Promise<string[]> {
		const storage = this.#storage;
		const user = this.#user;
		if (storage === null || user === null) return [];
		if (this.#deps.exists !== undefined && !(await this.#deps.exists())) return [];
		const ops: string[] = [];
		for (const entry of await storage.list()) {
			const action = parseAction(entry);
			if (action?.user === user) ops.push(action.op);
		}
		return ops;
	}

	/** How many changes of the signed-in account the device keeps, read directly (G3). */
	async keptOfAccount(): Promise<number> {
		return (await this.#opsOfAccount()).length;
	}

	/**
	 * "Abmelden und verwerfen": every action of the signed-in account goes (decision 4), also when
	 * this tab never read the device (G3). It runs after the steps of this tab that write the device
	 * (round 2), so none of them writes an action back after it, and takes the actions as the device
	 * has them, not as this tab last read them: another tab may have kept one meanwhile (round 3, R2-7).
	 * The notices of the account go with them (OF-3c).
	 */
	async clearUser(): Promise<void> {
		await this.#locked(async () => {
			const ops = await this.#opsOfAccount();
			if (!this.#loaded) {
				if (ops.length > 0) await this.#storage?.remove(ops);
			} else {
				const known = this.#actions.map((action) => action.op).filter((op) => !ops.includes(op));
				await this.#forget([...ops, ...known]);
			}
			await this.#forgetNotices();
		});
	}

	/**
	 * The notices of the account go with "Abmelden und verwerfen" (OF-3c), on the device as well (the
	 * whole entry of the account, on purpose, like `#forget`), without creating the storage; those of
	 * other accounts stay.
	 */
	async #forgetNotices(): Promise<void> {
		const storage = this.#storage;
		const user = this.#user;
		this.#notices = [];
		this.#unsaved = [];
		if (storage === null || user === null) return;
		if (this.#deps.exists !== undefined && !(await this.#deps.exists())) return;
		await storage.notices(user, (current) => (current === undefined ? null : []));
		this.#post();
	}
}

const [getOutboxContext, setOutboxContext, hasOutboxContext] = createContext<OutboxStore>();

/** The outbox of the (app) layout for marks and notices; null outside of it (component tests). */
export function findOutbox(): OutboxStore | null {
	return hasOutboxContext() ? getOutboxContext() : null;
}

export { setOutboxContext };
