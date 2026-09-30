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
	CHANNELS,
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
				// occurrence and the fields of the trash come with later migrations (plan OR-5, ADR-0037)
				// that `up` runs along.
				expect(
					migrated.tickets.map(({ source, source_item, occurrence, deleted_at, deleted_by, trash, ...rest }) => rest)
				).toEqual(before.tickets);
				expect(migrated.tickets.map(({ source, source_item }) => ({ source, source_item }))).toEqual([
					{ source: '', source_item: '' },
					{ source: '', source_item: '' }
				]);
				// The base line of "new" (ADR-0015) is the only value an existing row gets; the keyword
				// lists of the file imports (package 21) stay empty.
				expect(migrated.users.map(({ unread_since, import_keywords, trash_retention, ...rest }) => rest)).toEqual(before.users);
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
				expect(migrated.users.map(({ import_keywords, trash_retention, ...rest }) => rest)).toEqual(before.users);
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
				expect(withoutLater(withDatabase(dataDir, snapshot))).toEqual(rows);

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
				expect(withoutFields(after.tickets, LATER_TICKET_FIELDS)).toEqual(rows.tickets);

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

const ORIGINAL_SIZE_MIGRATION = '1790202000_inbox_items_original_size.js';

describe('migration rollback of the 25 MB originals (ADR-0031, addendum D)', () => {
	it(
		'changes only the maxSize of inbox_items.original, there and back, and keeps every row',
		async () => {
			const fromSize = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(ORIGINAL_SIZE_MIGRATION));
			expect(fromSize[0]).toBe(ORIGINAL_SIZE_MIGRATION);
			const originalOf = (dataDir) =>
				readDataDir(dataDir)
					.collections.find((collection) => collection.name === 'inbox_items')
					.fields.find((field) => field.name === 'original');

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				expect(originalOf(dataDir).maxSize).toBe(25 * 1024 * 1024);
				await migrate(args, 'down', String(fromSize.length));
				expect(originalOf(dataDir).maxSize).toBe(10 * 1024 * 1024);

				// Entries with and without an original file.
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
						'INSERT INTO inbox_items (id, channel, kind, title, body, fingerprint, state, original, scope, owner, created, updated) ' +
							'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					item.run('item00000000001', 'eml', 'mail', 'Mit Datei', 'Text', 'f1', 'new', 'mail_abc.eml', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
					item.run('item00000000002', 'mail', 'mail', 'Ohne Datei', '', 'f2', 'new', '', 'u:user00000000001', 'user00000000001', STAMP, STAMP);
				});
				const rows = withDatabase(dataDir, snapshot);
				// `up` also runs the later migrations; their changes (projects.parent, ADR-0034; the
				// fields and index of "Jeden Termin einzeln anlegen", plan OR-5; the trash, ADR-0037) are
				// left out.
				const others = (dataDir) =>
					withoutLaterCollections(withoutTimestamps(readDataDir(dataDir).collections)).map((collection) => {
						if (collection.name === 'inbox_items') {
							const plain = withoutLaterSchema(collection);
							return { ...plain, fields: plain.fields.filter((field) => field.name !== 'original') };
						}
						if (collection.name === 'projects') {
							return {
								...collection,
								fields: collection.fields.filter((field) => field.name !== 'parent'),
								indexes: collection.indexes.filter((index) => !/idx_projects_parent/.test(index))
							};
						}
						return withoutLaterSchema(collection);
					});
				const before = others(dataDir);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromSize);
				expect(originalOf(dataDir)).toMatchObject({ maxSize: 25 * 1024 * 1024, maxSelect: 1, protected: true });
				expect(others(dataDir)).toEqual(before);
				expect(withoutLater(withDatabase(dataDir, snapshot))).toEqual(rows);

				const down = await migrate(args, 'down', String(fromSize.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromSize].reverse());
				expect(originalOf(dataDir).maxSize).toBe(10 * 1024 * 1024);
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);
			});
		},
		60_000
	);
});

const PARENT_MIGRATION = '1790202100_projects_parent.js';

describe('migration rollback of the sub projects (ADR-0034)', () => {
	it(
		'adds only projects.parent and its index, and the way back loses only the hierarchy',
		async () => {
			const fromParent = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(PARENT_MIGRATION));
			expect(fromParent[0]).toBe(PARENT_MIGRATION);
			const projectsOf = (dataDir) =>
				readDataDir(dataDir).collections.find((collection) => collection.name === 'projects');
			const hasParent = (dataDir) =>
				projectsOf(dataDir).fields.some((field) => field.name === 'parent');
			const projectRows = (db) => db.prepare('SELECT * FROM projects ORDER BY id').all();
			const counterRows = (db) => db.prepare('SELECT * FROM ticket_counters ORDER BY id').all();

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				expect(hasParent(dataDir)).toBe(true);
				await migrate(args, 'down', String(fromParent.length));
				expect(hasParent(dataDir)).toBe(false);

				// Projects, tickets in them and counters as they exist before the migration.
				withDatabase(dataDir, (db) => {
					db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(
						'user00000000001',
						'eins@example.invalid',
						'tk1',
						'hash',
						STAMP,
						STAMP
					);
					const scope = 'u:user00000000001';
					const project = db.prepare(
						'INSERT INTO projects (id, name, code, archived, owner, household, scope, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					project.run('project00000001', 'Haus', 'HAUS', 0, 'user00000000001', '', scope, STAMP, STAMP);
					project.run('project00000002', 'Garten', 'GART', 1, 'user00000000001', '', scope, STAMP, STAMP);
					const ticket = db.prepare(
						'INSERT INTO tickets (id, number, key, title, status, priority, project, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					ticket.run('ticket000000001', 1, 'HAUS-1', 'Dach', 'open', 'medium', 'project00000001', scope, 'user00000000001', STAMP, STAMP);
					ticket.run('ticket000000002', 1, 'GART-1', 'Beet', 'done', 'low', 'project00000002', scope, 'user00000000001', STAMP, STAMP);
					const counter = db.prepare('INSERT INTO ticket_counters (id, key, value) VALUES (?, ?, ?)');
					counter.run('counter00000001', `${scope}:project00000001`, 1);
					counter.run('counter00000002', `${scope}:project00000002`, 1);
				});
				const before = withDatabase(dataDir, (db) => ({
					projects: projectRows(db),
					tickets: snapshot(db).tickets,
					counters: counterRows(db)
				}));
				// The later migrations of "Jeden Termin einzeln anlegen" (plan OR-5) and of the trash
				// (ADR-0037) run along; their fields, indexes and rule conditions are left out.
				const others = (dir) =>
					withoutLaterCollections(withoutTimestamps(readDataDir(dir).collections))
						.filter((collection) => collection.name !== 'projects')
						.map(withoutLaterSchema);
				const otherCollections = others(dataDir);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromParent);
				const migrated = projectsOf(dataDir);
				expect(migrated.fields.find((field) => field.name === 'parent')).toMatchObject({
					type: 'relation',
					collectionId: migrated.id,
					maxSelect: 1,
					cascadeDelete: false,
					required: false
				});
				expect(migrated.indexes.some((index) => /idx_projects_parent/.test(index))).toBe(true);
				assertSchema(readDataDir(dataDir).collections);
				expect(others(dataDir)).toEqual(otherCollections);
				withDatabase(dataDir, (db) => {
					// Existing projects stay top-level; nothing else changes.
					expect(projectRows(db)).toEqual(before.projects.map((row) => ({ ...row, parent: '' })));
					expect(withoutFields(snapshot(db).tickets, LATER_TICKET_FIELDS)).toEqual(before.tickets);
					expect(counterRows(db)).toEqual(before.counters);
					// The hierarchy that is lost on the way back.
					db.prepare('UPDATE projects SET parent = ? WHERE id = ?').run('project00000001', 'project00000002');
				});

				const down = await migrate(args, 'down', String(fromParent.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromParent].reverse());
				expect(hasParent(dataDir)).toBe(false);
				expect(projectsOf(dataDir).indexes.some((index) => /idx_projects_parent/.test(index))).toBe(
					false
				);
				withDatabase(dataDir, (db) => {
					expect(projectRows(db)).toEqual(before.projects);
					expect(snapshot(db).tickets).toEqual(before.tickets);
					expect(counterRows(db)).toEqual(before.counters);
				});
				expect(others(dataDir)).toEqual(otherCollections);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromParent);
				withDatabase(dataDir, (db) => {
					expect(projectRows(db)).toEqual(before.projects.map((row) => ({ ...row, parent: '' })));
				});
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
// Fields of the later migration of "Jeden Termin einzeln anlegen" (plan OR-5), which the E5 tests
// run along with; the rows of before E5 do not have them.
const EACH_RULE_FIELDS = ['each_occurrence'];
const EACH_TICKET_FIELDS = ['occurrence'];
// "Status beim Anlegen" (plan WV, 1790202500), which every earlier test runs along as well.
const STATUS_RULE_FIELDS = ['initial_status'];
const LATER_RULE_FIELDS = [...EACH_RULE_FIELDS, ...STATUS_RULE_FIELDS];
// Fields of the later migration of the trash (ADR-0037, 1790202300), which every earlier test runs
// along as well.
const TRASH_TICKET_FIELDS = ['deleted_at', 'deleted_by', 'trash'];
const TRASH_USER_FIELDS = ['trash_retention'];
const LATER_TICKET_FIELDS = [...EACH_TICKET_FIELDS, ...TRASH_TICKET_FIELDS];
// Conditions the trash appends to the API rules (1790202300).
const TRASH_RULE_SUFFIXES = [
	' && deleted_at = ""',
	' && ticket.deleted_at = ""',
	' && (ticket = "" || ticket.deleted_at = "")',
	' && blocker.deleted_at = "" && blocked.deleted_at = ""'
];
const E5_RULE_FIELDS = [
	'freq',
	'interval',
	'weekdays',
	'month_day',
	'anchor',
	'lead_days',
	'scope',
	'last_hint',
	...LATER_RULE_FIELDS
];
const INCOMPLETE_HINT = 'Regel unvollständig – bitte Rhythmus wählen.';

function withoutFields(rows, fields) {
	return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([name]) => !fields.includes(name))));
}

/**
 * A snapshot without the columns of "Jeden Termin einzeln anlegen" (plan OR-5, migration
 * 1790202200), of the trash (ADR-0037, 1790202300) and of "Status beim Anlegen" (plan WV,
 * 1790202500): the tests of earlier migrations run them along with `up`.
 */
function withoutLater(snap) {
	return {
		...snap,
		users: snap.users === null ? null : withoutFields(snap.users, TRASH_USER_FIELDS),
		tickets: snap.tickets === null ? null : withoutFields(snap.tickets, LATER_TICKET_FIELDS),
		recurrence_rules: snap.recurrence_rules === null ? null : withoutFields(snap.recurrence_rules, LATER_RULE_FIELDS)
	};
}

const OPEN_INSTANCE_INDEX = /idx_tickets_open_(recurrence|occurrence)/;
const TRASH_INDEX = /idx_tickets_deleted_at/;

/** The API rules of a collection without the conditions of the trash (1790202300). */
function withoutTrashRules(collection) {
	const rules = {};
	for (const rule of RULE_NAMES) {
		let value = collection[rule];
		if (typeof value === 'string') {
			for (const suffix of TRASH_RULE_SUFFIXES) value = value.replace(suffix, '');
		}
		rules[rule] = value;
	}
	return { ...collection, ...rules };
}

// The own inbox (ADR-0038, 1790202400): a new collection and two new values of
// inbox_items.channel and tickets.source.
const OWN_INBOX_COLLECTION = 'inbox_keys';
const OWN_INBOX_CHANNELS = ['api', 'whatsapp-web'];
const CHANNELS_BEFORE_OWN_INBOX = CHANNELS.filter((channel) => !OWN_INBOX_CHANNELS.includes(channel));

/** The collections without those that later migrations create (inbox_keys, 1790202400). */
function withoutLaterCollections(collections) {
	return collections.filter((collection) => collection.name !== OWN_INBOX_COLLECTION);
}

/** A collection without the channels of the own inbox (1790202400). */
function withoutOwnInboxChannels(collection) {
	if (collection.name !== 'inbox_items' && collection.name !== 'tickets') return collection;
	return {
		...collection,
		fields: collection.fields.map((field) =>
			field.name === 'channel' || field.name === 'source'
				? { ...field, values: field.values.filter((value) => !OWN_INBOX_CHANNELS.includes(value)) }
				: field
		)
	};
}

/** A collection without the field of "Status beim Anlegen" (plan WV, 1790202500). */
function withoutStatusField(collection) {
	if (collection.name !== 'recurrence_rules') return collection;
	return { ...collection, fields: collection.fields.filter((field) => !STATUS_RULE_FIELDS.includes(field.name)) };
}

/**
 * A collection without the fields, indexes and rule conditions of the migrations 1790202200
 * (plan OR-5), 1790202300 (trash, ADR-0037), 1790202500 (plan WV) and without the channels of
 * 1790202400 (own inbox, ADR-0038; its collection leaves with `withoutLaterCollections`).
 */
function withoutLaterSchema(collection) {
	const plain = withoutOwnInboxChannels(withoutTrashRules(collection));
	if (collection.name === 'tickets') {
		return {
			...plain,
			fields: plain.fields.filter((field) => !LATER_TICKET_FIELDS.includes(field.name)),
			indexes: collection.indexes.filter((index) => !OPEN_INSTANCE_INDEX.test(index) && !TRASH_INDEX.test(index))
		};
	}
	if (collection.name === 'recurrence_rules') {
		return { ...plain, fields: collection.fields.filter((field) => !LATER_RULE_FIELDS.includes(field.name)) };
	}
	if (collection.name === 'users') {
		return { ...plain, fields: collection.fields.filter((field) => !TRASH_USER_FIELDS.includes(field.name)) };
	}
	return plain;
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
				expect(withoutFields(migrated.tickets, LATER_TICKET_FIELDS)).toEqual(before.tickets);
				expect(migrated.tickets.every((ticket) => ticket.occurrence === '' && ticket.deleted_at === '')).toBe(true);
				expect(withoutFields(migrated.users, TRASH_USER_FIELDS)).toEqual(before.users);
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
				expect(withoutFields(migrated.tickets, ['recurrence', ...LATER_TICKET_FIELDS])).toEqual(
					withoutFields(before.tickets, ['recurrence'])
				);
			});
		},
		60_000
	);
});

const EACH_MIGRATION = '1790202200_recurrence_each_occurrence.js';
const TRASH_MIGRATION = '1790202300_tickets_trash.js';
const OWN_INBOX_MIGRATION = '1790202400_inbox_keys.js';
const STATUS_MIGRATION = '1790202500_recurrence_initial_status.js';

describe('migration rollback of "Jeden Termin einzeln anlegen" (plan OR-5)', () => {
	const ticketsOf = (dataDir) =>
		readDataDir(dataDir).collections.find((collection) => collection.name === 'tickets');
	const rulesOf = (dataDir) =>
		readDataDir(dataDir).collections.find((collection) => collection.name === 'recurrence_rules');
	const openIndexes = (dataDir) =>
		ticketsOf(dataDir).indexes.filter((index) => OPEN_INSTANCE_INDEX.test(index));
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const day = (date) => `${date} 00:00:00.000Z`;

	/** A rule with a done and an open instance, and a ticket without a series, as before OR-5. */
	function insertData(db) {
		db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(
			OWNER,
			'eins@example.invalid',
			'tk1',
			'hash',
			STAMP,
			STAMP
		);
		db.prepare(
			'INSERT INTO recurrence_rules (id, title, mode, freq, interval, weekdays, anchor, lead_days, next_due, active, scope, owner, created, updated) ' +
				'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('rule00000000001', 'Blumen', 'calendar', 'weekly', 1, '["MO","WE","FR"]', day('2026-09-21'), 0, day('2026-09-30'), 1, SCOPE, OWNER, STAMP, STAMP);
		const ticket = db.prepare(
			'INSERT INTO tickets (id, number, key, title, status, priority, due, recurrence, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		);
		ticket.run('ticket000000001', 1, 'TASK-1', 'Blumen', 'done', 'medium', day('2026-09-25'), 'rule00000000001', SCOPE, OWNER, STAMP, STAMP);
		ticket.run('ticket000000002', 2, 'TASK-2', 'Blumen', 'open', 'medium', day('2026-09-28'), 'rule00000000001', SCOPE, OWNER, STAMP, STAMP);
		ticket.run('ticket000000003', 3, 'TASK-3', 'Ohne Serie', 'open', 'low', '', '', SCOPE, OWNER, STAMP, STAMP);
	}

	const insertOpen = (db, id, number, occurrence, created = STAMP) =>
		db
			.prepare(
				'INSERT INTO tickets (id, number, key, title, status, priority, due, recurrence, occurrence, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			)
			.run(id, number, `TASK-${number}`, 'Blumen', 'open', 'medium', occurrence, 'rule00000000001', occurrence, SCOPE, OWNER, created, created);

	it(
		'adds the switch, the date of the series and the new index without changing a row, and back',
		async () => {
			// The trash (ADR-0037, 1790202300) follows and runs along; it adds deleted_at = '' to the
			// condition of the index. The own inbox (ADR-0038, 1790202400) and "Status beim Anlegen"
			// (plan WV, 1790202500) run along as well.
			const fromEach = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(EACH_MIGRATION));
			expect(fromEach).toEqual([EACH_MIGRATION, TRASH_MIGRATION, OWN_INBOX_MIGRATION, STATUS_MIGRATION]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromEach.length));
				expect(openIndexes(dataDir)).toEqual([
					"CREATE UNIQUE INDEX `idx_tickets_open_recurrence` ON `tickets` (recurrence) WHERE recurrence != '' AND status != 'done'"
				]);
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, snapshot);
				const otherCollections = (dir) =>
					withoutLaterCollections(withoutTimestamps(readDataDir(dir).collections)).map(withoutLaterSchema);
				const schemaBefore = otherCollections(dataDir);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromEach);
				expect(rulesOf(dataDir).fields.find((field) => field.name === 'each_occurrence')).toMatchObject({
					type: 'bool',
					required: false
				});
				expect(ticketsOf(dataDir).fields.find((field) => field.name === 'occurrence')).toMatchObject({
					type: 'date',
					required: false
				});
				expect(openIndexes(dataDir)).toEqual([
					"CREATE UNIQUE INDEX `idx_tickets_open_occurrence` ON `tickets` (recurrence, occurrence) WHERE recurrence != '' AND status != 'done' AND deleted_at = ''"
				]);
				assertSchema(readDataDir(dataDir).collections);
				expect(otherCollections(dataDir)).toEqual(schemaBefore);
				const migrated = withDatabase(dataDir, snapshot);
				// No row changes: every ticket has an empty date of the series, every rule the old behaviour.
				expect(withoutLater(migrated)).toEqual(before);
				expect(migrated.tickets.map((ticket) => ticket.occurrence)).toEqual(['', '', '']);
				expect(migrated.recurrence_rules.map((rule) => rule.each_occurrence)).toEqual([0]);

				withDatabase(dataDir, (db) => {
					// Still one open instance per rule for an empty date ...
					expect(() => insertOpen(db, 'ticket000000004', 4, '')).toThrow(/UNIQUE constraint failed/);
					// ... but one per date with "Jeden Termin einzeln anlegen", never the same date twice.
					db.prepare('UPDATE recurrence_rules SET each_occurrence = 1 WHERE id = ?').run('rule00000000001');
					insertOpen(db, 'ticket000000005', 5, day('2026-09-30'), '2026-09-02 10:00:00.000Z');
					insertOpen(db, 'ticket000000006', 6, day('2026-10-02'), '2026-09-03 10:00:00.000Z');
					expect(() => insertOpen(db, 'ticket000000007', 7, day('2026-10-02'))).toThrow(
						/UNIQUE constraint failed/
					);
				});

				// Back: the newest open ticket of the rule stays in the series, the older open ones become
				// normal tickets; the done one and the ticket without a series stay as they are.
				const down = await migrate(args, 'down', String(fromEach.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromEach].reverse());
				expect(openIndexes(dataDir)).toEqual([
					"CREATE UNIQUE INDEX `idx_tickets_open_recurrence` ON `tickets` (recurrence) WHERE recurrence != '' AND status != 'done'"
				]);
				expect(otherCollections(dataDir)).toEqual(schemaBefore);
				const reverted = withDatabase(dataDir, snapshot);
				expect(reverted.recurrence_rules).toEqual(before.recurrence_rules);
				const byId = Object.fromEntries(reverted.tickets.map((ticket) => [ticket.id, ticket]));
				expect(byId.ticket000000006.recurrence).toBe('rule00000000001');
				expect(byId.ticket000000005.recurrence).toBe('');
				expect(byId.ticket000000002.recurrence).toBe('');
				expect(byId.ticket000000001.recurrence).toBe('rule00000000001');
				expect(byId.ticket000000003.recurrence).toBe('');
				// Only the column recurrence changed: `updated` and every other value stay.
				expect(byId.ticket000000002).toEqual({ ...before.tickets[1], recurrence: '' });
				expect(reverted.tickets.every((ticket) => !('occurrence' in ticket))).toBe(true);
				// The old index holds again.
				withDatabase(dataDir, (db) => {
					expect(() =>
						db
							.prepare(
								'INSERT INTO tickets (id, number, key, title, status, priority, recurrence, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
							)
							.run('ticket000000008', 8, 'TASK-8', 'Zweite', 'open', 'low', 'rule00000000001', SCOPE, OWNER, STAMP, STAMP)
					).toThrow(/UNIQUE constraint failed/);
				});

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromEach);
				assertSchema(readDataDir(dataDir).collections);
			});
		},
		60_000
	);
});

describe('migration rollback of the trash (ADR-0037)', () => {
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const collectionOf = (dataDir, name) => readDataDir(dataDir).collections.find((collection) => collection.name === name);
	const ruleSet = (dataDir) =>
		Object.fromEntries(
			['tickets', 'comments', 'ticket_history', 'ticket_reads', 'dependencies', 'inbox_items'].map((name) => {
				const collection = collectionOf(dataDir, name);
				return [name, Object.fromEntries(RULE_NAMES.map((rule) => [rule, collection[rule]]))];
			})
		);
	const openIndexes = (dataDir) => collectionOf(dataDir, 'tickets').indexes.filter((index) => OPEN_INSTANCE_INDEX.test(index));
	const rowsOf = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();

	/** A ticket in a series with a comment and a history entry, and a second ticket, as before the trash. */
	function insertData(db) {
		db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(OWNER, 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
		const ticket = db.prepare(
			'INSERT INTO tickets (id, number, key, title, status, priority, parent, source, source_item, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		);
		ticket.run('ticket000000001', 1, 'TASK-1', 'Eltern', 'open', 'medium', '', 'telegram', 'item00000000001', SCOPE, OWNER, STAMP, STAMP);
		ticket.run('ticket000000002', 2, 'TASK-2', 'Kind', 'open', 'low', 'ticket000000001', '', '', SCOPE, OWNER, STAMP, STAMP);
		ticket.run('ticket000000003', 3, 'TASK-3', 'Bleibt', 'waiting', 'high', '', '', '', SCOPE, OWNER, STAMP, STAMP);
		const item = db.prepare(
			'INSERT INTO inbox_items (id, channel, kind, title, body, fingerprint, state, ticket, handled_at, source_meta, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		);
		item.run('item00000000001', 'telegram', 'message', 'Verworfen mit dem Ticket', 'Text', 'f1', 'converted', 'ticket000000001', STAMP, '{"chat":"Familie"}', SCOPE, OWNER, STAMP, STAMP);
		item.run('item00000000002', 'manual', 'todo', 'Schon im Eingang', '', 'f2', 'new', '', '', '{"ticket_deleted":{"key":"TASK-1","at":"x","ticket":"ticket000000001"}}', SCOPE, OWNER, STAMP, STAMP);
		const comment = db.prepare('INSERT INTO comments (id, ticket, author, body, created, updated) VALUES (?, ?, ?, ?, ?, ?)');
		comment.run('comment00000001', 'ticket000000001', OWNER, 'Weg', STAMP, STAMP);
		comment.run('comment00000003', 'ticket000000003', OWNER, 'Bleibt', STAMP, STAMP);
		db.prepare('INSERT INTO ticket_history (id, ticket, field, old_value, new_value, user, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
			'history00000001',
			'ticket000000001',
			'created',
			'',
			'TASK-1',
			'',
			STAMP
		);
	}

	it(
		'adds the fields, the index condition and the rule conditions without changing a row, and deletes the trash on the way back',
		async () => {
			// The own inbox (ADR-0038, 1790202400) and "Status beim Anlegen" (plan WV, 1790202500)
			// follow and run along; they change no row here.
			const fromTrash = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(TRASH_MIGRATION));
			expect(fromTrash).toEqual([TRASH_MIGRATION, OWN_INBOX_MIGRATION, STATUS_MIGRATION]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromTrash.length));
				const rulesBefore = ruleSet(dataDir);
				const indexesBefore = openIndexes(dataDir);
				expect(indexesBefore).toEqual([
					"CREATE UNIQUE INDEX `idx_tickets_open_occurrence` ON `tickets` (recurrence, occurrence) WHERE recurrence != '' AND status != 'done'"
				]);
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, snapshot);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromTrash);
				assertSchema(readDataDir(dataDir).collections);
				const migrated = withDatabase(dataDir, snapshot);
				expect(withoutFields(migrated.tickets, TRASH_TICKET_FIELDS)).toEqual(before.tickets);
				expect(migrated.tickets.map(({ deleted_at, deleted_by }) => deleted_at + deleted_by)).toEqual(['', '', '']);
				expect(withoutFields(migrated.users, TRASH_USER_FIELDS)).toEqual(before.users);
				expect(migrated.inbox_items).toEqual(before.inbox_items);
				for (const [name, rules] of Object.entries(ruleSet(dataDir))) {
					expect(withoutTrashRules({ ...rules }), name).toEqual(rulesBefore[name]);
				}

				// The parent with its sub-ticket in the trash, its source kept with it ("Quellen verwerfen").
				withDatabase(dataDir, (db) => {
					const trash = db.prepare('UPDATE tickets SET deleted_at = ?, deleted_by = ?, trash = ? WHERE id = ?');
					trash.run('2026-09-20 10:00:00.000Z', OWNER, '{"sources":{"handling":"discard","items":["item00000000001"]}}', 'ticket000000001');
					trash.run('2026-09-20 10:00:00.000Z', OWNER, '{}', 'ticket000000002');
				});

				const down = await migrate(args, 'down', String(fromTrash.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromTrash].reverse());
				expect(openIndexes(dataDir)).toEqual(indexesBefore);
				expect(ruleSet(dataDir)).toEqual(rulesBefore);
				const reverted = withDatabase(dataDir, snapshot);
				// Deleted for good, as a delete did before the trash; the ticket outside stays as it was.
				expect(reverted.tickets).toEqual([before.tickets[2]]);
				expect(reverted.users).toEqual(before.users);
				const items = Object.fromEntries(reverted.inbox_items.map((row) => [row.id, row]));
				expect(items.item00000000001).toMatchObject({ state: 'discarded', ticket: '', fingerprint: 'f1', body: 'Text' });
				expect(items.item00000000001.handled_at).not.toBe(STAMP);
				expect(JSON.parse(items.item00000000001.source_meta)).toMatchObject({ chat: 'Familie', ticket_deleted: { key: 'TASK-1' } });
				expect(items.item00000000002).toEqual(before.inbox_items[1]);
				withDatabase(dataDir, (db) => {
					expect(rowsOf(db, 'comments').map((row) => row.id)).toEqual(['comment00000003']);
					expect(rowsOf(db, 'ticket_history')).toEqual([]);
				});

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromTrash);
				assertSchema(readDataDir(dataDir).collections);
			});
		},
		60_000
	);
});

describe('migration rollback of the own inbox (ADR-0038)', () => {
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const collectionOf = (dataDir, name) => readDataDir(dataDir).collections.find((collection) => collection.name === name);
	const channelValues = (dataDir) => ({
		inbox_items: collectionOf(dataDir, 'inbox_items').fields.find((field) => field.name === 'channel').values,
		tickets: collectionOf(dataDir, 'tickets').fields.find((field) => field.name === 'source').values
	});
	const OLD_VALUES = CHANNELS_BEFORE_OWN_INBOX;

	/** A user with keyword lists of the file imports, an entry and a ticket, as before the own inbox. */
	function insertData(db) {
		const user = db.prepare(
			'INSERT INTO users (id, email, tokenKey, password, import_keywords, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'
		);
		user.run(OWNER, 'eins@example.invalid', 'tk1', 'hash', '{"eml":{"keywords":["todo"],"match_body":true}}', STAMP, STAMP);
		user.run('user00000000002', 'zwei@example.invalid', 'tk2', 'hash', null, STAMP, STAMP);
		db.prepare(
			'INSERT INTO inbox_items (id, channel, kind, title, body, fingerprint, state, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('item00000000001', 'whatsapp', 'message', 'Export', 'Text', 'f1', 'new', SCOPE, OWNER, STAMP, STAMP);
		db.prepare(
			'INSERT INTO tickets (id, number, key, title, status, priority, source, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('ticket000000001', 1, 'TASK-1', 'Alt', 'open', 'medium', 'telegram', SCOPE, OWNER, STAMP, STAMP);
	}

	it(
		'adds the keys and the two channels without changing a row, and keeps the content of new entries on the way back',
		async () => {
			// "Status beim Anlegen" (plan WV, 1790202500) follows and runs along; it changes no row.
			const fromOwn = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(OWN_INBOX_MIGRATION));
			expect(fromOwn).toEqual([OWN_INBOX_MIGRATION, STATUS_MIGRATION]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromOwn.length));
				expect(collectionOf(dataDir, 'inbox_keys')).toBeUndefined();
				expect(channelValues(dataDir)).toEqual({ inbox_items: OLD_VALUES, tickets: OLD_VALUES });
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, snapshot);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromOwn);
				assertSchema(readDataDir(dataDir).collections);
				expect(channelValues(dataDir)).toEqual({
					inbox_items: [...OLD_VALUES, 'api', 'whatsapp-web'],
					tickets: [...OLD_VALUES, 'api', 'whatsapp-web']
				});
				expect(withDatabase(dataDir, snapshot)).toEqual(before);
				expect(
					withoutLaterCollections(withoutTimestamps(readDataDir(dataDir).collections))
						.map(withoutOwnInboxChannels)
						.map(withoutStatusField)
				).toEqual(schemaBefore);

				// Entries, a ticket, keyword lists and a key of the own inbox, then back.
				withDatabase(dataDir, (db) => {
					const item = db.prepare(
						'INSERT INTO inbox_items (id, channel, kind, title, body, source_ref, fingerprint, state, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					item.run('item00000000002', 'whatsapp-web', 'message', 'Aus WhatsApp Web', 'Text', 'wa:1', 'f2', 'new', SCOPE, OWNER, STAMP, STAMP);
					item.run('item00000000003', 'api', 'todo', 'Aus der API', 'Text', 'x-1', 'f3', 'converted', SCOPE, OWNER, STAMP, STAMP);
					db.prepare(
						'INSERT INTO tickets (id, number, key, title, status, priority, source, source_item, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).run('ticket000000002', 2, 'TASK-2', 'Neu', 'open', 'medium', 'api', 'item00000000003', SCOPE, OWNER, STAMP, STAMP);
					db.prepare('UPDATE inbox_items SET ticket = ? WHERE id = ?').run('ticket000000002', 'item00000000003');
					db.prepare('UPDATE users SET import_keywords = ? WHERE id = ?').run(
						'{"eml":{"keywords":["todo"],"match_body":true},"api":{"keywords":["todo"]},"whatsapp-web":{"keywords":["#byl"]}}',
						OWNER
					);
					db.prepare(
						'INSERT INTO inbox_keys (id, name, token_hash, token_hint, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'
					).run('key000000000001', 'Rechner', 'a'.repeat(64), 'byl_AbCd', OWNER, STAMP, STAMP);
				});
				const withNew = withDatabase(dataDir, snapshot);

				const down = await migrate(args, 'down', String(fromOwn.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromOwn].reverse());
				expect(collectionOf(dataDir, 'inbox_keys')).toBeUndefined();
				expect(channelValues(dataDir)).toEqual({ inbox_items: OLD_VALUES, tickets: OLD_VALUES });
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				const reverted = withDatabase(dataDir, snapshot);
				const items = Object.fromEntries(reverted.inbox_items.map((row) => [row.id, row]));
				const itemsBefore = Object.fromEntries(withNew.inbox_items.map((row) => [row.id, row]));
				expect(items.item00000000001).toEqual(itemsBefore.item00000000001);
				expect(items.item00000000002).toEqual({ ...itemsBefore.item00000000002, channel: 'whatsapp' });
				expect(items.item00000000003).toEqual({ ...itemsBefore.item00000000003, channel: 'manual' });
				const tickets = Object.fromEntries(reverted.tickets.map((row) => [row.id, row]));
				expect(tickets.ticket000000001).toEqual(before.tickets[0]);
				expect(tickets.ticket000000002.source).toBe('manual');
				const users = Object.fromEntries(reverted.users.map((row) => [row.id, row]));
				expect(JSON.parse(users[OWNER].import_keywords)).toEqual({ eml: { keywords: ['todo'], match_body: true } });
				expect(users.user00000000002).toEqual(before.users[1]);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromOwn);
				assertSchema(readDataDir(dataDir).collections);
			});
		},
		60_000
	);
});

describe('migration rollback of "Status beim Anlegen" (plan WV, ADR-0022 addendum 8)', () => {
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const day = (date) => `${date} 00:00:00.000Z`;
	const statusField = (dataDir) =>
		readDataDir(dataDir)
			.collections.find((collection) => collection.name === 'recurrence_rules')
			.fields.find((field) => field.name === 'initial_status');
	const insertTicket = (db, id, number, status) =>
		db
			.prepare(
				'INSERT INTO tickets (id, number, key, title, status, priority, due, recurrence, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			)
			.run(id, number, `TASK-${number}`, 'Müll', status, 'high', day('2026-09-28'), 'rule00000000001', SCOPE, OWNER, STAMP, STAMP);

	/** A rule with a done instance, as before the field. */
	function insertData(db) {
		db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(OWNER, 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
		db.prepare(
			'INSERT INTO recurrence_rules (id, title, priority, mode, freq, interval, weekdays, anchor, lead_days, next_due, active, scope, owner, created, updated) ' +
				'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('rule00000000001', 'Müll', 'high', 'calendar', 'weekly', 1, '["MO"]', day('2026-09-21'), 3, day('2026-10-05'), 1, SCOPE, OWNER, STAMP, STAMP);
		insertTicket(db, 'ticket000000001', 1, 'done');
	}

	it(
		'adds the field without changing a row, and the tickets made with it keep their status on the way back',
		async () => {
			const fromStatus = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(STATUS_MIGRATION));
			expect(fromStatus).toEqual([STATUS_MIGRATION]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromStatus.length));
				expect(statusField(dataDir)).toBeUndefined();
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, snapshot);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromStatus);
				assertSchema(readDataDir(dataDir).collections);
				expect(statusField(dataDir)).toMatchObject({
					type: 'select',
					required: false,
					values: ['backlog', 'open', 'in_progress', 'waiting'],
					maxSelect: 1
				});
				expect(withoutTimestamps(readDataDir(dataDir).collections).map(withoutStatusField)).toEqual(schemaBefore);
				// No row changes: the rule of before has an empty status, which the hooks read as "open".
				const migrated = withDatabase(dataDir, snapshot);
				expect(withoutFields(migrated.recurrence_rules, STATUS_RULE_FIELDS)).toEqual(before.recurrence_rules);
				expect(migrated.recurrence_rules.map((rule) => rule.initial_status)).toEqual(['']);
				expect(migrated.tickets).toEqual(before.tickets);
				// "done" is no value of the field.
				expect(statusField(dataDir).values).not.toContain('done');

				// The template says "waiting", and the next ticket was made with it.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE recurrence_rules SET initial_status = ? WHERE id = ?').run('waiting', 'rule00000000001');
					insertTicket(db, 'ticket000000002', 2, 'waiting');
				});
				const withStatus = withDatabase(dataDir, snapshot);

				const down = await migrate(args, 'down', String(fromStatus.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromStatus].reverse());
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				const reverted = withDatabase(dataDir, snapshot);
				// The field goes with its value; the rule makes "open" tickets again (the hooks read no
				// field), the ticket made meanwhile stays "waiting".
				expect(reverted.recurrence_rules).toEqual(withoutFields(withStatus.recurrence_rules, STATUS_RULE_FIELDS));
				expect(reverted.tickets).toEqual(withStatus.tickets);
				expect(reverted.tickets.map((ticket) => ticket.status)).toEqual(['done', 'waiting']);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromStatus);
				assertSchema(readDataDir(dataDir).collections);
				expect(withDatabase(dataDir, snapshot).recurrence_rules.map((rule) => rule.initial_status)).toEqual(['']);
			});
		},
		60_000
	);
});
