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
	ADR_0003_BACKUPS,
	CHANNELS,
	DEFAULT_BACKUPS,
	DEFAULT_USERS_RULES,
	EXPECTED_BACKUPS,
	EXPECTED_COLLECTIONS,
	PROJECT_COLORS,
	RULE_NAMES,
	assertSchema,
	readDataDir
} from '../support/schema.mjs';
import { loadHookLib } from '../support/hook-lib.mjs';

const security = loadHookLib('security-rules.js');
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
				expect(first.settings.rateLimits.enabled).toBe(true);
				expect(first.settings.rateLimits.rules).toEqual(security.rateLimitRules('normal'));
				expect(first.settings.superuserIPs).toEqual(security.SUPERUSER_IPS);

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
				expect(reverted.settings.rateLimits.enabled).toBe(false);
				expect(reverted.settings.rateLimits.rules).toEqual(security.POCKETBASE_DEFAULT_RULES);
				expect(reverted.settings.superuserIPs ?? []).toEqual([]);

				const secondUp = await migrate(args, 'up');
				expect(appliedFiles(secondUp, 'Applied')).toEqual(MIGRATION_FILES);
				const second = readDataDir(dataDir);
				assertSchema(second.collections);
				expect(withoutTimestamps(second.collections)).toEqual(
					withoutTimestamps(first.collections)
				);
				expect(second.settings.backups).toEqual(first.settings.backups);
				expect(second.settings.rateLimits).toEqual(first.settings.rateLimits);
				expect(second.settings.superuserIPs).toEqual(first.settings.superuserIPs);
			});
		}
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
				// occurrence, the fields of the trash and the pinned comment come with later migrations
				// (plan OR-5, ADR-0037, ADR-0044) that `up` runs along.
				expect(
					migrated.tickets.map(
						({ source, source_item, occurrence, deleted_at, deleted_by, trash, pinned_comment, ...rest }) => rest
					)
				).toEqual(before.tickets);
				expect(migrated.tickets.map(({ source, source_item }) => ({ source, source_item }))).toEqual([
					{ source: '', source_item: '' },
					{ source: '', source_item: '' }
				]);
				// The base line of "new" (ADR-0015) is the only value an existing row gets; the keyword
				// lists of the file imports (package 21) stay empty.
				expect(
					migrated.users.map(({ unread_since, import_keywords, trash_retention, inbox_targets, ...rest }) => rest)
				).toEqual(before.users);
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
		}
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
				expect(migrated.inbox_items.map(({ connection, target_project, watch, ...rest }) => rest)).toEqual(before.inbox_items);
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
		}
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
				expect(migrated.users.map(({ import_keywords, trash_retention, inbox_targets, ...rest }) => rest)).toEqual(
					before.users
				);
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
		}
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
				// Nothing else changes, not even `updated` (the target project of ADR-0049 and the state of
				// the GitHub channel, ADR-0050, run along empty).
				expect(withoutFields(migrated.connections, ['settings', 'scan', ...LATER_ITEM_FIELDS])).toEqual(
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
		}
	);
});

const DELETE_GUARD_MIGRATION = '1790201800_inbox_items_delete_guard.js';
// No inbox item deletable through the API (ADR-0014, addendum of 2026-10-01); every test from the
// delete guard on runs it along.
const NO_DELETE_MIGRATION = '1790202800_inbox_items_no_delete.js';

const inboxDeleteRuleOf = (dataDir) =>
	readDataDir(dataDir).collections.find((collection) => collection.name === 'inbox_items').deleteRule;

describe('migration rollback of the delete guard of sources (ADR-0031 section 3)', () => {
	it(
		'changes only the deleteRule of inbox_items, there and back, and keeps every row',
		async () => {
			const fromGuard = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(DELETE_GUARD_MIGRATION));
			expect(fromGuard[0]).toBe(DELETE_GUARD_MIGRATION);
			const fromNoDelete = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(NO_DELETE_MIGRATION));
			expect(fromNoDelete[0]).toBe(NO_DELETE_MIGRATION);
			const deleteRuleOf = inboxDeleteRuleOf;

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				// The latest state: null (1790202800); below it the guard of this migration.
				expect(deleteRuleOf(dataDir)).toBeNull();
				await migrate(args, 'down', String(fromNoDelete.length));
				const guarded = deleteRuleOf(dataDir);
				await migrate(args, 'down', String(fromGuard.length - fromNoDelete.length));
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
				expect(deleteRuleOf(dataDir)).toBeNull();
				expect(withoutLater(withDatabase(dataDir, snapshot))).toEqual(rows);

				const down = await migrate(args, 'down', String(fromGuard.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromGuard].reverse());
				expect(deleteRuleOf(dataDir)).toBe(before);
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromGuard);
				expect(deleteRuleOf(dataDir)).toBeNull();
			});
		}
	);
});

// The backups of the app replace the automatic backup of PocketBase (ADR-0046 §1).
const BACKUP_SCHEDULE_MIGRATION = '1790203000_backups_own_schedule.js';

/** Sets backups.cron in the stored settings of the data folder (a schedule from the admin UI). */
function setBackupCron(dataDir, cron) {
	withDatabase(dataDir, (db) => {
		const row = db.prepare("SELECT value FROM _params WHERE id = 'settings'").get();
		const settings = JSON.parse(new TextDecoder().decode(row.value));
		settings.backups.cron = cron;
		db.prepare("UPDATE _params SET value = ? WHERE id = 'settings'").run(new TextEncoder().encode(JSON.stringify(settings)));
	});
}

describe('migration of the backup schedule (ADR-0046)', () => {
	it(
		'switches the automatic backup of ADR-0003 off and back on, and keeps a schedule of the admin UI',
		async () => {
			const fromSchedule = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(BACKUP_SCHEDULE_MIGRATION));
			expect(fromSchedule[0]).toBe(BACKUP_SCHEDULE_MIGRATION);
			const backupsOf = (dataDir) => readDataDir(dataDir).settings.backups;

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				expect(backupsOf(dataDir)).toMatchObject(EXPECTED_BACKUPS);

				const down = await migrate(args, 'down', String(fromSchedule.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromSchedule].reverse());
				expect(backupsOf(dataDir)).toMatchObject(ADR_0003_BACKUPS);

				// A schedule of the user stays, up and down.
				setBackupCron(dataDir, '0 3 * * *');
				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromSchedule);
				expect(backupsOf(dataDir)).toMatchObject({ cron: '0 3 * * *', cronMaxKeep: 12 });
				await migrate(args, 'down', String(fromSchedule.length));
				expect(backupsOf(dataDir)).toMatchObject({ cron: '0 3 * * *', cronMaxKeep: 12 });

				setBackupCron(dataDir, ADR_0003_BACKUPS.cron);
				await migrate(args, 'up');
				expect(backupsOf(dataDir)).toMatchObject(EXPECTED_BACKUPS);
			});
		}
	);
});

describe('migration rollback of the delete lock of inbox items (ADR-0014, addendum of 2026-10-01)', () => {
	it(
		'sets the deleteRule of inbox_items to null and back to the guard of the sources, and keeps every row',
		async () => {
			const fromNoDelete = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(NO_DELETE_MIGRATION));
			expect(fromNoDelete[0]).toBe(NO_DELETE_MIGRATION);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				const schemaAfter = withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections));
				expect(inboxDeleteRuleOf(dataDir)).toBeNull();

				const firstDown = await migrate(args, 'down', String(fromNoDelete.length));
				expect(appliedFiles(firstDown, 'Reverted')).toEqual([...fromNoDelete].reverse());
				const guarded = inboxDeleteRuleOf(dataDir);
				expect(guarded).toMatch(/^@request\.auth\.id != "" && \(owner = @request\.auth\.id \|\| .*\) && ticket = ""$/);
				// Nothing else of the schema changes: only this one rule (the target project of ADR-0049,
				// 1790203100, and the GitHub channel of ADR-0050, 1790203200, run along).
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);
				const withRule = (collections, rule) =>
					collections.map((collection) => (collection.name === 'inbox_items' ? { ...collection, deleteRule: rule } : collection));
				expect(withRule(schemaBefore, null)).toEqual(
					withRule(schemaAfter, null).map(withoutTargetFields).map(withoutGithubChannel)
				);

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
				expect(appliedFiles(up, 'Applied')).toEqual(fromNoDelete);
				expect(inboxDeleteRuleOf(dataDir)).toBeNull();
				expect(withoutLater(withDatabase(dataDir, snapshot))).toEqual(withoutLater(rows));

				const down = await migrate(args, 'down', String(fromNoDelete.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromNoDelete].reverse());
				expect(inboxDeleteRuleOf(dataDir)).toBe(guarded);
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromNoDelete);
				expect(inboxDeleteRuleOf(dataDir)).toBeNull();
				expect(withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections))).toEqual(schemaAfter);
			});
		}
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
					expect(withoutFields([items[id]], LATER_ITEM_FIELDS)[0]).toEqual(before[id]);
				}
				expect(withoutFields(after.inbox_items, ['state', 'handled_at', 'source_meta', ...LATER_ITEM_FIELDS])).toEqual(
					withoutFields(rows.inbox_items, ['state', 'handled_at', 'source_meta'])
				);
				expect(withoutFields(after.tickets, LATER_TICKET_FIELDS)).toEqual(rows.tickets);

				const down = await migrate(args, 'down', String(fromOrphans.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromOrphans].reverse());
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromOrphans);
				expect(byId(withDatabase(dataDir, snapshot)).item00000000002.state).toBe('new');
			});
		}
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
							// The colors (ADR-0052) add a field to projects as well.
							return {
								...collection,
								fields: collection.fields.filter(
									(field) => field.name !== 'parent' && !COLOR_FIELDS.includes(field.name)
								),
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
		}
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
					// Existing projects stay top-level; nothing else changes (the colors of ADR-0052 run
					// along and add an empty value).
					expect(projectRows(db)).toEqual(
						before.projects.map((row) => ({ ...row, parent: '', color: '' }))
					);
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
					expect(projectRows(db)).toEqual(
						before.projects.map((row) => ({ ...row, parent: '', color: '' }))
					);
				});
			});
		}
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

/**
 * Rows of the tables the E4 and E5 migrations touch; a missing table gives null. Without the column
 * of the colors (ADR-0052, 1790203400): every earlier test runs that migration along, and it only
 * adds an empty value; its own test reads the column itself (colorRows). The same for the fields of
 * the accounts (ADR-0056, 1790203700); its own test reads them itself (accountRows).
 */
function snapshot(db) {
	const exists = (table) =>
		db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
	const rows = (table) => (exists(table) ? db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() : null);
	const withoutColor = (list) => (list === null ? null : withoutFields(list, COLOR_FIELDS));
	const users = rows('users');
	return {
		users: users === null ? null : withoutFields(users, ACCOUNT_FIELDS),
		tickets: withoutColor(rows('tickets')),
		inbox_items: rows('inbox_items'),
		ticket_reads: rows('ticket_reads'),
		connections: rows('connections'),
		recurrence_rules: withoutColor(rows('recurrence_rules'))
	};
}

const E5_FIRST_MIGRATION = '1790201600_recurrence_rule_params.js';
// Fields of the later migration of "Jeden Termin einzeln anlegen" (plan OR-5), which the E5 tests
// run along with; the rows of before E5 do not have them.
const EACH_RULE_FIELDS = ['each_occurrence'];
const EACH_TICKET_FIELDS = ['occurrence'];
// "Status beim Anlegen" (plan WV, 1790202500), which every earlier test runs along as well.
const STATUS_RULE_FIELDS = ['initial_status'];
// The sub-tasks of the template (plan WV-3, 1790202700), which every earlier test runs along as well.
const SUBTASKS_RULE_FIELDS = ['template_subtasks'];
// The colors of projects and tickets (ADR-0052, 1790203400), which every earlier test runs along as
// well: one select field `color` at projects, tickets and recurrence_rules.
const COLOR_MIGRATION = '1790203400_colors.js';
// The security hardening (ADR-0055, 1790203500), which every earlier test runs along as well: only
// settings (rate limiter, superuser addresses), no collection.
const SECURITY_MIGRATION = '1790203500_security_hardening.js';
// The protocol of failed sign-ins (ADR-0055 §8, 1790203600): the collection login_failures.
const LOGIN_FAILURES_MIGRATION = '1790203600_login_failures.js';
// Accounts and the administrator (ADR-0056, 1790203700), which every earlier test runs along as
// well: two bool fields at users (the first account gets the right), new read rules of users and
// household_members.
const ACCOUNTS_MIGRATION = '1790203700_accounts_admin.js';
const ACCOUNT_FIELDS = ['instance_admin', 'disabled'];
const USERS_RULE_BEFORE_ACCOUNTS = 'id = @request.auth.id';
const MEMBERS_RULE_BEFORE_ACCOUNTS = 'user = @request.auth.id';
// Managing a household (ADR-0058, E7-2), which every earlier test runs along as well: the collection
// household_invites and the rights of household_members (1790203800), the rule of joining in the
// rate limiter (1790203810, only settings) and the owner branch of the API rules only for private
// records (1790203900, only rules); since the areas (ADR-0059, E7-3) also the retention of the trash
// of a household (1790204100, one field at households).
const HOUSEHOLD_INVITES_MIGRATION = '1790203800_household_invites.js';
const JOIN_LIMIT_MIGRATION = '1790203810_household_join_limit.js';
const ACCESS_RULES_MIGRATION = '1790203900_household_access_rules.js';
const AREA_RETENTION_MIGRATION = '1790204100_household_trash_retention.js';
const HOUSEHOLD_MIGRATIONS = [
	HOUSEHOLD_INVITES_MIGRATION,
	JOIN_LIMIT_MIGRATION,
	ACCESS_RULES_MIGRATION,
	AREA_RETENTION_MIGRATION
];
const HOUSEHOLD_INVITES_COLLECTION = 'household_invites';
// [after, before] of the owner branch of 1790203900, of a record and of a record through its ticket.
const PRIVATE_BRANCHES = [
	['((owner = @request.auth.id && household = "") || (household != ""', '(owner = @request.auth.id || (household != ""'],
	[
		'((ticket.owner = @request.auth.id && ticket.household = "") || (ticket.household != ""',
		'(ticket.owner = @request.auth.id || (ticket.household != ""'
	]
];
const COLOR_FIELDS = ['color'];
const COLOR_COLLECTIONS = ['projects', 'tickets', 'recurrence_rules'];
const LATER_RULE_FIELDS = [
	...EACH_RULE_FIELDS,
	...STATUS_RULE_FIELDS,
	...SUBTASKS_RULE_FIELDS,
	...COLOR_FIELDS
];
// Fields of the later migration of the trash (ADR-0037, 1790202300), which every earlier test runs
// along as well.
const TRASH_TICKET_FIELDS = ['deleted_at', 'deleted_by', 'trash'];
const TRASH_USER_FIELDS = ['trash_retention'];
// The pinned comment (ADR-0044, 1790202600), which every earlier test runs along as well.
const PIN_TICKET_FIELDS = ['pinned_comment'];
const LATER_TICKET_FIELDS = [
	...EACH_TICKET_FIELDS,
	...TRASH_TICKET_FIELDS,
	...PIN_TICKET_FIELDS,
	...COLOR_FIELDS
];
// The target project of the ways into the inbox (ADR-0049, 1790203100), which every earlier test
// runs along as well: a relation at inbox_items and connections, a JSON field at users.
const TARGET_MIGRATION = '1790203100_inbox_target_project.js';
const TARGET_FIELDS = ['target_project'];
const TARGET_USER_FIELDS = ['inbox_targets'];
const TARGET_INDEX = /idx_inbox_items_target_project/;
const LATER_USER_FIELDS = [...TRASH_USER_FIELDS, ...TARGET_USER_FIELDS];
// The GitHub channel (ADR-0050, 1790203200), which every earlier test runs along as well: a new
// value of inbox_items.channel, tickets.source and connections.type, three kinds of entries and a
// JSON field `watch` at inbox_items and connections.
const GITHUB_MIGRATION = '1790203200_github_channel.js';
const GITHUB_FIELDS = ['watch'];
const GITHUB_CHANNEL = 'github';
const GITHUB_KINDS = ['change', 'pull_request', 'release'];
// The folder channel (ADR-0051, 1790203300), which every earlier test runs along as well: a new
// value of inbox_items.channel, tickets.source and connections.type, the kind "file", an optional
// connections.secret_env and room for 8 MB in connections.watch.
const FOLDER_MIGRATION = '1790203300_folder_channel.js';
const FOLDER_CHANNEL = 'folder';
const FOLDER_KIND = 'file';
// Columns of inbox_items and connections that later migrations add (target project, watch).
const LATER_ITEM_FIELDS = [...TARGET_FIELDS, ...GITHUB_FIELDS];
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
 * 1790202200), of the trash (ADR-0037, 1790202300), of "Status beim Anlegen" (plan WV,
 * 1790202500), of the pinned comment (ADR-0044, 1790202600), of the sub-tasks of the template
 * (plan WV-3, 1790202700), of the target project (ADR-0049, 1790203100) and of the GitHub channel
 * (ADR-0050, 1790203200): the tests of earlier migrations run them along with `up`.
 */
function withoutLater(snap) {
	return {
		...snap,
		users: snap.users === null ? null : withoutFields(snap.users, LATER_USER_FIELDS),
		tickets: snap.tickets === null ? null : withoutFields(snap.tickets, LATER_TICKET_FIELDS),
		inbox_items: snap.inbox_items === null ? null : withoutFields(snap.inbox_items, LATER_ITEM_FIELDS),
		connections: snap.connections === null ? null : withoutFields(snap.connections, LATER_ITEM_FIELDS),
		recurrence_rules: snap.recurrence_rules === null ? null : withoutFields(snap.recurrence_rules, LATER_RULE_FIELDS)
	};
}

const OPEN_INSTANCE_INDEX = /idx_tickets_open_(recurrence|occurrence)/;
const TRASH_INDEX = /idx_tickets_deleted_at/;
const PIN_INDEX = /idx_tickets_pinned_comment/;

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
const CHANNELS_BEFORE_OWN_INBOX = CHANNELS.filter(
	(channel) => !OWN_INBOX_CHANNELS.includes(channel) && channel !== GITHUB_CHANNEL && channel !== FOLDER_CHANNEL
);

/**
 * The collections without those that later migrations create (inbox_keys, 1790202400;
 * login_failures, 1790203600).
 */
function withoutLaterCollections(collections) {
	return withoutLoginFailures(collections).filter((collection) => collection.name !== OWN_INBOX_COLLECTION);
}

/**
 * The collections without the protocol of failed sign-ins (1790203600), without what the accounts
 * add (1790203700, withoutAccounts) and without what managing a household adds (1790203800 to
 * 1790203900, withoutHouseholdCollections), which every test runs along.
 */
function withoutLoginFailures(collections) {
	return withoutHouseholdCollections(collections.filter((collection) => collection.name !== 'login_failures')).map(
		withoutAccounts
	);
}

/** The collections as before managing a household (ADR-0058): no household_invites, withoutHousehold. */
function withoutHouseholdCollections(collections) {
	return collections.filter((collection) => collection.name !== HOUSEHOLD_INVITES_COLLECTION).map(withoutHousehold);
}

/**
 * A collection, or a set of its rules, as before managing a household (ADR-0058): household_members
 * without the rights (1790203800), every rule with the owner branch of before (1790203900), and
 * households without the retention of their trash (ADR-0059, 1790204100).
 */
function withoutHousehold(collection) {
	const rules = {};
	for (const rule of RULE_NAMES) {
		let value = collection[rule];
		if (typeof value === 'string') {
			for (const [after, before] of PRIVATE_BRANCHES) value = value.split(after).join(before);
		}
		if (rule in collection) rules[rule] = value;
	}
	const plain = { ...collection, ...rules };
	if (!Array.isArray(collection.fields)) return plain;
	if (collection.name === 'household_members') {
		return { ...plain, fields: collection.fields.filter((field) => field.name !== 'rights') };
	}
	if (collection.name === 'households') {
		return { ...plain, fields: collection.fields.filter((field) => field.name !== 'trash_retention') };
	}
	return plain;
}

/**
 * A collection as before the accounts (ADR-0056, 1790203700): users without the right and the switch
 * and with the read rule of the own record, household_members with the read rule of the own rows.
 */
function withoutAccounts(collection) {
	if (collection.name === 'users' && collection.fields.some((field) => field.name === 'instance_admin')) {
		return {
			...collection,
			listRule: USERS_RULE_BEFORE_ACCOUNTS,
			viewRule: USERS_RULE_BEFORE_ACCOUNTS,
			fields: collection.fields.filter((field) => !ACCOUNT_FIELDS.includes(field.name))
		};
	}
	if (collection.name === 'household_members' && typeof collection.listRule === 'string' && collection.listRule.includes('_via_')) {
		return { ...collection, listRule: MEMBERS_RULE_BEFORE_ACCOUNTS, viewRule: MEMBERS_RULE_BEFORE_ACCOUNTS };
	}
	return collection;
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

/** A collection without the field of the sub-tasks of the template (plan WV-3, 1790202700). */
function withoutSubtasksField(collection) {
	if (collection.name !== 'recurrence_rules') return collection;
	return { ...collection, fields: collection.fields.filter((field) => !SUBTASKS_RULE_FIELDS.includes(field.name)) };
}

/** A collection without the field and index of the pinned comment (ADR-0044, 1790202600). */
function withoutPinField(collection) {
	if (collection.name !== 'tickets') return collection;
	return {
		...collection,
		fields: collection.fields.filter((field) => !PIN_TICKET_FIELDS.includes(field.name)),
		indexes: collection.indexes.filter((index) => !PIN_INDEX.test(index))
	};
}

/** A collection without the fields and the index of the target project (ADR-0049, 1790203100). */
function withoutTargetFields(collection) {
	if (collection.name === 'users') {
		return { ...collection, fields: collection.fields.filter((field) => !TARGET_USER_FIELDS.includes(field.name)) };
	}
	if (collection.name !== 'inbox_items' && collection.name !== 'connections') return collection;
	return {
		...collection,
		fields: collection.fields.filter((field) => !TARGET_FIELDS.includes(field.name)),
		indexes: collection.indexes.filter((index) => !TARGET_INDEX.test(index))
	};
}

/** A collection without the field of the colors (ADR-0052, 1790203400). */
function withoutColorFields(collection) {
	if (!COLOR_COLLECTIONS.includes(collection.name)) return collection;
	return { ...collection, fields: collection.fields.filter((field) => !COLOR_FIELDS.includes(field.name)) };
}

/**
 * A collection without what the folder channel adds (ADR-0051, 1790203300): the value "folder" of
 * inbox_items.channel, tickets.source and connections.type, the kind "file", secret_env required
 * again and 1 MB for connections.watch; and without the colors that follow it (withoutColorFields),
 * since every test that runs the one along runs the other as well.
 */
function withoutFolderChannel(input) {
	const collection = withoutColorFields(input);
	if (!['inbox_items', 'tickets', 'connections'].includes(collection.name)) return collection;
	return {
		...collection,
		fields: collection.fields.map((field) => {
			if (['channel', 'source', 'type'].includes(field.name)) {
				return { ...field, values: field.values.filter((value) => value !== FOLDER_CHANNEL) };
			}
			if (field.name === 'kind') return { ...field, values: field.values.filter((value) => value !== FOLDER_KIND) };
			if (collection.name === 'connections' && field.name === 'secret_env') return { ...field, required: true };
			if (collection.name === 'connections' && field.name === 'watch') return { ...field, maxSize: 1048576 };
			return field;
		})
	};
}

/**
 * A collection without what the GitHub channel adds (ADR-0050, 1790203200): the value "github" of
 * inbox_items.channel, tickets.source and connections.type, its three kinds of entries and the
 * field `watch` of inbox_items and connections; and without what the folder channel adds after it
 * (withoutFolderChannel), since every test that runs the one along runs the other as well.
 */
function withoutGithubChannel(input) {
	const collection = withoutFolderChannel(input);
	if (!['inbox_items', 'tickets', 'connections'].includes(collection.name)) return collection;
	return {
		...collection,
		fields: collection.fields
			.filter((field) => collection.name === 'tickets' || !GITHUB_FIELDS.includes(field.name))
			.map((field) => {
				if (['channel', 'source', 'type'].includes(field.name)) {
					return { ...field, values: field.values.filter((value) => value !== GITHUB_CHANNEL) };
				}
				if (field.name === 'kind') {
					return { ...field, values: field.values.filter((value) => !GITHUB_KINDS.includes(value)) };
				}
				return field;
			})
	};
}

/**
 * inbox_items with the deleteRule of the sources (1790201800: the rule of the own records and
 * `ticket = ""`) instead of the delete lock (null, 1790202800, ADR-0014 addendum of 2026-10-01).
 */
function withoutDeleteLock(collection) {
	if (collection.name !== 'inbox_items' || collection.deleteRule !== null) return collection;
	return { ...collection, deleteRule: `${withoutTrashRules(collection).listRule} && ticket = ""` };
}

/**
 * A collection without the fields, indexes and rule conditions of the migrations 1790202200
 * (plan OR-5), 1790202300 (trash, ADR-0037), 1790202500 (plan WV), 1790202600 (pinned comment,
 * ADR-0044), 1790202700 (plan WV-3), 1790202800 (delete lock of inbox items, ADR-0014 addendum of
 * 2026-10-01), 1790203100 (target project, ADR-0049), 1790203200 (GitHub channel, ADR-0050) and
 * without the channels of 1790202400 (own inbox, ADR-0038; its collection leaves with
 * `withoutLaterCollections`).
 */
function withoutLaterSchema(collection) {
	const plain = withoutGithubChannel(
		withoutTargetFields(withoutDeleteLock(withoutOwnInboxChannels(withoutTrashRules(collection))))
	);
	if (collection.name === 'tickets') {
		return {
			...plain,
			fields: plain.fields.filter((field) => !LATER_TICKET_FIELDS.includes(field.name)),
			indexes: collection.indexes.filter(
				(index) => !OPEN_INSTANCE_INDEX.test(index) && !TRASH_INDEX.test(index) && !PIN_INDEX.test(index)
			)
		};
	}
	if (collection.name === 'recurrence_rules') {
		return { ...plain, fields: collection.fields.filter((field) => !LATER_RULE_FIELDS.includes(field.name)) };
	}
	if (collection.name === 'users') {
		return { ...plain, fields: collection.fields.filter((field) => !LATER_USER_FIELDS.includes(field.name)) };
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
				expect(withoutFields(migrated.users, LATER_USER_FIELDS)).toEqual(before.users);
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
		}
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
		}
	);
});

const EACH_MIGRATION = '1790202200_recurrence_each_occurrence.js';
const TRASH_MIGRATION = '1790202300_tickets_trash.js';
const OWN_INBOX_MIGRATION = '1790202400_inbox_keys.js';
const STATUS_MIGRATION = '1790202500_recurrence_initial_status.js';
const PIN_MIGRATION = '1790202600_tickets_pinned_comment.js';
const SUBTASKS_MIGRATION = '1790202700_recurrence_template_subtasks.js';

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
			// condition of the index. The own inbox (ADR-0038, 1790202400), "Status beim Anlegen"
			// (plan WV, 1790202500), the pinned comment (ADR-0044, 1790202600), the sub-tasks of the
			// template (plan WV-3, 1790202700), the delete lock of inbox items (ADR-0014 addendum,
			// 1790202800), the backup schedule (ADR-0046, 1790203000), the target project (ADR-0049,
			// 1790203100) and the GitHub channel (ADR-0050, 1790203200) run along as well.
			const fromEach = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(EACH_MIGRATION));
			expect(fromEach).toEqual([
				EACH_MIGRATION,
				TRASH_MIGRATION,
				OWN_INBOX_MIGRATION,
				STATUS_MIGRATION,
				PIN_MIGRATION,
				SUBTASKS_MIGRATION,
				NO_DELETE_MIGRATION,
				BACKUP_SCHEDULE_MIGRATION,
				TARGET_MIGRATION,
				GITHUB_MIGRATION,
				FOLDER_MIGRATION,
				COLOR_MIGRATION,
				SECURITY_MIGRATION,
				LOGIN_FAILURES_MIGRATION,
				ACCOUNTS_MIGRATION,
				...HOUSEHOLD_MIGRATIONS
			]);

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
		}
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
			// The own inbox (ADR-0038, 1790202400), "Status beim Anlegen" (plan WV, 1790202500), the
			// pinned comment (ADR-0044, 1790202600), the sub-tasks of the template (plan WV-3,
			// 1790202700), the delete lock of inbox items (ADR-0014 addendum, 1790202800) and the
			// backup schedule (ADR-0046, 1790203000), the target project (ADR-0049, 1790203100) and the
			// GitHub channel (ADR-0050, 1790203200) follow and run along; they change no row here.
			const fromTrash = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(TRASH_MIGRATION));
			expect(fromTrash).toEqual([
				TRASH_MIGRATION,
				OWN_INBOX_MIGRATION,
				STATUS_MIGRATION,
				PIN_MIGRATION,
				SUBTASKS_MIGRATION,
				NO_DELETE_MIGRATION,
				BACKUP_SCHEDULE_MIGRATION,
				TARGET_MIGRATION,
				GITHUB_MIGRATION,
				FOLDER_MIGRATION,
				COLOR_MIGRATION,
				SECURITY_MIGRATION,
				LOGIN_FAILURES_MIGRATION,
				ACCOUNTS_MIGRATION,
				...HOUSEHOLD_MIGRATIONS
			]);

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
				expect(withoutFields(migrated.tickets, [...TRASH_TICKET_FIELDS, ...PIN_TICKET_FIELDS])).toEqual(
					before.tickets
				);
				expect(migrated.tickets.map(({ deleted_at, deleted_by }) => deleted_at + deleted_by)).toEqual(['', '', '']);
				expect(withoutFields(migrated.users, LATER_USER_FIELDS)).toEqual(before.users);
				expect(withoutFields(migrated.inbox_items, LATER_ITEM_FIELDS)).toEqual(before.inbox_items);
				for (const [name, rules] of Object.entries(ruleSet(dataDir))) {
					const { name: collectionName, ...plain } = withoutDeleteLock(
						withoutTrashRules(withoutHousehold({ name, ...rules }))
					);
					expect(plain, collectionName).toEqual(rulesBefore[name]);
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
		}
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
			// "Status beim Anlegen" (plan WV, 1790202500), the pinned comment (ADR-0044, 1790202600)
			// the sub-tasks of the template (plan WV-3, 1790202700), the delete lock of inbox items
			// (ADR-0014 addendum, 1790202800), the backup schedule (ADR-0046, 1790203000), the target
			// project (ADR-0049, 1790203100) and the GitHub channel (ADR-0050, 1790203200) follow and run
			// along; they change no row.
			const fromOwn = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(OWN_INBOX_MIGRATION));
			expect(fromOwn).toEqual([
				OWN_INBOX_MIGRATION,
				STATUS_MIGRATION,
				PIN_MIGRATION,
				SUBTASKS_MIGRATION,
				NO_DELETE_MIGRATION,
				BACKUP_SCHEDULE_MIGRATION,
				TARGET_MIGRATION,
				GITHUB_MIGRATION,
				FOLDER_MIGRATION,
				COLOR_MIGRATION,
				SECURITY_MIGRATION,
				LOGIN_FAILURES_MIGRATION,
				ACCOUNTS_MIGRATION,
				...HOUSEHOLD_MIGRATIONS
			]);

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
					inbox_items: [...OLD_VALUES, 'api', 'whatsapp-web', GITHUB_CHANNEL, FOLDER_CHANNEL],
					tickets: [...OLD_VALUES, 'api', 'whatsapp-web', GITHUB_CHANNEL, FOLDER_CHANNEL]
				});
				const migratedOwn = withDatabase(dataDir, snapshot);
				expect({
					...migratedOwn,
					tickets: withoutFields(migratedOwn.tickets, PIN_TICKET_FIELDS),
					users: withoutFields(migratedOwn.users, TARGET_USER_FIELDS),
					inbox_items: withoutFields(migratedOwn.inbox_items, LATER_ITEM_FIELDS),
					connections: withoutFields(migratedOwn.connections, LATER_ITEM_FIELDS)
				}).toEqual(before);
				expect(
					withoutLaterCollections(withoutTimestamps(readDataDir(dataDir).collections))
						.map(withoutOwnInboxChannels)
						.map(withoutStatusField)
						.map(withoutPinField)
						.map(withoutSubtasksField)
						.map(withoutDeleteLock)
						.map(withoutTargetFields)
						.map(withoutGithubChannel)
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
				const itemsBefore = Object.fromEntries(
					withoutFields(withNew.inbox_items, LATER_ITEM_FIELDS).map((row) => [row.id, row])
				);
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
		}
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
			// The pinned comment (ADR-0044, 1790202600), the sub-tasks of the template (plan WV-3,
			// 1790202700), the delete lock of inbox items (ADR-0014 addendum, 1790202800) and the
			// backup schedule (ADR-0046, 1790203000) follow and run along; they change no row.
			const fromStatus = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(STATUS_MIGRATION));
			expect(fromStatus).toEqual([
				STATUS_MIGRATION,
				PIN_MIGRATION,
				SUBTASKS_MIGRATION,
				NO_DELETE_MIGRATION,
				BACKUP_SCHEDULE_MIGRATION,
				TARGET_MIGRATION,
				GITHUB_MIGRATION,
				FOLDER_MIGRATION,
				COLOR_MIGRATION,
				SECURITY_MIGRATION,
				LOGIN_FAILURES_MIGRATION,
				ACCOUNTS_MIGRATION,
				...HOUSEHOLD_MIGRATIONS
			]);
			const ruleFields = [...STATUS_RULE_FIELDS, ...SUBTASKS_RULE_FIELDS];

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
				expect(
					withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections))
						.map(withoutStatusField)
						.map(withoutPinField)
						.map(withoutSubtasksField)
						.map(withoutDeleteLock)
						.map(withoutTargetFields)
						.map(withoutGithubChannel)
				).toEqual(schemaBefore);
				// No row changes: the rule of before has an empty status, which the hooks read as "open".
				const migrated = withDatabase(dataDir, snapshot);
				expect(withoutFields(migrated.recurrence_rules, ruleFields)).toEqual(before.recurrence_rules);
				expect(migrated.recurrence_rules.map((rule) => rule.initial_status)).toEqual(['']);
				expect(withoutFields(migrated.tickets, PIN_TICKET_FIELDS)).toEqual(before.tickets);
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
				expect(reverted.recurrence_rules).toEqual(withoutFields(withStatus.recurrence_rules, ruleFields));
				expect(reverted.tickets).toEqual(withoutFields(withStatus.tickets, PIN_TICKET_FIELDS));
				expect(reverted.tickets.map((ticket) => ticket.status)).toEqual(['done', 'waiting']);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromStatus);
				assertSchema(readDataDir(dataDir).collections);
				expect(withDatabase(dataDir, snapshot).recurrence_rules.map((rule) => rule.initial_status)).toEqual(['']);
			});
		}
	);
});

describe('migration rollback of the pinned comment (ADR-0044)', () => {
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const ticketsOf = (dataDir) => readDataDir(dataDir).collections.find((collection) => collection.name === 'tickets');
	const pinField = (dataDir) => ticketsOf(dataDir).fields.find((field) => field.name === 'pinned_comment');
	const commentsOf = (db) => db.prepare('SELECT * FROM comments ORDER BY id').all();

	/** Two tickets with comments, as before the pin. */
	function insertData(db) {
		db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(OWNER, 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
		const ticket = db.prepare(
			'INSERT INTO tickets (id, number, key, title, status, priority, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		);
		ticket.run('ticket000000001', 1, 'TASK-1', 'Mit Kommentaren', 'open', 'medium', SCOPE, OWNER, STAMP, STAMP);
		ticket.run('ticket000000002', 2, 'TASK-2', 'Ohne', 'done', 'low', SCOPE, OWNER, STAMP, STAMP);
		const comment = db.prepare('INSERT INTO comments (id, ticket, author, body, created, updated) VALUES (?, ?, ?, ?, ?, ?)');
		comment.run('comment00000001', 'ticket000000001', OWNER, 'Erster', STAMP, STAMP);
		comment.run('comment00000002', 'ticket000000001', OWNER, 'Wichtig', STAMP, STAMP);
	}

	it(
		'adds the relation and its index without changing a row, and drops only the pins on the way back',
		async () => {
			// The sub-tasks of the template (plan WV-3, 1790202700), the delete lock of inbox items
			// (ADR-0014 addendum, 1790202800) and the backup schedule (ADR-0046, 1790203000) follow and
			// run along; no row changes.
			const fromPin = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(PIN_MIGRATION));
			expect(fromPin).toEqual([
				PIN_MIGRATION,
				SUBTASKS_MIGRATION,
				NO_DELETE_MIGRATION,
				BACKUP_SCHEDULE_MIGRATION,
				TARGET_MIGRATION,
				GITHUB_MIGRATION,
				FOLDER_MIGRATION,
				COLOR_MIGRATION,
				SECURITY_MIGRATION,
				LOGIN_FAILURES_MIGRATION,
				ACCOUNTS_MIGRATION,
				...HOUSEHOLD_MIGRATIONS
			]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromPin.length));
				expect(pinField(dataDir)).toBeUndefined();
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, snapshot);
				const commentsBefore = withDatabase(dataDir, commentsOf);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromPin);
				assertSchema(readDataDir(dataDir).collections);
				const comments = readDataDir(dataDir).collections.find((collection) => collection.name === 'comments');
				expect(pinField(dataDir)).toMatchObject({
					type: 'relation',
					required: false,
					collectionId: comments.id,
					cascadeDelete: false,
					maxSelect: 1
				});
				// The exact statement is checked by assertSchema.
				expect(ticketsOf(dataDir).indexes.filter((index) => PIN_INDEX.test(index))).toHaveLength(1);
				expect(
					withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections))
						.map(withoutPinField)
						.map(withoutSubtasksField)
						.map(withoutDeleteLock)
						.map(withoutTargetFields)
						.map(withoutGithubChannel)
				).toEqual(schemaBefore);
				// No row changes: every ticket starts without a pin.
				const migrated = withDatabase(dataDir, snapshot);
				expect(withoutFields(migrated.tickets, PIN_TICKET_FIELDS)).toEqual(before.tickets);
				expect(migrated.tickets.map((ticket) => ticket.pinned_comment)).toEqual(['', '']);

				// A pinned comment, then back: only the column goes, tickets and comments stay.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE tickets SET pinned_comment = ? WHERE id = ?').run('comment00000002', 'ticket000000001');
				});
				const pinned = withDatabase(dataDir, snapshot);

				const down = await migrate(args, 'down', String(fromPin.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromPin].reverse());
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				const reverted = withDatabase(dataDir, snapshot);
				expect(reverted.tickets).toEqual(withoutFields(pinned.tickets, PIN_TICKET_FIELDS));
				expect(reverted.tickets).toEqual(before.tickets);
				expect(withDatabase(dataDir, commentsOf)).toEqual(commentsBefore);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromPin);
				assertSchema(readDataDir(dataDir).collections);
				expect(withDatabase(dataDir, snapshot).tickets.map((ticket) => ticket.pinned_comment)).toEqual(['', '']);
			});
		}
	);
});

describe('migration rollback of the sub-tasks of the template (plan WV-3, ADR-0022 addendum 10)', () => {
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const day = (date) => `${date} 00:00:00.000Z`;
	const subtasksField = (dataDir) =>
		readDataDir(dataDir)
			.collections.find((collection) => collection.name === 'recurrence_rules')
			.fields.find((field) => field.name === 'template_subtasks');
	const insertTicket = (db, id, number, title, parent) =>
		db
			.prepare(
				'INSERT INTO tickets (id, number, key, title, status, priority, due, recurrence, parent, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			)
			.run(id, number, `TASK-${number}`, title, 'open', 'medium', parent === '' ? day('2026-10-05') : '', parent === '' ? 'rule00000000001' : '', parent, SCOPE, OWNER, STAMP, STAMP);

	/** A rule with its open ticket, as before the field. */
	function insertData(db) {
		db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(OWNER, 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
		db.prepare(
			'INSERT INTO recurrence_rules (id, title, priority, mode, freq, interval, weekdays, anchor, lead_days, next_due, active, initial_status, scope, owner, created, updated) ' +
				'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('rule00000000001', 'Kaffeemaschine', 'high', 'calendar', 'weekly', 1, '["MO"]', day('2026-09-21'), 3, day('2026-10-12'), 1, 'open', SCOPE, OWNER, STAMP, STAMP);
		insertTicket(db, 'ticket000000001', 1, 'Kaffeemaschine', '');
	}

	it(
		'adds the field without changing a row, and the sub-tasks made with it stay on the way back',
		async () => {
			// The delete lock of inbox items (ADR-0014 addendum, 1790202800) and the backup schedule
			// (ADR-0046, 1790203000) follow and run along; they change no row.
			const fromSubtasks = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(SUBTASKS_MIGRATION));
			expect(fromSubtasks).toEqual([
				SUBTASKS_MIGRATION,
				NO_DELETE_MIGRATION,
				BACKUP_SCHEDULE_MIGRATION,
				TARGET_MIGRATION,
				GITHUB_MIGRATION,
				FOLDER_MIGRATION,
				COLOR_MIGRATION,
				SECURITY_MIGRATION,
				LOGIN_FAILURES_MIGRATION,
				ACCOUNTS_MIGRATION,
				...HOUSEHOLD_MIGRATIONS
			]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromSubtasks.length));
				expect(subtasksField(dataDir)).toBeUndefined();
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, snapshot);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromSubtasks);
				assertSchema(readDataDir(dataDir).collections);
				expect(subtasksField(dataDir)).toMatchObject({ type: 'json', required: false, maxSize: 40000 });
				expect(
					withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections))
						.map(withoutSubtasksField)
						.map(withoutDeleteLock)
						.map(withoutTargetFields)
						.map(withoutGithubChannel)
				).toEqual(schemaBefore);
				// No row changes: the rule of before has no sub-tasks (null, which the hooks read as none).
				const migrated = withDatabase(dataDir, snapshot);
				expect(withoutFields(migrated.recurrence_rules, SUBTASKS_RULE_FIELDS)).toEqual(before.recurrence_rules);
				expect(migrated.recurrence_rules.map((rule) => rule.template_subtasks)).toEqual([null]);
				expect(migrated.tickets).toEqual(before.tickets);

				// The template gets sub-tasks, and the next ticket was made with them.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE recurrence_rules SET template_subtasks = ? WHERE id = ?').run(
						JSON.stringify([
							{ title: 'Entkalken', priority: 'high' },
							{ title: 'Filter wechseln', priority: 'medium' }
						]),
						'rule00000000001'
					);
					insertTicket(db, 'ticket000000002', 2, 'Entkalken', 'ticket000000001');
					insertTicket(db, 'ticket000000003', 3, 'Filter wechseln', 'ticket000000001');
				});
				const withSubtasks = withDatabase(dataDir, snapshot);

				const down = await migrate(args, 'down', String(fromSubtasks.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromSubtasks].reverse());
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				// The field goes with its value; the rule makes tickets without sub-tasks again, the
				// tickets and sub-tasks made meanwhile stay as they are.
				const reverted = withDatabase(dataDir, snapshot);
				expect(reverted.recurrence_rules).toEqual(withoutFields(withSubtasks.recurrence_rules, SUBTASKS_RULE_FIELDS));
				expect(reverted.recurrence_rules).toEqual(before.recurrence_rules);
				expect(reverted.tickets).toEqual(withSubtasks.tickets);
				expect(reverted.tickets.map((ticket) => [ticket.title, ticket.parent])).toEqual([
					['Kaffeemaschine', ''],
					['Entkalken', 'ticket000000001'],
					['Filter wechseln', 'ticket000000001']
				]);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromSubtasks);
				assertSchema(readDataDir(dataDir).collections);
				expect(withDatabase(dataDir, snapshot).recurrence_rules.map((rule) => rule.template_subtasks)).toEqual([null]);
			});
		}
	);
});

describe('migration rollback of the target project (ADR-0049)', () => {
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const collectionOf = (dataDir, name) =>
		readDataDir(dataDir).collections.find((collection) => collection.name === name);
	const fieldOf = (dataDir, collection, name) =>
		collectionOf(dataDir, collection)?.fields.find((field) => field.name === name);

	/** A project, a connection and two entries of it, as before the target project. */
	function insertData(db) {
		db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(OWNER, 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
		db.prepare(
			'INSERT INTO projects (id, name, code, archived, owner, household, scope, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('project00000001', 'Haus', 'HAUS', 0, OWNER, '', SCOPE, STAMP, STAMP);
		db.prepare(
			'INSERT INTO connections (id, type, label, enabled, secret_env, settings, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('connection00001', 'calendar', 'Kalender', 1, 'BYL_KALENDER', '{"keywords":["todo"]}', SCOPE, OWNER, STAMP, STAMP);
		const item = db.prepare(
			'INSERT INTO inbox_items (id, channel, kind, title, source_ref, fingerprint, state, connection, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		);
		item.run('item00000000001', 'calendar', 'event', 'Müll', 'uid-1', 'f1', 'new', 'connection00001', SCOPE, OWNER, STAMP, STAMP);
		item.run('item00000000002', 'eml', 'mail', 'Rechnung', '<a@example.com>', 'f2', 'discarded', '', SCOPE, OWNER, STAMP, STAMP);
	}

	it(
		'adds the fields and the index without changing a row, and drops only the targets on the way back',
		async () => {
			// The GitHub channel (ADR-0050, 1790203200) follows and runs along; it changes no row.
			const fromTarget = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(TARGET_MIGRATION));
			expect(fromTarget).toEqual([TARGET_MIGRATION, GITHUB_MIGRATION, FOLDER_MIGRATION, COLOR_MIGRATION, SECURITY_MIGRATION, LOGIN_FAILURES_MIGRATION, ACCOUNTS_MIGRATION, ...HOUSEHOLD_MIGRATIONS]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromTarget.length));
				expect(fieldOf(dataDir, 'inbox_items', 'target_project')).toBeUndefined();
				expect(fieldOf(dataDir, 'connections', 'target_project')).toBeUndefined();
				expect(fieldOf(dataDir, 'users', 'inbox_targets')).toBeUndefined();
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, snapshot);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromTarget);
				assertSchema(readDataDir(dataDir).collections);
				const projects = collectionOf(dataDir, 'projects');
				for (const collection of ['inbox_items', 'connections']) {
					expect(fieldOf(dataDir, collection, 'target_project'), collection).toMatchObject({
						type: 'relation',
						required: false,
						collectionId: projects.id,
						cascadeDelete: false,
						maxSelect: 1
					});
				}
				expect(fieldOf(dataDir, 'users', 'inbox_targets')).toMatchObject({ type: 'json', required: false, maxSize: 2000 });
				// The exact statement is checked by assertSchema.
				expect(collectionOf(dataDir, 'inbox_items').indexes.filter((index) => TARGET_INDEX.test(index))).toHaveLength(1);
				expect(
					withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections))
						.map(withoutTargetFields)
						.map(withoutGithubChannel)
				).toEqual(schemaBefore);
				// No row changes: entries and connections of before have no target, users none either.
				const migrated = withDatabase(dataDir, snapshot);
				expect(withoutLater(migrated)).toEqual(withoutLater(before));
				expect(withoutFields(migrated.inbox_items, LATER_ITEM_FIELDS)).toEqual(before.inbox_items);
				expect(migrated.inbox_items.map((item) => item.target_project)).toEqual(['', '']);
				expect(migrated.connections.map((connection) => connection.target_project)).toEqual(['']);
				expect(migrated.users.map((user) => user.inbox_targets)).toEqual([null]);

				// Targets are set, then back: only the columns go, every other value stays.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE connections SET target_project = ? WHERE id = ?').run('project00000001', 'connection00001');
					db.prepare('UPDATE inbox_items SET target_project = ? WHERE id = ?').run('project00000001', 'item00000000001');
					db.prepare('UPDATE users SET inbox_targets = ? WHERE id = ?').run('{"files":"project00000001"}', OWNER);
				});
				const withTargets = withDatabase(dataDir, snapshot);

				const down = await migrate(args, 'down', String(fromTarget.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromTarget].reverse());
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				const reverted = withDatabase(dataDir, snapshot);
				expect(reverted.inbox_items).toEqual(withoutFields(withTargets.inbox_items, LATER_ITEM_FIELDS));
				expect(reverted).toEqual(before);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromTarget);
				assertSchema(readDataDir(dataDir).collections);
				expect(withDatabase(dataDir, snapshot).inbox_items.map((item) => item.target_project)).toEqual(['', '']);
			});
		}
	);
});

describe('migration rollback of the GitHub channel (ADR-0050)', () => {
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const collectionOf = (dataDir, name) =>
		readDataDir(dataDir).collections.find((collection) => collection.name === name);
	const fieldOf = (dataDir, collection, name) =>
		collectionOf(dataDir, collection)?.fields.find((field) => field.name === name);
	const valuesOf = (dataDir) => ({
		channel: fieldOf(dataDir, 'inbox_items', 'channel').values,
		kind: fieldOf(dataDir, 'inbox_items', 'kind').values,
		source: fieldOf(dataDir, 'tickets', 'source').values,
		type: fieldOf(dataDir, 'connections', 'type').values
	});

	/** A user, a calendar connection with an entry and a ticket, as before the GitHub channel. */
	function insertData(db) {
		db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(OWNER, 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
		db.prepare(
			'INSERT INTO connections (id, type, label, enabled, secret_env, settings, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('connection00001', 'calendar', 'Kalender', 1, 'BYL_KALENDER', '{"keywords":["todo"]}', SCOPE, OWNER, STAMP, STAMP);
		db.prepare(
			'INSERT INTO inbox_items (id, channel, kind, title, source_ref, fingerprint, state, connection, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('item00000000001', 'calendar', 'event', 'Müll', 'uid-1', 'f1', 'new', 'connection00001', SCOPE, OWNER, STAMP, STAMP);
		db.prepare(
			'INSERT INTO tickets (id, number, key, title, status, priority, source, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('ticket000000001', 1, 'TASK-1', 'Alt', 'open', 'medium', 'calendar', SCOPE, OWNER, STAMP, STAMP);
	}

	it(
		'adds the values and the fields without changing a row; on the way back GitHub entries become web links and GitHub connections go',
		async () => {
			// The folder channel (ADR-0051, 1790203300) follows and runs along; it changes no row.
			const fromGithub = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(GITHUB_MIGRATION));
			expect(fromGithub).toEqual([GITHUB_MIGRATION, FOLDER_MIGRATION, COLOR_MIGRATION, SECURITY_MIGRATION, LOGIN_FAILURES_MIGRATION, ACCOUNTS_MIGRATION, ...HOUSEHOLD_MIGRATIONS]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromGithub.length));
				expect(fieldOf(dataDir, 'inbox_items', 'watch')).toBeUndefined();
				expect(fieldOf(dataDir, 'connections', 'watch')).toBeUndefined();
				const valuesBefore = valuesOf(dataDir);
				expect(valuesBefore.channel).not.toContain(GITHUB_CHANNEL);
				expect(valuesBefore.type).toEqual(['calendar', 'telegram', 'notion', 'mail']);
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, snapshot);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromGithub);
				assertSchema(readDataDir(dataDir).collections);
				expect(valuesOf(dataDir)).toEqual({
					channel: [...valuesBefore.channel, GITHUB_CHANNEL, FOLDER_CHANNEL],
					kind: [...valuesBefore.kind, ...GITHUB_KINDS, FOLDER_KIND],
					source: [...valuesBefore.source, GITHUB_CHANNEL, FOLDER_CHANNEL],
					type: [...valuesBefore.type, GITHUB_CHANNEL, FOLDER_CHANNEL]
				});
				expect(fieldOf(dataDir, 'inbox_items', 'watch')).toMatchObject({ type: 'json', required: false, maxSize: 2000 });
				// 1 MB with the GitHub channel, 8 MB since the folder channel.
				expect(fieldOf(dataDir, 'connections', 'watch')).toMatchObject({ type: 'json', required: false, hidden: true, maxSize: 8388608 });
				expect(withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections)).map(withoutGithubChannel)).toEqual(
					schemaBefore
				);
				// No row changes: entries and connections of before have no status and no state.
				const migrated = withDatabase(dataDir, snapshot);
				expect({
					...migrated,
					inbox_items: withoutFields(migrated.inbox_items, GITHUB_FIELDS),
					connections: withoutFields(migrated.connections, GITHUB_FIELDS)
				}).toEqual(before);
				expect(migrated.inbox_items.map((item) => item.watch)).toEqual([null]);
				expect(migrated.connections.map((connection) => connection.watch)).toEqual([null]);

				// A GitHub connection with its entries and a ticket from one, then back.
				withDatabase(dataDir, (db) => {
					db.prepare(
						'INSERT INTO connections (id, type, label, enabled, secret_env, settings, watch, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).run('connection00002', 'github', 'GitHub', 1, 'BYL_GITHUB_TOKEN', '{"repos":[{"repo":"octo/roadmap"}]}', '{"repos":{}}', SCOPE, OWNER, STAMP, STAMP);
					const item = db.prepare(
						'INSERT INTO inbox_items (id, channel, kind, title, source_url, source_ref, fingerprint, state, connection, watch, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					item.run('item00000000002', 'github', 'change', 'CHANGELOG.md in octo/roadmap geändert', 'https://github.com/octo/roadmap/blob/a/CHANGELOG.md', 'file:octo/roadmap:CHANGELOG.md', 'f2', 'new', 'connection00002', '{"kind":"file","state":"current"}', SCOPE, OWNER, STAMP, STAMP);
					item.run('item00000000003', 'github', 'pull_request', 'PR #1 in octo/roadmap: Plan', 'https://github.com/octo/roadmap/pull/1', 'PR_x', 'f3', 'converted', 'connection00002', '{"kind":"pull","state":"merged"}', SCOPE, OWNER, STAMP, STAMP);
					item.run('item00000000004', 'github', 'release', 'Release v1 in octo/roadmap', 'https://github.com/octo/roadmap/releases/tag/v1', 'RE_x', 'f4', 'discarded', 'connection00002', null, SCOPE, OWNER, STAMP, STAMP);
					db.prepare(
						'INSERT INTO tickets (id, number, key, title, status, priority, source, source_item, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).run('ticket000000002', 2, 'TASK-2', 'Aus dem PR', 'open', 'medium', 'github', 'item00000000003', SCOPE, OWNER, STAMP, STAMP);
					db.prepare('UPDATE inbox_items SET ticket = ? WHERE id = ?').run('ticket000000002', 'item00000000003');
				});
				const withGithub = withDatabase(dataDir, snapshot);

				const down = await migrate(args, 'down', String(fromGithub.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromGithub].reverse());
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				const reverted = withDatabase(dataDir, snapshot);
				const items = Object.fromEntries(reverted.inbox_items.map((row) => [row.id, row]));
				const itemsBefore = Object.fromEntries(withoutFields(withGithub.inbox_items, GITHUB_FIELDS).map((row) => [row.id, row]));
				expect(items.item00000000001).toEqual(before.inbox_items[0]);
				for (const id of ['item00000000002', 'item00000000003', 'item00000000004']) {
					expect(items[id], id).toEqual({ ...itemsBefore[id], channel: 'link', kind: 'link', connection: '' });
				}
				const tickets = Object.fromEntries(reverted.tickets.map((row) => [row.id, row]));
				expect(tickets.ticket000000001).toEqual(before.tickets[0]);
				expect(tickets.ticket000000002).toEqual({ ...withGithub.tickets[1], source: 'link' });
				expect(reverted.connections).toEqual(before.connections);
				expect(reverted.users).toEqual(before.users);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromGithub);
				assertSchema(readDataDir(dataDir).collections);
			});
		}
	);
});

describe('migration rollback of the folder channel (ADR-0051)', () => {
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const collectionOf = (dataDir, name) =>
		readDataDir(dataDir).collections.find((collection) => collection.name === name);
	const fieldOf = (dataDir, collection, name) =>
		collectionOf(dataDir, collection)?.fields.find((field) => field.name === name);
	const valuesOf = (dataDir) => ({
		channel: fieldOf(dataDir, 'inbox_items', 'channel').values,
		kind: fieldOf(dataDir, 'inbox_items', 'kind').values,
		source: fieldOf(dataDir, 'tickets', 'source').values,
		type: fieldOf(dataDir, 'connections', 'type').values
	});

	/** A user, a GitHub connection with an entry and a ticket from it, as before the folder channel. */
	function insertData(db) {
		db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(OWNER, 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
		db.prepare(
			'INSERT INTO connections (id, type, label, enabled, secret_env, settings, watch, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('connection00001', 'github', 'GitHub', 1, 'BYL_GITHUB_TOKEN', '{"repos":[{"repo":"octo/roadmap"}]}', '{"repos":{}}', SCOPE, OWNER, STAMP, STAMP);
		db.prepare(
			'INSERT INTO inbox_items (id, channel, kind, title, source_ref, fingerprint, state, connection, watch, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('item00000000001', 'github', 'change', 'CHANGELOG.md in octo/roadmap geändert', 'file:octo/roadmap:CHANGELOG.md', 'f1', 'new', 'connection00001', '{"kind":"file","state":"current"}', SCOPE, OWNER, STAMP, STAMP);
		db.prepare(
			'INSERT INTO tickets (id, number, key, title, status, priority, source, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('ticket000000001', 1, 'TASK-1', 'Alt', 'open', 'medium', 'github', SCOPE, OWNER, STAMP, STAMP);
	}

	it(
		'adds the values, makes the variable optional and gives the state more room without changing a row; on the way back folder entries become manual ones and folder connections go',
		async () => {
			// The colors (ADR-0052, 1790203400) follow and run along; they change no row.
			const fromFolder = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(FOLDER_MIGRATION));
			expect(fromFolder).toEqual([FOLDER_MIGRATION, COLOR_MIGRATION, SECURITY_MIGRATION, LOGIN_FAILURES_MIGRATION, ACCOUNTS_MIGRATION, ...HOUSEHOLD_MIGRATIONS]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromFolder.length));
				const valuesBefore = valuesOf(dataDir);
				expect(valuesBefore.channel).not.toContain(FOLDER_CHANNEL);
				expect(valuesBefore.type).toEqual(['calendar', 'telegram', 'notion', 'mail', 'github']);
				expect(fieldOf(dataDir, 'connections', 'secret_env')).toMatchObject({ required: true });
				expect(fieldOf(dataDir, 'connections', 'watch')).toMatchObject({ maxSize: 1048576 });
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, snapshot);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromFolder);
				assertSchema(readDataDir(dataDir).collections);
				expect(valuesOf(dataDir)).toEqual({
					channel: [...valuesBefore.channel, FOLDER_CHANNEL],
					kind: [...valuesBefore.kind, FOLDER_KIND],
					source: [...valuesBefore.source, FOLDER_CHANNEL],
					type: [...valuesBefore.type, FOLDER_CHANNEL]
				});
				expect(fieldOf(dataDir, 'connections', 'secret_env')).toMatchObject({ required: false, pattern: '^BYL_[A-Z0-9_]{1,60}$' });
				expect(fieldOf(dataDir, 'connections', 'watch')).toMatchObject({ hidden: true, maxSize: 8388608 });
				expect(withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections)).map(withoutFolderChannel)).toEqual(
					schemaBefore
				);
				// No row changes.
				expect(withDatabase(dataDir, snapshot)).toEqual(before);

				// A folder connection without a variable, its entries and a ticket from one, then back.
				withDatabase(dataDir, (db) => {
					db.prepare(
						'INSERT INTO connections (id, type, label, enabled, secret_env, settings, watch, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).run('connection00002', 'folder', 'Ordner', 1, '', '{"folders":[{"path":"C:\\\\Daten"}]}', '{"folders":{}}', SCOPE, OWNER, STAMP, STAMP);
					const item = db.prepare(
						'INSERT INTO inbox_items (id, channel, kind, title, source_ref, fingerprint, state, connection, watch, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					item.run('item00000000002', 'folder', 'file', 'Neue Datei: a.pdf', 'C:\\Daten\\a.pdf', 'f2', 'new', 'connection00002', '{"kind":"file","state":"current"}', SCOPE, OWNER, STAMP, STAMP);
					item.run('item00000000003', 'folder', 'change', 'Datei geändert: a.pdf', 'C:\\Daten\\a.pdf', 'f3', 'converted', 'connection00002', '{"kind":"file","state":"moved","to":"b/a.pdf"}', SCOPE, OWNER, STAMP, STAMP);
					db.prepare(
						'INSERT INTO tickets (id, number, key, title, status, priority, source, source_item, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					).run('ticket000000002', 2, 'TASK-2', 'Aus dem Ordner', 'open', 'medium', 'folder', 'item00000000003', SCOPE, OWNER, STAMP, STAMP);
					db.prepare('UPDATE inbox_items SET ticket = ? WHERE id = ?').run('ticket000000002', 'item00000000003');
				});
				const withFolder = withDatabase(dataDir, snapshot);

				const down = await migrate(args, 'down', String(fromFolder.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromFolder].reverse());
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				const reverted = withDatabase(dataDir, snapshot);
				const items = Object.fromEntries(reverted.inbox_items.map((row) => [row.id, row]));
				const itemsBefore = Object.fromEntries(withFolder.inbox_items.map((row) => [row.id, row]));
				expect(items.item00000000001).toEqual(before.inbox_items[0]);
				expect(items.item00000000002).toEqual({ ...itemsBefore.item00000000002, channel: 'manual', kind: 'todo', connection: '' });
				expect(items.item00000000003).toEqual({ ...itemsBefore.item00000000003, channel: 'manual', connection: '' });
				const tickets = Object.fromEntries(reverted.tickets.map((row) => [row.id, row]));
				expect(tickets.ticket000000001).toEqual(before.tickets[0]);
				expect(tickets.ticket000000002).toEqual({ ...withFolder.tickets[1], source: 'manual' });
				expect(reverted.connections).toEqual(before.connections);
				expect(reverted.users).toEqual(before.users);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromFolder);
				assertSchema(readDataDir(dataDir).collections);
			});
		}
	);
});

describe('migration rollback of the colors (ADR-0052)', () => {
	const OWNER = 'user00000000001';
	const SCOPE = 'u:user00000000001';
	const colorField = (dataDir, name) =>
		readDataDir(dataDir)
			.collections.find((collection) => collection.name === name)
			?.fields.find((field) => field.name === 'color');
	const projectRows = (db) => db.prepare('SELECT * FROM projects ORDER BY id').all();
	/** The rows of the three collections with a color, the column included (snapshot leaves it out). */
	const rows = (db) =>
		Object.fromEntries(
			COLOR_COLLECTIONS.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])
		);
	const withoutColorColumns = (data) =>
		Object.fromEntries(Object.entries(data).map(([table, list]) => [table, withoutFields(list, COLOR_FIELDS)]));

	/** A project with a sub project, a rule and two tickets, as before the colors. */
	function insertData(db) {
		db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(OWNER, 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
		const project = db.prepare(
			'INSERT INTO projects (id, name, code, archived, parent, owner, household, scope, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		);
		project.run('project00000001', 'Haus', 'HAUS', 0, '', OWNER, '', SCOPE, STAMP, STAMP);
		project.run('project00000002', 'Garten', 'GART', 0, 'project00000001', OWNER, '', SCOPE, STAMP, STAMP);
		db.prepare(
			'INSERT INTO recurrence_rules (id, title, priority, mode, freq, interval, weekdays, anchor, lead_days, next_due, active, project, scope, owner, created, updated) ' +
				'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run('rule00000000001', 'Rasen', 'medium', 'calendar', 'weekly', 1, '["SA"]', '2026-09-26 00:00:00.000Z', 3, '2026-10-03 00:00:00.000Z', 1, 'project00000002', SCOPE, OWNER, STAMP, STAMP);
		const ticket = db.prepare(
			'INSERT INTO tickets (id, number, key, title, status, priority, project, recurrence, scope, owner, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		);
		ticket.run('ticket000000001', 1, 'HAUS-1', 'Dach', 'open', 'high', 'project00000001', '', SCOPE, OWNER, STAMP, STAMP);
		ticket.run('ticket000000002', 1, 'GART-1', 'Rasen', 'open', 'medium', 'project00000002', 'rule00000000001', SCOPE, OWNER, STAMP, STAMP);
	}

	it(
		'adds a select field of the palette to projects, tickets and rules without changing a row; the way back loses only the colors',
		async () => {
			const fromColor = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(COLOR_MIGRATION));
			expect(fromColor).toEqual([COLOR_MIGRATION, SECURITY_MIGRATION, LOGIN_FAILURES_MIGRATION, ACCOUNTS_MIGRATION, ...HOUSEHOLD_MIGRATIONS]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromColor.length));
				for (const name of COLOR_COLLECTIONS) expect(colorField(dataDir, name), name).toBeUndefined();
				withDatabase(dataDir, insertData);
				const before = withDatabase(dataDir, rows);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromColor);
				assertSchema(readDataDir(dataDir).collections);
				for (const name of COLOR_COLLECTIONS) {
					expect(colorField(dataDir, name), name).toMatchObject({
						type: 'select',
						required: false,
						values: PROJECT_COLORS,
						maxSelect: 1
					});
				}
				// No red in the palette (ADR-0009, ADR-0052).
				expect(PROJECT_COLORS.join(' ')).not.toMatch(/rot|red|orange|pink|rosa/);
				expect(withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections)).map(withoutColorFields)).toEqual(
					schemaBefore
				);
				// No row changes: data of before has no color.
				const migrated = withDatabase(dataDir, rows);
				expect(withoutColorColumns(migrated)).toEqual(before);
				expect(migrated.projects.map((row) => row.color)).toEqual(['', '']);
				expect(migrated.tickets.map((row) => row.color)).toEqual(['', '']);
				expect(migrated.recurrence_rules.map((row) => row.color)).toEqual(['']);

				// Colors set meanwhile go on the way back, nothing else does.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE projects SET color = ? WHERE id = ?').run('blau', 'project00000001');
					db.prepare('UPDATE tickets SET color = ? WHERE id = ?').run('gruen', 'ticket000000002');
					db.prepare('UPDATE recurrence_rules SET color = ? WHERE id = ?').run('senf', 'rule00000000001');
				});
				const colored = withDatabase(dataDir, rows);

				const down = await migrate(args, 'down', String(fromColor.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromColor].reverse());
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				expect(withDatabase(dataDir, rows)).toEqual(withoutColorColumns(colored));
				expect(withDatabase(dataDir, rows)).toEqual(before);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromColor);
				assertSchema(readDataDir(dataDir).collections);
				expect(withDatabase(dataDir, projectRows).map((row) => row.color)).toEqual(['', '']);
			});
		}
	);
});

/** Changes the stored settings of the data folder like the admin UI would. */
function changeSettings(dataDir, change) {
	withDatabase(dataDir, (db) => {
		const row = db.prepare("SELECT value FROM _params WHERE id = 'settings'").get();
		const settings = JSON.parse(new TextDecoder().decode(row.value));
		change(settings);
		db.prepare("UPDATE _params SET value = ? WHERE id = 'settings'").run(new TextEncoder().encode(JSON.stringify(settings)));
	});
}

describe('migration of the security hardening (ADR-0055)', () => {
	it(
		'switches the rate limiter on with "Normal" and the superusers to this machine, there and back, and keeps settings of the admin UI',
		async () => {
			const fromSecurity = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(SECURITY_MIGRATION));
			expect(fromSecurity).toEqual([SECURITY_MIGRATION, LOGIN_FAILURES_MIGRATION, ACCOUNTS_MIGRATION, ...HOUSEHOLD_MIGRATIONS]);
			const settingsOf = (dataDir) => readDataDir(dataDir).settings;

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				// The protocol of failed sign-ins (1790203600) goes along on the way back.
				const schema = withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections));
				expect(settingsOf(dataDir).rateLimits).toMatchObject({ enabled: true, rules: security.rateLimitRules('normal') });

				const down = await migrate(args, 'down', String(fromSecurity.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromSecurity].reverse());
				expect(settingsOf(dataDir).rateLimits).toMatchObject({ enabled: false, rules: security.POCKETBASE_DEFAULT_RULES });
				expect(settingsOf(dataDir).superuserIPs ?? []).toEqual([]);
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schema);

				// "Streng" of the page Sicherheit goes back to the defaults as well.
				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromSecurity);
				changeSettings(dataDir, (settings) => (settings.rateLimits.rules = security.rateLimitRules('strict')));
				await migrate(args, 'down', String(fromSecurity.length));
				expect(settingsOf(dataDir).rateLimits).toMatchObject({ enabled: false, rules: security.POCKETBASE_DEFAULT_RULES });

				// Rules and addresses of the admin UI stay, up and down.
				const own = [{ label: '*:auth', audience: '', duration: 30, maxRequests: 3 }];
				changeSettings(dataDir, (settings) => {
					settings.rateLimits = { enabled: true, excludedIPs: [], rules: own };
					settings.superuserIPs = ['10.0.0.0/24'];
				});
				await migrate(args, 'up');
				expect(settingsOf(dataDir).rateLimits).toMatchObject({ enabled: true, rules: own });
				expect(settingsOf(dataDir).superuserIPs).toEqual(['10.0.0.0/24']);
				await migrate(args, 'down', String(fromSecurity.length));
				expect(settingsOf(dataDir).rateLimits).toMatchObject({ enabled: true, rules: own });
				expect(settingsOf(dataDir).superuserIPs).toEqual(['10.0.0.0/24']);
			});
		}
	);
});

describe('migration rollback of the protocol of failed sign-ins (ADR-0055 §8)', () => {
	const failuresOf = (dataDir) =>
		readDataDir(dataDir).collections.find((collection) => collection.name === 'login_failures');

	it(
		'adds login_failures without API rules and removes it with its rows on the way back',
		async () => {
			const fromLogins = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(LOGIN_FAILURES_MIGRATION));
			expect(fromLogins).toEqual([LOGIN_FAILURES_MIGRATION, ACCOUNTS_MIGRATION, ...HOUSEHOLD_MIGRATIONS]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				assertSchema(readDataDir(dataDir).collections);
				const created = failuresOf(dataDir);
				for (const rule of RULE_NAMES) expect(created[rule], rule).toBeNull();
				withDatabase(dataDir, (db) =>
					db
						.prepare('INSERT INTO login_failures (id, area, identity, known, source, host, ip, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
						.run('failure00000001', 'app', 'anna@example.com', 1, 'app', '127.0.0.1:8090', '127.0.0.1', STAMP)
				);
				const others = withoutLoginFailures(withoutTimestamps(readDataDir(dataDir).collections));

				const down = await migrate(args, 'down', String(fromLogins.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromLogins].reverse());
				expect(failuresOf(dataDir)).toBeUndefined();
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(others);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromLogins);
				assertSchema(readDataDir(dataDir).collections);
				expect(withDatabase(dataDir, (db) => db.prepare('SELECT COUNT(*) AS n FROM login_failures').get().n)).toBe(0);
			});
		}
	);
});

describe('migration rollback of the accounts and the administrator (ADR-0056)', () => {
	const collectionOf = (dataDir, name) =>
		readDataDir(dataDir).collections.find((collection) => collection.name === name);
	/** Every column of users, including the right and the switch (snapshot leaves them out). */
	const accountRows = (dataDir) =>
		withDatabase(dataDir, (db) => db.prepare('SELECT * FROM users ORDER BY id').all());
	const EARLIER = '2026-08-01 09:00:00.000Z';

	it(
		'gives the right to the account created first (smallest ID on a tie) without other changes, and back',
		async () => {
			const fromAccounts = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(ACCOUNTS_MIGRATION));
			expect(fromAccounts).toEqual([ACCOUNTS_MIGRATION, ...HOUSEHOLD_MIGRATIONS]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromAccounts.length));
				expect(collectionOf(dataDir, 'users').fields.some((field) => ACCOUNT_FIELDS.includes(field.name))).toBe(false);
				// The owner of before (ADR-0043 §3): the smallest `created`, then the smallest ID.
				withDatabase(dataDir, (db) => {
					const insert = db.prepare('INSERT INTO users (id, email, tokenKey, password, name, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)');
					insert.run('user00000000003', 'drei@example.invalid', 'tk3', 'hash', 'Drei', STAMP, STAMP);
					insert.run('user00000000002', 'zwei@example.invalid', 'tk2', 'hash', 'Zwei', EARLIER, STAMP);
					insert.run('user00000000001', 'eins@example.invalid', 'tk1', 'hash', 'Eins', EARLIER, STAMP);
				});
				const before = accountRows(dataDir);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromAccounts);
				assertSchema(readDataDir(dataDir).collections);
				for (const name of ACCOUNT_FIELDS) {
					expect(collectionOf(dataDir, 'users').fields.find((field) => field.name === name), name).toMatchObject({
						type: 'bool',
						required: false
					});
				}
				const migrated = accountRows(dataDir);
				expect(migrated.map((row) => [row.id, row.instance_admin, row.disabled])).toEqual([
					['user00000000001', 1, 0],
					['user00000000002', 0, 0],
					['user00000000003', 0, 0]
				]);
				// Set by SQL: no hook ran, `updated` and every other column stay.
				expect(withoutFields(migrated, ACCOUNT_FIELDS)).toEqual(before);
				// Managing a household (1790203800 to 1790203900) runs along.
				expect(withoutHouseholdCollections(withoutTimestamps(readDataDir(dataDir).collections)).map(withoutAccounts)).toEqual(
					schemaBefore
				);

				// A second administrator and a disabled account, then back: only the two columns go.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE users SET instance_admin = 1 WHERE id = ?').run('user00000000002');
					db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run('user00000000003');
				});
				const down = await migrate(args, 'down', String(fromAccounts.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromAccounts].reverse());
				expect(accountRows(dataDir)).toEqual(before);
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				for (const rule of ['listRule', 'viewRule']) {
					expect(collectionOf(dataDir, 'users')[rule]).toBe(USERS_RULE_BEFORE_ACCOUNTS);
					expect(collectionOf(dataDir, 'household_members')[rule]).toBe(MEMBERS_RULE_BEFORE_ACCOUNTS);
				}

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromAccounts);
				assertSchema(readDataDir(dataDir).collections);
				expect(accountRows(dataDir).map((row) => row.instance_admin)).toEqual([1, 0, 0]);
			});
		}
	);
});

describe('migration rollback of managing a household (ADR-0058)', () => {
	const collectionOf = (dataDir, name) =>
		readDataDir(dataDir).collections.find((collection) => collection.name === name);
	const rowsOf = (dataDir, table) =>
		withDatabase(dataDir, (db) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
	/** Every rule of the collections with an owner branch, by collection. */
	const ruleSet = (dataDir) =>
		Object.fromEntries(
			['projects', 'tags', 'recurrence_rules', 'tickets', 'inbox_items', 'connections', 'dependencies', 'comments', 'ticket_history', 'ticket_reads'].map(
				(name) => {
					const collection = collectionOf(dataDir, name);
					return [name, Object.fromEntries(RULE_NAMES.map((rule) => [rule, collection[rule]]))];
				}
			)
		);

	it(
		'adds the codes, the rights and the rule of joining, keeps the owner branch for private records only, and back, without touching a row',
		async () => {
			const fromHousehold = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(HOUSEHOLD_INVITES_MIGRATION));
			expect(fromHousehold).toEqual(HOUSEHOLD_MIGRATIONS);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromHousehold.length));
				expect(collectionOf(dataDir, HOUSEHOLD_INVITES_COLLECTION)).toBeUndefined();
				expect(collectionOf(dataDir, 'household_members').fields.some((field) => field.name === 'rights')).toBe(false);
				expect(readDataDir(dataDir).settings.rateLimits.rules).toEqual(
					security.rateLimitRules('normal').filter((rule) => rule.label !== security.JOIN_RULE.label)
				);
				const rulesBefore = ruleSet(dataDir);
				expect(rulesBefore.tickets.listRule).toContain('(owner = @request.auth.id || (household != ""');
				expect(rulesBefore.comments.listRule).toContain('(ticket.owner = @request.auth.id || (ticket.household != ""');
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				// A household with its owner and a member, a private and a household ticket.
				withDatabase(dataDir, (db) => {
					const user = db.prepare('INSERT INTO users (id, email, tokenKey, password, created, updated) VALUES (?, ?, ?, ?, ?, ?)');
					user.run('user00000000001', 'eins@example.invalid', 'tk1', 'hash', STAMP, STAMP);
					user.run('user00000000002', 'zwei@example.invalid', 'tk2', 'hash', STAMP, STAMP);
					db.prepare('INSERT INTO households (id, name, created, updated) VALUES (?, ?, ?, ?)').run('household000001', 'Haus', STAMP, STAMP);
					const member = db.prepare('INSERT INTO household_members (id, user, household, role, created, updated) VALUES (?, ?, ?, ?, ?, ?)');
					member.run('member000000001', 'user00000000001', 'household000001', 'owner', STAMP, STAMP);
					member.run('member000000002', 'user00000000002', 'household000001', 'member', STAMP, STAMP);
					const ticket = db.prepare(
						'INSERT INTO tickets (id, number, key, title, status, priority, scope, owner, household, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
					);
					ticket.run('ticket000000001', 1, 'TASK-1', 'Privat', 'open', 'medium', 'u:user00000000001', 'user00000000001', '', STAMP, STAMP);
					ticket.run('ticket000000002', 1, 'TASK-1', 'Haushalt', 'open', 'medium', 'h:household000001', 'user00000000002', 'household000001', STAMP, STAMP);
				});
				const members = rowsOf(dataDir, 'household_members');
				const rows = withDatabase(dataDir, snapshot);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromHousehold);
				assertSchema(readDataDir(dataDir).collections);
				expect(readDataDir(dataDir).settings.rateLimits.rules).toEqual(security.rateLimitRules('normal'));
				// Only rules change: every owner branch now with household = "", nothing else.
				for (const [name, rules] of Object.entries(ruleSet(dataDir))) {
					const { name: collectionName, ...plain } = withoutHousehold({ name, ...rules });
					expect(plain, collectionName).toEqual(rulesBefore[name]);
				}
				expect(ruleSet(dataDir).tickets.listRule).toContain('((owner = @request.auth.id && household = "") || (household != ""');
				expect(withoutHouseholdCollections(withoutTimestamps(readDataDir(dataDir).collections))).toEqual(schemaBefore);
				// No row changes; the members get the empty list of rights.
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);
				const migratedMembers = rowsOf(dataDir, 'household_members');
				expect(withoutFields(migratedMembers, ['rights'])).toEqual(members);
				expect(migratedMembers.map((row) => JSON.parse(row.rights || '[]'))).toEqual([[], []]);

				// Rights and a code, then back: the codes and the rights go, every other row stays.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE household_members SET rights = ? WHERE id = ?').run('["invite","rename"]', 'member000000002');
					db.prepare(
						'INSERT INTO household_invites (id, household, code_hash, created_by, expires_at, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'
					).run('invite000000001', 'household000001', 'a'.repeat(64), 'user00000000001', '2026-09-08 10:00:00.000Z', STAMP, STAMP);
				});
				const down = await migrate(args, 'down', String(fromHousehold.length));
				expect(appliedFiles(down, 'Reverted')).toEqual([...fromHousehold].reverse());
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				expect(ruleSet(dataDir)).toEqual(rulesBefore);
				expect(rowsOf(dataDir, 'household_members')).toEqual(members);
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromHousehold);
				assertSchema(readDataDir(dataDir).collections);
			});
		}
	);
});

describe('migration rollback of the retention of a household (ADR-0059 §6)', () => {
	const fieldsOf = (dataDir) =>
		readDataDir(dataDir)
			.collections.find((collection) => collection.name === 'households')
			.fields.map((field) => field.name);
	const households = (dataDir) =>
		withDatabase(dataDir, (db) => db.prepare('SELECT * FROM households ORDER BY id').all());

	it(
		'adds the retention of every household empty (30 days), and back, without touching another row',
		async () => {
			const fromRetention = MIGRATION_FILES.slice(MIGRATION_FILES.indexOf(AREA_RETENTION_MIGRATION));
			expect(fromRetention).toEqual([AREA_RETENTION_MIGRATION]);

			await withTempDataDir(async ({ dataDir, args }) => {
				await migrate(args, 'up');
				await migrate(args, 'down', String(fromRetention.length));
				expect(fieldsOf(dataDir)).not.toContain('trash_retention');
				withDatabase(dataDir, (db) => {
					const insert = db.prepare('INSERT INTO households (id, name, created, updated) VALUES (?, ?, ?, ?)');
					insert.run('household000001', 'Haus', STAMP, STAMP);
					insert.run('household000002', 'Garten', STAMP, STAMP);
				});
				const before = households(dataDir);
				const rows = withDatabase(dataDir, snapshot);
				const schemaBefore = withoutTimestamps(readDataDir(dataDir).collections);

				const up = await migrate(args, 'up');
				expect(appliedFiles(up, 'Applied')).toEqual(fromRetention);
				assertSchema(readDataDir(dataDir).collections);
				const migrated = households(dataDir);
				expect(withoutFields(migrated, ['trash_retention'])).toEqual(before);
				expect(migrated.map((row) => row.trash_retention)).toEqual(['', '']);
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);

				// A household with its own retention, then back: only the field goes.
				withDatabase(dataDir, (db) => {
					db.prepare('UPDATE households SET trash_retention = ? WHERE id = ?').run('7', 'household000002');
				});
				const down = await migrate(args, 'down', String(fromRetention.length));
				expect(appliedFiles(down, 'Reverted')).toEqual(fromRetention);
				expect(households(dataDir)).toEqual(before);
				expect(withoutTimestamps(readDataDir(dataDir).collections)).toEqual(schemaBefore);
				expect(withDatabase(dataDir, snapshot)).toEqual(rows);

				expect(appliedFiles(await migrate(args, 'up'), 'Applied')).toEqual(fromRetention);
				assertSchema(readDataDir(dataDir).collections);
				expect(households(dataDir).map((row) => row.trash_retention)).toEqual(['', '']);
			});
		}
	);
});
