// Domain types of E2 (ADR-0006 section 1) and the conversion of the due date. Pure: the data
// layer (web/src/lib/data) maps PocketBase records to these types.

import { isCalendarDate, type CalendarDate } from './berlin-date';
import type { Priority, Status } from './status';

/** Length limits of the schema (app/pb_migrations; tests/unit/web-limits.test.mjs keeps them equal). */
export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 100_000;
export const COMMENT_MAX_LENGTH = 20_000;

/** Project as shown next to a ticket (expanded relation). */
export interface ProjectRef {
	id: string;
	name: string;
	code: string;
	archived: boolean;
}

/** Tag as shown next to a ticket (expanded relation). */
export interface TagRef {
	id: string;
	name: string;
}

/** Ticket as the list needs it (without the description). */
export interface TicketSummary {
	id: string;
	key: string;
	title: string;
	status: Status;
	priority: Priority;
	/** Due calendar date, null without one. */
	due: CalendarDate | null;
	/** ID of the related project, null without one; names come from the catalog (E3 plan, T-16). */
	projectId: string | null;
	/** IDs of the related tags in stored order. */
	tagIds: string[];
	/** Expanded project; only a fallback while the catalog does not know it. */
	project: ProjectRef | null;
	/** Expanded tags; only a fallback while the catalog does not know them. */
	tags: TagRef[];
	/** True if a recurrence rule created the ticket (E5). */
	recurring: boolean;
	/** UTC timestamp of PocketBase (`YYYY-MM-DD HH:MM:SS.sssZ`), null unless done. */
	completedAt: string | null;
	/** UTC timestamps of PocketBase; they sort as text. */
	created: string;
	updated: string;
}

/** Ticket with every field the detail panel shows. */
export interface Ticket extends TicketSummary {
	/** Markdown, '' without a description. */
	description: string;
}

/** Fields a user sets when creating a ticket; key, scope and number come from the hook. */
export interface TicketDraft {
	title: string;
	description: string;
	status: Status;
	priority: Priority;
	due: CalendarDate | null;
}

/**
 * Status after removing the check mark of a done ticket (OF-E2-3, recommendation until decided):
 * the status before "done" is not stored. Only "Rückgängig" right after checking restores it.
 */
export const REOPEN_STATUS: Status = 'open';

/** Defaults of a new ticket (E2 plan, T-8). */
export const DEFAULT_STATUS: Status = 'open';
export const DEFAULT_PRIORITY: Priority = 'medium';

/** Changed fields of an update; only these are sent (ADR-0006 section 5). */
export type TicketPatch = Partial<TicketDraft>;

export interface Comment {
	id: string;
	ticket: string;
	author: string;
	/** Markdown. */
	body: string;
	created: string;
	updated: string;
}

export interface HistoryEntry {
	id: string;
	ticket: string;
	/** Changed field, or "created" for the creation entry (E1 plan, package 6). */
	field: string;
	/** Raw stored values (OF-12), '' for an empty value. */
	oldValue: string;
	newValue: string;
	/** Acting user, '' for system and superuser changes (T-9: "System"). */
	user: string;
	created: string;
}

const STORED_DATE = /^(\d{4}-\d{2}-\d{2}) 00:00:00(?:\.000)?Z$/;

/**
 * Stored due value (`YYYY-MM-DD 00:00:00.000Z`, '' when empty) to the value of an
 * `<input type="date">` (`YYYY-MM-DD`, '' when empty). Throws for other values, so a changed
 * storage format does not silently shift dates.
 */
export function toDueInput(stored: string): CalendarDate | '' {
	if (stored === '') return '';
	const date = STORED_DATE.exec(stored)?.[1];
	if (date === undefined || !isCalendarDate(date)) {
		throw new RangeError(`Unexpected due value: ${stored}`);
	}
	return date;
}

/** Value of an `<input type="date">` to the stored due format; '' clears the due date. */
export function fromDueInput(input: CalendarDate | ''): string {
	if (input === '') return '';
	if (!isCalendarDate(input)) throw new RangeError(`Not a calendar date: ${input}`);
	return `${input} 00:00:00.000Z`;
}
