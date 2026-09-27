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
				// The base line of "new" (ADR-0015) is the only value an existing row gets; the keyword
				// lists of the file imports (package 21) stay empty.
				expect(migrated.users.map(({ unread_since, import_keywords, ...rest }) => rest)).toEqual(before.users);
				expect(migrated.users.map((user) => user.import_keywords)).toEqual([null]);
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

	it(
		'keeps users unchanged when the keywords of the file imports come and go (package 21)',
		async () => {
			const fromKeywords = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(IMPORT_KEYWORDS_MIGRATION));
			expect(fromKeywords[0]).toBe(IMPORT_KEYWORDS_MIGRATION);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromKeywords.length));
				withDatabase(dataDir, (db) => {
					const insert = db.prepare(
						'INSERT INTO users (id, email, tokenKey, password, unread_since, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'
					);
					insert.run('user00000000001', 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP, STAMP);
					insert.run('user00000000002', 'zwei@example.invalid', 'tk2', 'hash', '', STAMP, STAMP);
				});
				const before = withDatabase(dataDir, snapshot);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromKeywords);
				const migrated = withDatabase(dataDir, snapshot);
				expect(migrated.users.map(({ import_keywords, ...rest }) => rest)).toEqual(before.users);
				expect(migrated.users.map((user) => user.import_keywords)).toEqual([null, null]);

				// Lists for one user, then back down: the other columns stay as they were.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE users SET import_keywords = ? WHERE id = ?').run(
						'{"ics":{"keywords":["todo"]}}',
						'user00000000001'
					);
				});
				await migrate(args, 'down', String(fromKeywords.length));
				const reverted = withDatabase(dataDir, snapshot);
				expect(reverted.users).toEqual(before.users);
				expect(reverted.inbox_items).toEqual(before.inbox_items);
			});
		},
		60_000
	);
});

const SCAN_MIGRATION = '1790201700_connections_scan.js';

describe('migration rollback of the full inbox scan (ADR-0020, addendum 3)', () => {
	it(
		'switches match_body on for existing mailboxes and exactly those off again, without other changes',
		async () => {
			const fromScan = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(SCAN_MIGRATION));
			expect(fromScan[0]).toBe(SCAN_MIGRATION);
			const jsonOf = (value) => (value === null || value === '' || value === 'null' ? null : JSON.parse(value));
			const byId = (rows, field) => Object.fromEntries(rows.map((row) => [row.id, jsonOf(row[field])]));

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromScan.length));
				withDatabase(dataDir, (db) => {
					db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(
						'user00000000001',
						'eins@example.invalid',
						'tk1',
						'hash',
						STAMP,
						STAMP
					);
					const insert = db.prepare(
						'INSERT INTO connections (id, type, label, enabled, secret_env, settings, cursor, scope, owner, created, updated) ' +
							'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					const row = (id, type, secret, settings, cursor) =>
						insert.run(id, type, id, 1, secret, settings, cursor, 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					row('mail00000000001', 'mail', 'BYL_A', '{"provider":"webde","user":"a@web.de","keywords":["todo"]}', '1700000000:5');
					row('mail00000000002', 'mail', 'BYL_B', '{"provider":"webde","user":"b@web.de","keywords":[],"match_body":false}', '');
					row('mail00000000003', 'mail', 'BYL_C', '{"provider":"gmail","user":"c@gmail.com","match_body":true}', '');
					row('cal000000000004', 'calendar', 'BYL_D', '{"keywords":["termin"]}', '');
				});
				const before = withDatabase(dataDir, snapshot);
				const settingsBefore = byId(before.connections, 'settings');

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromScan);
				const migrated = withDatabase(dataDir, snapshot);
				expect(byId(migrated.connections, 'settings')).toEqual({
					mail00000000001: { ...settingsBefore.mail00000000001, match_body: true },
					mail00000000002: { ...settingsBefore.mail00000000002, match_body: true },
					mail00000000003: settingsBefore.mail00000000003,
					cal000000000004: settingsBefore.cal000000000004
				});
				expect(byId(migrated.connections, 'scan')).toEqual({
					mail00000000001: { match_body_before: false },
					mail00000000002: { match_body_before: false },
					mail00000000003: null,
					cal000000000004: null
				});
				// Nothing else changes, not even `updated`.
				expect(withoutFields(migrated.connections, ['settings', 'scan'])).toEqual(
					withoutFields(before.connections, ['settings'])
				);

				// Later the helper stores a scan (the hook keeps the mark), and the user switches the
				// second mailbox off again himself.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE connections SET scan = ? WHERE id = ?').run(
						'{"signature":"0123456789abcdef","state":"done","uid_validity":"1700000000","until":5,"below":0,"done":5,"total":5,"created":1,"fallback":false,"match_body_before":false}',
						'mail00000000001'
					);
					db.prepare('UPDATE connections SET settings = ? WHERE id = ?').run(
						'{"provider":"webde","user":"b@web.de","keywords":[],"match_body":false}',
						'mail00000000002'
					);
				});

				const down = await migrate(args, 'down', String(fromScan.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromScan].reverse());
				const reverted = withDatabase(dataDir, snapshot);
				expect(byId(reverted.connections, 'settings')).toEqual({
					mail00000000001: { ...settingsBefore.mail00000000001, match_body: false },
					mail00000000002: settingsBefore.mail00000000002,
					mail00000000003: settingsBefore.mail00000000003,
					cal000000000004: settingsBefore.cal000000000004
				});
				expect(reverted.connections.every((row) => !('scan' in row))).toBe(true);
				expect(withoutFields(reverted.connections, ['settings'])).toEqual(
					withoutFields(before.connections, ['settings'])
				);

				// And up again.
				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromScan);
			});
		},
		60_000
	);
});

const DELETE_GUARD_MIGRATION = '1790201800_inbox_items_delete_guard.js';

describe('migration rollback of the delete guard of sources (ADR-0031 section 3)', () => {
	it(
		'changes only the deleteRule of inbox_items, there and back, and keeps every row',
		async () => {
			const fromGuard = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(DELETE_GUARD_MIGRATION));
			expect(fromGuard[0]).toBe(DELETE_GUARD_MIGRATION);
			const deleteRuleOf = (dataDir) =>
				readDataDir(dataDir).collections.find((collection) => collection.name === 'inbox_items').deleteRule;

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				const guarded = deleteRuleOf(dataDir);
				await migrate(args, 'down', String(fromGuard.length));
				const before = deleteRuleOf(dataDir);
				expect(guarded).toBe(`${before} && ticket = ""`);

				// A ticket with its main source, a linked, a new and a discarded item.
				withDatabase(dataDir, (db) => {
					db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(
						'user00000000001',
						'eins@example.invalid',
						'tk1',
						'hash',
						STAMP,
						STAMP
					);
					const item = db.prepare(
						'INSERT INTO inbox_items (id, channel, kind, title, body, fingerprint, state, ticket, handled_at, scope, owner, created, updated) ' +
							'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					item.run('item00000000001', 'eml', 'mail', 'Hauptquelle', 'Text', 'f1', 'converted', 'ticket000000001', STAMP, 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					item.run('item00000000002', 'telegram', 'message', 'Verknüpft', '', 'f2', 'converted', 'ticket000000001', STAMP, 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					item.run('item00000000003', 'manual', 'todo', 'Neu', '', 'f3', 'new', '', '', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					item.run('item00000000004', 'link', 'link', 'Verworfen', '', 'f4', 'discarded', '', STAMP, 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					db.prepare(
						'INSERT INTO tickets (id, number, key, title, status, priority, source, source_item, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).run('ticket000000001', 1, 'TASK-1', 'Mit Quellen', 'open', 'medium', 'eml', 'item00000000001', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
				});
				const rows = withDatabase(dataDir, snapshot);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromGuard);
				expect(deleteRuleOf(dataDir)).toBe(guarded);
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);

				const down = await migrate(args, 'down', String(fromGuard.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromGuard].reverse());
				expect(deleteRuleOf(dataDir)).toBe(before);
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromGuard);
				expect(deleteRuleOf(dataDir)).toBe(guarded);
			});
		},
		60_000
	);
});

const ORPHANS_MIGRATION = '1790201900_inbox_items_orphans.js';

describe('migration rollback of the orphaned sources (ADR-0031, addendum B)', () => {
	it(
		'gives converted items without a ticket back to the inbox, there and back, and leaves the rest',
		async () => {
			const fromOrphans = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(ORPHANS_MIGRATION));
			expect(fromOrphans[0]).toBe(ORPHANS_MIGRATION);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromOrphans.length));

				// Two orphans (one with, one without source_meta), a source with its ticket, a new and a
				// discarded item.
				withDatabase(dataDir, (db) => {
					db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(
						'user00000000001',
						'eins@example.invalid',
						'tk1',
						'hash',
						STAMP,
						STAMP
					);
					const item = db.prepare(
						'INSERT INTO inbox_items (id, channel, kind, title, body, fingerprint, state, ticket, handled_at, source_meta, scope, owner, created, updated) ' +
							'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					const scope = 'u:user00000000001';
					const owner = 'user00000000001';
					item.run('item00000000001', 'eml', 'mail', 'Verwaist', 'Text', 'f1', 'converted', '', '2026-09-02 08:00:00.000Z', '{"from":"a@example.com"}', scope, owner, STAMP, STAMP);
					item.run('item00000000002', 'telegram', 'message', 'Verwaist ohne Meta', '', 'f2', 'converted', '', '2026-09-03 08:00:00.000Z', null, scope, owner, STAMP, STAMP);
					item.run('item00000000003', 'manual', 'todo', 'Quelle', '', 'f3', 'converted', 'ticket000000001', STAMP, '{}', scope, owner, STAMP, STAMP);
					item.run('item00000000004', 'manual', 'todo', 'Neu', '', 'f4', 'new', '', '', null, scope, owner, STAMP, STAMP);
					item.run('item00000000005', 'link', 'link', 'Verworfen', '', 'f5', 'discarded', '', STAMP, '{"keyword":"x"}', scope, owner, STAMP, STAMP);
					db.prepare(
						'INSERT INTO tickets (id, number, key, title, status, priority, source, source_item, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).run('ticket000000001', 1, 'TASK-1', 'Mit Quelle', 'open', 'medium', 'manual', 'item00000000003', scope, owner, STAMP, STAMP);
				});
				const rows = withDatabase(dataDir, snapshot);
				const byId = (snap) => Object.fromEntries(snap.inbox_items.map((row) => [row.id, row]));

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromOrphans);
				const after = withDatabase(dataDir, snapshot);
				const items = byId(after);
				for (const id of ['item00000000001', 'item00000000002']) {
					expect(items[id]).toMatchObject({ state: 'new', ticket: '', handled_at: '', updated: STAMP });
					const note = JSON.parse(items[id].source_meta).ticket_deleted;
					expect(note.key).toBe('');
					expect(note.at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
				}
				expect(JSON.parse(items.item00000000001.source_meta).from).toBe('a@example.com');
				// Everything else is untouched, the text and the fingerprint of the orphans as well.
				const before = byId(rows);
				for (const id of ['item00000000003', 'item00000000004', 'item00000000005']) {
					expect(items[id]).toEqual(before[id]);
				}
				expect(withoutFields(after.inbox_items, ['state', 'handled_at', 'source_meta'])).toEqual(
					withoutFields(rows.inbox_items, ['state', 'handled_at', 'source_meta'])
				);
				expect(after.tickets).toEqual(rows.tickets);

				const down = await migrate(args, 'down', String(fromOrphans.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromOrphans].reverse());
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromOrphans);
				expect(byId(withDatabase(dataDir, snapshot)).item00000000002.state).toBe('new');
			});
		},
		60_000
	);
});

const CONNECTIONS_MIGRATION = '1790201400_create_connections.js';
const IMPORT_KEYWORDS_MIGRATION = '1790201500_users_import_keywords.js';
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

/** Rows of the tables the E4 and E5 migrations touch; a missing table gives null. */
function snapshot(db) {
	const exists = (table) =>
		db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
	const rows = (table) => (exists(table) ? db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() : null);
	return {
		users: rows('users'),
		tickets: rows('tickets'),
		inbox_items: rows('inbox_items'),
		ticket_reads: rows('ticket_reads'),
		connections: rows('connections'),
		recurrence_rules: rows('recurrence_rules')
	};
}

const E5_FIRST_MIGRATION = '1790201600_recurrence_rule_params.js';
const E5_RULE_FIELDS = ['freq', 'interval', 'weekdays', 'month_day', 'anchor', 'lead_days', 'scope', 'last_hint'];
const INCOMPLETE_HINT = 'Regel unvollständig – bitte Rhythmus wählen.';

function withoutFields(rows, fields) {
	return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([name]) => !fields.includes(name))));
}

/** Data as it exists before E5: users, rules with the base fields only, tickets with and without a rule. */
function insertPreE5Data(db) {
	const user = db.prepare(
		'INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)'
	);
	user.run('user00000000001', 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
	db.prepare('INSERT INTO households (id, name, created, updated) VALUES (?, ?, ?, ?)').run(
		'household000001',
		'Haus',
		STAMP,
		STAMP
	);
	const rule = db.prepare(
		'INSERT INTO recurrence_rules (id, title, description, priority, mode, next_due, last_generated_at, active, owner, household, created, updated) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	);
	rule.run('rule00000000001', 'Müll', 'Text', 'high', 'calendar', '2026-09-28 00:00:00.000Z', '', 1, 'user00000000001', '', STAMP, STAMP);
	rule.run('rule00000000002', 'Blumen', '', '', 'after_completion', '', '2026-09-01 08:00:00.000Z', 0, 'user00000000001', 'household000001', STAMP, STAMP);
	const ticket = db.prepare(
		'INSERT INTO tickets (id, number, key, title, status, priority, due, completed_at, recurrence, scope, owner, created, updated) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	);
	ticket.run('ticket000000001', 1, 'TASK-1', 'Müll (erledigt)', 'done', 'high', '2026-09-14 00:00:00.000Z', '2026-09-14 09:00:00.000Z', 'rule00000000001', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
	ticket.run('ticket000000002', 2, 'TASK-2', 'Müll (erledigt)', 'done', 'high', '2026-09-21 00:00:00.000Z', '2026-09-21 09:00:00.000Z', 'rule00000000001', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
	ticket.run('ticket000000003', 3, 'TASK-3', 'Müll', 'open', 'high', '2026-09-28 00:00:00.000Z', '', 'rule00000000001', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
	ticket.run('ticket000000004', 4, 'TASK-4', 'Ohne Serie', 'in_progress', 'low', '', '', '', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
}

describe('migration rollback of E5 (package 2)', () => {
	it(
		'keeps tickets unchanged and pauses rules without a rhythm, there and back',
		async () => {
			const e5 = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(E5_FIRST_MIGRATION));
			expect(e5.slice(0, 2)).toEqual([E5_FIRST_MIGRATION, '1790201610_tickets_open_recurrence.js']);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(e5.length));
				withDatabase(dataDir, insertPreE5Data);
				const before = withDatabase(dataDir, snapshot);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(e5);
				const migrated = withDatabase(dataDir, snapshot);
				expect(migrated.tickets).toEqual(before.tickets);
				expect(migrated.users).toEqual(before.users);
				// The base fields stay, except that a rule without a rhythm is paused.
				expect(withoutFields(migrated.recurrence_rules, [...E5_RULE_FIELDS, 'active'])).toEqual(
					withoutFields(before.recurrence_rules, ['active'])
				);
				expect(
					migrated.recurrence_rules.map(({ id, active, freq, interval, weekdays, month_day, anchor, lead_days, scope, last_hint }) => ({
						id,
						active,
						freq,
						interval,
						weekdays,
						month_day,
						anchor,
						lead_days,
						scope,
						last_hint
					}))
				).toEqual([
					{ id: 'rule00000000001', active: 0, freq: '', interval: 0, weekdays: '[]', month_day: 0, anchor: '', lead_days: 3, scope: 'u:user00000000001', last_hint: INCOMPLETE_HINT },
					{ id: 'rule00000000002', active: 0, freq: '', interval: 0, weekdays: '[]', month_day: 0, anchor: '', lead_days: 3, scope: 'h:household000001', last_hint: INCOMPLETE_HINT }
				]);

				// A second open instance of the rule is refused by the partial index; done ones are not.
				withDatabase(dataDir, (db) => {
					const insert = db.prepare(
						'INSERT INTO tickets (id, number, key, title, status, priority, recurrence, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					expect(() =>
						insert.run('ticket000000005', 5, 'TASK-5', 'Zweite', 'open', 'low', 'rule00000000001', 'u:user00000000001', 'user00000000001', STAMP, STAMP)
					).toThrow(/UNIQUE constraint failed/);
					insert.run('ticket000000006', 6, 'TASK-6', 'Erledigt', 'done', 'low', 'rule00000000001', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					db.prepare('DELETE FROM tickets WHERE id = ?').run('ticket000000006');
				});

				const down = await migrate(args, 'down', String(e5.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...e5].reverse());
				const reverted = withDatabase(dataDir, snapshot);
				expect(reverted.tickets).toEqual(before.tickets);
				expect(reverted.users).toEqual(before.users);
				expect(reverted.recurrence_rules).toEqual(withoutFields(migrated.recurrence_rules, E5_RULE_FIELDS));
			});
		},
		60_000
	);

	it(
		'keeps only the newest open ticket of a rule linked when older data has several',
		async () => {
			const e5 = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(E5_FIRST_MIGRATION));
			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(e5.length));
				withDatabase(dataDir, (db) => {
					insertPreE5Data(db);
					db.prepare(
						'INSERT INTO tickets (id, number, key, title, status, priority, recurrence, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).run('ticket000000009', 9, 'TASK-9', 'Später', 'waiting', 'low', 'rule00000000001', 'u:user00000000001', 'user00000000001', '2026-09-02 10:00:00.000Z', STAMP);
				});
				const before = withDatabase(dataDir, snapshot);

				await migrate(args, 'up');
				const migrated = withDatabase(dataDir, snapshot);
				const byId = Object.fromEntries(migrated.tickets.map((ticket) => [ticket.id, ticket]));
				// TASK-3 (older, open) leaves the series; TASK-9 (newest open) and the done ones stay.
				expect(byId.ticket000000003.recurrence).toBe('');
				expect(byId.ticket000000009.recurrence).toBe('rule00000000001');
				expect(byId.ticket000000001.recurrence).toBe('rule00000000001');
				expect(byId.ticket000000002.recurrence).toBe('rule00000000001');
				expect(withoutFields(migrated.tickets, ['recurrence'])).toEqual(withoutFields(before.tickets, ['recurrence']));
			});
		},
		60_000
	);
});
