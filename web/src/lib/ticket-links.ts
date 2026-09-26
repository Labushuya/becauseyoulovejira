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
import { SETUP_PARAMS, type SetupTarget } from './domain/channel-setup';
import { parseInboxQuery, serializeInboxQuery, type InboxQuery } from './domain/inbox-query';
import {
	PROJECT_VIEW_PARAMS,
	parseProjectViewQuery,
	replaceProjectViewQuery,
	serializeProjectViewQuery,
	type ProjectViewQuery
} from './domain/project-view';
import { TEMPLATE_PARAM, TEMPLATE_VALUES, type CaptureTemplate } from './domain/templates';

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
export const SHOW_ARCHIVED_PARAM = PROJECT_VIEW_PARAMS.showArchived;

export function showArchivedFrom(url: URL): boolean {
	return parseProjectViewQuery(url.searchParams).showArchived;
}

/**
 * The state of the project view in `url` (search, sort, "Archivierte anzeigen", layout) as query,
 * so opening and closing a panel keeps the list or the tiles as they were.
 */
function projectViewQuery(url: URL): string {
	return serializeProjectViewQuery(parseProjectViewQuery(url.searchParams));
}

/** Project view with the state of `url` (closing a project panel, UI-8). */
export function projectsViewHref(url: URL): ResolvedPathname {
	return `${resolve('/projekte')}${projectViewQuery(url)}` as ResolvedPathname;
}

/** Panel of a project (ADR-0025 section 10, UI-8) with the switch of `url`. */
export function projectHref(id: string, url: URL): ResolvedPathname {
	return `${resolve(`/projekte/${encodeURIComponent(id)}`)}${projectViewQuery(url)}` as ResolvedPathname;
}

/** Panel "Neues Projekt" (UI-8) with the switch of `url`. */
export function newProjectHref(url: URL): ResolvedPathname {
	return `${resolve('/projekte/neu')}${projectViewQuery(url)}` as ResolvedPathname;
}

/** Element ID of "Neues Projekt" in the section bar; closing its panel returns the focus to it. */
export const NEW_PROJECT_LINK_ID = 'new-project-link';

/** The current path with the switch "Archivierte anzeigen" set or removed; others stay. */
export function withShowArchived(url: URL, show: boolean): ResolvedPathname {
	const query = parseProjectViewQuery(url.searchParams);
	return withProjectViewQuery(url, { ...query, showArchived: show });
}

/** The current path with the given state of the project view; other parameters stay. */
export function withProjectViewQuery(url: URL, query: ProjectViewQuery): ResolvedPathname {
	return `${url.pathname}${replaceProjectViewQuery(url.searchParams, query)}${url.hash}` as ResolvedPathname;
}

/** Path of the detail panel of a ticket with the query of `url`. */
export function ticketHref(id: string, url: URL): ResolvedPathname {
	return `${resolve(`/tickets/${encodeURIComponent(id)}`)}${url.search}` as ResolvedPathname;
}

/**
 * Path of the full view of a ticket (ADR-0025 section 7) with the query of `url`, so closing it
 * returns to the panel over the same list.
 */
export function fullViewHref(id: string, url: URL): ResolvedPathname {
	return `${resolve(`/tickets/${encodeURIComponent(id)}/voll`)}${url.search}` as ResolvedPathname;
}

/** Selector of the link "Vollansicht öffnen" in the panel; closing the full view focuses it. */
export const FULL_VIEW_LINK = '[data-full-view-link]';

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

/** Query parameter of "Neues Ticket" with the inbox entry to convert (E4 plan, T-3). */
export const CONVERT_PARAM = 'aus';

/** Path of the inbox with the view state (chips) of `url`, or the plain inbox without `url`. */
export function inboxHref(url?: URL): ResolvedPathname {
	const query = url === undefined ? '' : serializeInboxQuery(parseInboxQuery(url.searchParams));
	return `${resolve('/eingang')}${query}` as ResolvedPathname;
}

/** Path of an inbox entry in the panel, with the view state of `url`. */
export function inboxItemHref(id: string, url?: URL): ResolvedPathname {
	const query = url === undefined ? '' : serializeInboxQuery(parseInboxQuery(url.searchParams));
	return `${resolve(`/eingang/${encodeURIComponent(id)}`)}${query}` as ResolvedPathname;
}

/** The current inbox path with the view state `query`; other parameters stay. */
export function withInboxQuery(url: URL, query: InboxQuery): ResolvedPathname {
	return `${url.pathname}${serializeInboxQuery(query, url.searchParams)}${url.hash}` as ResolvedPathname;
}

/** Form "Neues Ticket" filled from an inbox entry (T-5). */
export function convertHref(id: string): ResolvedPathname {
	const params = new URLSearchParams({ [CONVERT_PARAM]: id });
	return `${resolve('/tickets/neu')}?${params.toString()}` as ResolvedPathname;
}

/** The inbox entry to convert (`?aus=`), null without one or for a value that is no record ID. */
export function convertFrom(url: URL): string | null {
	const values = url.searchParams.getAll(CONVERT_PARAM);
	const id = values.length === 1 ? (values[0] ?? '') : '';
	return /^[a-z0-9]{15}$/.test(id) ? id : null;
}

/** `url` without `?aus=`, so links after converting do not carry the entry along. */
export function withoutConvert(url: URL): URL {
	const next = new URL(url);
	next.searchParams.delete(CONVERT_PARAM);
	return next;
}

/** Path of the panel of a ticket without any list state (links from the inbox). */
export function ticketPath(id: string): ResolvedPathname {
	return resolve(`/tickets/${encodeURIComponent(id)}`);
}

/**
 * Path, query and hash of a URL of this app, e.g. the target of a navigation that was held up for
 * a question (ADR-0025 section 4). SvelteKit gives such targets with the base path already in.
 */
export function appHref(url: URL): ResolvedPathname {
	return `${url.pathname}${url.search}${url.hash}` as ResolvedPathname;
}

/** Path of the capture form (E4 plan, T-3 and package 5) with the view state of `url`. */
export function captureHref(url?: URL): ResolvedPathname {
	const query = url === undefined ? '' : serializeInboxQuery(parseInboxQuery(url.searchParams));
	return `${resolve('/eingang/neu')}${query}` as ResolvedPathname;
}

/**
 * The page "Kanäle" with the setup assistant of `kind` (plan EH-5 §3.1), for a connection once it
 * exists: `?einrichten=<art>&verbindung=<id>`; without a target the page alone.
 */
export function channelSetupHref(target: SetupTarget | null): ResolvedPathname {
	const base = resolve('/einstellungen/kanaele');
	if (target === null) return base;
	const params = new URLSearchParams({ [SETUP_PARAMS.kind]: target.kind });
	if (target.connectionId !== null) params.set(SETUP_PARAMS.connection, target.connectionId);
	return `${base}?${params.toString()}` as ResolvedPathname;
}

/** The current path with the template `template` in `?vorlage=`; other parameters stay. */
export function withTemplate(url: URL, template: CaptureTemplate): ResolvedPathname {
	const params = new URLSearchParams(url.searchParams);
	params.set(TEMPLATE_PARAM, TEMPLATE_VALUES[template]);
	return `${url.pathname}?${params.toString()}${url.hash}` as ResolvedPathname;
}
