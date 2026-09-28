// Time and sender of a message from the attribute data-pre-plain-text (ADR-0038 §3), e.g.
// "[14:32, 28.9.2026] Anna Beispiel: ". WhatsApp writes it in the language of the browser: 24 or
// 12 hours, day and month with "." (German), "/" (English) or "-" and the year first. Pure; the
// time zone of the browser applies, as in WhatsApp Web itself.

export interface PrePlain {
	sender: string;
	/** Time of the message in ms, null when it cannot be read. */
	time: number | null;
	/** ISO 8601 with the offset of the browser, e.g. 2026-09-28T14:32:00+02:00; null without time. */
	sentAt: string | null;
}

const PRE_PLAIN = /^\[([^\]]+)\]\s*([\s\S]*?):\s*$/;
const TIME = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(?:([AaPp])\.?\s?[Mm]\.?)?$/;
const DATE = /^(\d{1,4})([./-])(\d{1,2})\2(\d{1,4})$/;

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/** ISO 8601 of a local time with the offset of the browser. */
export function isoWithOffset(date: Date): string {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	const absolute = Math.abs(offset);
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
		`${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
	);
}

/** Year, month and day of a date part; `monthFirst` decides "1/2/2026" for English (US). */
function dateOf(value: string, monthFirst: boolean): [number, number, number] | null {
	const match = DATE.exec(value.trim());
	if (!match) return null;
	const [, a = '', separator, b = '', c = ''] = match;
	if (a.length === 4) return [Number(a), Number(b), Number(c)];
	if (c.length !== 4 && c.length !== 2) return null;
	const year = c.length === 2 ? 2000 + Number(c) : Number(c);
	const first = Number(a);
	const second = Number(b);
	if (separator === '.') return [year, second, first];
	if (first > 12) return [year, second, first];
	if (second > 12) return [year, first, second];
	return monthFirst ? [year, first, second] : [year, second, first];
}

/** Hours and minutes of a time part, with AM and PM. */
function timeOf(value: string): [number, number, number] | null {
	const match = TIME.exec(value.trim());
	if (!match) return null;
	let hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = match[3] === undefined ? 0 : Number(match[3]);
	const half = match[4]?.toLowerCase();
	if (half !== undefined) {
		if (hours < 1 || hours > 12) return null;
		hours = (hours % 12) + (half === 'p' ? 12 : 0);
	}
	if (hours > 23 || minutes > 59 || seconds > 59) return null;
	return [hours, minutes, seconds];
}

/** Whether the language of the browser writes the month first (English, United States). */
export function monthFirstFor(locale: string): boolean {
	return /^en-US\b/i.test(locale) || locale.toLowerCase() === 'en';
}

/**
 * Sender and time of a message. A value that does not match gives an empty sender and no time;
 * the message can still be taken by hand.
 */
export function parsePrePlain(value: string | null, locale: string): PrePlain {
	const match = PRE_PLAIN.exec(value ?? '');
	if (!match) return { sender: '', time: null, sentAt: null };
	const sender = (match[2] ?? '').trim();
	const parts = (match[1] ?? '').split(',').map((part) => part.trim());
	if (parts.length !== 2) return { sender, time: null, sentAt: null };
	const timeFirst = (parts[0] ?? '').includes(':');
	const clock = timeOf((timeFirst ? parts[0] : parts[1]) ?? '');
	const day = dateOf((timeFirst ? parts[1] : parts[0]) ?? '', monthFirstFor(locale));
	if (clock === null || day === null) return { sender, time: null, sentAt: null };
	const [year, month, date] = day;
	const local = new Date(year, month - 1, date, clock[0], clock[1], clock[2]);
	if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== date) {
		return { sender, time: null, sentAt: null };
	}
	return { sender, time: local.getTime(), sentAt: isoWithOffset(local) };
}
