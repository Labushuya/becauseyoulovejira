// Sub-tasks (ADR-0033): texts of the hook codes and of the question before completing. Pure.

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
