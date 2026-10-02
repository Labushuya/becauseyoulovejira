// Page "Speicher" (ADR-0047 §6 to §9): the answer of the server read strictly, and its words:
// sizes, databases with their free part, summaries of backups, where a large file belongs, the
// preview of an action and the refusals.

import { describe, expect, it } from 'vitest';
import { storageAnswer } from '$lib/test/storage-answer';
import {
	belongsText,
	boundToTrashText,
	bytesText,
	countText,
	databaseText,
	denialText,
	parseOverview,
	previewText,
	summaryText,
	type LargestEntry
} from './storage';

describe('answer of the route', () => {
	it('reads every part and drops a broken largest entry', () => {
		const overview = parseOverview(storageAnswer());
		expect(overview).not.toBeNull();
		expect(overview?.ownInstance).toBe(true);
		expect(overview?.database).toMatchObject({
			bytes: 50 * 1024 ** 2,
			freeBytes: 6 * 1024 ** 2,
			trash: { blocked: 1 }
		});
		expect(overview?.files.nextEmpty).toBe('2026-10-31');
		expect(overview?.files.largest).toHaveLength(1);
		expect(overview?.backups.target).toBe('unreachable');
		expect(overview?.program?.leftovers.count).toBe(1);
		expect(overview?.disk).toEqual({ level: 'warning', text: '412 MB frei auf C:\\' });
		expect(overview?.actions.leftovers.safety).toEqual({ count: 0, bytes: 0 });
	});

	it('takes what a server outside the folder app leaves out', () => {
		const overview = parseOverview(
			storageAnswer({
				own_instance: false,
				logs: null,
				program: null,
				disk: null,
				backups: { ...(storageAnswer().backups as object), target: null, safety: null }
			})
		);
		expect(overview).toMatchObject({ ownInstance: false, logs: null, program: null, disk: null });
		expect(overview?.backups).toMatchObject({ target: null, safety: null });
	});

	it('refuses an answer without its parts', () => {
		for (const answer of [
			null,
			{},
			storageAnswer({ files: null }),
			storageAnswer({ measured_at: 1 })
		]) {
			expect(parseOverview(answer)).toBeNull();
		}
	});
});

describe('words of the page', () => {
	it('words sizes, counts and databases', () => {
		expect([0, 512, 2048, 1536 * 1024, 150 * 1024 ** 2, 1.25 * 1024 ** 3].map(bytesText)).toEqual([
			'0 B',
			'512 B',
			'2 KB',
			'1,5 MB',
			'150 MB',
			'1,3 GB'
		]);
		expect(countText({ count: 1, bytes: 1024 })).toBe('1 Datei, 1 KB');
		expect(countText({ count: 3, bytes: 0 }, 'Eintrag', 'Einträge')).toBe('3 Einträge, 0 B');
		expect(databaseText({ bytes: 50 * 1024 ** 2, walBytes: 1024, freeBytes: 6 * 1024 ** 2 })).toBe(
			'50 MB, davon 6 MB frei (dazu 1 KB Schreibprotokoll)'
		);
		expect(databaseText({ bytes: null, walBytes: null, freeBytes: null })).toBe('unbekannt');
	});

	it('sums up backups with their oldest and newest', () => {
		expect(summaryText({ count: 0, bytes: 0, oldest: null, newest: null })).toBe('keine');
		expect(
			summaryText({
				count: 2,
				bytes: 100 * 1024 ** 2,
				oldest: '2026-09-30T03:00:00.000Z',
				newest: '2026-10-01T03:00:00.000Z'
			})
		).toBe('2 Sicherungen, 100 MB · älteste 30.09.2026 05:00 · neueste 01.10.2026 05:00');
	});

	it('says where a large file belongs', () => {
		const entry = (overrides: Partial<LargestEntry>): LargestEntry => ({
			item: 'i',
			title: 't',
			channel: 'mail',
			bytes: 1,
			category: 'open',
			ticket: null,
			copyOf: '',
			...overrides
		});
		const ticket = { id: 't', key: 'HAUS-12', status: 'open', trashed: false };
		expect(belongsText(entry({ ticket }))).toBe('gehört zu HAUS-12 (offen)');
		expect(belongsText(entry({ ticket: { ...ticket, status: 'done' } }))).toBe(
			'gehört zu HAUS-12 (erledigt)'
		);
		expect(belongsText(entry({ ticket: { ...ticket, trashed: true } }))).toBe(
			'gehört zu HAUS-12 im Papierkorb'
		);
		expect(belongsText(entry({ category: 'new', copyOf: 'HAUS-3' }))).toBe(
			'neu im Eingang · Kopie aus HAUS-3'
		);
		expect(belongsText(entry({ category: 'discarded' }))).toBe('verworfen');
	});

	it('previews an action and words the refusals', () => {
		expect(
			previewText([{ count: 1, bytes: 95 * 1024 ** 2 }, null, { count: 2, bytes: 1024 }])
		).toBe('Betrifft 3 Einträge, 95 MB.');
		expect(previewText([null, { count: 0, bytes: 0 }])).toBe('Betrifft nichts.');
		expect(denialText('owner').title).toBe('Nur für das erste Konto');
		expect(denialText('loopback').title).toBe('Nur auf dem Rechner der App');
		expect(denialText('script').title).toBe('Der Speicher ließ sich nicht messen');
	});

	it('names the files bound to tickets in the trash that an action leaves out', () => {
		expect(boundToTrashText({ count: 2, bytes: 3 * 1024 ** 2 })).toBe(
			'Nicht dabei: 2 Dateien, 3 MB an Quellen von Tickets im Papierkorb. Über sie entscheidest du dort unter „Abhängigkeiten auflösen“.'
		);
		expect(boundToTrashText({ count: 0, bytes: 0 })).toBe('');
	});
});
