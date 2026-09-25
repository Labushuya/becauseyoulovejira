// Calendar date in Europe/Berlin (CLAUDE.md section 5, ADR-0005). Pure: the EU daylight saving
// rule is implemented here instead of relying on the time zone data of the runtime. Summer time
// (UTC+2) runs from the last Sunday of March, 01:00 UTC, to the last Sunday of October,
// 01:00 UTC; otherwise UTC+1. The hook module app/pb_hooks/lib/berlin-time.js (E4) implements
// the same rule in ES5; tests/unit/berlin-time.test.mjs compares both.

/** Calendar date as `YYYY-MM-DD`. */
export type CalendarDate = string;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTC instant (ms) of the last Sunday of a month (0-based), 01:00 UTC. */
function lastSundayAtOneUtc(year: number, month: number): number {
	const lastDay = new Date(Date.UTC(year, month + 1, 0));
	const sunday = lastDay.getUTCDate() - lastDay.getUTCDay();
	return Date.UTC(year, month, sunday, 1);
}

/** Offset of Berlin local time to UTC at the given instant, in hours (1 or 2). */
export function berlinOffsetHours(instant: number): 1 | 2 {
	const year = new Date(instant).getUTCFullYear();
	const summer = instant >= lastSundayAtOneUtc(year, 2) && instant < lastSundayAtOneUtc(year, 9);
	return summer ? 2 : 1;
}

function toMs(now: Date | number): number {
	const ms = typeof now === 'number' ? now : now.getTime();
	if (!Number.isFinite(ms)) throw new RangeError('Invalid point in time');
	return ms;
}

function formatUtcDate(ms: number): CalendarDate {
	const date = new Date(ms);
	const year = String(date.getUTCFullYear()).padStart(4, '0');
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** UTC midnight (ms) of a calendar date; throws for anything but a real `YYYY-MM-DD` date. */
export function parseCalendarDate(date: string): number {
	const match = CALENDAR_DATE.exec(date);
	if (!match) throw new RangeError(`Not a calendar date: ${date}`);
	const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
	const ms = Date.UTC(year, month - 1, day);
	if (formatUtcDate(ms) !== date) throw new RangeError(`Not a calendar date: ${date}`);
	return ms;
}

export function isCalendarDate(value: string): boolean {
	try {
		parseCalendarDate(value);
		return true;
	} catch {
		return false;
	}
}

/** Berlin calendar date at the given point in time. */
export function berlinToday(now: Date | number): CalendarDate {
	const ms = toMs(now);
	return formatUtcDate(ms + berlinOffsetHours(ms) * HOUR_MS);
}

/** Calendar date `days` days after `date` (negative values go back). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
	if (!Number.isInteger(days)) throw new RangeError(`Not a whole number of days: ${days}`);
	return formatUtcDate(parseCalendarDate(date) + days * DAY_MS);
}

/** UTC instant (ms) at which the given calendar date begins in Berlin. */
function berlinMidnight(date: CalendarDate): number {
	// The clocks change at 01:00 UTC, never at local midnight, so exactly one offset fits.
	const summerCandidate = parseCalendarDate(date) - 2 * HOUR_MS;
	return berlinOffsetHours(summerCandidate) === 2
		? summerCandidate
		: parseCalendarDate(date) - HOUR_MS;
}

/** Milliseconds from `now` until the next midnight in Berlin (always > 0). */
export function msUntilNextBerlinMidnight(now: Date | number): number {
	const ms = toMs(now);
	return berlinMidnight(addDays(berlinToday(ms), 1)) - ms;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a time of day `HH:MM` (00:00 to 23:59), as an `<input type="time">` gives it. */
export function isTimeOfDay(value: string): boolean {
	return TIME_OF_DAY.test(value);
}

/**
 * UTC instant (ms) of a Berlin wall-clock time: `date` at `time` (`HH:MM`, midnight without one).
 * In the hour the clocks go back the summer time is taken; a time in the skipped hour of the
 * spring change comes out one hour later, as a clock would show it.
 */
export function berlinWallClockToUtc(date: CalendarDate, time = '00:00'): number {
	const match = TIME_OF_DAY.exec(time);
	if (!match) throw new RangeError(`Not a time of day: ${time}`);
	const local = parseCalendarDate(date) + Number(match[1]) * HOUR_MS + Number(match[2]) * 60_000;
	const summerCandidate = local - 2 * HOUR_MS;
	return berlinOffsetHours(summerCandidate) === 2 ? summerCandidate : local - HOUR_MS;
}
