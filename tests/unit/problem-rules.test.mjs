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

	it('removes single-quoted content and the content of guillemets and low single quotes', () => {
		expect(rules.cleanMessage("Titel 'Arzt bei Dr. Beispiel' ungültig")).toBe("Titel '…' ungültig");
		expect(rules.cleanMessage("'Annas Kalender' und ('Bens Liste') fehlen")).toBe("'…' und ('…') fehlen");
		expect(rules.cleanMessage("Verbindung 'Anna's Kalender' scheiterte")).toBe("Verbindung '…' scheiterte");
		expect(rules.cleanMessage('Verbindung \u00BBAnnas Kalender\u00AB scheiterte')).toBe('Verbindung \u00BB…\u00AB scheiterte');
		expect(rules.cleanMessage('Liste \u201AEinkauf\u2018 fehlt')).toBe('Liste \u201A…\u2018 fehlt');
		// An apostrophe in a word is no quote.
		for (const kept of ["Das geht's nicht", "can't read Anna's file", 'Feld fehlt']) expect(rules.cleanMessage(kept)).toBe(kept);
	});

	it('removes a key of 32 characters with letters and digits, but no word and no ID of PocketBase', () => {
		const hex = 'd41d8cd98f00b204' + 'e9800998ecf8427e';
		const base64 = 'Q2VoZWltZXJUZXN0' + 'MTIzNDU2Nzg5MDEy';
		expect(rules.cleanMessage(`Schlüssel ${hex} abgelehnt`)).toBe('Schlüssel [entfernt] abgelehnt');
		expect(rules.cleanMessage(`Token ${base64}== ungültig`)).toBe('Token [entfernt] ungültig');
		for (const kept of [
			// 31 characters with digits, a word of 39 letters, IDs of PocketBase, a route with IDs.
			`Wert ${hex.slice(0, 31)} bleibt`,
			'Die Rechtsschutzversicherungsgesellschaften antworten nicht',
			'Ticket abc123def456ghi und xyz987uvw654rst fehlen',
			'POST /api/byl/connections/conn00000000001/run'
		]) {
			expect(rules.cleanMessage(kept)).toBe(kept);
		}
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

	it('hides the file name of /api/files, also percent-encoded', () => {
		expect(rules.routeOf('/api/files/inbox_items/abc123def456ghi/rechnung_anna.pdf')).toBe('/api/files/inbox_items/abc123def456ghi/*');
		expect(rules.routeOf('/api/files/inbox_items/abc123def456ghi/Arztbrief%20M%C3%BCller.pdf?thumb=100x100')).toBe(
			'/api/files/inbox_items/abc123def456ghi/*'
		);
		expect(rules.contextOf({ route: '/api/files/tickets/abc123def456ghi/a/b.txt' })).toEqual({ route: '/api/files/tickets/abc123def456ghi/*' });
		// Without a file name and outside of /api/files the route stays.
		for (const kept of ['/api/files/token', '/api/byl/files/abc123def456ghi/x.pdf', '/api/byl/tickets/abc123def456ghi/duplicate']) {
			expect(rules.routeOf(kept)).toBe(kept);
		}
	});

	it('keeps the status 400 only for an unexpected failure that PocketBase answers with 400', () => {
		expect(rules.contextOf({ status: 400 })).toEqual({});
		expect(rules.contextOf({ status: 400 }, 'http_500')).toEqual({});
		expect(rules.contextOf({ status: 400 }, rules.UNEXPECTED_400)).toEqual({ status: 400 });
		expect(rules.contextOf({ status: 404 }, rules.UNEXPECTED_400)).toEqual({});
		const stored = rules.eventOf(
			{ source: 'request', area: 'system', code: 'http_400_unexpected', message: 'Kaputt', context: { method: 'GET', route: '/x', status: 400 } },
			Date.UTC(2026, 10, 2)
		);
		expect(stored.context).toEqual({ method: 'GET', route: '/x', status: 400 });
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
	// The shapes the catch of the wrapper sees in PocketBase 0.40.4 (tests/fixtures/pb_hooks/
	// problem-events-probe.pb.js): an Error of JavaScript as it is, an error of Go as GoError with
	// `value`, an ApiError as that value with status, message, data and rawData().
	const UNEXPECTED = { code: 'http_400_unexpected', status: 400 };
	const noValidation = () => false;
	const goError = (message, value = {}) => ({ name: 'GoError', message, value });
	const apiError = (status, message, data = {}, raw = null) => goError(message, { status, message, data, rawData: () => raw });

	it('takes an ApiError with an unexpected 5xx by its status, also wrapped', () => {
		expect(rules.requestFailureOf({ status: 500, message: 'x' }, noValidation)).toEqual({ code: 'http_500', status: 500 });
		expect(rules.requestFailureOf(apiError(504, 'Zu langsam'), noValidation)).toEqual({ code: 'http_504', status: 504 });
		for (const status of [400, 401, 403, 404, 429, 502, 503]) {
			expect(rules.requestFailureOf(apiError(status, 'Erwartet'), noValidation), String(status)).toBeNull();
		}
	});

	it('takes every thrown value without the status of an ApiError as an unexpected 400', () => {
		for (const thrown of [new Error('Kaputt'), new TypeError('x is undefined'), new RangeError('zu groß'), 'kaputt', undefined]) {
			expect(rules.requestFailureOf(thrown, noValidation)).toEqual(UNEXPECTED);
		}
		expect(rules.requestFailureOf(goError('database is locked'), noValidation)).toEqual(UNEXPECTED);
		expect(rules.requestFailureOf(goError('UNIQUE constraint failed: tickets.key'), noValidation)).toEqual(UNEXPECTED);
	});

	it('takes no validation, nothing missing, no cancelled request and no unreadable body', () => {
		const validation = goError('title: cannot be blank.', { title: {} });
		expect(rules.requestFailureOf(validation, (value) => value === validation.value)).toBeNull();
		for (const message of [
			'sql: no rows in result set',
			'open C:\\x\\y.txt: The system cannot find the file specified.',
			'open /x/y.txt: no such file or directory',
			'context canceled',
			'jsontext: invalid character \'k\' at start of value within "/titel" after offset 10',
			'jsontext: unexpected EOF within "/titel" after offset 12',
			'multipart: NextPart: EOF',
			'http: request body too large'
		]) {
			expect(rules.requestFailureOf(goError(message), noValidation), message).toBeNull();
		}
		// An Error of JavaScript always counts: only Go names these failures of the client.
		expect(rules.requestFailureOf(new SyntaxError('jsontext: invalid character'), noValidation)).toEqual(UNEXPECTED);
	});

	it('takes a failed save of the record API without field errors, not the check of its rule', () => {
		const hook = 'Error: Kaputt im Model-Hook\n\tat pb.js:3:11(11)';
		expect(rules.requestFailureOf(apiError(400, 'Failed to create record.', {}, hook), noValidation)).toEqual(UNEXPECTED);
		expect(rules.requestFailureOf(apiError(400, 'Failed to update record.', {}, 'database is locked'), noValidation)).toEqual(UNEXPECTED);
		for (const [message, data, raw] of [
			['Failed to create record.', { title: { code: 'validation_required' } }, 'title: cannot be blank.'],
			['Failed to create record.', {}, 'create rule failure: sql: no rows in result set'],
			['Failed to create record.', {}, { status: 400, message: 'Abgelehnt.' }],
			['Failed to create record.', {}, null],
			['Failed to update record.', {}, 'sql: no rows in result set'],
			['Failed to delete record.', {}, hook],
			['Failed to authenticate.', {}, 'invalid login credentials'],
			['Something went wrong while processing your request.', {}, 'invalid left operand "fingerprint"']
		]) {
			expect(rules.requestFailureOf(apiError(400, message, data, raw), noValidation), `${message} ${String(raw)}`).toBeNull();
		}
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
