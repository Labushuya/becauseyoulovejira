// Pure rules of the mailbox selection (ADR-0016 section 6; E4 plan package 23).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
// The constants without the server of the helper, which needs its installed packages (AR-4).
import { DEFAULT_PORT, IMPORT_MAX, LIST_DEFAULT, LIST_MAX, PORT_ENV } from '../../helpers/mail/src/mailbox-limits.ts';

const rules = loadHookLib('mailbox-rules.js');

describe('mailbox-rules.js', () => {
	it('shares the limits and the port with the mail helper', () => {
		expect([rules.LIST_DEFAULT, rules.LIST_MAX, rules.IMPORT_MAX]).toEqual([LIST_DEFAULT, LIST_MAX, IMPORT_MAX]);
		expect([rules.DEFAULT_PORT, rules.PORT_ENV]).toEqual([DEFAULT_PORT, PORT_ENV]);
	});

	it('reads the limit of the list: 50 by default, 1 to 200', () => {
		expect(rules.parseLimit(undefined)).toEqual({ limit: 50 });
		expect(rules.parseLimit('')).toEqual({ limit: 50 });
		expect(rules.parseLimit('200')).toEqual({ limit: 200 });
		for (const value of ['0', '201', '1.5', '-1', 'x', '1000']) {
			expect(rules.parseLimit(value), value).toEqual({ error: expect.any(String) });
		}
	});

	it('reads 1 to 50 distinct UIDs', () => {
		expect(rules.parseUids([3, 1, 3])).toEqual({ uids: [3, 1] });
		for (const value of [[], Array.from({ length: 51 }, (_, i) => i + 1), [0], [1.5], ['1'], 'x', null]) {
			expect(rules.parseUids(value)).toEqual({ error: expect.any(String) });
		}
	});

	it('reaches the helper on 127.0.0.1 only', () => {
		expect(rules.helperUrl(undefined)).toBe('http://127.0.0.1:8091');
		expect(rules.helperUrl(' 9123 ')).toBe('http://127.0.0.1:9123');
		for (const value of ['0', '65536', 'example.com:80', 'x']) expect(rules.helperUrl(value)).toBe('');
	});

	it('takes only valid mails of a list answer with the fields for the duplicate key', () => {
		const items = rules.listItems({
			items: [
				{
					uid: 7,
					size: 1234,
					subject: 'Todo: Steuer',
					from: 'Bert <bert@example.com>',
					date: '2026-09-25 08:00:00.000Z',
					keyword: 'todo',
					title: 'Todo: Steuer',
					sourceRef: '<m@x>',
					sourceDate: '2026-09-25 08:00:00.000Z',
					sourceMeta: { from: 'Bert <bert@example.com>', owner: 'x' }
				},
				{ uid: 'x' },
				null,
				{ uid: 8 }
			]
		});
		expect(items).toEqual([
			{
				uid: 7,
				size: 1234,
				subject: 'Todo: Steuer',
				from: 'Bert <bert@example.com>',
				date: '2026-09-25 08:00:00.000Z',
				keyword: 'todo',
				draft: {
					channel: 'mail',
					kind: 'mail',
					title: 'Todo: Steuer',
					body: '',
					source_url: '',
					source_ref: '<m@x>',
					source_date: '2026-09-25 08:00:00.000Z',
					meta: { from: 'Bert <bert@example.com>' }
				}
			},
			{
				uid: 8,
				size: 0,
				subject: '',
				from: '',
				date: '',
				keyword: '',
				draft: { channel: 'mail', kind: 'mail', title: '', body: '', source_url: '', source_ref: '', source_date: '', meta: {} }
			}
		]);
		expect(rules.listItems(null)).toEqual([]);
	});

	it('takes only results for requested UIDs', () => {
		expect(
			rules.importItems(
				{
					items: [
						{ uid: 1, status: 'created', message: '' },
						{ uid: 2, status: 'weird', message: 'x' },
						{ uid: 9, status: 'created' }
					]
				},
				[1, 2]
			)
		).toEqual([
			{ uid: 1, status: 'created', message: '' },
			{ uid: 2, status: 'failed', message: 'x' }
		]);
	});

	it('maps refusals of the helper', () => {
		expect(rules.failure(401, {})).toMatchObject({ status: 503, message: expect.stringMatching(/BYL_INGEST_TOKEN/) });
		expect(rules.failure(404, { message: 'Keine eingeschaltete Mail-Verbindung.' })).toEqual({
			status: 404,
			message: 'Keine eingeschaltete Mail-Verbindung.',
			hint: ''
		});
		expect(rules.failure(502, { message: 'Anmeldung bei Web.de abgelehnt.', hint: 'POP3' })).toEqual({
			status: 502,
			message: 'Anmeldung bei Web.de abgelehnt.',
			hint: 'POP3'
		});
		expect(rules.failure(500, null)).toEqual({
			status: 502,
			message: 'Der Mail-Hilfsprozess antwortet mit HTTP 500.',
			hint: ''
		});
	});
});

describe('mailbox-rules.js: "Jetzt abrufen" and probe of a mailbox (package A)', () => {
	const zero = { created: 0, duplicates: 0, updated: 0, skipped: 0, failed: 0, unmatched: 0, error: '', missing: [] };

	it('passes on the counts of the helper in the shape of runConnection', () => {
		const answer = {
			statusCode: 200,
			json: { status: 'ok', created: 2, duplicates: 1, unmatched: 3, skipped: 0, failed: 1, error: '', missing: [] }
		};
		expect(rules.runResult(answer)).toEqual({ ...zero, status: 'ok', created: 2, duplicates: 1, unmatched: 3, failed: 1 });
		expect(rules.runResult({ statusCode: 200, json: { status: 'ok', created: -1, duplicates: 1.5, unmatched: 'x' } })).toEqual({
			...zero,
			status: 'ok'
		});
	});

	it('says that the helper does not run, and a timeout apart from that', () => {
		expect(rules.runResult({ unavailable: true })).toEqual({
			...zero,
			status: 'unavailable',
			error: `${rules.NOT_RUNNING} ${rules.NOT_RUNNING_HINT}`
		});
		expect(rules.runResult({ unavailable: true, timedOut: true })).toEqual({ ...zero, status: 'error', error: rules.RUN_TIMED_OUT });
		expect(rules.RUN_TIMEOUT_SECONDS).toBeGreaterThan(rules.TIMEOUT_SECONDS);
	});

	it('maps running, switched off, missing variables, errors and a wrong token', () => {
		expect(rules.runResult({ statusCode: 409, json: { status: 'running' } }).status).toBe('running');
		expect(rules.runResult({ statusCode: 404, json: { message: 'Keine eingeschaltete Mail-Verbindung.' } }).status).toBe(
			'disabled'
		);
		// A helper before 0.5.0 knows no /poll: not "pausiert", but the restart.
		expect(rules.runResult({ statusCode: 404, json: { message: 'Nicht gefunden.' } })).toMatchObject({
			status: 'error',
			error: rules.OUTDATED
		});
		expect(rules.OUTDATED).toMatch(/neu-starten\.bat/);
		expect(rules.runResult({ statusCode: 200, json: { status: 'gone' } }).status).toBe('disabled');
		expect(rules.runResult({ statusCode: 200, json: { status: 'missing', missing: ['BYL_WEBDE_PASSWORD', 'rm -rf', 7] } })).toEqual({
			...zero,
			status: 'missing',
			missing: ['BYL_WEBDE_PASSWORD']
		});
		expect(rules.runResult({ statusCode: 200, json: { status: 'error', error: 'Anmeldung bei Web.de abgelehnt.' } })).toEqual({
			...zero,
			status: 'error',
			error: 'Anmeldung bei Web.de abgelehnt.'
		});
		expect(rules.runResult({ statusCode: 200, json: { status: 'seltsam' } })).toMatchObject({ status: 'error', error: 'Der Abruf ist fehlgeschlagen.' });
		expect(rules.runResult({ statusCode: 401, json: {} })).toMatchObject({ status: 'error', error: rules.TOKEN_REFUSED });
		expect(rules.runResult({ statusCode: 502, json: { message: 'PocketBase nicht erreichbar.' } })).toMatchObject({
			status: 'error',
			error: 'PocketBase nicht erreichbar.'
		});
		expect(rules.runResult({ statusCode: 500, json: null })).toMatchObject({ error: 'Der Mail-Hilfsprozess antwortet mit HTTP 500.' });
	});

	it('reads the probe: running with version, stopped, other token', () => {
		expect(rules.helperStatus({ statusCode: 200, json: { ok: true, version: '0.5.0', busy: false } })).toEqual({
			state: 'running',
			version: '0.5.0',
			message: ''
		});
		expect(rules.helperStatus({ unavailable: true })).toEqual({ state: 'stopped', version: '', message: rules.NOT_RUNNING });
		expect(rules.helperStatus({ statusCode: 401, json: {} })).toEqual({ state: 'refused', version: '', message: rules.TOKEN_REFUSED });
		expect(rules.helperStatus({ statusCode: 404, json: {} })).toMatchObject({ state: 'stopped' });
		expect(rules.helperStatus({ statusCode: 404, json: { message: 'Nicht gefunden.' } })).toEqual({
			state: 'outdated',
			version: '',
			message: rules.OUTDATED
		});
		expect(rules.HEALTH_TIMEOUT_SECONDS).toBeLessThanOrEqual(5);
	});
});

describe('mailbox-rules.js: "Posteingang neu durchsuchen" and "Abbrechen" (full inbox)', () => {
	it('takes only start and cancel', () => {
		expect(rules.parseScanAction('start')).toEqual({ action: 'start' });
		expect(rules.parseScanAction('cancel')).toEqual({ action: 'cancel' });
		for (const value of [undefined, '', 'START', 'neu', 1]) {
			expect(rules.parseScanAction(value), String(value)).toEqual({ error: expect.any(String) });
		}
	});

	it('maps the answers of the helper', () => {
		expect(rules.scanResult({ statusCode: 202, json: { status: 'started' } })).toEqual({ status: 'started', message: '' });
		expect(rules.scanResult({ statusCode: 409, json: { status: 'running' } })).toEqual({
			status: 'running',
			message: rules.SCAN_RUNNING
		});
		expect(rules.scanResult({ statusCode: 200, json: { status: 'cancelling' } })).toEqual({ status: 'cancelling', message: '' });
		expect(rules.scanResult({ statusCode: 200, json: { status: 'idle' } })).toEqual({ status: 'idle', message: '' });
		expect(rules.scanResult({ unavailable: true })).toEqual({
			status: 'unavailable',
			message: `${rules.NOT_RUNNING} ${rules.NOT_RUNNING_HINT}`
		});
		expect(rules.scanResult({ statusCode: 404, json: { message: 'Nicht gefunden.' } })).toEqual({
			status: 'error',
			message: rules.SCAN_OUTDATED
		});
		expect(rules.scanResult({ statusCode: 404, json: { message: 'Keine eingeschaltete Mail-Verbindung.' } })).toEqual({
			status: 'disabled',
			message: rules.DISABLED
		});
		expect(rules.scanResult({ statusCode: 401, json: {} })).toEqual({ status: 'error', message: rules.TOKEN_REFUSED });
		expect(rules.scanResult({ statusCode: 400, json: { message: 'action muss start oder cancel sein.' } })).toEqual({
			status: 'error',
			message: 'action muss start oder cancel sein.'
		});
		expect(rules.scanResult({ statusCode: 200, json: { status: 'seltsam' } })).toMatchObject({ status: 'error' });
		expect(rules.SCAN_TIMEOUT_SECONDS).toBeLessThanOrEqual(10);
	});
});
