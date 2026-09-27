// Texts of "Alle Kanäle jetzt abrufen" (testing feedback package A, item 4).

import { describe, expect, it } from 'vitest';
import type { RunResult } from './connections';
import {
	cardAnchorOf,
	connectionAnchor,
	newCountText,
	syncProgressText,
	syncSummary
} from './sync-all';

const OK: RunResult = {
	status: 'ok',
	created: 0,
	duplicates: 0,
	updated: 0,
	skipped: 0,
	failed: 0,
	unmatched: 0,
	error: '',
	missing: []
};
const CAL = { id: 'conn00000000001', label: 'Kalender' };
const MAIL = { id: 'conn00000000002', label: 'Web.de' };

describe('sync-all texts', () => {
	it('counts the new entries: "keine neuen", "1 neuer", "3 neue"', () => {
		expect(newCountText(0)).toBe('keine neuen');
		expect(newCountText(1)).toBe('1 neuer');
		expect(newCountText(3)).toBe('3 neue');
	});

	it('names the running connection with its position', () => {
		expect(syncProgressText(1, 3, 'Web.de')).toBe('„Web.de“ wird abgerufen (2 von 3) …');
	});

	it('sums up good runs as success with every channel in the description', () => {
		const summary = syncSummary([
			{ connection: CAL, result: { ...OK, created: 2 } },
			{ connection: MAIL, result: { ...OK, created: 1, unmatched: 4 } }
		]);
		expect(summary).toEqual({
			tone: 'success',
			title: '2 Kanäle abgerufen: 3 neue.',
			description: '„Kalender“: 2 neu. „Web.de“: 1 neu, 4 ohne Stichwort.',
			problem: null
		});
		expect(syncSummary([{ connection: CAL, result: OK }]).title).toBe(
			'1 Kanal abgerufen: keine neuen.'
		);
	});

	it('makes an error flag with the first failed connection', () => {
		const summary = syncSummary([
			{ connection: CAL, result: { ...OK, created: 1 } },
			{ connection: MAIL, result: { ...OK, status: 'error', error: 'Anmeldung abgelehnt.' } }
		]);
		expect(summary.tone).toBe('error');
		expect(summary.title).toBe('2 Kanäle abgerufen: 1 neuer, 1 mit Problem.');
		expect(summary.description).toMatch(/„Web\.de“: Abruf fehlgeschlagen\. Anmeldung abgelehnt\./);
		expect(summary.problem).toEqual(MAIL);
	});

	it('stays neutral for a stopped helper or missing variables, with the link to the card', () => {
		const summary = syncSummary([
			{ connection: MAIL, result: { ...OK, status: 'unavailable', error: 'Läuft nicht.' } },
			{ connection: CAL, result: { ...OK, status: 'running' } }
		]);
		expect(summary.tone).toBe('info');
		expect(summary.problem).toEqual(MAIL);
		expect(summary.description).toMatch(/„Kalender“ ruft gerade ab/);
	});

	it('says when no connection is switched on', () => {
		expect(syncSummary([])).toMatchObject({ tone: 'info', problem: null });
	});

	it('builds and reads the anchor of a card, and nothing else', () => {
		expect(connectionAnchor(MAIL.id)).toBe('verbindung-conn00000000002');
		expect(cardAnchorOf('#verbindung-conn00000000002')).toBe('verbindung-conn00000000002');
		for (const hash of ['', '#', '#verbindung-', '#verbindung-../x', '#other-conn00000000002']) {
			expect(cardAnchorOf(hash), hash).toBeNull();
		}
	});
});
