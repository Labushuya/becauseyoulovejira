// The outbox of the SPA (OF-2, ADR-0074 and its addenda OF-2 and OF-2b; concept OF-0 §3). It keeps
// single changes of the status of a ticket that could not reach the server and sends them later over
// the normal way (data layer → Record API → hooks), with the identifier of the action, the time of
// the device and the value before. Never a copy of data: the stores keep the state of the server,
// the outbox lays its waiting actions over it (`apply`) and marks the tickets (`markOf`).
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
//   each other, in one tab or across tabs.
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
import { DataError, problemOf, toDataError, withIntent } from '$lib/data/errors';
import {
	CLOCK_CODE,
	FAILURES_BEFORE_NOTICE,
	OFFLINE_INTENTS,
	OFFLINE_TEXTS,
	SEND_TIMEOUT_MS,
	actionText,
	agedActions,
	backoffDelay,
	hasRoom,
	inOrder,
	isFromTheFuture,
	isWaiting,
	newOpId,
	nextToSend,
	nextWakeOf,
	overlayStatus,
	parseAction,
	planStatusChange,
	rebasedBehind,
	requestFields,
	sameAction,
	supportsKind,
	verdictOf,
	type ChangePlan,
	type OfflineOps,
	type OutboxAction,
	type OutboxFields
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

/** What the outbox needs from the app; tests pass fakes. */
export interface OutboxDeps {
	/** The storage of the device; null without IndexedDB (the outbox then never works). */
	storage: OutboxStorage | null;
	/** Whether the device already has the storage, without creating it (`indexedDB.databases()`). */
	exists?: () => Promise<boolean>;
	connectivity: ConnectivityStore;
	/** Sends the status of `action` over the Record API with the fields of the outbox. */
	send(action: OutboxAction, fields: OutboxFields, signal: AbortSignal): Promise<Ticket>;
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

/** The mark of a ticket: a change not sent yet, or one that waits for a decision. */
export type OutboxMark = 'pending' | 'decision' | null;

type Attempt = { ok: true; ticket: Ticket } | { ok: false; failure: DataError };

function withoutSending(action: OutboxAction): OutboxAction {
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
	#actions = $state.raw<readonly OutboxAction[]>([]);
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
	get actions(): readonly OutboxAction[] {
		return this.#actions;
	}

	get count(): number {
		return this.#actions.length;
	}

	/** Actions that wait for the connection or are under way. */
	get waiting(): readonly OutboxAction[] {
		return this.#actions.filter(isWaiting);
	}

	get conflicts(): readonly OutboxAction[] {
		return this.#actions.filter((action) => action.state === 'conflict');
	}

	get refusals(): readonly OutboxAction[] {
		return this.#actions.filter((action) => action.state === 'refused');
	}

	get expired(): readonly OutboxAction[] {
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
	 * Whether a change of this ticket goes through the outbox: armed, or, outside of the frame, a
	 * change of the ticket waits to be sent and asks for the order (G2). Behind one that waits for a
	 * decision a change goes the way of before OF-2.
	 */
	routes(id: string): boolean {
		if (this.armed) return true;
		if (!this.#canSend || !this.#loaded) return false;
		return this.#actions.some((action) => action.target === id && isWaiting(action));
	}

	/** The mark of a ticket for rows, cards, the panel and the sub-tasks. */
	markOf(id: string): OutboxMark {
		let mark: OutboxMark = null;
		for (const action of this.#actions) {
			const child =
				action.completion === 'complete_children' && action.children?.includes(id) === true;
			if (action.target !== id && !child) continue;
			if (isWaiting(action)) return 'pending';
			if (action.target === id) mark = 'decision';
		}
		return mark;
	}

	/** A change of this ticket waits to be sent. */
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
		const mine: OutboxAction[] = [];
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
	#refreshChanged(before: readonly OutboxAction[], after: readonly OutboxAction[]): void {
		const key = (actions: readonly OutboxAction[], target: string) =>
			JSON.stringify(actions.filter((action) => action.target === target));
		const targets = new SvelteSet([...before, ...after].map((action) => action.target));
		for (const target of targets) {
			if (key(before, target) === key(after, target)) continue;
			const base = this.#base.get(target);
			if (base !== undefined) this.#sink?.upsert(base);
		}
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

	/**
	 * The ticket as the stores show it: the state of the server with the waiting actions laid over
	 * it. Called by the stores for every ticket they take in; without an action the ticket itself.
	 */
	apply<T extends TicketSummary>(ticket: T): T {
		this.#remember(ticket);
		if (this.#actions.length === 0) return ticket;
		const shown = overlayStatus(ticket, this.#actions);
		if (shown !== ticket) this.#provisional.add(shown);
		return shown;
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

	#shown<T extends TicketSummary>(base: T): T {
		const shown = overlayStatus(base, this.#actions);
		if (shown !== base) this.#provisional.add(shown);
		return shown;
	}

	// ----- changes -----

	/**
	 * A change of the status of `ticket` (as the store shows it). Resolves to the answer of the
	 * server, or to the ticket with the kept change laid over it; rejects like the data layer when
	 * the server refuses (the store shows its message as today).
	 */
	async changeStatus<T extends TicketSummary>(ticket: T, request: StatusRequest): Promise<T> {
		const storage = this.#storage;
		const user = this.#user;
		if (storage === null || user === null) throw new DataError('session');
		await this.#loading?.catch(() => undefined);
		const open = this.#actions.filter((action) => action.target === ticket.id);
		const known = this.#base.get(ticket.id);
		const base = (open.length > 0 && known !== undefined ? known : ticket) as T;
		this.#remember(base);
		// A storage that fails keeps nothing: a change with a connection then goes as today.
		const seq = await storage.nextSeq().catch(() => 0);
		const op = newOpId(this.#fill);
		const now = this.#now();
		for (let round = 1; ; round += 1) {
			const plan = planStatusChange(
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
				{ user, op, seq, now, offline: this.offline }
			);
			if (plan.kind === 'none') return ticket;
			// A full device keeps nothing more; with a connection the change goes as before OF-2 (G4).
			if (plan.kind === 'send') {
				return this.#sendFirst(plan.action, base, hasRoom(this.#actions, plan.action));
			}
			if (plan.kind !== 'cancel' && !hasRoom(this.#actions, plan.action)) {
				throw new OutboxFullError();
			}
			let written: boolean;
			try {
				written = await this.#write(plan);
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
		return this.#shown(base);
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
	 * device (`keep` false) as before OF-2, without keeping it (G4). Without an answer it stays for
	 * later; any answer of the server counts as today (refused: an error). Only with the account of
	 * the action (G3).
	 */
	async #sendFirst<T extends TicketSummary>(
		action: OutboxAction,
		base: T,
		keep: boolean
	): Promise<T> {
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
			return this.apply(result.ticket as unknown as T);
		}
		const network = verdictOf(result.failure).result === 'network';
		if (kept && network) {
			await this.#keep(withoutSending({ ...action, state: 'queued' }));
			void this.#connectivity.check();
			return this.#shown(base);
		}
		if (kept) await this.#forget([action.op]).catch(() => undefined);
		if (network) void this.#connectivity.check();
		throw result.failure;
	}

	async #attempt(action: OutboxAction, first: boolean): Promise<Attempt> {
		const controller = new AbortController();
		const limit = this.#timers.set(() => controller.abort(), SEND_TIMEOUT_MS);
		const send = () => this.#deps.send(action, requestFields(action, first), controller.signal);
		try {
			// A kept change names what it was for in "Details" (ADR-0071 §3).
			const ticket = first
				? await send()
				: await withIntent(`Gemerkte Änderung übertragen: ${actionText(action)}`, send);
			return { ok: true, ticket };
		} catch (error) {
			return { ok: false, failure: toDataError(error, controller.signal) };
		} finally {
			this.#timers.clear(limit);
		}
	}

	/** Takes a stored or changed action of the signed-in account in and tells the other tabs. */
	#held(action: OutboxAction): void {
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
	async #keep(action: OutboxAction): Promise<void> {
		const storage = this.#storage;
		if (storage === null) throw new DataError('network');
		await storage.put(action);
		this.#held(action);
	}

	/**
	 * Replaces `before` by `next` (deletes it for null), but only while the device still holds it as
	 * it is (OF-2b); false when another step or tab changed it meanwhile.
	 */
	async #swap(before: OutboxAction, next: OutboxAction | null): Promise<boolean> {
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
				state: 'expired',
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
		const sending: OutboxAction = { ...next, state: 'sending', sendingSince: now, sent: true };
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
			this.#remember(result.ticket);
			this.#sink?.upsert(result.ticket);
			return true;
		}
		const verdict = verdictOf(result.failure);
		const queued = withoutSending({ ...sending, state: 'queued' });
		switch (verdict.result) {
			case 'network':
				await this.#keep(queued);
				void this.#connectivity.check();
				return false;
			case 'session':
				await this.#keep(queued);
				this.#sink?.sessionEnded();
				return false;
			case 'server': {
				const attempts = next.attempts + 1;
				await this.#keep({
					...queued,
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
				await this.#reread(sending.target);
				return true;
			case 'conflict':
			case 'refused':
				this.#problems.set(sending.op, problemOf(result.failure));
				await this.#keep({ ...queued, state: verdict.result, outcome: verdict.outcome });
				await this.#reread(sending.target);
				return true;
		}
	}

	/** Shows the ticket as the server has it now; without an answer as it was before. */
	async #reread(id: string): Promise<void> {
		try {
			const ticket = await this.#deps.get(id);
			this.#remember(ticket);
			this.#sink?.upsert(ticket);
		} catch {
			const base = this.#base.get(id);
			if (base !== undefined) this.#sink?.upsert(base);
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

	#find(op: string): OutboxAction | undefined {
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

	/** The last known state of the server behind an action: of its conflict, else as last seen. */
	#serverStatusOf(action: OutboxAction): Status | null {
		const actual = action.outcome?.actual;
		if (isStatus(actual)) return actual;
		return this.#base.get(action.target)?.status ?? null;
	}

	/** The waiting actions right behind `op` are based on `status` from now on (G6c). */
	async #rebase(op: string, status: Status | null): Promise<void> {
		if (status === null) return;
		for (const next of rebasedBehind(this.#actions, op, status)) await this.#keep(next);
	}

	/**
	 * "Verwerfen" of an action that is not under way: it goes, the ticket shows as before, and a flag
	 * offers "Rückgängig" (concept §2.1). A change waiting behind it is based on the last known state
	 * of the server from now on and may go (G6c); a failing storage shows its flag (G6b).
	 */
	async discard(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state === 'sending') return;
		await this.#guard(OFFLINE_INTENTS.discard(actionText(action)), async () => {
			// First the ones behind it: they cannot go while it is there.
			await this.#rebase(action.op, this.#serverStatusOf(action));
			await this.#forget([op]);
			const base = this.#base.get(action.target);
			if (base !== undefined) this.#sink?.upsert(base);
			this.#sink?.flags.show({
				tone: 'success',
				title: OFFLINE_TEXTS.discarded(actionText(action)),
				action: { label: OFFLINE_TEXTS.undo, run: () => void this.#restore(action) }
			});
		});
		this.#runner?.kick();
	}

	async #restore(action: OutboxAction): Promise<void> {
		if (action.user !== this.#user) return;
		await this.#guard(OFFLINE_INTENTS.restore(actionText(action)), async () => {
			await this.#keep(action);
			await this.#rebase(action.op, action.payload.status);
			const base = this.#base.get(action.target);
			if (base !== undefined) this.#sink?.upsert(base);
		});
		this.#runner?.kick();
	}

	/** "Meine Änderung übernehmen": the same identifier again, now based on the value of the server. */
	async takeMine(op: string): Promise<void> {
		const action = this.#find(op);
		const actual = action?.outcome?.actual;
		if (action === undefined || action.state !== 'conflict' || !isStatus(actual)) return;
		await this.#guard(OFFLINE_INTENTS.takeMine(actionText(action)), () =>
			this.#requeue(action, { expected: { status: actual } })
		);
	}

	/** "Trotzdem übertragen" after 48 hours: sent without the time of the device (decision 2). */
	async sendAnyway(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'expired') return;
		await this.#guard(OFFLINE_INTENTS.sendAnyway(actionText(action)), () =>
			this.#requeue(action, { late: true })
		);
	}

	/** The answer to the open sub-tasks of a completion: "Trotzdem erledigen" or "… mit erledigen". */
	async answerChildren(op: string, choice: CompletionChoice): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'refused') return;
		const children =
			choice === 'complete_children' ? [...(this.#sink?.childrenOf?.(action.target) ?? [])] : [];
		await this.#guard(OFFLINE_INTENTS.answerChildren(actionText(action)), () =>
			this.#requeue(action, {
				completion: choice,
				...(choice === 'complete_children' ? { children } : {})
			})
		);
	}

	async #requeue(action: OutboxAction, change: Partial<OutboxAction>): Promise<void> {
		const next: OutboxAction = {
			...action,
			...change,
			state: 'queued',
			attempts: 0,
			nextAttemptAt: 0
		};
		delete next.outcome;
		if (change.completion === 'force') delete next.children;
		this.#problems.delete(action.op);
		await this.#keep(next);
		const base = this.#base.get(action.target);
		if (base !== undefined) this.#sink?.upsert(base);
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
