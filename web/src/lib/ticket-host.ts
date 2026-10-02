// Where the panel and the full view of a ticket stand (ADR-0053 §6, ADR-0054): next to the list
// "Aufgaben" (/tickets/<id>, /tickets/<id>/voll), next to the calendar (/kalender/tickets/<id>, …/voll)
// and in the areas projects, inbox and rules (/projekte/tickets/<id>, /eingang/tickets/<id>,
// /wiederholungen/tickets/<id>, each with …/voll). All routes render the same parts
// (TicketRouteLayout, TicketFullViewRoute); the host names their addresses, the way back to its
// view and the element of the ticket in the view, which gets the focus after the full view closed.
// Every ticket link of a component below a host follows it (`ticketLinks()`), so the panel of a
// sub-task or a duplicate opens there too. Without a host in the context the list is the host.
// In an area the ticket takes the one panel column: it replaces the panel of the project, entry or
// rule it was opened from, which the address names as `von`, and × leads back there (ADR-0054 §2).

import { createContext } from 'svelte';
import type { ResolvedPathname } from '$app/types';
import type { OpenMode } from './domain/open-mode';
import {
	areaBackHref,
	areaTicketHref,
	calendarFullViewHref,
	calendarHref,
	calendarTicketHref,
	fullViewHref,
	fullViewPath,
	listHref,
	ticketHref,
	ticketOriginFrom,
	ticketPath,
	type TicketArea
} from './ticket-links';

export interface TicketHost {
	/** Route IDs of the panel and of the full view below this host. */
	readonly panelRoute: string;
	readonly fullRoute: string;
	/** Text of the way back when the ticket is gone ("Zur Liste"). */
	readonly backLabel: string;
	/** The way back: × of the panel and of the full view lead there. */
	view(url: URL): ResolvedPathname;
	/** Panel of a ticket with the state of `url`. */
	panel(id: string, url: URL): ResolvedPathname;
	/** Full view of a ticket with the state of `url`. */
	full(id: string, url: URL): ResolvedPathname;
	/**
	 * A link from a place without the state of this host (`ticketLinks().path`); without it such a
	 * link is the panel or the full view with the state of the current address.
	 */
	path?(id: string, mode: OpenMode): ResolvedPathname;
	/**
	 * The element that opens the ticket in the view; the focus goes there after the full view.
	 * `url` is the address of the ticket, which names the panel it came from in an area.
	 */
	entryOf(id: string, url?: URL): HTMLElement | null;
}

/** The list "Aufgaben": the rows of the table. Links from places without a view lead there. */
export const LIST_HOST: TicketHost = Object.freeze({
	panelRoute: '/(app)/(tickets)/tickets/[id]',
	fullRoute: '/(app)/(tickets)/tickets/[id]/voll',
	backLabel: 'Zur Liste',
	view: listHref,
	panel: ticketHref,
	full: fullViewHref,
	path: (id: string, mode: OpenMode) => (mode === 'full' ? fullViewPath(id) : ticketPath(id)),
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

/** Attribute of a link that opens a ticket in an area (ADR-0054 §3), with its record ID. */
export const TICKET_LINK_ATTRIBUTE = 'data-ticket-link';

/** Attribute of the two parts of a view with a panel (`ViewWithPanel`): "list" and "panel". */
export const VIEW_PART_ATTRIBUTE = 'data-view-part';

/** The first link to the ticket `id` below `root`, or null. */
export function ticketLinkIn(root: ParentNode | null | undefined, id: string): HTMLElement | null {
	if (root === null || root === undefined) return null;
	return (
		[...root.querySelectorAll<HTMLElement>(`[${TICKET_LINK_ATTRIBUTE}]`)].find(
			(link) => link.getAttribute(TICKET_LINK_ATTRIBUTE) === id
		) ?? null
	);
}

/** What the layout of an area knows of the shown page. */
export interface AreaPage {
	readonly route: { readonly id: string | null };
	readonly params: Partial<Record<string, string>>;
	readonly url: URL;
}

/** A host of an area: it also knows the panel a ticket replaced. */
export interface AreaTicketHost extends TicketHost {
	/** The project, entry or rule whose panel the ticket at `url` replaced, or null. */
	origin(url: URL): string | null;
	/**
	 * What the view marks (ADR-0054 §4): the project, entry or rule of its panel, or, while a
	 * ticket replaced that panel, the one it came from. Never the ID of a ticket: the effects of
	 * the views (focus, counted projects) take only their own IDs.
	 */
	activeIn(page: AreaPage): string | null;
	/** Whether the view has its panel column: not alone, not for the full view of a ticket. */
	panelShown(routeId: string | null): boolean;
}

/** The list or the panel part of the shown view. */
function viewPart(part: 'list' | 'panel'): Element | null {
	return document.querySelector(`[${VIEW_PART_ATTRIBUTE}="${part}"]`);
}

function areaHost(area: TicketArea, backLabel: string): AreaTicketHost {
	const origin = (url: URL) => ticketOriginFrom(area, url);
	const panelRoute = `/(app)/${area}/tickets/[id]`;
	const fullRoute = `/(app)/${area}/tickets/[id]/voll`;
	return Object.freeze({
		panelRoute,
		fullRoute,
		backLabel,
		view: (url: URL) => areaBackHref(area, url),
		panel: (id: string, url: URL) => areaTicketHref(area, id, url),
		full: (id: string, url: URL) => areaTicketHref(area, id, url, true),
		origin,
		activeIn: (page: AreaPage) => {
			if (page.route.id === panelRoute || page.route.id === fullRoute) return origin(page.url);
			return page.route.id === `/(app)/${area}/[id]` ? (page.params.id ?? null) : null;
		},
		// The full view replaces the panel (ADR-0036 §1): the view has no panel column meanwhile.
		panelShown: (routeId: string | null) => routeId !== `/(app)/${area}` && routeId !== fullRoute,
		// Back in the panel the ticket came from, its link there; else (a link of the view opened it
		// while that panel was open, or there was none) the link in the view.
		entryOf: (id: string, url?: URL) => {
			const inPanel =
				url !== undefined && origin(url) !== null ? ticketLinkIn(viewPart('panel'), id) : null;
			return inPanel ?? ticketLinkIn(viewPart('list'), id);
		}
	});
}

/** Projects (ADR-0054): the open tickets of the list rows and of the project panel. */
export const PROJECTS_HOST = areaHost('projekte', 'Zu den Projekten');

/** Inbox (ADR-0054): the tickets of entries, of duplicates and of results. */
export const INBOX_HOST = areaHost('eingang', 'Zum Eingang');

/** Rules (ADR-0054): the open tickets of the rules. */
export const RECURRENCES_HOST = areaHost('wiederholungen', 'Zu den Wiederholungen');

/** Whether `routeId` is the panel or the full view of a ticket below `host`. */
export function isTicketRoute(host: TicketHost, routeId: string | null | undefined): boolean {
	return routeId === host.panelRoute || routeId === host.fullRoute;
}

const [getTicketHost, setTicketHost, hasTicketHost] = createContext<TicketHost>();

/** The host of the component: the calendar or an area below its layout, else the list. */
export function findTicketHost(): TicketHost {
	return hasTicketHost() ? getTicketHost() : LIST_HOST;
}

export { setTicketHost };
