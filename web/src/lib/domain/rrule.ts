// Suggestion of a recurrence rule from the RRULE of a calendar event (ADR-0024 section 2; E5 plan,
// package 6). Pure and only in the SPA: the hook checks the rule that is created like any other.
// The parser is strict. A part it does not know, or a series the rules cannot express (an end,
// "every 2nd Monday", several dates a day), gives "unsupported" with reasons in plain words and
// never a partial suggestion. Nothing here sets a due date or creates a rule (P-5): the form shows
// the suggestion, and only a click takes it over.

import { isCalendarDate, type CalendarDate } from './berlin-date';
import { berlinDateOf } from './format';
import type { InboxItemSummary } from './inbox';
import {
	DEFAULT_LEAD_DAYS,
	INTERVAL_MAX,
	INTERVAL_MIN,
	LAST_DAY,
	WEEKDAYS,
	onOrAfter,
	upcoming,
	validateRule,
	weekdayOf,
	type RecurrenceFreq,
	type Weekday
} from './recurrence';
import type { RecurrenceFormValues } from './recurrence-rule';
import { recurrenceTextInSentence } from './recurrence-text';

/** Parameters of a suggested rule, as the hook stores them (ADR-0021 section 1). */
export interface SuggestedParams {
	mode: 'calendar';
	freq: RecurrenceFreq;
	interval: number;
	weekdays: Weekday[];
	/** Day of the month for a monthly rule (LAST_DAY for the last day), else 0. */
	month_day: number;
	anchor: CalendarDate;
	lead_days: number;
}

export type RruleSuggestion =
	| {
			kind: 'rule';
			params: SuggestedParams;
			/** Rhythm in words for the middle of a sentence ("jeden Dienstag"). */
			text: string;
			/** Visible hints where the rule differs from the calendar (clamping). */
			notes: string[];
	  }
	| { kind: 'unsupported'; reasons: string[] };

/** Reasons in plain words; they follow "Diese Serie lässt sich nicht als Regel übernehmen (…)". */
export const RRULE_REASONS = Object.freeze({
	syntax: 'die Serie ist nicht lesbar',
	end: 'die Serie hat ein Ende',
	subDaily: 'die Serie hat mehrere Termine am Tag',
	nthWeekday: 'die Serie nennt einen bestimmten Wochentag im Monat, etwa „jeden 2. Montag“',
	weekdays:
		'die Serie verbindet Wochentage mit einem täglichen, monatlichen oder jährlichen Rhythmus',
	monthDays: 'die Serie hat mehrere Tage im Monat oder zählt vom Monatsende',
	monthDayFreq: 'die Serie verbindet Tage im Monat mit einem täglichen oder wöchentlichen Rhythmus',
	months: 'die Serie gilt nur in bestimmten Monaten',
	yearDay: 'die Serie zählt nach Tag des Jahres oder Kalenderwoche',
	yearlyOther: 'die Serie liegt an einem anderen Tag im Jahr als der erste Termin',
	weekStart: 'die Serie zählt ihre Wochen nicht ab Montag',
	interval: `das Intervall liegt nicht zwischen ${INTERVAL_MIN} und ${INTERVAL_MAX}`,
	unknown: (name: string) => `die Serie enthält den unbekannten Teil „${name}“`
});

/** Notes shown with a suggestion (ADR-0021 section 2: clamping instead of skipping). */
export const RRULE_NOTES = Object.freeze({
	shortMonths: 'In kürzeren Monaten am letzten Tag.',
	leapDay: 'In Nicht-Schaltjahren am 28.02.'
});

const FREQS: Readonly<Record<string, RecurrenceFreq>> = {
	DAILY: 'daily',
	WEEKLY: 'weekly',
	MONTHLY: 'monthly',
	YEARLY: 'yearly'
};
const SUB_DAILY = new Set(['HOURLY', 'MINUTELY', 'SECONDLY']);
const KNOWN_PARTS = new Set([
	'FREQ',
	'INTERVAL',
	'BYDAY',
	'BYMONTHDAY',
	'BYMONTH',
	'WKST',
	'UNTIL',
	'COUNT',
	'BYSETPOS',
	'BYYEARDAY',
	'BYWEEKNO',
	'BYHOUR',
	'BYMINUTE',
	'BYSECOND'
]);
const BYDAY_ENTRY = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;
const NUMBER = /^[+-]?\d{1,3}$/;

function isWeekday(value: string): value is Weekday {
	return (WEEKDAYS as readonly string[]).includes(value);
}

/** Parts of the rule by name (upper case), or null for a syntax error or a repeated part. */
function parseParts(rrule: string): Map<string, string> | null {
	const text = rrule.trim().replace(/^RRULE:/i, '');
	const parts = new Map<string, string>();
	for (const piece of text.split(';')) {
		if (piece.trim() === '') continue;
		const equals = piece.indexOf('=');
		if (equals <= 0) return null;
		const name = piece.slice(0, equals).trim().toUpperCase();
		const value = piece
			.slice(equals + 1)
			.trim()
			.toUpperCase();
		if (name === '' || value === '' || parts.has(name)) return null;
		parts.set(name, value);
	}
	return parts.size > 0 ? parts : null;
}

/**
 * "Beginnt am" of the suggestion: the first date of the series, or, when it lies in the past, the
 * first occurrence from today on. That keeps the rhythm (the same weeks, months or day of the
 * year) and spares an overdue first ticket for a series that started long ago.
 */
function anchorFor(
	params: SuggestedParams,
	start: CalendarDate,
	today: CalendarDate
): CalendarDate {
	if (start >= today) return start;
	if (params.freq === 'yearly') {
		// The rule takes month and day from the anchor: never anchor on a clamped 28 February.
		const monthDay = start.slice(5);
		return upcoming(params, today, 9).find((date) => date.slice(5) === monthDay) ?? start;
	}
	return onOrAfter(params, today);
}

/**
 * Suggestion for the RRULE of an event (ADR-0024 section 2). `startDate` is the Berlin calendar
 * date of the first occurrence, `today` the Berlin date of today. Null without an RRULE.
 */
export function suggestRule(
	rrule: string | null | undefined,
	startDate: CalendarDate,
	today: CalendarDate
): RruleSuggestion | null {
	if (typeof rrule !== 'string' || rrule.trim() === '') return null;
	const unsupported = (reasons: Iterable<string>): RruleSuggestion => ({
		kind: 'unsupported',
		reasons: [...new Set(reasons)]
	});
	if (!isCalendarDate(startDate) || !isCalendarDate(today)) {
		return unsupported([RRULE_REASONS.syntax]);
	}
	const parts = parseParts(rrule);
	if (parts === null) return unsupported([RRULE_REASONS.syntax]);

	const reasons: string[] = [];
	for (const name of parts.keys()) {
		if (!KNOWN_PARTS.has(name)) reasons.push(RRULE_REASONS.unknown(name));
	}

	const rawFreq = parts.get('FREQ');
	const freq = rawFreq === undefined ? undefined : FREQS[rawFreq];
	if (rawFreq !== undefined && SUB_DAILY.has(rawFreq)) reasons.push(RRULE_REASONS.subDaily);
	else if (freq === undefined) return unsupported([...reasons, RRULE_REASONS.syntax]);

	if (parts.has('UNTIL') || parts.has('COUNT')) reasons.push(RRULE_REASONS.end);
	if (parts.has('BYHOUR') || parts.has('BYMINUTE') || parts.has('BYSECOND')) {
		reasons.push(RRULE_REASONS.subDaily);
	}
	if (parts.has('BYSETPOS')) reasons.push(RRULE_REASONS.nthWeekday);
	if (parts.has('BYYEARDAY') || parts.has('BYWEEKNO')) reasons.push(RRULE_REASONS.yearDay);

	let interval = 1;
	const rawInterval = parts.get('INTERVAL');
	if (rawInterval !== undefined) {
		if (!/^\d{1,6}$/.test(rawInterval)) return unsupported([...reasons, RRULE_REASONS.syntax]);
		interval = Number(rawInterval);
		if (interval < INTERVAL_MIN || interval > INTERVAL_MAX) reasons.push(RRULE_REASONS.interval);
	}

	let weekdays: Weekday[] = [];
	const rawDays = parts.get('BYDAY');
	if (rawDays !== undefined) {
		for (const entry of rawDays.split(',')) {
			const match = BYDAY_ENTRY.exec(entry.trim());
			if (!match) return unsupported([...reasons, RRULE_REASONS.syntax]);
			if (match[1] !== undefined) reasons.push(RRULE_REASONS.nthWeekday);
			const day = match[2];
			if (day !== undefined && isWeekday(day) && !weekdays.includes(day)) weekdays.push(day);
		}
		if (freq !== undefined && freq !== 'weekly' && !reasons.includes(RRULE_REASONS.nthWeekday)) {
			reasons.push(RRULE_REASONS.weekdays);
		}
		weekdays = WEEKDAYS.filter((day) => weekdays.includes(day));
	}

	const [, startMonth, startDay] = startDate.split('-').map(Number) as [number, number, number];

	let monthDay: number | null = null;
	const rawMonthDays = parts.get('BYMONTHDAY');
	if (rawMonthDays !== undefined) {
		const values = rawMonthDays.split(',').map((entry) => entry.trim());
		if (values.some((value) => !NUMBER.test(value))) {
			return unsupported([...reasons, RRULE_REASONS.syntax]);
		}
		const numbers = values.map(Number);
		if (numbers.some((value) => value === 0 || value < -31 || value > 31)) {
			return unsupported([...reasons, RRULE_REASONS.syntax]);
		}
		if (freq === 'daily' || freq === 'weekly') reasons.push(RRULE_REASONS.monthDayFreq);
		else if (numbers.length > 1 || (numbers[0] ?? 0) < LAST_DAY) {
			reasons.push(RRULE_REASONS.monthDays);
		} else if (freq === 'yearly' && numbers[0] !== startDay) {
			reasons.push(RRULE_REASONS.yearlyOther);
		} else monthDay = numbers[0] ?? null;
	}

	const rawMonths = parts.get('BYMONTH');
	if (rawMonths !== undefined) {
		const values = rawMonths.split(',').map((entry) => entry.trim());
		if (
			values.some((value) => !/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 12)
		) {
			return unsupported([...reasons, RRULE_REASONS.syntax]);
		}
		if (freq !== 'yearly') reasons.push(RRULE_REASONS.months);
		else if (values.length > 1 || Number(values[0]) !== startMonth) {
			reasons.push(RRULE_REASONS.yearlyOther);
		}
	}

	const weekStart = parts.get('WKST');
	if (weekStart !== undefined) {
		if (!isWeekday(weekStart)) return unsupported([...reasons, RRULE_REASONS.syntax]);
		// Other week starts count other weeks as soon as a week holds more than one date, or the
		// first date is not one of the days (ADR-0024 section 2).
		const days = weekdays.length > 0 ? weekdays : [weekdayOf(startDate)];
		const sameWeeks = days.length === 1 && days[0] === weekdayOf(startDate);
		if (freq === 'weekly' && interval > 1 && weekStart !== 'MO' && !sameWeeks) {
			reasons.push(RRULE_REASONS.weekStart);
		}
	}

	if (reasons.length > 0 || freq === undefined) return unsupported(reasons);

	const notes: string[] = [];
	const params: SuggestedParams = {
		mode: 'calendar',
		freq,
		interval,
		weekdays: freq === 'weekly' ? (weekdays.length > 0 ? weekdays : [weekdayOf(startDate)]) : [],
		month_day: freq === 'monthly' ? (monthDay ?? startDay) : 0,
		anchor: startDate,
		lead_days: DEFAULT_LEAD_DAYS
	};
	if (freq === 'monthly' && params.month_day >= 29) notes.push(RRULE_NOTES.shortMonths);
	if (freq === 'yearly' && startDate.slice(5) === '02-29') notes.push(RRULE_NOTES.leapDay);
	if (Object.keys(validateRule(params)).length > 0) return unsupported([RRULE_REASONS.syntax]);

	params.anchor = anchorFor(params, startDate, today);
	return { kind: 'rule', params, text: recurrenceTextInSentence(params), notes };
}

/**
 * Suggestion for an inbox entry (ADR-0024 section 1): only for an event with an RRULE, a date at
 * the sender and no RECURRENCE-ID (a single changed occurrence is its own entry). Null otherwise,
 * also for a discarded entry whose RRULE the cleanup removed.
 */
export function itemSuggestion(
	item: Pick<InboxItemSummary, 'sourceDate' | 'sourceMeta'>,
	today: CalendarDate
): RruleSuggestion | null {
	const { rrule, recurrence_id: recurrenceId } = item.sourceMeta;
	if (typeof rrule !== 'string' || rrule.trim() === '') return null;
	if (recurrenceId !== undefined && recurrenceId !== null && recurrenceId !== '') return null;
	if (item.sourceDate === null) return null;
	return suggestRule(rrule, berlinDateOf(item.sourceDate), today);
}

/** Values of the form "Wiederholung" filled from a suggestion; everything stays editable. */
export function suggestionFormValues(params: SuggestedParams): RecurrenceFormValues {
	const monthly = params.freq === 'monthly';
	return {
		mode: 'calendar',
		freq: params.freq,
		interval: String(params.interval),
		weekdays: params.freq === 'weekly' ? [...params.weekdays] : [weekdayOf(params.anchor)],
		monthDay:
			monthly && params.month_day !== LAST_DAY
				? String(params.month_day)
				: String(Number(params.anchor.slice(8, 10))),
		lastDay: monthly && params.month_day === LAST_DAY,
		anchor: params.anchor,
		leadDays: String(params.lead_days)
	};
}
