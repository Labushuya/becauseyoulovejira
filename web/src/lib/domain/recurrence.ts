// Dates of recurring tasks (CLAUDE.md section 6, ADR-0021 sections 2 and 3). Pure: every date is
// a calendar date `YYYY-MM-DD` without time and time zone, "today" is always a parameter (the
// Berlin date from berlin-date.ts, ADR-0005). Internally a date is its day number since
// 1970-01-01; the functions jump arithmetically to the matching period instead of looping over
// days.
//
// Mirror of app/pb_hooks/lib/recurrence.js; tests/unit/web-recurrence.test.mjs compares both with
// the shared table tests/fixtures/recurrence/cases.json and random rules. The SPA uses it for the
// preview "Nächste Termine" and the checks of the form.

import type { CalendarDate } from './berlin-date';

const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const RECURRENCE_MODES = ['calendar', 'after_completion'] as const;
export type RecurrenceMode = (typeof RECURRENCE_MODES)[number];

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

/** RFC 5545 weekday codes, Monday first (ISO weeks). */
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const INTERVAL_MIN = 1;
export const INTERVAL_MAX = 365;
export const LEAD_DAYS_MIN = 0;
export const LEAD_DAYS_MAX = 30;
/** OF-E5-1 (recommendation until the user answers): the ticket appears 3 days before it is due. */
export const DEFAULT_LEAD_DAYS = 3;
/** `month_day` for "last day of the month". */
export const LAST_DAY = -1;
const MONTH_DAY_MAX = 31;
export const ANCHOR_MIN_YEAR = 1900;
export const ANCHOR_MAX_YEAR = 2999;

export const RECURRENCE_CODES = {
	mode: 'validation_recurrence_mode',
	freq: 'validation_recurrence_freq',
	interval: 'validation_recurrence_interval',
	weekdays: 'validation_recurrence_weekdays',
	weekdaysMode: 'validation_recurrence_weekdays_mode',
	monthDay: 'validation_recurrence_month_day',
	monthDayMode: 'validation_recurrence_month_day_mode',
	anchor: 'validation_recurrence_anchor',
	leadDays: 'validation_recurrence_lead_days'
} as const;

/** Parameters of a rule as stored (ADR-0021 section 1); loose, because forms and records vary. */
export interface RecurrenceParams {
	mode?: unknown;
	freq?: unknown;
	interval?: unknown;
	weekdays?: unknown;
	month_day?: unknown;
	anchor?: unknown;
	lead_days?: unknown;
}

/** A rule after `normalizeRule`. */
export interface NormalizedRule {
	mode: unknown;
	freq: unknown;
	interval: unknown;
	weekdays: unknown[];
	month_day: unknown;
	anchor: string;
	lead_days: unknown;
}

/** A valid rule, as the date functions need it. */
export interface RecurrenceRule {
	mode: RecurrenceMode;
	freq: RecurrenceFreq;
	interval: number;
	weekdays: Weekday[];
	month_day: number | null;
	anchor: CalendarDate;
	lead_days: number;
}

export type RecurrenceField =
	'mode' | 'freq' | 'interval' | 'weekdays' | 'month_day' | 'anchor' | 'lead_days';
export type RecurrenceErrors = Partial<Record<RecurrenceField, string>>;

function isWholeNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value;
}

/** Day number of a calendar date, or NaN for anything but a real date. */
function dayOf(date: unknown): number {
	const match = CALENDAR_DATE.exec(String(date));
	if (!match) return NaN;
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	const ms = Date.UTC(year, month, day);
	const check = new Date(ms);
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month ||
		check.getUTCDate() !== day
	) {
		return NaN;
	}
	return Math.round(ms / DAY_MS);
}

function requireDay(date: string): number {
	const day = dayOf(date);
	if (Number.isNaN(day)) throw new RangeError(`Not a calendar date: ${date}`);
	return day;
}

function dateOf(dayNumber: number): CalendarDate {
	const date = new Date(dayNumber * DAY_MS);
	const year = String(date.getUTCFullYear()).padStart(4, '0');
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** Weekday index of a day number, Monday = 0 ... Sunday = 6 (1970-01-01 was a Thursday). */
function weekdayIndex(dayNumber: number): number {
	return (((dayNumber + 3) % 7) + 7) % 7;
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Day number of `day` in the month `year * 12 + month`, clamped to its last day; -1 = last day. */
function dayInMonth(monthIndex: number, day: number): number {
	const year = Math.floor(monthIndex / 12);
	const month = monthIndex - year * 12;
	const last = daysInMonth(year, month);
	const target = day === LAST_DAY ? last : Math.min(day, last);
	return Math.round(Date.UTC(year, month, target) / DAY_MS);
}

function monthIndexOf(dayNumber: number): number {
	const date = new Date(dayNumber * DAY_MS);
	return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function dayOfMonth(dayNumber: number): number {
	return new Date(dayNumber * DAY_MS).getUTCDate();
}

function isEmpty(value: unknown): boolean {
	return value === undefined || value === null || value === '' || value === 0;
}

function weekdayList(value: unknown): unknown[] {
	if (value === undefined || value === null || value === '') return [];
	return Array.isArray(value) ? [...(value as unknown[])] : [value];
}

function sortedWeekdays(list: readonly unknown[]): Weekday[] {
	return WEEKDAYS.filter((day) => list.includes(day));
}

export function isRecurrenceMode(value: unknown): value is RecurrenceMode {
	return (RECURRENCE_MODES as readonly unknown[]).includes(value);
}

export function isRecurrenceFreq(value: unknown): value is RecurrenceFreq {
	return (RECURRENCE_FREQS as readonly unknown[]).includes(value);
}

/**
 * Rule with its defaults (ADR-0021 section 3): interval 1, lead time 3 days, weekdays or day of
 * the month from the anchor for calendar rules. PocketBase stores an empty number as 0, so 0 is
 * "not set" for `interval` and `month_day` (not for `lead_days`). Values that do not belong to
 * the rhythm are kept, so `validateRule` can reject them.
 */
export function normalizeRule(rule: RecurrenceParams | null | undefined): NormalizedRule {
	const source = rule ?? {};
	const result: NormalizedRule = {
		mode: source.mode ?? '',
		freq: source.freq ?? '',
		interval: isEmpty(source.interval) ? 1 : source.interval,
		weekdays: weekdayList(source.weekdays),
		month_day: isEmpty(source.month_day) ? null : source.month_day,
		anchor: source.anchor === undefined || source.anchor === null ? '' : String(source.anchor),
		lead_days:
			source.lead_days === undefined || source.lead_days === null || source.lead_days === ''
				? DEFAULT_LEAD_DAYS
				: source.lead_days
	};
	const anchorDay = dayOf(result.anchor);
	if (result.mode === 'calendar' && !Number.isNaN(anchorDay)) {
		if (result.freq === 'weekly' && result.weekdays.length === 0) {
			result.weekdays = [WEEKDAYS[weekdayIndex(anchorDay)]];
		}
		if (result.freq === 'monthly' && result.month_day === null) {
			result.month_day = dayOfMonth(anchorDay);
		}
	}
	if (
		result.weekdays.length > 0 &&
		sortedWeekdays(result.weekdays).length === result.weekdays.length
	) {
		result.weekdays = sortedWeekdays(result.weekdays);
	}
	return result;
}

function anchorIsValid(anchor: unknown): boolean {
	const day = dayOf(anchor);
	if (Number.isNaN(day)) return false;
	const year = new Date(day * DAY_MS).getUTCFullYear();
	return year >= ANCHOR_MIN_YEAR && year <= ANCHOR_MAX_YEAR;
}

/** Field errors of a (normalized) rule; empty when the rule is valid. */
export function validateRule(
	rule: RecurrenceParams | NormalizedRule | null | undefined
): RecurrenceErrors {
	const r = rule ?? {};
	const errors: RecurrenceErrors = {};
	if (!isRecurrenceMode(r.mode)) errors.mode = RECURRENCE_CODES.mode;
	if (!isRecurrenceFreq(r.freq)) errors.freq = RECURRENCE_CODES.freq;
	if (!isWholeNumber(r.interval) || r.interval < INTERVAL_MIN || r.interval > INTERVAL_MAX) {
		errors.interval = RECURRENCE_CODES.interval;
	}
	const weekdays = weekdayList(r.weekdays);
	const weeklyCalendar = r.mode === 'calendar' && r.freq === 'weekly';
	if (weekdays.length > 0 && !weeklyCalendar) {
		errors.weekdays = RECURRENCE_CODES.weekdaysMode;
	} else if (weekdays.length > 0 && sortedWeekdays(weekdays).length !== weekdays.length) {
		errors.weekdays = RECURRENCE_CODES.weekdays;
	} else if (weeklyCalendar && weekdays.length === 0) {
		errors.weekdays = RECURRENCE_CODES.weekdays;
	}
	const monthDay = r.month_day;
	const hasMonthDay = !isEmpty(monthDay);
	const monthlyCalendar = r.mode === 'calendar' && r.freq === 'monthly';
	if (hasMonthDay && !monthlyCalendar) {
		errors.month_day = RECURRENCE_CODES.monthDayMode;
	} else if (
		hasMonthDay &&
		(!isWholeNumber(monthDay) ||
			(monthDay !== LAST_DAY && (monthDay < 1 || monthDay > MONTH_DAY_MAX)))
	) {
		errors.month_day = RECURRENCE_CODES.monthDay;
	} else if (monthlyCalendar && !hasMonthDay) {
		errors.month_day = RECURRENCE_CODES.monthDay;
	}
	if (!anchorIsValid(r.anchor)) errors.anchor = RECURRENCE_CODES.anchor;
	if (!isWholeNumber(r.lead_days) || r.lead_days < LEAD_DAYS_MIN || r.lead_days > LEAD_DAYS_MAX) {
		errors.lead_days = RECURRENCE_CODES.leadDays;
	}
	return errors;
}

/** The rule normalized, if it is valid; otherwise null. */
export function validRule(rule: RecurrenceParams | null | undefined): RecurrenceRule | null {
	const normalized = normalizeRule(rule);
	if (Object.keys(validateRule(normalized)).length > 0) return null;
	return {
		mode: normalized.mode as RecurrenceMode,
		freq: normalized.freq as RecurrenceFreq,
		interval: normalized.interval as number,
		weekdays: normalized.weekdays as Weekday[],
		month_day: (normalized.month_day as number | null) ?? null,
		anchor: normalized.anchor,
		lead_days: normalized.lead_days as number
	};
}

function requireMode(rule: RecurrenceParams, mode: RecurrenceMode): RecurrenceRule {
	const valid = validRule(rule);
	if (!valid || valid.mode !== mode) throw new RangeError(`Not a valid ${mode} rule`);
	return valid;
}

function weekdaySet(rule: RecurrenceRule): number[] {
	return rule.weekdays.map((day) => WEEKDAYS.indexOf(day)).sort((a, b) => a - b);
}

function weekStart(dayNumber: number): number {
	return dayNumber - weekdayIndex(dayNumber);
}

function yearlyParts(anchor: number): { firstYear: number; monthOfYear: number; day: number } {
	const anchorMonth = monthIndexOf(anchor);
	const firstYear = Math.floor(anchorMonth / 12);
	return { firstYear, monthOfYear: anchorMonth - firstYear * 12, day: dayOfMonth(anchor) };
}

/** First occurrence >= `from` (a day number). */
function firstFrom(rule: RecurrenceRule, from: number): number {
	const anchor = requireDay(rule.anchor);
	const start = Math.max(from, anchor);
	const step = rule.interval;
	switch (rule.freq) {
		case 'daily':
			return anchor + Math.ceil((start - anchor) / step) * step;
		case 'weekly': {
			const set = weekdaySet(rule);
			const firstWeek = weekStart(anchor);
			const week = firstWeek + Math.ceil((weekStart(start) - firstWeek) / 7 / step) * step * 7;
			const lowest = Math.max(start, week);
			const inWeek = set.find((day) => week + day >= lowest);
			return inWeek !== undefined ? week + inWeek : week + step * 7 + (set[0] ?? 0);
		}
		case 'monthly': {
			const monthDay = rule.month_day ?? LAST_DAY;
			const firstMonth = monthIndexOf(anchor);
			const month = firstMonth + Math.ceil((monthIndexOf(start) - firstMonth) / step) * step;
			const candidate = dayInMonth(month, monthDay);
			return candidate >= start ? candidate : dayInMonth(month + step, monthDay);
		}
		case 'yearly': {
			const { firstYear, monthOfYear, day } = yearlyParts(anchor);
			const startYear = new Date(start * DAY_MS).getUTCFullYear();
			const year = firstYear + Math.ceil((startYear - firstYear) / step) * step;
			const candidate = dayInMonth(year * 12 + monthOfYear, day);
			return candidate >= start ? candidate : dayInMonth((year + step) * 12 + monthOfYear, day);
		}
	}
}

/** Last occurrence <= `until` (a day number), or null. */
function lastUntil(rule: RecurrenceRule, until: number): number | null {
	const anchor = requireDay(rule.anchor);
	if (until < anchor) return null;
	const step = rule.interval;
	switch (rule.freq) {
		case 'daily':
			return anchor + Math.floor((until - anchor) / step) * step;
		case 'weekly': {
			const set = weekdaySet(rule);
			const firstWeek = weekStart(anchor);
			let week = firstWeek + Math.floor((weekStart(until) - firstWeek) / 7 / step) * step * 7;
			while (week >= firstWeek) {
				for (let i = set.length - 1; i >= 0; i--) {
					const day = week + (set[i] ?? 0);
					if (day <= until && day >= anchor) return day;
				}
				week -= step * 7;
			}
			return null;
		}
		case 'monthly': {
			const monthDay = rule.month_day ?? LAST_DAY;
			const firstMonth = monthIndexOf(anchor);
			let month = firstMonth + Math.floor((monthIndexOf(until) - firstMonth) / step) * step;
			let candidate = dayInMonth(month, monthDay);
			if (candidate > until) {
				month -= step;
				if (month < firstMonth) return null;
				candidate = dayInMonth(month, monthDay);
			}
			return candidate >= anchor ? candidate : null;
		}
		case 'yearly': {
			const { firstYear, monthOfYear, day } = yearlyParts(anchor);
			const untilYear = new Date(until * DAY_MS).getUTCFullYear();
			let year = firstYear + Math.floor((untilYear - firstYear) / step) * step;
			let candidate = dayInMonth(year * 12 + monthOfYear, day);
			if (candidate > until) {
				year -= step;
				if (year < firstYear) return null;
				candidate = dayInMonth(year * 12 + monthOfYear, day);
			}
			return candidate;
		}
	}
}

/** First occurrence on or after `date` (calendar rules only). */
export function onOrAfter(rule: RecurrenceParams, date: CalendarDate): CalendarDate {
	return dateOf(firstFrom(requireMode(rule, 'calendar'), requireDay(date)));
}

/** First occurrence strictly after `date` (calendar rules only). */
export function after(rule: RecurrenceParams, date: CalendarDate): CalendarDate {
	return dateOf(firstFrom(requireMode(rule, 'calendar'), requireDay(date) + 1));
}

/** Last occurrence on or before `date`, or null (calendar rules only). */
export function latestOnOrBefore(rule: RecurrenceParams, date: CalendarDate): CalendarDate | null {
	const day = lastUntil(requireMode(rule, 'calendar'), requireDay(date));
	return day === null ? null : dateOf(day);
}

/**
 * Next due date of an after-completion rule: completion date plus the interval; months and years
 * are clamped from the completion date itself (31 January + 1 month = 28/29 February).
 */
export function afterCompletion(rule: RecurrenceParams, completedDate: CalendarDate): CalendarDate {
	const valid = requireMode(rule, 'after_completion');
	const day = requireDay(completedDate);
	if (valid.freq === 'daily') return dateOf(day + valid.interval);
	if (valid.freq === 'weekly') return dateOf(day + valid.interval * 7);
	const months = valid.freq === 'monthly' ? valid.interval : valid.interval * 12;
	return dateOf(dayInMonth(monthIndexOf(day) + months, dayOfMonth(day)));
}

/**
 * Due date of the next ticket after missed occurrences (ADR-0022 section 3): `pendingDue` if no
 * further occurrence lies after it up to `today`, otherwise the latest occurrence <= today.
 */
export function catchUp(
	rule: RecurrenceParams,
	pendingDue: CalendarDate,
	today: CalendarDate
): CalendarDate {
	const pending = requireDay(pendingDue);
	const now = requireDay(today);
	if (normalizeRule(rule).mode !== 'calendar') return dateOf(pending);
	const latest = lastUntil(requireMode(rule, 'calendar'), now);
	return latest !== null && latest > pending ? dateOf(latest) : dateOf(pending);
}

/** Day from which the ticket due on `due` is created: `due` minus the lead time. */
export function createOn(due: CalendarDate, leadDays: number): CalendarDate {
	if (!isWholeNumber(leadDays) || leadDays < LEAD_DAYS_MIN || leadDays > LEAD_DAYS_MAX) {
		throw new RangeError(`Lead time out of range: ${leadDays}`);
	}
	return dateOf(requireDay(due) - leadDays);
}

/** The next `count` occurrences from `date` on (inclusive), for the preview "Nächste Termine". */
export function upcoming(
	rule: RecurrenceParams,
	date: CalendarDate,
	count: number
): CalendarDate[] {
	const valid = requireMode(rule, 'calendar');
	const result: CalendarDate[] = [];
	let day = requireDay(date);
	for (let i = 0; i < count; i++) {
		day = firstFrom(valid, day);
		result.push(dateOf(day));
		day += 1;
	}
	return result;
}

/** Weekday code (MO ... SU) of a calendar date. */
export function weekdayOf(date: CalendarDate): Weekday {
	return WEEKDAYS[weekdayIndex(requireDay(date))] as Weekday;
}
