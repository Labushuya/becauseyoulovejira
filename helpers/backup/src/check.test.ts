// Check of an unpacked backup (ADR-0046 §6) on an invented data folder: the integrity of data.db,
// the counts of base and auth collections, and the files of file fields in storage (single and
// multiple, missing ones named only by collection and record). A broken database and a missing one
// are refused.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkData } from './check';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'byl-backup-check-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** A data folder with the tables PocketBase would have, two of them with file fields. */
function dataFolder() {
	const db = new DatabaseSync(join(dir, 'data.db'));
	db.exec(`
		CREATE TABLE _collections (id TEXT, name TEXT, type TEXT, fields TEXT);
		CREATE TABLE inbox_items (id TEXT, original TEXT);
		CREATE TABLE anhaenge (id TEXT, dateien TEXT);
		CREATE TABLE users (id TEXT);
		CREATE TABLE ansicht (id TEXT);
	`);
	const collection = db.prepare('INSERT INTO _collections VALUES (?, ?, ?, ?)');
	collection.run('pbc_inbox', 'inbox_items', 'base', JSON.stringify([{ name: 'original', type: 'file' }]));
	collection.run('pbc_anhang', 'anhaenge', 'base', JSON.stringify([{ name: 'dateien', type: 'file', maxSelect: 5 }]));
	collection.run('_pb_users_auth_', 'users', 'auth', JSON.stringify([{ name: 'avatar', type: 'text' }]));
	collection.run('pbc_ansicht', 'ansicht', 'view', '[]');
	const item = db.prepare('INSERT INTO inbox_items VALUES (?, ?)');
	item.run('eintrag0000001', 'mail_abc.eml');
	item.run('eintrag0000002', 'fehlt_xyz.eml');
	item.run('eintrag0000003', '');
	db.prepare('INSERT INTO anhaenge VALUES (?, ?)').run('anhang00000001', JSON.stringify(['a.txt', 'b.txt']));
	db.prepare('INSERT INTO users VALUES (?)').run('nutzer00000001');
	db.close();
	const file = (collection: string, record: string, name: string) => {
		mkdirSync(join(dir, 'storage', collection, record), { recursive: true });
		writeFileSync(join(dir, 'storage', collection, record, name), 'x');
	};
	file('pbc_inbox', 'eintrag0000001', 'mail_abc.eml');
	file('pbc_anhang', 'anhang00000001', 'a.txt');
	file('pbc_anhang', 'anhang00000001', 'b.txt');
}

describe('check of a data folder', () => {
	it('counts the collections and finds every file of a file field, or names the record', () => {
		dataFolder();
		expect(checkData(dir)).toEqual({
			integrity: ['ok'],
			counts: { anhaenge: 1, inbox_items: 3, users: 1 },
			files: { expected: 4, missing: 1, examples: ['inbox_items/eintrag0000002'] }
		});
	});

	it('names a file that is gone, but never its name', () => {
		dataFolder();
		rmSync(join(dir, 'storage', 'pbc_anhang', 'anhang00000001', 'b.txt'));
		const result = checkData(dir);
		expect(result.files).toEqual({
			expected: 4,
			missing: 2,
			examples: ['anhaenge/anhang00000001', 'inbox_items/eintrag0000002']
		});
		expect(JSON.stringify(result)).not.toContain('b.txt');
	});

	it('refuses a missing and a broken database', () => {
		expect(() => checkData(dir)).toThrow(/data.db is missing/);
		writeFileSync(join(dir, 'data.db'), 'kein SQLite');
		expect(() => checkData(dir)).toThrow(expect.objectContaining({ reason: 'damaged' }));
	});
});
