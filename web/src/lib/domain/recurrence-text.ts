// Rhythm of a rule in words (ADR-0021 section 3; E5 plan, package 1), only in the SPA: the panel
// line "Wiederholt sich: …", the accessible name of the symbol in the table and the overview.

import type { CalendarDate } from './berlin-date';
import {
	LAST_DAY,
	WEEKDAYS,
	type RecurrenceParams,
	type Weekday,
	validRule,
	weekdayOf
} from './recurrence';

export const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = Object.freeze({
	MO: 'Montag',
	TU: 'Dienstag',
	WE: 'Mittwoch',
	TH: 'Donnerstag',
	FR: 'Freitag',
	SA: 'Samstag',
	SU: 'Sonntag'
});

export const WEEKDAY_SHORT: Readonly<Record<Weekday, string>> = Object.freeze({
	MO: 'Mo',
	TU: 'Di',
	WE: 'Mi',
	TH: 'Do',
	FR: 'Fr',
	SA: 'Sa',
	SU: 'So'
});

const MONTH_NAMES = [
	'Januar',
	'Februar',
	'März',
	'April',
	'Mai',
	'Juni',
	'Juli',
	'August',
	'September',
	'Oktober',
	'November',
	'Dezember'
] as const;

const WORKDAYS: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

/** Units in singular and plural, for "alle 2 Wochen" and "1 Monat nach Erledigung". */
const UNITS = {
	daily: ['Tag', 'Tage'],
	weekly: ['Woche', 'Wochen'],
	monthly: ['Monat', 'Monate'],
	yearly: ['Jahr', 'Jahre']
} as const;

/** "Montag", "Montag und Donnerstag", "Montag, Mittwoch und Freitag". */
export function joinWords(words: readonly string[]): string {
	if (words.length <= 1) return words[0] ?? '';
	return `${words.slice(0, -1).join(', ')} und ${words[words.length - 1]}`;
}

function isWorkdays(days: readonly Weekday[]): boolean {
	return days.length === WORKDAYS.length && WORKDAYS.every((day) => days.includes(day));
}

function sortedDays(days: readonly Weekday[]): Weekday[] {
	return WEEKDAYS.filter((day) => days.includes(day));
}

function amount(count: number, unit: keyof typeof UNITS): string {
	const [one, many] = UNITS[unit];
	return `${count} ${count === 1 ? one : many}`;
}

/**
 * Rhythm in words, starting with a capital letter: "Täglich", "Alle 2 Tage", "Jeden Montag und
 * Donnerstag", "Alle 2 Wochen am Montag", "Werktags", "Monatlich am 15.", "Monatlich am letzten
 * Tag", "Jährlich am 29. Februar", "3 Tage nach Erledigung". Empty for an invalid rule.
 */
export function recurrenceText(rule: RecurrenceParams | null | undefined): string {
	const valid = validRule(rule);
	if (!valid) return '';
	const { interval } = valid;
	if (valid.mode === 'after_completion') {
		return `${amount(interval, valid.freq)} nach Erledigung`;
	}
	switch (valid.freq) {
		case 'daily':
			return interval === 1 ? 'Täglich' : `Alle ${interval} Tage`;
		case 'weekly': {
			const days = sortedDays(valid.weekdays);
			if (isWorkdays(days)) return interval === 1 ? 'Werktags' : `Alle ${interval} Wochen werktags`;
			const names = joinWords(days.map((day) => WEEKDAY_NAMES[day]));
			return interval === 1 ? `Jeden ${names}` : `Alle ${interval} Wochen am ${names}`;
		}
		case 'monthly': {
			const day = valid.month_day === LAST_DAY ? 'letzten Tag' : `${valid.month_day}.`;
			return interval === 1 ? `Monatlich am ${day}` : `Alle ${interval} Monate am ${day}`;
		}
		case 'yearly': {
			const [, month, day] = valid.anchor.split('-').map(Number) as [number, number, number];
			const date = `${day}. ${MONTH_NAMES[month - 1]}`;
			return interval === 1 ? `Jährlich am ${date}` : `Alle ${interval} Jahre am ${date}`;
		}
	}
}

/** The same text for the middle of a sentence: "Wiederholt sich: jeden Montag". */
export function recurrenceTextInSentence(rule: RecurrenceParams | null | undefined): string {
	const text = recurrenceText(rule);
	return /^\d/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/** A calendar date as "28.09." (current year) or "28.09.2027", for "Nächstes Ticket am …". */
export function shortDate(date: CalendarDate, today: CalendarDate): string {
	const [year, month, day] = date.split('-');
	const [currentYear] = today.split('-');
	return year === currentYear ? `${day}.${month}.` : `${day}.${month}.${year}`;
}

/**
 * A calendar date with its weekday, "Mo 05.10." (current year) or "Mo 05.10.2027", for the preview
 * "erscheint … → fällig …" and the examples (plan "Wiederholungen verständlich machen").
 */
export function dayLabel(date: CalendarDate, today: CalendarDate): string {
	return `${WEEKDAY_SHORT[weekdayOf(date)]} ${shortDate(date, today)}`;
}
