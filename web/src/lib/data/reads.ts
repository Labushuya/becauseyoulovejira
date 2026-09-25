// Read rows of the "new" mark (ADR-0015; E4 plan, package 4). Stateless functions with the
// PocketBase instance as first parameter; filters always through pb.filter(). The rules allow
// only the own rows and rows for visible tickets (1790201300_create_ticket_reads.js).

import type PocketBase from 'pocketbase';
import type { Status } from '../domain/status';
import { DataError, isDataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';

const READS = 'ticket_reads';

/** Fields of a read row: the ticket is all the list needs. */
export const READ_FIELDS = 'id,ticket';

/** Read row of the signed-in user. */
export interface TicketRead {
	id: string;
	ticket: string;
}

/**
 * Own read rows of the tickets that can still be new: not done and created at or after the base
 * line (ADR-0015 section 6). Older and done tickets are never new, their rows are not needed.
 */
const READS_FILTER = [
	'user = {:user}',
	'ticket.status != {:done}',
	'ticket.created >= {:since}'
].join(' && ');

export function toTicketRead(record: { id: string; ticket: string }): TicketRead {
	return { id: record.id, ticket: record.ticket };
}

export function listReads(
	pb: PocketBase,
	since: string,
	{ signal }: RequestOptions = {}
): Promise<TicketRead[]> {
	return withDataErrors(signal, async () => {
		const user = currentUserId(pb.authStore.record);
		if (user === null) throw new DataError('session');
		const records = await pb.collection(READS).getFullList<TicketRead>({
			batch: 500,
			filter: pb.filter(READS_FILTER, { user, done: 'done' satisfies Status, since }),
			fields: READ_FIELDS,
			signal
		});
		return records.map(toTicketRead);
	});
}

/**
 * Marks a ticket as read for the signed-in user. A row that exists already (another tab, a
 * second click) counts as success: the answer is then null (ADR-0015 section 3).
 */
export async function markRead(
	pb: PocketBase,
	ticketId: string,
	{ signal }: RequestOptions = {}
): Promise<TicketRead | null> {
	try {
		return await withDataErrors(signal, async () => {
			const user = currentUserId(pb.authStore.record);
			if (user === null) throw new DataError('session');
			const record = await pb
				.collection(READS)
				.create<TicketRead>({ user, ticket: ticketId }, { fields: READ_FIELDS, signal });
			return toTicketRead(record);
		});
	} catch (error) {
		const taken = Object.values(isDataError(error) ? error.fields : {}).some(
			(field) => field.code === 'validation_not_unique'
		);
		if (taken) return null;
		throw error;
	}
}

/**
 * "Alle als gelesen markieren" (ADR-0015 section 4): moves the base line of the signed-in user to
 * now. Returns the stored base line in the format of the server. Own rows stay; they do no harm.
 */
export function markAllRead(pb: PocketBase, { signal }: RequestOptions = {}): Promise<string> {
	return withDataErrors(signal, async () => {
		const user = currentUserId(pb.authStore.record);
		if (user === null) throw new DataError('session');
		const record = await pb
			.collection('users')
			.update<{ unread_since?: string }>(
				user,
				{ unread_since: new Date().toISOString() },
				{ fields: 'id,unread_since', signal }
			);
		if (typeof record.unread_since !== 'string' || record.unread_since === '') {
			throw new DataError('server');
		}
		return record.unread_since;
	});
}
