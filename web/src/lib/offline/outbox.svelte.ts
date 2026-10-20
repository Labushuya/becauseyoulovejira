// The outbox of the SPA (OF-2, ADR-0074 and its addendum OF-2; concept OF-0 §3). It keeps single
// changes of the status of a ticket that could not reach the server and sends them later over the
// normal way (data layer → Record API → hooks), with the identifier of the action, the time of the
// device and the value before. Never a copy of data: the stores keep the state of the server, the
// outbox lays its waiting actions over it (`apply`) and marks the tickets (`markOf`).
//
// - It works only while the server reports `offline_ops` and the phone frame applies (switch
//   "Handy-Ansicht (Vorschau)" on and a narrow window, `setFrame`). Otherwise every change goes the
//   way of today, without identifier, time limit or notice. Actions kept in the frame are still sent
//   and shown when the frame no longer applies (the phone turned), so nothing hangs.
// - A change with a connection is sent at once, with its identifier only (the result and the
//   messages stay the ones of today); only when the answer does not come (no connection, 12 s
//   limit) it stays in the outbox, and the store gets the value as a provisional answer.
// - The actions belong to the signed-in account: another account never sends them, and they are
//   deleted when another account signs in (decision of the user 4). "Abmelden" deletes them after
//   the question (`clearUser`); an ended session keeps them.
// - One tab sends (OutboxRunner with the lease of the device); the BroadcastChannel "byl-outbox"
//   tells the other tabs to read the device again.

import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { DataError, problemOf, toDataError, withIntent } from '$lib/data/errors';
import {
	FAILURES_BEFORE_NOTICE,
	OFFLINE_TEXTS,
	SEND_TIMEOUT_MS,
	actionText,
	agedActions,
	backoffDelay,
	hasRoom,
	inOrder,
	isWaiting,
	newOpId,
	nextToSend,
	nextWakeOf,
	overlayStatus,
	parseAction,
	planStatusChange,
	requestFields,
	supportsKind,
	verdictOf,
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
	/** The identifier of this tab. */
	tab: string;
	now?: () => number;
	random?: () => number;
	fill?: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;
	timers?: Timers;
	channel?: OutboxChannel | null;
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
	readonly #channel: OutboxChannel | null;

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
		this.#channel = deps.channel ?? null;
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

	/** Whether a change of this ticket goes through the outbox (armed, or it has actions waiting). */
	routes(id: string): boolean {
		if (this.armed) return true;
		return this.#canSend && this.#loaded && this.#actions.some((action) => action.target === id);
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

	#watch(): void {
		const storage = this.#storage;
		if (storage === null) return;
		const stops: (() => void)[] = [];
		stops.push(this.#connectivity.start(this.#deps.win ?? null));
		this.#deps.observe?.((outcome) => this.#connectivity.note(outcome));
		stops.push(() => this.#deps.observe?.(null));
		this.#deps.watchRealtime?.(() => void this.#connectivity.check());
		stops.push(() => this.#deps.watchRealtime?.(null));
		const runner = new OutboxRunner({
			storage,
			tab: this.#deps.tab,
			now: this.#now,
			timers: this.#timers,
			ready: () => this.#ready(),
			step: () => this.#step(),
			settled: () => this.#settled()
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
			if (this.#user === user) void this.#read(storage, user, false).then(() => this.#update());
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
			{ user, op: newOpId(this.#fill), seq, now: this.#now(), offline: this.offline }
		);
		if (plan.kind === 'none') return ticket;
		if (plan.kind === 'send') {
			if (!hasRoom(this.#actions, plan.action)) throw new OutboxFullError();
			return this.#sendFirst(plan.action, base);
		}
		if (plan.kind !== 'cancel' && !hasRoom(this.#actions, plan.action)) {
			throw new OutboxFullError();
		}
		try {
			if (plan.kind === 'cancel') await this.#forget([plan.op]);
			else await this.#keep(plan.action);
		} catch (error) {
			// The device keeps nothing: nothing was noted, as without the outbox.
			throw new DataError('network', { cause: error });
		}
		this.#runner?.kick();
		return this.#shown(base);
	}

	/**
	 * The first attempt right after the change, kept first, so a closed tab loses nothing. Without an
	 * answer it stays for later; any answer of the server counts as today (refused: an error).
	 */
	async #sendFirst<T extends TicketSummary>(action: OutboxAction, base: T): Promise<T> {
		const kept = await this.#keep(action).then(
			() => true,
			() => false
		);
		const result = await this.#attempt(action, true);
		if (result.ok) {
			if (kept) await this.#forget([action.op]).catch(() => undefined);
			return this.apply(result.ticket as unknown as T);
		}
		if (kept && verdictOf(result.failure).result === 'network') {
			await this.#keep(withoutSending({ ...action, state: 'queued' }));
			void this.#connectivity.check();
			return this.#shown(base);
		}
		if (kept) await this.#forget([action.op]).catch(() => undefined);
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

	/** Stores an action of the signed-in account (new or changed) and tells the other tabs. */
	async #keep(action: OutboxAction): Promise<void> {
		const storage = this.#storage;
		if (storage === null) throw new DataError('network');
		await storage.put(action);
		if (action.user !== this.#user) return;
		const rest = this.#actions.filter((entry) => entry.op !== action.op);
		this.#actions = inOrder([...rest, action]);
		this.#post();
		this.#update();
	}

	/** Deletes actions and tells the other tabs. */
	async #forget(ops: readonly string[]): Promise<void> {
		if (ops.length === 0) return;
		await this.#storage?.remove(ops);
		this.#actions = this.#actions.filter((action) => !ops.includes(action.op));
		for (const op of ops) this.#problems.delete(op);
		this.#post();
		this.#update();
	}

	async #age(now: number): Promise<void> {
		const { expire, drop } = agedActions(this.#actions, now);
		await this.#forget(drop);
		for (const op of expire) {
			const action = this.#actions.find((entry) => entry.op === op);
			if (action !== undefined) await this.#keep({ ...action, state: 'expired' });
		}
	}

	// ----- the worker -----

	#ready(): boolean {
		return (
			this.#canSend &&
			this.#loaded &&
			!this.#connectivity.offline &&
			nextToSend(this.#actions, this.#now()) !== null
		);
	}

	async #step(): Promise<boolean> {
		const now = this.#now();
		await this.#age(now);
		const next = nextToSend(this.#actions, now);
		if (next === null || this.#connectivity.offline || this.#user === null) return false;
		const sending: OutboxAction = { ...next, state: 'sending', sendingSince: now };
		await this.#keep(sending);
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
		for (const action of this.#actions) {
			if (action.state === 'queued' && action.nextAttemptAt > 0) {
				await this.#keep({ ...action, nextAttemptAt: 0 });
			}
		}
		await this.#connectivity.check();
		this.#runner?.kick();
	}

	/**
	 * "Verwerfen" of an action that is not under way: it goes, the ticket shows as before, and a flag
	 * offers "Rückgängig" (concept §2.1).
	 */
	async discard(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state === 'sending') return;
		await this.#forget([op]);
		const base = this.#base.get(action.target);
		if (base !== undefined) this.#sink?.upsert(base);
		this.#sink?.flags.show({
			tone: 'success',
			title: OFFLINE_TEXTS.discarded(actionText(action)),
			action: { label: OFFLINE_TEXTS.undo, run: () => void this.#restore(action) }
		});
	}

	async #restore(action: OutboxAction): Promise<void> {
		if (action.user !== this.#user) return;
		await this.#keep(action);
		const base = this.#base.get(action.target);
		if (base !== undefined) this.#sink?.upsert(base);
		this.#runner?.kick();
	}

	/** "Meine Änderung übernehmen": the same identifier again, now based on the value of the server. */
	async takeMine(op: string): Promise<void> {
		const action = this.#find(op);
		const actual = action?.outcome?.actual;
		if (action === undefined || action.state !== 'conflict' || !isStatus(actual)) return;
		await this.#requeue(action, { expected: { status: actual } });
	}

	/** "Trotzdem übertragen" after 48 hours: sent without the time of the device (decision 2). */
	async sendAnyway(op: string): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'expired') return;
		await this.#requeue(action, { late: true });
	}

	/** The answer to the open sub-tasks of a completion: "Trotzdem erledigen" or "… mit erledigen". */
	async answerChildren(op: string, choice: CompletionChoice): Promise<void> {
		const action = this.#find(op);
		if (action === undefined || action.state !== 'refused') return;
		const children =
			choice === 'complete_children' ? [...(this.#sink?.childrenOf?.(action.target) ?? [])] : [];
		await this.#requeue(action, {
			completion: choice,
			...(choice === 'complete_children' ? { children } : {})
		});
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

	/** "Abmelden und verwerfen": every action of the signed-in account goes (decision 4). */
	async clearUser(): Promise<void> {
		const ops = this.#actions.map((action) => action.op);
		await this.#forget(ops);
	}
}

const [getOutboxContext, setOutboxContext, hasOutboxContext] = createContext<OutboxStore>();

/** The outbox of the (app) layout for marks and notices; null outside of it (component tests). */
export function findOutbox(): OutboxStore | null {
	return hasOutboxContext() ? getOutboxContext() : null;
}

export { setOutboxContext };
