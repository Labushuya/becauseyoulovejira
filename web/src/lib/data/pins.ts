// Pinned tickets (PIN-1, ADR-0064). Stateless functions with the PocketBase instance as first
// parameter; filters always through pb.filter(). The rules allow only the own pins, and only on
// tickets the account sees (1790204500_ticket_pins.js). A pin has no area of its own: the list
// returns the own pins of every area, and a view shows those whose ticket its list store knows (the
// open tickets of the area of the tab, ADR-0059), so a ticket moved into the other area keeps its pin
// there without a new request.

import type PocketBase from 'pocketbase';
import type { TicketPin } from '../domain/pins';
import { DataError, isDataError, toDataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';

const PINS = 'ticket_pins';

/** Fields of a pin: the ticket and the moment of pinning are all the views need. */
export const PIN_FIELDS = 'id,ticket,created';

/** A record of the server as a pin; throws for one without its fields. */
export function toTicketPin(record: {
	id?: unknown;
	ticket?: unknown;
	created?: unknown;
}): TicketPin {
	const { id, ticket, created } = record;
	if (typeof id !== 'string' || typeof ticket !== 'string' || typeof created !== 'string') {
		throw new TypeError('Not a pin');
	}
	return { id, ticket, created };
}

/**
 * The own pins, oldest first (the order of the section "Angeheftet"); the rules add: on tickets the
 * account sees, not in the trash.
 */
export function listPins(pb: PocketBase, { signal }: RequestOptions = {}): Promise<TicketPin[]> {
	return withDataErrors(signal, async () => {
		const user = currentUserId(pb.authStore.record);
		if (user === null) throw new DataError('session');
		const records = await pb.collection(PINS).getFullList({
			batch: 500,
			filter: pb.filter('user = {:user}', { user }),
			sort: 'created,id',
			fields: PIN_FIELDS,
			signal
		});
		return records.map(toTicketPin);
	});
}

/**
 * Pins a ticket for the signed-in account. A pin that exists already (another tab, a second click)
 * counts as success: the answer is then null. A done ticket, one the account does not see and one in
 * the trash are refused.
 */
export async function pinTicket(
	pb: PocketBase,
	ticketId: string,
	{ signal }: RequestOptions = {}
): Promise<TicketPin | null> {
	try {
		return await withDataErrors(signal, async () => {
			const user = currentUserId(pb.authStore.record);
			if (user === null) throw new DataError('session');
			const record = await pb
				.collection(PINS)
				.create({ user, ticket: ticketId }, { fields: PIN_FIELDS, signal });
			return toTicketPin(record);
		});
	} catch (error) {
		const taken = Object.values(isDataError(error) ? error.fields : {}).some(
			(field) => field.code === 'validation_not_unique'
		);
		if (taken) return null;
		throw error;
	}
}

/** Releases an own pin; one that is gone already (another tab, completed) counts as success. */
export async function unpinTicket(
	pb: PocketBase,
	pinId: string,
	{ signal }: RequestOptions = {}
): Promise<void> {
	try {
		await pb.collection(PINS).delete(pinId, { signal });
	} catch (error) {
		const failure = toDataError(error, signal);
		if (failure.kind === 'not_found') return;
		throw failure;
	}
}
