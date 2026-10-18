// Where the inline questions of the status stand in the fields of a ticket (QB-1, ADR-0025
// addendum 19): in a row of their own right after the status, a direct child of the grid of the
// fields over both columns, not in the narrow value column of the status, and before the row
// "Priorität". The same in the side panel and in the full view.

import { expect } from 'vitest';

/** The row of the questions of the status that holds `question`, checked for its place. */
export function expectRowBelowStatus(question: Element): HTMLElement {
	const row = question.closest<HTMLElement>('[data-status-questions]');
	expect(row, 'row of the questions of the status').not.toBeNull();
	const fields = row?.parentElement;
	expect(fields?.classList.contains('fields'), 'a row of the grid of the fields').toBe(true);
	const status = fields?.querySelector('[data-ticket-option="status"]');
	expect(status, 'value column of the status').not.toBeNull();
	expect(status?.contains(question), 'not in the value column of the status').toBe(false);
	expect(row?.previousElementSibling, 'right after the status').toBe(status);
	expect(row?.nextElementSibling?.textContent, 'before the row "Priorität"').toBe('Priorität');
	return row as HTMLElement;
}

/** No row of questions below the status. */
export function expectNoStatusQuestions(root: ParentNode = document): void {
	expect(root.querySelector('[data-status-questions]')).toBeNull();
}
