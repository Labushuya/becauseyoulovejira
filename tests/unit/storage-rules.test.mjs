// Storage of the app (ADR-0047 §6 to §9, SPE-2): the pure rules of the page "Speicher": groups of
// data.db, where an original file of the inbox belongs, keys of the file storage, the names of
// leftovers and old backups, summaries, the largest entries, the day a discarded entry is emptied
// and the groups an action may name.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('storage-rules.js');
const berlinTime = loadHookLib('berlin-time.js');
const cleanup = loadHookLib('inbox-cleanup.js');

describe('database', () => {
	it('groups the pages of tables and their indexes', () => {
		expect(
			['tickets', 'comments', 'ticket_reads', 'ticket_pins', 'ticket_sources', 'ticket_counters', 'dependencies'].map(
				rules.groupOfTable
			)
		).toEqual(Array(7).fill('tickets'));
		expect(rules.groupOfTable('ticket_history')).toBe('history');
		expect(rules.groupOfTable('inbox_items')).toBe('inbox');
		expect(['users', '_collections', 'sqlite_master', '', 'constructor'].map(rules.groupOfTable)).toEqual(Array(5).fill('other'));
		expect(
			rules.databaseGroups([
				{ table: 'tickets', bytes: 4096 },
				{ table: 'comments', bytes: 4096 },
				{ table: 'ticket_history', bytes: 8192 },
				{ table: 'inbox_items', bytes: 1024 },
				{ table: 'users', bytes: 512 },
				{ table: 'users', bytes: 'x' }
			])
		).toEqual({ tickets: 8192, history: 8192, inbox: 1024, other: 512 });
		expect(rules.databaseGroups(undefined)).toEqual({ tickets: 0, history: 0, inbox: 0, other: 0 });
	});

	it('uses dbstat only when the runtime has it', () => {
		expect(rules.hasDbstat(['THREADSAFE=1', 'ENABLE_DBSTAT_VTAB'])).toBe(true);
		expect(rules.hasDbstat(['enable_dbstat_vtab'])).toBe(true);
		expect(rules.hasDbstat(['ENABLE_FTS5'])).toBe(false);
		expect(rules.hasDbstat(undefined)).toBe(false);
	});
});

describe('files of the inbox', () => {
	it('sorts an original file by where its entry belongs', () => {
		const cases = [
			[{ state: 'new', ticket: null }, 'new'],
			[{ state: 'discarded', ticket: null }, 'discarded'],
			[{ state: 'converted', ticket: { status: 'open', trashed: false } }, 'open'],
			[{ state: 'converted', ticket: { status: 'waiting', trashed: false } }, 'open'],
			[{ state: 'converted', ticket: { status: 'done', trashed: false } }, 'done'],
			[{ state: 'converted', ticket: { status: 'done', trashed: true } }, 'trash'],
			[{ state: 'converted', ticket: null }, 'other'],
			[null, 'other']
		];
		for (const [item, category] of cases) {
			expect(rules.fileCategory(item), JSON.stringify(item)).toBe(category);
		}
		expect(rules.FILE_CATEGORIES).toEqual(['new', 'open', 'done', 'discarded', 'trash', 'other']);
	});

	it('reads the record of a key of the file storage, thumbs included', () => {
		expect(rules.fileKeyParts('pbc_123/rec456/mail_abc.eml')).toEqual({ collection: 'pbc_123', record: 'rec456' });
		expect(rules.fileKeyParts('pbc_123/rec456/thumbs_a.png/100x100_a.png')).toEqual({ collection: 'pbc_123', record: 'rec456' });
		for (const key of ['', 'a', 'a/b', 'a//c', '/b/c', 'a/b/', null]) {
			expect(rules.fileKeyParts(key), String(key)).toBeNull();
		}
	});

	it('names the day the daily cleanup empties a discarded entry (30 full Berlin days)', () => {
		// 23:30 UTC on 30 September is 1 October in Berlin (summer time).
		expect(rules.emptyDay('2026-09-30 23:30:00.000Z', cleanup.DISCARDED_RETENTION_DAYS, berlinTime)).toBe('2026-10-31');
		expect(rules.emptyDay('2026-09-30 10:00:00.000Z', 30, berlinTime)).toBe('2026-10-30');
		expect(rules.emptyDay('', 30, berlinTime)).toBeNull();
		expect(rules.emptyDay('kaputt', 30, berlinTime)).toBeNull();
	});
});

describe('leftovers and old backups', () => {
	it('recognises program leftovers of the builds, old automatic backups and manual safety copies', () => {
		expect(rules.isOldProgram('byl-mail.exe.old-20261001202051')).toBe(true);
		expect(rules.isOldProgram('byl-backup.exe.old-20261001202051')).toBe(true);
		for (const name of ['byl-mail.exe', 'pocketbase.exe.old-20261001202051', 'byl-mail.exe.old-2026', 'x/byl-mail.exe.old-20261001202051']) {
			expect(rules.isOldProgram(name), name).toBe(false);
		}
		expect(rules.isAutoBackup('@auto_pb_backup_byl_20260901000000.zip')).toBe(true);
		for (const name of ['byl-20260901-000000.zip', '@auto_pb_backup_x.tar', 'a/@auto_pb_backup_x.zip']) {
			expect(rules.isAutoBackup(name), name).toBe(false);
		}
		expect(rules.isOldRestoreCopy('pb_data.vor-restore-2026-09-01')).toBe(true);
		for (const name of ['pb_data', 'pb_data.vor-wiederherstellung-20260901-000000', 'pb_data.vor-restore-']) {
			expect(rules.isOldRestoreCopy(name), name).toBe(false);
		}
	});

	it('takes only known groups, at least one, none twice', () => {
		expect(rules.leftoverGroupsViolation(['programs'])).toBe('');
		expect(rules.leftoverGroupsViolation(['programs', 'safety', 'pocketbase'])).toBe('');
		for (const groups of [undefined, null, 'programs', [], ['programs', 'programs'], ['backups'], [1]]) {
			expect(rules.leftoverGroupsViolation(groups), JSON.stringify(groups)).toBe('validation_storage_groups');
		}
		expect(rules.MESSAGES.validation_storage_groups).toMatch(/Bitte wählen/);
		expect(['vacuum', 'leftovers', 'discarded'].every(rules.isAction)).toBe(true);
		expect(['restart', '', '__proto__'].some(rules.isAction)).toBe(false);
	});
});

describe('summaries', () => {
	it('counts, sums and names the oldest and newest time', () => {
		const day = (text) => Date.parse(text);
		expect(
			rules.summarize([
				{ bytes: 10, time: day('2026-09-02T03:00:00Z') },
				{ bytes: 20, time: day('2026-09-01T03:00:00Z') },
				{ bytes: 5, time: null }
			])
		).toEqual({ count: 3, bytes: 35, oldest: '2026-09-01T03:00:00.000Z', newest: '2026-09-02T03:00:00.000Z' });
		expect(rules.summarize([])).toEqual({ count: 0, bytes: 0, oldest: null, newest: null });
	});

	it('lists the largest entries first, at most 20, equal sizes in their order', () => {
		const list = Array.from({ length: 25 }, (_, index) => ({ id: index, bytes: index % 5 }));
		const top = rules.largest(list);
		expect(top).toHaveLength(rules.LARGEST_MAX);
		expect(top.slice(0, 5).map((entry) => entry.id)).toEqual([4, 9, 14, 19, 24]);
		expect(rules.largest([{ bytes: 1 }, { bytes: 3 }], 1)).toEqual([{ bytes: 3 }]);
	});
});
