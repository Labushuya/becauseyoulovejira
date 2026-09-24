// URLs of the ticket views (E2 plan, T-4 and T-5; E3 plan, T-2). Tickets are addressed by record
// ID, never by key (CLAUDE.md section 5). The list state lives in the query and travels with
// every link, so opening or closing a ticket keeps filters, sort and the switch "Erledigte
// anzeigen". Reading and writing the list parameters goes through domain/list-query.ts.

import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import {
	EMPTY_LIST_QUERY,
	LIST_PARAMS,
	parseListQuery,
	serializeListQuery,
	type ListQuery
} from './domain/list-query';

/** Query parameter of the switch "Erledigte anzeigen" (CLAUDE.md section 7). */
export const SHOW_DONE_PARAM = LIST_PARAMS.showDone;

export function showDoneFrom(url: URL): boolean {
	return parseListQuery(url.searchParams).showDone;
}

/** Path of the list with the query of `url`. */
export function listHref(url: URL): ResolvedPathname {
	return `${resolve('/')}${url.search}` as ResolvedPathname;
}

/**
 * Tickets of a project (E3 plan, T-12): the list filtered by the project, nothing else set, so
 * the filter bar shows it as chosen.
 */
export function projectTicketsHref(projectId: string): ResolvedPathname {
	const query = serializeListQuery({ ...EMPTY_LIST_QUERY, project: projectId });
	return `${resolve('/')}${query}` as ResolvedPathname;
}

/** Path of the project view (E3 plan, T-3 and package 14). */
export function projectsHref(): ResolvedPathname {
	return resolve('/projekte');
}

/** Query parameter of the switch "Archivierte anzeigen" in the project view (package 14). */
export const SHOW_ARCHIVED_PARAM = 'archiviert';

export function showArchivedFrom(url: URL): boolean {
	const values = url.searchParams.getAll(SHOW_ARCHIVED_PARAM);
	return values.length === 1 && values[0] === '1';
}

/** The current path with the switch "Archivierte anzeigen" set or removed; others stay. */
export function withShowArchived(url: URL, show: boolean): ResolvedPathname {
	const params = new URLSearchParams(url.searchParams);
	params.delete(SHOW_ARCHIVED_PARAM);
	if (show) params.append(SHOW_ARCHIVED_PARAM, '1');
	const search = params.toString();
	return `${url.pathname}${search === '' ? '' : `?${search}`}${url.hash}` as ResolvedPathname;
}

/** Path of the detail panel of a ticket with the query of `url`. */
export function ticketHref(id: string, url: URL): ResolvedPathname {
	return `${resolve(`/tickets/${encodeURIComponent(id)}`)}${url.search}` as ResolvedPathname;
}

/**
 * Element ID of the main button "Neues Ticket" in the header (E3 plan, T-18): the table returns
 * the focus to it when the form closes without a new ticket.
 */
export const NEW_TICKET_LINK_ID = 'new-ticket-link';

/** Path of the form "Neues Ticket" with the query of `url`. */
export function newTicketHref(url: URL): ResolvedPathname {
	return `${resolve('/tickets/neu')}${url.search}` as ResolvedPathname;
}

/**
 * The current path with the list state `query`; parameters the list does not know stay. Invalid
 * list parameters of `url` are dropped, because they count as not set.
 */
export function withListQuery(url: URL, query: ListQuery): ResolvedPathname {
	// url.pathname is already resolved (it contains the base path).
	return `${url.pathname}${serializeListQuery(query, url.searchParams)}${url.hash}` as ResolvedPathname;
}

/** The current path with the switch "Erledigte anzeigen" set or removed; other parameters stay. */
export function withShowDone(url: URL, show: boolean): ResolvedPathname {
	return withListQuery(url, { ...parseListQuery(url.searchParams), showDone: show });
}
