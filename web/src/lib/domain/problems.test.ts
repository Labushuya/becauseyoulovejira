// Entries of failed actions (FP-1, ADR-0071): the plain-text report without bodies, queries,
// tokens and headers, the cleaning of texts, the ring of the session with merging, the stored form
// and the line between a failed action and a hint at an input.

import { describe, expect, it } from 'vitest';
import { reportedScriptProblem } from '../data/errors';
import {
	EMAIL_MARK,
	INPUT_VALIDATION_CODES,
	PROBLEM_INPUT_MAX,
	PROBLEM_LOG_MAX,
	PROBLEM_MERGE_MS,
	PROBLEM_TEXT_MAX,
	STACK_MAX_LINES,
	UNEXPECTED_INTENT,
	addProblem,
	allProblemsLabel,
	clientProblem,
	exceptionOf,
	fieldCodesOf,
	formatProblemTime,
	isIgnorableGlobalError,
	isInputValidation,
	outcomeText,
	parseStoredProblems,
	problemFacts,
	problemReport,
	problemsReport,
	requestPathOf,
	responseOutcome,
	sanitizeProblemText,
	serializeProblems,
	stackLines,
	toProblemEntry,
	type ProblemEntry,
	type ProblemInput
} from './problems';

/** 19.10.2026, 14:03:12 in Berlin (summer time, UTC+2). */
const AT = Date.UTC(2026, 9, 19, 12, 3, 12, 345);

function entry(overrides: Partial<ProblemInput> = {}): ProblemEntry {
	return clientProblem({
		id: 'p-1',
		intent: 'Unteraufgaben übertragen',
		at: AT,
		outcome: {
			result: 'response',
			status: 409,
			code: null,
			message: 'Das Hauptticket wurde inzwischen geändert.'
		},
		request: { method: 'POST', path: '/api/byl/tickets/abc123def456789/subtasks/transfer' },
		app: '1792421233406',
		exception: null,
		...overrides
	});
}

describe('report as plain text', () => {
	it('names intent, time in Berlin and UTC, result, message, request and build', () => {
		expect(problemReport(entry())).toBe(
			[
				'Absicht: Unteraufgaben übertragen',
				'Zeitpunkt: 19.10.2026, 14:03:12 (2026-10-19T12:03:12.345Z)',
				'Ergebnis: HTTP 409 (Konflikt)',
				'Servermeldung: Das Hauptticket wurde inzwischen geändert.',
				'Anfrage: POST /api/byl/tickets/abc123def456789/subtasks/transfer',
				'App-Stand: Build 1792421233406'
			].join('\n')
		);
	});

	it('says "Keine Verbindung zum Server" without an answer and "unbekannt" without a build', () => {
		const report = problemReport(
			entry({
				outcome: { result: 'network', status: null, code: null, message: null },
				app: null
			})
		);
		expect(report).toContain('Ergebnis: Keine Verbindung zum Server');
		expect(report).toContain('App-Stand: unbekannt');
		expect(report).not.toContain('Servermeldung');
	});

	it('adds the technical details only for an unexpected exception', () => {
		const report = problemReport(
			entry({
				intent: UNEXPECTED_INTENT,
				outcome: { result: 'exception', status: null, code: null, message: null },
				request: null,
				exception: {
					name: 'TypeError',
					message: "Cannot read properties of undefined (reading 'key')",
					stack: ['at render (/_app/immutable/chunks/a.js:1:2)']
				}
			})
		);
		expect(report).toContain('Ergebnis: Unerwartete Ausnahme im Browser');
		expect(report).toContain(
			"Technische Details:\n  TypeError: Cannot read properties of undefined (reading 'key')\n    at render (/_app/immutable/chunks/a.js:1:2)"
		);
		expect(report).not.toContain('Anfrage:');
		expect(problemReport(entry())).not.toContain('Technische Details');
	});

	it('never holds a query, a token, a body or a header of the request', () => {
		const sdkUrl =
			'http://127.0.0.1:8090/api/collections/tickets/records?filter=title~%22Geheim%22&token=eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEifQ.c2lnbmF0dXJl';
		const report = problemReport(
			entry({
				request: { method: 'GET', path: requestPathOf(sdkUrl) },
				outcome: responseOutcome(400, {
					message: 'Fehler bei http://127.0.0.1:8090/api/x?token=abc123 mit Bearer s3cr3t',
					data: { title: { code: 'validation_x', message: 'Geheimer Titel' } }
				})
			})
		);
		expect(report).toContain('Anfrage: GET /api/collections/tickets/records');
		expect(report).toContain('Fehlercode: title: validation_x');
		const secrets = ['?', 'filter', 'Geheim', 'token=abc123', 'eyJ', 's3cr3t', 'Authorization'];
		for (const secret of secrets) expect(report, secret).not.toContain(secret);
		expect(report).toContain(
			'Servermeldung: Fehler bei http://127.0.0.1:8090/api/x mit Bearer [entfernt]'
		);
	});

	it('reports all entries for "Alle kopieren", newest first', () => {
		const older = entry({ id: 'p-0', intent: 'Ticket speichern', at: AT - 60_000 });
		const text = problemsReport([entry(), older]);
		expect(text.split('\n')[0]).toBe('becauseyoulovejira – Fehler dieser Sitzung (2)');
		expect(text.indexOf('Unteraufgaben übertragen')).toBeLessThan(text.indexOf('Ticket speichern'));
		expect(allProblemsLabel(2)).toBe('Alle Fehler dieser Sitzung (2)');
	});
});

describe('facts and texts', () => {
	it('lists the facts of the details in the order of the report', () => {
		expect(problemFacts(entry()).map((fact) => fact.label)).toEqual([
			'Absicht',
			'Zeitpunkt',
			'Ergebnis',
			'Servermeldung',
			'Anfrage',
			'App-Stand'
		]);
		const merged = { ...entry(), count: 3, lastAt: AT + 8000 };
		expect(problemFacts(merged)[2]).toEqual({ label: 'Häufigkeit', value: '3× bis 14:03:20' });
	});

	it('names HTTP status codes and the other results', () => {
		const response = (status: number) =>
			outcomeText({ result: 'response', status, code: null, message: null });
		expect(response(403)).toBe('HTTP 403 (Keine Berechtigung)');
		expect(response(503)).toBe('HTTP 503 (Nicht verfügbar)');
		expect(response(418)).toBe('HTTP 418');
		expect(outcomeText({ result: 'answer', status: null, code: null, message: null })).toBe(
			'Unerwartete Antwort des Servers'
		);
		expect(outcomeText({ result: 'reported', status: null, code: 'error', message: 'x' })).toBe(
			'Vom Server gemeldeter Fehler'
		);
		expect(outcomeText({ result: 'response', status: null, code: 'x', message: null })).toBe(
			'Vom Server abgelehnt'
		);
	});

	it('formats the time in Berlin in winter and summer', () => {
		expect(formatProblemTime(Date.UTC(2026, 0, 5, 8, 0, 9))).toBe('05.01.2026, 09:00:09');
		expect(formatProblemTime(AT)).toBe('19.10.2026, 14:03:12');
	});

	it('takes the reason of a route, else the codes of the fields, at most five', () => {
		expect(responseOutcome(503, { message: 'Nach dem Neustart.', reason: 'missing' })).toEqual({
			result: 'response',
			status: 503,
			code: 'missing',
			message: 'Nach dem Neustart.'
		});
		const data = Object.fromEntries(
			['a', 'b', 'c', 'd', 'e', 'f'].map((field) => [field, { code: `validation_${field}` }])
		);
		expect(responseOutcome(400, { data }).code).toBe(
			'a: validation_a, b: validation_b, c: validation_c, d: validation_d, e: validation_e'
		);
		expect(responseOutcome(500, null)).toEqual({
			result: 'response',
			status: 500,
			code: null,
			message: null
		});
	});
});

describe('cleaning', () => {
	it('keeps only the path of a request, with IDs and keys', () => {
		expect(requestPathOf('http://127.0.0.1:8090/api/byl/tickets/HAUS-12/delete?x=1#y')).toBe(
			'/api/byl/tickets/HAUS-12/delete'
		);
		expect(requestPathOf('/api/byl/attention?reason=datei')).toBe('/api/byl/attention');
		expect(requestPathOf('api/health')).toBe('/api/health');
	});

	it('removes queries, tokens, bearer values and secrets from a text', () => {
		expect(sanitizeProblemText('GET /api/x?token=abc&b=2 fehlgeschlagen')).toBe(
			'GET /api/x fehlgeschlagen'
		);
		expect(sanitizeProblemText('Authorization: Bearer abc.def')).toBe(
			'Authorization: Bearer [entfernt]'
		);
		expect(sanitizeProblemText('key=BYL_SECRET_1 und password=hunter2')).toBe(
			'key=[entfernt] und password=[entfernt]'
		);
		expect(sanitizeProblemText('eyJhbGciOi.eyJzdWIiOi.abc')).toBe('[entfernt]');
		expect(sanitizeProblemText('  viel \n\t Platz  ')).toBe('viel Platz');
		expect(sanitizeProblemText('x'.repeat(400))).toHaveLength(300);
	});

	// BYL-E6-2416
	it('marks e-mail addresses like the server (FP-3b, ADR-0077 §4)', () => {
		expect(EMAIL_MARK).toBe('[E-Mail]');
		expect(sanitizeProblemText('Konto anna.beispiel+test@example.com gesperrt')).toBe(
			'Konto [E-Mail] gesperrt'
		);
		expect(sanitizeProblemText('An: a@example.com, b@sub.example.org.')).toBe(
			'An: [E-Mail], [E-Mail].'
		);
		// Frames of a stack of Firefox and Safari are no addresses and stay.
		expect(sanitizeProblemText('render@http://127.0.0.1:8090/_app/a.js:1:2')).toBe(
			'render@http://127.0.0.1:8090/_app/a.js:1:2'
		);
		expect(sanitizeProblemText('run@b.js:3:4')).toBe('run@b.js:3:4');
		expect(sanitizeProblemText('f@x.js.map:1:2')).toBe('f@x.js.map:1:2');
		expect(sanitizeProblemText('anna@example.com: 3 Fehler')).toBe('[E-Mail]: 3 Fehler');
	});

	// BYL-E6-2417
	it('keeps only the file name of a path of this computer: drive, share and POSIX (FP-3b)', () => {
		expect(sanitizeProblemText('Datei C:\\Users\\anna\\app\\pb_data\\data.db fehlt')).toBe(
			'Datei …\\data.db fehlt'
		);
		expect(sanitizeProblemText('Ziel D:/Sicherung/anna/byl-2026.age voll')).toBe(
			'Ziel …\\byl-2026.age voll'
		);
		expect(sanitizeProblemText('Ziel \\\\nas\\backup\\anna\\byl.age nicht erreichbar')).toBe(
			'Ziel …\\byl.age nicht erreichbar'
		);
		expect(sanitizeProblemText('open /home/anna/byl/app/pb_data/data.db: denied')).toBe(
			'open …/data.db: denied'
		);
		expect(sanitizeProblemText('(/Users/anna/byl/x.log)')).toBe('(…/x.log)');
		// Paths of the app and of URLs stay: they name no account.
		expect(sanitizeProblemText('POST /api/byl/backup/run fehlgeschlagen')).toBe(
			'POST /api/byl/backup/run fehlgeschlagen'
		);
		expect(stackLines('at f (http://127.0.0.1:8090/_app/immutable/x.js:2:3)')).toEqual([
			'at f (http://127.0.0.1:8090/_app/immutable/x.js:2:3)'
		]);
		const report = problemReport(
			entry({
				outcome: responseOutcome(500, {
					message: 'Sicherung für anna@example.com nach C:\\Users\\anna\\Backups\\x.age gescheitert'
				})
			})
		);
		expect(report).toContain('Servermeldung: Sicherung für [E-Mail] nach …\\x.age gescheitert');
		expect(report).not.toMatch(/anna|Users/);
	});

	// BYL-E6-2436
	it('takes paths with spaces whole and shows only "…" for a root (FP-3b, R-A4, R-A5)', () => {
		const cases: Array<[string, string]> = [
			['Ziel C:\\Users\\Anna Maria\\Backups\\x.age voll', 'Ziel …\\x.age voll'],
			[
				"Zugriff auf 'C:\\Users\\Anna Maria\\byl\\pb_data' verweigert",
				"Zugriff auf '…\\pb_data' verweigert"
			],
			[
				'Zugriff auf "C:\\Users\\Anna Maria\\byl\\pb_data" verweigert',
				'Zugriff auf "…\\pb_data" verweigert'
			],
			['Ordner C:\\Users\\Anna\\ fehlt', 'Ordner … fehlt'],
			['Ordner C:\\Users\\Anna fehlt', 'Ordner … fehlt'],
			['Laufwerk C:\\ voll', 'Laufwerk … voll'],
			['Ziel \\\\nas\\Familie Bott\\x.age fehlt', 'Ziel …\\x.age fehlt'],
			['Freigabe \\\\nas\\Familie fehlt', 'Freigabe … fehlt'],
			['Ziel D:/Sicherung Anna/byl.age voll', 'Ziel …\\byl.age voll'],
			['Pfad \\\\?\\C:\\Users\\Anna Maria\\x.age zu lang', 'Pfad …\\x.age zu lang'],
			['Pfad \\\\?\\UNC\\nas\\Familie Bott\\x.age zu lang', 'Pfad …\\x.age zu lang'],
			['Datei file:///C:/Users/Anna%20Maria/x.age fehlt', 'Datei file:///…\\x.age fehlt'],
			['JSON {"path":"C:\\\\Users\\\\Anna\\\\x.age"}', 'JSON {"path":"…\\x.age"}'],
			['open /home/anna maria/x.age: denied', 'open …/x.age: denied'],
			['open /home/anna/: denied', 'open …: denied'],
			['open /Users/anna fehlt', 'open … fehlt'],
			['open /tmp/byl.lock fehlt', 'open …/byl.lock fehlt'],
			['open file:///home/anna/x.age fehlt', 'open file://…/x.age fehlt'],
			// A path ends at ":", so the line of a file stays.
			['bei C:\\Users\\Anna Maria\\byl\\x.js:3:4', 'bei …\\x.js:3:4']
		];
		for (const [text, clean] of cases) expect(sanitizeProblemText(text), text).toBe(clean);
		// Times, dates, fractions, versions, routes of the app, URLs and frames of a stack stay.
		for (const text of [
			'um 12:30 am 06/11/2026',
			'Schritt 1/2',
			'Build v1.4.2+42',
			'POST /api/byl/backup/run fehlgeschlagen',
			'GET /_app/immutable/x.js',
			'siehe https://example.org/hilfe/sicherung',
			'at f (http://127.0.0.1:8090/_app/immutable/x.js:2:3)',
			'run@http://127.0.0.1:8090/_app/a.js:1:2'
		]) {
			expect(sanitizeProblemText(text), text).toBe(text);
		}
		// Two paths with the same separator may take the text between them: the safe direction.
		expect(sanitizeProblemText('von \\\\nas\\a\\b nach \\\\nas\\c\\d.age')).toBe('von …\\d.age');
		// Known rest (ADR-0071): a folder with a space at the end of a sentence keeps its last word.
		expect(sanitizeProblemText('Ordner C:\\Users\\Anna Maria')).toBe('Ordner … Maria');
	});

	// BYL-E6-2438
	it('cleans a path with spaces in the problem of a report of the catalog (FP-3b, R-A9)', () => {
		const problem = reportedScriptProblem({
			intent: 'App neu starten',
			method: 'GET',
			path: '/api/byl/system',
			report: {
				code: 'app-incomplete',
				problem:
					'Im Ordner C:\\Users\\Anna Maria\\byl\\app fehlt byl-control.ps1; der Ordner app ist unvollständig.'
			},
			code: null,
			message: 'Fehler'
		});
		expect(problem.outcome.message).toBe(
			'Im Ordner …\\app fehlt byl-control.ps1; der Ordner app ist unvollständig.'
		);
		expect(problemReport(problem)).not.toMatch(/Anna|Maria|Users/);
	});

	// BYL-E6-2437
	it('marks masked addresses and an address before a port, frames of a stack stay (FP-3b, R-A6, R-A7)', () => {
		expect(sanitizeProblemText('Mail an ***@example.com abgelehnt')).toBe(
			'Mail an [E-Mail] abgelehnt'
		);
		expect(sanitizeProblemText('SMTP anna@example.de:587 abgelehnt')).toBe(
			'SMTP [E-Mail]:587 abgelehnt'
		);
		for (const frame of [
			'run@b.js:3:4',
			'f@x.js.map:1:2',
			'g@app.mjs:1:2',
			'h@lib.cjs:1:2',
			'i@store.ts:10:2',
			'j@Page.svelte:4:5'
		]) {
			expect(sanitizeProblemText(frame), frame).toBe(frame);
		}
	});

	// BYL-E6-2437
	it('cuts a long input before the cleaning, without a cut word, in a few milliseconds (FP-3b, R-A8)', () => {
		expect(PROBLEM_INPUT_MAX).toBeGreaterThan(PROBLEM_TEXT_MAX * 10);
		// A cut word goes whole: the half of a secret or of a path never stays (`C:\Users\` here).
		const kept = 'x'.repeat(PROBLEM_INPUT_MAX - 10);
		expect(sanitizeProblemText(`${kept} C:\\Users\\Anna\\x.age geheim`, PROBLEM_INPUT_MAX)).toBe(
			kept
		);
		// A text of exactly the longest input is not cut.
		const full = `${'x'.repeat(PROBLEM_INPUT_MAX - 7)} geheim`;
		expect(sanitizeProblemText(full, PROBLEM_INPUT_MAX)).toBe(full);
		// Long words without "@" and "?" read the patterns once per start: the cut keeps that short.
		const rest = 'b'.repeat(200_000);
		for (const text of [
			'a'.repeat(200_000),
			`${'a'.repeat(PROBLEM_INPUT_MAX - 1)} ${rest}`,
			`${'/a'.repeat(PROBLEM_INPUT_MAX / 2 - 1)} ${rest}`,
			`${'x.'.repeat(PROBLEM_INPUT_MAX / 2 - 1)} ${rest}`
		]) {
			const start = performance.now();
			const clean = sanitizeProblemText(text);
			expect(performance.now() - start).toBeLessThan(50);
			expect(clean.length).toBeLessThanOrEqual(PROBLEM_TEXT_MAX);
			expect(clean).not.toContain('b');
		}
	});

	it('keeps name, message and at most ten lines of the stack of an exception', () => {
		const error = new TypeError('Unexpected token \'a\', "geheimer text" is not valid JSON');
		error.stack = [
			`TypeError: ${error.message}`,
			...Array.from({ length: 14 }, (_, index) => `    at f${index} (/_app/x.js?v=1:${index}:1)`)
		].join('\n');
		const exception = exceptionOf(error);
		expect(exception.name).toBe('TypeError');
		expect(exception.message).toBe('Unexpected token \'a\', "…" is not valid JSON');
		expect(exception.stack).toHaveLength(STACK_MAX_LINES);
		expect(exception.stack[0]).toBe('at f0 (/_app/x.js:0:1)');
	});

	it('reads the stacks of Firefox and Safari and values that are no errors', () => {
		expect(stackLines('render@http://127.0.0.1:8090/_app/a.js:1:2\nrun@b.js:3:4')).toEqual([
			'render@http://127.0.0.1:8090/_app/a.js:1:2',
			'run@b.js:3:4'
		]);
		expect(exceptionOf('kaputt')).toEqual({ name: 'Error', message: 'kaputt', stack: [] });
		expect(exceptionOf(42)).toEqual({ name: 'number', message: '', stack: [] });
	});
});

describe('the ring of the session', () => {
	it('puts a new problem first and keeps at most 100 entries', () => {
		let list: ProblemEntry[] = [];
		for (let index = 0; index < PROBLEM_LOG_MAX + 5; index += 1) {
			const next = entry({ id: `p-${index}`, intent: `Aktion ${index}`, at: AT + index });
			list = addProblem(list, next);
		}
		expect(list).toHaveLength(PROBLEM_LOG_MAX);
		expect(list[0]?.intent).toBe(`Aktion ${PROBLEM_LOG_MAX + 4}`);
		expect(list.at(-1)?.intent).toBe('Aktion 5');
	});

	it('counts the same problem in quick succession on its entry and moves it up', () => {
		let list = addProblem([], entry({ id: 'a' }));
		list = addProblem(list, entry({ id: 'b', intent: 'Ticket speichern', at: AT + 1000 }));
		list = addProblem(list, entry({ id: 'c', at: AT + 2000 }));
		list = addProblem(list, entry({ id: 'd', at: AT + 2000 + PROBLEM_MERGE_MS }));
		expect(list.map((item) => [item.id, item.count])).toEqual([
			['a', 3],
			['b', 1]
		]);
		expect(list[0]?.lastAt).toBe(AT + 2000 + PROBLEM_MERGE_MS);
		expect(list[0]?.at).toBe(AT);
	});

	it('starts a new entry after a pause or for another result', () => {
		let list = addProblem([], entry({ id: 'a' }));
		list = addProblem(list, entry({ id: 'b', at: AT + PROBLEM_MERGE_MS + 1 }));
		list = addProblem(
			list,
			entry({
				id: 'c',
				at: AT + PROBLEM_MERGE_MS + 2,
				outcome: { result: 'network', status: null, code: null, message: null }
			})
		);
		expect(list.map((item) => item.id)).toEqual(['c', 'b', 'a']);
	});
});

describe('stored form', () => {
	it('reads back what it stored', () => {
		const list = [entry(), { ...entry({ id: 'p-2' }), count: 2, lastAt: AT + 5 }];
		expect(parseStoredProblems(serializeProblems(list))).toEqual(list);
	});

	it('drops what is not an entry and survives broken storage', () => {
		expect(parseStoredProblems(null)).toEqual([]);
		expect(parseStoredProblems('{kaputt')).toEqual([]);
		expect(parseStoredProblems('{"a":1}')).toEqual([]);
		const good = entry();
		const stored = JSON.stringify([
			good,
			{ ...good, id: 7 },
			{ ...good, count: 0 },
			{ ...good, outcome: { ...good.outcome, result: 'other' } },
			{ ...good, request: { method: 'GET' } },
			{ ...good, exception: { name: 'E', message: 'm', stack: [1] } },
			{ ...good, source: 'browser' }
		]);
		expect(parseStoredProblems(stored)).toEqual([good]);
		expect(toProblemEntry({ ...good, serverId: 'srv1', correlation: 'req-1' })).toMatchObject({
			serverId: 'srv1',
			correlation: 'req-1'
		});
	});
});

describe('failed action or hint at an input', () => {
	it('takes refusals with only checks of inputs for hints', () => {
		expect(isInputValidation(['validation_required'])).toBe(true);
		expect(isInputValidation(['validation_required', 'validation_max_text_constraint'])).toBe(true);
		expect(isInputValidation(['validation_not_unique'])).toBe(true);
		// Checks of the form of an input in the hooks: "Titel fehlt", too long, a name.
		expect(isInputValidation(['validation_create_title'])).toBe(true);
		expect(isInputValidation(['validation_duplicate_title', 'validation_keywords'])).toBe(true);
		expect(isInputValidation(['validation_account_name_max'])).toBe(true);
	});

	// BYL-E6-2418
	it('takes a wrong current password of "Mein Konto" for a hint at its field (FP-3b)', () => {
		expect(INPUT_VALIDATION_CODES.has('validation_invalid_old_password')).toBe(true);
		expect(isInputValidation(['validation_invalid_old_password'])).toBe(true);
	});

	it('takes a refusal of a hook, a mix and an answer without fields for a failed action', () => {
		expect(isInputValidation(['validation_project_archived'])).toBe(false);
		// A limit of a list is a rule of the app, no check of one input.
		expect(isInputValidation(['validation_create_subtasks_max'])).toBe(false);
		expect(isInputValidation(['validation_required', 'validation_transfer_target'])).toBe(false);
		expect(isInputValidation([])).toBe(false);
	});

	it('reads the codes of the fields of an answer', () => {
		expect(
			fieldCodesOf({ data: { title: { code: 'validation_required' }, x: 'kein Code' } })
		).toEqual(['validation_required']);
		expect(fieldCodesOf(null)).toEqual([]);
	});
});

describe('noise of the window', () => {
	it('ignores a ResizeObserver loop, a foreign "Script error." and extensions', () => {
		const report = (message: string, filename = '', hasError = true) => ({
			message,
			filename,
			hasError
		});
		expect(isIgnorableGlobalError(report('ResizeObserver loop limit exceeded'))).toBe(true);
		expect(isIgnorableGlobalError(report('Script error.', '', false))).toBe(true);
		expect(isIgnorableGlobalError(report('x', 'chrome-extension://abc/content.js'))).toBe(true);
		expect(isIgnorableGlobalError(report('TypeError: x', 'http://127.0.0.1:8090/_app/a.js'))).toBe(
			false
		);
	});
});
