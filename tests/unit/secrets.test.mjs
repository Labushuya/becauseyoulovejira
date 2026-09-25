// Access data of the channels (ADR-0018, E4 plan package 10): variable names, reading and the
// cleaning of error texts. All values are invented.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const secrets = loadHookLib('secrets.js');

const TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijklmn';
const ICAL = 'https://calendar.google.com/calendar/ical/beispiel%40example.com/private-0123456789abcdef/basic.ics';

describe('secrets.js: names', () => {
	it.each(['BYL_X', 'BYL_GOOGLE_CALENDAR_URL', 'BYL_TELEGRAM_TOKEN', `BYL_${'A'.repeat(60)}`])(
		'accepts %s',
		(name) => {
			expect(secrets.isValidName(name)).toBe(true);
		}
	);

	it.each(['PATH', 'byl_x', 'BYL_', 'BYL_a', 'BYL-X', ' BYL_X', 'BYL_X ', `BYL_${'A'.repeat(61)}`, '', null, 7])(
		'refuses %s',
		(name) => {
			expect(secrets.isValidName(name)).toBe(false);
		}
	);
});

describe('secrets.js: read', () => {
	const env = { BYL_TOKEN: `  ${TOKEN}\r\n`, PATH: 'C:\\Windows' };
	const getenv = (name) => env[name] ?? '';

	it('reads and trims a valid variable, never another one', () => {
		expect(secrets.read('BYL_TOKEN', getenv)).toBe(TOKEN);
		expect(secrets.read('BYL_MISSING', getenv)).toBe('');
		expect(secrets.read('PATH', getenv)).toBe('');
	});
});

describe('secrets.js: redact', () => {
	it('cuts the secret iCal address of a Go error to scheme and host', () => {
		const error = `GoError: Get "${ICAL}": context deadline exceeded`;
		const cleaned = secrets.redact(error, [ICAL]);
		expect(cleaned).toBe('GoError: Get "***": context deadline exceeded');
		expect(secrets.redact(error, [])).toBe(
			'GoError: Get "https://calendar.google.com": context deadline exceeded'
		);
	});

	it('removes a bot token from URLs and from plain text', () => {
		const error = `Post "https://api.telegram.org/bot${TOKEN}/getUpdates": dial tcp: lookup api.telegram.org: no such host`;
		const cleaned = secrets.redact(error, []);
		expect(cleaned).toBe(
			'Post "https://api.telegram.org": dial tcp: lookup api.telegram.org: no such host'
		);
		expect(secrets.redact(`Token ${TOKEN} abgelehnt`, [])).toBe('Token *** abgelehnt');
	});

	it('replaces every listed value, also URL-encoded, but not very short ones', () => {
		const password = 'geheim&passwort';
		expect(secrets.redact(`login failed for ${password} (${encodeURIComponent(password)})`, [password])).toBe(
			'login failed for *** (***)'
		);
		expect(secrets.redact('abc', ['ab'])).toBe('abc');
	});

	it('keeps host and port of local addresses and drops user info', () => {
		expect(secrets.redact('Get "http://user:pass@127.0.0.1:52431/secret/path?x=1#y": EOF', [])).toBe(
			'Get "http://127.0.0.1:52431": EOF'
		);
	});

	it('cuts long texts to 1 000 characters', () => {
		const cleaned = secrets.redact('x'.repeat(5000), []);
		expect(cleaned).toHaveLength(1000);
		expect(cleaned.endsWith('…')).toBe(true);
		expect(secrets.redact(undefined, [])).toBe('');
	});
});
