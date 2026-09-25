// iCalendar parser of the hooks (ADR-0017 section 1, E4 plan package 14) against the invented
// fixtures in tests/fixtures/ics: Google, Outlook and Apple exports and a file with edge cases
// (LF only, BOM, no UID, date without time, DURATION, floating and foreign time zones).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const ical = loadHookLib('ical.js');
const berlin = loadHookLib('berlin-time.js');

const fixture = (name) =>
	readFileSync(new URL(`../fixtures/ics/${name}`, import.meta.url), 'utf8');
const parse = (text) => ical.parse(text, berlin);
const byRef = (drafts, ref, recurrence) =>
	drafts.find((draft) => draft.source_ref === ref && draft.meta.recurrence_id === recurrence);

describe('ical.js: lines', () => {
	it('unfolds CRLF, LF and CR lines with space or tab and drops a BOM', () => {
		const lines = ical.unfold('﻿A:1\r\n  b\r\n\tc\nB:2\rC:3');
		expect(lines.map((line) => line.value)).toEqual(['A:1 bc', 'B:2', 'C:3']);
		expect(lines[0].raw).toBe('A:1\r\n  b\r\n\tc');
	});

	it('reads parameters with quotes, lists and colons', () => {
		expect(ical.parseLine('DTSTART;TZID="W. Europe: Time";X=a,"b,c":20261110T100000')).toEqual({
			name: 'DTSTART',
			params: { TZID: ['W. Europe: Time'], X: ['a', 'b,c'] },
			value: '20261110T100000'
		});
		expect(ical.parseLine('summary:klein')).toEqual({ name: 'SUMMARY', params: {}, value: 'klein' });
		expect(ical.parseLine('keine Zeile')).toBeNull();
		expect(ical.parseLine('X;P="offen:1')).toBeNull();
	});

	it('unescapes text values once', () => {
		expect(ical.unescapeText('a\\, b\\; c\\nd\\Ne\\\\n')).toBe('a, b; c\nd\ne\\n');
	});

	it('reads durations', () => {
		expect(ical.parseDuration('PT1H30M')).toBe(90 * 60 * 1000);
		expect(ical.parseDuration('P1W')).toBe(7 * 24 * 3600 * 1000);
		expect(ical.parseDuration('-P1D')).toBe(-24 * 3600 * 1000);
		expect(ical.parseDuration('P')).toBeNull();
		expect(ical.parseDuration('1H')).toBeNull();
	});
});

describe('ical.js: Google export', () => {
	const result = parse(fixture('google.ics'));

	it('takes every event but the cancelled one', () => {
		expect(result.drafts).toHaveLength(5);
		expect(result.skipped).toBe(1);
		expect(result.invalidLines).toBe(0);
		expect(result.drafts.every((draft) => draft.kind === 'event')).toBe(true);
	});

	it('converts TZID Europe/Berlin on both change days', () => {
		const spring = byRef(result.drafts, 'fixture-spring@example.com');
		expect(spring.source_date).toBe('2026-03-29 08:00:00.000Z');
		expect(spring.meta.end).toBe('2026-03-29 09:00:00.000Z');
		expect(spring.meta.tz_approx).toBeUndefined();
		const autumn = byRef(result.drafts, 'fixture-autumn@example.com');
		expect(autumn.source_date).toBe('2026-10-25 09:00:00.000Z');
	});

	it('unfolds and unescapes texts with umlauts', () => {
		const spring = byRef(result.drafts, 'fixture-spring@example.com');
		expect(spring.title).toBe('Zahnarzt nach der Umstellung');
		expect(spring.body).toBe(
			'Unterlagen mitbringen, Versichertenkarte; danach Einkauf.\nZweite Zeile mit Umlauten: Grüße aus Köln – äöüß.'
		);
		expect(spring.meta.location).toBe('Praxis Dr. Beispiel, Hauptstraße 1');
	});

	it('reads UTC times and http(s) links', () => {
		const utc = byRef(result.drafts, 'fixture-utc@example.com');
		expect(utc.source_date).toBe('2026-10-01 08:00:00.000Z');
		expect(utc.source_url).toBe('https://example.com/konferenz');
	});

	it('keeps a series as one entry with its RRULE and the moved occurrence apart', () => {
		const series = byRef(result.drafts, 'fixture-series@example.com');
		expect(series.meta.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
		expect(series.source_date).toBe('2026-09-07 16:30:00.000Z');
		const moved = byRef(result.drafts, 'fixture-series@example.com', '20260921T163000Z');
		expect(moved.title).toBe('Chorprobe (verschoben)');
		expect(moved.meta.rrule).toBeUndefined();
	});

	it('keeps each component with the envelope and its time zone as original', () => {
		const spring = byRef(result.drafts, 'fixture-spring@example.com');
		expect(spring.original.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google Inc')).toBe(true);
		expect(spring.original).toContain('BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin');
		expect(spring.original).toContain('DESCRIPTION:Unterlagen mitbringen\\, Versichertenkarte\\; danach Einkauf.\\nZwei\r\n te Zeile');
		expect(spring.original).not.toContain('fixture-autumn');
		expect(spring.original.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
		const utc = byRef(result.drafts, 'fixture-utc@example.com');
		expect(utc.original).not.toContain('VTIMEZONE');
	});
});

describe('ical.js: Outlook export', () => {
	const result = parse(fixture('outlook.ics'));

	it('reads the Windows zone name as Berlin and ignores the alarm', () => {
		const meeting = result.drafts[0];
		expect(meeting.title).toBe('Quartalsplanung');
		expect(meeting.source_date).toBe('2026-11-10 09:00:00.000Z');
		expect(meeting.meta.end).toBe('2026-11-10 10:30:00.000Z');
		expect(meeting.meta.tz_approx).toBeUndefined();
		expect(meeting.body).toBe('Quartalsplanung mit dem Team.\n\nBitte Zahlen vorbereiten.\n');
		expect(meeting.original).toContain('BEGIN:VALARM');
		expect(meeting.original).toContain('TZID:W. Europe Standard Time');
	});

	it('keeps the date of an all-day event over several days', () => {
		const holiday = result.drafts[1];
		expect(holiday.meta.all_day).toBe(true);
		expect(holiday.source_date).toBe('2026-12-23 23:00:00.000Z');
		expect(holiday.startDate).toBe('2026-12-24');
		expect(holiday.endDate).toBe('2026-12-26');
		expect(berlin.berlinToday(Date.parse(holiday.source_date.replace(' ', 'T')))).toBe('2026-12-24');
	});
});

describe('ical.js: Apple export', () => {
	const result = parse(fixture('apple.ics'));

	it('reads the event, not the description of its alarm', () => {
		const event = result.drafts.find((draft) => draft.kind === 'event');
		expect(event.title).toBe('Elternabend');
		expect(event.body).toBe('');
		expect(event.meta.location).toBe('Grundschule am Park\nRaum 12');
		expect(event.source_date).toBe('2026-11-03 15:00:00.000Z');
	});

	it('takes a VTODO with its due date as the date at the sender', () => {
		const todo = result.drafts.find((draft) => draft.kind === 'todo');
		expect(todo.title).toBe('Steuererklärung abgeben');
		expect(todo.source_date).toBe('2026-10-30 23:00:00.000Z');
		expect(todo.meta.all_day).toBe(true);
		expect(todo.startDate).toBe('2026-10-31');
	});
});

describe('ical.js: edge cases', () => {
	const result = parse(fixture('edge-cases.ics'));
	const byTitle = (title) => result.drafts.find((draft) => draft.title === title);

	it('reads LF only with BOM, counts invalid lines and skips a cut-off component', () => {
		expect(result.drafts.map((draft) => draft.title)).toEqual([
			'Ohne UID',
			'Datum ohne Zeit',
			'Floating',
			'New York',
			'(ohne Titel)'
		]);
		expect(result.invalidLines).toBe(1);
		expect(result.skipped).toBe(1);
	});

	it('takes DURATION instead of DTEND and allows a missing UID', () => {
		const noUid = byTitle('Ohne UID');
		expect(noUid.source_ref).toBe('');
		expect(noUid.meta.end).toBe('2026-11-05 10:30:00.000Z');
	});

	it('reads a DTSTART without time as an all-day date', () => {
		const dateOnly = byTitle('Datum ohne Zeit');
		expect(dateOnly.meta.all_day).toBe(true);
		expect(dateOnly.startDate).toBe('2026-11-05');
		const twoDays = byTitle('(ohne Titel)');
		expect(twoDays.endDate).toBe('2026-11-07');
	});

	it('reads floating and foreign times as Berlin time and marks them', () => {
		expect(byTitle('Floating').source_date).toBe('2026-07-15 07:00:00.000Z');
		expect(byTitle('Floating').meta.tz_approx).toBe(true);
		expect(byTitle('New York').meta.tz_approx).toBe(true);
	});

	it('drops links other than http(s)', () => {
		expect(byTitle('(ohne Titel)').source_url).toBe('');
	});

	it('gives the same result for CRLF and LF', () => {
		const crlf = fixture('google.ics');
		const lf = crlf.replace(/\r\n/g, '\n');
		const strip = (drafts) => drafts.map(({ original, ...rest }) => rest);
		expect(strip(parse(lf).drafts)).toEqual(strip(parse(crlf).drafts));
	});
});

describe('ical.js: limits', () => {
	it('reads at most 5 000 components and counts the rest as skipped', () => {
		const events = [];
		for (let i = 0; i < ical.MAX_COMPONENTS + 3; i++) {
			events.push(`BEGIN:VEVENT\r\nUID:limit-${i}\r\nSUMMARY:Termin ${i}\r\nDTSTART:20261001T080000Z\r\nEND:VEVENT`);
		}
		const result = parse(`BEGIN:VCALENDAR\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`);
		expect(result.drafts).toHaveLength(ical.MAX_COMPONENTS);
		expect(result.skipped).toBe(3);
	});

	it('does not read a text over 20 MB', () => {
		const result = parse('X'.repeat(ical.MAX_TEXT_LENGTH + 1));
		expect(result).toEqual({ drafts: [], skipped: 0, invalidLines: 0, tooLarge: true });
	});

	it('skips everything of a cancellation (METHOD:CANCEL)', () => {
		const result = parse(
			'BEGIN:VCALENDAR\r\nMETHOD:CANCEL\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Weg\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
		);
		expect(result.drafts).toEqual([]);
		expect(result.skipped).toBe(1);
	});
});
