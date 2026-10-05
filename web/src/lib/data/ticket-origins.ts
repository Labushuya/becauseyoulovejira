// Tickets as sources of other tickets (QT-1, ADR-0067). Stateless functions with the PocketBase
// instance as first parameter. The links (ticket_sources) are only written by the routes, which check
// area and circle in one transaction and write the history of both tickets; they also read them, so
// a source in the trash still shows with "(im Papierkorb)" (the API rules hide it).

import type PocketBase from 'pocketbase';
import {
	followUpRequestBody,
	toFollowUpOutcome,
	toTicketOrigins,
	type FollowUpOutcome,
	type FollowUpRequest,
	type TicketOrigins
} from '../domain/ticket-origins';
import { DataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';

/** Fields of a link for realtime: which tickets it joins. */
export const TICKET_SOURCE_FIELDS = 'id,ticket,source';

/** A link as realtime delivers it. */
export interface TicketSourceLink {
	id: string;
	/** The follow-up. */
	ticket: string;
	/** The ticket it stems from. */
	source: string;
}

/** A record of the server as a link; throws for one without its fields. */
export function toTicketSourceLink(record: {
	id?: unknown;
	ticket?: unknown;
	source?: unknown;
}): TicketSourceLink {
	const { id, ticket, source } = record;
	if (typeof id !== 'string' || typeof ticket !== 'string' || typeof source !== 'string') {
		throw new TypeError('Not a link of tickets');
	}
	return { id, ticket, source };
}

const base = (id: string) => `/api/byl/tickets/${encodeURIComponent(id)}`;

function origins(answer: unknown): TicketOrigins {
	const parsed = toTicketOrigins(answer);
	if (parsed === null) throw new DataError('server');
	return parsed;
}

/** The source tickets, the direct follow-ups and every ticket that stems from a ticket. */
export function getTicketOrigins(
	pb: PocketBase,
	ticketId: string,
	{ signal }: RequestOptions = {}
): Promise<TicketOrigins> {
	return withDataErrors(signal, async () =>
		origins(await pb.send(`${base(ticketId)}/ticket-sources`, { method: 'GET', signal }))
	);
}

/**
 * "Quelle hinzufügen → Ticket": `ticketId` stems from `sourceId` from now on. A link that would close
 * a circle is refused (`validation_ticket_source_cycle` with the chain); one that exists counts as
 * success (`already`). Answers the origins of the ticket.
 */
export function addTicketSource(
	pb: PocketBase,
	ticketId: string,
	sourceId: string,
	{ signal }: RequestOptions = {}
): Promise<TicketOrigins> {
	return withDataErrors(signal, async () =>
		origins(
			await pb.send(`${base(ticketId)}/ticket-sources`, {
				method: 'POST',
				body: { source: sourceId },
				signal
			})
		)
	);
}

/** Removes the source `sourceId` of `ticketId`; a link that is gone counts as success. */
export function removeTicketSource(
	pb: PocketBase,
	ticketId: string,
	sourceId: string,
	{ signal }: RequestOptions = {}
): Promise<TicketOrigins> {
	return withDataErrors(signal, async () =>
		origins(
			await pb.send(`${base(ticketId)}/ticket-sources/${encodeURIComponent(sourceId)}/remove`, {
				method: 'POST',
				body: {},
				signal
			})
		)
	);
}

/** "Folge-Ticket anlegen …": a new ticket that stems from `sourceId`, in one transaction. */
export function createFollowUp(
	pb: PocketBase,
	sourceId: string,
	request: FollowUpRequest,
	{ signal }: RequestOptions = {}
): Promise<FollowUpOutcome> {
	return withDataErrors(signal, async () => {
		const answer: unknown = await pb.send(`${base(sourceId)}/follow-up`, {
			method: 'POST',
			body: followUpRequestBody(request),
			signal
		});
		const outcome = toFollowUpOutcome(answer);
		if (outcome === null) throw new DataError('server');
		return outcome;
	});
}
