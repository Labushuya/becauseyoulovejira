// Bulk actions of the ticket table (plan BI-2, ADR-0036 §3 to §5): what an action changes on each
// chosen ticket, which tickets it skips and why, and how "Rückgängig" restores them. Pure: the
// store sends each change through the same Record API as a single change, so the hooks check it
// exactly like one done in the panel.

import { addDays, type CalendarDate } from './berlin-date';
import type { Priority, Status } from './status';
import type { TicketPatch, TicketSummary } from './ticket';

/** How many requests of a bulk action run at the same time. */
export const BULK_CONCURRENCY = 4;

/** Units of "Verschieben um". */
export type ShiftUnit = 'days' | 'weeks';

export type DueAction =
	| { kind: 'due'; mode: 'set'; date: CalendarDate }
	| { kind: 'due'; mode: 'shift'; amount: number; unit: ShiftUnit }
	| { kind: 'due'; mode: 'clear' }
	| { kind: 'due'; mode: 'source' };

/** A change of fields; every one of them offers "Rückgängig". */
export type FieldAction =
	| DueAction
	| { kind: 'priority'; value: Priority }
	| { kind: 'status'; value: Status }
	| { kind: 'project'; projectId: string | null }
	| { kind: 'tags'; mode: 'add' | 'remove'; tagIds: readonly string[] };

/**
 * Every bulk action. "Erledigen" takes the blocking sub-tasks along or not (ADR-0033 section 2);
 * "Löschen" cannot be undone and asks about the sources like deleting one ticket (ADR-0031,
 * addendum B).
 */
export type BulkAction =
	| FieldAction
	| { kind: 'complete'; withChildren: boolean }
	| { kind: 'delete'; sources: 'inbox' | 'discard' };

/**
 * Due dates from the main source of the tickets for "Datum der Quelle übernehmen": the calendar
 * date of the event the ticket was converted from, by ticket ID. A ticket without such a source is
 * missing.
 */
export type SourceDates = ReadonlyMap<string, CalendarDate>;

/** No source dates (every action but "Datum der Quelle übernehmen"). */
export const NO_SOURCE_DATES: SourceDates = new Map();

/** What an action does with one ticket. */
export type BulkStep =
	{ type: 'change'; patch: TicketPatch } | { type: 'skip'; reason: string } | { type: 'unchanged' };

/** Reasons for skipping a ticket; they name the ticket in the result list. */
export const SKIP_REASONS = Object.freeze({
	noDue: 'Hat keine Fälligkeit zum Verschieben.',
	noSourceDate: 'Die Hauptquelle ist kein Termin mit Datum.'
});

/** The largest shift in days or weeks the form accepts, in both directions. */
export const MAX_SHIFT = 3650;

/** Days of a shift; weeks count seven days. */
export function shiftDays(amount: number, unit: ShiftUnit): number {
	return unit === 'weeks' ? amount * 7 : amount;
}

/** True if a shift is a whole number within ±MAX_SHIFT and not 0. */
export function validShift(amount: number): boolean {
	return Number.isInteger(amount) && amount !== 0 && Math.abs(amount) <= MAX_SHIFT;
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((id, index) => id === b[index]);
}

function dueStep(ticket: TicketSummary, action: DueAction, sources: SourceDates): BulkStep {
	let due: CalendarDate | null;
	switch (action.mode) {
		case 'set':
			due = action.date;
			break;
		case 'clear':
			due = null;
			break;
		case 'shift':
			if (ticket.due === null) return { type: 'skip', reason: SKIP_REASONS.noDue };
			due = addDays(ticket.due, shiftDays(action.amount, action.unit));
			break;
		case 'source': {
			const date = sources.get(ticket.id);
			if (date === undefined) return { type: 'skip', reason: SKIP_REASONS.noSourceDate };
			due = date;
			break;
		}
	}
	return due === ticket.due ? { type: 'unchanged' } : { type: 'change', patch: { due } };
}

/**
 * The change of a field action on one ticket: a patch with the changed field only, a skip with
 * the reason, or nothing when the ticket has the value already. "Status: Erledigt" is not a field
 * change; the store sends it like "Erledigen".
 */
export function planStep(
	ticket: TicketSummary,
	action: FieldAction,
	sources: SourceDates = NO_SOURCE_DATES
): BulkStep {
	switch (action.kind) {
		case 'due':
			return dueStep(ticket, action, sources);
		case 'priority':
			return ticket.priority === action.value
				? { type: 'unchanged' }
				: { type: 'change', patch: { priority: action.value } };
		case 'status':
			return ticket.status === action.value
				? { type: 'unchanged' }
				: { type: 'change', patch: { status: action.value } };
		case 'project':
			return ticket.projectId === action.projectId
				? { type: 'unchanged' }
				: { type: 'change', patch: { project: action.projectId } };
		case 'tags': {
			const tags =
				action.mode === 'add'
					? [...ticket.tagIds, ...action.tagIds.filter((id) => !ticket.tagIds.includes(id))]
					: ticket.tagIds.filter((id) => !action.tagIds.includes(id));
			return sameTags(tags, ticket.tagIds)
				? { type: 'unchanged' }
				: { type: 'change', patch: { tags } };
		}
	}
}

/**
 * The patch that restores a ticket after a field change: the same fields with their values from
 * before. A changed project gives the ticket another new key (CLAUDE.md section 5), not the old one.
 */
export function restorePatch(before: TicketSummary, patch: TicketPatch): TicketPatch {
	const restore: TicketPatch = {};
	if ('due' in patch) restore.due = before.due;
	if ('priority' in patch) restore.priority = before.priority;
	if ('status' in patch) restore.status = before.status;
	if ('project' in patch) restore.project = before.projectId;
	if ('tags' in patch) restore.tags = [...before.tagIds];
	return restore;
}

/**
 * Order of the tickets for "Erledigen": sub-tasks first, so a chosen sub-task is done before its
 * chosen parent asks about it; otherwise the order of the table.
 */
export function completionOrder(tickets: readonly TicketSummary[]): TicketSummary[] {
	return [
		...tickets.filter((ticket) => Boolean(ticket.parentId)),
		...tickets.filter((ticket) => !ticket.parentId)
	];
}

/** "3 Tickets", "1 Ticket". */
export function ticketCount(count: number): string {
	return count === 1 ? '1 Ticket' : `${count} Tickets`;
}

/** Name of an action in flags and in the progress: "Priorität ändern". */
export function actionLabel(action: BulkAction): string {
	switch (action.kind) {
		case 'due':
			return 'Fälligkeit ändern';
		case 'priority':
			return 'Priorität ändern';
		case 'status':
			return 'Status ändern';
		case 'project':
			return 'Projekt ändern';
		case 'tags':
			return action.mode === 'add' ? 'Tags hinzufügen' : 'Tags entfernen';
		case 'complete':
			return 'Erledigen';
		case 'delete':
			return 'Löschen';
	}
}

/** Numbers of a finished bulk action. */
export interface BulkCounts {
	changed: number;
	skipped: number;
	unchanged: number;
	failed: number;
}

/**
 * Title of the flag after a bulk action: what changed, and what did not. `verb` is the past
 * participle ("geändert", "erledigt", "gelöscht", "zurückgesetzt").
 */
export function resultTitle(counts: BulkCounts, verb: string): string {
	const parts = [`${ticketCount(counts.changed)} ${verb}`];
	if (counts.unchanged > 0) parts.push(`${counts.unchanged} unverändert`);
	if (counts.skipped > 0) parts.push(`${counts.skipped} übersprungen`);
	if (counts.failed > 0) parts.push(`${counts.failed} fehlgeschlagen`);
	return `${parts.join(', ')}.`;
}
