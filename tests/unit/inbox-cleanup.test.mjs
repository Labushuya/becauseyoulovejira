// Cleaning discarded inbox items after 30 days (OF-E4-6, E4 plan package 24): cutoff in Berlin
// calendar days (ADR-0005) and the values that stay as tombstone (ADR-0014 section 3).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { DISCARDED_CONTENT_NOTE, DISCARDED_RETENTION_DAYS } from '../../web/src/lib/domain/inbox.ts';

const cleanup = loadHookLib('inbox-cleanup.js');
const berlinTime = loadHookLib('berlin-time.js');
const rules = loadHookLib('inbox-rules.js');

const at = (text) => Date.parse(text);

describe('cutoff', () => {
	it('keeps 30 days, in the hook and in the note of the web app', () => {
		expect(cleanup.DISCARDED_RETENTION_DAYS).toBe(30);
		expect(DISCARDED_RETENTION_DAYS).toBe(cleanup.DISCARDED_RETENTION_DAYS);
		expect(DISCARDED_CONTENT_NOTE).toContain(`${cleanup.DISCARDED_RETENTION_DAYS} Tage`);
		expect(cleanup.PURGED_BODY).toContain(`${cleanup.DISCARDED_RETENTION_DAYS} Tage`);
	});

	it('is the start of the Berlin day 30 days before today', () => {
		// Summer time: Berlin midnight is 22:00 UTC of the day before.
		expect(cleanup.cutoff(at('2026-09-25T10:00:00Z'), berlinTime)).toBe('2026-08-25 22:00:00.000Z');
		// Winter time: 23:00 UTC of the day before.
		expect(cleanup.cutoff(at('2027-01-31T12:00:00Z'), berlinTime)).toBe('2026-12-31 23:00:00.000Z');
	});

	it('follows the Berlin date, not the UTC date', () => {
		// 23:30 UTC on 30 September is already 1 October in Berlin.
		expect(cleanup.cutoff(at('2026-09-30T23:30:00Z'), berlinTime)).toBe('2026-08-31 22:00:00.000Z');
		expect(cleanup.cutoff(at('2026-09-30T21:30:00Z'), berlinTime)).toBe('2026-08-30 22:00:00.000Z');
	});

	it('crosses the change of the clocks', () => {
		// 30 days before 20 November (winter) is 21 October (summer time).
		expect(cleanup.cutoff(at('2026-11-20T12:00:00Z'), berlinTime)).toBe('2026-10-20 22:00:00.000Z');
		// 30 days before 15 April (summer) is 16 March (winter time).
		expect(cleanup.cutoff(at('2026-04-15T12:00:00Z'), berlinTime)).toBe('2026-03-15 23:00:00.000Z');
	});

	it('cleans an item discarded on 1 March after 30 full days, from 1 April on', () => {
		const discarded = '2026-03-01 08:00:00.000Z';
		expect(discarded < cleanup.cutoff(at('2026-03-31T21:00:00Z'), berlinTime)).toBe(false);
		expect(discarded < cleanup.cutoff(at('2026-03-31T22:30:00Z'), berlinTime)).toBe(true);
	});
});

describe('purgedValues', () => {
	const mail = {
		title: 'Rechnung Handwerker für die Renovierung im Erdgeschoss und im Keller',
		body: 'Sehr geehrte Frau Beispiel, anbei die Rechnung …',
		meta: { from: 'Bert <bert@example.com>', to: 'anna@example.com', attachments: 2, keyword: 'rechnung' },
		original: 'mail_abc123.eml'
	};

	it('cuts the title, replaces the text, drops the original and the details', () => {
		const values = cleanup.purgedValues(mail, rules);
		expect(values).toEqual({
			title: 'Rechnung Handwerker für die Renovierung…',
			body: cleanup.PURGED_BODY,
			meta: { keyword: 'rechnung' },
			clearOriginal: true
		});
		expect(values.title).toHaveLength(cleanup.PURGED_TITLE_MAX_LENGTH);
	});

	it('keeps the keys needed for display and identity of an event', () => {
		const event = {
			title: 'Zahnarzt',
			body: 'Praxis Dr. Beispiel',
			meta: { location: 'Hauptstraße 1', all_day: true, rrule: 'FREQ=YEARLY', recurrence_id: '20261001', end: 'x' },
			original: ''
		};
		expect(cleanup.purgedValues(event, rules)).toEqual({
			title: 'Zahnarzt',
			body: cleanup.PURGED_BODY,
			meta: { all_day: true, recurrence_id: '20261001' },
			clearOriginal: false
		});
	});

	it('is idempotent: a cleaned item needs nothing more', () => {
		const values = cleanup.purgedValues(mail, rules);
		const cleaned = { title: values.title, body: values.body, meta: values.meta, original: '' };
		expect(cleanup.purgedValues(cleaned, rules)).toBeNull();
		expect(cleanup.purgedValues({ ...cleaned, meta: { ...values.meta, from: 'x' } }, rules)).not.toBeNull();
		expect(cleanup.purgedValues({ ...cleaned, body: 'neu' }, rules)).not.toBeNull();
	});

	it('takes empty or broken source_meta as empty', () => {
		for (const meta of [null, undefined, [], 'text']) {
			expect(cleanup.purgedValues({ title: 'A', body: '', meta, original: '' }, rules)).toEqual({
				title: 'A',
				body: cleanup.PURGED_BODY,
				meta: {},
				clearOriginal: false
			});
		}
	});

	it('never splits a character of the title', () => {
		const title = `${'a'.repeat(38)}😀😀`;
		const cut = cleanup.purgedValues({ title, body: '', meta: {}, original: '' }, rules).title;
		expect(cut).toBe(`${'a'.repeat(38)}…`);
	});
});
