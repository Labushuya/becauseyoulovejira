// Disposable PocketBase instance for integration tests (ADR-0004, CLAUDE.md §11).
//
// Hard order: fresh temp folder -> `superuser upsert` (random credentials) -> `serve`.
// A data folder with a superuser never opens the browser installer. Credentials are
// only returned in memory; they are never written to disk or printed.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { constants, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const POCKETBASE_EXE = join(ROOT_DIR, 'app', 'pocketbase.exe');
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
 * @returns {Promise<{ url: string, email: string, password: string, stop: () => Promise<void> }>}
 */
export async function startPocketBase() {
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
		await cp(APP_HOOKS_DIR, hooksDir, { recursive: true });
		if (existsSync(FIXTURE_HOOKS_DIR)) {
			await cp(FIXTURE_HOOKS_DIR, hooksDir, { recursive: true });
		}

		const commonArgs = [
			`--dir=${dataDir}`,
			`--hooksDir=${hooksDir}`,
			`--migrationsDir=${APP_MIGRATIONS_DIR}`,
			`--publicDir=${publicDir}`,
			'--automigrate=false'
		];
		const { email, password } = createCredentials();
		const secrets = [email, password];

		const upsert = await runToCompletion(['superuser', 'upsert', email, password, ...commonArgs]);
		if (upsert.code !== 0) {
			throw new Error(
				`pocketbase superuser upsert failed (exit code ${upsert.code}); serve was not started.\n` +
					redact(upsert.output, secrets)
			);
		}

		const port = await findFreePort();
		const url = `http://127.0.0.1:${port}`;
		const server = startServer(['serve', `--http=127.0.0.1:${port}`, ...commonArgs]);
		state.child = server.child;
		await waitForHealth(url, server, secrets);

		return {
			url,
			email,
			password,
			stop: () => stop(state, guard)
		};
	} catch (error) {
		try {
			await stop(state, guard);
		} catch (teardownError) {
			throw new AggregateError([error, teardownError], 'PocketBase harness start failed');
		}
		throw error;
	}
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
		throw new Error('app/pocketbase.exe is missing. Run .\\scripts\\fetch-pocketbase.ps1 first.');
	}
}

function createCredentials() {
	return {
		email: `test-${randomBytes(12).toString('hex')}@example.com`,
		password: randomBytes(32).toString('base64url')
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

function startServer(args) {
	const child = spawn(POCKETBASE_EXE, args, {
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe']
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

function taskkill(pid) {
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
		taskkill(child.pid);
		const done = await Promise.race([exited, delay(KILL_WAIT_MS, false)]);
		if (done) return;
	}
	throw new Error(`PocketBase process ${child.pid} did not exit after taskkill.`);
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
			taskkill(pid);
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
