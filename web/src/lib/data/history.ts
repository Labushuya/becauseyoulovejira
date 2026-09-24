// History of a ticket (E2 plan, T-10 and T-11). Written only by the hook; read-only here.

import type PocketBase from 'pocketbase';
import type { HistoryEntry } from '../domain/ticket';
import { withDataErrors } from './errors';
import type { RequestOptions } from './options';

const HISTORY_FIELDS = 'id,ticket,field,old_value,new_value,user,created';

export interface HistoryRecord {
	id: string;
	ticket: string;
	field: string;
	old_value: string;
	new_value: string;
	user: string;
	created: string;
}

export function toHistoryEntry(record: HistoryRecord): HistoryEntry {
	return {
		id: record.id,
		ticket: record.ticket,
		field: record.field,
		oldValue: record.old_value,
		newValue: record.new_value,
		user: record.user,
		created: record.created
	};
}

/**
 * All history entries of a ticket, newest first. Entries written in the same millisecond keep
 * their write order through the row id.
 */
export function listHistory(
	pb: PocketBase,
	ticketId: string,
	{ signal }: RequestOptions = {}
): Promise<HistoryEntry[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection('ticket_history').getFullList<HistoryRecord>({
			batch: 500,
			filter: pb.filter('ticket = {:ticket}', { ticket: ticketId }),
			sort: '-created,-@rowid',
			fields: HISTORY_FIELDS,
			signal
		});
		return records.map(toHistoryEntry);
	});
}
