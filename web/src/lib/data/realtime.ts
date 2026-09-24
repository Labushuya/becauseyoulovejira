// Realtime subscriptions (ADR-0007 section 2). Thin functions around the SDK: they set the same
// fields and expands as the loading functions, filter with pb.filter() and map the records to
// domain types, so events and answers go through the same idempotent store methods. The server
// filters every event by the list and view rules of the collection.

import type PocketBase from 'pocketbase';
import type { Project } from '../domain/project';
import type { Tag } from '../domain/tag';
import type { Comment, HistoryEntry, Ticket, TicketSummary } from '../domain/ticket';
import { COMMENT_FIELDS, toComment, type CommentRecord } from './comments';
import { HISTORY_FIELDS, toHistoryEntry, type HistoryRecord } from './history';
import { PROJECT_FIELDS, toProject, type ProjectRecord } from './projects';
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
