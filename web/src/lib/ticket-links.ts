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
import { replaceCalendarQuery, type CalendarQuery } from './domain/calendar';
import { SETUP_PARAMS, type SetupTarget } from './domain/channel-setup';
import { connectionAnchor } from './domain/sync-all';
import { parseInboxQuery, serializeInboxQuery, type InboxQuery } from './domain/inbox-query';
import {
	PROJECT_VIEW_PARAMS,
	parseProjectViewQuery,
	replaceProjectViewQuery,
	serializeProjectViewQuery,
	type ProjectViewQuery
} from './domain/project-view';
import { projectChoiceLabel } from './domain/project-tree';
import { TEMPLATE_PARAM, TEMPLATE_VALUES, type CaptureTemplate } from './domain/templates';
import type { ProjectRef } from './domain/ticket';

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
 * the filter bar shows it as chosen. `subProjects` false leaves its sub projects out
 * (`unterprojekte=0`, ADR-0034 §6), so the list holds the own tickets of a parent only.
 */
export function projectTicketsHref(projectId: string, subProjects = true): ResolvedPathname {
	const query = serializeListQuery({ ...EMPTY_LIST_QUERY, project: projectId, subProjects });
	return `${resolve('/')}${query}` as ResolvedPathname;
}

/** One step of the path of a ticket (`Breadcrumbs`). */
export interface PathStep {
	label: string;
	href?: string;
	title?: string;
	mono?: boolean;
}

/**
 * Path of a ticket (ADR-0033 section 4, ADR-0034): a ticket in a sub project starts with
 * "Haus › Garten" (links to the panels of the projects, ADR-0054 §6), a sub-task names its parent
 * (link `parent.href`), then the own key. Empty when the ticket has neither; the header then shows
 * the key alone.
 */
export function ticketPathSteps(
	key: string,
	project: ProjectRef | null,
	parent: { key: string; title: string; href: string | null } | null
): PathStep[] {
	const projectSteps: PathStep[] = project?.parent
		? [
				{
					label: project.parent.name,
					href: projectPanelPath(project.parent.id),
					title: `${project.parent.name} (${project.parent.code})`
				},
				{
					label: project.name,
					href: projectPanelPath(project.id),
					title: projectChoiceLabel(project)
				}
			]
		: [];
	if (projectSteps.length === 0 && parent === null) return [];
	const parentSteps: PathStep[] =
		parent === null
			? []
			: [{ label: parent.key, href: parent.href ?? undefined, title: parent.title, mono: true }];
	return [...projectSteps, ...parentSteps, { label: key, mono: true }];
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

/** Panel of a project without the state of the project view (the path in the header of a ticket). */
export function projectPanelPath(id: string): ResolvedPathname {
	return resolve(`/projekte/${encodeURIComponent(id)}`) as ResolvedPathname;
}

/** Panel "Neues Projekt" (UI-8) with the switch of `url`. */
export function newProjectHref(url: URL): ResolvedPathname {
	return `${resolve('/projekte/neu')}${projectViewQuery(url)}` as ResolvedPathname;
}

/** Parameter of "Unterprojekt anlegen": the parent of the new project (ADR-0034). */
export const PARENT_PARAM = 'oberprojekt';

/** "Unterprojekt anlegen" (ADR-0034): "Neues Projekt" with the parent chosen in advance. */
export function newSubProjectHref(parentId: string, url: URL): ResolvedPathname {
	const params = new URLSearchParams(projectViewQuery(url));
	params.set(PARENT_PARAM, parentId);
	return `${resolve('/projekte/neu')}?${params.toString()}` as ResolvedPathname;
}

/** The parent chosen in advance for "Neues Projekt"; null without a well-formed record ID. */
export function parentFrom(url: URL): string | null {
	const values = url.searchParams.getAll(PARENT_PARAM);
	const value = values.length === 1 ? (values[0] ?? '') : '';
	return /^[a-z0-9]{15}$/.test(value) ? value : null;
}

/** Element ID of "Neues Projekt" in the section bar; closing its panel returns the focus to it. */
export const NEW_PROJECT_LINK_ID = 'new-project-link';

/** Overview "Wiederholungen" (E5 plan, T-6 and package 5); it has no state in the URL. */
export function recurrencesHref(): ResolvedPathname {
	return resolve('/wiederholungen');
}

/** Panel of a rule (E5 plan, T-6), addressed by record ID. */
export function recurrenceHref(id: string): ResolvedPathname {
	return resolve(`/wiederholungen/${encodeURIComponent(id)}`) as ResolvedPathname;
}

/** View "Papierkorb" (ADR-0037 §9). */
export function trashHref(): ResolvedPathname {
	return resolve('/papierkorb');
}

/** Read-only preview of a ticket in the trash, addressed by record ID. */
export function trashItemHref(id: string): ResolvedPathname {
	return resolve(`/papierkorb/${encodeURIComponent(id)}`) as ResolvedPathname;
}

/**
 * The calendar (ADR-0053) with the state of `url` (view, date and the filters of the list); without
 * `url` the plain calendar, which shows the view this device remembers.
 */
export function calendarHref(url?: URL): ResolvedPathname {
	return `${resolve('/kalender')}${url?.search ?? ''}` as ResolvedPathname;
}

/** Panel of a ticket next to the calendar, with the state of `url` (ADR-0053 §6). */
export function calendarTicketHref(id: string, url: URL): ResolvedPathname {
	return `${resolve(`/kalender/tickets/${encodeURIComponent(id)}`)}${url.search}` as ResolvedPathname;
}

/** Full view of a ticket over the calendar, with the state of `url`. */
export function calendarFullViewHref(id: string, url: URL): ResolvedPathname {
	return `${resolve(`/kalender/tickets/${encodeURIComponent(id)}/voll`)}${url.search}` as ResolvedPathname;
}

/** The current path with view and date of the calendar; filters and other parameters stay. */
export function withCalendarQuery(url: URL, query: CalendarQuery): ResolvedPathname {
	return `${url.pathname}${replaceCalendarQuery(url.searchParams, query)}${url.hash}` as ResolvedPathname;
}

/** Areas in which a ticket opens next to their own view (ADR-0054): projects, inbox and rules. */
export type TicketArea = 'projekte' | 'eingang' | 'wiederholungen';

/**
 * Query parameter of the panel a ticket replaced in its area (ADR-0054 §2): the record ID of the
 * project, the inbox entry or the rule it was opened from. × and Escape of the ticket lead there.
 */
export const ORIGIN_PARAM = 'von';

const RECORD_ID = /^[a-z0-9]{15}$/;

/** The state of the view of an area in `url` (search, sort, layout, chips); the rules have none. */
function areaState(area: TicketArea, url: URL): URLSearchParams {
	if (area === 'projekte') return new URLSearchParams(projectViewQuery(url));
	if (area === 'eingang') {
		return new URLSearchParams(serializeInboxQuery(parseInboxQuery(url.searchParams)));
	}
	return new URLSearchParams();
}

/**
 * The panel a ticket of `area` replaces (ADR-0054 §2): on the panel of a project, an entry or a
 * rule (`/projekte/<id>`) that one, on a ticket of the area the parameter `von`. Null elsewhere
 * (the view, "Neues Projekt", "Erfassen", a link from outside) and for a value that is no record ID.
 */
export function ticketOriginFrom(area: TicketArea, url: URL): string | null {
	const prefix = `${resolve(`/${area}`)}/`;
	if (url.pathname.startsWith(prefix)) {
		const rest = url.pathname.slice(prefix.length);
		if (RECORD_ID.test(rest)) return rest;
	}
	const values = url.searchParams.getAll(ORIGIN_PARAM);
	const value = values.length === 1 ? (values[0] ?? '') : '';
	return RECORD_ID.test(value) ? value : null;
}

/**
 * Panel of a ticket in `area` (with `full` its full view), with the state of the view of `url` and
 * the panel the ticket replaces as `von` (ADR-0054 §2).
 */
export function areaTicketHref(
	area: TicketArea,
	id: string,
	url: URL,
	full = false
): ResolvedPathname {
	const params = areaState(area, url);
	const origin = ticketOriginFrom(area, url);
	if (origin !== null) params.set(ORIGIN_PARAM, origin);
	const search = params.toString();
	const path = full
		? resolve(`/${area}/tickets/${encodeURIComponent(id)}/voll`)
		: resolve(`/${area}/tickets/${encodeURIComponent(id)}`);
	return `${path}${search === '' ? '' : `?${search}`}` as ResolvedPathname;
}

/**
 * The way back from a ticket in `area` (ADR-0054 §2): the panel of the project, entry or rule it
 * replaced, else the view, each with the state of the view of `url`.
 */
export function areaBackHref(area: TicketArea, url: URL): ResolvedPathname {
	const origin = ticketOriginFrom(area, url);
	if (origin === null) {
		if (area === 'projekte') return projectsViewHref(url);
		return area === 'eingang' ? inboxHref(url) : recurrencesHref();
	}
	if (area === 'projekte') return projectHref(origin, url);
	return area === 'eingang' ? inboxItemHref(origin, url) : recurrenceHref(origin);
}

/** Panel "Neue Regel" (E5 plan, T-6). */
export function newRecurrenceHref(): ResolvedPathname {
	return resolve('/wiederholungen/neu');
}

/** Element ID of "Neue Regel" in the section bar; closing its panel returns the focus to it. */
export const NEW_RULE_LINK_ID = 'new-rule-link';

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
 * Address of a ticket to pass on ("Link kopieren", plan aktionsmenues): absolute, the panel of the
 * ticket without the state of the list, so it opens the same ticket in any tab.
 */
export function ticketShareUrl(id: string, origin: string): string {
	return new URL(ticketPath(id), origin).href;
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

/**
 * Path of the panel of a ticket without any list state: the stored form of a link to a ticket
 * (ADR-0042 §5) and the way into "Aufgaben" from places without a view of their own (trash).
 */
export function ticketPath(id: string): ResolvedPathname {
	return resolve(`/tickets/${encodeURIComponent(id)}`);
}

/** Path of the full view of a ticket without any list state (see `ticketPath`). */
export function fullViewPath(id: string): ResolvedPathname {
	return resolve(`/tickets/${encodeURIComponent(id)}/voll`) as ResolvedPathname;
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

/** The card of a connection on the page "Kanäle" (flag of "Alle Kanäle jetzt abrufen"). */
export function connectionCardHref(id: string): ResolvedPathname {
	return `${resolve('/einstellungen/kanaele')}#${connectionAnchor(id)}` as ResolvedPathname;
}

/** The current path with the template `template` in `?vorlage=`; other parameters stay. */
export function withTemplate(url: URL, template: CaptureTemplate): ResolvedPathname {
	const params = new URLSearchParams(url.searchParams);
	params.set(TEMPLATE_PARAM, TEMPLATE_VALUES[template]);
	return `${url.pathname}?${params.toString()}${url.hash}` as ResolvedPathname;
}
