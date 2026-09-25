// Google Calendar channel, pure part (E4 plan, package 15): the window today .. +30 days in
// Berlin, series with and without UNTIL, and when a new entry follows a changed event.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const calendar = loadHookLib('channel-calendar.js');
const berlin = loadHookLib('berlin-time.js');
const inboxRules = loadHookLib('inbox-rules.js');

const TODAY = '2026-09-25';
const draft = (title, startDate, endDate = startDate, meta = {}) => ({ title, startDate, endDate, meta });
const titles = (drafts) => drafts.map((item) => item.title);

describe('channel-calendar.js: window', () => {
	it('takes events from today up to 30 days ahead', () => {
		const drafts = [
			draft('gestern', '2026-09-24'),
			draft('heute', '2026-09-25'),
			draft('in 30 Tagen', '2026-10-25'),
			draft('in 31 Tagen', '2026-10-26'),
			draft('begann gestern, endet heute', '2026-09-24', '2026-09-25'),
			draft('ohne Datum', '')
		];
		expect(titles(calendar.selectDrafts(drafts, TODAY, calendar.WINDOW_DAYS, berlin))).toEqual([
			'heute',
			'in 30 Tagen',
			'begann gestern, endet heute'
		]);
	});

	it('takes a running series once, not an ended or a future one', () => {
		const drafts = [
			draft('läuft', '2026-01-05', '2026-01-05', { rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
			draft('läuft bis nächste Woche', '2026-01-05', '2026-01-05', { rrule: 'FREQ=WEEKLY;UNTIL=20261001T215959Z' }),
			draft('endete letzte Woche', '2026-01-05', '2026-01-05', { rrule: 'FREQ=DAILY;UNTIL=20260918' }),
			draft('beginnt erst im Dezember', '2026-12-01', '2026-12-01', { rrule: 'FREQ=DAILY' }),
			draft('mit COUNT', '2026-01-05', '2026-01-05', { rrule: 'FREQ=DAILY;COUNT=3' })
		];
		expect(titles(calendar.selectDrafts(drafts, TODAY, 30, berlin))).toEqual([
			'läuft',
			'läuft bis nächste Woche',
			'mit COUNT'
		]);
		expect(calendar.untilDate('FREQ=DAILY;UNTIL=20261001T215959Z')).toBe('2026-10-01');
		expect(calendar.untilDate('FREQ=DAILY')).toBe('');
	});
});

describe('channel-calendar.js: changed events', () => {
	const stored = {
		title: 'Zahnarzt',
		body: 'Karte mitnehmen',
		source_url: '',
		source_date: '2026-10-01 08:00:00.000Z',
		meta: { location: 'Praxis', end: '2026-10-01 09:00:00.000Z' }
	};
	const same = {
		title: '  Zahnarzt ',
		body: 'Karte mitnehmen',
		source_url: '',
		source_date: '2026-10-01 08:00:00.000Z',
		meta: { end: '2026-10-01 09:00:00.000Z', location: 'Praxis' }
	};

	it('ignores key order and whitespace the hook removes', () => {
		expect(calendar.hasChanged(stored, same, inboxRules)).toBe(false);
	});

	it('notices a new time, title, text, place or link', () => {
		for (const change of [
			{ source_date: '2026-10-01 09:00:00.000Z' },
			{ title: 'Zahnarzt (verschoben)' },
			{ body: 'Karte und Überweisung' },
			{ meta: { ...same.meta, location: 'Neue Praxis' } },
			{ source_url: 'https://example.com/termin' }
		]) {
			expect(calendar.hasChanged(stored, { ...same, ...change }, inboxRules), JSON.stringify(change)).toBe(true);
		}
	});

	it('writes JSON with sorted keys', () => {
		expect(calendar.stableJson({ b: 1, a: [{ d: 2, c: null }] })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
	});
});
