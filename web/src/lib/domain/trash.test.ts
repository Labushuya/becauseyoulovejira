// Texts and values of the trash in the SPA (ADR-0037, plan PB-2).

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RETENTION,
	RETENTION_LABELS,
	TRASH_RETENTIONS,
	daysLeftText,
	movedText,
	needText,
	parseRetention,
	restoreNotes,
	retentionText,
	subtasksAlongText,
	type RestoreResult
} from './trash';

function result(overrides: Partial<RestoreResult> = {}): RestoreResult {
	return {
		id: 'ticket000000001',
		key: 'HAUS-1',
		updated: '',
		tickets: [],
		newKeys: [],
		parentDetached: false,
		ruleMissing: [],
		seriesDetached: [],
		sourcesSkipped: [],
		...overrides
	};
}

describe('trash texts', () => {
	it('knows the retention values with 30 days as default', () => {
		expect(TRASH_RETENTIONS).toEqual(['7', '30', '90', 'never']);
		expect(DEFAULT_RETENTION).toBe('30');
		expect(['7', '90', 'never', '', 'x', null, 30].map(parseRetention)).toEqual([
			'7',
			'90',
			'never',
			'30',
			'30',
			'30',
			'30'
		]);
		expect(RETENTION_LABELS.never).toBe('Nie automatisch');
	});

	it('words the retention and the remaining days', () => {
		expect(retentionText('30')).toBe(
			'Tickets im Papierkorb werden nach 30 Tagen endgültig gelöscht.'
		);
		expect(retentionText('7')).toBe(
			'Tickets im Papierkorb werden nach 7 Tagen endgültig gelöscht.'
		);
		expect(retentionText('never')).toBe('Tickets im Papierkorb werden nicht automatisch gelöscht.');
		expect([null, 0, -2, 1, 30].map(daysLeftText)).toEqual([
			'nie',
			'heute',
			'heute',
			'in 1 Tag',
			'in 30 Tagen'
		]);
	});

	it('names moves and sub-tasks that go along', () => {
		expect(movedText(['HAUS-1'])).toBe('HAUS-1 in den Papierkorb verschoben.');
		expect(movedText(['HAUS-1', 'HAUS-2'])).toBe('2 Tickets in den Papierkorb verschoben.');
		expect(subtasksAlongText(1)).toBe('1 Unteraufgabe kommt mit in den Papierkorb.');
		expect(subtasksAlongText(3)).toBe('3 Unteraufgaben kommen mit in den Papierkorb.');
	});

	it('lists the notes of a restore', () => {
		expect(restoreNotes(result())).toEqual([]);
		expect(
			restoreNotes(
				result({
					newKeys: [{ id: 'a', key: 'GART-4', previous: 'HAUS-1' }],
					parentDetached: true,
					ruleMissing: ['HAUS-1'],
					seriesDetached: ['HAUS-2'],
					sourcesSkipped: [
						{ id: 'i1', title: 'Mail', reason: 'converted', key: 'HAUS-1' },
						{ id: 'i2', title: '', reason: 'missing', key: 'HAUS-1' }
					]
				})
			)
		).toEqual([
			'HAUS-1 heißt jetzt GART-4.',
			'HAUS-1 ist jetzt ein eigenständiges Ticket; das übergeordnete Ticket fehlt.',
			'HAUS-1 ist ein normales Ticket; die Regel der Serie gibt es nicht mehr.',
			'HAUS-2 ist aus der Serie gelöst.',
			'Die Quelle „Mail“ blieb im Eingang: inzwischen einem anderen Ticket zugeordnet.',
			'Eine Quelle blieb im Eingang: nicht mehr vorhanden.'
		]);
	});

	it('says what a restore needs', () => {
		expect(needText({ kind: 'series', key: 'TASK-9', ticketId: 'x' })).toBe(
			'Die Serie hat schon ein offenes Ticket (TASK-9). Wiederherstellen würde es doppeln.'
		);
		expect(needText({ kind: 'project', code: 'HAUS', reason: 'missing' })).toMatch(
			/^Das Projekt HAUS gibt es nicht mehr\./
		);
		expect(needText({ kind: 'project', code: 'HAUS', reason: 'changed' })).toMatch(
			/anderen Code oder Bereich/
		);
	});
});
