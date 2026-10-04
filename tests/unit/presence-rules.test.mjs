// Pure rules of the presence and attention routes (ADR-0035 section 4; plan start-fenster, SF-1):
// who may ask, reasons, nonces, expiry and the gap between two messages.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('presence-rules.js');

const NOW = 1_790_000_000_000;

describe('requestKind', () => {
	it('treats a request without Origin and Sec-Fetch headers as a script', () => {
		expect(rules.requestKind('', '', '')).toBe('control');
		expect(rules.requestKind(undefined, null, '  ')).toBe('control');
	});

	it('treats Origin "null" as the landing page opened per file://', () => {
		expect(rules.requestKind('null', 'cross-site', 'cors')).toBe('file');
		expect(rules.requestKind(' null ', '', '')).toBe('file');
	});

	it.each([
		['https://example.com', '', ''],
		['http://127.0.0.1:8090', 'same-origin', 'cors'],
		['', 'none', 'navigate'],
		['', '', 'no-cors'],
		['', 'cross-site', ''],
		['NULL', 'cross-site', 'cors']
	])('treats Origin %j with Sec-Fetch-Site %j and Sec-Fetch-Mode %j as a browser', (origin, site, mode) => {
		expect(rules.requestKind(origin, site, mode)).toBe('browser');
	});
});

describe('allows', () => {
	it('opens the presence to scripts only', () => {
		expect(rules.allows('presence', 'control')).toBe(true);
		expect(rules.allows('presence', 'file')).toBe(false);
		expect(rules.allows('presence', 'browser')).toBe(false);
	});

	it('opens the attention to scripts and the landing page', () => {
		expect(rules.allows('attention', 'control')).toBe(true);
		expect(rules.allows('attention', 'file')).toBe(true);
		expect(rules.allows('attention', 'browser')).toBe(false);
	});

	it('knows no other route', () => {
		expect(rules.allows('ack', 'control')).toBe(false);
	});
});

describe('isLoopback', () => {
	it.each(['127.0.0.1', '127.1.2.3', '::1', '0000:0000:0000:0000:0000:0000:0000:0001', '::ffff:127.0.0.1'])(
		'accepts %s',
		(ip) => {
			expect(rules.isLoopback(ip)).toBe(true);
		}
	);

	it.each(['192.168.1.20', '10.0.0.1', '0.0.0.0', '128.0.0.1', '::2', '', null, '127.0.0.1.evil'])(
		'refuses %j',
		(ip) => {
			expect(rules.isLoopback(ip)).toBe(false);
		}
	);
});

describe('reasons and nonces', () => {
	it('accepts exactly the three reasons', () => {
		expect(rules.REASONS).toEqual(['start', 'datei', 'stop']);
		for (const reason of rules.REASONS) expect(rules.isReason(reason)).toBe(true);
		for (const reason of ['', 'Start', 'restart', null, undefined, 1]) {
			expect(rules.isReason(reason), String(reason)).toBe(false);
		}
	});

	it('accepts only 24 letters and digits as nonce', () => {
		expect(rules.NONCE_LENGTH).toBe(24);
		expect(rules.isNonce('Ab3dEf6hIj9kLm2nOp5qRs8t')).toBe(true);
		for (const nonce of [
			'Ab3dEf6hIj9kLm2nOp5qRs8',
			'Ab3dEf6hIj9kLm2nOp5qRs8tu',
			'Ab3dEf6hIj9kLm2nOp5qRs8-',
			'../../api/collections/xx',
			'',
			null
		]) {
			expect(rules.isNonce(nonce), String(nonce)).toBe(false);
		}
	});

	it('uses its own topic and store keys', () => {
		expect(rules.TOPIC).toBe('byl/attention');
		for (const key of [rules.ENTRY_PREFIX, rules.LANDING_KEY, rules.LAST_SENT_KEY]) {
			expect(key.startsWith('byl.')).toBe(true);
		}
	});
});

describe('times', () => {
	it('expires an entry after 60 s and one from the future', () => {
		expect(rules.ENTRY_TTL_MS).toBe(60_000);
		expect(rules.isExpired(NOW - 60_000, NOW)).toBe(false);
		expect(rules.isExpired(NOW - 60_001, NOW)).toBe(true);
		expect(rules.isExpired(NOW + 1, NOW)).toBe(true);
		expect(rules.isExpired(null, NOW)).toBe(true);
		expect(rules.isExpired(Number.NaN, NOW)).toBe(true);
	});

	it('lets one message out per 2 s', () => {
		expect(rules.MIN_GAP_MS).toBe(2000);
		expect(rules.mayNotify(null, NOW)).toBe(true);
		expect(rules.mayNotify(undefined, NOW)).toBe(true);
		expect(rules.mayNotify(NOW - 1999, NOW)).toBe(false);
		expect(rules.mayNotify(NOW - 2000, NOW)).toBe(true);
		// A clock that went back never blocks for long.
		expect(rules.mayNotify(NOW + 5000, NOW)).toBe(true);
	});

	it('reports how long ago the landing page asked, within the TTL only', () => {
		expect(rules.landingAgo(NOW - 1500, NOW)).toBe(1500);
		expect(rules.landingAgo(NOW, NOW)).toBe(0);
		expect(rules.landingAgo(NOW - 60_001, NOW)).toBeNull();
		expect(rules.landingAgo(null, NOW)).toBeNull();
	});
});

describe('entries and messages', () => {
	it('stores and reads an entry as text, with the accounts whose tabs got the message (E7-1)', () => {
		const raw = rules.serializeEntry(NOW, false, ['user0000000001', 'user0000000002', 'user0000000001']);
		expect(typeof raw).toBe('string');
		expect(rules.parseEntry(raw)).toEqual({ createdAt: NOW, acked: false, users: ['user0000000001', 'user0000000002'] });
		expect(rules.parseEntry(rules.serializeEntry(NOW, true))).toEqual({ createdAt: NOW, acked: true, users: [] });
		expect(rules.parseEntry(rules.serializeEntry(NOW, 'yes', 'user0000000001'))).toEqual({
			createdAt: NOW,
			acked: false,
			users: []
		});
		expect(rules.parseEntry(JSON.stringify({ createdAt: NOW, acked: false, users: ['a', 5, '', null, 'b'] })).users).toEqual([
			'a',
			'b'
		]);
	});

	it('lets only an account whose tabs got the message confirm it (E7-1)', () => {
		const entry = rules.parseEntry(rules.serializeEntry(NOW, false, ['user0000000001']));
		expect(rules.mayAck(entry, 'user0000000001')).toBe(true);
		expect(rules.mayAck(entry, 'user0000000002')).toBe(false);
		expect(rules.mayAck(entry, '')).toBe(false);
		expect(rules.mayAck(null, 'user0000000001')).toBe(false);
	});

	it.each([null, undefined, 5, '', 'kein json', '[]', 'null', '{"acked":true}', '{"createdAt":"1"}'])(
		'ignores the entry %j',
		(raw) => {
			expect(rules.parseEntry(raw)).toBeNull();
		}
	);

	it('sends only the nonce and the reason', () => {
		expect(JSON.parse(rules.messageData('Ab3dEf6hIj9kLm2nOp5qRs8t', 'start'))).toEqual({
			nonce: 'Ab3dEf6hIj9kLm2nOp5qRs8t',
			reason: 'start'
		});
	});
});
