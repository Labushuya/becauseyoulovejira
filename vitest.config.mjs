import { configDefaults, defineConfig } from 'vitest/config';

// Tests of the Windows operation layer run only on Windows (ADR-0028, plan plattformen S0): they
// call Windows PowerShell 5.1 with app/byl-functions.ps1 or the Expand-Archive restore of the
// README. Single Windows cases in other files use it.skipIf / describe.skipIf instead.
const WINDOWS_ONLY = {
	unit: [
		'tests/unit/admin-reset-logic.test.mjs',
		'tests/unit/control-logic.test.mjs',
		'tests/unit/start-browser.test.mjs',
		'tests/unit/start-logic.test.mjs',
		'tests/unit/system-control-logic.test.mjs'
	],
	integration: [
		'tests/integration/admin-reset.test.mjs',
		'tests/integration/backup-restore.test.mjs',
		'tests/integration/control-script.test.mjs',
		'tests/integration/installer-check.test.mjs',
		'tests/integration/system-control.test.mjs'
	]
};

/** Default excludes plus the Windows-only files of `project` on other systems. */
function exclude(project) {
	return process.platform === 'win32'
		? configDefaults.exclude
		: [...configDefaults.exclude, ...WINDOWS_ONLY[project]];
}

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'unit',
					include: ['tests/unit/**/*.test.{js,mjs,ts}'],
					exclude: exclude('unit'),
					environment: 'node'
				}
			},
			{
				test: {
					// The mail helper byl-mail.exe (E4 plan, package 11), against a fake IMAP server on 127.0.0.1.
					name: 'helper',
					include: ['helpers/mail/src/**/*.test.ts'],
					environment: 'node',
					testTimeout: 20_000
				}
			},
			{
				test: {
					name: 'integration',
					include: ['tests/integration/**/*.test.{js,mjs,ts}'],
					exclude: exclude('integration'),
					environment: 'node',
					globalSetup: ['tests/support/global-setup.mjs'],
					// Node 24 ships EventSource only behind this flag; the PocketBase SDK needs it for
					// realtime subscriptions (OF-13: no polyfill dependency). The experimental warning is muted.
					execArgv: ['--experimental-eventsource', '--disable-warning=UNDICI-ES'],
					testTimeout: 15_000,
					hookTimeout: 30_000
				}
			}
		]
	}
});
