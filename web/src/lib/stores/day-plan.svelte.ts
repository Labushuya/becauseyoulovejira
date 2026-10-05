// The day plan of a view (TP-1, ADR-0065): the plan of the area of the tab and the shown day, its
// entries with their tickets, the suggestions and the pool. One store per layout of /tagesplan.
//
// - The plan comes from GET /api/byl/dayplan (today and tomorrow lazily created, today with the
//   automatic sources taken in), its entries through the Record API with their tickets; realtime keeps
//   the entries, the plan (`dismissed`) and the settings of the sources (PL-1) current for every
//   member of the area, the tickets come live from the subscription of the tickets of the area.
// - Suggestions and pool are computed here from the live open tickets of the list store, with the same
//   rules as the server (domain/day-plan.ts): a ticket that becomes due, overdue or an ongoing project
//   is suggested at once. When a ticket of an automatic source appears, the plan is asked for again, and
//   the server takes it in (idempotent).
// - Every change goes through a route; the answer is applied at once, realtime brings the same again
//   (idempotent by `updated`). Results and "Rückgängig" go out as flags, failures as error flags.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import {
	addToDayPlan,
	adoptIntoDayPlan,
	checkDayPlanItem,
	fetchDayPlan,
	listDayPlanItems,
	moveDayPlanItem,
	moveDayPlanItemToTomorrow,
	removeDayPlanItem,
	saveDayPlanSettings,
	subscribeDayPlan,
	subscribeDayPlanItems,
	subscribeDayPlanSettings,
	uncheckDayPlanItem,
	type AddAnswer,
	type CheckedTicket,
	type DayPlanAnswer,
	type DayPlanItem,
	type DayPlanMeta,
	type DayPlanResult,
	type DayPlanSettingsRecord,
	type OtherAreaPlan
} from '$lib/data/day-plan';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { RecordChange, Unsubscribe } from '$lib/data/realtime';
import { updateTicket } from '$lib/data/tickets';
import { addDays, type CalendarDate } from '$lib/domain/berlin-date';
import {
	DAY_PLAN_SOURCES,
	DEFAULT_SOURCES,
	isDone,
	kindOf,
	moved,
	seriesKeyOf,
	suggestionsOf,
	type CheckAction,
	type CheckMode,
	type DayPlanSettings,
	type DayPlanSource,
	type PlanTicketFacts,
	type SourceMode,
	type Suggestion,
	type TicketKind
} from '$lib/domain/day-plan';
import type { Status } from '$lib/domain/status';
import type { CompletionChoice } from '$lib/domain/subtasks';
import type { TicketSummary } from '$lib/domain/ticket';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type LiveSource } from './realtime';
import {
	openChildrenOf,
	type CompletionQuestion,
	type LoadState,
	type SessionGuard
} from './ticket-list.svelte';

/** Pause before the plan is asked for again after a ticket of an automatic source appeared. */
export const AUTO_SYNC_DELAY_MS = 400;

/** Data access of the plan; tests pass a fake, the app binds the data layer to its client. */
export interface DayPlanData {
	fetch(
		query: { scope: string | null; date: CalendarDate | null },
		options: RequestOptions
	): Promise<DayPlanResult<DayPlanAnswer>>;
	listItems(planId: string, options: RequestOptions): Promise<DayPlanItem[]>;
	add(input: {
		ticket: string;
		scope?: string;
		date?: CalendarDate;
		index?: number;
	}): Promise<AddAnswer>;
	adopt(
		scope: string,
		tickets: readonly string[]
	): Promise<{ items: DayPlanItem[]; plan: DayPlanMeta }>;
	check(
		id: string,
		mode: CheckMode,
		completion: CompletionChoice | null
	): Promise<{ item: DayPlanItem; ticket: CheckedTicket; action: CheckAction }>;
	uncheck(
		id: string,
		input: { action?: CheckAction; status?: Status }
	): Promise<{ item: DayPlanItem; ticket: CheckedTicket }>;
	tomorrow(id: string): Promise<{ item: DayPlanItem; plan: DayPlanMeta }>;
	remove(id: string): Promise<{ plan: DayPlanMeta }>;
	move(id: string, index: number): Promise<{ id: string; position: number }[]>;
	saveSettings(
		scope: string,
		sources: Partial<Record<DayPlanSource, SourceMode>>
	): Promise<DayPlanSettings>;
	setKind(ticketId: string, kind: TicketKind): Promise<TicketSummary>;
}

export function dayPlanData(pb: PocketBase): DayPlanData {
	return {
		fetch: (query, options) => fetchDayPlan(pb, query, options),
		listItems: (planId, options) => listDayPlanItems(pb, planId, options),
		add: (input) => addToDayPlan(pb, input),
		adopt: (scope, tickets) => adoptIntoDayPlan(pb, scope, tickets),
		check: (id, mode, completion) => checkDayPlanItem(pb, id, mode, completion),
		uncheck: (id, input) => uncheckDayPlanItem(pb, id, input),
		tomorrow: (id) => moveDayPlanItemToTomorrow(pb, id),
		remove: (id) => removeDayPlanItem(pb, id),
		move: (id, index) => moveDayPlanItem(pb, id, index),
		saveSettings: (scope, sources) => saveDayPlanSettings(pb, scope, sources),
		setKind: (ticketId, kind) => updateTicket(pb, ticketId, { kind })
	};
}

/** Realtime of one plan: its entries, the plan itself and the settings of its area. */
export interface DayPlanLive {
	items(
		planId: string,
		onChange: (change: RecordChange<DayPlanItem>) => void
	): Promise<Unsubscribe>;
	plan(planId: string, onChange: (change: RecordChange<DayPlanMeta>) => void): Promise<Unsubscribe>;
	settings(
		scope: string,
		onChange: (change: RecordChange<DayPlanSettingsRecord>) => void
	): Promise<Unsubscribe>;
}

export function dayPlanLive(pb: PocketBase): DayPlanLive {
	return {
		items: (planId, onChange) => subscribeDayPlanItems(pb, planId, onChange),
		plan: (planId, onChange) => subscribeDayPlan(pb, planId, onChange),
		settings: (scope, onChange) => subscribeDayPlanSettings(pb, scope, onChange)
	};
}

/** What the plan needs of the tickets of the area: the list store of the layout. */
export interface DayPlanTickets {
	/** Every open ticket of the area, live. */
	readonly open: readonly TicketSummary[];
	/** Today in Berlin, the clock of the list. */
	readonly today: CalendarDate;
	find(id: string): TicketSummary | null;
	upsert(ticket: TicketSummary): void;
}

/** An entry with its ticket as the plan shows it. */
export interface PlanRow {
	item: DayPlanItem;
	/** Null while the ticket is not visible (another tab moved it away). */
	ticket: TicketSummary | null;
	kind: TicketKind;
	/** Checked for the day or its ticket is done. */
	done: boolean;
}

/** A suggestion with its ticket. */
export interface SuggestionRow {
	suggestion: Suggestion;
	ticket: TicketSummary;
}

/** The area of the tab; null without one (the private area of the account). */
export type AreaScope = () => string | null;

/** What the rules need of a ticket. */
export function factsOf(ticket: TicketSummary): PlanTicketFacts {
	return {
		id: ticket.id,
		status: ticket.status,
		due: ticket.due ?? '',
		kind: kindOf(ticket.kind),
		recurring: ticket.recurring,
		series: seriesKeyOf(ticket.recurrenceId, ticket.occurrence),
		priority: ticket.priority,
		created: ticket.created
	};
}

/** The newer of two states of a ticket by `updated`. */
function newer(a: TicketSummary | null, b: TicketSummary | null): TicketSummary | null {
	if (a === null) return b;
	if (b === null) return a;
	return b.updated > a.updated ? b : a;
}

function sameItems(a: DayPlanItem, b: DayPlanItem): boolean {
	return a.updated === b.updated && a.position === b.position;
}

export class DayPlanStore {
	readonly #data: DayPlanData;
	readonly #tickets: DayPlanTickets;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #scope: AreaScope;

	/** The shown day; null follows today. */
	#date = $state<CalendarDate | null>(null);
	#state = $state<LoadState | 'missing'>('idle');
	#error = $state<string | null>(null);
	#answer = $state.raw<DayPlanAnswer | null>(null);
	#plan = $state.raw<DayPlanMeta | null>(null);
	readonly #items = new SvelteMap<string, DayPlanItem>();
	/** Tickets of the entries as the plan last saw them (expanded, from events), by ID. */
	readonly #snapshots = new SvelteMap<string, TicketSummary>();
	readonly #pending = new SvelteSet<string>();
	#completion = $state<(CompletionQuestion & { itemId: string }) | null>(null);
	#completing = $state(false);
	#completionError = $state<string | null>(null);
	#announcement = $state('');
	#settingsSaving = $state(false);
	#controller: AbortController | null = null;
	#live: DayPlanLive | null = null;
	#stopPlan: (() => void) | null = null;
	#followedPlan: string | null = null;
	/** Automatic tickets the plan was asked about already, so a refused one asks only once. */
	readonly #synced = new SvelteSet<string>();
	#syncTimer: ReturnType<typeof setTimeout> | undefined;

	#ordered = $derived(
		[...this.#items.values()].sort(
			(a, b) =>
				a.position - b.position ||
				(a.created < b.created ? -1 : a.created > b.created ? 1 : 0) ||
				(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
		)
	);

	#rows = $derived(
		this.#ordered.map((item): PlanRow => {
			const ticket = newer(
				this.#snapshots.get(item.ticketId) ?? item.ticket,
				this.#tickets.find(item.ticketId)
			);
			return {
				item,
				ticket,
				kind: kindOf(ticket?.kind),
				done: isDone(item.doneToday, ticket?.status ?? '')
			};
		})
	);

	/** Ticket IDs in the plan. */
	#planned = $derived(this.#ordered.map((item) => item.ticketId));

	/** Live suggestions of today, by the rules of the server, from the open tickets of the list. */
	#suggestions = $derived.by((): Suggestion[] => {
		const answer = this.#answer;
		const plan = this.#plan;
		if (answer === null || plan === null || answer.date !== answer.today) return [];
		return suggestionsOf(this.#tickets.open.map(factsOf), {
			today: answer.today,
			settings: answer.settings,
			planned: this.#planned,
			dismissed: plan.dismissed,
			leftover: answer.leftover
		});
	});

	constructor(
		data: DayPlanData,
		tickets: DayPlanTickets,
		session: SessionGuard,
		{ flags = SILENT_FLAGS, scope = () => null }: { flags?: FlagSink; scope?: AreaScope } = {}
	) {
		this.#data = data;
		this.#tickets = tickets;
		this.#session = session;
		this.#flags = flags;
		this.#scope = scope;
	}

	// --- State -----------------------------------------------------------------------------------

	get state(): LoadState | 'missing' {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/** The shown day (today while no other is chosen). */
	get date(): CalendarDate {
		return this.#date ?? this.today;
	}

	get today(): CalendarDate {
		return this.#answer?.today ?? this.#tickets.today;
	}

	get tomorrow(): CalendarDate {
		return addDays(this.today, 1);
	}

	/** Today and tomorrow can change; days before are read-only. */
	get editable(): boolean {
		return this.#answer?.editable ?? false;
	}

	get isToday(): boolean {
		return this.date === this.today;
	}

	/** The plan exists (a day before may have none). */
	get plan(): DayPlanMeta | null {
		return this.#plan;
	}

	get rows(): readonly PlanRow[] {
		return this.#rows;
	}

	get progress(): { done: number; total: number } {
		return { done: this.#rows.filter((row) => row.done).length, total: this.#rows.length };
	}

	/** The suggestions with mode "vorschlagen" (the automatic ones go into the plan by themselves). */
	get suggestions(): readonly SuggestionRow[] {
		const rows: SuggestionRow[] = [];
		for (const suggestion of this.#suggestions) {
			if (suggestion.mode !== 'suggest') continue;
			const ticket = this.#tickets.find(suggestion.id);
			if (ticket !== null) rows.push({ suggestion, ticket });
		}
		return rows;
	}

	/** Tickets of automatic sources that are not in the plan of today yet (the server takes them in). */
	get automatic(): readonly string[] {
		return this.#suggestions.filter((entry) => entry.mode === 'auto').map((entry) => entry.id);
	}

	/** The open tickets of the area that are not in the plan, in the default order of the list. */
	get pool(): readonly TicketSummary[] {
		const planned = this.#planned;
		return this.#tickets.open.filter((ticket) => !planned.includes(ticket.id));
	}

	get settings(): DayPlanSettings {
		return this.#answer?.settings ?? DEFAULT_SOURCES;
	}

	get settingsSaving(): boolean {
		return this.#settingsSaving;
	}

	/** The plan of today of the other area of the account (how many entries only). */
	get other(): OtherAreaPlan | null {
		return this.#answer?.other ?? null;
	}

	/** Polite message for screen readers after an action. */
	get announcement(): string {
		return this.#announcement;
	}

	isPending(id: string): boolean {
		return this.#pending.has(id);
	}

	/** The question before completing a ticket with open blocking sub-tasks (ADR-0033 section 2). */
	get completion(): CompletionQuestion | null {
		return this.#completion;
	}

	get completing(): boolean {
		return this.#completing;
	}

	get completionError(): string | null {
		return this.#completionError;
	}

	// --- Loading ---------------------------------------------------------------------------------

	/** Shows the plan of `date` (null: today); the same day keeps what is loaded. */
	show(date: CalendarDate | null): void {
		if (this.#state !== 'idle' && date === this.#date) return;
		this.#date = date;
		void this.#load();
	}

	/** Loads the shown day again ("Erneut versuchen", a change of the area, a reconnection, midnight). */
	reload(): Promise<void> {
		return this.#load();
	}

	/** The area of the tab changed: the plan of the old one goes at once, the new one loads. */
	rescope(): void {
		this.#clear();
		if (this.#state !== 'idle') void this.#load();
	}

	async #load(): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		const options = { signal: controller.signal };
		if (this.#answer === null || this.#answer.date !== this.date) this.#state = 'loading';
		this.#error = null;
		try {
			const result = await this.#data.fetch({ scope: this.#scope(), date: this.#date }, options);
			if (controller.signal.aborted) return;
			if (result.kind === 'missing') {
				this.#clear();
				this.#state = 'missing';
				return;
			}
			const answer = result.value;
			const items = answer.plan === null ? [] : await this.#data.listItems(answer.plan.id, options);
			if (controller.signal.aborted) return;
			if (this.#plan?.id !== answer.plan?.id) {
				this.#items.clear();
				this.#synced.clear();
			}
			this.#answer = answer;
			this.#plan = answer.plan;
			this.#merge(items);
			this.#state = 'ready';
			this.#follow();
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#messageOf(error);
			if (message === null) return;
			this.#error = message;
			this.#state = 'error';
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	#clear(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#answer = null;
		this.#plan = null;
		this.#items.clear();
		this.#snapshots.clear();
		this.#synced.clear();
		this.#completion = null;
		this.#follow();
	}

	/** The loaded entries replace those of the plan (events of the gap are in them). */
	#merge(items: readonly DayPlanItem[]): void {
		const ids = items.map((item) => item.id);
		for (const id of [...this.#items.keys()]) if (!ids.includes(id)) this.#items.delete(id);
		for (const item of items) this.#upsertItem(item);
	}

	#upsertItem(item: DayPlanItem): void {
		if (this.#plan === null || item.plan !== this.#plan.id) return;
		const existing = this.#items.get(item.id);
		if (item.ticket !== null) this.#snapshot(item.ticket);
		if (existing !== undefined && existing.updated > item.updated) return;
		if (existing !== undefined && sameItems(existing, item) && item.ticket === null) return;
		this.#items.set(item.id, { ...item, ticket: item.ticket ?? existing?.ticket ?? null });
	}

	#snapshot(ticket: TicketSummary): void {
		const known = this.#snapshots.get(ticket.id);
		if (known === undefined || ticket.updated >= known.updated)
			this.#snapshots.set(ticket.id, ticket);
	}

	// --- Realtime --------------------------------------------------------------------------------

	/**
	 * Keeps the plan live: the tickets of the area (their state in the plan), the reconnection (the
	 * plan loads again) and, for the shown plan, its entries and the plan itself. Returns the cleanup.
	 */
	connect(tickets: LiveSource, live: DayPlanLive): () => void {
		this.#live = live;
		const reload = () => void this.reload();
		const stops = [
			hold(
				(guard) =>
					tickets.tickets(
						guard((change) => {
							if (change.action === 'delete') this.#snapshots.delete(change.id);
							else if (this.#planned.includes(change.record.id)) this.#snapshot(change.record);
						})
					),
				{ recovered: reload }
			),
			hold((guard) => tickets.reconnected(guard(reload)), { recovered: reload })
		];
		this.#followedPlan = null;
		this.#follow();
		return () => {
			for (const stop of stops) stop();
			this.#stopPlan?.();
			this.#stopPlan = null;
			this.#followedPlan = null;
			this.#live = null;
			this.#controller?.abort();
			clearTimeout(this.#syncTimer);
		};
	}

	/**
	 * Subscribes the entries and the plan of the shown plan and the settings of its area; a new plan
	 * subscribes anew.
	 */
	#follow(): void {
		const live = this.#live;
		const planId = this.#plan?.id ?? null;
		if (live === null || planId === this.#followedPlan) return;
		this.#stopPlan?.();
		this.#stopPlan = null;
		this.#followedPlan = planId;
		if (planId === null) return;
		const scope = this.#plan?.scope ?? '';
		const reload = () => void this.reload();
		const stops = [
			hold(
				(guard) =>
					live.items(
						planId,
						guard((change) => {
							if (change.action === 'delete') this.#items.delete(change.id);
							else this.#upsertItem(change.record);
						})
					),
				{ recovered: reload }
			),
			hold(
				(guard) =>
					live.plan(
						planId,
						guard((change) => {
							if (change.action !== 'delete' && change.record.id === this.#plan?.id) {
								this.#plan = change.record;
							}
						})
					),
				{ recovered: reload }
			),
			hold(
				(guard) =>
					live.settings(
						scope,
						guard((change) => {
							if (change.action !== 'delete') this.#takeSettings(change.record);
						})
					),
				{ recovered: reload }
			)
		];
		this.#stopPlan = () => {
			for (const stop of stops) stop();
		};
	}

	/**
	 * Settings of the area changed in another tab or by another member (PL-1): the suggestions follow
	 * at once, and a source switched to "Automatisch übernehmen" asks the server to take its tickets in.
	 */
	#takeSettings(record: DayPlanSettingsRecord): void {
		const answer = this.#answer;
		if (answer === null || record.scope !== answer.scope) return;
		const before = answer.settings;
		this.#answer = { ...answer, settings: record.settings };
		const toAuto = DAY_PLAN_SOURCES.some(
			(source) => record.settings[source] === 'auto' && before[source] !== 'auto'
		);
		if (toAuto) this.#synced.clear();
		this.syncAutomatic();
	}

	/**
	 * Today, a ticket of an automatic source that is not in the plan (it just became an ongoing
	 * project, or due) makes the store ask for the plan again: the server takes it in. Called by the
	 * view whenever the suggestions change; each ticket asks once.
	 */
	syncAutomatic(): void {
		const fresh = this.#suggestions.filter(
			(entry) => entry.mode === 'auto' && !this.#synced.has(entry.id)
		);
		if (fresh.length === 0 || !this.editable || this.#state !== 'ready') return;
		for (const entry of fresh) this.#synced.add(entry.id);
		clearTimeout(this.#syncTimer);
		this.#syncTimer = setTimeout(() => void this.reload(), AUTO_SYNC_DELAY_MS);
	}

	// --- Actions ---------------------------------------------------------------------------------

	#area(): string {
		return this.#plan?.scope ?? this.#answer?.scope ?? this.#scope() ?? '';
	}

	#keyOf(row: PlanRow | undefined): string {
		return row?.ticket?.key ?? 'Eintrag';
	}

	#row(itemId: string): PlanRow | undefined {
		return this.#rows.find((row) => row.item.id === itemId);
	}

	#messageOf(error: unknown): string | null {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		const field = Object.values(failure.fields)[0];
		return field?.message ?? failure.message;
	}

	#fail(error: unknown, title: string): void {
		const message = this.#messageOf(error);
		if (message === null) return;
		this.#flags.show({ tone: 'error', title, description: message });
	}

	#announce(message: string): void {
		this.#announcement = message;
	}

	/** "+", dragging from the pool and "Zum Tagesplan" in the view: the ticket into the shown plan. */
	async add(ticketId: string, index?: number): Promise<boolean> {
		if (!this.editable || this.#pending.has(ticketId) || !this.#session.ensureValid()) return false;
		const ticket = this.#tickets.find(ticketId);
		this.#pending.add(ticketId);
		try {
			const answer = await this.#data.add({
				ticket: ticketId,
				scope: this.#area() || undefined,
				date: this.date,
				...(index !== undefined && { index })
			});
			if (answer.plan.id === this.#plan?.id) this.#plan = answer.plan;
			this.#upsertItem({ ...answer.item, ticket: answer.item.ticket ?? ticket });
			if (index !== undefined) await this.#refreshPositions();
			this.#announce(`${ticket?.key ?? 'Ticket'} im Tagesplan.`);
			return true;
		} catch (error) {
			this.#fail(error, `${ticket?.key ?? 'Das Ticket'} kam nicht in den Tagesplan.`);
			return false;
		} finally {
			this.#pending.delete(ticketId);
		}
	}

	/** The positions after a change at a place: the list asks for its entries again. */
	async #refreshPositions(): Promise<void> {
		const planId = this.#plan?.id;
		if (planId === undefined) return;
		try {
			this.#merge(await this.#data.listItems(planId, {}));
		} catch (error) {
			this.#messageOf(error);
		}
	}

	/** "Übernehmen" of chosen suggestions, in the order of the suggestions. */
	async adopt(ids: readonly string[]): Promise<boolean> {
		if (!this.editable || ids.length === 0 || !this.#session.ensureValid()) return false;
		const order = this.suggestions.map((row) => row.ticket.id).filter((id) => ids.includes(id));
		for (const id of order) this.#pending.add(id);
		try {
			const answer = await this.#data.adopt(this.#area(), order);
			this.#plan = answer.plan;
			for (const item of answer.items) {
				this.#upsertItem({ ...item, ticket: item.ticket ?? this.#tickets.find(item.ticketId) });
			}
			const count = answer.items.length;
			this.#flags.show({
				tone: 'success',
				title: count === 1 ? '1 Vorschlag übernommen.' : `${count} Vorschläge übernommen.`
			});
			return true;
		} catch (error) {
			this.#fail(error, 'Die Vorschläge wurden nicht übernommen.');
			return false;
		} finally {
			for (const id of order) this.#pending.delete(id);
		}
	}

	/** "Alle übernehmen". */
	adoptAll(): Promise<boolean> {
		return this.adopt(this.suggestions.map((row) => row.ticket.id));
	}

	/**
	 * The check mark of an entry: unchecked it checks (a task is completed, an ongoing project checked
	 * for the day), checked it takes the check back (the mark of the day first, else the ticket opens
	 * again).
	 */
	async toggle(itemId: string): Promise<void> {
		const row = this.#row(itemId);
		if (row === undefined) return;
		if (row.done) await this.#uncheck(row, {});
		else await this.#check(row, 'check', null);
	}

	/** "Nur für heute abhaken" of a task. */
	checkToday(itemId: string): Promise<boolean> {
		const row = this.#row(itemId);
		return row === undefined ? Promise.resolve(false) : this.#check(row, 'today', null);
	}

	/** "Vorhaben abschließen …" after its question: the ongoing project is completed. */
	complete(itemId: string): Promise<boolean> {
		const row = this.#row(itemId);
		return row === undefined ? Promise.resolve(false) : this.#check(row, 'complete', null);
	}

	async #check(
		row: PlanRow,
		mode: CheckMode,
		completion: CompletionChoice | null
	): Promise<boolean> {
		const id = row.item.id;
		if (!this.editable || this.#pending.has(id) || !this.#session.ensureValid()) return false;
		const key = this.#keyOf(row);
		this.#pending.add(id);
		try {
			const answer = await this.#data.check(id, mode, completion);
			this.#upsertItem({ ...answer.item, ticket: null });
			this.#applyTicket(answer.ticket);
			const previous = answer.ticket.previousStatus;
			const action = answer.action;
			const title = action === 'today' ? `${key} für heute abgehakt.` : `${key} erledigt.`;
			this.#flags.show({
				tone: 'success',
				title,
				action: {
					label: 'Rückgängig',
					run: () => void this.#undo(id, action, previous)
				}
			});
			this.#announce(title);
			return true;
		} catch (error) {
			const open = openChildrenOf(error);
			if (open !== null && row.ticket !== null) {
				this.#completion = {
					itemId: id,
					id: row.ticket.id,
					key: row.ticket.key,
					count: open.count,
					keys: open.keys,
					previousStatus: row.ticket.status
				};
				this.#completionError = null;
			} else {
				this.#fail(error, `${key} konnte nicht abgehakt werden.`);
			}
			return false;
		} finally {
			this.#pending.delete(id);
		}
	}

	/** Answers the question about open blocking sub-tasks and completes the ticket. */
	async confirmCompletion(choice: CompletionChoice): Promise<void> {
		const question = this.#completion;
		const row = question === null ? undefined : this.#row(question.itemId);
		if (question === null || row === undefined || this.#completing) return;
		this.#completing = true;
		this.#completionError = null;
		const done = await this.#check(row, 'check', choice);
		this.#completing = false;
		if (done) this.#completion = null;
	}

	cancelCompletion(): void {
		if (this.#completing) return;
		this.#completion = null;
		this.#completionError = null;
	}

	/** A known state of a ticket after a check: the list and the plan show it at once. */
	#applyTicket(checked: CheckedTicket): void {
		const known = newer(this.#snapshots.get(checked.id) ?? null, this.#tickets.find(checked.id));
		if (known === null || known.status === checked.status) return;
		this.#snapshots.set(checked.id, { ...known, status: checked.status });
	}

	async #uncheck(row: PlanRow, input: { action?: CheckAction; status?: Status }): Promise<boolean> {
		const id = row.item.id;
		if (!this.editable || this.#pending.has(id) || !this.#session.ensureValid()) return false;
		const key = this.#keyOf(row);
		this.#pending.add(id);
		try {
			const answer = await this.#data.uncheck(id, input);
			this.#upsertItem({ ...answer.item, ticket: null });
			this.#applyTicket(answer.ticket);
			this.#announce(`${key} wieder offen.`);
			return true;
		} catch (error) {
			this.#fail(error, `${key} konnte nicht zurückgesetzt werden.`);
			return false;
		} finally {
			this.#pending.delete(id);
		}
	}

	/** "Rückgängig" of a check: the mark of the day goes, or the ticket opens with its status before. */
	async #undo(itemId: string, action: CheckAction, previous: Status): Promise<void> {
		const row = this.#row(itemId);
		if (row === undefined) return;
		const status = previous === 'done' ? undefined : previous;
		const done = await this.#uncheck(
			row,
			action === 'today' ? { action } : { action, ...(status && { status }) }
		);
		if (done) this.#flags.show({ tone: 'success', title: `${this.#keyOf(row)} ist wieder offen.` });
	}

	/** "Auf morgen schieben". */
	async moveToTomorrow(itemId: string): Promise<void> {
		const row = this.#row(itemId);
		if (
			row === undefined ||
			!this.isToday ||
			this.#pending.has(itemId) ||
			!this.#session.ensureValid()
		)
			return;
		const key = this.#keyOf(row);
		this.#pending.add(itemId);
		try {
			await this.#data.tomorrow(itemId);
			this.#items.delete(itemId);
			this.#flags.show({ tone: 'success', title: `${key} auf morgen geschoben.` });
			this.#announce(`${key} auf morgen geschoben.`);
		} catch (error) {
			this.#fail(error, `${key} konnte nicht verschoben werden.`);
		} finally {
			this.#pending.delete(itemId);
		}
	}

	/** "Entfernen"; "Rückgängig" puts the ticket back at its place. */
	async remove(itemId: string): Promise<void> {
		const row = this.#row(itemId);
		if (
			row === undefined ||
			!this.editable ||
			this.#pending.has(itemId) ||
			!this.#session.ensureValid()
		) {
			return;
		}
		const key = this.#keyOf(row);
		const index = this.#ordered.findIndex((item) => item.id === itemId);
		const ticketId = row.item.ticketId;
		this.#pending.add(itemId);
		try {
			const answer = await this.#data.remove(itemId);
			this.#items.delete(itemId);
			if (answer.plan.id === this.#plan?.id) this.#plan = answer.plan;
			const open = row.ticket !== null && row.ticket.status !== 'done';
			this.#flags.show({
				tone: 'success',
				title: `${key} aus dem Tagesplan entfernt.`,
				...(open && { action: { label: 'Rückgängig', run: () => void this.add(ticketId, index) } })
			});
			this.#announce(`${key} aus dem Tagesplan entfernt.`);
		} catch (error) {
			this.#fail(error, `${key} konnte nicht entfernt werden.`);
		} finally {
			this.#pending.delete(itemId);
		}
	}

	/** Puts an entry at `index` (dragging, "Nach oben", "Nach unten", Alt+arrow). */
	async moveTo(itemId: string, index: number): Promise<boolean> {
		if (!this.editable || this.#pending.has(itemId) || !this.#session.ensureValid()) return false;
		const ids = this.#ordered.map((item) => item.id);
		const order = moved(ids, itemId, index);
		if (order === null || order.join() === ids.join()) return false;
		const before = [...this.#ordered];
		// At once in the list; the answer brings the positions of the server.
		order.forEach((id, position) => {
			const item = before.find((entry) => entry.id === id);
			if (item !== undefined && item.position !== position)
				this.#items.set(id, { ...item, position });
		});
		this.#pending.add(itemId);
		try {
			const positions = await this.#data.move(itemId, index);
			for (const { id, position } of positions) {
				const item = this.#items.get(id);
				if (item !== undefined && item.position !== position)
					this.#items.set(id, { ...item, position });
			}
			const row = this.#row(itemId);
			const place = order.indexOf(itemId) + 1;
			this.#announce(`${this.#keyOf(row)} steht jetzt an Stelle ${place} von ${order.length}.`);
			return true;
		} catch (error) {
			for (const item of before) this.#items.set(item.id, item);
			this.#fail(error, 'Die Reihenfolge wurde nicht gespeichert.');
			return false;
		} finally {
			this.#pending.delete(itemId);
		}
	}

	moveUp(itemId: string): Promise<boolean> {
		const index = this.#ordered.findIndex((item) => item.id === itemId);
		return index <= 0 ? Promise.resolve(false) : this.moveTo(itemId, index - 1);
	}

	moveDown(itemId: string): Promise<boolean> {
		const index = this.#ordered.findIndex((item) => item.id === itemId);
		return index === -1 || index >= this.#ordered.length - 1
			? Promise.resolve(false)
			: this.moveTo(itemId, index + 1);
	}

	/** "Als laufendes Vorhaben markieren" or "Als Aufgabe markieren" (ADR-0065 §1). */
	async setKind(ticketId: string, kind: TicketKind): Promise<boolean> {
		if (this.#pending.has(ticketId) || !this.#session.ensureValid()) return false;
		const ticket = newer(this.#snapshots.get(ticketId) ?? null, this.#tickets.find(ticketId));
		const key = ticket?.key ?? 'Das Ticket';
		this.#pending.add(ticketId);
		try {
			const saved = await this.#data.setKind(ticketId, kind);
			this.#tickets.upsert(saved);
			this.#snapshot(saved);
			const title =
				kind === 'ongoing'
					? `${saved.key} ist jetzt ein laufendes Vorhaben.`
					: `${saved.key} ist jetzt eine Aufgabe.`;
			this.#flags.show({ tone: 'success', title });
			return true;
		} catch (error) {
			this.#fail(error, `${key} wurde nicht geändert.`);
			return false;
		} finally {
			this.#pending.delete(ticketId);
		}
	}

	/** The mode of one source of the area; the plan of today follows at once. */
	async saveSetting(source: DayPlanSource, mode: SourceMode): Promise<boolean> {
		const answer = this.#answer;
		if (answer === null || this.#settingsSaving || !this.#session.ensureValid()) return false;
		this.#settingsSaving = true;
		try {
			const settings = await this.#data.saveSettings(this.#area(), { [source]: mode });
			if (this.#answer !== null) this.#answer = { ...this.#answer, settings };
			if (mode === 'auto') this.#synced.clear();
			this.syncAutomatic();
			return true;
		} catch (error) {
			this.#fail(error, 'Die Einstellung wurde nicht gespeichert.');
			return false;
		} finally {
			this.#settingsSaving = false;
		}
	}
}

// --- "Zum Tagesplan" in the menus of a ticket --------------------------------------------------

/** Data of the entry "Zum Tagesplan" (every menu of a ticket). */
export interface DayPlanEntryData {
	add(ticketId: string): Promise<AddAnswer>;
}

export function dayPlanEntryData(pb: PocketBase): DayPlanEntryData {
	return { add: (ticketId) => addToDayPlan(pb, { ticket: ticketId }) };
}

/**
 * "Zum Tagesplan" in the menu "•••" of a ticket (detail, list, calendar, projects): the ticket into the
 * plan of today of its own area; a flag says it, with the way to the plan.
 */
export class DayPlanEntryStore {
	readonly #data: DayPlanEntryData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #open: () => void;
	readonly #pending = new SvelteSet<string>();

	constructor(data: DayPlanEntryData, session: SessionGuard, flags: FlagSink, open: () => void) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#open = open;
	}

	isPending(ticketId: string): boolean {
		return this.#pending.has(ticketId);
	}

	async add(ticket: { id: string; key: string }): Promise<boolean> {
		if (this.#pending.has(ticket.id) || !this.#session.ensureValid()) return false;
		this.#pending.add(ticket.id);
		try {
			const answer = await this.#data.add(ticket.id);
			this.#flags.show({
				tone: 'success',
				title: answer.already
					? `${ticket.key} steht schon im Tagesplan.`
					: `${ticket.key} im Tagesplan von heute.`,
				action: { label: 'Tagesplan öffnen', run: () => this.#open() }
			});
			return true;
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'aborted') return false;
			if (failure.kind === 'session') {
				this.#session.logout();
				return false;
			}
			const field = Object.values(failure.fields)[0];
			this.#flags.show({
				tone: 'error',
				title: `${ticket.key} kam nicht in den Tagesplan.`,
				description: field?.message ?? failure.message
			});
			return false;
		} finally {
			this.#pending.delete(ticket.id);
		}
	}
}

const [getDayPlanEntryStore, setDayPlanEntryStore, hasDayPlanEntryStore] =
	createContext<DayPlanEntryStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findDayPlanEntryStore(): DayPlanEntryStore | null {
	return hasDayPlanEntryStore() ? getDayPlanEntryStore() : null;
}

export { setDayPlanEntryStore };
