// Reads of the bulk actions of the ticket table (plan BI-2, ADR-0036 §3 and §5). Every change
// itself goes through the functions of tickets.ts, one ticket at a time, so the hooks check it
// like a change in the panel. Filters always go through pb.filter().

import type PocketBase from 'pocketbase';
import type { CalendarDate } from '../domain/berlin-date';
import { berlinDateOf } from '../domain/format';
import { withDataErrors } from './errors';
import type { RequestOptions } from './options';

const INBOX = 'inbox_items';

/**
 * Events that are the main source of their ticket (ADR-0036 §5): only an entry of the kind
 * `event` (calendar entries from `.ics` files and Google Calendar) and, since ADR-0041 §8, an
 * entry from Notion have a date that is a date of the ticket; the date of a mail or a message is
 * only when it was sent. The main source is the entry the ticket was converted from
 * (`tickets.source_item`), not a source linked later.
 */
const MAIN_EVENT_FILTER = [
	'(kind = {:kind} || channel = {:channel})',
	'source_date != ""',
	'ticket != ""',
	'ticket.source_item = id'
].join(' && ');

interface EventSourceRecord {
	ticket: string;
	source_date: string;
}

/**
 * "Datum der Quelle übernehmen": the Berlin calendar date of the event each ticket was converted
 * from, by ticket ID. Tickets without such a main source are missing. All-day events store the
 * start of their day, so the Berlin date of the start is the date in both cases.
 */
export function listSourceEventDates(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<Map<string, CalendarDate>> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(INBOX).getFullList<EventSourceRecord>({
			batch: 500,
			filter: pb.filter(MAIN_EVENT_FILTER, { kind: 'event', channel: 'notion' }),
			fields: 'ticket,source_date',
			signal
		});
		return new Map(records.map((record) => [record.ticket, berlinDateOf(record.source_date)]));
	});
}

interface LinkedRecord {
	ticket: string;
}

/**
 * Number of sources of the given tickets (ADR-0031, addendum B): every entry with one of them as
 * `ticket`, for the question of "In den Papierkorb …". One request over all linked entries (only
 * their ticket), because a filter over a list of IDs cannot be built from constants.
 */
export function countTicketSources(
	pb: PocketBase,
	ticketIds: readonly string[],
	{ signal }: RequestOptions = {}
): Promise<number> {
	return withDataErrors(signal, async () => {
		if (ticketIds.length === 0) return 0;
		const records = await pb.collection(INBOX).getFullList<LinkedRecord>({
			batch: 1000,
			filter: pb.filter('ticket != ""', {}),
			fields: 'ticket',
			signal
		});
		const wanted = new Set(ticketIds);
		return records.filter((record) => wanted.has(record.ticket)).length;
	});
}
