// Duplicate key of inbox items per family (ADR-0014 section 3), with node:crypto as hash.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const fp = loadHookLib('inbox-fingerprint.js');

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const keyOf = (item, newId = 'rnd') => fp.fingerprintKey(item, newId).key;

describe('mail (eml, mail)', () => {
	it('ignores angle brackets, surrounding space and case of the Message-ID', () => {
		const keys = [
			keyOf({ channel: 'eml', source_ref: '<AbC.123@Mail.Example>' }),
			keyOf({ channel: 'mail', source_ref: 'abc.123@mail.example' }),
			keyOf({ channel: 'eml', source_ref: '  <abc.123@MAIL.example>  ' })
		];
		expect(new Set(keys).size).toBe(1);
		expect(keys[0]).toBe('mail|abc.123@mail.example');
	});

	it('uses sender, date and subject without a Message-ID', () => {
		const item = {
			channel: 'eml',
			source_ref: '',
			title: 'Rechnung  September',
			source_date: '2026-09-25 08:00:00.000Z',
			meta: { from: 'Shop@Example.com ' }
		};
		expect(keyOf(item)).toBe('mailx|shop@example.com|2026-09-25 08:00:00.000Z|Rechnung September');
		expect(keyOf({ ...item, channel: 'mail' })).toBe(keyOf(item));
		expect(keyOf({ ...item, title: 'Rechnung Oktober' })).not.toBe(keyOf(item));
	});
});

describe('events (ics, calendar)', () => {
	it('gives the same key for file and feed', () => {
		expect(keyOf({ channel: 'ics', source_ref: 'uid-1@example' })).toBe(
			keyOf({ channel: 'calendar', source_ref: 'uid-1@example' })
		);
		expect(keyOf({ channel: 'ics', source_ref: 'uid-1@example' })).toBe('event|uid-1@example|');
	});

	it('keeps single occurrences (RECURRENCE-ID) apart from the series', () => {
		const series = keyOf({ channel: 'ics', source_ref: 'uid-1' });
		const occurrence = keyOf({
			channel: 'calendar',
			source_ref: 'uid-1',
			meta: { recurrence_id: '20261001T080000Z' }
		});
		expect(occurrence).toBe('event|uid-1|20261001T080000Z');
		expect(occurrence).not.toBe(series);
	});

	it('falls back to title and date without a UID', () => {
		expect(
			keyOf({
				channel: 'ics',
				source_ref: '',
				title: 'Zahnarzt',
				source_date: '2026-10-01 08:00:00.000Z'
			})
		).toBe('eventx|Zahnarzt|2026-10-01 08:00:00.000Z');
	});
});

describe('links', () => {
	it('lower-cases scheme and host, drops fragment, default port and utm_* parameters', () => {
		const base = keyOf({ channel: 'link', source_url: 'https://example.com/Pfad?a=1&b=2' });
		expect(base).toBe('link|https://example.com/Pfad?a=1&b=2');
		for (const url of [
			'HTTPS://Example.COM/Pfad?a=1&b=2',
			'https://example.com/Pfad?a=1&b=2#abschnitt',
			'https://example.com:443/Pfad?utm_source=x&a=1&UTM_Medium=y&b=2',
			' https://example.com/Pfad?a=1&b=2&utm_campaign=z '
		]) {
			expect(keyOf({ channel: 'link', source_url: url }), url).toBe(base);
		}
		// The path keeps its case; other parameters and their order count.
		expect(keyOf({ channel: 'link', source_url: 'https://example.com/pfad?a=1&b=2' })).not.toBe(base);
		expect(keyOf({ channel: 'link', source_url: 'https://example.com/Pfad?b=2&a=1' })).not.toBe(base);
	});

	it('normalises the empty path and removes an empty query', () => {
		expect(fp.normalizeUrl('https://Example.com')).toBe('https://example.com/');
		expect(fp.normalizeUrl('http://example.com:80?utm_source=x#top')).toBe('http://example.com/');
		expect(fp.normalizeUrl('http://example.com:8080/x')).toBe('http://example.com:8080/x');
		expect(fp.normalizeUrl('https://User@Example.com/x')).toBe('https://User@example.com/x');
	});

	it('needs a URL', () => {
		expect(fp.fingerprintKey({ channel: 'link', source_url: ' ' }, 'x')).toEqual({
			key: '',
			missing: 'source_url'
		});
	});
});

describe('chats and notion', () => {
	it('takes chat and message ID of Telegram', () => {
		expect(keyOf({ channel: 'telegram', source_ref: '-100123:42' })).toBe('telegram|-100123|42');
		expect(fp.fingerprintKey({ channel: 'telegram', source_ref: '42' }, 'x').missing).toBe(
			'source_ref'
		);
		expect(fp.fingerprintKey({ channel: 'telegram', source_ref: '-100:' }, 'x').missing).toBe(
			'source_ref'
		);
	});

	it('builds the WhatsApp key from chat, time, sender and normalised text', () => {
		const item = {
			channel: 'whatsapp',
			source_date: '2026-09-25 18:30:00.000Z',
			body: '  Brot\n mitbringen ',
			meta: { chat: 'Familie', sender: 'Anna' }
		};
		expect(keyOf(item)).toBe('whatsapp|Familie|2026-09-25 18:30:00.000Z|Anna|Brot mitbringen');
		expect(keyOf({ ...item, meta: { chat: 'Familie', sender: 'Ben' } })).not.toBe(keyOf(item));
	});

	it('takes the page ID of Notion', () => {
		expect(keyOf({ channel: 'notion', source_ref: 'page-1' })).toBe('notion|page-1');
		expect(fp.fingerprintKey({ channel: 'notion' }, 'x').missing).toBe('source_ref');
	});
});

describe('manual channels', () => {
	it('never collide: each item gets a new random ID', () => {
		for (const channel of ['manual', 'quick', 'clipboard']) {
			expect(keyOf({ channel, title: 'Milch kaufen' }, 'id-1')).toBe('manual|id-1');
			expect(keyOf({ channel, title: 'Milch kaufen' }, 'id-2')).toBe('manual|id-2');
		}
	});
});

describe('own inbox (api, whatsapp-web; ADR-0038)', () => {
	it('uses the channel and external_id, nothing else', () => {
		const item = { channel: 'api', source_ref: 'x-1', title: 'Milch', body: 'a', source_date: '2026-09-25 08:00:00.000Z' };
		expect(keyOf(item)).toBe('api|x-1');
		expect(keyOf({ ...item, title: 'Brot', body: 'b', source_date: '' })).toBe('api|x-1');
		expect(keyOf({ ...item, channel: 'whatsapp-web' })).toBe('whatsapp-web|x-1');
		expect(keyOf({ ...item, source_ref: ' x-1 ' })).toBe('api|x-1');
	});

	it('needs external_id', () => {
		expect(fp.fingerprintKey({ channel: 'api', source_ref: ' ' }, 'r')).toEqual({ key: '', missing: 'source_ref' });
		expect(fp.fingerprintKey({ channel: 'whatsapp-web' }, 'r')).toEqual({ key: '', missing: 'source_ref' });
	});
});

describe('escaping and hashing', () => {
	it('keeps part lists with "|" apart', () => {
		const a = keyOf({ channel: 'ics', source_ref: 'a|b', meta: { recurrence_id: 'c' } });
		const b = keyOf({ channel: 'ics', source_ref: 'a', meta: { recurrence_id: 'b|c' } });
		expect(a).not.toBe(b);
	});

	it('hashes the key with the given function', () => {
		const item = { channel: 'eml', source_ref: '<x@y>' };
		expect(fp.fingerprint(item, sha256, 'r')).toEqual({ fingerprint: sha256('mail|x@y') });
		expect(fp.fingerprint({ channel: 'link' }, sha256, 'r')).toEqual({
			fingerprint: '',
			missing: 'source_url'
		});
	});

	it('rejects unknown channels', () => {
		expect(() => fp.fingerprintKey({ channel: 'fax' }, 'x')).toThrow(/unknown channel/);
	});
});

describe('copy of a source for a duplicate ticket (ADR-0045)', () => {
	const original = sha256('mail|x@y');

	it('derives a key of its own from the original entry and a new ID', () => {
		expect(fp.copyFingerprintKey(original, 'r1')).toBe(`copy|${original}|r1`);
		expect(fp.copyFingerprintKey(original, 'r2')).not.toBe(fp.copyFingerprintKey(original, 'r1'));
	});

	it('never meets the key of a channel, so it neither blocks nor answers an import', () => {
		const copy = fp.copyFingerprintKey(original, 'r1');
		for (const item of [
			{ channel: 'eml', source_ref: '<x@y>' },
			{ channel: 'mail', source_ref: 'x@y' },
			{ channel: 'manual' },
			{ channel: 'link', source_url: 'https://example.com/' }
		]) {
			expect(keyOf(item, 'r1')).not.toBe(copy);
		}
		expect(fp.copyFingerprintKey('a|b', 'c')).not.toBe(fp.copyFingerprintKey('a', 'b|c'));
	});
});
