// Domain types of E2 (ADR-0006 section 1) and the conversion of the due date. Pure: the data
// layer (web/src/lib/data) maps PocketBase records to these types.

import { isCalendarDate, type CalendarDate } from './berlin-date';
import type { ProjectColor } from './colors';
import type { TicketKind } from './day-plan';
import type { InboxChannel } from './inbox';
import type { Priority, Status } from './status';

/** Length limits of the schema (app/pb_migrations; tests/unit/web-limits.test.mjs keeps them equal). */
export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 100_000;
export const COMMENT_MAX_LENGTH = 20_000;

/** Parent project of a sub project (ADR-0034), as the catalog resolves it. */
export interface ProjectParentRef {
	id: string;
	name: string;
	code: string;
	/** Color of the parent (ADR-0052); a sub project without its own shows it. */
	color?: ProjectColor | null;
}

/** Project as shown next to a ticket (expanded relation). */
export interface ProjectRef {
	id: string;
	name: string;
	code: string;
	archived: boolean;
	/**
	 * Parent project of a sub project (ADR-0034), resolved by the catalog; absent or null for a
	 * top-level project and for the expanded relation of a ticket.
	 */
	parent?: ProjectParentRef | null;
	/** Own color of the project (ADR-0052), null without one; absent before the migration. */
	color?: ProjectColor | null;
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
	 * Date of the series the ticket was made for with "Verpasste Termine nachholen" (plan OR-5); left
	 * out for every other ticket. Such a ticket counts on its own in the day plan, every other ticket
	 * of a series stands for its series (WH-1).
	 */
	occurrence?: CalendarDate | null;
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
	 * Area of the ticket (`u:<owner>` or `h:<household>`); the ticket picker offers only tickets of
	 * the same area where the hook demands it (ADR-0042). The data layer always sets it.
	 */
	scope?: string;
	/** The account that created the ticket (`owner`); the data layer sets it (ADR-0061 §4). */
	owner?: string;
	/**
	 * Way the ticket came in (ADR-0014 section 2); null for tickets before E4 and before the
	 * migration, which count as "manual" (ADR-0019).
	 */
	source: InboxChannel | null;
	/**
	 * Own color (ADR-0052), null for "wie Projekt". Left out while the server does not know the
	 * field (before the restart after the migration): the color is not offered then.
	 */
	color?: ProjectColor | null;
	/**
	 * Charm (ADR-0062): a key of the catalog (domain/charms.ts), null for none. Left out while the
	 * server does not know the field (before the restart after the migration): no charm is offered.
	 */
	charm?: string | null;
	/**
	 * Kind (ADR-0065): "Aufgabe" or "Laufendes Vorhaben"; it alone decides what the check mark of the
	 * day plan means. Left out while the server does not know the field (before the restart after the
	 * migration): the switch is not offered then.
	 */
	kind?: TicketKind;
	/**
	 * The account that takes care of the ticket (ADR-0068), only in a household; null for nobody. Left
	 * out while the server does not know the field (before the restart after the migration): no field
	 * "Zuständig" then.
	 */
	assignee?: string | null;
	/**
	 * When another account gave the ticket to its assignee (ADR-0068 §4), null otherwise: the ticket is
	 * "neu" for him again from then on (ADR-0015).
	 */
	assignedAt?: string | null;
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
	/**
	 * The pinned comment (ADR-0044), null without one. Left out while the server does not know the
	 * field (before the restart after the migration): pinning is not offered then.
	 */
	pinnedComment?: string | null;
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
	/**
	 * A sub-task blocks completing its parent while it is open ("Blockiert das übergeordnete
	 * Ticket", ADR-0033); left out for the default true. Only "Neues Ticket" sends it (NT-1).
	 */
	blocksParent?: boolean;
	/** Own color (ADR-0052); left out or null for "wie Projekt". */
	color?: ProjectColor | null;
	/** Charm (ADR-0062), a key of the catalog; left out or null for none. */
	charm?: string | null;
	/** "Laufendes Vorhaben" (ADR-0065); left out for "Aufgabe". Only "Neues Ticket" sends it (NT-1). */
	kind?: TicketKind;
	/** The assignee (ADR-0068), a member of the household; left out or null for nobody. */
	assignee?: string | null;
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
 * switch "Blockiert das übergeordnete Ticket" of a sub-task (ADR-0033). `detachSeries` releases the
 * ticket from its series in the same request (ADR-0023 section 6), e.g. to reopen an older
 * instance as a normal ticket (addendum 4). `pinnedComment` pins a comment of the ticket, null
 * releases the pin (ADR-0044).
 */
export type TicketPatch = Partial<TicketDraft> & {
	detachSeries?: boolean;
	pinnedComment?: string | null;
};

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
