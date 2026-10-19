// Smoke test of the phone frame in a real browser (MO-1a, ADR-0073; manifest BYL-E6-1907 ff.): whole
// pages of the web build against a disposable instance of the harness (tests/mobile/global-setup.mjs),
// at the width of a phone (390 × 844) and of a PC (1280 × 800). What jsdom cannot see: no
// horizontal scrolling, the size and the place of the targets, the sheet at the bottom.
//
// - The browser is the installed Google Chrome (channel "chrome"), on the PC and on the Linux runner
//   of the CI; BECAUSEYOULOVEJIRA_BROWSER_CHANNEL=msedge takes Microsoft Edge. Playwright downloads no
//   browser.
// - Run with `npm run test:mobile` after `npm run build` (app/pb_public); not part of `npm test` and
//   not of scripts\build.ps1, to spare the memory of the PC. In the CI it is a step of the job
//   "Linux build and test" only.
// - One worker, one test at a time: one instance, a few pages, no retries (a failure is a finding).
// - Limits only from tests/support/timing.mjs; no report files, nothing to commit (test-results/
//   is ignored).
// - The browser gets the environment without access data, like every child of the tests
//   (tests/support/clean-env.mjs).

import { defineConfig } from '@playwright/test';
import { cleanEnv } from './tests/support/clean-env.mjs';
import { BROWSER_STEP_MS, BROWSER_TEST_MS } from './tests/support/timing.mjs';
import { MOBILE_ENV } from './tests/mobile/instance.mjs';

/** The environment of the browser: no access data, and not the invented account of the run. */
function browserEnv() {
	const env = cleanEnv();
	for (const name of Object.values(MOBILE_ENV)) delete env[name];
	return env;
}

export default defineConfig({
	testDir: 'tests/mobile',
	testMatch: '*.spec.mjs',
	globalSetup: './tests/mobile/global-setup.mjs',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	forbidOnly: true,
	reporter: [['list']],
	outputDir: 'test-results/mobile',
	timeout: BROWSER_TEST_MS,
	expect: { timeout: BROWSER_STEP_MS },
	use: {
		channel: process.env.BECAUSEYOULOVEJIRA_BROWSER_CHANNEL ?? 'chrome',
		headless: true,
		locale: 'de-DE',
		timezoneId: 'Europe/Berlin',
		actionTimeout: BROWSER_STEP_MS,
		navigationTimeout: BROWSER_STEP_MS,
		screenshot: 'off',
		trace: 'off',
		video: 'off',
		launchOptions: { env: browserEnv() }
	}
});
