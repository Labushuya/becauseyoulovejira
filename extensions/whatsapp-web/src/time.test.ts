// Time and sender from data-pre-plain-text in the languages WhatsApp Web writes (ADR-0038 §3).

import { describe, expect, it } from 'vitest';
import { isoWithOffset, monthFirstFor, parsePrePlain } from './time';

const local = (y: number, m: number, d: number, h: number, min: number) =>
	new Date(y, m - 1, d, h, min).getTime();

describe('parsePrePlain', () => {
	it('reads German time and sender', () => {
		const parsed = parsePrePlain('[14:32, 28.9.2026] Anna Beispiel: ', 'de-DE');
		expect(parsed.sender).toBe('Anna Beispiel');
		expect(parsed.time).toBe(local(2026, 9, 28, 14, 32));
		expect(parsed.sentAt).toBe(isoWithOffset(new Date(local(2026, 9, 28, 14, 32))));
		expect(parsed.sentAt).toMatch(/^2026-09-28T14:32:00[+-]\d{2}:\d{2}$/);
	});

	it('reads English with 12 hours, month first in the United States and day first elsewhere', () => {
		expect(parsePrePlain('[2:32 PM, 9/28/2026] Anna: ', 'en-US').time).toBe(
			local(2026, 9, 28, 14, 32)
		);
		expect(parsePrePlain('[12:05 AM, 1/2/2026] Anna: ', 'en-US').time).toBe(
			local(2026, 1, 2, 0, 5)
		);
		expect(parsePrePlain('[14:32, 1/2/2026] Anna: ', 'en-GB').time).toBe(local(2026, 2, 1, 14, 32));
		// A day over 12 decides for itself.
		expect(parsePrePlain('[14:32, 28/09/2026] Anna: ', 'en-US').time).toBe(
			local(2026, 9, 28, 14, 32)
		);
		expect(parsePrePlain('[14:32, 2026-09-28] Anna: ', 'sv-SE').time).toBe(
			local(2026, 9, 28, 14, 32)
		);
		expect(parsePrePlain('[28.09.26, 14:32:05] Anna: ', 'de-DE').time).toBe(
			new Date(2026, 8, 28, 14, 32, 5).getTime()
		);
		expect(monthFirstFor('en-US')).toBe(true);
		expect(monthFirstFor('de-DE')).toBe(false);
	});

	it('keeps a colon in the name of the sender', () => {
		expect(parsePrePlain('[14:32, 28.9.2026] Verein: Vorstand: ', 'de-DE').sender).toBe(
			'Verein: Vorstand'
		);
	});

	it('gives no time for what it cannot read, but keeps the sender', () => {
		for (const value of [
			'[gestern, 28.9.2026] Anna: ',
			'[14:32, 31.2.2026] Anna: ',
			'[25:10, 28.9.2026] Anna: ',
			'[13:10 PM, 9/28/2026] Anna: ',
			'[14:32 28.9.2026] Anna: '
		]) {
			expect(parsePrePlain(value, 'de-DE'), value).toEqual({
				sender: 'Anna',
				time: null,
				sentAt: null
			});
		}
		expect(parsePrePlain('Anna: Hallo', 'de-DE')).toEqual({ sender: '', time: null, sentAt: null });
		expect(parsePrePlain(null, 'de-DE')).toEqual({ sender: '', time: null, sentAt: null });
	});
});
