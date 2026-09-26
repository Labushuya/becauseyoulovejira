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
	listRules,
	setRuleActive,
	updateRule,
	type RuleDraft
} from '$lib/data/recurrence';
import { compareTitles } from '$lib/domain/ordering';
import {
	formParams,
	ruleText,
	type RecurrenceFormValues,
	type RecurrenceRule
} from '$lib/domain/recurrence-rule';
import type { Ticket } from '$lib/domain/ticket';
import type { EditResult } from './catalog-editor';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type RecordChange, type Unsubscribe } from './realtime';
import type { LoadState, SessionGuard } from './ticket-list.svelte';
import { restartNeeded } from '$lib/guidance/texts';

/** Shown instead of the rules until the app was started with the E5 migrations. */
export const RECURRENCE_UNAVAILABLE = restartNeeded('Wiederholungen sind');

export type RecurrenceState = LoadState | 'unavailable';

/** Data access of the store; tests pass a fake, the app binds the data layer to its client. */
export interface RecurrenceData {
	listRules(options: RequestOptions): Promise<RecurrenceRule[] | null>;
	createRule(draft: RuleDraft, ticket: string | null): Promise<RecurrenceRule>;
	updateRule(id: string, patch: Partial<RuleDraft>): Promise<RecurrenceRule>;
	setActive(id: string, active: boolean): Promise<RecurrenceRule>;
	deleteRule(id: string): Promise<void>;
	detachTicket(ticketId: string): Promise<Ticket>;
}

export function recurrenceData(pb: PocketBase): RecurrenceData {
	return {
		listRules: (options) => listRules(pb, options),
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

	#list = $derived([...this.#rules.values()].sort(byNextTicket));

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
	 * Keeps the rules live (ADR-0007 sections 2 and 3). Returns the cleanup, which ends the
	 * subscriptions and a running reconciliation.
	 */
	connect(live: RecurrenceLive): () => void {
		const stops = [
			hold(
				live.rules((change) => {
					if (change.action === 'delete') this.remove(change.id);
					else this.upsert(change.record);
				})
			),
			hold(live.reconnected(() => void this.reconcile()))
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
		this.#rules.clear();
		this.#deleted.clear();
		this.#state = 'idle';
		this.#error = null;
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
