// Sub-tasks (ADR-0033): order and progress of the sub-tasks of a ticket, the texts of the hook
// codes and of the question before completing. Pure.

import type { ParentRef, TicketSummary } from './ticket';

/**
 * Texts of the parent guard and the completion guard, the same as the hook
 * (app/pb_hooks/lib/ticket-rules.js, SUBTASK_MESSAGES; tests/unit/web-subtasks.test.mjs).
 */
export const SUBTASK_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_parent_self: 'Ein Ticket kann nicht sein eigenes übergeordnetes Ticket sein.',
	validation_parent_nested: 'Das gewählte Ticket ist selbst eine Unteraufgabe (nur eine Ebene).',
	validation_parent_has_children: 'Ein Ticket mit Unteraufgaben kann keine Unteraufgabe werden.',
	validation_ticket_has_children: 'Ein Ticket mit Unteraufgaben kann den Bereich nicht wechseln.',
	validation_parent_open_children: 'Offene Unteraufgaben blockieren das Erledigen.'
});

/** "1 Unteraufgabe" or "3 Unteraufgaben". */
export function subtaskCountText(count: number): string {
	return count === 1 ? '1 Unteraufgabe' : `${count} Unteraufgaben`;
}

/** "3 Unteraufgaben sind noch offen." (refusal of the hook with its count). */
export function openChildrenMessage(count: number): string {
	return `${subtaskCountText(count)} ${count === 1 ? 'ist' : 'sind'} noch offen.`;
}

/** Question before deleting a parent: "3 Unteraufgaben bleiben erhalten …" (ADR-0033 section 4). */
export function remainingSubtasksText(count: number): string {
	return count === 1
		? '1 Unteraufgabe bleibt erhalten und ist danach keine Unteraufgabe mehr.'
		: `${count} Unteraufgaben bleiben erhalten und sind danach keine Unteraufgaben mehr.`;
}

export type SubtaskLike = Pick<TicketSummary, 'id' | 'status' | 'created'>;

/** Order of the section "Unteraufgaben": open ones first, then by creation, last the ID. */
export function compareSubtasks(a: SubtaskLike, b: SubtaskLike): number {
	const doneA = a.status === 'done' ? 1 : 0;
	const doneB = b.status === 'done' ? 1 : 0;
	if (doneA !== doneB) return doneA - doneB;
	if (a.created !== b.created) return a.created < b.created ? -1 : 1;
	if (a.id === b.id) return 0;
	return a.id < b.id ? -1 : 1;
}

export interface SubtaskProgress {
	done: number;
	total: number;
}

/** How many sub-tasks are done of all of them. */
export function subtaskProgress(
	children: readonly Pick<TicketSummary, 'status'>[]
): SubtaskProgress {
	return {
		done: children.filter((child) => child.status === 'done').length,
		total: children.length
	};
}

/** "2/5 erledigt" next to the section and, shorter, "2/5" at the title in the table. */
export function progressText({ done, total }: SubtaskProgress): string {
	return `${done}/${total} erledigt`;
}

/** Name of the progress for screen readers: "2 von 5 Unteraufgaben erledigt". */
export function progressLabel({ done, total }: SubtaskProgress): string {
	return `${done} von ${subtaskCountText(total)} erledigt`;
}

/** Share of done sub-tasks in percent, 0 without sub-tasks. */
export function progressPercent({ done, total }: SubtaskProgress): number {
	return total === 0 ? 0 : Math.round((done / total) * 100);
}

/**
 * The parent of a sub-task for its path: the list's own version of the parent if it has one (a new
 * key after a project change shows at once), else the expanded one; null for a top-level ticket.
 * Without both only the ID is known, and the key stands as "…".
 */
export function parentOf(
	ticket: Pick<TicketSummary, 'parentId' | 'parentRef'>,
	find: (id: string) => Pick<TicketSummary, 'id' | 'key' | 'title'> | null
): ParentRef | null {
	const id = ticket.parentId ?? null;
	if (id === null) return null;
	const known = find(id);
	if (known !== null) return { id, key: known.key, title: known.title };
	if (ticket.parentRef && ticket.parentRef.id === id) return ticket.parentRef;
	return { id, key: '…', title: '' };
}
