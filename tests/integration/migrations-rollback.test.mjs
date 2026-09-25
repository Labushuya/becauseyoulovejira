// Every migration has a working rollback: `migrate up` -> `migrate down <all>` -> `migrate up`
// in an own disposable data folder, without `serve` (E1 plan, package 3; ADR-0004).

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
	APP_MIGRATIONS_DIR,
	runPocketBase,
	withTempDataDir
} from '../support/pocketbase-harness.mjs';
import {
	DEFAULT_BACKUPS,
	DEFAULT_USERS_RULES,
	EXPECTED_BACKUPS,
	EXPECTED_COLLECTIONS,
	RULE_NAMES,
	assertSchema,
	readDataDir
} from '../support/schema.mjs';

const RULES_MIGRATION = '1790200900_api_rules.js';
// First migration of E4 (docs/plan/e4.md); everything from here on runs on existing data.
const E4_FIRST_MIGRATION = '1790201200_create_inbox_items.js';
const MIGRATION_FILES = readdirSync(APP_MIGRATIONS_DIR)
	.filter((name) => name.endsWith('.js'))
	.sort();

// `migrate down <n>` counts PocketBase's own system migrations as well, so exactly the number
// of app migrations is reverted and the output is checked for the expected files.
async function migrate(args, ...command) {
	const input = command[0] === 'down' ? 'y\n' : undefined;
	const result = await runPocketBase(['migrate', ...command, ...args], { input });
	expect(result.code, result.output).toBe(0);
	return result.output;
}

function appliedFiles(output, verb) {
	// The first "Reverted" line follows the confirmation prompt on the same line.
	return [...output.matchAll(new RegExp(`\\b${verb} (\\S+\\.(?:js|go))\\b`, 'g'))].map(
		(match) => match[1]
	);
}

/** authAlert.enabled per auth collection (users and the superusers). */
function authAlerts(collections) {
	return Object.fromEntries(
		collections
			.filter((collection) => collection.type === 'auth')
			.map((collection) => [collection.name, collection.authAlert.enabled])
	);
}

function withoutTimestamps(collections) {
	return collections.map(({ created, updated, ...rest }) => rest);
}

describe('migration rollback', () => {
	it(
		'runs up, down for all app migrations and up again with an identical schema',
		async () => {
			expect(MIGRATION_FILES.length).toBeGreaterThan(0);

			await withTempDataDir(async ({ dataDir, args }) => {
				const firstUp = await migrate(args, 'up');
				expect(appliedFiles(firstUp, 'Applied')).toEqual(MIGRATION_FILES);
				const first = readDataDir(dataDir);
				assertSchema(first.collections);
				expect(first.settings.backups).toMatchObject(EXPECTED_BACKUPS);
				expect(first.userCount).toBe(0);
				expect(first.superuserCount).toBe(0);
				expect(authAlerts(first.collections)).toEqual({ _superusers: false, users: false });

				// Rolling back to before the API rules (package 4) leaves every rule null again.
				const fromRules = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(RULES_MIGRATION));
				expect(fromRules[0]).toBe(RULES_MIGRATION);
				const rulesDown = await migrate(args, 'down', String(fromRules.length));
				expect(appliedFiles(rulesDown, 'Reverted')).toEqual([...fromRules].reverse());
				for (const collection of readDataDir(dataDir).collections) {
					if (!(collection.name in EXPECTED_COLLECTIONS)) continue;
					for (const rule of RULE_NAMES) {
						expect(collection[rule], `${collection.name}.${rule} after rules down`).toBeNull();
					}
				}
				const rulesUp = await migrate(args, 'up');
				expect(appliedFiles(rulesUp, 'Applied')).toEqual(fromRules);
				assertSchema(readDataDir(dataDir).collections);

				const down = await migrate(args, 'down', String(MIGRATION_FILES.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...MIGRATION_FILES].reverse());
				const reverted = readDataDir(dataDir);
				const names = reverted.collections.map((collection) => collection.name);
				for (const name of Object.keys(EXPECTED_COLLECTIONS)) {
					expect(names, `${name} removed`).not.toContain(name);
				}
				const users = reverted.collections.find((collection) => collection.name === 'users');
				for (const rule of RULE_NAMES) {
					expect(users[rule], `users.${rule}`).toBe(DEFAULT_USERS_RULES[rule]);
				}
				expect(reverted.settings.backups).toMatchObject(DEFAULT_BACKUPS);
				expect(authAlerts(reverted.collections)).toEqual({ _superusers: true, users: true });

				const secondUp = await migrate(args, 'up');
				expect(appliedFiles(secondUp, 'Applied')).toEqual(MIGRATION_FILES);
				const second = readDataDir(dataDir);
				assertSchema(second.collections);
				expect(withoutTimestamps(second.collections)).toEqual(
					withoutTimestamps(first.collections)
				);
				expect(second.settings.backups).toEqual(first.settings.backups);
			});
		},
		60_000
	);

	it(
		'keeps existing rows unchanged when the E4 migrations run and are rolled back',
		async () => {
			const e4 = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(E4_FIRST_MIGRATION));
			expect(e4[0]).toBe(E4_FIRST_MIGRATION);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				const down = await migrate(args, 'down', String(e4.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...e4].reverse());

				// Data as it exists before E4, written straight into the database.
				withDatabase(dataDir, (db) => {
					db.prepare(
						"INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)"
					).run('user00000000001', 'alt@example.invalid', 'tk', 'hash', STAMP, STAMP);
					const insert = db.prepare(
						'INSERT INTO tickets (id, number, key, title, description, status, priority, due, scope, owner, created, updated) ' +
							'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					insert.run('ticket000000001', 1, 'TASK-1', 'Alt', 'Text', 'open', 'high', '', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					insert.run('ticket000000002', 2, 'TASK-2', 'Erledigt', '', 'done', 'low', '2026-09-01 00:00:00.000Z', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
				});
				const before = withDatabase(dataDir, snapshot);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(e4);
				const migrated = withDatabase(dataDir, snapshot);
				expect(migrated.tickets.map(({ source, source_item, ...rest }) => rest)).toEqual(before.tickets);
				expect(migrated.tickets.map(({ source, source_item }) => ({ source, source_item }))).toEqual([
					{ source: '', source_item: '' },
					{ source: '', source_item: '' }
				]);
				// The base line of "new" (ADR-0015) is the only value an existing row gets.
				expect(migrated.users.map(({ unread_since, ...rest }) => rest)).toEqual(before.users);
				for (const user of migrated.users) {
					expect(user.unread_since).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);
				}
				expect(migrated.inbox_items).toEqual([]);
				expect(migrated.ticket_reads).toEqual([]);

				await migrate(args, 'down', String(e4.length));
				const reverted = withDatabase(dataDir, snapshot);
				expect(reverted).toEqual(before);
			});
		},
		60_000
	);

	it(
		'keeps inbox items unchanged when the connections come and go (package 10)',
		async () => {
			const fromConnections = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(CONNECTIONS_MIGRATION));
			expect(fromConnections.slice(0, 2)).toEqual([CONNECTIONS_MIGRATION, INBOX_CONNECTION_MIGRATION]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromConnections.length));
				withDatabase(dataDir, (db) => {
					db.prepare(
						'INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)'
					).run('user00000000001', 'alt@example.invalid', 'tk', 'hash', STAMP, STAMP);
					const insert = db.prepare(
						'INSERT INTO inbox_items (id, channel, kind, title, body, source_ref, source_meta, fingerprint, state, scope, owner, created, updated) ' +
							'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					insert.run('item00000000001', 'ics', 'event', 'Termin', 'Text', 'uid-1', '{"all_day":true}', 'f1', 'new', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					insert.run('item00000000002', 'eml', 'mail', 'Mail', '', '<a@b>', 'null', 'f2', 'discarded', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
				});
				const before = withDatabase(dataDir, snapshot);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromConnections);
				const migrated = withDatabase(dataDir, snapshot);
				expect(migrated.inbox_items.map(({ connection, ...rest }) => rest)).toEqual(before.inbox_items);
				expect(migrated.inbox_items.map((item) => item.connection)).toEqual(['', '']);
				expect(migrated.connections).toEqual([]);

				// A connection with an item of its own, then back down: the items stay as they were.
				withDatabase(dataDir, (db) => {
					db.prepare(
						'INSERT INTO connections (id, type, label, enabled, secret_env, settings, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).run('conn00000000001', 'calendar', 'Kalender', 1, 'BYL_TEST_CALENDAR', '{}', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					db.prepare('UPDATE inbox_items SET connection = ? WHERE id = ?').run('conn00000000001', 'item00000000001');
				});
				await migrate(args, 'down', String(fromConnections.length));
				const reverted = withDatabase(dataDir, snapshot);
				expect(reverted.inbox_items).toEqual(before.inbox_items);
				expect(reverted.connections).toBeNull();
				expect(reverted.users).toEqual(before.users);
			});
		},
		60_000
	);
});

const CONNECTIONS_MIGRATION = '1790201400_create_connections.js';
const INBOX_CONNECTION_MIGRATION = '1790201410_inbox_items_connection.js';

const STAMP = '2026-09-01 10:00:00.000Z';

function withDatabase(dataDir, fn) {
	const db = new DatabaseSync(join(dataDir, 'data.db'));
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

/** Rows of the tables the E4 migrations touch; a missing table gives null. */
function snapshot(db) {
	const exists = (table) =>
		db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
	const rows = (table) => (exists(table) ? db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() : null);
	return {
		users: rows('users'),
		tickets: rows('tickets'),
		inbox_items: rows('inbox_items'),
		ticket_reads: rows('ticket_reads'),
		connections: rows('connections')
	};
}
