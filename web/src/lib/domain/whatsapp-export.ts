// WhatsApp chat export (E4 plan, package 16; ADR-0016 section 3, ADR-0017 section 3). Pure: reads
// the text of the official export ("Chat exportieren", without media) from Android and iOS in
// German and English settings and turns chosen messages into inbox drafts. The export has no
// time zone; its times are Berlin wall-clock times (ADR-0017 section 3).
//
// Line formats (the date order follows the phone settings):
//   Android: "25.09.26, 14:03 - Anna: Text"  ·  "9/25/26, 2:03 PM - Anna: Text"
//   iOS:     "[25.09.26, 14:03:12] Anna: Text"  ·  "[25/09/2026, 14:03:12] Anna: Text"
// Lines without such a head continue the message before. System lines (encryption notice, group
// changes) and placeholders of left-out media are not offered.

import { berlinWallClockToUtc, isCalendarDate, type CalendarDate } from './berlin-date';
import { toPocketBaseTimestamp } from './format';
import type { InboxDraft } from './inbox';

export type ExportFormat = 'android' | 'ios';

export interface ChatMessage {
	/** Position in the export, from 0; stable key of the selection. */
	index: number;
	sender: string;
	/** Text with its line breaks. */
	text: string;
	/** UTC instant (ms) of the Berlin wall-clock time of the export. */
	sentAt: number;
	/** Berlin calendar date of the message, for the period filter. */
	date: CalendarDate;
	/** Wall-clock time `HH:MM` as in the export. */
	time: string;
}

export type ExportParseResult =
	| { ok: true; format: ExportFormat; messages: ChatMessage[]; leftOut: number }
	| { ok: false; message: string };

export const FORMAT_NOT_RECOGNISED =
	'Format nicht erkannt. Erwartet wird ein WhatsApp-Chatexport (.txt oder .zip).';

/** Chat name when the file name says nothing about it (e.g. `_chat.txt`). */
export const DEFAULT_CHAT_NAME = 'WhatsApp-Chat';

const MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const LEADING_MARK = /^[\u200e\u200f]/;
// Day, month and year in the order of the settings; time with optional seconds and AM/PM (with a
// normal or narrow no-break space before it).
const DATE_TIME =
	'(\\d{1,2})([./])(\\d{1,2})\\2(\\d{2}|\\d{4}),?\\s(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:[\\s\\u202f]?([AaPp])\\.?\\s?[Mm]\\.?)?';
const IOS_HEAD = new RegExp(`^\\[${DATE_TIME}\\]\\s(.*)$`);
const ANDROID_HEAD = new RegExp(`^${DATE_TIME}\\s[-–]\\s(.*)$`);
// "Sender: text"; a sender has no colon and at most 80 characters.
const SENDER_TEXT = /^([^:\n]{1,80}?):\s(.*)$/s;

/** Placeholders of left-out media and deleted messages (German and English). */
const LEFT_OUT = [
	/^<(?:Medien ausgeschlossen|Media omitted)>$/i,
	/^(?:Bild|Video|Audio|Sticker|GIF|Dokument|Kontaktkarte) weggelassen$/i,
	/^(?:image|video|audio|sticker|GIF|document|Contact card) omitted$/i,
	/^<(?:Anhang|attached):[^>]*>$/i,
	/^(?:Diese Nachricht wurde gelöscht\.?|Du hast diese Nachricht gelöscht\.?)$/i,
	/^(?:This message was deleted\.?|You deleted this message\.?)$/i,
	/^null$/
];

interface Head {
	a: number;
	b: number;
	year: number;
	separator: string;
	hour: number;
	minute: number;
	second: number;
	meridiem: string;
	rest: string;
}

function headOf(line: string, format: ExportFormat): Head | null {
	const match = (format === 'ios' ? IOS_HEAD : ANDROID_HEAD).exec(line);
	if (!match) return null;
	const [, a, separator, b, year, hour, minute, second, meridiem, rest] = match;
	return {
		a: Number(a),
		b: Number(b),
		year: Number(year),
		separator: separator ?? '.',
		hour: Number(hour),
		minute: Number(minute),
		second: Number(second ?? 0),
		meridiem: (meridiem ?? '').toLowerCase(),
		rest: rest ?? ''
	};
}

/** Day first, unless a slash format shows otherwise (US exports: month first, with AM/PM). */
function dayFirst(heads: readonly Head[]): boolean {
	if (heads.every((head) => head.separator === '.')) return true;
	if (heads.some((head) => head.a > 12)) return true;
	if (heads.some((head) => head.b > 12)) return false;
	return !heads.some((head) => head.meridiem !== '');
}

const pad = (value: number) => String(value).padStart(2, '0');

function dateAndTime(
	head: Head,
	dayFirstOrder: boolean
): { date: CalendarDate; time: string; sentAt: number } | null {
	const day = dayFirstOrder ? head.a : head.b;
	const month = dayFirstOrder ? head.b : head.a;
	const year = head.year < 100 ? 2000 + head.year : head.year;
	let hour = head.hour;
	if (head.meridiem !== '') {
		if (hour < 1 || hour > 12) return null;
		hour = (hour % 12) + (head.meridiem === 'p' ? 12 : 0);
	}
	if (hour > 23 || head.minute > 59 || head.second > 59) return null;
	const date = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
	if (!isCalendarDate(date)) return null;
	const time = `${pad(hour)}:${pad(head.minute)}`;
	return { date, time, sentAt: berlinWallClockToUtc(date, time) + head.second * 1000 };
}

function isLeftOut(text: string): boolean {
	if (LEADING_MARK.test(text)) return true;
	const plain = text.replace(MARKS, '').trim();
	return plain === '' || LEFT_OUT.some((pattern) => pattern.test(plain));
}

/**
 * Reads the text of an export. Returns the messages that can become entries, in the order of the
 * export, and how many lines were left out (system lines, media, deleted messages); or
 * "Format nicht erkannt" if no line has the head of a message.
 */
export function parseWhatsAppExport(input: string): ExportParseResult {
	const lines = input.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
	const format: ExportFormat | null = lines.some((line) =>
		IOS_HEAD.test(line.replace(LEADING_MARK, ''))
	)
		? 'ios'
		: lines.some((line) => ANDROID_HEAD.test(line.replace(LEADING_MARK, '')))
			? 'android'
			: null;
	if (format === null) return { ok: false, message: FORMAT_NOT_RECOGNISED };

	const entries: { head: Head | null; text: string }[] = [];
	for (const raw of lines) {
		const head = headOf(raw.replace(LEADING_MARK, ''), format);
		if (head !== null) entries.push({ head, text: head.rest });
		else if (entries.length > 0) {
			const last = entries[entries.length - 1] as { text: string };
			last.text += `\n${raw}`;
		}
	}
	const heads = entries.map((entry) => entry.head).filter((head): head is Head => head !== null);
	const order = dayFirst(heads);

	const messages: ChatMessage[] = [];
	let leftOut = 0;
	for (const entry of entries) {
		const head = entry.head as Head;
		const when = dateAndTime(head, order);
		const split = SENDER_TEXT.exec(entry.text);
		const text = split?.[2]?.replace(/\s+$/, '') ?? '';
		if (when === null || split === null || isLeftOut(text)) {
			leftOut += 1;
			continue;
		}
		messages.push({
			index: messages.length,
			sender: (split[1] ?? '').replace(MARKS, '').trim(),
			text,
			...when
		});
	}
	if (messages.length === 0 && leftOut === 0) return { ok: false, message: FORMAT_NOT_RECOGNISED };
	return { ok: true, format, messages, leftOut };
}

/**
 * Chat name from the file name of the export: "WhatsApp Chat mit Anna.txt", "WhatsApp Chat with
 * Anna.zip" and "WhatsApp Chat - Anna.zip" give "Anna"; anything else without its extension, and
 * `_chat.txt` the default name.
 */
export function chatNameOf(fileName: string): string {
	const base = fileName
		.replace(/^.*[/\\]/, '')
		.replace(/\.(txt|zip)$/i, '')
		.replace(/^WhatsApp[\s_-]*Chat(?:\s+(?:mit|with)\s+|\s*[-–]\s*|\s+)?/i, '')
		.trim();
	return base === '' || base === '_chat' ? DEFAULT_CHAT_NAME : base.slice(0, 200);
}

/** Senders of the messages, sorted, each once (filter "Absender"). */
export function sendersOf(messages: readonly ChatMessage[]): string[] {
	return [...new Set(messages.map((message) => message.sender))].sort((a, b) =>
		a.localeCompare(b, 'de')
	);
}

export interface MessageFilter {
	/** Only this sender; '' for all. */
	sender: string;
	/** First and last Berlin date; '' for open. */
	from: CalendarDate | '';
	to: CalendarDate | '';
}

export const NO_MESSAGE_FILTER: Readonly<MessageFilter> = Object.freeze({
	sender: '',
	from: '',
	to: ''
});

export function matchesMessageFilter(message: ChatMessage, filter: MessageFilter): boolean {
	if (filter.sender !== '' && message.sender !== filter.sender) return false;
	if (filter.from !== '' && message.date < filter.from) return false;
	if (filter.to !== '' && message.date > filter.to) return false;
	return true;
}

const TITLE_MAX_LENGTH = 200;

/** Title of a message: its first non-empty line, cut to 200 characters with "…". */
export function messageTitle(text: string): string {
	const line = text
		.split('\n')
		.map((part) => part.replace(/\s+/g, ' ').trim())
		.find((part) => part !== '');
	const title = line ?? '(ohne Text)';
	return title.length <= TITLE_MAX_LENGTH ? title : `${title.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

/**
 * Inbox draft of a chosen message (kind "message"). Chat, time, sender and text form the duplicate
 * key in the hook (ADR-0014 section 3): importing the same export again gives duplicates, and two
 * equal messages at the same minute count as one.
 */
export function messageDraft(message: ChatMessage, chat: string): InboxDraft {
	return {
		channel: 'whatsapp',
		kind: 'message',
		title: messageTitle(message.text),
		body: message.text,
		sourceDate: toPocketBaseTimestamp(message.sentAt),
		sourceMeta: { chat, sender: message.sender }
	};
}
