// Page "Einstellungen → Sicherung" (ADR-0046): the answers of the server in the shape of the page,
// the checks of the forms and the texts of warnings, runs, checks and free space.

import { describe, expect, it } from 'vitest';
import {
	exportReasonText,
	freeText,
	keepProblem,
	newestToVerify,
	parseOverview,
	parseRunResult,
	parseVerifyResult,
	passphraseProblem,
	runText,
	verifyCountsText,
	verifyReasonText,
	verifyText,
	warningText,
	type BackupOverview
} from './backup';

const RAW = {
	appDir: 'C:\\Apps\\app',
	settings: { target: 'E:\\Sicherung', daily: 7, weekly: 4, monthly: 6, credentials: true },
	passphrase: 'set',
	helper: true,
	variables: ['BYL_TELEGRAM_TOKEN', 'PATH', 7],
	target: {
		path: 'E:\\Sicherung',
		reachable: true,
		problem: null,
		freeBytes: 5 * 1024 ** 3,
		sameDrive: false
	},
	local: [
		{ name: 'byl-20261001-100000.zip', at: '2026-10-01T10:00:00.000Z', bytes: 2048, ours: true },
		{ name: 'handarbeit.zip', at: '2026-09-01T10:00:00.000Z', bytes: 10, ours: false },
		{ name: '', at: 'x' }
	],
	sealed: [{ name: 'byl-20261001-100000.tar.age', at: '2026-10-01T10:00:00.000Z', bytes: 4096 }],
	last: {
		backup: { at: '2026-10-01T10:00:00.000Z', name: 'byl-20261001-100000.zip', bytes: 2048 },
		backupError: null,
		export: { at: '2026-10-01T10:00:01.000Z', name: 'byl-20261001-100000.tar.age', bytes: 4096 },
		exportProblem: null,
		verify: {
			at: '2026-10-01T11:00:00.000Z',
			name: 'byl-20261001-100000.tar.age',
			source: 'target',
			ok: false,
			reason: 'files',
			counts: { tickets: 12, 'drop table': 1, users: -1 },
			files: { expected: 3, missing: 1, examples: ['inbox_items/abc', 7] }
		}
	},
	nextBackupAt: '2026-10-02T10:00:00.000Z',
	warnings: [
		{ code: 'stale', tone: 'warning', since: '2026-09-29T10:00:00.000Z', reason: '' },
		{ code: 'erfunden', tone: 'error' }
	]
};

describe('answers of the server', () => {
	it('reads the overview and drops what it does not know', () => {
		const overview = parseOverview(RAW);
		expect(overview).toMatchObject({
			appDir: 'C:\\Apps\\app',
			settings: RAW.settings,
			passphrase: 'set',
			helper: true,
			variables: ['BYL_TELEGRAM_TOKEN'],
			target: RAW.target,
			sealed: RAW.sealed,
			nextBackupAt: '2026-10-02T10:00:00.000Z',
			warnings: [{ code: 'stale', tone: 'warning', since: '2026-09-29T10:00:00.000Z', reason: '' }]
		});
		expect(overview?.local).toEqual(RAW.local.slice(0, 2));
		expect(overview?.last.backup).toEqual(RAW.last.backup);
		expect(overview?.last.verify).toEqual({
			at: '2026-10-01T11:00:00.000Z',
			name: 'byl-20261001-100000.tar.age',
			source: 'target',
			ok: false,
			reason: 'files',
			counts: { tickets: 12 },
			files: { expected: 3, missing: 1, examples: ['inbox_items/abc'] }
		});
		expect(parseOverview({ ...RAW, last: { ...RAW.last, verify: null } })?.last.verify).toBeNull();
		expect(parseOverview(null)).toBeNull();
		expect(parseOverview({ settings: {} })).toBeNull();
	});

	it('reads the result of "Prüfen"', () => {
		expect(
			parseVerifyResult({
				result: {
					verify: {
						ok: true,
						reason: 'files',
						encrypted: true,
						createdUtc: '2026-10-01T10:00:00Z',
						variables: ['BYL_A', 'x'],
						counts: { tickets: 2 },
						files: { expected: 0, missing: 0, examples: [] }
					}
				}
			})
		).toEqual({
			ok: true,
			reason: '',
			encrypted: true,
			createdUtc: '2026-10-01T10:00:00Z',
			variables: ['BYL_A'],
			counts: { tickets: 2 },
			files: { expected: 0, missing: 0, examples: [] }
		});
		expect(parseVerifyResult({ result: { verify: { ok: false } } })).toMatchObject({
			ok: false,
			reason: 'failed',
			counts: null,
			files: null
		});
		expect(parseVerifyResult({ result: {} })).toBeNull();
	});

	it('checks the newest copy in the target first, else the newest own backup here', () => {
		const overview = parseOverview(RAW) as BackupOverview;
		expect(newestToVerify(overview)).toEqual({
			source: 'target',
			name: 'byl-20261001-100000.tar.age'
		});
		expect(newestToVerify({ ...overview, sealed: [] })).toEqual({
			source: 'local',
			name: 'byl-20261001-100000.zip'
		});
		const other = overview.local[1];
		expect(newestToVerify({ ...overview, sealed: [], local: other ? [other] : [] })).toEqual({
			source: 'local',
			name: 'handarbeit.zip'
		});
		expect(newestToVerify({ ...overview, sealed: [], local: [] })).toBeNull();
	});

	it('falls back to defaults for settings out of their limits', () => {
		const overview = parseOverview({
			...RAW,
			settings: { target: '', daily: 0, weekly: 99, monthly: 2.5, credentials: 'ja' },
			passphrase: 'irgendwas',
			target: null
		});
		expect(overview?.settings).toEqual({
			target: null,
			daily: 7,
			weekly: 4,
			monthly: 6,
			credentials: true
		});
		expect(overview?.passphrase).toBe('missing');
		expect(overview?.target).toBeNull();
	});

	it('reads the result of "Jetzt sichern"', () => {
		expect(
			parseRunResult({
				result: {
					backup: 'byl-x.zip',
					backupError: '',
					export: { ok: false, reason: 'unreachable', file: '' }
				}
			})
		).toEqual({
			backup: 'byl-x.zip',
			backupError: '',
			export: { ok: false, reason: 'unreachable', file: '' }
		});
		expect(parseRunResult({ result: { backup: 'b', export: null } })?.export).toBeNull();
		expect(parseRunResult({})).toBeNull();
	});
});

describe('forms', () => {
	it('checks the passphrase before sending: length first, then both entries', () => {
		expect(passphraseProblem('kurz', 'kurz')).toBe('too-short');
		expect(passphraseProblem('zwölf Zeichen', 'zwölf zeichen')).toBe('mismatch');
		expect(passphraseProblem('zwölf Zeichen', 'zwölf Zeichen')).toBeNull();
	});

	it('checks the generations against their limits', () => {
		expect(keepProblem({ daily: 7, weekly: 4, monthly: 6 })).toBe(false);
		expect(keepProblem({ daily: 0, weekly: 4, monthly: 6 })).toBe(true);
		expect(keepProblem({ daily: 7, weekly: 13, monthly: 6 })).toBe(true);
		expect(keepProblem({ daily: 7, weekly: 4, monthly: 1.5 })).toBe(true);
	});
});

describe('texts', () => {
	it('names every warning, red only for real errors', () => {
		expect(
			warningText({ code: 'stale', tone: 'warning', since: '2026-09-29T10:00:00.000Z', reason: '' })
		).toEqual({
			title: 'Die letzte Sicherung ist älter als 36 Stunden',
			text: 'Sie stammt vom 29.09.2026 12:00. Die App sichert, sobald sie läuft; „Jetzt sichern“ geht sofort.'
		});
		expect(
			warningText({ code: 'target-lag', tone: 'warning', since: null, reason: 'unreachable' }).text
		).toBe('Dort liegt noch keine Sicherung. Das Zielverzeichnis war nicht erreichbar.');
		expect(
			warningText({ code: 'export-failed', tone: 'error', since: null, reason: 'helper' }).text
		).toContain('byl-backup.exe');
		expect(
			warningText({ code: 'no-passphrase', tone: 'warning', since: null, reason: 'missing' }).title
		).toBe('Keine Passphrase für das Zielverzeichnis');
		expect(exportReasonText('erfunden')).toBe(exportReasonText('failed'));
		expect(
			warningText({ code: 'verify-failed', tone: 'error', since: null, reason: 'integrity' })
		).toEqual({
			title: 'Die letzte Prüfung einer Sicherung ist gescheitert',
			text: 'Die Datenbank in der Sicherung ist beschädigt. Unter „Sicherungen“ lässt sich jede Sicherung einzeln prüfen; „Jetzt sichern“ legt eine neue an.'
		});
	});

	it('names the last check and what it counted', () => {
		expect(verifyText(null)).toBe('Noch keine');
		const run = {
			at: '2026-10-01T11:00:00.000Z',
			name: 'byl-20261001-100000.zip',
			source: 'local' as const,
			ok: true,
			reason: '',
			counts: { tickets: 1 },
			files: { expected: 1, missing: 0, examples: [] }
		};
		expect(verifyText(run)).toBe(
			'01.10.2026 13:00 · Sicherung im Ordner app in Ordnung (1 Ticket, 1 Originaldatei)'
		);
		expect(verifyText({ ...run, source: 'target', ok: false, reason: 'passphrase' })).toBe(
			'01.10.2026 13:00 · Sicherung im Zielverzeichnis gescheitert: Die Passphrase passt nicht zu dieser Sicherung.'
		);
		expect(
			verifyCountsText({ counts: { tickets: 4 }, files: { expected: 5, missing: 2, examples: [] } })
		).toBe('4 Tickets, 2 von 5 Originaldateien fehlen');
		expect(verifyCountsText({ counts: null, files: null })).toBe('');
		expect(verifyReasonText('erfunden')).toBe(verifyReasonText('failed'));
	});

	it('names runs and free space', () => {
		expect(runText(null)).toBe('Noch keine');
		expect(runText({ at: '2026-10-01T10:00:00.000Z', bytes: 2.5 * 1024 * 1024 })).toBe(
			'01.10.2026 12:00 · 2,5 MB'
		);
		expect(freeText(5.25 * 1024 ** 3)).toBe('5,3 GB frei');
		expect(freeText(300 * 1024 ** 2)).toBe('300 MB frei');
		expect(freeText(null)).toBe('');
	});
});
