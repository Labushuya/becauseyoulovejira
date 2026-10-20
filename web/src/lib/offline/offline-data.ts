// Shells around the data access of the stores (OF-2, ADR-0074 addendum OF-2; concept OF-0 §1.2):
// a change of the status (the check mark of "Aufgaben", the status in the cell, the panel and the
// full view) goes through the outbox while it works for the ticket; every other call, and every
// call while the outbox does not work (no `offline_ops`, no phone frame), goes to the data layer
// exactly as before. The stores stay as they are; they get an answer of the server or a
// provisional one.

import { isStatus, type Status } from '$lib/domain/status';
import type { CompletionChoice } from '$lib/domain/subtasks';
import {
	REOPEN_STATUS,
	type Ticket,
	type TicketPatch,
	type TicketSummary
} from '$lib/domain/ticket';
import type { UpdateOptions } from '$lib/data/tickets';
import type { TicketDetailData } from '$lib/stores/ticket-detail.svelte';
import type { TicketListData } from '$lib/stores/ticket-list.svelte';
import type { StatusRequest } from './outbox.svelte';

/** What the shells need of the outbox. */
export interface OutboxRoute {
	routes(id: string): boolean;
	current(id: string): TicketSummary | null;
	changeStatus<T extends TicketSummary>(ticket: T, request: StatusRequest): Promise<T>;
}

/**
 * Whether a patch is a change of the outbox in OF-2: only the status, without the guard of the
 * description and without leaving a series (those stay the way of today).
 */
export function isStatusPatch(patch: TicketPatch, options: UpdateOptions = {}): boolean {
	const keys = Object.keys(patch) as (keyof TicketPatch)[];
	return (
		keys.length === 1 &&
		keys[0] === 'status' &&
		isStatus(patch.status) &&
		options.expectedUpdated === undefined &&
		options.outbox === undefined
	);
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
	/** The change through the outbox, null when it goes the way of today. */
	function through(id: string, status: Status, completion?: CompletionChoice) {
		if (!outbox.routes(id)) return null;
		const ticket = find(id) ?? outbox.current(id);
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
