// Rules of "Verwerfen (n)" and "Wiederherstellen (n)" in the inbox (EG-1, ADR-0014 addendum EG-1):
// which entry an action applies to, why it skips the others, and the words of progress and result.

import { describe, expect, it } from 'vitest';
import {
	bulkFailureTitle,
	bulkOfflineText,
	bulkProgressText,
	bulkResultTitle,
	bulkSkipReason,
	bulkSkippedTitle,
	BULK_OFFLINE_HINT
} from './inbox-bulk';

describe('rules of several entries at once (EG-1)', () => {
	it('discards only new entries and restores only discarded ones; the others get a reason', () => {
		expect(bulkSkipReason('discard', 'new')).toBeNull();
		expect(bulkSkipReason('discard', 'discarded')).toBe('Schon verworfen.');
		expect(bulkSkipReason('discard', 'converted')).toBe('Schon verknüpft.');
		expect(bulkSkipReason('discard', null)).toBe('Nicht mehr neu.');
		expect(bulkSkipReason('restore', 'discarded')).toBeNull();
		expect(bulkSkipReason('restore', 'new')).toBe('Schon im Eingang.');
		expect(bulkSkipReason('restore', 'converted')).toBe('Verknüpft, nicht verworfen.');
		expect(bulkSkipReason('restore', null)).toBe('Nicht mehr verworfen.');
	});

	it('words the progress, the flag and the lists of the result', () => {
		expect(bulkProgressText({ label: 'Verwerfen', total: 3, done: 1 })).toBe(
			'Verwerfen: 1 von 3 Einträgen'
		);
		expect(bulkProgressText({ label: 'Rückgängig', total: 1, done: 0 })).toBe(
			'Rückgängig: 0 von 1 Eintrag'
		);
		expect(bulkResultTitle({ total: 3, done: 3, skipped: 0, failed: 0 }, 'verworfen')).toBe(
			'3 Einträge verworfen.'
		);
		expect(bulkResultTitle({ total: 4, done: 1, skipped: 2, failed: 1 }, 'wiederhergestellt')).toBe(
			'1 Eintrag wiederhergestellt, 2 übersprungen, 1 fehlgeschlagen.'
		);
		expect(bulkResultTitle({ total: 2, done: 0, skipped: 0, failed: 2 }, 'verworfen')).toBe(
			'Keiner der 2 Einträge wurde verworfen.'
		);
		expect(bulkResultTitle({ total: 1, done: 0, skipped: 0, failed: 1 }, 'verworfen')).toBe(
			'Der Eintrag wurde nicht verworfen.'
		);
		expect(bulkFailureTitle(1, 'verworfen')).toBe('1 Eintrag wurde nicht verworfen:');
		expect(bulkFailureTitle(2, 'wiederhergestellt')).toBe(
			'2 Einträge wurden nicht wiederhergestellt:'
		);
		expect(bulkSkippedTitle(1)).toBe('1 Eintrag übersprungen:');
		expect(bulkSkippedTitle(3)).toBe('3 Einträge übersprungen:');
	});

	it('names why an action is locked without a connection, like "Alle Kanäle jetzt abrufen"', () => {
		expect(BULK_OFFLINE_HINT).toBe('Nur mit Verbindung');
		expect(bulkOfflineText('Verwerfen (3)')).toBe('„Verwerfen (3)“ geht nur mit Verbindung.');
	});
});
