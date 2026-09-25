// What the route of a ticket (/tickets/<id>, its +layout.svelte) hands to the full view below it
// (/tickets/<id>/voll, ADR-0025 section 7): the one way to leave after deleting, which sets the
// flag that lets the navigation pass without asking about unsaved text.

import { createContext } from 'svelte';

export interface TicketRoute {
	/** The ticket was deleted: back to the list without the question about unsaved text. */
	deleted(): Promise<void>;
}

const [getTicketRoute, setTicketRoute] = createContext<TicketRoute>();

export { getTicketRoute, setTicketRoute };
