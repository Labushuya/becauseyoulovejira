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

	it('keeps the params of a field error (duplicate in the inbox, E4 plan, package 2)', () => {
		const error = toDataError(
			responseError(400, {
				fingerprint: {
					code: 'validation_inbox_duplicate',
					message: 'Schon Ticket HAUS-2.',
					params: { state: 'converted', ticketKey: 'HAUS-2' }
				},
				source_item: { code: 'validation_scope_mismatch', message: 'x', params: 'no object' }
			})
		);

		expect(error.fields).toEqual({
			fingerprint: {
				code: 'validation_inbox_duplicate',
				message: 'Schon im Eingang.',
				params: { state: 'converted', ticketKey: 'HAUS-2' }
			},
			source_item: {
				code: 'validation_scope_mismatch',
				message: 'Der Eintrag ist nicht verfügbar.'
			}
		});
	});

	it('has the texts of the recurrence codes and names the open ticket (E5 plan, package 4)', () => {
		const error = toDataError(
			responseError(400, {
				status: {
					code: 'validation_recurrence_open_instance',
					message: 'x',
					params: { key: 'HAUS-12', ticket: 'ticket000000001' }
				},
				weekdays: { code: 'validation_recurrence_weekdays', message: 'x' },
				ticket: { code: 'validation_recurrence_ticket_linked', message: 'x' }
			})
		);

		expect(error.fields.status?.message).toBe(
			'Von dieser Serie ist schon HAUS-12 offen. Erledige es zuerst oder löse ein Ticket aus der Serie.'
		);
		expect(error.fields.weekdays?.message).toBe('Bitte mindestens einen Wochentag wählen.');
		expect(error.fields.ticket?.message).toBe('Das Ticket gehört schon zu einer Serie.');
	});

	it('has German texts for the project and tag codes, some per field (E3 plan, package 3)', () => {
		const error = toDataError(
			responseError(400, {
				code: { code: 'validation_project_in_use', message: 'x' },
				id: { code: 'validation_project_in_use', message: 'x' },
				household: { code: 'validation_project_in_use', message: 'x' },
				project: { code: 'validation_project_archived', message: 'x' },
				name: { code: 'validation_not_unique', message: 'Value must be unique.' },
				scope: { code: 'validation_reserved_code', message: 'x' },
				owner: { code: 'validation_invalid_format', message: 'x' }
			})
		);

		expect(error.fields).toEqual({
			code: {
				code: 'validation_project_in_use',
				message: 'Der Code bleibt fest, weil Tickets das Projekt verwenden.'
			},
			id: {
				code: 'validation_project_in_use',
				message: 'Ein Projekt mit Tickets lässt sich nicht löschen. Bitte archivieren.'
			},
			household: {
				code: 'validation_project_in_use',
				message: 'Das Projekt wird von Tickets verwendet.'
			},
			project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' },
			name: { code: 'validation_not_unique', message: 'Schon vergeben.' },
			scope: { code: 'validation_reserved_code', message: 'Der Code TASK ist reserviert.' },
			owner: { code: 'validation_invalid_format', message: 'Ungültiges Format.' }
		});
		expect(
			toDataError(responseError(400, { code: { code: 'validation_invalid_format' } })).fields.code
				?.message
		).toBe('Nur 2 bis 6 Großbuchstaben (A–Z).');
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
