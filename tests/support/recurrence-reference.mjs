// Independent reference of the date calculation of recurring tasks, for tests only (ADR-0021
// section 2; plan "Offene Reste", OR-1). It knows nothing of app/pb_hooks/lib/recurrence.js or
// web/src/lib/domain/recurrence.ts: it walks the calendar day by day and asks the definition of
// ADR-0021 section 2 for every single day, without jumping to a period. That is slow, but so plain
// that both modules can be checked against it (tests/unit/recurrence-reference.test.mjs).
//
// Rules come normalized: interval, weekdays (calendar weekly), month_day (calendar monthly, -1 is
// the last day) and anchor are set. Dates are calendar dates `YYYY-MM-DD`.

const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Days since 1970-01-01 of a calendar date. */
export const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** Calendar date of a day number. */
export const dateOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** 0 for Monday up to 6 for Sunday (ISO weeks start on Monday). */
export const weekdayIndex = (day) => (new Date(day * DAY_MS).getUTCDay() + 6) % 7;

const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Whether a day (day number) is an occurrence of a calendar rule, by the definition alone. */
export function isOccurrence(rule, day) {
	const anchor = dayNumber(rule.anchor);
	if (day < anchor) return false;
	const date = new Date(day * DAY_MS);
	const anchorDate = new Date(anchor * DAY_MS);
	const step = rule.interval;
	switch (rule.freq) {
		case 'daily':
			return (day - anchor) % step === 0;
		case 'weekly': {
			// Whole weeks between the Monday of the day and the Monday of the anchor.
			const weeks = (day - weekdayIndex(day) - (anchor - weekdayIndex(anchor))) / 7;
			return weeks % step === 0 && rule.weekdays.includes(WEEKDAYS[weekdayIndex(day)]);
		}
		case 'monthly': {
			const months =
				(date.getUTCFullYear() - anchorDate.getUTCFullYear()) * 12 + date.getUTCMonth() - anchorDate.getUTCMonth();
			const last = lastDayOfMonth(date.getUTCFullYear(), date.getUTCMonth());
			const target = rule.month_day === -1 ? last : Math.min(rule.month_day, last);
			return months % step === 0 && date.getUTCDate() === target;
		}
		case 'yearly': {
			const years = date.getUTCFullYear() - anchorDate.getUTCFullYear();
			const last = lastDayOfMonth(date.getUTCFullYear(), anchorDate.getUTCMonth());
			return (
				years % step === 0 &&
				date.getUTCMonth() === anchorDate.getUTCMonth() &&
				date.getUTCDate() === Math.min(anchorDate.getUTCDate(), last)
			);
		}
		default:
			throw new Error(`Unknown rhythm ${rule.freq}`);
	}
}

/** Longest walk: 12 years, enough for every interval of the tests (yearly up to 3, 29 February). */
const MAX_WALK_DAYS = 12 * 366;

/** First occurrence on or after `date`, found by walking forward one day at a time. */
export function onOrAfter(rule, date) {
	const start = Math.max(dayNumber(date), dayNumber(rule.anchor));
	for (let day = start; day <= start + MAX_WALK_DAYS; day++) {
		if (isOccurrence(rule, day)) return dateOf(day);
	}
	throw new Error(`No occurrence within ${MAX_WALK_DAYS} days of ${date}`);
}

/** First occurrence after `date`. */
export function after(rule, date) {
	return onOrAfter(rule, dateOf(dayNumber(date) + 1));
}

/** Latest occurrence on or before `date`, walking back to the anchor; null before it. */
export function latestOnOrBefore(rule, date) {
	const anchor = dayNumber(rule.anchor);
	for (let day = dayNumber(date); day >= anchor; day--) {
		if (isOccurrence(rule, day)) return dateOf(day);
	}
	return null;
}

/** The next `count` occurrences from `date` on. */
export function upcoming(rule, date, count) {
	const dates = [];
	let next = date;
	while (dates.length < count) {
		const found = onOrAfter(rule, next);
		dates.push(found);
		next = dateOf(dayNumber(found) + 1);
	}
	return dates;
}

/**
 * The due date of the one ticket after missed occurrences (ADR-0022 section 3): the pending date
 * when no further occurrence lies up to today, otherwise the latest one up to today. Walks every
 * day from the pending date to today.
 */
export function catchUp(rule, pendingDue, today) {
	// After completion the next date waits for the completion: nothing to catch up.
	if (rule.mode === 'after_completion') return pendingDue;
	let latest = pendingDue;
	for (let day = dayNumber(pendingDue) + 1; day <= dayNumber(today); day++) {
		if (isOccurrence(rule, day)) latest = dateOf(day);
	}
	return latest;
}

/**
 * Completion date plus the interval (after completion, ADR-0021 section 2): days and weeks one day
 * at a time, months and years one month at a time from the completion date, clamped to the last
 * day of the target month.
 */
export function afterCompletion(rule, completedDate) {
	const day = dayNumber(completedDate);
	if (rule.freq === 'daily' || rule.freq === 'weekly') {
		const days = rule.interval * (rule.freq === 'weekly' ? 7 : 1);
		let result = day;
		for (let step = 0; step < days; step++) result += 1;
		return dateOf(result);
	}
	const date = new Date(day * DAY_MS);
	let year = date.getUTCFullYear();
	let month = date.getUTCMonth();
	const months = rule.interval * (rule.freq === 'yearly' ? 12 : 1);
	for (let step = 0; step < months; step++) {
		month += 1;
		if (month === 12) {
			month = 0;
			year += 1;
		}
	}
	const target = Math.min(date.getUTCDate(), lastDayOfMonth(year, month));
	return dateOf(Date.UTC(year, month, target) / DAY_MS);
}

/** Day from which the ticket of a due date is created: `leadDays` days back, one at a time. */
export function createOn(due, leadDays) {
	let day = dayNumber(due);
	for (let step = 0; step < leadDays; step++) day -= 1;
	return dateOf(day);
}
