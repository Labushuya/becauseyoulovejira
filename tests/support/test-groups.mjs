// Groups of the integration tests (plan test-haertung T-4): the files that only talk to the shared
// disposable instance of the run (global-setup.mjs) run first and alone; every file that starts
// processes of its own runs afterwards, together with the unit and helper tests. On the Windows
// runner single requests to the shared instance stalled for 5 to 15 s while other files started
// PowerShell, copied pocketbase.exe or byl-mail.exe and ran migrations in parallel (one of them
// ran into the time limit of 15 s); separated in time, nothing of that runs next to them.
//
// A file starts processes when it imports the harness (own PocketBase servers, `migrate`), the
// PowerShell helper or the clean environment of child processes; no other test code may start a
// process (tests/unit/clean-env.test.mjs).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PROCESS_MODULES = ['pocketbase-harness.mjs', 'powershell.mjs', 'clean-env.mjs'];
const TEST_FILE = /\.test\.(?:js|mjs|ts)$/;

/** Whether the source of a test file imports a module that starts processes. */
export function startsProcesses(source) {
	const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
	return imports.some((path) => PROCESS_MODULES.some((name) => path.endsWith(`/support/${name}`)));
}

/**
 * The test files of `dir` (relative to `root`, with forward slashes) split into those on the shared
 * instance only and those that start processes of their own.
 * @param {string} root
 * @param {string} dir e.g. 'tests/integration'
 * @returns {{ shared: string[], processes: string[] }}
 */
export function integrationGroups(root, dir) {
	const groups = { shared: [], processes: [] };
	for (const name of readdirSync(join(root, dir)).filter((file) => TEST_FILE.test(file)).sort()) {
		const source = readFileSync(join(root, dir, name), 'utf8');
		groups[startsProcesses(source) ? 'processes' : 'shared'].push(`${dir}/${name}`);
	}
	return groups;
}
