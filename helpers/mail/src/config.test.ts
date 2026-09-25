// Command line and configuration of the mail helper (E4 plan, package 11).

import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_URL, POLL_INTERVAL_MS, loopbackUrl, parseCommand, readConfig, readSecret } from './config';

describe('command line', () => {
	it('knows version, self-test, help and run', () => {
		expect(parseCommand(['--version'])).toEqual({ kind: 'version' });
		expect(parseCommand(['--self-test'])).toEqual({ kind: 'self-test' });
		expect(parseCommand([])).toEqual({ kind: 'help' });
		expect(parseCommand(['run'])).toEqual({ kind: 'run', appUrl: DEFAULT_APP_URL });
		expect(parseCommand(['run', '--url=http://127.0.0.1:53211/'])).toEqual({
			kind: 'run',
			appUrl: 'http://127.0.0.1:53211'
		});
	});

	it.each([
		['serve'],
		['run', '--dir=x'],
		['run', '--url=https://127.0.0.1:8090'],
		['run', '--url=http://localhost:8090'],
		['run', '--url=http://127.0.0.1:8090/api'],
		['run', '--url=http://user:pw@127.0.0.1:8090'],
		['run', '--url=http://example.com']
	])('refuses %j', (...args) => {
		expect(parseCommand(args)).toEqual({ error: expect.any(String) });
	});

	it('accepts only plain http addresses on 127.0.0.1', () => {
		expect(loopbackUrl('http://127.0.0.1:8090')).toBe('http://127.0.0.1:8090');
		expect(loopbackUrl('http://127.0.0.1')).toBe('http://127.0.0.1:80');
		expect(loopbackUrl('kein url')).toBeNull();
	});
});

describe('configuration', () => {
	const env = { BYL_INGEST_TOKEN: ' tok+/en= ' };

	it('needs the ingest token and polls every five minutes', () => {
		expect(readConfig(DEFAULT_APP_URL, {})).toEqual({ error: expect.stringContaining('BYL_INGEST_TOKEN') });
		expect(readConfig(DEFAULT_APP_URL, env)).toEqual({
			appUrl: DEFAULT_APP_URL,
			token: 'tok+/en=',
			intervalMs: POLL_INTERVAL_MS,
			imapOverride: null
		});
	});

	it('takes the test settings for interval and IMAP server on 127.0.0.1 only', () => {
		expect(
			readConfig(DEFAULT_APP_URL, { ...env, BYL_MAIL_INTERVAL_SECONDS: '2', BYL_MAIL_TEST_IMAP_PORT: '1143' })
		).toMatchObject({ intervalMs: 2000, imapOverride: { host: '127.0.0.1', port: 1143, secure: false } });
		for (const value of ['0', '3601', '1.5', 'x']) {
			expect(readConfig(DEFAULT_APP_URL, { ...env, BYL_MAIL_INTERVAL_SECONDS: value })).toEqual({
				error: expect.any(String)
			});
		}
		expect(readConfig(DEFAULT_APP_URL, { ...env, BYL_MAIL_TEST_IMAP_PORT: '70000' })).toEqual({
			error: expect.any(String)
		});
	});

	it('reads only variables with a valid name', () => {
		expect(readSecret('BYL_WEBDE_PASSWORD', { BYL_WEBDE_PASSWORD: ' pw \n' })).toBe('pw');
		expect(readSecret('PATH', { PATH: 'C:\\Windows' })).toBe('');
		expect(readSecret('byl_x', { byl_x: 'x' })).toBe('');
		expect(readSecret('BYL_MISSING', {})).toBe('');
	});
});
