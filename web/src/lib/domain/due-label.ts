// Relative due labels (E3 plan, T-9). Pure: both dates are Berlin calendar dates, "today" comes
// from the list store, so the labels change at the Berlin midnight without a reload. An overdue
// ticket names the day it is overdue since, "überfällig seit 05.10.", the same text in the list,
// the detail, the calendar and the day plan (WH-1; the hook has it in lib/day-plan-rules.js).

import { parseCalendarDate, type CalendarDate } from './berlin-date';
import { formatCalendarDate } from './format';
import { SOON_DAYS } from './ordering';
import { shortDate } from './recurrence-text';

/** Visible text without a due date. */
export const NO_DUE_TEXT = '–';
/** Text alternative without a due date. */
export const NO_DUE_SPOKEN = 'keine Fälligkeit';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DueLabel {
	/** Visible text: "heute", "in 3 Tagen", "überfällig seit 03.10.", "03.10.2026" or "–". */
	text: string;
	/** Full date `TT.MM.JJJJ` (for `title`), null without a due date. */
	date: string | null;
	/** Value for `<time datetime>`, null without a due date. */
	datetime: CalendarDate | null;
	/**
	 * Complete text for screen readers, e.g. "heute, 25.09.2026", "überfällig seit 03.10.2026" or
	 * "keine Fälligkeit".
	 */
	spoken: string;
	/** True if the due date lies before today. */
	overdue: boolean;
}

/** Whole days from `today` to `due` (negative in the past). */
function daysBetween(today: CalendarDate, due: CalendarDate): number {
	return Math.round((parseCalendarDate(due) - parseCalendarDate(today)) / DAY_MS);
}

/**
 * "überfällig seit 05.10." (year of `today`) or "überfällig seit 05.10.2025": the day an overdue
 * ticket is overdue since, its due date. A carried occurrence of a series keeps the date of its
 * oldest missed date as its due date (WH-1). The same as overdueSinceText of the hook.
 */
export function overdueSinceText(due: CalendarDate, today: CalendarDate): string {
	return `überfällig seit ${shortDate(due, today)}`;
}

function relativeText(days: number): string | null {
	if (days === 0) return 'heute';
	if (days === 1) return 'morgen';
	if (days > 1 && days <= SOON_DAYS) return `in ${days} Tagen`;
	return null;
}

/**
 * Label of a due date at the given Berlin date (T-9, WH-1): "überfällig seit 03.10." before today,
 * "heute", "morgen", "in N Tagen" (2 to SOON_DAYS), otherwise the date `TT.MM.JJJJ`.
 */
export function relativeDue(due: CalendarDate | null, today: CalendarDate): DueLabel {
	if (due === null) {
		return { text: NO_DUE_TEXT, date: null, datetime: null, spoken: NO_DUE_SPOKEN, overdue: false };
	}
	const days = daysBetween(today, due);
	const date = formatCalendarDate(due);
	if (days < 0) {
		return {
			text: overdueSinceText(due, today),
			date,
			datetime: due,
			spoken: `überfällig seit ${date}`,
			overdue: true
		};
	}
	const relative = relativeText(days);
	return {
		text: relative ?? date,
		date,
		datetime: due,
		spoken: relative === null ? date : `${relative}, ${date}`,
		overdue: false
	};
}
