import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import { integrationGroups } from './tests/support/test-groups.mjs';
import { PROCESS_HOOK_MS, PROCESS_TEST_MS, processWorkers } from './tests/support/timing.mjs';

// Tests of the Windows operation layer run only on Windows (ADR-0028, plan plattformen S0): they
// call Windows PowerShell 5.1 with app/byl-functions.ps1 or the Expand-Archive restore of the
// README. Single Windows cases in other files use it.skipIf / describe.skipIf instead.
const WINDOWS_ONLY = {
	unit: [
		'tests/unit/admin-reset-logic.test.mjs',
		'tests/unit/backup-control-logic.test.mjs',
		'tests/unit/control-logic.test.mjs',
		'tests/unit/start-browser.test.mjs',
		'tests/unit/start-logic.test.mjs',
		'tests/unit/system-control-logic.test.mjs'
	],
	integration: [
		'tests/integration/admin-reset.test.mjs',
		'tests/integration/backup-control.test.mjs',
		'tests/integration/backup-restore-control.test.mjs',
		'tests/integration/backup-restore.test.mjs',
		'tests/integration/control-script.test.mjs',
		'tests/integration/installer-check.test.mjs',
		'tests/integration/storage-control.test.mjs',
		'tests/integration/system-control.test.mjs'
	]
};

/** Default excludes plus the Windows-only files of `project` on other systems. */
function exclude(project) {
	return process.platform === 'win32'
		? configDefaults.exclude
		: [...configDefaults.exclude, ...WINDOWS_ONLY[project]];
}

// Integration tests in groups (plan test-haertung T-4, tests/support/test-groups.mjs): first,
// alone, the files that only use the shared disposable instance of the run; then the unit and
// helper tests; last the files that start processes of their own (PocketBase servers, migrate,
// PowerShell, byl-mail.exe), at most processWorkers() at a time. Under load on the Windows runner
// single requests of the first kind stalled for seconds while files of the last kind ran next to
// them (T-4); and with another build beside the run, starting many servers at once made every start
// several times slower until hooks ran out of time (plan robuste-skripte RS-3).
const GROUPS = integrationGroups(fileURLToPath(new URL('.', import.meta.url)), 'tests/integration');

// Common to both integration projects. Each gets the shared instance of global-setup.mjs (files of
// the last group use it next to their own servers). Node 24 ships EventSource only behind the
// flag; the PocketBase SDK needs it for realtime subscriptions (OF-13: no polyfill dependency). The
// experimental warning is muted. 15 s per test of the shared instance: alone in their group, the
// slowest of them (web-filter-parity) took at most 6 s in 28 local runs (plan test-haertung T-4).
const INTEGRATION = {
	environment: 'node',
	globalSetup: ['tests/support/global-setup.mjs'],
	execArgv: ['--experimental-eventsource', '--disable-warning=UNDICI-ES'],
	testTimeout: 15_000,
	hookTimeout: 30_000
};

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					...INTEGRATION,
					name: 'integration',
					include: GROUPS.shared,
					exclude: exclude('integration'),
					sequence: { groupOrder: 0 }
				}
			},
			{
				test: {
					name: 'unit',
					include: ['tests/unit/**/*.test.{js,mjs,ts}'],
					exclude: exclude('unit'),
					environment: 'node',
					sequence: { groupOrder: 1 }
				}
			},
			{
				test: {
					// The mail helper byl-mail.exe (E4 plan, package 11), against a fake IMAP server on
					// 127.0.0.1, and the backup helper byl-backup.exe (ADR-0046).
					name: 'helper',
					include: ['helpers/mail/src/**/*.test.ts', 'helpers/backup/src/**/*.test.ts'],
					environment: 'node',
					testTimeout: 20_000,
					sequence: { groupOrder: 1 }
				}
			},
			{
				test: {
					...INTEGRATION,
					name: 'integration-processes',
					include: GROUPS.processes,
					exclude: exclude('integration'),
					// Limits from tests/support/timing.mjs (measured, scalable for a busy machine);
					// files set longer ones per test with scaled() where they need them.
					testTimeout: PROCESS_TEST_MS,
					hookTimeout: PROCESS_HOOK_MS,
					maxWorkers: processWorkers(),
					sequence: { groupOrder: 2 }
				}
			}
		]
	}
});
