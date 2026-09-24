// German display formats for dates (CLAUDE.md section 7). Pure; calendar dates are formatted as
// text, points in time are shifted to Berlin with the own daylight saving rule instead of the
// time zone data of the runtime (ADR-0005).

import { berlinOffsetHours, parseCalendarDate, type CalendarDate } from './berlin-date';

const HOUR_MS = 60 * 60 * 1000;
/** PocketBase timestamp `YYYY-MM-DD HH:MM:SS(.sss)Z`, also accepted with `T`. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const pad = (value: number) => String(value).padStart(2, '0');

/** Calendar date `YYYY-MM-DD` as `TT.MM.JJJJ`; throws for anything but a real date. */
export function formatCalendarDate(date: CalendarDate): string {
	parseCalendarDate(date);
	const [year, month, day] = date.split('-');
	return `${day}.${month}.${year}`;
}

/** UTC timestamp of PocketBase as Berlin local time `TT.MM.JJJJ HH:MM`. */
export function formatBerlinDateTime(timestamp: string): string {
	const ms = TIMESTAMP.test(timestamp) ? Date.parse(timestamp.replace(' ', 'T')) : NaN;
	if (!Number.isFinite(ms)) throw new RangeError(`Not a timestamp: ${timestamp}`);
	const local = new Date(ms + berlinOffsetHours(ms) * HOUR_MS);
	const date = `${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)}.${local.getUTCFullYear()}`;
	return `${date} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}
