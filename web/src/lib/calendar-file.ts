// Calendar files for the inbox (E4 plan, package 14; ADR-0017 section 1): the browser only checks
// type and size; the hook parses the file, so the calendar feed and the file share one parser.

/** Largest .ics file taken into the inbox (ADR-0017 section 1). */
export const ICS_MAX_BYTES = 20 * 1024 * 1024;

export const CALENDAR_TOO_LARGE_MESSAGE = 'Größer als 20 MB, deshalb nicht übernommen.';

/** True for a file that is meant to be a calendar: `.ics` or the type `text/calendar`. */
export function isCalendarFile(file: Pick<File, 'name' | 'type'>): boolean {
	return /\.ics$/i.test(file.name) || file.type.toLowerCase() === 'text/calendar';
}
