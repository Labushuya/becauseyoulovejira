// Pure rules of the outbox at the server (OF-1, ADR-0074): the form of the identifier of an action,
// the bounds of the time of the device, the expected values of a conditional change, the conflicts per
// field, a second request under the same identifier, the retention of the notes and the capability.
// The actions are the same as the values of client_ops.kind in the migration.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('client-ops-rules.js');
const history = loadHookLib('history.js');

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const MIGRATION = join(ROOT_DIR, 'app', 'pb_migrations', '1790205000_client_ops.js');

const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const iso = (ms) => new Date(ms).toISOString();
const stored = (ms) => iso(ms).replace('T', ' ');

describe('the identifier of an action', () => {
	it('takes 16 to 64 letters, digits, "_" and "-", and nothing without one', () => {
		expect(rules.opOf(undefined)).toEqual({ op: '', code: '' });
		expect(rules.opOf(null)).toEqual({ op: '', code: '' });
		expect(rules.opOf('')).toEqual({ op: '', code: '' });
		for (const op of ['abcdefghij0123456789', 'a'.repeat(16), 'A-b_C'.padEnd(64, 'x')]) {
			expect(rules.opOf(op), op).toEqual({ op, code: '' });
		}
		for (const op of ['a'.repeat(15), 'a'.repeat(65), 'abcdefghij 0123456789', 'abcdefghij012345678ä', 12345678901234567, {}, ['x']]) {
			expect(rules.opOf(op), String(op)).toEqual({ op: '', code: 'validation_op_invalid' });
		}
	});

	it('names the six actions of the first stage, the same as the values of client_ops.kind', () => {
		expect(rules.KINDS).toEqual(['ticket.create', 'ticket.update', 'comment.create', 'inbox.create', 'dayplan.check', 'dayplan.uncheck']);
		const source = readFileSync(MIGRATION, 'utf8');
		const match = source.match(/var KINDS = (\[[^\]]+\]);/);
		expect(match).not.toBeNull();
		expect(JSON.parse(match[1].replace(/'/g, '"'))).toEqual([...rules.KINDS]);
		expect(rules.isKind('ticket.update')).toBe(true);
		expect(rules.isKind('ticket.delete')).toBe(false);
	});
});

describe('the time of the device', () => {
	it('keeps a time between 48 hours back and 5 minutes ahead, both included, in the stored form', () => {
		for (const ms of [NOW, NOW - HOUR, NOW - 48 * HOUR, NOW + 5 * MINUTE, NOW + 4 * MINUTE]) {
			expect(rules.deviceTimeOf(iso(ms), NOW), iso(ms)).toBe(stored(ms));
		}
		expect(rules.DEVICE_FUTURE_MS).toBe(5 * MINUTE);
		expect(rules.DEVICE_PAST_MS).toBe(48 * HOUR);
	});

	it('drops a time further ahead or further back', () => {
		for (const ms of [NOW + 5 * MINUTE + 1, NOW + 10 * MINUTE, NOW - 48 * HOUR - 1, NOW - 72 * HOUR]) {
			expect(rules.deviceTimeOf(iso(ms), NOW), iso(ms)).toBe('');
		}
	});

	it('reads offsets, a space instead of "T" and missing seconds, and drops anything else', () => {
		expect(rules.deviceTimeOf('2026-10-20T13:30:00+02:00', NOW)).toBe('2026-10-20 11:30:00.000Z');
		expect(rules.deviceTimeOf('2026-10-20 11:30:15.250Z', NOW)).toBe('2026-10-20 11:30:15.250Z');
		expect(rules.deviceTimeOf('2026-10-20T11:30Z', NOW)).toBe('2026-10-20 11:30:00.000Z');
		expect(rules.deviceTimeOf('2026-10-20T07:30:00-04:30', NOW)).toBe('2026-10-20 12:00:00.000Z');
		for (const raw of [
			'gestern',
			'2026-10-20',
			'2026-10-20T11:30:00',
			'2026-02-30T11:30:00Z',
			'2026-13-01T11:30:00Z',
			'2026-10-20T24:00:00Z',
			'2026-10-20T11:60:00Z',
			'2026-10-20T11:30:00+15:00',
			`2026-10-20T11:30:00.${'1'.repeat(40)}Z`,
			NOW,
			null,
			undefined,
			{}
		]) {
			expect(rules.deviceTimeOf(raw, NOW), String(raw)).toBe('');
		}
	});

	it('marks a body from the outbox with offline: true or any client_at, and keeps only a valid time', () => {
		expect(rules.offlineOf({}, NOW)).toEqual({ offline: false, deviceAt: '' });
		expect(rules.offlineOf(null, NOW)).toEqual({ offline: false, deviceAt: '' });
		expect(rules.offlineOf({ offline: false }, NOW)).toEqual({ offline: false, deviceAt: '' });
		expect(rules.offlineOf({ offline: 'true' }, NOW)).toEqual({ offline: false, deviceAt: '' });
		// "Trotzdem übertragen" after 48 hours comes without a time.
		expect(rules.offlineOf({ offline: true }, NOW)).toEqual({ offline: true, deviceAt: '' });
		expect(rules.offlineOf({ client_at: iso(NOW - HOUR) }, NOW)).toEqual({ offline: true, deviceAt: stored(NOW - HOUR) });
		expect(rules.offlineOf({ offline: true, client_at: iso(NOW - 49 * HOUR) }, NOW)).toEqual({ offline: true, deviceAt: '' });
		expect(rules.offlineOf({ client_at: 'gestern' }, NOW)).toEqual({ offline: true, deviceAt: '' });
	});
});

describe('the expected values of a conditional change', () => {
	const fields = history.TRACKED_FIELDS;

	it('takes an object of known fields with values the history knows', () => {
		expect(rules.expectedViolation(undefined, fields)).toBe('');
		expect(rules.expectedViolation(null, fields)).toBe('');
		expect(rules.expectedViolation({ status: 'open', due: '' }, fields)).toBe('');
		expect(rules.expectedViolation({ tags: ['a', 'b'], blocks_parent: true, priority: null }, fields)).toBe('');
		expect(rules.expectedViolation({ description: 'x'.repeat(100000) }, fields)).toBe('');
	});

	it('refuses anything else', () => {
		for (const expected of [
			{},
			[],
			'open',
			{ unknown: 'x' },
			{ owner: 'abc' },
			{ status: { value: 'open' } },
			{ tags: [1, 2] },
			{ description: 'x'.repeat(100001) },
			{ due: Number.NaN }
		]) {
			expect(rules.expectedViolation(expected, fields), JSON.stringify(expected)).toBe('validation_expected_invalid');
		}
	});

	it('finds a conflict only where the stored value is neither the expected nor the desired one', () => {
		const expected = { status: 'open', due: '2026-10-20 00:00:00.000Z' };
		// Nobody changed anything.
		expect(rules.conflictsOf(expected, { status: 'open', due: expected.due }, { status: 'done', due: '' })).toEqual([]);
		// Someone else did the same.
		expect(rules.conflictsOf(expected, { status: 'done', due: '' }, { status: 'done', due: '' })).toEqual([]);
		// Someone else changed the status to something else: a conflict at the status only.
		expect(rules.conflictsOf(expected, { status: 'waiting', due: expected.due }, { status: 'done', due: '' })).toEqual([
			{ field: 'status', expected: 'open', actual: 'waiting' }
		]);
		// Both fields changed by someone else.
		expect(
			rules.conflictsOf(expected, { status: 'waiting', due: '2026-10-21 00:00:00.000Z' }, { status: 'done', due: '' })
		).toEqual([
			{ field: 'status', expected: 'open', actual: 'waiting' },
			{ field: 'due', expected: expected.due, actual: '2026-10-21 00:00:00.000Z' }
		]);
		// A field the action does not name never conflicts.
		expect(rules.conflictsOf({ status: 'open' }, { status: 'open', priority: 'urgent' }, { status: 'done', priority: 'low' })).toEqual([]);
		expect(rules.conflictsOf(undefined, {}, {})).toEqual([]);
	});

	it('words a conflict per field, with the catalog for every other field', () => {
		expect(rules.conflictText('status')).toBe('Der Status wurde inzwischen geändert.');
		expect(rules.conflictText('due')).toBe('Die Fälligkeit wurde inzwischen geändert.');
		expect(rules.conflictText('checked')).toBe(rules.MESSAGES.validation_dayplan_conflict);
		expect(rules.conflictText('charm')).toBe(rules.MESSAGES.validation_ticket_conflict);
		expect(rules.conflictText('constructor')).toBe(rules.MESSAGES.validation_ticket_conflict);
		expect(rules.CONFLICT_MESSAGE).toBe('Das Ticket wurde inzwischen geändert.');
	});
});

describe('a second request under the same identifier', () => {
	it('is the same action only for the same kind and, when it names one, the same record', () => {
		const claim = { kind: 'ticket.update', record: 'abcdefghijklmno' };
		expect(rules.replayOf(claim, 'ticket.update', 'abcdefghijklmno')).toBe('replay');
		expect(rules.replayOf(claim, 'ticket.update', '')).toBe('replay');
		expect(rules.replayOf(claim, 'ticket.update', 'onmlkjihgfedcba')).toBe('reused');
		expect(rules.replayOf(claim, 'comment.create', '')).toBe('reused');
		expect(rules.replayOf(null, 'ticket.update', '')).toBe('reused');
	});
});

describe('the notes and the capability', () => {
	it('keeps a note 30 days', () => {
		expect(rules.RETENTION_DAYS).toBe(30);
		expect(rules.retentionCutoff(NOW)).toBe('2026-09-20 12:00:00.000Z');
	});

	it('names version and actions once client_ops exists, null before', () => {
		expect(rules.capabilityOf(true)).toEqual({ version: 1, kinds: [...rules.KINDS] });
		expect(rules.capabilityOf(false)).toBeNull();
	});

	it('has a text for every code of the catalog', () => {
		expect(Object.keys(rules.MESSAGES).sort()).toEqual([
			'validation_dayplan_conflict',
			'validation_expected_invalid',
			'validation_op_applied',
			'validation_op_invalid',
			'validation_op_reused',
			'validation_ticket_conflict'
		]);
		for (const text of Object.values(rules.MESSAGES)) expect(text).toMatch(/^[A-ZÄÖÜ].+\.$/);
	});
});
