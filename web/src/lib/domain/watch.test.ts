// Status of a watched source (ADR-0050 §5, ADR-0031 addendum I): read strictly from
// inbox_items.watch, said as a lozenge without red and as a sentence.

import { describe, expect, it } from 'vitest';
import { WATCH_LABELS, WATCH_LOZENGES, watchOf, watchText } from './watch';

describe('watchOf', () => {
	it('reads the status of a file and of a pull request', () => {
		expect(watchOf({ kind: 'file', state: 'current' })).toEqual({
			kind: 'file',
			state: 'current',
			since: null
		});
		expect(watchOf({ kind: 'file', state: 'changed', since: '2026-10-02 12:05:00.000Z' })).toEqual({
			kind: 'file',
			state: 'changed',
			since: '2026-10-02T12:05:00.000Z'
		});
		expect(watchOf({ kind: 'pull', state: 'merged', since: '2026-10-02T12:05:00Z' })).toEqual({
			kind: 'pull',
			state: 'merged',
			since: '2026-10-02T12:05:00.000Z'
		});
	});

	it('gives null for none or anything unknown', () => {
		for (const value of [
			null,
			undefined,
			'',
			[],
			{},
			{ kind: 'file', state: 'merged' },
			{ kind: 'pull', state: 'current' },
			{ kind: 'release', state: 'open' }
		]) {
			expect(watchOf(value), JSON.stringify(value)).toBeNull();
		}
		expect(watchOf({ kind: 'file', state: 'gone', since: 'gestern' })).toEqual({
			kind: 'file',
			state: 'gone',
			since: null
		});
	});
});

describe('the status in words', () => {
	it('never shows red', () => {
		for (const look of Object.values(WATCH_LOZENGES)) {
			expect(look.tone).not.toBe('danger');
		}
		expect(WATCH_LABELS.changed).toBe('Seit Import geändert');
	});

	it('says the time of the change in Berlin time', () => {
		expect(watchText({ kind: 'file', state: 'current', since: null })).toBe(
			'Unverändert seit dem Import'
		);
		expect(watchText({ kind: 'file', state: 'changed', since: '2026-10-02T12:05:00.000Z' })).toBe(
			'Seit Import erneut geändert (zuletzt am 02.10.2026 14:05)'
		);
		expect(watchText({ kind: 'file', state: 'gone', since: '2026-10-02T12:05:00.000Z' })).toBe(
			'Nicht mehr vorhanden (seit 02.10.2026 14:05)'
		);
		expect(watchText({ kind: 'pull', state: 'open', since: null })).toBe('PR offen');
		expect(watchText({ kind: 'pull', state: 'merged', since: '2026-10-02T12:05:00.000Z' })).toBe(
			'PR gemergt (am 02.10.2026 14:05)'
		);
		expect(watchText({ kind: 'pull', state: 'closed', since: null })).toBe('PR geschlossen');
	});
});
