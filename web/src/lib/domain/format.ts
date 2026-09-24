// German display formats for dates (CLAUDE.md section 7). Pure; calendar dates are formatted as
// text, without the time zone data of the runtime (ADR-0005).

import { parseCalendarDate, type CalendarDate } from './berlin-date';

/** Calendar date `YYYY-MM-DD` as `TT.MM.JJJJ`; throws for anything but a real date. */
export function formatCalendarDate(date: CalendarDate): string {
	parseCalendarDate(date);
	const [year, month, day] = date.split('-');
	return `${day}.${month}.${year}`;
}
