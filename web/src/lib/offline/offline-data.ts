// Shells around the data access of the stores (OF-2 and OF-3, ADR-0074 addenda OF-2 and OF-3; concept
// OF-0 §1.2): a change of the status (the check mark of "Aufgaben", the status in the cell, the panel
// and the full view), of the due date (cell and panel) and a check mark of the day plan with its
// taking back go through the outbox while it works for the ticket; every other call, and every call
// while the outbox does not work (no `offline_ops`, no phone frame), goes to the data layer exactly
// as before. The stores stay as they are; they get an answer of the server or a provisional one.

import type { CalendarDate } from '$lib/domain/berlin-date';
import { isStatus, type Status } from '$lib/domain/status';
import type { CompletionChoice } from '$lib/domain/subtasks';
import {
	REOPEN_STATUS,
	type Ticket,
	type TicketPatch,
	type TicketSummary
} from '$lib/domain/ticket';
import type { UpdateOptions } from '$lib/data/tickets';
import type { DayPlanData, PlanEntry } from '$lib/stores/day-plan.svelte';
import type { TicketDetailData } from '$lib/stores/ticket-detail.svelte';
import type { TicketListData } from '$lib/stores/ticket-list.svelte';
import type {
	ChangeKind,
	CheckAnswer,
	CheckEntry,
	CheckRequest,
	StatusRequest
} from './outbox.svelte';

/** What the shells need of the outbox. */
export interface OutboxRoute {
	routes(id: string, change?: ChangeKind): boolean;
	current(id: string): TicketSummary | null;
	changeStatus<T extends TicketSummary>(ticket: T, request: StatusRequest): Promise<T>;
	changeDue<T extends TicketSummary>(ticket: T, due: CalendarDate | null): Promise<T>;
}

/** What the shell of the day plan needs of the outbox (OF-3). */
export interface OutboxCheckRoute {
	routes(id: string, change?: ChangeKind): boolean;
	changeCheck(entry: CheckEntry, request: CheckRequest): Promise<CheckAnswer>;
}

/** Only one field of the patch, without the guard of the description and without leaving a series. */
function onlyField(patch: TicketPatch, options: UpdateOptions, field: keyof TicketPatch): boolean {
	const keys = Object.keys(patch) as (keyof TicketPatch)[];
	return (
		keys.length === 1 &&
		keys[0] === field &&
		options.expectedUpdated === undefined &&
		options.outbox === undefined
	);
}

/**
 * Whether a patch is a change of the outbox in OF-2: only the status, without the guard of the
 * description and without leaving a series (those stay the way of today).
 */
export function isStatusPatch(patch: TicketPatch, options: UpdateOptions = {}): boolean {
	return onlyField(patch, options, 'status') && isStatus(patch.status);
}

/**
 * Whether a patch is a change of the due date of the outbox (OF-3): only the due date, without the
 * guard of the calendar (`expected_updated`, ADR-0053 §12) and without leaving a series.
 */
export function isDuePatch(patch: TicketPatch, options: UpdateOptions = {}): boolean {
	return onlyField(patch, options, 'due') && patch.due !== undefined;
}

function requestOf(
	status: Status,
	completion: CompletionChoice | undefined,
	children: () => readonly string[]
): StatusRequest {
	return {
		status,
		...(completion !== undefined && { completion }),
		...(completion === 'complete_children' && status === 'done' && { children: children() })
	};
}

/**
 * The list (check mark, cell, "Rückgängig"): `find` is the ticket as the list shows it, `children`
 * the open blocking sub-tasks a completion with "complete_children" takes along.
 */
export function offlineTicketListData(
	base: TicketListData,
	outbox: OutboxRoute,
	find: (id: string) => TicketSummary | null,
	children: (id: string) => readonly string[] = () => []
): TicketListData {
	/** The ticket of a change through the outbox, null when it goes the way of today. */
	function routed(id: string, change: ChangeKind): TicketSummary | null {
		if (!outbox.routes(id, change)) return null;
		return find(id) ?? outbox.current(id);
	}
	/** The change of the status through the outbox, null when it goes the way of today. */
	function through(id: string, status: Status, completion?: CompletionChoice) {
		const ticket = routed(id, 'status');
		if (ticket === null) return null;
		return outbox.changeStatus(
			ticket,
			requestOf(status, completion, () => children(id))
		);
	}
	return {
		...base,
		setDone: (id, done, completion) =>
			through(id, done ? 'done' : REOPEN_STATUS, completion) ?? base.setDone(id, done, completion),
		update: (id, patch, options) => {
			if (isDuePatch(patch, options)) {
				const ticket = routed(id, 'due');
				if (ticket !== null) return outbox.changeDue(ticket, patch.due ?? null);
			}
			const status = isStatusPatch(patch, options) ? patch.status : undefined;
			const kept = status === undefined ? null : through(id, status);
			return kept ?? base.update(id, patch, options);
		}
	};
}

/** The panel and the full view: `shown` is the ticket they show (with its description). */
export function offlineTicketDetailData(
	base: TicketDetailData,
	outbox: OutboxRoute,
	shown: (id: string) => Ticket | null,
	children: (id: string) => readonly string[] = () => []
): TicketDetailData {
	return {
		...base,
		update: (id, patch, options) => {
			const ticket = shown(id);
			if (ticket !== null && isDuePatch(patch, options) && outbox.routes(id, 'due')) {
				return outbox.changeDue(ticket, patch.due ?? null);
			}
			if (
				ticket === null ||
				!isStatusPatch(patch, options) ||
				patch.status === undefined ||
				!outbox.routes(id)
			) {
				return base.update(id, patch, options);
			}
			return outbox.changeStatus(
				ticket,
				requestOf(patch.status, options?.completion, () => children(id))
			);
		}
	};
}

/**
 * The day plan (OF-3): the check mark of an entry, "Nur für heute abhaken", "Vorhaben abschließen …"
 * and taking a check mark back ("Rückgängig" and the check mark itself) go through the outbox while
 * it works for the ticket of the entry. `entryOf` names the entry with its ticket as the server has
 * them, `children` the open blocking sub-tasks a completion with "complete_children" takes along.
 */
export function offlineDayPlanData(
	base: DayPlanData,
	outbox: OutboxCheckRoute,
	entryOf: (itemId: string) => PlanEntry | null,
	children: (ticketId: string) => readonly string[] = () => []
): DayPlanData {
	/** The entry of a change through the outbox, null when it goes the way of today. */
	function routed(id: string): PlanEntry | null {
		const entry = entryOf(id);
		return entry === null || !outbox.routes(entry.ticket.id, 'check') ? null : entry;
	}
	return {
		...base,
		check: (id, mode, completion) => {
			const entry = routed(id);
			if (entry === null) return base.check(id, mode, completion);
			return outbox.changeCheck(entry, {
				kind: 'dayplan.check',
				mode,
				...(completion !== null && { completion }),
				...(completion === 'complete_children' && { children: children(entry.ticket.id) })
			});
		},
		uncheck: (id, input) => {
			const entry = routed(id);
			if (entry === null) return base.uncheck(id, input);
			return outbox.changeCheck(entry, { kind: 'dayplan.uncheck', ...input });
		}
	};
}
