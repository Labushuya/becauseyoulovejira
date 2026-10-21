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
// - The actions belong to the signed-in account: another account never sends them, and they are
//   deleted when another account signs in (decision of the user 4). "Abmelden" deletes them after
//   the question (`clearUser`), also when this tab never read the device; an ended session keeps
//   them. Before every request the client has to be signed in with the account of the action.
// - One tab sends (OutboxRunner with the lease of the device); the BroadcastChannel "byl-outbox"
//   tells the other tabs to read the device again. Its identifier and the channel come with the
//   first watch, so without the capability nothing is created in the browser.
// - A failing storage of the device shows as an error flag with "Details", never as an uncaught
//   rejection.

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
	completionInstead,
	dueOfServer,
	hasRoom,
	inOrder,
	isDayPlanAction,
	isDerived,
	isDueAction,
	isFree,
	intentOf,
	isFromTheFuture,
	isStatusAction,
	isTakeBack,
	isWaiting,
	isWill,
	needsDecision,
	newOpId,
	nextToSend,
	nextWakeOf,
	opsOf,
	overlayDoneToday,
	overlayDue,
	overlayStatus,
	parseAction,
	planCheckChange,
	planDueChange,
	planStatusChange,
	reopenInstead,
	requestFields,
	sameAction,
	supportsKind,
	ticketOf,
	verdictOf,
	writesOf,
	type ActionOutcome,
	type ChangePlan,
	type CheckChange,
	type DayPlanAction,
	type DueAction,
	type KeptAction,
	type OfflineOps,
	type OutboxAction,
	type OutboxFields,
	type PlanContext,
	type ServerState
} from '$lib/domain/offline';
import {
	coveredAtExpiry,
	inverseOf,
	leaveChain,
	mayBeThere,
	restoreAs,
	settleChains,
	takenBackBy,
	type ChainContext,
	type Fresh,
	type Leave
} from '$lib/domain/offline-chain';
import type { ProblemEntry } from '$lib/domain/problems';
import { isStatus, type Status } from '$lib/domain/status';
import type { CompletionChoice } from '$lib/domain/subtasks';
import { REOPEN_STATUS, type Ticket, type TicketSummary } from '$lib/domain/ticket';
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
	/** Reads a ticket again (after a conflict, a refusal, an action that arrived before). */
	get(id: string): Promise<Ticket>;
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
}

/** The device holds as many actions as it may (concept §3.2). */
export class OutboxFullError extends DataError {
	constructor() {
		super('network');
		this.name = 'OutboxFullError';
		this.message = OFFLINE_TEXTS.full;
	}
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

type Answer = Ticket | CheckAnswer;
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
	| { kind: 'gone' };

/** A plan of a change of the device: the actions as they should be, the one that goes last. */
interface Planned<R> {
	after: readonly KeptAction[];
	last?: string;
	result: R;
}

/** What "Verwerfen" did, for its flag and its "Rückgängig" (OF-3b). */
type Discarded =
	| { kind: 'marked'; action: KeptAction }
	| { kind: 'deleted'; action: KeptAction }
	| { kind: 'kept'; action: KeptAction; originals: readonly string[] }
	| { kind: 'inverted'; action: KeptAction; inverse: string };

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
	/** The mark of the day per entry of the day plan as the server had it at the last change (OF-3). */
	readonly #items = new SvelteMap<string, boolean>();
	/** Who waits for the answers of kept check marks: the day plan of the view (OF-3). */
	readonly #checkWatchers = new SvelteSet<(answer: CheckAnswer | null) => void>();
	/** Tickets the outbox made itself (overlays), never taken as the state of the server. */
	readonly #provisional = new WeakSet<object>();
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
	 * plan (OF-3); a waiting check mark that completes a ticket marks the ticket as well.
	 */
	markOf(id: string): OutboxMark {
		let mark: OutboxMark = null;
		for (const action of this.#actions) {
			const child =
				!isDueAction(action) &&
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
		this.#items.clear();
		this.#problems.clear();
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
		const run = (async () => {
			if (!this.#frame && this.#deps.exists !== undefined && !(await this.#deps.exists())) {
				this.#loadingFor = null;
				return;
			}
			await this.#read(storage, user, true);
			if (this.#user !== user) return;
			this.#loaded = true;
			this.#update();
			this.#runner?.kick();
		})();
		this.#loading = run;
		try {
			await run;
		} catch {
			// Without its storage the outbox stays off; every change goes the way of today.
			this.#loadingFor = null;
		}
	}

	/**
	 * Reads the actions of the device. `start`: entries of other accounts and older than 7 days go,
	 * those older than 48 hours wait for a decision.
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
		if (this.#user !== user) return;
		const before = this.#actions;
		this.#actions = inOrder(mine);
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
	 * (OF-3b): only IDs and these statuses are kept, like "Rückgängig" online keeps them.
	 */
	#statusesOf(ids: readonly string[]): Status[] {
		return ids.map((id) => this.#base.get(id)?.status ?? REOPEN_STATUS);
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
				planStatusChange(
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
			() => this.#shown(base),
			() => ticket
		);
	}

	/** A change of the due date of `ticket` (OF-3), like the status. */
	async changeDue<T extends TicketSummary>(ticket: T, due: CalendarDate | null): Promise<T> {
		await this.#begin();
		const base = this.#baseOf(ticket);
		this.#remember(base);
		return this.#change(
			(context) =>
				planDueChange(
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
			() => this.#shown(base),
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
		this.#items.set(entry.item.id, entry.item.doneToday);
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
					// plan again, so a change never goes into an action that left the device (H1).
					if (round >= PLAN_ROUNDS) throw new DataError('network');
					await this.#read(storage, user, false);
				}
			});
		} catch (error) {
			// The device keeps nothing: nothing was noted, as without the outbox.
			if (error instanceof OutboxFullError || error instanceof DataError) throw error;
			throw new DataError('network', { cause: error });
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
		if (verdictOf(result.failure).result === 'network') void this.#connectivity.check();
		throw result.failure;
	}

	/** One request of the action over the way of its kind. */
	#transmit(action: KeptAction, fields: OutboxFields, signal: AbortSignal): Promise<Answer> {
		if (isStatusAction(action)) return this.#deps.send(action, fields, signal);
		// Without the way of its kind (an app without it) the action waits like after an error.
		const missing = () => Promise.reject(new DataError('server'));
		if (isDueAction(action)) {
			const send = this.#deps.sendDue;
			return send === undefined ? missing() : send(action, fields, signal);
		}
		const send = this.#deps.sendDayPlan;
		return send === undefined ? missing() : send(action, fields, signal);
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
	 * Deletes every action of the account without a comparison ("Abmelden und verwerfen", decision 4)
	 * and tells the other tabs; the only write of the device that is no compare-and-swap (OF-3b).
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
	 * changed ones, then the ones that go, `last` at the very end, each as a compare-and-swap. False
	 * when the device changed meanwhile; what was written until then is in line with `after`.
	 */
	async #commit(
		before: readonly KeptAction[],
		after: readonly KeptAction[],
		last?: string
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
			if (!(await this.#swap(action, null))) return false;
		}
		return true;
	}

	/**
	 * Plans a change of the device on the actions as read and writes it (OF-3b); reads the device again
	 * and plans anew when another step or tab changed it meanwhile. Null when `plan` finds nothing to
	 * do; throws after PLAN_ROUNDS rounds. The caller holds `#locked`.
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
			if (await this.#commit(before, planned.after, planned.last)) {
				this.#refreshChanged(before, this.#actions);
				return planned.result;
			}
			await this.#read(storage, user, false);
		}
		throw new DataError('network');
	}

	/**
	 * Runs a pure plan of the chains with new identifiers (OF-3b): once to count how many it needs,
	 * then with as many numbers of the order from the device.
	 */
	async #pure<T>(compute: (context: ChainContext) => T): Promise<T> {
		let needed = 0;
		const probe = compute({
			fresh: () => ({ op: `probe${needed++}`, seq: 0, now: 0 }),
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
	 * action from the future names the clock (G4). Those older than 7 days go. A discarded one asks
	 * nothing (OF-3b): no request of it can be under way any more, so it goes where its take-backs
	 * hold whatever the server has (`coveredAtExpiry`), else it is sent to the end without the time of
	 * the device; one orphaned while "sending" may have arrived. The caller holds `#locked`.
	 */
	async #age(now: number): Promise<void> {
		const aged = agedActions(this.#actions, now);
		if (aged.expire.length === 0 && aged.drop.length === 0) return;
		await this.#transform(async (before) => {
			const { expire, drop } = agedActions(before, now);
			if (expire.length === 0 && drop.length === 0) return null;
			const after = await this.#pure((context) => {
				let actions = before.filter((action) => !drop.includes(action.op));
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
						...(clock && { outcome: { code: CLOCK_CODE, message: OFFLINE_TEXTS.clockHint } })
					});
					actions = replaced(actions, expired);
				}
				return settleChains(actions, context);
			});
			return { after, result: true };
		});
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
			// it meanwhile; a change of the same ticket then becomes an action of its own (H1).
			const sending: KeptAction = { ...next, state: 'sending', sendingSince: now, sent: true };
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
		const result = await this.#attempt(sending, false);
		// Decided on the action as stored now (OF-3b, H2): "Verwerfen" or "Rückgängig" may have come.
		const resolution = await this.#locked(() => this.#resolve(sending, result, false, now));
		const failure = result.ok ? null : result.failure;
		switch (resolution.kind) {
			case 'arrived':
				this.#sentInRun += 1;
				this.#failing = null;
				if (resolution.value !== null) await this.#arrived(resolution.action, resolution.value);
				else {
					await this.#reread(ticketOf(resolution.action));
					if (isDayPlanAction(resolution.action)) this.#notifyChecks(null);
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
				await this.#reread(ticketOf(resolution.action));
				return true;
			case 'dropped':
				await this.#reread(ticketOf(resolution.action));
				return true;
			case 'refused':
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
		await this.#read(storage, user, false);
		const resolution = await this.#transform((before) =>
			this.#resolution(before, sent.op, result, first, now)
		);
		return resolution ?? { kind: 'gone' };
	}

	/** The plan of `#resolve` on the actions as read. */
	async #resolution(
		before: readonly KeptAction[],
		op: string,
		result: Attempt,
		first: boolean,
		now: number
	): Promise<Planned<Resolution>> {
		const fresh = before.find((action) => action.op === op);
		if (fresh === undefined) return { after: before, result: { kind: 'gone' } };
		const settle = (actions: readonly KeptAction[]) =>
			this.#pure((context) => settleChains(actions, context));
		const leave = (how: Leave) =>
			this.#pure((context) => settleChains(leaveChain(before, op, how, context), context));
		if (result.ok) {
			const after = await leave({ how: 'arrived' });
			return { after, last: op, result: { kind: 'arrived', action: fresh, value: result.value } };
		}
		const failure = result.failure;
		const verdict = verdictOf(failure);
		if (verdict.result === 'arrived') {
			const after = await leave({ how: 'arrived' });
			return { after, last: op, result: { kind: 'arrived', action: fresh, value: null } };
		}
		const queued: KeptAction = withoutSending({ ...fresh, state: 'queued' });
		if (verdict.result === 'network') {
			const after = await settle(replaced(before, { ...queued, unanswered: true }));
			return { after, result: { kind: 'kept' } };
		}
		if (first && fresh.discarded !== true) {
			// As today: the store shows the refusal, nothing stays.
			const after = await leave({ how: 'nothing' });
			return { after, last: op, result: { kind: 'refused', failure } };
		}
		if (verdict.result === 'session') {
			return { after: await settle(replaced(before, queued)), result: { kind: 'session' } };
		}
		// An answer of the server: nothing may have arrived unseen (OF-3); a discarded one stays kept.
		const answered: KeptAction = { ...queued };
		if (fresh.discarded !== true) delete answered.unanswered;
		if (verdict.result === 'server') {
			const attempts = fresh.attempts + 1;
			const nextAttemptAt = now + backoffDelay(attempts, this.#random);
			const after = await settle(replaced(before, { ...answered, attempts, nextAttemptAt }));
			return { after, result: { kind: 'later', attempts } };
		}
		if (fresh.discarded === true && !isMissing(failure)) {
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
		const ticket = value as Ticket;
		this.#remember(ticket);
		this.#sink?.upsert(ticket);
	}

	/** Shows the ticket as the server has it now; without an answer as it was before. */
	async #reread(id: string): Promise<void> {
		try {
			const ticket = await this.#deps.get(id);
			this.#remember(ticket);
			this.#sink?.upsert(ticket);
		} catch {
			this.#refreshTicket(id);
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
	 * The last known state of the server behind an action: of its conflict, else as last seen (the
	 * mark of the day of an entry as at its last change, OF-3).
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
		const doneToday = isDayPlanAction(action) ? this.#items.get(action.target) : undefined;
		if (isDayPlanAction(action) && doneToday !== undefined) {
			state.check = { item: action.target, doneToday };
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
	 * identifier; the take-backs behind it follow (`settleChains`). A take-back: the changes it takes
	 * back count again, or, once they went, it turns into its counterpart. A discarded one that the
	 * server refused with 403 or 404 goes. Every way shows a flag with "Rückgängig"; a failing storage
	 * shows its flag (G6b).
	 */
	async discard(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined) return;
		await this.#guard(OFFLINE_INTENTS.discard(actionText(action)), () =>
			this.#locked(async () => {
				const state = this.#serverStateOf(action);
				const done = await this.#transform((before) => this.#discardPlan(before, op, state));
				if (done !== null) this.#discardFlag(done);
			})
		);
		this.#runner?.kick();
	}

	/** The plan of "Verwerfen" of `op` on the actions as read (OF-3b). */
	async #discardPlan(
		before: readonly KeptAction[],
		op: string,
		state: ServerState
	): Promise<Planned<Discarded> | null> {
		const action = before.find((entry) => entry.op === op);
		if (action === undefined) return null;
		const present = opsOf(before);
		const decided: Leave = needsDecision(action) ? { how: 'decided', state } : { how: 'nothing' };
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
		if (isTakeBack(action) && isDerived(action, present)) {
			const originals = takenBackBy(before, action);
			if (originals.length > 0) {
				const after = before.map((entry) => {
					if (!originals.includes(entry)) return entry;
					const kept = { ...entry };
					delete kept.discarded;
					return kept;
				});
				return {
					after: await this.#pure((context) => settleChains(after, context)),
					result: { kind: 'kept', action, originals: originals.map((entry) => entry.op) }
				};
			}
		}
		if (isTakeBack(action) && isFree(action)) {
			let inverse = '';
			const after = await this.#pure((context) => {
				const turned = inverseOf(action, context.fresh());
				inverse = turned.op;
				return settleChains(replacedBy(before, action.op, turned), context);
			});
			return { after, last: op, result: { kind: 'inverted', action, inverse } };
		}
		return mayBeThere(action) ? marked() : deleted();
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

	/** The flag after "Verwerfen" with "Rückgängig" (OF-3b). */
	#discardFlag(done: Discarded): void {
		const { action } = done;
		const text = this.#textOf(action);
		const takenBack =
			done.kind === 'marked' &&
			!isTakeBack(action) &&
			this.#actions.some((entry) => entry.undoes === action.op);
		const undo = () => {
			if (done.kind === 'marked') return this.#undoDiscard(action);
			if (done.kind === 'deleted') return this.#restore(action);
			if (done.kind === 'kept') return this.#discardAgain(done.originals);
			return this.#turnBack(action, done.inverse);
		};
		this.#sink?.flags.show({
			tone: 'success',
			title: takenBack ? OFFLINE_TEXTS.takenBack(text) : OFFLINE_TEXTS.discarded(text),
			...(takenBack && { description: OFFLINE_TEXTS.takenBackHint }),
			action: { label: OFFLINE_TEXTS.undo, run: () => void undo() }
		});
	}

	/** Runs a change of "Rückgängig" on the device and lets the worker look (OF-3b). */
	async #undoing(
		action: KeptAction,
		plan: (before: readonly KeptAction[]) => Promise<Planned<boolean> | null>
	): Promise<void> {
		if (action.user !== this.#user) return;
		await this.#guard(OFFLINE_INTENTS.restore(actionText(action)), async () => {
			await this.#locked(() => this.#transform(plan));
		});
		this.#runner?.kick();
	}

	/**
	 * "Rückgängig" after "Verwerfen" of a change that may have arrived (OF-3b): it counts again. Once it
	 * went, its take-backs are turned around (one that may be under way or have arrived is discarded in
	 * turn, so another one follows it), or, without one, its wish comes anew behind the chain unless a
	 * later change sets the value anyway. Nothing is skipped (M6).
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
					result: true
				};
			}
			const after = await this.#pure((context) => {
				let actions = [...before];
				let again = false;
				const ops = opsOf(actions);
				for (const [feature] of intentOf(original)) {
					const own = (entry: KeptAction) => entry.undoes === original.op;
					const later = actions.some(
						(entry) => !own(entry) && intentOf(entry).has(feature) && isWill(entry, ops)
					);
					if (later) continue;
					const backs = actions.filter((entry) => own(entry) && writesOf(entry).has(feature));
					for (const back of backs) {
						if (isFree(back)) {
							actions = replacedBy(actions, back.op, inverseOf(back, context.fresh()));
						} else if (mayBeThere(back)) {
							actions = replaced(actions, { ...back, discarded: true });
						}
					}
					if (backs.length === 0) again = true;
				}
				if (again) actions = [...actions, restoreAs(actions, original, context.fresh())];
				return settleChains(actions, context);
			});
			return { after, result: true };
		});
	}

	/** "Rückgängig" after "Verwerfen" of a take-back: the changes it takes back are discarded again. */
	#discardAgain(ops: readonly string[]): Promise<void> {
		const first = this.#find(ops[0] ?? '');
		if (first === undefined) return Promise.resolve();
		return this.#undoing(first, async (before) => {
			const again = (entry: KeptAction) => ops.includes(entry.op) && mayBeThere(entry);
			const after = before.map((entry) =>
				again(entry) ? { ...entry, discarded: true as const } : entry
			);
			return {
				after: await this.#pure((context) => settleChains(after, context)),
				result: true
			};
		});
	}

	/** "Rückgängig" after a take-back turned into its counterpart: the take-back comes back. */
	#turnBack(takeBack: KeptAction, inverse: string): Promise<void> {
		return this.#undoing(takeBack, async (before) => {
			const turned = before.find((entry) => entry.op === inverse);
			if (turned === undefined || !isFree(turned)) return null;
			return {
				after: await this.#pure((context) =>
					settleChains(replacedBy(before, inverse, takeBack), context)
				),
				last: inverse,
				result: true
			};
		});
	}

	/** "Rückgängig" after "Verwerfen" deleted an action: it comes back at its place in the order. */
	#restore(action: KeptAction): Promise<void> {
		return this.#undoing(action, async (before) => {
			if (before.some((entry) => entry.op === action.op)) return null;
			return {
				after: await this.#pure((context) => settleChains([...before, action], context)),
				result: true
			};
		});
	}

	/** "Meine Änderung übernehmen": the same identifier again, now based on the value of the server. */
	async takeMine(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'conflict') return;
		await this.#guard(OFFLINE_INTENTS.takeMine(actionText(action)), () =>
			this.#requeue(op, (current) => {
				if (current.state !== 'conflict') return null;
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
		if (action === undefined || action.state !== 'refused' || isDueAction(action)) return;
		const children =
			choice === 'complete_children' ? [...(this.#sink?.childrenOf?.(ticketOf(action)) ?? [])] : [];
		const childrenBefore = this.#statusesOf(children);
		await this.#guard(OFFLINE_INTENTS.answerChildren(actionText(action)), () =>
			this.#requeue(op, (current) => {
				if (current.state !== 'refused' || isDueAction(current)) return null;
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
	 * this tab never read the device (G3).
	 */
	async clearUser(): Promise<void> {
		if (this.#loaded) {
			await this.#forget(this.#actions.map((action) => action.op));
			return;
		}
		const ops = await this.#opsOfAccount();
		if (ops.length > 0) await this.#storage?.remove(ops);
	}
}

const [getOutboxContext, setOutboxContext, hasOutboxContext] = createContext<OutboxStore>();

/** The outbox of the (app) layout for marks and notices; null outside of it (component tests). */
export function findOutbox(): OutboxStore | null {
	return hasOutboxContext() ? getOutboxContext() : null;
}

export { setOutboxContext };
