// Pure rules of the backups (ADR-0046): names, the generations kept (GFS) by Berlin calendar days,
// the settings of byl-config.json, when a backup and a copy are due, the warnings, the shape of the
// answers of the control script, the request and the state of a restore and the safety copies.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	KEEP as WEB_KEEP,
	RESTORE_CONFIRM_WORD as WEB_RESTORE_CONFIRM,
	TARGET_MAX_LENGTH as WEB_TARGET_MAX
} from '../../web/src/lib/domain/backup.ts';

const rules = loadHookLib('backup-rules.js');
const berlin = loadHookLib('berlin-time.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const KEEP = { daily: 7, weekly: 4, monthly: 6 };

/** Backups at the given times, with their Berlin day as the service computes it. */
function entries(times) {
	return times.map((time) => ({ name: rules.backupName(time), time, day: berlin.berlinToday(time) }));
}

describe('names', () => {
	it('names a backup by its time in UTC and its sealed copy the same', () => {
		const time = Date.UTC(2026, 9, 1, 8, 5, 9);
		expect(rules.backupName(time)).toBe('byl-20261001-080509.zip');
		expect(rules.sealedName('byl-20261001-080509.zip')).toBe('byl-20261001-080509.tar.age');
		expect(rules.timeOfName('byl-20261001-080509.zip')).toBe(time);
		expect(rules.timeOfName('byl-20261001-080509.tar.age')).toBe(time);
	});

	it('knows only its own names, with real dates', () => {
		for (const name of ['@auto_pb_backup_byl_20261001000000.zip', 'byl-20261001-0805.zip', 'byl-20260230-080509.zip', 'BYL-20261001-080509.zip', 'byl-20261001-080509.zip.attrs', '../byl-20261001-080509.zip']) {
			expect(rules.isLocalName(name), name).toBe(false);
			expect(rules.isSealedName(name), name).toBe(false);
			expect(rules.sealedName(name), name).toBe('');
		}
		expect(rules.isLocalName('byl-20261001-080509.zip')).toBe(true);
		expect(rules.isSealedName('byl-20261001-080509.tar.age')).toBe(true);
		expect(rules.isSealedName('byl-20261001-080509.zip')).toBe(false);
	});

	it('counts ISO weeks from Monday, across the turn of the year', () => {
		expect(rules.isoWeek('2026-10-01')).toBe('2026-W40');
		expect(rules.isoWeek('2026-09-28')).toBe('2026-W40');
		expect(rules.isoWeek('2026-09-27')).toBe('2026-W39');
		expect(rules.isoWeek('2027-01-01')).toBe('2026-W53');
		expect(rules.isoWeek('2025-12-29')).toBe('2026-W01');
	});
});

describe('generations (GFS)', () => {
	it('keeps 7 daily, 4 weekly and 6 monthly of a backup a day over almost a year', () => {
		const newest = Date.UTC(2026, 9, 1, 8, 0, 0);
		const times = Array.from({ length: 300 }, (_, index) => newest - index * DAY);
		const { keep, remove } = rules.retention(entries(times), KEEP);
		const days = keep.map((name) => berlin.berlinToday(rules.timeOfName(name)));
		expect(days).toEqual([
			// daily: the last 7 days
			'2026-10-01',
			'2026-09-30',
			'2026-09-29',
			'2026-09-28',
			'2026-09-27',
			'2026-09-26',
			'2026-09-25',
			// weekly: the newest of the weeks 40 to 37 (40 and 39 are in the days already)
			'2026-09-20',
			'2026-09-13',
			// monthly: the newest of October to May (October and September are in already)
			'2026-08-31',
			'2026-07-31',
			'2026-06-30',
			'2026-05-31'
		]);
		expect(keep.length + remove.length).toBe(300);
		expect(new Set([...keep, ...remove]).size).toBe(300);
	});

	it('keeps the newest backup of a day, and always the newest one', () => {
		const day = Date.UTC(2026, 9, 1, 6, 0, 0);
		const { keep, remove } = rules.retention(entries([day, day + HOUR, day + 2 * HOUR]), { daily: 1, weekly: 0, monthly: 0 });
		expect(keep).toEqual([rules.backupName(day + 2 * HOUR)]);
		expect(remove).toEqual([rules.backupName(day + HOUR), rules.backupName(day)]);
		expect(rules.retention([], KEEP)).toEqual({ keep: [], remove: [] });
	});

	it('counts days with backups, not calendar days: a week off keeps older generations', () => {
		const newest = Date.UTC(2026, 9, 1, 8, 0, 0);
		const times = [newest, newest - 10 * DAY, newest - 11 * DAY, newest - 12 * DAY];
		expect(rules.retention(entries(times), { daily: 3, weekly: 0, monthly: 0 }).keep).toEqual(
			[newest, newest - 10 * DAY, newest - 11 * DAY].map((time) => rules.backupName(time))
		);
	});

	it('puts a backup late in the UTC evening on the next Berlin day', () => {
		const late = Date.UTC(2026, 8, 30, 23, 30, 0);
		const early = Date.UTC(2026, 8, 30, 21, 0, 0);
		const list = entries([late, early]);
		expect(list.map((entry) => entry.day)).toEqual(['2026-10-01', '2026-09-30']);
		expect(rules.retention(list, { daily: 2, weekly: 0, monthly: 0 }).remove).toEqual([]);
	});
});

describe('settings', () => {
	it('has the same generations and the same length of a path as the page (parity)', () => {
		expect(WEB_KEEP).toEqual(rules.KEEP);
		expect(WEB_TARGET_MAX).toBe(rules.TARGET_MAX_LENGTH);
	});

	it('reads the backup section of byl-config.json with defaults and limits', () => {
		const defaults = { target: null, daily: 7, weekly: 4, monthly: 6, credentials: true };
		for (const text of ['', 'kein json', '[]', '{ "port": 8091 }', '{ "backup": null }', '{ "backup": [] }']) {
			expect(rules.settingsOf(text), text).toEqual(defaults);
		}
		expect(
			rules.settingsOf(
				JSON.stringify({ port: 8091, backup: { target: ' E:\\Sicherung ', daily: 3, weekly: 0, monthly: 24, credentials: false } })
			)
		).toEqual({ target: 'E:\\Sicherung', daily: 3, weekly: 0, monthly: 24, credentials: false });
		expect(rules.settingsOf(JSON.stringify({ backup: { target: '', daily: 0, weekly: 13, monthly: 2.5, credentials: 'nein' } }))).toEqual(defaults);
	});

	it('checks the form before the control script checks the folder', () => {
		const body = { target: ' \\\\NAS\\Sicherung ', daily: 7, weekly: 4, monthly: 6, credentials: true };
		expect(rules.settingsInput(body)).toEqual({ value: { ...body, target: '\\\\NAS\\Sicherung' } });
		expect(rules.settingsInput({ ...body, target: null })).toEqual({ value: { ...body, target: '' } });
		expect(rules.settingsInput({ ...body, target: 'x'.repeat(241) })).toEqual({ problem: 'target' });
		expect(rules.settingsInput({ ...body, target: 5 })).toEqual({ problem: 'target' });
		expect(rules.settingsInput({ ...body, daily: 0 })).toEqual({ problem: 'keep' });
		expect(rules.settingsInput({ ...body, monthly: 25 })).toEqual({ problem: 'keep' });
		expect(rules.settingsInput({ ...body, credentials: 'ja' })).toEqual({ problem: 'credentials' });
		expect(rules.settingsInput(null)).toEqual({ problem: 'target' });
	});

	it('checks the passphrase of the form like the control script', () => {
		expect(rules.passphraseInput({ passphrase: 'zwölf Zeichen', confirmation: 'zwölf Zeichen' })).toEqual({});
		expect(rules.passphraseInput({ passphrase: 'zwölf Zeichen', confirmation: 'zwölf zeichen' })).toEqual({ problem: 'mismatch' });
		expect(rules.passphraseInput({ passphrase: 'kurz', confirmation: 'kurz' })).toEqual({ problem: 'too-short' });
		expect(rules.passphraseInput({ passphrase: 'x'.repeat(1025), confirmation: 'x'.repeat(1025) })).toEqual({ problem: 'too-long' });
		expect(rules.passphraseInput({})).toEqual({ problem: 'too-short' });
	});
});

describe('what is due', () => {
	const now = Date.UTC(2026, 9, 1, 12, 0, 0);
	const state = (overrides) => ({
		newestLocal: now - 2 * HOUR,
		newestLocalName: rules.backupName(now - 2 * HOUR),
		targetConfigured: true,
		sealedNames: [],
		lastExportAttempt: null,
		...overrides
	});

	it('makes a backup a day, and at once without any', () => {
		expect(rules.plan(state({ newestLocal: null, newestLocalName: '' }), now).backup).toBe(true);
		expect(rules.plan(state({ newestLocal: now - DAY + rules.TICK_MS }), now).backup).toBe(true);
		expect(rules.plan(state({ newestLocal: now - DAY + rules.TICK_MS + 1 }), now).backup).toBe(false);
		expect(rules.nextBackupAt(now - 2 * HOUR, now)).toBe(now + 22 * HOUR);
		expect(rules.nextBackupAt(null, now)).toBe(now);
	});

	it('ignores backups from a clock that ran ahead when it decides', () => {
		const entries = [
			{ name: 'zukunft', time: now + 3 * DAY },
			{ name: 'gestern', time: now - DAY },
			{ name: 'vorgestern', time: now - 2 * DAY }
		];
		expect(rules.newestUntil(entries, now)).toEqual(entries[1]);
		expect(rules.newestUntil(entries.slice(0, 1), now)).toBeNull();
		expect(rules.newestUntil([], now)).toBeNull();
	});

	it('copies the newest backup into the target until it is there, at most every 15 minutes', () => {
		const name = rules.backupName(now - 2 * HOUR);
		expect(rules.plan(state(), now).export).toBe(name);
		expect(rules.plan(state({ sealedNames: [rules.sealedName(name)] }), now).export).toBe('');
		expect(rules.plan(state({ sealedNames: null }), now).export).toBe(name);
		expect(rules.plan(state({ lastExportAttempt: now - 5 * 60 * 1000 }), now).export).toBe('');
		expect(rules.plan(state({ lastExportAttempt: now - 15 * 60 * 1000 }), now).export).toBe(name);
		// A new backup since the last try is copied at once.
		expect(rules.plan(state({ lastExportAttempt: now - 3 * HOUR }), now).export).toBe(name);
		expect(rules.plan(state({ targetConfigured: false }), now).export).toBe('');
		expect(rules.plan(state({ newestLocal: null, newestLocalName: '' }), now).export).toBe('');
	});
});

describe('warnings', () => {
	const now = Date.UTC(2026, 9, 1, 12, 0, 0);
	const facts = (overrides) => ({
		now,
		newestLocal: now - HOUR,
		newestSealed: now - HOUR,
		target: true,
		passphrase: 'set',
		backupError: null,
		exportProblem: null,
		...overrides
	});
	const codes = (list) => list.map((warning) => warning.code);

	it('says nothing while backups and copies are fresh', () => {
		expect(rules.warnings(facts())).toEqual([]);
		expect(rules.warnings(facts({ target: false, newestSealed: null }))).toEqual([]);
		// A target that was just set and has no copy yet.
		expect(rules.warnings(facts({ newestSealed: null }))).toEqual([]);
	});

	it('warns about an old backup and a target that lags, and marks failures as errors', () => {
		expect(rules.warnings(facts({ newestLocal: now - 37 * HOUR, newestSealed: now - 37 * HOUR }))).toEqual([
			{ code: 'stale', tone: 'warning', since: now - 37 * HOUR, reason: '' }
		]);
		const lag = rules.warnings(
			facts({ newestSealed: now - 40 * HOUR, exportProblem: { reason: 'unreachable', since: now - 39 * HOUR } })
		);
		expect(lag).toEqual([{ code: 'target-lag', tone: 'warning', since: now - 40 * HOUR, reason: 'unreachable' }]);
		const never = rules.warnings(facts({ newestSealed: null, exportProblem: { reason: 'unreachable', since: now - 37 * HOUR } }));
		expect(codes(never)).toEqual(['target-lag']);
		expect(codes(rules.warnings(facts({ newestSealed: null, exportProblem: { reason: 'unreachable', since: now - 2 * HOUR } })))).toEqual([]);
		expect(rules.warnings(facts({ exportProblem: { reason: 'helper', since: now - HOUR } }))).toEqual([
			{ code: 'export-failed', tone: 'error', since: now - HOUR, reason: 'helper' }
		]);
		expect(rules.warnings(facts({ backupError: { at: now - 10 * 60 * 1000, message: 'x' } }))).toEqual([
			{ code: 'backup-failed', tone: 'error', since: now - 10 * 60 * 1000, reason: '' }
		]);
		// A failure before the newest backup is over.
		expect(rules.warnings(facts({ backupError: { at: now - 2 * HOUR, message: 'x' } }))).toEqual([]);
	});

	it('names a missing passphrase, but asks for attention only for real warnings', () => {
		const missing = rules.warnings(facts({ passphrase: 'missing' }));
		expect(missing).toEqual([{ code: 'no-passphrase', tone: 'warning', since: null, reason: 'missing' }]);
		expect(rules.needsAttention(missing)).toBe(false);
		expect(rules.needsAttention(rules.warnings(facts({ newestLocal: now - 40 * HOUR, newestSealed: now - 40 * HOUR })))).toBe(true);
		expect(rules.needsAttention([])).toBe(false);
	});
});

describe('answers of the control script and the state file', () => {
	it('keeps only known fields of backup-info', () => {
		expect(rules.infoView(null)).toBeNull();
		expect(rules.infoView({ ok: false })).toBeNull();
		expect(
			rules.infoView({
				ok: true,
				settings: {},
				passphrase: 'set',
				helper: true,
				target: { path: 'E:\\S', reachable: true, problem: null, freeBytes: 1024, sameDrive: false, extra: 1 },
				variables: ['BYL_A', 'PATH', 'BYL_b', 3]
			})
		).toEqual({
			passphrase: 'set',
			helper: true,
			target: { path: 'E:\\S', reachable: true, problem: null, freeBytes: 1024, sameDrive: false },
			variables: ['BYL_A']
		});
		expect(rules.infoView({ ok: true, settings: {}, passphrase: 'anders', target: null }).passphrase).toBe('missing');
	});

	it('reads the answers of backup-configure and backup-export', () => {
		expect(rules.configureView({ ok: false, problem: 'inside-app', freeBytes: 5, sameDrive: true })).toEqual({
			ok: false,
			problem: 'inside-app',
			freeBytes: 5,
			sameDrive: true
		});
		expect(rules.configureView({ ok: false, problem: 'erfunden' }).problem).toBe('format');
		expect(rules.configureView('x')).toBeNull();
		expect(rules.exportView({ ok: true, file: 'byl-20261001-080509.tar.age', bytes: 12 })).toEqual({
			ok: true,
			reason: '',
			file: 'byl-20261001-080509.tar.age',
			bytes: 12
		});
		expect(rules.exportView({ ok: false, reason: 'unreachable' })).toEqual({ ok: false, reason: 'unreachable', file: '', bytes: 0 });
		expect(rules.exportView({ ok: false, reason: 'erfunden' }).reason).toBe('failed');
	});

	it('reads its state file and survives a broken one', () => {
		const empty = { backup: null, backupError: null, export: null, exportAttempt: null, exportProblem: null, verify: null };
		expect(rules.parseStatus('')).toEqual(empty);
		expect(rules.parseStatus('{')).toEqual(empty);
		expect(
			rules.parseStatus(
				JSON.stringify({ backup: { at: 5, name: 'n', bytes: 1 }, exportAttempt: 6, exportProblem: { at: 6, reason: 'space', since: 4 }, export: { at: 'x' } })
			)
		).toEqual({
			...empty,
			backup: { at: 5, name: 'n', bytes: 1 },
			exportAttempt: 6,
			exportProblem: { at: 6, reason: 'space', since: 4 }
		});
		expect(rules.iso(Date.UTC(2026, 9, 1))).toBe('2026-10-01T00:00:00.000Z');
		expect(rules.iso(null)).toBeNull();
		expect(
			rules.parseStatus(JSON.stringify({ verify: { at: 7, name: 'n', source: 'target', ok: false, reason: 'files', counts: { tickets: 1 }, files: null } }))
				.verify
		).toEqual({ at: 7, name: 'n', source: 'target', ok: false, reason: 'files', counts: { tickets: 1 }, files: null });
	});
});

describe('check of a backup (BK-2)', () => {
	const now = Date.UTC(2026, 9, 1, 12, 0, 0);
	const sealed = 'byl-20261001-080000.tar.age';
	const local = 'byl-20261001-080000.zip';

	it('checks once a week, the newest copy in the target first', () => {
		expect(rules.planVerify(null, local, sealed, now)).toEqual({ due: true, source: 'target', name: sealed });
		expect(rules.planVerify(null, local, '', now)).toEqual({ due: true, source: 'local', name: local });
		expect(rules.planVerify(now - 6 * DAY, local, sealed, now).due).toBe(false);
		expect(rules.planVerify(now - 7 * DAY, local, sealed, now).due).toBe(true);
		expect(rules.planVerify(now + DAY, local, sealed, now).due).toBe(true);
		expect(rules.planVerify(null, '', '', now)).toEqual({ due: false, source: '', name: '' });
	});

	it('takes only backups of their place and a passphrase of at most 1024 characters', () => {
		expect(rules.verifyInput({ source: 'local', name: '@auto_pb_backup_byl_20261001000000.zip' })).toEqual({
			value: { source: 'local', name: '@auto_pb_backup_byl_20261001000000.zip' }
		});
		expect(rules.verifyInput({ source: 'target', name: sealed, passphrase: 'geheim' })).toEqual({
			value: { source: 'target', name: sealed, passphrase: 'geheim' }
		});
		expect(rules.verifyInput({ source: 'target', name: sealed, passphrase: '' })).toEqual({ value: { source: 'target', name: sealed } });
		for (const body of [
			{ source: 'local', name: '..\\data.db' },
			{ source: 'local', name: 'x.tar.age' },
			{ source: 'target', name: local },
			{ source: 'path', name: 'C:\\x.zip' },
			null
		]) {
			expect(rules.verifyInput(body), JSON.stringify(body)).toEqual({ problem: 'name' });
		}
		expect(rules.verifyInput({ source: 'target', name: sealed, passphrase: 'x'.repeat(1025) })).toEqual({ problem: 'passphrase' });
	});

	it('keeps only known parts of the answer, never names of files', () => {
		expect(
			rules.verifyView({
				ok: false,
				reason: 'files',
				encrypted: true,
				createdUtc: '2026-10-01T08:00:00Z',
				variables: ['BYL_A', 'x'],
				counts: { tickets: 3, 'drop table': 1, users: -1 },
				files: { expected: 2, missing: 1, examples: ['inbox_items/abc123', 'inbox_items/abc123/mail.eml'] },
				secrets: { BYL_A: 'geheim' }
			})
		).toEqual({
			ok: false,
			reason: 'files',
			encrypted: true,
			createdUtc: '2026-10-01T08:00:00Z',
			variables: ['BYL_A'],
			counts: { tickets: 3 },
			files: { expected: 2, missing: 1, examples: ['inbox_items/abc123'] }
		});
		expect(rules.verifyView({ ok: false, reason: 'erfunden' }).reason).toBe('failed');
		expect(rules.verifyView({ ok: true, reason: 'files' }).reason).toBe('');
		expect(rules.verifyView(null)).toBeNull();
	});

	it('warns about a failed check as an error that asks for attention', () => {
		const list = rules.warnings({
			now,
			newestLocal: now - 60 * 60 * 1000,
			newestSealed: null,
			target: false,
			passphrase: 'set',
			backupError: null,
			exportProblem: null,
			verify: { at: now - 1000, ok: false, reason: 'integrity' }
		});
		expect(list).toEqual([{ code: 'verify-failed', tone: 'error', since: now - 1000, reason: 'integrity' }]);
		expect(rules.needsAttention(list)).toBe(true);
	});
});

describe('restore (BK-3)', () => {
	const now = Date.UTC(2026, 9, 1, 12, 0, 0);
	const sealed = 'byl-20261001-080000.tar.age';

	it('wants the word WIEDERHERSTELLEN and a known choice for the access data (the same word as the page)', () => {
		expect(rules.RESTORE_CONFIRM).toBe(WEB_RESTORE_CONFIRM);
		const body = { source: 'target', name: sealed, confirm: ' WIEDERHERSTELLEN ' };
		expect(rules.restoreInput(body)).toEqual({
			value: { source: 'target', name: sealed, credentials: 'missing', confirm: 'WIEDERHERSTELLEN' }
		});
		expect(rules.restoreInput({ ...body, credentials: 'all', passphrase: 'alt' })).toEqual({
			value: { source: 'target', name: sealed, credentials: 'all', confirm: 'WIEDERHERSTELLEN', passphrase: 'alt' }
		});
		expect(rules.restoreInput({ ...body, confirm: 'wiederherstellen' })).toEqual({ problem: 'confirm' });
		expect(rules.restoreInput({ ...body, confirm: undefined })).toEqual({ problem: 'confirm' });
		expect(rules.restoreInput({ ...body, credentials: 'einige' })).toEqual({ problem: 'credentials' });
		expect(rules.restoreInput({ ...body, source: 'path', name: 'C:\\x.tar.age' })).toEqual({ problem: 'name' });
		expect(rules.restoreInput({ ...body, passphrase: 'x'.repeat(1025) })).toEqual({ problem: 'passphrase' });
	});

	it('reads the state file of a restore and keeps only known parts', () => {
		const text = JSON.stringify({
			at: now,
			phase: 'done',
			name: sealed,
			source: 'target',
			ok: true,
			reason: 'files',
			safety: 'pb_data.vor-wiederherstellung-20261001-115900',
			counts: { tickets: 3 },
			files: { expected: 1, missing: 0, examples: [] },
			credentials: { mode: 'missing', written: ['BYL_A', 'geheim'], failed: false, values: { BYL_A: 'x' } },
			config: 'kept',
			passphrase: 'nie'
		});
		const state = rules.parseRestoreState(text);
		expect(state).toEqual({
			at: now,
			phase: 'done',
			name: sealed,
			source: 'target',
			ok: true,
			reason: '',
			safety: 'pb_data.vor-wiederherstellung-20261001-115900',
			counts: { tickets: 3 },
			files: { expected: 1, missing: 0, examples: [] },
			credentials: { mode: 'missing', written: ['BYL_A'], failed: false },
			config: 'kept'
		});
		expect(rules.restoreView(state, now)).toEqual({ ...state, at: '2026-10-01T12:00:00.000Z', running: false });
		expect(rules.parseRestoreState(JSON.stringify({ at: now, phase: 'rolled-back', reason: 'erfunden' }))).toMatchObject({
			phase: 'rolled-back',
			reason: 'failed',
			ok: false,
			name: '',
			safety: ''
		});
		expect(rules.parseRestoreState(JSON.stringify({ at: now, phase: 'failed', reason: 'space-app', name: '..\\x' }))).toMatchObject({ reason: 'space-app', name: '' });
		for (const broken of ['', '{', '[]', JSON.stringify({ at: now, phase: 'irgendwas' }), JSON.stringify({ phase: 'done' })]) {
			expect(rules.parseRestoreState(broken), broken).toBeNull();
		}
		expect(rules.restoreView(null, now)).toBeNull();
	});

	it('counts a restore as running until its end, or until it wrote nothing for 30 minutes', () => {
		const state = (phase, at) => rules.parseRestoreState(JSON.stringify({ at, phase }));
		for (const phase of ['started', 'checking', 'stopping', 'restoring', 'starting']) {
			expect(rules.restoreRunning(state(phase, now - 60_000), now), phase).toBe(true);
		}
		expect(rules.restoreRunning(state('checking', now - rules.RESTORE_STALE_MS), now)).toBe(false);
		for (const phase of ['done', 'failed', 'rolled-back']) {
			expect(rules.restoreRunning(state(phase, now), now), phase).toBe(false);
		}
		expect(rules.restoreRunning(null, now)).toBe(false);
	});

	it('knows safety copies by name and removes them after seven days', () => {
		const name = 'pb_data.vor-wiederherstellung-20261001-080000';
		expect(rules.safetyTime(name)).toBe(Date.UTC(2026, 9, 1, 8, 0, 0));
		for (const other of ['pb_data', 'pb_data.neu-20261001-080000', 'pb_data.vor-wiederherstellung-20260230-080000', `${name}x`]) {
			expect(rules.safetyTime(other), other).toBeNull();
		}
		expect(rules.safetyExpired(name, Date.UTC(2026, 9, 8, 7, 59, 59))).toBe(false);
		expect(rules.safetyExpired(name, Date.UTC(2026, 9, 8, 8, 0, 0))).toBe(true);
		expect(rules.safetyExpired('pb_data', Date.UTC(2030, 0, 1))).toBe(false);
	});
});
