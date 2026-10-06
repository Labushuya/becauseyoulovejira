// "Neues Ticket" with everything at once (NT-1, ADR-0069). Stateless functions with the PocketBase
// instance as first parameter; the root integration tests run them against the disposable instance.
// The route creates the ticket and its options in one transaction, or nothing; afterwards the ticket
// (and the rule of a series) are read with the fields of the panel.

import type PocketBase from 'pocketbase';
import {
	createRequestBody,
	toCreateOutcome,
	toCreateSupport,
	type CreateOutcome,
	type CreateRequest,
	type CreateSupport
} from '../domain/ticket-create';
import { fromDueInput, type Ticket } from '../domain/ticket';
import { clientHousehold } from './area';
import { DataError, toDataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';
import { getTicket } from './tickets';

const ROUTE = '/api/byl/tickets/create';

/** A created ticket as the panel shows it, with the answer of the route. */
export interface CreatedTicket {
	ticket: Ticket;
	outcome: CreateOutcome;
}

/**
 * Creates the ticket of the signed-in user with everything the request names, in the area of the
 * client (E7-3) or in `household` ('' for "Privat") when given. A refusal comes per field like the
 * Record API (`DataError` of kind `validation`); then nothing was created.
 */
export function createTicketWithOptions(
	pb: PocketBase,
	request: CreateRequest,
	{ signal, household }: RequestOptions & { household?: string } = {}
): Promise<CreatedTicket> {
	return withDataErrors(signal, async () => {
		const area = household ?? clientHousehold(pb);
		const answer: unknown = await pb.send(ROUTE, {
			method: 'POST',
			body: createRequestBody(request, area, (due) => fromDueInput(due ?? '')),
			requestKey: null,
			signal
		});
		const outcome = toCreateOutcome(answer);
		if (outcome === null) throw new DataError('server');
		return { ticket: await getTicket(pb, outcome.id, { signal }), outcome };
	});
}

/**
 * The options the server knows, or null before the restart after NT-1 (the route is missing and
 * answers 404): then "Neues Ticket" creates as before.
 */
export async function fetchCreateSupport(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<CreateSupport | null> {
	try {
		const answer: unknown = await pb.send(ROUTE, { method: 'GET', requestKey: null, signal });
		const support = toCreateSupport(answer);
		if (support === null) throw new DataError('server');
		return support;
	} catch (error) {
		const failure = toDataError(error, signal);
		if (failure.kind === 'not_found') return null;
		throw failure;
	}
}
