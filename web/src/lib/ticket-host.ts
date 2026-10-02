// Where the panel and the full view of a ticket stand (ADR-0053 §6): next to the list "Aufgaben"
// (/tickets/<id>, /tickets/<id>/voll) or next to the calendar (/kalender/tickets/<id>, …/voll).
// Both routes render the same parts (TicketRouteLayout, TicketFullViewRoute); the host names their
// addresses, the way back to its view and the element of the ticket in the view, which gets the
// focus after the full view closed. Every ticket link of a component below the calendar follows its
// host (`ticketLinks()`), so the panel of a sub-task or a duplicate opens next to the calendar too.
// Without a host in the context the list is the host, as before the calendar.

import { createContext } from 'svelte';
import type { ResolvedPathname } from '$app/types';
import {
	calendarFullViewHref,
	calendarHref,
	calendarTicketHref,
	fullViewHref,
	listHref,
	ticketHref
} from './ticket-links';

export interface TicketHost {
	/** Route IDs of the panel and of the full view below this host. */
	readonly panelRoute: string;
	readonly fullRoute: string;
	/** Text of the way back when the ticket is gone ("Zur Liste"). */
	readonly backLabel: string;
	/** The view without a panel: × of the panel and of the full view lead there. */
	view(url: URL): ResolvedPathname;
	/** Panel of a ticket with the state of `url`. */
	panel(id: string, url: URL): ResolvedPathname;
	/** Full view of a ticket with the state of `url`. */
	full(id: string, url: URL): ResolvedPathname;
	/** The element that opens the ticket in the view; the focus goes there after the full view. */
	entryOf(id: string): HTMLElement | null;
}

/** The list "Aufgaben": the rows of the table. */
export const LIST_HOST: TicketHost = Object.freeze({
	panelRoute: '/(app)/(tickets)/tickets/[id]',
	fullRoute: '/(app)/(tickets)/tickets/[id]/voll',
	backLabel: 'Zur Liste',
	view: listHref,
	panel: ticketHref,
	full: fullViewHref,
	entryOf: (id: string) =>
		[...document.querySelectorAll<HTMLElement>('tr[data-ticket-id]')]
			.find((row) => row.dataset.ticketId === id)
			?.querySelector<HTMLElement>('a.title-link') ?? null
});

/** Attribute of the link of a ticket in the calendar, with its record ID. */
export const CALENDAR_TICKET_ATTRIBUTE = 'data-calendar-ticket';

/** The calendar (ADR-0053): its entries of tickets. */
export const CALENDAR_HOST: TicketHost = Object.freeze({
	panelRoute: '/(app)/kalender/tickets/[id]',
	fullRoute: '/(app)/kalender/tickets/[id]/voll',
	backLabel: 'Zum Kalender',
	view: (url: URL) => calendarHref(url),
	panel: calendarTicketHref,
	full: calendarFullViewHref,
	entryOf: (id: string) =>
		[...document.querySelectorAll<HTMLElement>(`[${CALENDAR_TICKET_ATTRIBUTE}]`)].find(
			(entry) => entry.getAttribute(CALENDAR_TICKET_ATTRIBUTE) === id
		) ?? null
});

const [getTicketHost, setTicketHost, hasTicketHost] = createContext<TicketHost>();

/** The host of the component: the calendar below its layout, else the list. */
export function findTicketHost(): TicketHost {
	return hasTicketHost() ? getTicketHost() : LIST_HOST;
}

export { setTicketHost };
