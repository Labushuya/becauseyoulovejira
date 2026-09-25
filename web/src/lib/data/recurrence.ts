// Recurrence rules (ADR-0021 to ADR-0023; E5 plan, package 4). Stateless functions with the
// PocketBase instance as first parameter; the root integration tests run them against the
// disposable instance. The hook checks every value and computes next_due; the client sends only
// the template and the rhythm.

import type PocketBase from 'pocketbase';
import { toDueInput } from '../domain/ticket';
import { isPriority, type Priority } from '../domain/status';
import {
	LAST_DAY,
	WEEKDAYS,
	isRecurrenceFreq,
	isRecurrenceMode,
	type Weekday
} from '../domain/recurrence';
import type { RecurrenceRule } from '../domain/recurrence-rule';
import type { Ticket } from '../domain/ticket';
import { DataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';
import { TICKET_DETAIL_FIELDS, TICKET_EXPAND, toTicket, type TicketRecord } from './tickets';

const RULES = 'recurrence_rules';

/** Fields of the rules; the store keeps all of them (T-7). */
export const RULE_FIELDS = [
	'id',
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
	'next_due',
	'last_generated_at',
	'active',
	'last_hint',
	'created',
	'updated'
].join(',');

export interface RuleRecord {
	id: string;
	title: string;
	description?: string;
	project: string;
	tags?: string[];
	priority: string;
	mode: string;
	freq?: string;
	interval?: number;
	weekdays?: string[];
	month_day?: number;
	anchor?: string;
	lead_days?: number;
	next_due: string;
	last_generated_at: string;
	active: boolean;
	last_hint?: string;
	created: string;
	updated: string;
}

/** Maps a record (API answer or realtime event) to the domain type. */
export function toRecurrenceRule(record: RuleRecord): RecurrenceRule {
	const monthDay = record.month_day ?? 0;
	return {
		id: record.id,
		title: record.title,
		description: record.description ?? '',
		projectId: record.project || null,
		tagIds: [...(record.tags ?? [])],
		priority: isPriority(record.priority) ? record.priority : null,
		mode: isRecurrenceMode(record.mode) ? record.mode : '',
		freq: isRecurrenceFreq(record.freq) ? record.freq : '',
		interval: record.interval ?? 0,
		weekdays: (record.weekdays ?? []).filter((day): day is Weekday =>
			(WEEKDAYS as readonly string[]).includes(day)
		),
		monthDay: monthDay === LAST_DAY || (monthDay >= 1 && monthDay <= 31) ? monthDay : null,
		anchor: toDueInput(record.anchor ?? '') || null,
		leadDays: record.lead_days ?? 0,
		nextDue: toDueInput(record.next_due) || null,
		lastGeneratedAt: record.last_generated_at || null,
		active: record.active,
		lastHint: record.last_hint ?? '',
		created: record.created,
		updated: record.updated
	};
}

/** Template and rhythm of a rule as the form sends them. */
export interface RuleDraft {
	title: string;
	description: string;
	project: string | null;
	tags: string[];
	priority: Priority | null;
	mode: string;
	freq: string;
	interval: number;
	weekdays: string[];
	month_day: number;
	anchor: string;
	lead_days: number;
}

function draftBody(draft: Partial<RuleDraft>): Record<string, unknown> {
	const body: Record<string, unknown> = { ...draft };
	if (draft.project !== undefined) body.project = draft.project ?? '';
	if (draft.priority !== undefined) body.priority = draft.priority ?? '';
	return body;
}

/**
 * All rules the signed-in user sees, or null before the E5 migration: the filter asks only for
 * rules with the E5 field `scope`, which the server does not know before the migration
 * 1790201600 and then answers with 400 (E4 plan, section 12: hooks and SPA run before the next
 * start of the app). The store sorts them.
 */
export function listRules(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<RecurrenceRule[] | null> {
	return withDataErrors(signal, async () => {
		try {
			const records = await pb.collection(RULES).getFullList<RuleRecord>({
				batch: 500,
				filter: pb.filter('scope != {:none}', { none: '' }),
				fields: RULE_FIELDS,
				signal
			});
			return records.map(toRecurrenceRule);
		} catch (error) {
			if ((error as { status?: unknown } | null)?.status === 400) return null;
			throw error;
		}
	});
}

/**
 * Creates a private rule of the signed-in user. With `ticket` ("Wiederholen…", ADR-0023 section
 * 1) the ticket becomes its current instance in the same transaction of the hook.
 */
export function createRule(
	pb: PocketBase,
	draft: RuleDraft,
	ticket: string | null = null,
	{ signal }: RequestOptions = {}
): Promise<RecurrenceRule> {
	return withDataErrors(signal, async () => {
		const owner = currentUserId(pb.authStore.record);
		if (owner === null) throw new DataError('session');
		const body = { ...draftBody(draft), owner, ...(ticket !== null && { ticket }) };
		const record = await pb
			.collection(RULES)
			.create<RuleRecord>(body, { fields: RULE_FIELDS, signal });
		return toRecurrenceRule(record);
	});
}

/** Changes template or rhythm; the hook computes next_due again (ADR-0023 section 5). */
export function updateRule(
	pb: PocketBase,
	id: string,
	patch: Partial<RuleDraft>,
	{ signal }: RequestOptions = {}
): Promise<RecurrenceRule> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(RULES)
			.update<RuleRecord>(id, draftBody(patch), { fields: RULE_FIELDS, signal });
		return toRecurrenceRule(record);
	});
}

/** Pauses or resumes a rule; resuming does not catch up the pause (ADR-0023 section 4). */
export function setRuleActive(
	pb: PocketBase,
	id: string,
	active: boolean,
	{ signal }: RequestOptions = {}
): Promise<RecurrenceRule> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(RULES)
			.update<RuleRecord>(id, { active }, { fields: RULE_FIELDS, signal });
		return toRecurrenceRule(record);
	});
}

/** Deletes a rule; its tickets stay as normal tickets (ADR-0023 section 7, OF-E5-4). */
export function deleteRule(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<void> {
	return withDataErrors(signal, async () => {
		await pb.collection(RULES).delete(id, { signal });
	});
}

/**
 * "Aus der Serie lösen" (ADR-0023 section 6): the ticket stays as a normal ticket; the only
 * change a client may make to `tickets.recurrence`.
 */
export function detachTicket(
	pb: PocketBase,
	ticketId: string,
	{ signal }: RequestOptions = {}
): Promise<Ticket> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection('tickets')
			.update<TicketRecord>(
				ticketId,
				{ recurrence: '' },
				{ fields: TICKET_DETAIL_FIELDS, expand: TICKET_EXPAND, signal }
			);
		return toTicket(record);
	});
}
