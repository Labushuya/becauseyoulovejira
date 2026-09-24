// Every migration has a working rollback: `migrate up` -> `migrate down <all>` -> `migrate up`
// in an own disposable data folder, without `serve` (E1 plan, package 3; ADR-0004).

import { readdirSync } from 'node:fs';
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
});
