// The rules of the error log of the server (FP-2, ADR-0077): cleaning of texts with typical secret
// patterns, the allowed context, the same failure, the areas, the limits and which failures of a
// request count as unexpected. All values are invented; tokens are built from parts, so no scanner
// takes them for real ones.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('problem-rules.js');
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MIGRATION = readFileSync(join(ROOT, 'app', 'pb_migrations', '1790205100_problem_events.js'), 'utf8');

const OWNER = 'user00000000001';
const OTHER = 'user00000000002';
const HOUSEHOLD = 'house0000000001';
const CONNECTION = 'conn00000000001';

describe('problem-rules.js: cleaning (privacy, ADR-0077 §4)', () => {
	it.each([
		['a bearer value', 'Abgelehnt: Bearer abc.def-123 vom Server', 'Abgelehnt: Bearer [entfernt] vom Server'],
		['a basic value', 'Basic dXNlcjpnZWhlaW0= abgelehnt', 'Basic [entfernt] abgelehnt'],
		['an Authorization header', 'Authorization: Token abc123 abgelehnt', 'Authorization: [entfernt] abgelehnt'],
		['an API key header', 'X-Api-Key: k-123456 fehlt', 'X-Api-Key: [entfernt] fehlt'],
		['a cookie header', 'Cookie: pb_auth=abc; session=def', 'Cookie: [entfernt]'],
		['token=', 'Aufruf mit token=geheim-123 gescheitert', 'Aufruf mit token=[entfernt] gescheitert'],
		['api_key=', 'api_key=abc123&x=1', 'api_key=[entfernt]&x=1'],
		['apiKey=', 'apiKey=abc123 ungültig', 'apiKey=[entfernt] ungültig'],
		['password=', 'login password=hunter2 failed', 'login password=[entfernt] failed'],
		['passwort=', 'passwort="mein geheimnis" falsch', 'passwort=[entfernt] falsch'],
		['bot_token=', 'bot_token=1234 fehlt', 'bot_token=[entfernt] fehlt'],
		['client_secret=', 'client_secret=s3cr3t', 'client_secret=[entfernt]'],
		['password: in plain text', 'Passwort: hunter2 abgelehnt', 'Passwort: [entfernt] abgelehnt'],
		['a secret in JSON', '{"password":"hunter2","user":"x"}', '{"…":"…","…":"…"}'],
		['a JWT', 'Sitzung eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl abgelaufen', 'Sitzung [entfernt] abgelaufen']
	])('removes %s', (_, input, expected) => {
		expect(rules.cleanMessage(input)).toBe(expected);
	});

	it('removes the query after a URL or a path and the user of a URL', () => {
		expect(rules.cleanMessage('GET /api/byl/tickets?filter=title~"Arzt"&token=1 scheiterte')).toBe('GET /api/byl/tickets scheiterte');
		expect(rules.cleanMessage('Abruf https://example.com/feed.ics?private=abc gescheitert')).toBe('Abruf https://example.com/feed.ics gescheitert');
		expect(rules.cleanMessage('imaps://anna:geheim@imap.example.com antwortet nicht')).toBe('imaps://imap.example.com antwortet nicht');
	});

	it('replaces e-mail addresses', () => {
		expect(rules.cleanMessage('Anmeldung für anna.beispiel+test@example.com fehlgeschlagen')).toBe(
			'Anmeldung für [E-Mail] fehlgeschlagen'
		);
	});

	it('removes the tokens of Telegram, Notion, GitHub, the own inbox and other long keys', () => {
		const telegram = '123456789:' + 'AAErfunden0Beispiel0NurFuerTests0123';
		const notion = 'ntn_' + 'Erfunden0Beispiel0NurFuerTests0123456789';
		const github = 'gh' + 'p_' + 'Erfunden0Beispiel0NurFuerTests012345';
		const inbox = 'byl_' + 'Erfunden0Beispiel0NurFuerTests0123456789';
		const other = 'Q'.repeat(20) + 'erfunden' + '9'.repeat(20);
		expect(rules.cleanMessage(`Bot ${telegram}, ${notion}, ${github}, ${inbox} und ${other}`)).toBe(
			'Bot [entfernt], [entfernt], [entfernt], [entfernt] und [entfernt]'
		);
		expect(rules.cleanMessage('ghp_kurz, ntn_kurz und byl_kurz bleiben')).toBe('ghp_kurz, ntn_kurz und byl_kurz bleiben');
	});

	it('keeps only the file name of a path of this computer and leaves routes alone', () => {
		expect(rules.cleanMessage('TypeError at C:\\Users\\Anna\\becauseyoulovejira\\app\\pb_hooks\\lib\\x.js:3:9')).toBe(
			'TypeError at …\\x.js:3:9'
		);
		expect(rules.cleanMessage('Fehler in /home/anna/app/pb_hooks/lib/x.js:3')).toBe('Fehler in …/x.js:3');
		expect(rules.cleanMessage('POST /api/byl/connections/conn00000000001/run')).toBe('POST /api/byl/connections/conn00000000001/run');
	});

	it('hides quoted content, keeps the first line only and drops "GoError: "', () => {
		expect(rules.cleanMessage('GoError: Zeile "SUMMARY:Arzt bei Dr. Beispiel" ungültig\n\tat x (y.js:1:2)')).toBe('Zeile "…" ungültig');
		expect(rules.cleanMessage('Verbindung „Annas Kalender“ scheiterte')).toBe('Verbindung „…“ scheiterte');
	});

	it('collapses white space and cuts to 300 characters', () => {
		expect(rules.cleanMessage('  zu   viel\t Raum  ')).toBe('zu viel Raum');
		const long = rules.cleanMessage('Fehler '.repeat(100));
		expect(long).toHaveLength(rules.MESSAGE_MAX);
		expect(long.endsWith('…')).toBe(true);
		expect(rules.MESSAGE_MAX).toBe(300);
	});

	it('cleans codes to letters, digits and _.:- of at most 60 characters', () => {
		expect(rules.cleanCode('http 500 / intern')).toBe('http_500_intern');
		expect(rules.cleanCode('x'.repeat(80))).toHaveLength(rules.CODE_MAX);
	});
});

describe('problem-rules.js: the context', () => {
	it('keeps only the allowed keys with values of their shape', () => {
		expect(
			rules.contextOf({
				connection: CONNECTION,
				channel: 'calendar',
				method: 'post',
				route: 'http://127.0.0.1:8090/api/byl/connections/conn00000000001/run?token=geheim#x',
				status: 500,
				body: { title: 'Arzt' },
				headers: { Authorization: 'Bearer x' },
				token: 'geheim'
			})
		).toEqual({ connection: CONNECTION, channel: 'calendar', method: 'POST', route: '/api/byl/connections/conn00000000001/run', status: 500 });
		expect(rules.contextOf({ connection: 'zu kurz', channel: 'fax', method: 'BREW', status: 404, rule: 'x', job: 'Böse Aufgabe' })).toEqual({});
		expect(rules.contextOf({ rule: 'rule00000000001', job: 'recurrence' })).toEqual({ rule: 'rule00000000001', job: 'recurrence' });
		expect(rules.contextOf(null)).toEqual({});
	});

	it('shortens a route to 200 characters and replaces odd characters', () => {
		expect(rules.routeOf(`/api/${'a'.repeat(300)}`)).toHaveLength(rules.ROUTE_MAX);
		expect(rules.routeOf('/api/byl/x y<z>')).toBe('/api/byl/x_y_z_');
		expect(rules.routeOf('api/health')).toBe('/api/health');
	});

	it('lists exactly the keys of CONTEXT_KEYS', () => {
		expect(rules.CONTEXT_KEYS).toEqual(['connection', 'channel', 'rule', 'job', 'method', 'route', 'status']);
	});
});

describe('problem-rules.js: the same failure is one entry', () => {
	const event = (overrides = {}) => ({
		source: 'channel',
		area: 'private',
		owner: OWNER,
		household: '',
		code: 'channel_error',
		message: 'Der Kalender antwortet mit HTTP 500 um 2026-11-02 10:15:00.000Z (Anfrage 4711, ID abc123def456ghi).',
		context: { connection: CONNECTION, channel: 'calendar' },
		...overrides
	});

	it('neutralises times, dates, IDs, hex values and numbers in the message', () => {
		expect(rules.normalizeMessage('Lauf 2026-11-02T10:15:00Z, am 02.11.2026 um 10:15, ID abc123def456ghi, Hash deadbeef42, 17 neu')).toBe(
			'Lauf {zeit}, am {datum} um {zeit}, ID {id}, Hash {id}, # neu'
		);
		expect(rules.fingerprintSource(event())).toBe(
			rules.fingerprintSource(
				event({ message: 'Der Kalender antwortet mit HTTP 502 um 2026-11-03 08:00:01.000Z (Anfrage 12, ID xyz987uvw654rst).' })
			)
		);
	});

	it('tells apart source, area, owner, household, code, message and the keys of the context', () => {
		const base = rules.fingerprintSource(event());
		for (const other of [
			event({ source: 'job' }),
			event({ owner: OTHER }),
			event({ area: 'household', owner: '', household: HOUSEHOLD }),
			event({ code: 'other' }),
			event({ message: 'Etwas ganz anderes.' }),
			event({ context: { connection: 'conn00000000002', channel: 'calendar' } }),
			event({ context: { connection: CONNECTION, channel: 'telegram' } })
		]) {
			expect(rules.fingerprintSource(other)).not.toBe(base);
		}
	});

	it('takes the route with * for IDs, so the same failure on two tickets is one entry', () => {
		const request = (route) => event({ source: 'request', code: 'http_500', context: { method: 'POST', route, status: 500 } });
		expect(rules.routePattern('/api/byl/tickets/abc123def456ghi/duplicate')).toBe('/api/byl/tickets/*/duplicate');
		expect(rules.fingerprintSource(request('/api/byl/tickets/abc123def456ghi/duplicate'))).toBe(
			rules.fingerprintSource(request('/api/byl/tickets/zzz999yyy888xxx/duplicate'))
		);
		expect(rules.fingerprintSource(request('/api/byl/tickets/abc123def456ghi/duplicate'))).not.toBe(
			rules.fingerprintSource(request('/api/byl/tickets/abc123def456ghi/follow-up'))
		);
	});
});

describe('problem-rules.js: entries and areas', () => {
	const NOW = Date.UTC(2026, 10, 2, 10, 15, 0);

	it('keeps the owner only in the private area and the household only in its area', () => {
		const input = { source: 'channel', owner: OWNER, household: HOUSEHOLD, code: 'channel_error', message: 'x', context: {} };
		expect(rules.eventOf({ ...input, area: 'private' }, NOW)).toMatchObject({ area: 'private', owner: OWNER, household: '' });
		expect(rules.eventOf({ ...input, area: 'household' }, NOW)).toMatchObject({ area: 'household', owner: '', household: HOUSEHOLD });
		expect(rules.eventOf({ ...input, area: 'system' }, NOW)).toMatchObject({
			area: 'system',
			owner: '',
			household: '',
			at: '2026-11-02 10:15:00.000Z'
		});
	});

	it('takes no entry without a known source and area or without the owner of its area', () => {
		const input = { source: 'request', area: 'private', owner: OWNER, message: 'x' };
		expect(rules.eventOf({ ...input, source: 'browser' }, NOW)).toBeNull();
		expect(rules.eventOf({ ...input, area: 'public' }, NOW)).toBeNull();
		expect(rules.eventOf({ ...input, owner: '' }, NOW)).toBeNull();
		expect(rules.eventOf({ ...input, area: 'household', household: '' }, NOW)).toBeNull();
		expect(rules.eventOf(null, NOW)).toBeNull();
	});

	it('cleans message, code and context of an entry', () => {
		const stored = rules.eventOf(
			{ source: 'request', area: 'system', code: 'http 500', message: 'token=geheim für anna@example.com', context: { route: '/x?y=1', body: 'Inhalt' } },
			NOW
		);
		expect(stored).toMatchObject({ code: 'http_500', message: 'token=[entfernt] für [E-Mail]', context: { route: '/x' } });
	});

	it('follows owner and household of a record', () => {
		expect(rules.areaOf(OWNER, '')).toEqual({ area: 'private', owner: OWNER, household: '' });
		expect(rules.areaOf(OWNER, HOUSEHOLD)).toEqual({ area: 'household', owner: '', household: HOUSEHOLD });
	});

	it('has the limits of ADR-0077: 30 days, 5000 entries', () => {
		expect(rules.RETENTION_DAYS).toBe(30);
		expect(rules.MAX_ROWS).toBe(5000);
		expect(rules.HEADER).toBe('X-Byl-Problem');
	});

	it('names the same sources and areas as the migration', () => {
		for (const value of [...rules.SOURCES, ...rules.AREAS]) expect(MIGRATION).toContain(`'${value}'`);
		expect(MIGRATION).toMatch(/values: \['request', 'channel', 'job'\]/);
		expect(MIGRATION).toMatch(/values: \['private', 'household', 'system'\]/);
		expect(MIGRATION).toContain(`max: ${rules.MESSAGE_MAX}`);
	});
});

describe('problem-rules.js: failures of a request', () => {
	it('takes the status of an ApiError, also wrapped, 404 for missing rows and else 400, like PocketBase', () => {
		expect(rules.statusOf({ status: 500, message: 'x' })).toBe(500);
		expect(rules.statusOf({ message: 'GoError', value: { status: 503 } })).toBe(503);
		expect(rules.statusOf({ message: 'sql: no rows in result set' })).toBe(404);
		expect(rules.statusOf(new TypeError('x is undefined'))).toBe(400);
		expect(rules.statusOf('kaputt')).toBe(400);
	});

	it('counts 5xx as unexpected, except the deliberate 502 and 503', () => {
		expect([500, 501, 504, 599].map(rules.isUnexpectedStatus)).toEqual([true, true, true, true]);
		expect([200, 400, 404, 429, 502, 503, 600].map(rules.isUnexpectedStatus)).toEqual([false, false, false, false, false, false, false]);
	});

	it('reads the message of an error and the error behind an ApiError', () => {
		expect(rules.errorText(new Error('kaputt'))).toBe('kaputt');
		expect(rules.errorText({ message: 'Failed to create record.', value: { rawData: () => 'UNIQUE constraint failed: tickets.key' } })).toBe(
			'Failed to create record.: UNIQUE constraint failed: tickets.key'
		);
		expect(rules.errorText({ message: 'x', rawData: () => { throw new Error('nein'); } })).toBe('x');
		expect(rules.errorText(null)).toBe('');
		expect(rules.errorText('schlicht')).toBe('schlicht');
	});
});
