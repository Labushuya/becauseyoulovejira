// Recurrence rules of the signed-in user (E5 plan, T-7 and package 4). One store per app layout:
// it loads all rules once per session (there are few) and follows them live; the table, the panel
// and the overview read the rhythm from here. Own answers and realtime events go through the
// same upsert and remove; after a reconnection the store reconciles once (ADR-0007 section 3).
// Before the E5 migration the server does not know the rules yet: the store then says so neutrally
// ("unavailable") instead of showing an error. Results of actions go out as success flags
// (ADR-0025 section 8; E5 plan, package 5); refusals come back as EditResult for their place.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { onReconnect, subscribeRules } from '$lib/data/realtime';
import {
	createRule,
	deleteRule,
	detachTicket,
	eachOccurrenceReady,
	listRules,
	setRuleActive,
	updateRule,
	type RuleDraft
} from '$lib/data/recurrence';
import { compareTitles } from '$lib/domain/ordering';
import type { CalendarDate } from '$lib/domain/berlin-date';
import {
	backlogText,
	formParams,
	isWaiting,
	ruleBacklog,
	ruleText,
	type BacklogChoice,
	type RecurrenceFormValues,
	type RecurrenceRule
} from '$lib/domain/recurrence-rule';
import { shortDate } from '$lib/domain/recurrence-text';
import type { Ticket } from '$lib/domain/ticket';
import type { EditResult } from './catalog-editor';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type RecordChange, type Unsubscribe } from './realtime';
import type { LoadState, SessionGuard } from './ticket-list.svelte';
import { restartNeeded } from '$lib/guidance/texts';

/** Shown instead of the rules until the app was started with the E5 migrations. */
export const RECURRENCE_UNAVAILABLE = restartNeeded('Wiederholungen sind');

export type RecurrenceState = LoadState | 'unavailable';

/** Title of the flag about rules that wait for the choice about a backlog (ADR-0022 addendum 5). */
export function waitingTitle(count: number): string {
	return count === 1
		? '1 Wiederholung wartet auf deine Entscheidung.'
		: `${count} Wiederholungen warten auf deine Entscheidung.`;
}

export const WAITING_DESCRIPTION =
	'Viele Termine haben noch kein Ticket. Wähle „Alle nachholen“ oder „Nur ab heute“.';

/** Start of the message when the rule of a converted series failed; the ticket stays. */
export const REPEAT_FAILED = 'Das Ticket ist angelegt, die Wiederholung aber nicht.';

/** "Wiederholen…" prepared for the panel of one ticket (E5 plan, package 6). */
export interface RepeatOffer {
	ticketId: string;
	values: RecurrenceFormValues;
	/** Why it is offered (the rule failed), shown as an error; null: open the dialog at once. */
	message: string | null;
}

/** Data access of the store; tests pass a fake, the app binds the data layer to its client. */
export interface RecurrenceData {
	listRules(options: RequestOptions): Promise<RecurrenceRule[] | null>;
	createRule(draft: RuleDraft, ticket: string | null): Promise<RecurrenceRule>;
	updateRule(id: string, patch: Partial<RuleDraft>): Promise<RecurrenceRule>;
	setActive(id: string, active: boolean): Promise<RecurrenceRule>;
	deleteRule(id: string): Promise<void>;
	detachTicket(ticketId: string): Promise<Ticket>;
	/**
	 * Whether the server knows "Jeden Termin einzeln anlegen" (plan OR-5); without it (tests) the
	 * switch is not offered.
	 */
	eachOccurrenceReady?(options: RequestOptions): Promise<boolean>;
}

export function recurrenceData(pb: PocketBase): RecurrenceData {
	return {
		listRules: (options) => listRules(pb, options),
		eachOccurrenceReady: (options) => eachOccurrenceReady(pb, options),
		createRule: (draft, ticket) => createRule(pb, draft, ticket),
		updateRule: (id, patch) => updateRule(pb, id, patch),
		setActive: (id, active) => setRuleActive(pb, id, active),
		deleteRule: (id) => deleteRule(pb, id),
		detachTicket: (ticketId) => detachTicket(pb, ticketId)
	};
}

/** Realtime of the rules, as the store needs it (tests pass a fake). */
export interface RecurrenceLive {
	rules(onChange: (change: RecordChange<RecurrenceRule>) => void): Promise<Unsubscribe>;
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function recurrenceLive(pb: PocketBase): RecurrenceLive {
	return {
		rules: (onChange) => subscribeRules(pb, onChange),
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

/** Active rules first, then by the date of the next ticket (none last), then by title. */
function byNextTicket(a: RecurrenceRule, b: RecurrenceRule): number {
	if (a.active !== b.active) return a.active ? -1 : 1;
	const aDue = a.nextDue ?? '9999-12-31';
	const bDue = b.nextDue ?? '9999-12-31';
	if (aDue !== bDue) return aDue < bDue ? -1 : 1;
	return compareTitles(a.title, b.title) || (a.id < b.id ? -1 : 1);
}

/** Fields of the form whose server errors show at the field. */
const FORM_FIELDS = [
	'title',
	'description',
	'project',
	'tags',
	'priority',
	'mode',
	'freq',
	'interval',
	'weekdays',
	'month_day',
	'anchor',
	'lead_days',
	'each_occurrence',
	'ticket'
];

export class RecurrenceStore {
	readonly #data: RecurrenceData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;

	readonly #rules = new SvelteMap<string, RecurrenceRule>();
	/** Deleted IDs: a late event must not bring them back. */
	readonly #deleted = new SvelteSet<string>();
	/** IDs changed while a load runs: its older snapshot must not remove them. */
	#touched: Set<string> | null = null;
	#controller: AbortController | null = null;

	#state = $state<RecurrenceState>('idle');
	#error = $state<string | null>(null);
	/** The server knows "Jeden Termin einzeln anlegen" (after its migration, plan OR-5). */
	#eachReady = $state(false);

	#list = $derived([...this.#rules.values()].sort(byNextTicket));
	/** "Wiederholen…" handed over to the panel of one ticket, taken once (`takeOffer`). */
	#offer: RepeatOffer | null = null;
	/** The flag about rules that wait for a choice, while it is shown. */
	#waitingFlag: string | null = null;

	constructor(data: RecurrenceData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	/** All rules: active first, then by next ticket. */
	get rules(): readonly RecurrenceRule[] {
		return this.#list;
	}

	get state(): RecurrenceState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/**
	 * Whether the switch "Jeden Termin einzeln anlegen" is offered (plan OR-5): only once the server
	 * knows it; before the next start of the app the forms leave it out.
	 */
	get eachReady(): boolean {
		return this.#state === 'ready' && this.#eachReady;
	}

	ruleById(id: string | null | undefined): RecurrenceRule | null {
		return id ? (this.#rules.get(id) ?? null) : null;
	}

	/** Rhythm of a rule in words ("jeden Montag"); '' while it is unknown. */
	textOf(id: string | null | undefined): string {
		const rule = this.ruleById(id);
		return rule === null ? '' : ruleText(rule);
	}

	/** Loads the rules for the app layout; the cleanup empties the store (logout). */
	start(): () => void {
		void this.load();
		return () => this.reset();
	}

	async load(): Promise<void> {
		if (this.#state === 'idle' || this.#state === 'error') await this.#load(false);
	}

	async reload(): Promise<void> {
		await this.#load(false);
	}

	upsert(rule: RecurrenceRule): void {
		if (this.#deleted.has(rule.id)) return;
		this.#touched?.add(rule.id);
		const existing = this.#rules.get(rule.id);
		if (existing !== undefined && existing.updated > rule.updated) return;
		this.#rules.set(rule.id, rule);
	}

	remove(id: string): void {
		this.#deleted.add(id);
		this.#touched?.add(id);
		this.#rules.delete(id);
	}

	/**
	 * Keeps the rules live (ADR-0007 sections 2 and 3); a subscription that came only after failed
	 * attempts reconciles like a reconnection. Returns the cleanup, which ends the subscriptions
	 * and a running reconciliation.
	 */
	connect(live: RecurrenceLive): () => void {
		const reconcile = () => void this.reconcile();
		const stops = [
			hold(
				(guard) =>
					live.rules(
						guard((change) => {
							if (change.action === 'delete') this.remove(change.id);
							else this.upsert(change.record);
						})
					),
				{ recovered: reconcile }
			),
			hold((guard) => live.reconnected(guard(reconcile)), { recovered: reconcile })
		];
		return () => {
			for (const stop of stops) stop();
			if (this.#state === 'ready') this.#abort();
		};
	}

	async reconcile(): Promise<void> {
		if (this.#state === 'error') {
			await this.reload();
			return;
		}
		if (this.#state === 'ready') await this.#load(true);
	}

	/**
	 * "Wiederholen…" (ADR-0023 section 1): a rule whose template is the ticket, with the ticket as
	 * its current instance.
	 */
	repeat(ticket: Ticket, values: RecurrenceFormValues): Promise<EditResult<RecurrenceRule>> {
		return this.create(
			{
				title: ticket.title,
				description: ticket.description,
				project: ticket.projectId,
				tags: [...ticket.tagIds],
				priority: ticket.priority,
				...formParams(values)
			},
			ticket.id
		);
	}

	/**
	 * Second step of converting a calendar series with "Als Wiederholung übernehmen" (ADR-0024
	 * section 1) and of "Neues Ticket" with the section "Wiederholen" (plan OR-4): the ticket
	 * exists already and becomes the current instance of the new rule. If
	 * the rule fails, the ticket stays, and its panel offers "Wiederholen…" with the same values
	 * and the reason. The rule, or null if it failed.
	 */
	async repeatCreated(
		ticket: Ticket,
		values: RecurrenceFormValues
	): Promise<RecurrenceRule | null> {
		const result = await this.repeat(ticket, values);
		if (result.ok) return result.value;
		const reason = result.message ?? Object.values(result.fields)[0] ?? null;
		this.offerRepeat(
			ticket.id,
			values,
			reason === null ? REPEAT_FAILED : `${REPEAT_FAILED} ${reason}`
		);
		return null;
	}

	/**
	 * Hands "Wiederholen…" with prepared values to the panel of a ticket (inbox panel: "Wiederholung
	 * für TASK-12 anlegen…"). Without a message the panel opens the dialog at once; with one it
	 * shows the message and offers the prepared dialog. A newer offer replaces an older one.
	 */
	offerRepeat(ticketId: string, values: RecurrenceFormValues, message: string | null = null): void {
		this.#offer = { ticketId, values: { ...values, weekdays: [...values.weekdays] }, message };
	}

	/** The offer for this ticket, once; null without one. */
	takeOffer(ticketId: string): RepeatOffer | null {
		const offer = this.#offer;
		if (offer === null || offer.ticketId !== ticketId) return null;
		this.#offer = null;
		return offer;
	}

	/** Saves a new rhythm of a rule; the hook computes the next ticket again. */
	saveRhythm(id: string, values: RecurrenceFormValues): Promise<EditResult<RecurrenceRule>> {
		return this.update(id, formParams(values));
	}

	/** "Wiederholen…" (with `ticket`) or "Neue Regel" (without). */
	create(draft: RuleDraft, ticket: string | null = null): Promise<EditResult<RecurrenceRule>> {
		return this.#run(async () => {
			const rule = await this.#data.createRule(draft, ticket);
			this.upsert(rule);
			this.#notify(`Wiederholung angelegt: ${ruleText(rule)}.`);
			return rule;
		});
	}

	update(id: string, patch: Partial<RuleDraft>): Promise<EditResult<RecurrenceRule>> {
		return this.#run(async () => {
			const rule = await this.#data.updateRule(id, patch);
			this.upsert(rule);
			this.#notify('Regel gespeichert.');
			return rule;
		});
	}

	/** "Pausieren" and "Fortsetzen" (ADR-0023 section 4). */
	setActive(id: string, active: boolean): Promise<EditResult<RecurrenceRule>> {
		return this.#run(async () => {
			const rule = await this.#data.setActive(id, active);
			this.upsert(rule);
			this.#notify(active ? 'Regel fortgesetzt.' : 'Regel pausiert.');
			return rule;
		});
	}

	/** Deletes a rule; its tickets stay (ADR-0023 section 7). */
	deleteRule(id: string): Promise<EditResult<void>> {
		return this.#run(async () => {
			await this.#data.deleteRule(id);
			this.remove(id);
			this.#notify('Regel gelöscht. Die Tickets bleiben erhalten.');
		});
	}

	/**
	 * The choice about a large backlog (ADR-0022 addendum 5): "Alle nachholen" makes the missed
	 * dates in batches of EACH_MAX_PER_RUN, "Nur ab heute" skips them and names them in the flag.
	 */
	decideBacklog(
		id: string,
		choice: BacklogChoice,
		today: CalendarDate
	): Promise<EditResult<RecurrenceRule>> {
		const current = this.ruleById(id);
		const backlog = current === null ? null : ruleBacklog(current, today);
		return this.#run(async () => {
			const rule = await this.#data.updateRule(id, { backlog: choice });
			this.upsert(rule);
			if (backlog === null) this.#notify('Regel gespeichert.');
			else if (choice === 'all') {
				this.#notify(`${backlogText(backlog, today)} werden nachgeholt, höchstens 20 je Lauf.`);
			} else {
				const date = rule.nextDue === null ? '' : shortDate(rule.nextDue, today);
				const next = date === '' ? '' : ` Weiter am ${date}${date.endsWith('.') ? '' : '.'}`;
				this.#notify(`${backlogText(backlog, today)} übersprungen.${next}`);
			}
			return rule;
		});
	}

	/** Rules that wait for the choice about a large backlog (ADR-0022 addendum 5). */
	get waiting(): readonly RecurrenceRule[] {
		return this.#list.filter((rule) => isWaiting(rule));
	}

	/**
	 * Info flag "N Wiederholungen warten auf deine Entscheidung." with "Ansehen" (the rule, or the
	 * overview for several), shown when the app starts and when it is opened again (ADR-0035
	 * section 5); nothing without a waiting rule. A newer flag replaces the older one.
	 */
	announceWaiting(open: (ruleId: string | null) => void): void {
		const waiting = this.waiting;
		if (waiting.length === 0) return;
		if (this.#waitingFlag !== null) this.#flags.dismiss(this.#waitingFlag);
		const only = waiting.length === 1 ? (waiting[0]?.id ?? null) : null;
		const id = this.#flags.show({
			tone: 'info',
			title: waitingTitle(waiting.length),
			description: WAITING_DESCRIPTION,
			action: { label: 'Ansehen', run: () => open(only) },
			onclose: () => {
				if (this.#waitingFlag === id) this.#waitingFlag = null;
			}
		});
		this.#waitingFlag = id;
	}

	/** "Aus der Serie lösen" (ADR-0023 section 6); the ticket comes back for the list. */
	detach(ticketId: string): Promise<EditResult<Ticket>> {
		return this.#run(async () => {
			const ticket = await this.#data.detachTicket(ticketId);
			this.#notify(`${ticket.key} ist aus der Serie gelöst.`);
			return ticket;
		});
	}

	reset(): void {
		this.#abort();
		this.#offer = null;
		this.#waitingFlag = null;
		this.#rules.clear();
		this.#deleted.clear();
		this.#state = 'idle';
		this.#error = null;
		this.#eachReady = false;
	}

	/** Success flag of an action; the flag group announces it (role status). */
	#notify(title: string): void {
		this.#flags.show({ tone: 'success', title });
	}

	#abort(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#touched = null;
	}

	async #load(quiet: boolean): Promise<void> {
		this.#abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		const touched = new SvelteSet<string>();
		this.#touched = touched;
		if (!quiet) {
			this.#state = 'loading';
			this.#error = null;
		}
		try {
			const rules = await this.#data.listRules({ signal: controller.signal });
			if (controller.signal.aborted) return;
			this.#touched = null;
			if (rules === null) {
				this.#rules.clear();
				this.#state = 'unavailable';
				return;
			}
			const ids = new SvelteSet(rules.map((rule) => rule.id));
			for (const id of [...this.#rules.keys()]) {
				if (!ids.has(id) && !touched.has(id)) this.#rules.delete(id);
			}
			for (const rule of rules) {
				if (!touched.has(rule.id)) this.upsert(rule);
			}
			this.#eachReady = await this.#probeEach(controller.signal);
			if (controller.signal.aborted) return;
			this.#state = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null || quiet) return;
			this.#error = message;
			this.#state = 'error';
		} finally {
			if (this.#controller === controller) {
				this.#controller = null;
				this.#touched = null;
			}
		}
	}

	async #run<T>(action: () => Promise<T>): Promise<EditResult<T>> {
		if (!this.#session.ensureValid()) return { ok: false, message: null, fields: {} };
		try {
			return { ok: true, value: await action() };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'aborted') return { ok: false, message: null, fields: {} };
			if (failure.kind === 'session') {
				this.#session.logout();
				return { ok: false, message: null, fields: {} };
			}
			const fields: Record<string, string> = {};
			for (const name of FORM_FIELDS) {
				const field = failure.fields[name];
				if (field !== undefined) fields[name] = field.message;
			}
			if (Object.keys(fields).length > 0) return { ok: false, message: null, fields };
			const other = Object.values(failure.fields)[0]?.message;
			return { ok: false, message: other ?? failure.message, fields: {} };
		}
	}

	/** The switch stays hidden when the server cannot tell (old schema or a failed probe). */
	async #probeEach(signal: AbortSignal): Promise<boolean> {
		if (this.#data.eachOccurrenceReady === undefined) return false;
		try {
			return await this.#data.eachOccurrenceReady({ signal });
		} catch {
			return false;
		}
	}

	#failureMessage(error: unknown): string | null {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		return failure.message;
	}
}

const [getRecurrenceStore, setRecurrenceStore] = createContext<RecurrenceStore>();

/** Recurrence rules, set by the app layout. */
export { getRecurrenceStore, setRecurrenceStore };
