// The entry behind "Details" of a message (FP-1, ADR-0071): `problemOf` in data/errors.ts with the
// request the client noted, the intent of an action or of the catalog, the outcome of the SDK
// error, the line to the hints at inputs, aborted requests and unexpected exceptions.

import { ClientResponseError } from 'pocketbase';
import { afterEach, describe, expect, it } from 'vitest';
import { problemReport, type ProblemEntry } from '../domain/problems';
import {
	DataError,
	noteRequest,
	problemOf,
	provideAppVersion,
	toDataError,
	unexpectedProblem,
	withIntent
} from './errors';

const URL_BASE = 'http://127.0.0.1:8090';

function sdkError(status: number, path: string, response: Record<string, unknown> = {}) {
	return new ClientResponseError({ url: `${URL_BASE}${path}`, status, response });
}

/** A failure as the client of the app hands it on: the SDK error with its noted request. */
function failed(method: string, path: string, status: number, response = {}) {
	const error = sdkError(status, path, response);
	noteRequest(error, method, path);
	return error;
}

afterEach(() => provideAppVersion(null));

describe('problemOf', () => {
	it('names intent, request and answer of a failed request of the client', () => {
		provideAppVersion('1792421233406');
		const path = '/api/byl/tickets/abc123def456789/subtasks/transfer';
		const failure = toDataError(
			failed('post', path, 409, { message: 'Das Hauptticket wurde inzwischen geändert.' })
		);
		const problem = problemOf(failure);
		expect(problem).toMatchObject({
			source: 'client',
			intent: 'Unteraufgaben übertragen',
			at: failure.occurredAt,
			count: 1,
			outcome: {
				result: 'response',
				status: 409,
				code: null,
				message: 'Das Hauptticket wurde inzwischen geändert.'
			},
			request: { method: 'POST', path },
			app: '1792421233406',
			exception: null,
			serverId: null,
			correlation: null
		});
	});

	it('says "Keine Verbindung zum Server" for a request without an answer and keeps its path', () => {
		const error = new ClientResponseError(new TypeError('Failed to fetch'));
		noteRequest(error, 'PATCH', '/api/collections/tickets/records/abc123def456789?expand=x');
		const problem = problemOf(toDataError(error));
		expect(problem?.intent).toBe('Ticket speichern');
		expect(problem?.outcome).toEqual({
			result: 'network',
			status: null,
			code: null,
			message: null
		});
		expect(problem?.request).toEqual({
			method: 'PATCH',
			path: '/api/collections/tickets/records/abc123def456789'
		});
	});

	it('takes the intent an action names, the outermost first', async () => {
		const error = failed('POST', '/api/collections/connections/records', 500);
		const thrown = await withIntent('Telegram verbinden', () =>
			withIntent('Kanal anlegen', async () => {
				throw toDataError(error);
			})
		).catch((caught: unknown) => caught);
		expect(problemOf(thrown)?.intent).toBe('Telegram verbinden');
	});

	it('falls back to the path of the answer and to "Unbekannte Aktion"', () => {
		const problem = problemOf(toDataError(sdkError(500, '/api/byl/erfunden?token=geheim')));
		expect(problem?.request).toEqual({ method: null, path: '/api/byl/erfunden' });
		expect(problem?.intent).toBe('Unbekannte Aktion');
		expect(problemReport(problem as ProblemEntry)).not.toContain('geheim');
	});

	it('gives the same entry for the same error, so the list takes it once', () => {
		const failure = toDataError(failed('GET', '/api/byl/trash', 500));
		expect(problemOf(failure)).toBe(problemOf(failure));
		expect(problemOf(failure)?.id).toMatch(/^p-/);
	});
});

describe('failed action or hint at an input', () => {
	it('gives no entry for a refusal that only checks inputs', () => {
		const failure = toDataError(
			failed('POST', '/api/collections/projects/records', 400, {
				data: { code: { code: 'validation_not_unique', message: 'Value must be unique.' } }
			})
		);
		expect(failure.kind).toBe('validation');
		expect(problemOf(failure)).toBeNull();
	});

	it('gives an entry with the code for a refusal of a hook', () => {
		const failure = toDataError(
			failed('PATCH', '/api/collections/tickets/records/abc123def456789', 400, {
				message: 'Failed to update record.',
				data: { project: { code: 'validation_project_archived', message: 'Archiviert.' } }
			})
		);
		expect(problemOf(failure)?.outcome).toEqual({
			result: 'response',
			status: 400,
			code: 'project: validation_project_archived',
			message: 'Failed to update record.'
		});
	});

	it('gives no entry for an aborted request or nothing thrown', () => {
		const aborted = new ClientResponseError({ isAbort: true });
		expect(problemOf(aborted)).toBeNull();
		expect(problemOf(toDataError(aborted))).toBeNull();
		const signal = AbortSignal.abort();
		expect(problemOf(toDataError(failed('GET', '/api/byl/trash', 500), signal))).toBeNull();
		expect(problemOf(null)).toBeNull();
		expect(problemOf('kaputt')).toBeNull();
	});
});

describe('unexpected exceptions', () => {
	it('keeps name, message and stack of an exception behind a failure', () => {
		const exception = new TypeError("Cannot read properties of undefined (reading 'key')");
		const problem = problemOf(toDataError(exception));
		expect(problem?.outcome.result).toBe('exception');
		expect(problem?.exception?.name).toBe('TypeError');
		expect(problem?.exception?.message).toBe(exception.message);
		expect(problem?.exception?.stack.length).toBeGreaterThan(0);
		expect(problem?.intent).toBe('Unbekannte Aktion');
	});

	it('takes a failure of the data layer itself for an unreadable answer', () => {
		expect(problemOf(new DataError('server'))?.outcome.result).toBe('answer');
		expect(problemOf(new DataError('network'))?.outcome.result).toBe('network');
	});

	it('names what nobody caught "Unerwarteter Fehler"', () => {
		expect(unexpectedProblem(new RangeError('zu weit'))).toMatchObject({
			intent: 'Unerwarteter Fehler',
			outcome: { result: 'exception' },
			exception: { name: 'RangeError', message: 'zu weit' },
			request: null
		});
		expect(unexpectedProblem('nur Text')?.exception).toEqual({
			name: 'Error',
			message: 'nur Text',
			stack: []
		});
		const failure = toDataError(failed('POST', '/api/byl/trash/empty', 500));
		expect(unexpectedProblem(failure)).toMatchObject({
			intent: 'Unerwarteter Fehler',
			request: { method: 'POST', path: '/api/byl/trash/empty' }
		});
		expect(unexpectedProblem(new ClientResponseError({ isAbort: true }))).toBeNull();
	});
});
