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

/**
 * Answer to "N Unteraufgaben sind noch offen – trotzdem erledigen?" (ADR-0033 section 2):
 * complete the blocking sub-tasks with the ticket, or complete it anyway. The values are the body
 * fields the hook reads.
 */
export type CompletionChoice = 'complete_children' | 'force';

/** The choices in the order of the question; the first one is chosen at first. */
export const COMPLETION_CHOICES: readonly CompletionChoice[] = Object.freeze([
	'complete_children',
	'force'
]);

export const COMPLETION_LABELS: Readonly<Record<CompletionChoice, string>> = Object.freeze({
	complete_children: 'Unteraufgaben mit erledigen',
	force: 'Trotzdem erledigen'
});

/** Question before completing a ticket with open blocking sub-tasks. */
export function openChildrenQuestion(count: number): string {
	return `${subtaskCountText(count)} ${count === 1 ? 'ist' : 'sind'} noch offen – trotzdem erledigen?`;
}

/** "HAUS-13", "HAUS-13 und HAUS-14", "HAUS-13, HAUS-14 und 2 weitere" (at most three keys). */
export function keysText(keys: readonly string[], count = keys.length): string {
	const shown = keys.slice(0, 3);
	const rest = count - shown.length;
	if (rest > 0) return `${shown.join(', ')} und ${rest === 1 ? '1 weitere' : `${rest} weitere`}`;
	if (shown.length <= 1) return shown.join('');
	return `${shown.slice(0, -1).join(', ')} und ${shown.at(-1) ?? ''}`;
}

/** What a choice does, named with the keys of the sub-tasks. */
export function completionHint(
	choice: CompletionChoice,
	keys: readonly string[],
	count: number
): string {
	const one = count === 1;
	if (choice === 'force') {
		return one ? 'Die Unteraufgabe bleibt offen.' : 'Die Unteraufgaben bleiben offen.';
	}
	return `${keysText(keys, count)} ${one ? 'wird' : 'werden'} ebenfalls erledigt.`;
}

/** Open sub-tasks that block completing their parent (`blocks_parent`, true unless switched off). */
export function openBlocking<T extends Pick<TicketSummary, 'status' | 'blocksParent'>>(
	subtasks: readonly T[]
): T[] {
	return subtasks.filter((entry) => entry.status !== 'done' && entry.blocksParent !== false);
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

/** A row of the ticket table (ADR-0033 section 5). */
export interface TicketRow<T> {
	ticket: T;
	/** Indented directly below its parent. */
	nested: boolean;
	/** The parent of a sub-task (for the path hint and the column "Übergeordnet"), else null. */
	parent: ParentRef | null;
}

/**
 * Order of the rows of one section of the table (a group, the open or the done tickets), given in
 * the order of the sort (ADR-0033 section 5): with `nest` a sub-task follows its parent directly
 * when both are in `tickets`, and sub-tasks of one parent keep their order among each other.
 * Otherwise, and without `nest`, every ticket stays at its place; a sub-task then carries its
 * parent for the path hint. Filters, search and counts are the caller's, per ticket.
 */
export function arrangeRows<T extends TicketSummary>(
	tickets: readonly T[],
	nest: boolean,
	find: (id: string) => Pick<TicketSummary, 'id' | 'key' | 'title'> | null
): TicketRow<T>[] {
	const shown = new Set(tickets.map((ticket) => ticket.id));
	const follows = (ticket: T) => nest && !!ticket.parentId && shown.has(ticket.parentId);
	const children = new Map<string, T[]>();
	for (const ticket of tickets) {
		if (!follows(ticket) || !ticket.parentId) continue;
		const list = children.get(ticket.parentId);
		if (list === undefined) children.set(ticket.parentId, [ticket]);
		else list.push(ticket);
	}
	const rows: TicketRow<T>[] = [];
	for (const ticket of tickets) {
		if (follows(ticket)) continue;
		rows.push({ ticket, nested: false, parent: parentOf(ticket, find) });
		for (const child of children.get(ticket.id) ?? []) {
			rows.push({ ticket: child, nested: true, parent: parentOf(child, find) });
		}
	}
	return rows;
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
