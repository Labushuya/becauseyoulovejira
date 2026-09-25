// Realtime subscriptions (ADR-0007 section 2). Thin functions around the SDK: they set the same
// fields and expands as the loading functions, filter with pb.filter() and map the records to
// domain types, so events and answers go through the same idempotent store methods. The server
// filters every event by the list and view rules of the collection.

import type PocketBase from 'pocketbase';
import type { InboxItemSummary } from '../domain/inbox';
import type { Project } from '../domain/project';
import type { RecurrenceRule } from '../domain/recurrence-rule';
import type { Tag } from '../domain/tag';
import type { Comment, HistoryEntry, Ticket, TicketSummary } from '../domain/ticket';
import { COMMENT_FIELDS, toComment, type CommentRecord } from './comments';
import { HISTORY_FIELDS, toHistoryEntry, type HistoryRecord } from './history';
import { INBOX_LIST_FIELDS, toInboxItemSummary, type InboxRecord } from './inbox';
import { PROJECT_FIELDS, toProject, type ProjectRecord } from './projects';
import { READ_FIELDS, toTicketRead, type TicketRead } from './reads';
import { RULE_FIELDS, toRecurrenceRule, type RuleRecord } from './recurrence';
import { TAG_FIELDS, toTag, type TagRecord } from './tags';
import {
	TICKET_DETAIL_FIELDS,
	TICKET_EXPAND,
	TICKET_LIST_FIELDS,
	toTicket,
	toTicketSummary,
	type TicketRecord
} from './tickets';

/** A created or updated record, or the ID of a deleted one. */
export type RecordChange<T> =
	{ action: 'create' | 'update'; record: T } | { action: 'delete'; id: string };

/** Ends one subscription; the connection closes with the last one. */
export type Unsubscribe = () => Promise<void>;

interface RealtimeEvent<R> {
	action: string;
	record: R;
}

/**
 * Turns SDK events into changes of domain records. An event that cannot be mapped (unknown
 * action, a value outside the domain) is dropped: the next load or reconciliation brings the
 * record in its checked form.
 */
function changes<R extends { id: string }, T>(
	map: (record: R) => T,
	onChange: (change: RecordChange<T>) => void
): (event: RealtimeEvent<R>) => void {
	return (event) => {
		if (event.action === 'delete') {
			onChange({ action: 'delete', id: event.record.id });
			return;
		}
		if (event.action !== 'create' && event.action !== 'update') return;
		let record: T;
		try {
			record = map(event.record);
		} catch {
			return;
		}
		onChange({ action: event.action, record });
	};
}

/** All visible tickets with the fields of the list (without description). */
export function subscribeTickets(
	pb: PocketBase,
	onChange: (change: RecordChange<TicketSummary>) => void
): Promise<Unsubscribe> {
	return pb.collection('tickets').subscribe<TicketRecord>('*', changes(toTicketSummary, onChange), {
		fields: TICKET_LIST_FIELDS,
		expand: TICKET_EXPAND
	});
}

/** One ticket with every field of the panel, including the description. */
export function subscribeTicket(
	pb: PocketBase,
	id: string,
	onChange: (change: RecordChange<Ticket>) => void
): Promise<Unsubscribe> {
	return pb.collection('tickets').subscribe<TicketRecord>(id, changes(toTicket, onChange), {
		fields: TICKET_DETAIL_FIELDS,
		expand: TICKET_EXPAND
	});
}

/** Comments of one ticket only. */
export function subscribeComments(
	pb: PocketBase,
	ticketId: string,
	onChange: (change: RecordChange<Comment>) => void
): Promise<Unsubscribe> {
	return pb.collection('comments').subscribe<CommentRecord>('*', changes(toComment, onChange), {
		filter: pb.filter('ticket = {:ticket}', { ticket: ticketId }),
		fields: COMMENT_FIELDS
	});
}

/** History entries of one ticket only. */
export function subscribeHistory(
	pb: PocketBase,
	ticketId: string,
	onChange: (change: RecordChange<HistoryEntry>) => void
): Promise<Unsubscribe> {
	return pb
		.collection('ticket_history')
		.subscribe<HistoryRecord>('*', changes(toHistoryEntry, onChange), {
			filter: pb.filter('ticket = {:ticket}', { ticket: ticketId }),
			fields: HISTORY_FIELDS
		});
}

/** All visible projects, archived ones included, with the fields of the catalog (E3 plan, T-16). */
export function subscribeProjects(
	pb: PocketBase,
	onChange: (change: RecordChange<Project>) => void
): Promise<Unsubscribe> {
	return pb
		.collection('projects')
		.subscribe<ProjectRecord>('*', changes(toProject, onChange), { fields: PROJECT_FIELDS });
}

/** All visible tags with the fields of the catalog (E3 plan, T-16). */
export function subscribeTags(
	pb: PocketBase,
	onChange: (change: RecordChange<Tag>) => void
): Promise<Unsubscribe> {
	return pb
		.collection('tags')
		.subscribe<TagRecord>('*', changes(toTag, onChange), { fields: TAG_FIELDS });
}

/** All visible recurrence rules with every field of the store (E5 plan, T-7). */
export function subscribeRules(
	pb: PocketBase,
	onChange: (change: RecordChange<RecurrenceRule>) => void
): Promise<Unsubscribe> {
	return pb
		.collection('recurrence_rules')
		.subscribe<RuleRecord>('*', changes(toRecurrenceRule, onChange), { fields: RULE_FIELDS });
}

/** All visible inbox entries with the fields of the lists (E4 plan, T-4). */
export function subscribeInboxItems(
	pb: PocketBase,
	onChange: (change: RecordChange<InboxItemSummary>) => void
): Promise<Unsubscribe> {
	return pb
		.collection('inbox_items')
		.subscribe<InboxRecord>('*', changes(toInboxItemSummary, onChange), {
			fields: INBOX_LIST_FIELDS
		});
}

/**
 * Calls `callback` after every new connection that follows an earlier one (ADR-0007 section 3):
 * events of the gap are lost and the stores reconcile once. The first connection is no
 * reconnection, whether it happens before or after this listener is added.
 */
export function onReconnect(pb: PocketBase, callback: () => void): Promise<Unsubscribe> {
	let known = pb.realtime.clientId;
	return pb.realtime.subscribe('PB_CONNECT', (data: { clientId?: unknown }) => {
		const clientId = typeof data.clientId === 'string' ? data.clientId : '';
		if (known !== '' && clientId !== known) callback();
		known = clientId;
	});
}

/** Change of the "new" mark: an own read row, or a new base line of the user (ADR-0015). */
export type ReadChange =
	| { action: 'create' | 'update'; read: TicketRead }
	| { action: 'delete'; id: string }
	| { action: 'baseline'; unreadSince: string };

/**
 * Own read rows and the own base line (`users.unread_since`), so a ticket opened or "Alle als
 * gelesen markieren" in another tab shows here as well (ADR-0015 section 6). The rules deliver
 * only the own rows and the own user record.
 */
export async function subscribeReads(
	pb: PocketBase,
	userId: string,
	onChange: (change: ReadChange) => void
): Promise<Unsubscribe> {
	const reads = await pb.collection('ticket_reads').subscribe<{ id: string; ticket: string }>(
		'*',
		(event) => {
			if (event.action === 'delete') onChange({ action: 'delete', id: event.record.id });
			else if (event.action === 'create' || event.action === 'update') {
				onChange({ action: event.action, read: toTicketRead(event.record) });
			}
		},
		{ fields: READ_FIELDS }
	);
	try {
		const user = await pb.collection('users').subscribe<{ id: string; unread_since?: unknown }>(
			userId,
			(event) => {
				const value = event.record.unread_since;
				if (event.action === 'update' && typeof value === 'string' && value !== '') {
					onChange({ action: 'baseline', unreadSince: value });
				}
			},
			{ fields: 'id,unread_since' }
		);
		return async () => {
			await Promise.all([reads(), user()]);
		};
	} catch (error) {
		await reads();
		throw error;
	}
}
