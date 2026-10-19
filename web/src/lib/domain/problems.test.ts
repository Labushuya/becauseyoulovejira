// Entries of failed actions (FP-1, ADR-0071): the plain-text report without bodies, queries,
// tokens and headers, the cleaning of texts, the ring of the session with merging, the stored form
// and the line between a failed action and a hint at an input.

import { describe, expect, it } from 'vitest';
import {
	PROBLEM_LOG_MAX,
	PROBLEM_MERGE_MS,
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
	});

	it('takes a refusal of a hook, a mix and an answer without fields for a failed action', () => {
		expect(isInputValidation(['validation_project_archived'])).toBe(false);
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
