// Check of an unpacked backup (ADR-0046 §6): the database data.db is there and passes
// `PRAGMA integrity_check`, its collections are counted, and every file a record names in a file
// field (in the app: `inbox_items.original`) lies in `storage/<collection id>/<record id>/<file>`,
// where PocketBase keeps it. Reads a copy only (byl-control.ps1 unpacks the backup into a folder
// under Temp first) with the SQLite of Node; names of tables and fields come from the copy, so they
// are checked before they go into a statement.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BundleError } from './bundle';

const NAME = /^[A-Za-z0-9_]{1,100}$/;
const RECORD_ID = /^[A-Za-z0-9_]{1,64}$/;
const FILE_NAME = /^[^\\/:*?"<>|\x00-\x1f]{1,255}$/;
// Examples of missing files in the answer: collection and record only, never a file name (the
// names of originals can carry the subject of a mail).
const EXAMPLES_MAX = 10;

export interface CheckResult {
	/** The lines of `PRAGMA integrity_check`; ['ok'] for a sound database. */
	integrity: string[];
	/** Rows per collection (base and auth). */
	counts: Record<string, number>;
	files: { expected: number; missing: number; examples: string[] };
}

interface CollectionRow {
	id: unknown;
	name: unknown;
	fields: unknown;
}

function fileFieldsOf(raw: unknown): string[] {
	let fields: unknown;
	try {
		fields = JSON.parse(String(raw));
	} catch {
		return [];
	}
	if (!Array.isArray(fields)) return [];
	return fields
		.filter((field): field is { type: string; name: string } =>
			typeof field === 'object' && field !== null && field.type === 'file' && typeof field.name === 'string'
		)
		.map((field) => field.name)
		.filter((name) => NAME.test(name));
}

function filesOf(value: unknown): string[] {
	if (typeof value !== 'string' || value === '') return [];
	if (value.startsWith('[')) {
		try {
			const list: unknown = JSON.parse(value);
			return Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string' && name !== '') : [];
		} catch {
			return [value];
		}
	}
	return [value];
}

/** Checks the data folder `dir` (unpacked pb_data of a backup). */
export function checkData(dir: string): CheckResult {
	const database = join(dir, 'data.db');
	if (!existsSync(database) || !statSync(database).isFile()) {
		throw new BundleError('missing', 'data.db is missing');
	}
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(database);
	} catch (error) {
		throw new BundleError('damaged', `data.db does not open: ${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		let integrity: string[];
		try {
			integrity = db
				.prepare('PRAGMA integrity_check')
				.all()
				.map((row) => String(Object.values(row)[0]));
		} catch (error) {
			throw new BundleError('damaged', `integrity check failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		const result: CheckResult = { integrity, counts: {}, files: { expected: 0, missing: 0, examples: [] } };
		if (!(integrity.length === 1 && integrity[0] === 'ok')) return result;
		const collections = db
			.prepare("SELECT id, name, fields FROM _collections WHERE type IN ('base', 'auth') ORDER BY name")
			.all() as unknown as CollectionRow[];
		for (const collection of collections) {
			const id = String(collection.id);
			const name = String(collection.name);
			if (!NAME.test(name) || !NAME.test(id)) continue;
			const counted = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number } | undefined;
			result.counts[name] = Number(counted?.n ?? 0);
			for (const field of fileFieldsOf(collection.fields)) {
				const rows = db.prepare(`SELECT id, "${field}" AS value FROM "${name}" WHERE "${field}" != ''`).all();
				for (const row of rows) {
					const recordId = String(row.id);
					for (const file of filesOf(row.value)) {
						result.files.expected += 1;
						const valid = RECORD_ID.test(recordId) && FILE_NAME.test(file) && file !== '.' && file !== '..';
						if (valid && existsSync(join(dir, 'storage', id, recordId, file))) continue;
						result.files.missing += 1;
						if (result.files.examples.length < EXAMPLES_MAX) result.files.examples.push(`${name}/${recordId}`);
					}
				}
			}
		}
		return result;
	} finally {
		db.close();
	}
}
