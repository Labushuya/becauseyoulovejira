// Time limits of the tests that start processes of their own (plan robuste-skripte RS-3), in one
// place. Every limit is a bound for polling a target state, never a fixed wait.
//
// Measured on the development machine (16 logical processors, 2026-10-01): one disposable
// PocketBase of the harness (superuser upsert with all migrations, then serve until /api/health)
// takes about 0.9 s alone and 1.5 to 2.3 s with eleven others at the same time. With 16 busy
// threads of another process (another build or test run of an agent) it took 9 to 45 s with four
// at the same time and 25 to 167 s with twelve; disk load alone changed nothing. The former limits
// (20 s for /api/health, 30 s for a hook) were exceeded exactly then, while the CI runner, without
// a second run beside it, stayed green.
//
// So: the limits below leave room for a machine with one more full load beside the tests, the
// files with processes run with at most PROCESS_WORKERS at a time (vitest.config.mjs), and a busier
// machine scales every limit with the variable BECAUSEYOULOVEJIRA_TEST_TIME_SCALE (a number from
// 1 to 10, default 1), e.g. $env:BECAUSEYOULOVEJIRA_TEST_TIME_SCALE = 3 before npm test. The name is
// no BYL_* name: those are the access data of the account (ADR-0018), and no child process of a test
// sees this variable anyway (tests/support/clean-env.mjs takes nothing over that it is not given).

import { availableParallelism } from 'node:os';

export const TIME_SCALE_VARIABLE = 'BECAUSEYOULOVEJIRA_TEST_TIME_SCALE';

/** The factor of `text` (1 to 10); 1 for anything else. */
export function parseTimeScale(text) {
	const value = Number(text);
	return Number.isFinite(value) && value >= 1 && value <= 10 ? value : 1;
}

export const TIME_SCALE = parseTimeScale(process.env[TIME_SCALE_VARIABLE]);

/** `ms` times the factor of the machine. */
export const scaled = (ms) => Math.round(ms * TIME_SCALE);

/** One disposable PocketBase until /api/health answers (harness; was 20 s). */
export const SERVER_READY_MS = scaled(90_000);

/** Default of one test in a file with processes (was the 15 s of the shared instance). */
export const PROCESS_TEST_MS = scaled(60_000);

/** Default of beforeAll and afterAll in a file with processes: one or more servers (was 30 s). */
export const PROCESS_HOOK_MS = scaled(180_000);

/** PocketBase writes its log in batches; one write after an action (3 s plus a cron run beside it). */
export const LOG_WRITE_MS = scaled(30_000);

/**
 * Files with processes at the same time: one fewer than the processors, at most four. Twelve at a
 * time made each PocketBase start several times slower under load (see above); four kept the run
 * about as fast as before on this machine, and the CI runner (four processors) keeps its three.
 */
export function processWorkers(processors = availableParallelism()) {
	return Math.max(1, Math.min(4, processors - 1));
}
