// Error kinds of the data layer (ADR-0006 section 4, E2 plan package 4).

import { ClientResponseError } from 'pocketbase';
import { describe, expect, it } from 'vitest';
import { DATA_ERROR_MESSAGES, DataError, isDataError, toDataError, withDataErrors } from './errors';

function responseError(status: number, data: Record<string, unknown> = {}) {
	return new ClientResponseError({
		url: 'http://pb.test/api/collections/tickets/records',
		status,
		response: { status, message: 'Error', data }
	});
}

describe('toDataError', () => {
	it.each([
		[401, 'session'],
		[403, 'forbidden'],
		[404, 'not_found'],
		[500, 'server'],
		[502, 'server'],
		[429, 'server']
	])('maps status %i to "%s"', (status, kind) => {
		const error = toDataError(responseError(status));

		expect(error.kind).toBe(kind);
		expect(error.status).toBe(status);
		expect(error.message).toBe(DATA_ERROR_MESSAGES[error.kind]);
	});

	it('maps a missing response (status 0) to "network"', () => {
		const error = toDataError(new ClientResponseError(new TypeError('fetch failed')));

		expect(error.kind).toBe('network');
		expect(error.status).toBe(0);
	});

	it('maps an aborted request to "aborted", not "network"', () => {
		const abort = new DOMException('The operation was aborted.', 'AbortError');

		expect(toDataError(new ClientResponseError(abort)).kind).toBe('aborted');
		expect(toDataError(abort).kind).toBe('aborted');
	});

	it('treats any failure after the signal was aborted as "aborted"', () => {
		const controller = new AbortController();
		controller.abort(new Error('custom reason'));

		const error = toDataError(
			new ClientResponseError(new Error('custom reason')),
			controller.signal
		);

		expect(error.kind).toBe('aborted');
	});

	it('maps a 400 with field errors to "validation" with German field messages', () => {
		const error = toDataError(
			responseError(400, {
				title: { code: 'validation_required', message: 'Cannot be blank.' },
				due: { code: 'validation_calendar_date', message: 'Must be a calendar date.' },
				body: { code: 'validation_something_new', message: 'Whatever.' }
			})
		);

		expect(error.kind).toBe('validation');
		expect(error.fields).toEqual({
			title: { code: 'validation_required', message: 'Pflichtfeld.' },
			due: { code: 'validation_calendar_date', message: 'Ungültiges Datum.' },
			body: { code: 'validation_something_new', message: 'Ungültige Eingabe.' }
		});
		expect(Object.isFrozen(error.fields)).toBe(true);
	});

	it('maps a 400 without field errors (e.g. a failed create rule) to "server"', () => {
		const error = toDataError(responseError(400));

		expect(error.kind).toBe('server');
		expect(error.fields).toEqual({});
	});

	it('recognises errors by structure, e.g. from another copy of the SDK', () => {
		const foreign = {
			status: 400,
			isAbort: false,
			response: { data: { title: { code: 'validation_required', message: 'x' } } }
		};

		expect(toDataError(foreign).kind).toBe('validation');
		expect(toDataError({ status: 0, isAbort: true, response: {} }).kind).toBe('aborted');
		expect(toDataError({ status: 404, response: {} }).kind).toBe('not_found');
	});

	it('maps unknown failures to "server" and keeps the cause', () => {
		const cause = new RangeError('Unknown status: archived');
		const error = toDataError(cause);

		expect(error.kind).toBe('server');
		expect(error.cause).toBe(cause);
		expect(toDataError('text').kind).toBe('server');
		expect(toDataError(null).kind).toBe('server');
	});

	it('passes a DataError through unchanged', () => {
		const original = new DataError('session');

		expect(toDataError(original)).toBe(original);
		expect(isDataError(original)).toBe(true);
		expect(isDataError(new Error('x'))).toBe(false);
	});

	it('has a German text for every kind, without naming PocketBase', () => {
		for (const text of Object.values(DATA_ERROR_MESSAGES)) {
			expect(text).not.toBe('');
			expect(text).not.toMatch(/PocketBase/i);
		}
	});
});

describe('withDataErrors', () => {
	it('returns the result of a successful call', async () => {
		await expect(withDataErrors(undefined, async () => 42)).resolves.toBe(42);
	});

	it('turns a failure into a DataError', async () => {
		await expect(
			withDataErrors(undefined, async () => {
				throw responseError(404);
			})
		).rejects.toMatchObject({ name: 'DataError', kind: 'not_found' });
	});
});
