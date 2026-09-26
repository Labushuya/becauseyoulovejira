// Recurrence rules in the SPA (ADR-0021 to ADR-0023; E5 plan, package 4). Pure: the rule as the
// data layer maps it, the values of the form "Wiederholen…" with their checks and preview, and
// the texts of the panel line. Every date calculation goes through recurrence.ts (E5 plan,
// section 2); the checks give the same codes as the hook (lib/recurrence.js).

import { isCalendarDate, type CalendarDate } from './berlin-date';
import {
	DEFAULT_LEAD_DAYS,
	LAST_DAY,
	RECURRENCE_CODES,
	afterCompletion,
	onOrAfter,
	upcoming,
	validRule,
	validateRule,
	weekdayOf,
	type RecurrenceFreq,
	type RecurrenceMode,
	type RecurrenceParams,
	type Weekday
} from './recurrence';
import { recurrenceTextInSentence, shortDate } from './recurrence-text';
import type { Priority } from './status';

/** A rule as the data layer maps it (ADR-0021 section 1). */
export interface RecurrenceRule {
	id: string;
	title: string;
	description: string;
	projectId: string | null;
	tagIds: string[];
	priority: Priority | null;
	/** '' only for rules from before E5 without a rhythm (paused by the migration). */
	mode: RecurrenceMode | '';
	freq: RecurrenceFreq | '';
	interval: number;
	weekdays: Weekday[];
	/** 1 to 31, LAST_DAY (-1) for the last day, null when not monthly. */
	monthDay: number | null;
	anchor: CalendarDate | null;
	leadDays: number;
	/** Due date of the next ticket not created yet; null while an after-completion rule waits. */
	nextDue: CalendarDate | null;
	/** UTC timestamp of PocketBase, null before the first ticket. */
	lastGeneratedAt: string | null;
	active: boolean;
	/** Neutral hint of the server, '' without one. */
	lastHint: string;
	created: string;
	updated: string;
}

/** Parameters of a rule for recurrence.ts. */
export function ruleParams(
	rule: Pick<
		RecurrenceRule,
		'mode' | 'freq' | 'interval' | 'weekdays' | 'monthDay' | 'anchor' | 'leadDays'
	>
): RecurrenceParams {
	return {
		mode: rule.mode,
		freq: rule.freq,
		interval: rule.interval,
		weekdays: rule.weekdays,
		month_day: rule.monthDay ?? 0,
		anchor: rule.anchor ?? '',
		lead_days: rule.leadDays
	};
}

/** Rhythm in words for the middle of a sentence ("jeden Montag"); '' without a valid rhythm. */
export function ruleText(rule: RecurrenceRule): string {
	return recurrenceTextInSentence(ruleParams(rule));
}

/** "Nächstes Ticket am 28.09.", "Nächstes Ticket nach dem Erledigen", "Pausiert". */
export function nextTicketText(rule: RecurrenceRule, today: CalendarDate): string {
	if (!rule.active) return 'Pausiert';
	if (rule.nextDue !== null) return `Nächstes Ticket am ${shortDate(rule.nextDue, today)}`;
	return 'Nächstes Ticket nach dem Erledigen';
}

/**
 * Column "Nächstes Ticket" of the overview (E5 plan, package 5): the due date of the next ticket
 * ("28.09."), or "nach dem Erledigen" while an after-completion rule waits for its instance. A
 * paused rule keeps its date for display (ADR-0023 section 4); the column "Zustand" says it pauses.
 */
export function nextTicketDate(rule: RecurrenceRule, today: CalendarDate): string {
	return rule.nextDue === null ? 'nach dem Erledigen' : shortDate(rule.nextDue, today);
}

/** "Aktiv" or "Pausiert", as text next to its icon (no state by colour alone). */
export function ruleStateLabel(rule: Pick<RecurrenceRule, 'active'>): 'Aktiv' | 'Pausiert' {
	return rule.active ? 'Aktiv' : 'Pausiert';
}

/** German texts of the codes; the same as the hook sends (tests/unit/web-recurrence.test.mjs). */
export const RECURRENCE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_recurrence_mode: 'Bitte „Fester Rhythmus“ oder „Nach Erledigung“ wählen.',
	validation_recurrence_freq: 'Bitte einen Rhythmus wählen.',
	validation_recurrence_interval: 'Das Intervall muss eine ganze Zahl von 1 bis 365 sein.',
	validation_recurrence_weekdays: 'Bitte mindestens einen Wochentag wählen.',
	validation_recurrence_weekdays_mode:
		'Wochentage gibt es nur bei einem festen wöchentlichen Rhythmus.',
	validation_recurrence_month_day:
		'Der Tag im Monat muss zwischen 1 und 31 liegen oder „Letzter Tag“ sein.',
	validation_recurrence_month_day_mode:
		'Einen Tag im Monat gibt es nur bei einem festen monatlichen Rhythmus.',
	validation_recurrence_anchor: 'Bitte ein gültiges Datum für „Beginnt am“ wählen.',
	validation_recurrence_lead_days: 'Der Vorlauf muss zwischen 0 und 30 Tagen liegen.',
	validation_recurrence_ticket_missing:
		'Das Ticket wurde nicht gefunden oder liegt in einem anderen Bereich.',
	validation_recurrence_ticket_done: 'Ein erledigtes Ticket kann keine Serie beginnen.',
	validation_recurrence_ticket_linked: 'Das Ticket gehört schon zu einer Serie.',
	validation_recurrence_managed: 'Eine Wiederholung entsteht über „Wiederholen…“ am Ticket.',
	validation_recurrence_open_instance:
		'Von dieser Serie ist schon ein anderes Ticket offen. Erledige es zuerst oder löse ein Ticket aus der Serie.'
});

/** Refusal of reopening with the key of the open ticket (ADR-0023 section 3). */
export function openInstanceMessage(key: string): string {
	return `Von dieser Serie ist schon ${key} offen. Erledige es zuerst oder löse ein Ticket aus der Serie.`;
}

// --- The form ---------------------------------------------------------------------------------

/** Values of the form as typed; numbers stay text until they are checked. */
export interface RecurrenceFormValues {
	mode: RecurrenceMode;
	freq: RecurrenceFreq;
	interval: string;
	weekdays: Weekday[];
	/** Day of the month as typed, used when `lastDay` is off. */
	monthDay: string;
	lastDay: boolean;
	anchor: string;
	leadDays: string;
}

export type RecurrenceFormField =
	'mode' | 'freq' | 'interval' | 'weekdays' | 'monthDay' | 'anchor' | 'leadDays';

/** Maps the codes of the fields of recurrence.ts to the fields of the form. */
const FORM_FIELDS: Readonly<Record<string, RecurrenceFormField>> = {
	mode: 'mode',
	freq: 'freq',
	interval: 'interval',
	weekdays: 'weekdays',
	month_day: 'monthDay',
	anchor: 'anchor',
	lead_days: 'leadDays'
};

/** Server field names for the field errors of the form. */
export const SERVER_FIELDS: Readonly<Record<RecurrenceFormField, string>> = Object.freeze({
	mode: 'mode',
	freq: 'freq',
	interval: 'interval',
	weekdays: 'weekdays',
	monthDay: 'month_day',
	anchor: 'anchor',
	leadDays: 'lead_days'
});

/**
 * Values of "Wiederholen…" (E5 plan, package 4): fixed rhythm, weekly on the weekday of the due
 * date or of today, starting on the due date or today, lead time 3 (OF-E5-1).
 */
export function defaultFormValues(
	due: CalendarDate | null,
	today: CalendarDate
): RecurrenceFormValues {
	const anchor = due ?? today;
	return {
		mode: 'calendar',
		freq: 'weekly',
		interval: '1',
		weekdays: [weekdayOf(anchor)],
		monthDay: String(Number(anchor.slice(8, 10))),
		lastDay: false,
		anchor,
		leadDays: String(DEFAULT_LEAD_DAYS)
	};
}

/** Values of the form for an existing rule ("Regel bearbeiten"). */
export function formValuesOf(rule: RecurrenceRule, today: CalendarDate): RecurrenceFormValues {
	const anchor = rule.anchor ?? today;
	return {
		mode: rule.mode === '' ? 'calendar' : rule.mode,
		freq: rule.freq === '' ? 'weekly' : rule.freq,
		interval: String(rule.interval || 1),
		weekdays: rule.weekdays.length > 0 ? [...rule.weekdays] : [weekdayOf(anchor)],
		monthDay:
			rule.monthDay !== null && rule.monthDay !== LAST_DAY
				? String(rule.monthDay)
				: String(Number(anchor.slice(8, 10))),
		lastDay: rule.monthDay === LAST_DAY,
		anchor,
		leadDays: String(rule.leadDays)
	};
}

/** A whole number from typed text, or NaN (then the check reports the field). */
function wholeNumber(text: string): number {
	return /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

/**
 * Parameters as sent to the server: weekdays only for a fixed weekly rhythm, the day of the
 * month only for a fixed monthly one, so switching the rhythm leaves nothing behind.
 */
export function formParams(values: RecurrenceFormValues): {
	mode: RecurrenceMode;
	freq: RecurrenceFreq;
	interval: number;
	weekdays: Weekday[];
	month_day: number;
	anchor: string;
	lead_days: number;
} {
	const calendar = values.mode === 'calendar';
	return {
		mode: values.mode,
		freq: values.freq,
		interval: wholeNumber(values.interval),
		weekdays: calendar && values.freq === 'weekly' ? [...values.weekdays] : [],
		month_day:
			calendar && values.freq === 'monthly'
				? values.lastDay
					? LAST_DAY
					: wholeNumber(values.monthDay)
				: 0,
		anchor: values.anchor,
		lead_days: wholeNumber(values.leadDays)
	};
}

/**
 * Whether two sets of form values send the same rhythm and lead time. The rule panel sends the
 * rhythm only when it changed, so saving the template alone leaves "Nächstes Ticket" as it is.
 */
export function sameRhythm(a: RecurrenceFormValues, b: RecurrenceFormValues): boolean {
	const left = formParams(a);
	const right = formParams(b);
	return (
		left.mode === right.mode &&
		left.freq === right.freq &&
		Object.is(left.interval, right.interval) &&
		left.weekdays.join(',') === right.weekdays.join(',') &&
		Object.is(left.month_day, right.month_day) &&
		left.anchor === right.anchor &&
		Object.is(left.lead_days, right.lead_days)
	);
}

/** Problems of the form per field, with the texts of the hook; empty when it may be sent. */
export function formErrors(
	values: RecurrenceFormValues
): Partial<Record<RecurrenceFormField, string>> {
	const params = formParams(values);
	const codes = validateRule(params);
	const errors: Partial<Record<RecurrenceFormField, string>> = {};
	for (const [field, code] of Object.entries(codes)) {
		const formField = FORM_FIELDS[field];
		if (formField !== undefined && code !== undefined) {
			errors[formField] = RECURRENCE_MESSAGES[code] ?? code;
		}
	}
	// A number the browser could not read is not "missing": say what is wrong with it.
	if (
		values.mode === 'calendar' &&
		values.freq === 'monthly' &&
		!values.lastDay &&
		Number.isNaN(params.month_day)
	) {
		errors.monthDay = RECURRENCE_MESSAGES[RECURRENCE_CODES.monthDay];
	}
	return errors;
}

export interface RecurrencePreview {
	/** The next dates of a fixed rhythm, or the date after completing today. */
	dates: CalendarDate[];
	/** Due date a ticket without one gets with a fixed rhythm (ADR-0023 section 1), else null. */
	firstDue: CalendarDate | null;
}

/**
 * Preview of the form: for a fixed rhythm the next three dates from the start (not before
 * today), after completion the date that follows a completion today. Empty while the values are
 * invalid. `withoutDue`: the ticket has no due date yet and gets the first occurrence.
 */
export function formPreview(
	values: RecurrenceFormValues,
	today: CalendarDate,
	withoutDue = false
): RecurrencePreview {
	const rule = validRule(formParams(values));
	const invalid = rule === null || Object.keys(formErrors(values)).length > 0;
	if (invalid || !isCalendarDate(rule.anchor)) return { dates: [], firstDue: null };
	if (rule.mode === 'after_completion') {
		return { dates: [afterCompletion(rule, today)], firstDue: null };
	}
	const from = rule.anchor > today ? rule.anchor : today;
	return {
		dates: upcoming(rule, from, 3),
		firstDue: withoutDue ? onOrAfter(rule, rule.anchor) : null
	};
}

/**
 * The ticket after "Wiederholen…" (ADR-0023 section 1), as the server leaves it: in the series,
 * and with a fixed rhythm a ticket without due date gets the first occurrence. For panel and list
 * until the realtime event of the server follows.
 */
export function joinedSeries<
	T extends { due: CalendarDate | null; recurring: boolean; recurrenceId?: string | null }
>(ticket: T, ruleId: string, values: RecurrenceFormValues, today: CalendarDate): T {
	const firstDue =
		ticket.due === null && values.mode === 'calendar'
			? formPreview(values, today, true).firstDue
			: null;
	return { ...ticket, recurring: true, recurrenceId: ruleId, due: ticket.due ?? firstDue };
}
