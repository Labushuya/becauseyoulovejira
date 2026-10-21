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
// - "Verwerfen" of an action that may have arrived keeps it to the end and lets a counter action
//   take it back behind it; a refusal of the first drops both without a word (OF-3).
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
	changesSomething,
	completionInstead,
	counterOf,
	dueOfServer,
	hasRoom,
	inOrder,
	isDayPlanAction,
	isDueAction,
	isFromTheFuture,
	isStatusAction,
	isWaiting,
	mayHaveArrived,
	newOpId,
	nextToSend,
	nextWakeOf,
	overlayDoneToday,
	overlayDue,
	overlayStatus,
	parseAction,
	planCheckChange,
	planDueChange,
	planStatusChange,
	rebasedBehind,
	requestFields,
	sameAction,
	supportsKind,
	ticketOf,
	verdictOf,
	wishOf,
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
import type { ProblemEntry } from '$lib/domain/problems';
import { isStatus, type Status } from '$lib/domain/status';
import type { CompletionChoice } from '$lib/domain/subtasks';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
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

function withoutSending<A extends KeptAction>(action: A): A {
	const copy = { ...action };
	delete copy.sendingSince;
	return copy;
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
		if (gone.length > 0) await storage.remove(gone);
		if (this.#user !== user) return;
		const before = this.#actions;
		this.#actions = inOrder(mine);
		if (start) await this.#age(this.#now());
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
						...(request.children !== undefined && { children: request.children })
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
						...(request.children !== undefined && { children: request.children })
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
		for (let round = 1; ; round += 1) {
			const planned = plan({ user, op, seq, now, offline: this.offline });
			if (planned.kind === 'none') return unchanged();
			// A full device keeps nothing more; with a connection the change goes as before OF-2 (G4).
			if (planned.kind === 'send') {
				return first(planned.action, hasRoom(this.#actions, planned.action));
			}
			if (planned.kind !== 'cancel' && !hasRoom(this.#actions, planned.action)) {
				throw new OutboxFullError();
			}
			let written: boolean;
			try {
				written = await this.#write(planned);
				// The device changed meanwhile (the worker marked the action, another tab): read it and
				// plan again, so a change never goes into an action that left the device (H1).
				if (!written && round < PLAN_ROUNDS) await this.#read(storage, user, false);
			} catch (error) {
				// The device keeps nothing: nothing was noted, as without the outbox.
				throw new DataError('network', { cause: error });
			}
			if (written) break;
			if (round >= PLAN_ROUNDS) throw new DataError('network');
		}
		this.#runner?.kick();
		return kept();
	}

	/**
	 * Writes the plan of a change that is not sent at once: a new action, or, as a compare-and-swap,
	 * the action it takes the change into or drops. False when that action changed meanwhile.
	 */
	async #write(plan: Exclude<ChangePlan, { kind: 'none' | 'send' }>): Promise<boolean> {
		if (plan.kind === 'queue') {
			await this.#keep(plan.action);
			return true;
		}
		const op = plan.kind === 'cancel' ? plan.op : plan.action.op;
		const before = this.#find(op);
		if (before === undefined) return false;
		return this.#swap(before, plan.kind === 'cancel' ? null : plan.action);
	}

	/**
	 * The first attempt right after the change, kept first, so a closed tab loses nothing; on a full
	 * device (`keep` false) as before OF-2, without keeping it (G4). Resolves to the answer, or null
	 * when there is none and the change stays for later; any answer of the server counts as today
	 * (refused: an error). Only with the account of the action (G3). After an answer the worker looks
	 * for a change that waited behind this one (OF-3).
	 */
	async #sendFirst(action: KeptAction, keep: boolean): Promise<Answer | null> {
		if (!this.#signedIn(action.user)) throw new DataError('session');
		const kept =
			keep &&
			(await this.#keep(action).then(
				() => true,
				() => false
			));
		const result = await this.#attempt(action, true);
		if (result.ok) {
			if (kept) await this.#forget([action.op]).catch(() => undefined);
			this.#runner?.kick();
			return result.value;
		}
		const network = verdictOf(result.failure).result === 'network';
		if (kept && network) {
			await this.#keep(withoutSending({ ...action, state: 'queued', unanswered: true }));
			void this.#connectivity.check();
			return null;
		}
		if (kept) await this.#forget([action.op]).catch(() => undefined);
		if (network) void this.#connectivity.check();
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

	/** Stores an action of the signed-in account (new or changed) and tells the other tabs. */
	async #keep(action: KeptAction): Promise<void> {
		const storage = this.#storage;
		if (storage === null) throw new DataError('network');
		await storage.put(action);
		this.#held(action);
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

	/** Deletes actions and tells the other tabs. */
	async #forget(ops: readonly string[]): Promise<void> {
		if (ops.length === 0) return;
		await this.#storage?.remove(ops);
		this.#gone(ops);
	}

	/**
	 * Waiting actions older than 48 hours, or whose time lies in the future, wait for a decision; an
	 * action from the future names the clock (G4). Those older than 7 days go.
	 */
	async #age(now: number): Promise<void> {
		const { expire, drop } = agedActions(this.#actions, now);
		await this.#forget(drop);
		for (const op of expire) {
			const action = this.#find(op);
			if (action === undefined) continue;
			const clock = isFromTheFuture(action, now);
			const expired = withoutSending({
				...action,
				state: 'expired' as const,
				...(clock && { outcome: { code: CLOCK_CODE, message: OFFLINE_TEXTS.clockHint } })
			});
			await this.#swap(action, expired);
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
		await this.#age(now);
		const next = nextToSend(this.#actions, now);
		const user = this.#user;
		const storage = this.#storage;
		if (next === null || this.#connectivity.offline || user === null || storage === null) {
			return false;
		}
		if (!this.#signedIn(next.user)) return false;
		// Marked as sent before the request, in one transaction with the check that nobody changed
		// it meanwhile; a change of the same ticket then becomes an action of its own (H1).
		const sending: KeptAction = { ...next, state: 'sending', sendingSince: now, sent: true };
		if (!(await this.#swap(next, sending))) {
			this.#swapMisses += 1;
			await this.#read(storage, user, false);
			return this.#swapMisses < SWAP_MISSES;
		}
		this.#swapMisses = 0;
		this.#progress = {
			index: this.#sentInRun + 1,
			count: this.#sentInRun + this.#actions.filter(isWaiting).length
		};
		const result = await this.#attempt(sending, false);
		if (result.ok) {
			await this.#forget([sending.op]);
			this.#sentInRun += 1;
			this.#failing = null;
			await this.#arrived(sending, result.value);
			return true;
		}
		const verdict = verdictOf(result.failure);
		const queued = withoutSending({ ...sending, state: 'queued' as const });
		// An answer of the server: this request reached it, nothing may have arrived unseen (OF-3).
		const answered = { ...queued };
		delete answered.unanswered;
		switch (verdict.result) {
			case 'network':
				await this.#keep({ ...queued, unanswered: true });
				void this.#connectivity.check();
				return false;
			case 'session':
				await this.#keep(queued);
				this.#sink?.sessionEnded();
				return false;
			case 'server': {
				const attempts = next.attempts + 1;
				await this.#keep({
					...answered,
					attempts,
					nextAttemptAt: now + backoffDelay(attempts, this.#random)
				});
				if (attempts >= FAILURES_BEFORE_NOTICE) {
					this.#failing = { problem: problemOf(result.failure) };
				}
				return true;
			}
			case 'arrived':
				await this.#forget([sending.op]);
				this.#sentInRun += 1;
				await this.#reread(ticketOf(sending));
				if (isDayPlanAction(sending)) this.#notifyChecks(null);
				return true;
			case 'conflict':
			case 'refused':
				// "Verwerfen" of it was asked for (OF-3): it changed nothing, so it goes without a word.
				if (sending.discarded === true) {
					await this.#dropDiscarded(sending, verdict.outcome);
					await this.#reread(ticketOf(sending));
					return true;
				}
				this.#problems.set(sending.op, problemOf(result.failure));
				await this.#keep({ ...answered, state: verdict.result, outcome: verdict.outcome });
				await this.#reread(ticketOf(sending));
				return true;
		}
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
		await this.#guard(OFFLINE_INTENTS.retry, async () => {
			for (const action of this.#actions) {
				if (action.state === 'queued' && action.nextAttemptAt > 0) {
					await this.#keep({ ...action, nextAttemptAt: 0 });
				}
			}
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

	/** The waiting actions right behind `op` are based on `state` from now on (G6c). */
	async #rebase(op: string, state: ServerState, skip: readonly string[] = []): Promise<void> {
		for (const next of rebasedBehind(this.#actions, op, state)) {
			if (!skip.includes(next.op)) await this.#keep(next);
		}
	}

	/** Sets or clears "Verwerfen" of the action a counter action takes back (OF-3). */
	async #markDiscarded(op: string | undefined, discarded: boolean): Promise<void> {
		const original = op === undefined ? undefined : this.#find(op);
		if (original === undefined || (original.discarded === true) === discarded) return;
		const next: KeptAction = { ...original };
		if (discarded) next.discarded = true;
		else delete next.discarded;
		await this.#swap(original, next);
	}

	/**
	 * "Verwerfen" of an action that is not under way: it goes, the ticket shows as before, and a flag
	 * offers "Rückgängig" (concept §2.1). A change waiting behind it is based on the last known state
	 * of the server from now on and may go (G6c); a failing storage shows its flag (G6b). One that may
	 * already have arrived is taken back instead (OF-3, `#takeBack`).
	 */
	async discard(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state === 'sending' || action.discarded === true) return;
		await this.#guard(OFFLINE_INTENTS.discard(actionText(action)), async () => {
			if (mayHaveArrived(action)) {
				await this.#takeBack(action, true);
				return;
			}
			// First the ones behind it: they cannot go while it is there.
			await this.#rebase(action.op, this.#serverStateOf(action));
			await this.#forget([op]);
			// A counter action that goes: the action it took back is no longer discarded.
			await this.#markDiscarded(action.undoes, false);
			this.#refreshTicket(ticketOf(action));
			this.#sink?.flags.show({
				tone: 'success',
				title: OFFLINE_TEXTS.discarded(actionText(action)),
				action: { label: OFFLINE_TEXTS.undo, run: () => void this.#restore(action) }
			});
		});
		this.#runner?.kick();
	}

	/**
	 * "Verwerfen" of an action that may already have arrived (OF-3): it stays and is brought to the
	 * end with its identifier, marked as discarded, so a refusal drops it without a word; behind it a
	 * counter action takes it back with the value before, based on its wish, so it overwrites no other
	 * change. Behind a later change of the same chain no counter action is needed: that one decides.
	 * One older than 48 hours goes on without the time of the device. `flag`: the flag says that it
	 * is taken back once there is a connection, with "Rückgängig".
	 */
	async #takeBack(action: KeptAction, flag: boolean): Promise<void> {
		const storage = this.#storage;
		const user = this.#user;
		if (storage === null || user === null) return;
		const behind = this.#actions.some((other) => other.dependsOn.at(-1) === action.op);
		const marked: KeptAction = { ...action, discarded: true };
		if (action.state === 'expired') {
			Object.assign(marked, { state: 'queued', late: true, attempts: 0, nextAttemptAt: 0 });
			delete marked.outcome;
		}
		if (!(await this.#swap(action, marked))) {
			// The worker or another tab changed it meanwhile: the dialog shows how it stands now.
			await this.#read(storage, user, false);
			return;
		}
		let counter: KeptAction | null = null;
		if (!behind && changesSomething(action)) {
			const seq = await storage.nextSeq();
			const context = { user, op: newOpId(this.#fill), seq, now: this.#now(), offline: true };
			counter = counterOf(action, context);
			await this.#keep(counter);
		}
		this.#refreshTicket(ticketOf(action));
		if (!flag) return;
		const text = actionText(action);
		this.#sink?.flags.show({
			tone: 'success',
			title: counter === null ? OFFLINE_TEXTS.discarded(text) : OFFLINE_TEXTS.takenBack(text),
			...(counter !== null && { description: OFFLINE_TEXTS.takenBackHint }),
			action: { label: OFFLINE_TEXTS.undo, run: () => void this.#keepAfterAll(action.op) }
		});
	}

	/**
	 * "Rückgängig" after taking an action back (OF-3): its counter actions go (one that may have
	 * arrived is taken back in turn), and the action is no longer discarded.
	 */
	async #keepAfterAll(op: string): Promise<void> {
		const original = this.#find(op);
		const text = original === undefined ? '' : actionText(original);
		await this.#guard(OFFLINE_INTENTS.restore(text), async () => {
			for (const counter of this.#actions.filter((other) => other.undoes === op)) {
				if (mayHaveArrived(counter)) await this.#takeBack(counter, false);
				else if (counter.state !== 'sending') await this.#swap(counter, null);
			}
			await this.#markDiscarded(op, false);
			if (original !== undefined) this.#refreshTicket(ticketOf(original));
		});
		this.#runner?.kick();
	}

	/**
	 * A discarded action the server refused (OF-3): it changed nothing, so it and its counter actions
	 * go without a word; the changes behind them are based on the state of the server.
	 */
	async #dropDiscarded(action: KeptAction, outcome: ActionOutcome): Promise<void> {
		const counters = this.#actions.filter((other) => other.undoes === action.op);
		const gone = [action.op, ...counters.map((counter) => counter.op)];
		const state = this.#serverStateOf(action, outcome);
		for (const op of gone) await this.#rebase(op, state, gone);
		await this.#forget(gone);
	}

	async #restore(action: KeptAction): Promise<void> {
		if (action.user !== this.#user) return;
		await this.#guard(OFFLINE_INTENTS.restore(actionText(action)), async () => {
			await this.#keep(action);
			await this.#rebase(action.op, wishOf(action));
			await this.#markDiscarded(action.undoes, true);
			this.#refreshTicket(ticketOf(action));
		});
		this.#runner?.kick();
	}

	/** "Meine Änderung übernehmen": the same identifier again, now based on the value of the server. */
	async takeMine(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'conflict') return;
		const actual = action.outcome?.actual;
		let next: KeptAction;
		if (isDueAction(action)) {
			const due = dueOfServer(actual);
			if (due === undefined) return;
			next = { ...action, expected: { due } };
		} else if (!isStatus(actual)) {
			return;
		} else if (isDayPlanAction(action)) {
			next = { ...action, expected: { ...action.expected, status: actual } };
		} else {
			next = { ...action, expected: { status: actual } };
		}
		await this.#guard(OFFLINE_INTENTS.takeMine(actionText(action)), () => this.#requeue(next));
	}

	/** "Trotzdem übertragen" after 48 hours: sent without the time of the device (decision 2). */
	async sendAnyway(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'expired') return;
		await this.#guard(OFFLINE_INTENTS.sendAnyway(actionText(action)), () =>
			this.#requeue({ ...action, late: true })
		);
	}

	/** The answer to the open sub-tasks of a completion: "Trotzdem erledigen" or "… mit erledigen". */
	async answerChildren(op: string, choice: CompletionChoice): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'refused' || isDueAction(action)) return;
		const children =
			choice === 'complete_children' ? [...(this.#sink?.childrenOf?.(ticketOf(action)) ?? [])] : [];
		const next: OutboxAction | DayPlanAction = {
			...action,
			completion: choice,
			...(choice === 'complete_children' ? { children } : {})
		};
		if (choice === 'force') delete next.children;
		await this.#guard(OFFLINE_INTENTS.answerChildren(actionText(action)), () =>
			this.#requeue(next)
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
		await this.#guard(OFFLINE_INTENTS.completeAnyway(actionText(action)), async () => {
			const instead = completionInstead(action, newOpId(this.#fill));
			await this.#keep(instead);
			if (!(await this.#swap(action, null))) {
				await this.#forget([instead.op]);
				return;
			}
			for (const next of this.#actions) {
				if (!next.dependsOn.includes(op)) continue;
				const dependsOn = next.dependsOn.map((entry) => (entry === op ? instead.op : entry));
				await this.#swap(next, { ...next, dependsOn });
			}
			this.#refreshTicket(action.ticket);
		});
		this.#runner?.kick();
	}

	async #requeue(next: KeptAction): Promise<void> {
		const queued: KeptAction = { ...next, state: 'queued', attempts: 0, nextAttemptAt: 0 };
		delete queued.outcome;
		this.#problems.delete(next.op);
		await this.#keep(queued);
		this.#refreshTicket(ticketOf(next));
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
