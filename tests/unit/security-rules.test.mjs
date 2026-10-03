// Pure rules of the security hardening (ADR-0055, plan docs/plan/sicherheit.md, SH-1): the levels
// of the rate limiter, the hosts of the origins of the start, the further hosts of byl-config.json,
// the headers of every answer and the two CORS exceptions; plus the migration with a fake app, its
// rules equal to those of the rules module.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('security-rules.js');
const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MIGRATION = join(ROOT_DIR, 'app', 'pb_migrations', '1790203500_security_hardening.js');
const EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

/** The two functions of the migration, run against a fake app whose settings are plain data. */
function loadMigration() {
	const steps = {};
	runInNewContext(readFileSync(MIGRATION, 'utf8'), {
		migrate: (up, down) => Object.assign(steps, { up, down }),
		// JSON semantics of PocketBase's unmarshal: objects merge, arrays and values replace.
		unmarshal: (data, target) => {
			const merge = (into, from) => {
				for (const [key, value] of Object.entries(JSON.parse(JSON.stringify(from)))) {
					if (value !== null && typeof value === 'object' && !Array.isArray(value) && into[key] && typeof into[key] === 'object') {
						merge(into[key], value);
					} else {
						into[key] = value;
					}
				}
			};
			merge(target, data);
		}
	});
	const run = (step, settings) => {
		let saved = 0;
		steps[step]({ settings: () => settings, save: () => (saved += 1) });
		return saved;
	};
	return { run };
}

function pocketBaseSettings() {
	return {
		superuserIPs: null,
		rateLimits: { enabled: false, excludedIPs: [], rules: structuredClone(rules.POCKETBASE_DEFAULT_RULES) }
	};
}

describe('levels of the rate limiter', () => {
	it('limit every sign-in and the guessable mail flows per collection, guests on the API and nothing of an account', () => {
		const normal = rules.rateLimitRules('normal');
		expect(normal.map((rule) => [rule.label, rule.audience])).toEqual([
			['*:auth', ''],
			['*:requestOTP', ''],
			['*:requestPasswordReset', ''],
			['*:confirmPasswordReset', ''],
			['/api/byl/ingest/', '@guest'],
			['/api/', '@guest']
		]);
		expect(normal[0]).toEqual({ label: '*:auth', audience: '', duration: 60, maxRequests: 10 });
		expect(normal.at(-1)).toEqual({ label: '/api/', audience: '@guest', duration: 10, maxRequests: 300 });
		const strict = rules.rateLimitRules('strict');
		expect(strict[0]).toEqual({ label: '*:auth', audience: '', duration: 300, maxRequests: 5 });
		expect(strict.at(-1)).toEqual({ label: '/api/', audience: '@guest', duration: 10, maxRequests: 100 });
		// The ingest routes of the mail helper keep their high limit at both levels, before /api/.
		for (const level of rules.LEVELS) {
			const list = rules.rateLimitRules(level);
			expect(list.find((rule) => rule.label === '/api/byl/ingest/')).toEqual(rules.INGEST_RULE);
			expect(list.findIndex((rule) => rule.label === '/api/byl/ingest/')).toBeLessThan(list.findIndex((rule) => rule.label === '/api/'));
		}
		// Unknown levels mean "normal".
		expect(rules.rateLimitRules('egal')).toEqual(normal);
	});

	it('names the level of the settings, also for rules of the admin UI and a switched-off limiter', () => {
		expect(rules.levelOf(true, rules.rateLimitRules('normal'))).toBe('normal');
		expect(rules.levelOf(true, rules.rateLimitRules('strict'))).toBe('strict');
		expect(rules.levelOf(false, rules.rateLimitRules('normal'))).toBe('off');
		expect(rules.levelOf(true, rules.POCKETBASE_DEFAULT_RULES)).toBe('custom');
		const changed = rules.rateLimitRules('normal');
		changed[0] = { ...changed[0], maxRequests: 11 };
		expect(rules.levelOf(true, changed)).toBe('custom');
		expect(rules.levelOf(true, rules.rateLimitRules('normal').reverse())).toBe('custom');
		expect(rules.levelOf(true, null)).toBe('custom');
		// Values of Go come as numbers or strings; an empty audience may be missing.
		const loose = rules.rateLimitRules('normal').map((rule) => ({ ...rule, duration: String(rule.duration), audience: rule.audience || undefined }));
		expect(rules.levelOf(true, loose)).toBe('normal');
	});
});

describe('the migration', () => {
	it('switches the limiter on with "Normal" and the superusers to this machine, only from the defaults of PocketBase', () => {
		const { run } = loadMigration();
		const settings = pocketBaseSettings();
		expect(run('up', settings)).toBe(1);
		expect(settings.rateLimits).toEqual({ enabled: true, excludedIPs: [], rules: rules.rateLimitRules('normal') });
		expect(settings.superuserIPs).toEqual(rules.SUPERUSER_IPS);
		expect(rules.levelOf(settings.rateLimits.enabled, settings.rateLimits.rules)).toBe('normal');

		expect(run('down', settings)).toBe(1);
		expect(settings).toEqual({ ...pocketBaseSettings(), superuserIPs: [] });
	});

	it('keeps rules and addresses of the admin UI, up and down, and takes "Streng" back as well', () => {
		const { run } = loadMigration();
		const own = pocketBaseSettings();
		own.rateLimits.enabled = true;
		own.superuserIPs = ['10.0.0.0/24'];
		const before = structuredClone(own);
		expect(run('up', own)).toBe(0);
		expect(run('down', own)).toBe(0);
		expect(own).toEqual(before);

		const strict = pocketBaseSettings();
		strict.rateLimits = { enabled: true, excludedIPs: [], rules: rules.rateLimitRules('strict') };
		strict.superuserIPs = [...rules.SUPERUSER_IPS];
		expect(run('down', strict)).toBe(1);
		expect(strict.rateLimits).toEqual(pocketBaseSettings().rateLimits);
		expect(strict.superuserIPs).toEqual([]);
	});
});

describe('hosts', () => {
	it('takes the hosts of the http(s) origins of the start, as a browser names them', () => {
		expect(
			rules.originHosts('http://127.0.0.1:8095,http://localhost:8095, https://Rechner.Tailnet.ts.net ,https://pi.example.org:8443')
		).toEqual(['127.0.0.1:8095', 'localhost:8095', 'rechner.tailnet.ts.net', 'pi.example.org:8443']);
		expect(rules.originHosts('https://a.example.org:443,http://b.example.org:80')).toEqual(['a.example.org', 'b.example.org']);
		for (const flag of ['', '*', 'https://*.example.org', EXTENSION, 'null', 'https://a.example.org/pfad', 'ftp://a.example.org']) {
			expect(rules.originHosts(flag), flag).toEqual([]);
		}
		expect(rules.originHosts(undefined)).toEqual([]);
	});

	it('compares the Host header exactly, without case', () => {
		const hosts = ['rechner.tailnet.ts.net'];
		expect(rules.isListedHost('Rechner.Tailnet.TS.net', hosts)).toBe(true);
		for (const host of ['rechner.tailnet.ts.net:8443', 'evil.rechner.tailnet.ts.net', 'rechner.tailnet.ts.net.', '', undefined]) {
			expect(rules.isListedHost(host, hosts), String(host)).toBe(false);
		}
	});

	it('accepts DNS names with a dot and an optional port as further hosts, nothing else', () => {
		expect(rules.normalizeExtraHost(' Rechner.Tailnet.ts.net ')).toBe('rechner.tailnet.ts.net');
		expect(rules.normalizeExtraHost('pi.local:8443')).toBe('pi.local:8443');
		expect(rules.normalizeExtraHost('a-b.c1.example')).toBe('a-b.c1.example');
		for (const value of [
			'',
			'localhost',
			'127.0.0.1',
			'100.64.0.1',
			'[::1]',
			'https://rechner.ts.net',
			'rechner.ts.net/pfad',
			'*.ts.net',
			'-a.example.org',
			'a-.example.org',
			'a..example.org',
			'rechner.ts.net:0',
			'rechner.ts.net:65536',
			'rechner.ts.net:',
			'räch.ts.net',
			`${'a'.repeat(64)}.example.org`,
			`${'abc.'.repeat(63)}org`,
			'rechner.ts.net:١٢٣',
			null
		]) {
			expect(rules.normalizeExtraHost(value), String(value)).toBe('');
		}
		expect(rules.EXTRA_HOSTS_MAX).toBe(10);
	});
});

describe('headers', () => {
	it('sets the referrer within the app, no devices and no frames; the admin UI keeps its own CSP', () => {
		expect(rules.securityHeaders('/')).toEqual({
			'Referrer-Policy': 'same-origin',
			'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
			'Content-Security-Policy': "frame-ancestors 'none'"
		});
		expect(rules.securityHeaders('/api/byl/system')).toHaveProperty('Content-Security-Policy');
		for (const path of ['/_', '/_/', '/_/#/login']) {
			expect(rules.securityHeaders(path), path).not.toHaveProperty('Content-Security-Policy');
			expect(rules.securityHeaders(path)['Referrer-Policy'], path).toBe('same-origin');
		}
		expect(rules.isAdminPath('/_app/immutable/x.js')).toBe(false);
	});
});

describe('CORS exceptions', () => {
	it('answer the browser extension on the inbox route only, the preflight included', () => {
		expect(rules.corsException('OPTIONS', '/api/byl/inbox/ingest', EXTENSION, true)).toEqual({
			origin: EXTENSION,
			preflight: { methods: 'GET, POST', headers: 'Authorization, Content-Type', maxAge: '600' }
		});
		expect(rules.corsException('POST', '/api/byl/inbox/ingest', EXTENSION, true)).toEqual({ origin: EXTENSION, preflight: null });
		expect(rules.corsException('get', '/api/byl/inbox/ingest', EXTENSION, true)).toEqual({ origin: EXTENSION, preflight: null });
		expect(rules.corsException('DELETE', '/api/byl/inbox/ingest', EXTENSION, true)).toBeNull();
		expect(rules.corsException('POST', '/api/byl/inbox/ingest', 'https://web.whatsapp.com', false)).toBeNull();
		expect(rules.corsException('POST', '/api/byl/inbox/keys', EXTENSION, true)).toBeNull();
		expect(rules.corsException('OPTIONS', '/api/collections/users/records', EXTENSION, true)).toBeNull();
	});

	it('answer the landing page per file:// on the attention routes only, never its acknowledgement', () => {
		const nonce = 'A'.repeat(24);
		expect(rules.corsException('POST', '/api/byl/attention', 'null', false)).toEqual({ origin: 'null', preflight: null });
		expect(rules.corsException('GET', `/api/byl/attention/${nonce}`, 'null', false)).toEqual({ origin: 'null', preflight: null });
		for (const [method, path, origin] of [
			['POST', `/api/byl/attention/${nonce}/ack`, 'null'],
			['OPTIONS', '/api/byl/attention', 'null'],
			['GET', '/api/byl/presence', 'null'],
			['GET', '/api/health', 'null'],
			['POST', '/api/byl/attention', 'https://example.com'],
			['POST', '/api/byl/attention', '']
		]) {
			expect(rules.corsException(method, path, origin, false), `${method} ${path} ${origin}`).toBeNull();
		}
	});
});

describe('log values', () => {
	it('cuts long values and masks control characters', () => {
		expect(rules.logText('a\r\nb')).toBe('a??b');
		expect(rules.logText('x'.repeat(250))).toBe(`${'x'.repeat(200)}…`);
		expect(rules.logText(undefined)).toBe('');
	});
});
