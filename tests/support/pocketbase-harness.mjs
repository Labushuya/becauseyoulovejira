// Disposable PocketBase instance for integration tests (ADR-0004, CLAUDE.md §11).
//
// Hard order: fresh temp folder -> `superuser upsert` (random credentials) -> `serve`.
// A data folder with a superuser never opens the browser installer. Credentials are
// only returned in memory; they are never written to disk or printed.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { constants, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { executableName } from '../../scripts/platform.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
// app/pocketbase.exe on Windows, app/pocketbase on Linux (ADR-0028, plan plattformen S0).
export const POCKETBASE_EXE = join(ROOT_DIR, 'app', executableName('pocketbase'));
const APP_HOOKS_DIR = join(ROOT_DIR, 'app', 'pb_hooks');
export const APP_MIGRATIONS_DIR = join(ROOT_DIR, 'app', 'pb_migrations');
// Test-only hooks (OF-15), copied on top of app/pb_hooks when the folder exists.
const FIXTURE_HOOKS_DIR = join(ROOT_DIR, 'tests', 'fixtures', 'pb_hooks');
const TASKKILL_EXE = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');

const TEMP_PREFIX = 'byl-test-';
const RESERVED_PORTS = new Set([8090, 8099]);
const HEALTH_TIMEOUT_MS = 20_000;
const HEALTH_REQUEST_TIMEOUT_MS = 1_000;
const KILL_ATTEMPTS = 3;
const KILL_WAIT_MS = 3_000;
const OUTPUT_LIMIT = 64 * 1024;
const INSTALLER_MARKER = 'pbinstal';
const EXIT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'];

/**
 * Starts a disposable PocketBase instance.
 * @param {{ publicFiles?: string, prepareDataDir?: (dataDir: string) => Promise<void>,
 *   migrationFilter?: (fileName: string) => boolean, env?: Record<string, string> }} [options]
 *   `publicFiles`: folder copied into the public folder of the instance (e.g. the web build);
 *   without it the public folder stays empty. `prepareDataDir`: fills the still empty data folder
 *   before `superuser upsert` and `serve` (e.g. with an unpacked backup). `migrationFilter`:
 *   runs only the app migrations it accepts (e.g. the state before a new migration, while the
 *   hooks are already the new ones). `env`: variables for the server process, e.g. invented
 *   access data of a channel (ADR-0018: tests set them only for the disposable instance). The
 *   instance never inherits BYL_* variables of the developer, so a channel in a test can reach
 *   no real service.
 * @returns {Promise<{ url: string, email: string, password: string, dataDir: string,
 *   output: () => string, stop: () => Promise<void>,
 *   restart: (options?: { migrationFilter?: (fileName: string) => boolean }) => Promise<void> }>}
 *   `dataDir` is removed by `stop()`; `output()` is the recent console output of the server;
 *   `restart()` serves the same data folder again (new `url`).
 */
export async function startPocketBase(options = {}) {
	assertExecutable();

	const state = {
		baseDir: await mkdtemp(join(tmpdir(), TEMP_PREFIX)),
		child: null,
		done: false
	};
	const guard = installExitGuard(state);

	try {
		const dataDir = join(state.baseDir, 'pb_data');
		const hooksDir = join(state.baseDir, 'pb_hooks');
		const publicDir = join(state.baseDir, 'pb_public');
		await mkdir(dataDir);
		await mkdir(publicDir);
		if (options.publicFiles !== undefined) {
			await cp(options.publicFiles, publicDir, { recursive: true });
		}
		if (options.prepareDataDir !== undefined) {
			await options.prepareDataDir(dataDir);
		}
		await cp(APP_HOOKS_DIR, hooksDir, { recursive: true });
		if (existsSync(FIXTURE_HOOKS_DIR)) {
			await cp(FIXTURE_HOOKS_DIR, hooksDir, { recursive: true });
		}
		const migrationsDir = await migrationsFor(state.baseDir, 'pb_migrations', options.migrationFilter);
		const argsWith = (migrations) => [
			`--dir=${dataDir}`,
			`--hooksDir=${hooksDir}`,
			`--migrationsDir=${migrations}`,
			`--publicDir=${publicDir}`,
			'--automigrate=false'
		];
		const commonArgs = argsWith(migrationsDir);
		const { email, password } = createCredentials();
		const secrets = [email, password];

		const upsert = await runToCompletion(['superuser', 'upsert', email, password, ...commonArgs]);
		if (upsert.code !== 0) {
			throw new Error(
				`pocketbase superuser upsert failed (exit code ${upsert.code}); serve was not started.\n` +
					redact(upsert.output, secrets)
			);
		}

		const serve = async (args) => {
			const port = await findFreePort();
			const url = `http://127.0.0.1:${port}`;
			const server = startServer(['serve', `--http=127.0.0.1:${port}`, ...args], options.env);
			state.child = server.child;
			await waitForHealth(url, server, secrets);
			return { url, server };
		};
		let current = await serve(commonArgs);
		let restarts = 0;

		const instance = {
			url: current.url,
			email,
			password,
			dataDir,
			output: () => current.server.output,
			stop: () => stop(state, guard),
			/**
			 * Stops the server and serves the same data folder again on a new port (`url` changes),
			 * e.g. to run the start hooks once more or, with all migrations, to start like the
			 * instance of the user after an update. `migrationFilter` as for the start; without it
			 * every app migration.
			 * @param {{ migrationFilter?: (fileName: string) => boolean }} [restartOptions]
			 */
			restart: async (restartOptions = {}) => {
				await killProcessTree(state.child);
				restarts += 1;
				const migrations = await migrationsFor(
					state.baseDir,
					`pb_migrations_${restarts}`,
					restartOptions.migrationFilter
				);
				current = await serve(argsWith(migrations));
				instance.url = current.url;
			}
		};
		return instance;
	} catch (error) {
		try {
			await stop(state, guard);
		} catch (teardownError) {
			throw new AggregateError([error, teardownError], 'PocketBase harness start failed');
		}
		throw error;
	}
}

/** app/pb_migrations, or a copy under `baseDir/name` with only the files `filter` accepts. */
async function migrationsFor(baseDir, name, filter) {
	if (filter === undefined) return APP_MIGRATIONS_DIR;
	const dir = join(baseDir, name);
	await mkdir(dir);
	for (const file of await readdir(APP_MIGRATIONS_DIR)) {
		if (file.endsWith('.js') && filter(file)) {
			await cp(join(APP_MIGRATIONS_DIR, file), join(dir, file));
		}
	}
	return dir;
}

/**
 * Runs `fn` with a fresh, empty data folder for one-shot commands such as `migrate`
 * (never `serve`). The folder uses the byl-test- prefix and is removed afterwards, also on
 * Ctrl+C or process exit.
 * @template T
 * @param {(dirs: { dataDir: string, hooksDir: string, args: string[] }) => Promise<T>} fn
 *   `args` holds --dir, --hooksDir (empty folder) and --migrationsDir (app/pb_migrations).
 * @returns {Promise<T>}
 */
export async function withTempDataDir(fn) {
	assertExecutable();
	const state = {
		baseDir: await mkdtemp(join(tmpdir(), TEMP_PREFIX)),
		child: null,
		done: false
	};
	const guard = installExitGuard(state);
	let result;
	try {
		const dataDir = join(state.baseDir, 'pb_data');
		const hooksDir = join(state.baseDir, 'pb_hooks');
		await mkdir(dataDir);
		await mkdir(hooksDir);
		const args = [
			`--dir=${dataDir}`,
			`--hooksDir=${hooksDir}`,
			`--migrationsDir=${APP_MIGRATIONS_DIR}`,
			'--automigrate=false'
		];
		result = await fn({ dataDir, hooksDir, args });
	} finally {
		await stop(state, guard);
	}
	return result;
}

/**
 * Runs a one-shot pocketbase.exe command and collects its output.
 * @param {string[]} args
 * @param {{ input?: string }} [options] text written to stdin (e.g. "y\n" for `migrate down`)
 * @returns {Promise<{ code: number | null, output: string }>}
 */
export function runPocketBase(args, options = {}) {
	if (args.includes('serve')) {
		throw new Error('runPocketBase must not start serve; use startPocketBase().');
	}
	if (!args.some((arg) => arg.startsWith('--dir='))) {
		throw new Error('runPocketBase needs an explicit --dir so app/pb_data is never touched.');
	}
	return runToCompletion(args, options.input);
}

function assertExecutable() {
	if (!existsSync(POCKETBASE_EXE)) {
		throw new Error(`${POCKETBASE_EXE} is missing. Run "node scripts/fetch-pocketbase.mjs" first.`);
	}
}

/**
 * Random superuser credentials for `superuser upsert`. The password goes to the command line as
 * a positional argument, so it must not start with "-": base64url can (1 in 64), and the CLI then
 * reads it as a flag ("unknown shorthand flag"). The fixed first letter rules that out.
 */
export function createCredentials() {
	return {
		email: `test-${randomBytes(12).toString('hex')}@example.com`,
		password: `P${randomBytes(32).toString('base64url')}`
	};
}

function redact(text, secrets) {
	return secrets.reduce((result, secret) => result.split(secret).join('***'), text);
}

function appendOutput(buffer, chunk) {
	const next = buffer + chunk.toString();
	return next.length > OUTPUT_LIMIT ? next.slice(-OUTPUT_LIMIT) : next;
}

function runToCompletion(args, input) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(POCKETBASE_EXE, args, {
			windowsHide: true,
			stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
		});
		if (input !== undefined) child.stdin.end(input);
		let output = '';
		child.stdout.on('data', (chunk) => (output = appendOutput(output, chunk)));
		child.stderr.on('data', (chunk) => (output = appendOutput(output, chunk)));
		child.once('error', reject);
		child.once('close', (code) => resolvePromise({ code, output }));
	});
}

/**
 * Environment of the server: the own one without BYL_* variables, plus `extra`. The Telegram Bot
 * API points to a closed local port unless a test sets its fake server, so no test instance can
 * ever reach api.telegram.org (E4 plan, package 17).
 */
export function serverEnvironment(extra = {}) {
	const env = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (!/^BYL_/i.test(name)) env[name] = value;
	}
	return { ...env, BYL_TELEGRAM_API_BASE: 'http://127.0.0.1:9', ...extra };
}

function startServer(args, extraEnv) {
	const child = spawn(POCKETBASE_EXE, args, {
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: serverEnvironment(extraEnv)
	});
	const server = { child, output: '', spawnError: null };
	child.stdout.on('data', (chunk) => (server.output = appendOutput(server.output, chunk)));
	child.stderr.on('data', (chunk) => (server.output = appendOutput(server.output, chunk)));
	child.once('error', (error) => (server.spawnError = error));
	return server;
}

async function findFreePort() {
	for (;;) {
		const port = await new Promise((resolvePromise, reject) => {
			const probe = createServer();
			probe.unref();
			probe.once('error', reject);
			probe.listen(0, '127.0.0.1', () => {
				const { port: assigned } = probe.address();
				probe.close(() => resolvePromise(assigned));
			});
		});
		if (!RESERVED_PORTS.has(port)) return port;
	}
}

async function waitForHealth(url, server, secrets) {
	const deadline = Date.now() + HEALTH_TIMEOUT_MS;
	for (;;) {
		assertServerUsable(server, secrets);
		try {
			const response = await fetch(`${url}/api/health`, {
				signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS)
			});
			if (response.status === 200) {
				assertServerUsable(server, secrets);
				return;
			}
		} catch {
			// Not listening yet; retry until the deadline.
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`PocketBase did not report healthy within ${HEALTH_TIMEOUT_MS} ms.\n` +
					redact(server.output, secrets)
			);
		}
		await delay(100);
	}
}

function assertServerUsable(server, secrets) {
	if (server.output.includes(INSTALLER_MARKER)) {
		throw new Error('PocketBase printed an installer link (no superuser?). Aborting.');
	}
	if (server.spawnError) {
		throw new Error(`Failed to start PocketBase: ${server.spawnError.message}`);
	}
	if (hasExited(server.child)) {
		throw new Error(
			`PocketBase exited early (code ${server.child.exitCode}).\n` +
				redact(server.output, secrets)
		);
	}
}

function hasExited(child) {
	return child.exitCode !== null || child.signalCode !== null;
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Ends the process hard: on Windows with its tree via taskkill, elsewhere with SIGKILL (PocketBase
 * starts no child processes there).
 */
function forceKill(pid) {
	if (process.platform !== 'win32') {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			// Already gone; the callers check whether the process still lives.
		}
		return;
	}
	spawnSync(TASKKILL_EXE, ['/PID', String(pid), '/T', '/F'], {
		windowsHide: true,
		stdio: 'ignore'
	});
}

async function killProcessTree(child) {
	if (child.pid === undefined || hasExited(child)) return;
	const exited = new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true)));
	for (let attempt = 1; attempt <= KILL_ATTEMPTS; attempt += 1) {
		if (hasExited(child)) return;
		forceKill(child.pid);
		const done = await Promise.race([exited, delay(KILL_WAIT_MS, false)]);
		if (done) return;
	}
	throw new Error(`PocketBase process ${child.pid} did not exit after ${KILL_ATTEMPTS} kill attempts.`);
}

async function stop(state, guard) {
	if (state.done) return;
	const errors = [];
	if (state.child) {
		try {
			await killProcessTree(state.child);
		} catch (error) {
			errors.push(error);
		}
	}
	try {
		// maxRetries covers delayed release of SQLite file locks on Windows.
		await rm(state.baseDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
		if (existsSync(state.baseDir)) throw new Error(`Could not remove ${state.baseDir}.`);
	} catch (error) {
		errors.push(error);
	}
	state.done = true;
	guard.dispose();
	if (errors.length > 0) {
		throw new AggregateError(errors, 'PocketBase harness teardown failed');
	}
}

// Synchronous fallback for paths where the async teardown never runs: Ctrl+C
// (Vitest calls process.exit() on SIGINT), SIGTERM, uncaught exceptions and any
// other process exit. Only synchronous work is possible inside 'exit'.
function stopSync(state) {
	if (state.done) return;
	state.done = true;
	const pid = state.child?.pid;
	if (pid !== undefined) {
		for (let attempt = 1; attempt <= KILL_ATTEMPTS && isAlive(pid); attempt += 1) {
			forceKill(pid);
			const deadline = Date.now() + KILL_WAIT_MS;
			while (isAlive(pid) && Date.now() < deadline) sleepSync(50);
		}
	}
	try {
		rmSync(state.baseDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
	} catch (error) {
		process.stderr.write(`PocketBase harness: could not remove temp folder: ${error.message}\n`);
	}
}

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function installExitGuard(state) {
	const onExit = () => stopSync(state);
	const onSignal = (signal) => {
		stopSync(state);
		// Keep the default "terminate on signal" behaviour if nobody else handles it.
		if (process.listenerCount(signal) === 0) {
			process.exit(128 + (constants.signals[signal] ?? 0));
		}
	};
	process.on('exit', onExit);
	for (const signal of EXIT_SIGNALS) process.once(signal, onSignal);
	return {
		dispose() {
			process.off('exit', onExit);
			for (const signal of EXIT_SIGNALS) process.off(signal, onSignal);
		}
	};
}
