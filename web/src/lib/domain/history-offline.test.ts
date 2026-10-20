// The mark of a change from the outbox in the history (OF-2, ADR-0074 §4): the time of the device
// always "laut Gerät" next to the time of the server, the date of another day named; without an
// accepted time only "offline geändert"; every other entry keeps its form.

import { describe, expect, it } from 'vitest';
import { describeHistoryEntry, historyLookups, offlineHistoryText } from './history-format';
import type { HistoryEntry } from './ticket';

const ENTRY: HistoryEntry = {
	id: 'h1',
	ticket: 'tick00000000001',
	field: 'status',
	oldValue: 'open',
	newValue: 'done',
	user: 'user00000000001',
	created: '2026-10-20 12:30:00.000Z'
};

function text(deviceAt: string | null): string {
	return offlineHistoryText({ created: ENTRY.created, deviceAt });
}

describe('offline in the history', () => {
	it('names the time of the device of the same day and the time of the server', () => {
		expect(text('2026-10-20 12:03:00.000Z')).toBe(
			'offline um 14:03 (laut Gerät), abgeglichen um 14:30'
		);
	});

	it('names the date of a time of the device on another day', () => {
		expect(text('2026-10-18 20:15:00.000Z')).toBe(
			'offline am 18.10.2026 um 22:15 (laut Gerät), abgeglichen um 14:30'
		);
	});

	it('says only "offline geändert" without an accepted time of the device', () => {
		expect(text(null)).toBe('offline geändert, abgeglichen um 14:30');
	});

	it('marks only entries of the outbox', () => {
		const lookups = historyLookups([], []);
		expect(describeHistoryEntry(ENTRY, lookups, null)).not.toHaveProperty('offline');
		const marked = { ...ENTRY, offline: true as const, deviceAt: '2026-10-20 12:03:00.000Z' };
		const line = describeHistoryEntry(marked, lookups, null);
		expect(line.offline).toBe('offline um 14:03 (laut Gerät), abgeglichen um 14:30');
	});
});
