// Relative due labels (E3 plan, T-9). Pure: both dates are Berlin calendar dates, "today" comes
// from the list store, so the labels change at the Berlin midnight without a reload.

import { parseCalendarDate, type CalendarDate } from './berlin-date';
import { formatCalendarDate } from './format';
import { SOON_DAYS } from './ordering';

/** Visible text without a due date. */
export const NO_DUE_TEXT = '–';
/** Text alternative without a due date. */
export const NO_DUE_SPOKEN = 'keine Fälligkeit';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DueLabel {
	/** Visible text: "heute", "in 3 Tagen", "seit 2 Tagen überfällig", "03.10.2026" or "–". */
	text: string;
	/** Full date `TT.MM.JJJJ` (for `title`), null without a due date. */
	date: string | null;
	/** Value for `<time datetime>`, null without a due date. */
	datetime: CalendarDate | null;
	/** Complete text for screen readers, e.g. "heute, 25.09.2026" or "keine Fälligkeit". */
	spoken: string;
	/** True if the due date lies before today. */
	overdue: boolean;
}

/** Whole days from `today` to `due` (negative in the past). */
function daysBetween(today: CalendarDate, due: CalendarDate): number {
	return Math.round((parseCalendarDate(due) - parseCalendarDate(today)) / DAY_MS);
}

function relativeText(days: number): string | null {
	if (days === 0) return 'heute';
	if (days === 1) return 'morgen';
	if (days === -1) return 'gestern';
	if (days < -1) return `seit ${-days} Tagen überfällig`;
	if (days <= SOON_DAYS) return `in ${days} Tagen`;
	return null;
}

/**
 * Label of a due date at the given Berlin date (T-9): "gestern", "seit N Tagen überfällig",
 * "heute", "morgen", "in N Tagen" (2 to SOON_DAYS), otherwise the date `TT.MM.JJJJ`.
 */
export function relativeDue(due: CalendarDate | null, today: CalendarDate): DueLabel {
	if (due === null) {
		return { text: NO_DUE_TEXT, date: null, datetime: null, spoken: NO_DUE_SPOKEN, overdue: false };
	}
	const days = daysBetween(today, due);
	const date = formatCalendarDate(due);
	const relative = relativeText(days);
	return {
		text: relative ?? date,
		date,
		datetime: due,
		spoken: relative === null ? date : `${relative}, ${date}`,
		overdue: days < 0
	};
}
