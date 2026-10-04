// Pure rules of the security hardening (ADR-0055, plan docs/plan/sicherheit.md, SH-1): the levels
// of the rate limiter, the hosts of the origins of the start, the further hosts of byl-config.json,
// the headers of every answer and the two CORS exceptions; plus the migration with a fake app, its
// rules equal to those of the rules module together with the rule of joining a household
// (1790203810, ADR-0058 §3).

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('security-rules.js');
const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MIGRATION = join(ROOT_DIR, 'app', 'pb_migrations', '1790203500_security_hardening.js');
// The rule of joining a household (ADR-0058 §3, E7-2), added to both levels by its own migration.
const JOIN_MIGRATION = join(ROOT_DIR, 'app', 'pb_migrations', '1790203810_household_join_limit.js');
const EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

/** The rules of a level as they were before the rule of joining a household (1790203500). */
const withoutJoin = (level) => rules.rateLimitRules(level).filter((rule) => rule.label !== rules.JOIN_RULE.label);

/** The two functions of a migration, run against a fake app whose settings are plain data. */
function loadMigration(file = MIGRATION) {
	const steps = {};
	runInNewContext(readFileSync(file, 'utf8'), {
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
			['POST /api/byl/household/join', ''],
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
			// Joining a household: the strict values of a sign-in at both levels, for every account.
			expect(list.find((rule) => rule.label === rules.JOIN_RULE.label)).toEqual({
				label: 'POST /api/byl/household/join',
				audience: '',
				duration: rules.PRESETS.strict.auth.duration,
				maxRequests: rules.PRESETS.strict.auth.maxRequests
			});
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
		const join = loadMigration(JOIN_MIGRATION);
		const settings = pocketBaseSettings();
		expect(run('up', settings)).toBe(1);
		expect(settings.rateLimits).toEqual({ enabled: true, excludedIPs: [], rules: withoutJoin('normal') });
		expect(settings.superuserIPs).toEqual(rules.SUPERUSER_IPS);
		// With the rule of joining a household (1790203810) the settings are the level "Normal".
		expect(join.run('up', settings)).toBe(1);
		expect(settings.rateLimits).toEqual({ enabled: true, excludedIPs: [], rules: rules.rateLimitRules('normal') });
		expect(rules.levelOf(settings.rateLimits.enabled, settings.rateLimits.rules)).toBe('normal');

		expect(join.run('down', settings)).toBe(1);
		expect(settings.rateLimits.rules).toEqual(withoutJoin('normal'));
		expect(run('down', settings)).toBe(1);
		expect(settings).toEqual({ ...pocketBaseSettings(), superuserIPs: [] });
	});

	it('adds the rule of joining a household to "Normal" and "Streng" only, and takes it back', () => {
		const join = loadMigration(JOIN_MIGRATION);
		for (const level of rules.LEVELS) {
			const settings = pocketBaseSettings();
			settings.rateLimits = { enabled: true, excludedIPs: [], rules: withoutJoin(level) };
			expect(join.run('up', settings)).toBe(1);
			expect(settings.rateLimits).toEqual({ enabled: true, excludedIPs: [], rules: rules.rateLimitRules(level) });
			expect(join.run('up', settings)).toBe(0);
			expect(join.run('down', settings)).toBe(1);
			expect(settings.rateLimits.rules).toEqual(withoutJoin(level));
		}
		// Rules of the admin UI and the defaults of PocketBase stay as they are.
		for (const own of [pocketBaseSettings(), { ...pocketBaseSettings(), rateLimits: { enabled: true, excludedIPs: [], rules: [{ label: '*:auth', audience: '', duration: 30, maxRequests: 3 }] } }]) {
			const before = structuredClone(own);
			expect(join.run('up', own)).toBe(0);
			expect(join.run('down', own)).toBe(0);
			expect(own).toEqual(before);
		}
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
		strict.rateLimits = { enabled: true, excludedIPs: [], rules: withoutJoin('strict') };
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

describe('settings of the page "Sicherheit" (SH-2)', () => {
	it('offers four durations of a sign-in and knows them back from seconds', () => {
		expect(rules.SESSION_DAYS).toEqual([1, 5, 14, 30]);
		expect(rules.SESSION_DEFAULT_DAYS).toBe(5);
		expect(rules.sessionDaysOf(432000)).toBe(5);
		expect(rules.sessionDaysOf('86400')).toBe(1);
		for (const seconds of [0, 3600, 432001, 7 * 86400, null]) expect(rules.sessionDaysOf(seconds), String(seconds)).toBeNull();
	});

	it('takes a level and a duration, at least one, and nothing else', () => {
		expect(rules.settingsInput({ level: 'strict' })).toEqual({ level: 'strict' });
		expect(rules.settingsInput({ days: 14 })).toEqual({ days: 14 });
		expect(rules.settingsInput({ level: 'normal', days: 1, other: true })).toEqual({ level: 'normal', days: 1 });
		expect(rules.settingsInput({})).toEqual({ problem: 'empty' });
		expect(rules.settingsInput(null)).toEqual({ problem: 'empty' });
		expect(rules.settingsInput([])).toEqual({ problem: 'empty' });
		for (const level of ['custom', 'off', 'STRICT', 1]) expect(rules.settingsInput({ level })).toEqual({ problem: 'level' });
		for (const days of [7, '5', 0, 1.5]) expect(rules.settingsInput({ days })).toEqual({ problem: 'days' });
	});

	it('takes further hosts only when every entry is valid, at most ten; an empty list removes them', () => {
		expect(rules.hostsInput({ hosts: [' Rechner.Tailnet.ts.net', 'rechner.tailnet.ts.net', 'pi.local:8443'] })).toEqual({
			hosts: ['rechner.tailnet.ts.net', 'pi.local:8443']
		});
		expect(rules.hostsInput({ hosts: [] })).toEqual({ hosts: [] });
		expect(rules.hostsInput({ hosts: ['ok.example.org', 'localhost', 42] })).toEqual({ problem: 'invalid', invalid: ['localhost', '42'] });
		expect(rules.hostsInput({ hosts: Array.from({ length: 11 }, (_, i) => `h${i}.example.org`) })).toEqual({ problem: 'too-many', invalid: [] });
		expect(rules.hostsInput({ hosts: 'rechner.tailnet.ts.net' })).toEqual({ problem: 'format', invalid: [] });
		expect(rules.hostsInput(null)).toEqual({ problem: 'format', invalid: [] });
	});

	it('reads the further hosts of byl-config.json like the control script', () => {
		expect(rules.configuredHosts(JSON.stringify({ port: 8091, security: { hosts: ['Rechner.tailnet.ts.net', 'localhost', 'rechner.tailnet.ts.net'] } }))).toEqual([
			'rechner.tailnet.ts.net'
		]);
		expect(rules.configuredHosts(JSON.stringify({ security: { hosts: 'pi.local' } }))).toEqual(['pi.local']);
		for (const text of ['', '{', '[]', '{"security":"x"}', '{"port":8090}']) expect(rules.configuredHosts(text), text).toEqual([]);
		expect(rules.configuredHosts(JSON.stringify({ security: { hosts: Array.from({ length: 12 }, (_, i) => `h${i}.example.org`) } }))).toHaveLength(10);
	});

	it('names the further hosts of the start without the own ones, and whether CORS is restricted', () => {
		const origins = 'http://127.0.0.1:8095,http://localhost:8095,https://rechner.tailnet.ts.net';
		expect(rules.ownHosts(8095)).toEqual(['127.0.0.1:8095', 'localhost:8095']);
		expect(rules.activeExtraHosts(origins, 8095)).toEqual(['rechner.tailnet.ts.net']);
		expect(rules.activeExtraHosts('', 8095)).toEqual([]);
		expect(rules.corsRestricted(origins)).toBe(true);
		for (const flag of ['', '*', 'https://a.example.org,*']) expect(rules.corsRestricted(flag), flag).toBe(false);
	});

	it('knows when the admin UI takes this machine only', () => {
		for (const ips of [['127.0.0.1', '::1'], ['127.0.0.0/8'], ['::1/128'], ['127.0.0.1/32']]) expect(rules.loopbackOnly(ips), ips.join()).toBe(true);
		for (const ips of [[], null, ['10.0.0.0/24'], ['127.0.0.1', '192.168.1.2'], ['127.0.0.1/0'], ['127.0.0.1/7'], ['::/0']]) {
			expect(rules.loopbackOnly(ips), String(ips)).toBe(false);
		}
	});
});

describe('failed sign-ins (SH-2)', () => {
	it('records only the app and the admin UI, with where it came from', () => {
		expect(rules.loginArea('users')).toBe('app');
		expect(rules.loginArea('_superusers')).toBe('admin');
		expect(rules.loginArea('andere')).toBe('');
		expect(rules.loginSource('http://127.0.0.1:8090', 'same-origin')).toBe('app');
		expect(rules.loginSource('https://evil.example', 'cross-site')).toBe('web');
		expect(rules.loginSource('null', '')).toBe('web');
		expect(rules.loginSource('', 'none')).toBe('web');
		expect(rules.loginSource('', '')).toBe('program');
	});

	it('keeps the entered account short and without control characters, never more', () => {
		expect(rules.identityText('  anna@example.com\r\n ')).toBe('anna@example.com');
		expect(rules.identityText('x'.repeat(300))).toHaveLength(200);
		expect(rules.identityText(undefined)).toBe('');
	});

	it('writes times like PocketBase and asks for attention from ten failures a day on', () => {
		expect(rules.pocketBaseTime(Date.UTC(2026, 9, 3, 12, 0, 0))).toBe('2026-10-03 12:00:00.000Z');
		expect([rules.LOGIN_RETENTION_DAYS, rules.LOGIN_MAX_ROWS, rules.NOTICE_MIN]).toEqual([30, 5000, 10]);
		expect(rules.needsNotice(9)).toBe(false);
		expect(rules.needsNotice(10)).toBe(true);
		expect(rules.needsNotice(undefined)).toBe(false);
	});
});
