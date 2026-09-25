// Pure rules of the mailbox selection (ADR-0016 section 6; E4 plan package 23).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { DEFAULT_PORT, IMPORT_MAX, LIST_DEFAULT, LIST_MAX, PORT_ENV } from '../../helpers/mail/src/server.ts';

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
