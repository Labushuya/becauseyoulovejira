// Domain types of E2 (ADR-0006 section 1) and the conversion of the due date. Pure: the data
// layer (web/src/lib/data) maps PocketBase records to these types.

import { isCalendarDate, type CalendarDate } from './berlin-date';
import type { InboxChannel } from './inbox';
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

/** The ticket a sub-task belongs to (expanded relation `parent`, ADR-0033). */
export interface ParentRef {
	id: string;
	key: string;
	title: string;
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
	/** True if the ticket belongs to a recurrence rule (E5). */
	recurring: boolean;
	/**
	 * ID of that rule, null without one (E5 plan, package 4). The data layer always sets it;
	 * objects built by hand (tests, drafts) may leave it out.
	 */
	recurrenceId?: string | null;
	/**
	 * ID of the ticket this one is a sub-task of, null for a top-level ticket (ADR-0033). The data
	 * layer always sets it and the two fields below; objects built by hand may leave them out.
	 */
	parentId?: string | null;
	/** The sub-task blocks completing its parent while it is open (`blocks_parent`, default true). */
	blocksParent?: boolean;
	/** Expanded parent; only a fallback while the list does not know the parent itself. */
	parentRef?: ParentRef | null;
	/**
	 * Way the ticket came in (ADR-0014 section 2); null for tickets before E4 and before the
	 * migration, which count as "manual" (ADR-0019).
	 */
	source: InboxChannel | null;
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
	/** Inbox entry the ticket came from; null without one or after the entry was deleted. */
	sourceItem: string | null;
}

/** Fields a user sets when creating a ticket; key, scope and number come from the hook. */
export interface TicketDraft {
	title: string;
	description: string;
	status: Status;
	priority: Priority;
	due: CalendarDate | null;
	/** Project ID, null without a project (E3 plan, T-13); a change gives the ticket a new key. */
	project: string | null;
	/** Tag IDs in the chosen order (T-14). */
	tags: string[];
	/** The ticket this one is a sub-task of (ADR-0033); left out or null for a top-level ticket. */
	parent?: string | null;
}

/**
 * Status after removing the check mark of a done ticket (OF-E2-3, confirmed as P-5 in E3):
 * the status before "done" is not stored. Only "Rückgängig" right after checking restores it.
 */
export const REOPEN_STATUS: Status = 'open';

/** Defaults of a new ticket (E2 plan, T-8). */
export const DEFAULT_STATUS: Status = 'open';
export const DEFAULT_PRIORITY: Priority = 'medium';

/**
 * Origin of a new ticket (ADR-0014 section 2): typed in directly (form "Neues Ticket" or quick
 * entry), or converted from an inbox entry, whose channel the hook then takes as source.
 */
export type TicketOrigin = { source: 'manual' | 'quick' } | { sourceItem: string };

/** Origin of the form "Neues Ticket". */
export const MANUAL_ORIGIN: TicketOrigin = Object.freeze({ source: 'manual' });

/** Origin of the quick entry (E4 plan, package 6). */
export const QUICK_ORIGIN: TicketOrigin = Object.freeze({ source: 'quick' });

/**
 * Changed fields of an update; only these are sent (ADR-0006 section 5). `blocksParent` is the
 * switch "Blockiert das übergeordnete Ticket" of a sub-task (ADR-0033).
 */
export type TicketPatch = Partial<TicketDraft> & { blocksParent?: boolean };

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
