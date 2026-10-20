// History of a ticket (E2 plan, T-10 and T-11). Written only by the hook; read-only here.

import type PocketBase from 'pocketbase';
import type { HistoryEntry } from '../domain/ticket';
import { withDataErrors } from './errors';
import { HISTORY_FIELDS, historyFields } from './history-marks';
import type { RequestOptions } from './options';

export { HISTORY_FIELDS };

export interface HistoryRecord {
	id: string;
	ticket: string;
	field: string;
	old_value: string;
	new_value: string;
	user: string;
	created: string;
	/** Missing before the migration of OF-1 and while the fields are not asked for. */
	offline?: boolean;
	device_at?: string;
}

export function toHistoryEntry(record: HistoryRecord): HistoryEntry {
	return {
		id: record.id,
		ticket: record.ticket,
		field: record.field,
		oldValue: record.old_value,
		newValue: record.new_value,
		user: record.user,
		created: record.created,
		// Only an entry of the outbox carries the mark; every other one keeps its form.
		...(record.offline === true && { offline: true as const, deviceAt: record.device_at || null })
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
			fields: historyFields(),
			signal
		});
		return records.map(toHistoryEntry);
	});
}
