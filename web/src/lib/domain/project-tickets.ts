// Open tickets of a project in the project view (ADR-0034, addendum "Offene Tickets in Projekten";
// plan projekte-tickets). Pure. The list store holds every open ticket live (ADR-0006, ADR-0042
// §4); these functions only group, order and cut them, so the project view asks the server for
// nothing. Open means not done; tickets in the trash never reach the client (ADR-0037 §3). A
// project shows its own tickets; a sub project shows its own below it (ADR-0034 §6). The order is
// by due date (without one last), then priority (urgent first), then key. Which rows of the list
// show their tickets is a preference of this device, kept in localStorage (`byl-projects-tickets`).

import { compareKeys, PRIORITY_RANK } from './ordering';
import type { TicketSummary } from './ticket';

/** Tickets shown per project; the rest is behind "Alle N in Aufgaben öffnen". */
export const PROJECT_TICKETS_LIMIT = 10;

/** Key of the rows whose tickets are shown, in localStorage; only IDs, nothing else. */
export const PROJECT_TICKETS_STORAGE_KEY = 'byl-projects-tickets';

/** At most this many rows are remembered; the ones opened longest ago go first. */
export const PROJECT_TICKETS_REMEMBERED_MAX = 500;

/** What the order needs of a ticket. */
export type ProjectTicket = Pick<TicketSummary, 'id' | 'key' | 'due' | 'priority'>;

/** Due date first (without one last), then priority (urgent first), then key, then ID. */
export function compareProjectTickets(a: ProjectTicket, b: ProjectTicket): number {
	if (a.due !== b.due) {
		if (a.due === null) return 1;
		if (b.due === null) return -1;
		return a.due < b.due ? -1 : 1;
	}
	return (
		PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
		compareKeys(a.key, b.key) ||
		(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	);
}

/** The open tickets of one project, in the order above; done ones never count. */
export function openTicketsOf<T extends TicketSummary>(
	tickets: Iterable<T>,
	projectId: string
): T[] {
	const list: T[] = [];
	for (const ticket of tickets) {
		if (ticket.projectId === projectId && ticket.status !== 'done') list.push(ticket);
	}
	return list.sort(compareProjectTickets);
}

/**
 * The open tickets of every project in one pass (the project list, many rows at once), each list
 * in the order above. Tickets without a project and done ones are left out.
 */
export function openTicketsByProject<T extends TicketSummary>(
	tickets: Iterable<T>
): Map<string, T[]> {
	const byProject = new Map<string, T[]>();
	for (const ticket of tickets) {
		if (ticket.projectId === null || ticket.status === 'done') continue;
		const list = byProject.get(ticket.projectId);
		if (list === undefined) byProject.set(ticket.projectId, [ticket]);
		else list.push(ticket);
	}
	for (const list of byProject.values()) list.sort(compareProjectTickets);
	return byProject;
}

/** What a list shows of the tickets of a project. */
export interface ProjectTicketsSlice<T> {
	/** The first `limit` tickets. */
	shown: T[];
	/** All open tickets of the project. */
	total: number;
	/** More than shown: the list ends with "Alle N in Aufgaben öffnen". */
	more: boolean;
}

/** The first `limit` of the ordered tickets and whether more follow. */
export function sliceProjectTickets<T>(
	ordered: readonly T[],
	limit = PROJECT_TICKETS_LIMIT
): ProjectTicketsSlice<T> {
	return {
		shown: ordered.slice(0, limit),
		total: ordered.length,
		more: ordered.length > limit
	};
}

/**
 * A list whose open tickets failed to load; the view says why above the list, with "Erneut
 * versuchen".
 */
export const PROJECT_TICKETS_FAILED = 'Die offenen Tickets ließen sich nicht laden.';

/** The link after the shown tickets: "Alle 12 in Aufgaben öffnen". */
export function allTicketsText(total: number): string {
	return `Alle ${total} in Aufgaben öffnen`;
}

/**
 * Name of the list of a project. A parent lists only its own tickets (its sub projects list
 * theirs), so it says "direkt in"; its numbers include the sub projects (ADR-0034 §6).
 */
export function projectTicketsLabel(name: string, ownOnly: boolean): string {
	return ownOnly ? `Offene Tickets direkt in „${name}“` : `Offene Tickets von „${name}“`;
}

/** The empty list of a project, worded like its name. */
export function noProjectTicketsText(name: string, ownOnly: boolean): string {
	return ownOnly ? `Keine offenen Tickets direkt in „${name}“` : 'Keine offenen Tickets';
}

const RECORD_ID = /^[a-z0-9]{15}$/;

/** The rows whose tickets are shown; empty without a valid entry or with a blocked storage. */
export function readOpenProjectTickets(storage: Pick<Storage, 'getItem'> | null): string[] {
	try {
		const value: unknown = JSON.parse(storage?.getItem(PROJECT_TICKETS_STORAGE_KEY) ?? '[]');
		if (!Array.isArray(value)) return [];
		const ids = value.filter((id): id is string => typeof id === 'string' && RECORD_ID.test(id));
		return [...new Set(ids)].slice(-PROJECT_TICKETS_REMEMBERED_MAX);
	} catch {
		return [];
	}
}

/**
 * Remembers the rows whose tickets are shown, in the order they were opened (the newest last, at
 * most PROJECT_TICKETS_REMEMBERED_MAX); none removes the key. A blocked or full storage only loses
 * the memory, never the choice on this page.
 */
export function writeOpenProjectTickets(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	ids: readonly string[]
): void {
	try {
		const kept = ids.filter((id) => RECORD_ID.test(id)).slice(-PROJECT_TICKETS_REMEMBERED_MAX);
		if (kept.length === 0) storage?.removeItem(PROJECT_TICKETS_STORAGE_KEY);
		else storage?.setItem(PROJECT_TICKETS_STORAGE_KEY, JSON.stringify(kept));
	} catch {
		// The rows stay open or closed for this page.
	}
}
