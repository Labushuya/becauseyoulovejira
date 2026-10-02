// byl-control.ps1 against disposable copies of the app folder (ADR-0039, plan betriebsskripte
// BS-1 and BS-2). The script runs ONLY in two copies under .tmp\byl-ctl-* of the repo (one with a
// space in the path), each with a superuser created beforehand (CLAUDE.md §11.2), a random port
// (never 8090 or 8099) and -NoBrowser; app\ and the instance of the user are never touched. Every
// server this file starts is ended in afterAll, and the copies are removed. The script runs with a
// clean environment (tests/support/clean-env.mjs) plus BYL_TEST_ISOLATED=1: it then takes the BYL_*
// variables from its own process instead of the Windows account and writes nothing into the
// account (ADR-0039, addendum of 2026-09-29), so a copy sees only the invented values of this file,
// never access data of the user; their databases have no connection either.
//
// Proves: a start that starts once (second start: same process), the state file and the address
// for the landing page, the clean environment of the server, the orderly stop (console break: exit
// without a hard stop, the SQLite WAL is checkpointed), a port used by another copy (reported with
// program path and a free port, nothing stopped), a copy with byl-mail.exe that starts no helper,
// restart, a stale state file, and the safety rule: stop in one folder never ends the server of
// another folder. BS-2: status with its exit codes, reload only when needed (a new web build only
// asks for F5, changed hooks restart), open, logs and doctor.

import { randomBytes } from 'node:crypto';
import {
	closeSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialNames, spawnSyncClean, visibleNames } from '../support/clean-env.mjs';
import { POCKETBASE_EXE } from '../support/pocketbase-harness.mjs';
import { POWERSHELL_EXE, runPowerShellJson } from '../support/powershell.mjs';
import { scaled } from '../support/timing.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(ROOT_DIR, 'app');
const TEMP_ROOT = join(ROOT_DIR, '.tmp');
const PROBE_HOOK = join(ROOT_DIR, 'tests', 'fixtures', 'pb_hooks', 'environment-probe.pb.js');
const RESERVED_PORTS = new Set([8090, 8099]);
const COMMAND_TIMEOUT_MS = scaled(60_000);

// The only variables of every call: the switch for disposable copies and an invented marker. The
// same for all calls, so the start fingerprint of the variables stays the same between them.
const CONTROL_ENV = { BYL_TEST_ISOLATED: '1', BYL_TEST_MARKER: randomBytes(8).toString('hex') };
// Set in this test process only; the clean environment must keep it from every child.
const CANARY = `BYL_TEST_CANARY_${randomBytes(4).toString('hex').toUpperCase()}`;

let base;
/** @type {{ a: Copy, b: Copy }} */
const copies = {};

/** @typedef {{ dir: string, port: number, email: string, password: string }} Copy */

async function freePort() {
	for (;;) {
		const probe = createServer();
		await new Promise((done) => probe.listen(0, '127.0.0.1', done));
		const { port } = probe.address();
		await new Promise((done) => probe.close(done));
		if (!RESERVED_PORTS.has(port)) return port;
	}
}

/**
 * A copy of the runtime parts of app/ with its own data folder, superuser and port, without
 * byl-mail.exe, plus the test route that names the variables its server sees. The superuser stays
 * in memory.
 */
function makeCopy(name, port) {
	const dir = join(base, name, 'app');
	mkdirSync(join(dir, 'pb_public'), { recursive: true });
	for (const file of ['byl-control.ps1', 'byl-functions.ps1', 'byl-problems.ps1', 'byl-pruefen.bat']) copyFileSync(join(APP_DIR, file), join(dir, file));
	copyFileSync(POCKETBASE_EXE, join(dir, 'pocketbase.exe'));
	cpSync(join(APP_DIR, 'pb_hooks'), join(dir, 'pb_hooks'), { recursive: true });
	copyFileSync(PROBE_HOOK, join(dir, 'pb_hooks', 'environment-probe.pb.js'));
	cpSync(join(APP_DIR, 'pb_migrations'), join(dir, 'pb_migrations'), { recursive: true });
	writeFileSync(join(dir, 'pb_public', 'index.html'), '<!doctype html><title>test</title>');
	writeFileSync(join(dir, 'byl-config.json'), JSON.stringify({ port }));
	const email = `ctl-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64');
	const upsert = spawnSyncClean(
		join(dir, 'pocketbase.exe'),
		[
			'superuser',
			'upsert',
			`--dir=${join(dir, 'pb_data')}`,
			`--hooksDir=${join(dir, 'pb_hooks')}`,
			`--migrationsDir=${join(dir, 'pb_migrations')}`,
			'--automigrate=false',
			email,
			password
		],
		{ encoding: 'utf8', windowsHide: true, timeout: scaled(60_000) }
	);
	if (upsert.status !== 0) throw new Error(`superuser upsert failed in ${dir} (exit code ${upsert.status})`);
	return { dir, port, email, password };
}

let outputs = 0;

/**
 * Runs byl-control.ps1 of a copy; never without -NoBrowser, always with a clean environment and
 * CONTROL_ENV. The output goes into a file: the started server inherits the handles of PowerShell,
 * so a pipe would stay open until the server ends (ADR-0039, limits).
 */
function control(copy, ...args) {
	outputs += 1;
	const file = join(base, `output-${outputs}.txt`);
	const fd = openSync(file, 'w');
	let result;
	try {
		result = spawnSyncClean(
			POWERSHELL_EXE,
			['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(copy.dir, 'byl-control.ps1'), ...args, '-NoBrowser'],
			{ windowsHide: true, timeout: COMMAND_TIMEOUT_MS, stdio: ['ignore', fd, fd], env: CONTROL_ENV }
		);
	} finally {
		closeSync(fd);
	}
	if (result.error) throw result.error;
	return { code: result.status, output: readFileSync(file, 'latin1') };
}

/** pocketbase.exe processes whose program lies below the temp base of this file. */
function servers() {
	return runPowerShellJson(
		String.raw`
$base = $env:BYL_TEST_INPUT | ConvertFrom-Json
$found = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'pocketbase.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { @{ pid = [int]$_.ProcessId; path = $_.ExecutablePath } })
ConvertTo-Json -InputObject $found -Compress`,
		base
	);
}

const serversOf = (copy) => servers().filter((server) => server.path.toLowerCase() === join(copy.dir, 'pocketbase.exe').toLowerCase());

/**
 * GET /api/health on a new connection each time (agent: false). fetch would reuse a pooled
 * keep-alive socket of a server that was stopped in the meantime: spawnSync blocks the event loop
 * during the whole command, so the pool only learns afterwards that the socket is gone, and the
 * request on it fails although the new server on the same port answers.
 */
function healthy(port) {
	return new Promise((resolvePromise) => {
		const request = get({ host: '127.0.0.1', port, path: '/api/health', agent: false, timeout: scaled(2000) }, (response) => {
			response.resume();
			resolvePromise(response.statusCode === 200);
		});
		request.once('timeout', () => request.destroy());
		request.once('error', () => resolvePromise(false));
	});
}

const readState = (copy) => JSON.parse(readFileSync(join(copy.dir, 'run', 'byl.state.json'), 'utf8'));

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** logs\byl-control.log of a copy (one line per changing command), '' without one. */
function controlLog(copy) {
	const path = join(copy.dir, 'logs', 'byl-control.log');
	return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Names (never values) of the BYL_* variables in the user and the machine scope of the account. */
function accountVariableNames() {
	return runPowerShellJson(
		String.raw`
$names = foreach ($scope in 'User', 'Machine') {
    [Environment]::GetEnvironmentVariables($scope).Keys | Where-Object { $_ -like 'BYL_*' }
}
ConvertTo-Json -InputObject @($names | Sort-Object -Unique) -Compress`,
		null
	);
}

/**
 * The BYL_* names the running server of a copy sees, among those of the account, of this test
 * process (with CANARY) and of CONTROL_ENV.
 */
async function serverSees(copy) {
	const pb = new PocketBase(`http://127.0.0.1:${copy.port}`);
	pb.autoCancellation(false);
	await pb.collection('_superusers').authWithPassword(copy.email, copy.password);
	const names = [...accountVariableNames(), ...credentialNames(), ...Object.keys(CONTROL_ENV)];
	expect(names).toContain(CANARY);
	return visibleNames(pb, names);
}

beforeAll(async () => {
	process.env[CANARY] = 'nie-an-kindprozesse';
	// Not in %TEMP%: PocketBase takes a program there for "go run" and switches to its dev mode,
	// whose SQL log names the installer account and looks like a first run. .tmp is gitignored.
	mkdirSync(TEMP_ROOT, { recursive: true });
	// The long form of the path: Windows reports program paths without 8.3 short names.
	base = realpathSync.native(mkdtempSync(join(TEMP_ROOT, 'byl-ctl-')));
	// Guard: everything happens below .tmp, never in app\ of this or another folder.
	expect(base.toLowerCase().startsWith(`${realpathSync.native(TEMP_ROOT).toLowerCase()}\\byl-ctl-`)).toBe(true);
	expect(base.toLowerCase().startsWith(APP_DIR.toLowerCase())).toBe(false);
	const portA = await freePort();
	let portB = await freePort();
	while (portB === portA) portB = await freePort();
	copies.a = makeCopy('Kopie A', portA);
	copies.b = makeCopy('KopieB', portB);
});

afterAll(() => {
	delete process.env[CANARY];
	for (const server of base ? servers() : []) {
		try {
			process.kill(server.pid);
		} catch {
			// gone already
		}
	}
	if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

// A case starts and stops real servers, some twice (about 7 s each on a CI runner): more time than
// the 60 s of a test with processes.
const CASE_TIMEOUT = { timeout: scaled(120_000) };

// The cases build on each other and run in this order (tests of one file run one after another).
describe('byl-control.ps1 on disposable copies (BS-1)', CASE_TIMEOUT, () => {
	it('stop without a running instance says so and ends with 0', () => {
		const result = control(copies.a, 'stop');
		expect(result.code).toBe(0);
		expect(result.output).toMatch(/becauseyoulovejira l.+uft nicht\./);
		expect(serversOf(copies.a)).toEqual([]);
	});

	it('start starts one server on the configured port and writes state and address', async () => {
		const result = control(copies.a, 'start');
		expect(result.code, result.output).toBe(0);
		expect(await healthy(copies.a.port)).toBe(true);
		const running = serversOf(copies.a);
		expect(running).toHaveLength(1);
		const state = readState(copies.a);
		expect(state).toMatchObject({ schema: 1, pid: running[0].pid, port: copies.a.port });
		expect(Date.parse(state.startedUtc)).not.toBeNaN();
		expect(readFileSync(join(copies.a.dir, 'run', 'app-adresse.js'), 'utf8')).toContain(
			`window.BYL_APP_URL = 'http://127.0.0.1:${copies.a.port}/';`
		);
		expect(result.output).toContain(`http://127.0.0.1:${copies.a.port}/ (PID ${running[0].pid})`);
	});

	it('gives the server only the explicit test values, no BYL_* variable of the account or of the tests', async () => {
		expect(await serverSees(copies.a)).toEqual(Object.keys(CONTROL_ENV).sort());
	});

	it('a second start starts nothing and keeps the process', () => {
		const before = serversOf(copies.a);
		const result = control(copies.a, 'start');
		expect(result.code, result.output).toBe(0);
		expect(result.output).toContain(`(PID ${before[0].pid}, http://127.0.0.1:${copies.a.port}/)`);
		expect(serversOf(copies.a)).toEqual(before);
	});

	it('reports a port used by another copy with its program and a free port, and stops nothing', () => {
		writeFileSync(join(copies.b.dir, 'byl-config.json'), JSON.stringify({ port: copies.a.port }));
		const [serverA] = serversOf(copies.a);
		const result = control(copies.b, 'start');
		expect(result.code, result.output).toBe(4);
		// The entry port-busy of the catalog (ADR-0048): who uses the port, cause, steps, the command
		// with the real path of this copy, and the log.
		expect(result.output).toContain(`Problem:   Port ${copies.a.port} auf 127.0.0.1 ist belegt; becauseyoulovejira startet dort nicht.`);
		expect(result.output).toContain(`Belegt durch pocketbase.exe (PID ${serverA.pid}): ${join(copies.a.dir, 'pocketbase.exe')}`);
		expect(result.output).toContain('  Ursache:   ');
		expect(result.output).toContain("  So geht's: 1. ");
		expect(result.output).toContain('Befehl zum Kopieren:');
		expect(result.output).toMatch(new RegExp(`powershell -NoProfile -ExecutionPolicy Bypass -File "${escapeRegExp(join(copies.b.dir, 'byl-control.ps1'))}" port \\d+\\r?\\n`));
		expect(result.output).toContain(`  Details:   ${join(copies.b.dir, 'logs', 'byl-control.log')}`);
		expect(controlLog(copies.b)).toMatch(/ start exit=4 problem=port-busy\r$/m);
		expect(serversOf(copies.b)).toEqual([]);
		expect(serversOf(copies.a)).toEqual([serverA]);
	});

	it('never stops the server of another folder (safety rule)', async () => {
		const [serverA] = serversOf(copies.a);
		const result = control(copies.b, 'stop');
		expect(result.code, result.output).toBe(0);
		expect(result.output).toMatch(/l.+uft nicht\./);
		expect(serversOf(copies.a)).toEqual([serverA]);
		expect(await healthy(copies.a.port)).toBe(true);
	});

	it('port sets the port of copy B and refuses invalid values', () => {
		expect(control(copies.b, 'port', '80').code).toBe(1);
		expect(control(copies.b, 'port', 'abc').code).toBe(1);
		const result = control(copies.b, 'port', String(copies.b.port));
		expect(result.code, result.output).toBe(0);
		expect(JSON.parse(readFileSync(join(copies.b.dir, 'byl-config.json'), 'utf8'))).toEqual({ port: copies.b.port });
		expect(readFileSync(join(copies.b.dir, 'run', 'app-adresse.js'), 'utf8')).toContain(`:${copies.b.port}/`);
	});

	it('a copy with byl-mail.exe starts no mail helper and writes no access data into the account', async () => {
		const before = accountVariableNames();
		// Never run: an attempt would show as "byl-mail.exe konnte nicht gestartet werden".
		writeFileSync(join(copies.b.dir, 'byl-mail.exe'), 'placeholder of control-script.test.mjs\n');
		const result = control(copies.b, 'start');
		expect(result.code, result.output).toBe(0);
		expect(result.output).not.toMatch(/byl-mail\.exe|Mail-Hilfsprozess/);
		expect(existsSync(join(copies.b.dir, 'logs', 'byl-mail.log'))).toBe(false);
		// Without BYL_INGEST_TOKEN the server has no ingest route, and no token was created.
		expect(await serverSees(copies.b)).toEqual(Object.keys(CONTROL_ENV).sort());
		expect(accountVariableNames()).toEqual(before);
	});

	it('stops only its own server, in order, and leaves the other copy running', async () => {
		expect(control(copies.b, 'start').code).toBe(0);
		const [serverB] = serversOf(copies.b);
		const result = control(copies.a, 'stop');
		expect(result.code, result.output).toBe(0);
		expect(result.output).toContain('becauseyoulovejira wurde beendet.');
		// The log line names the exit codes of the senders of the console break (plan T-3), so a
		// hard stop says why.
		expect(result.output, controlLog(copies.a)).not.toContain('hart beendet');
		expect(controlLog(copies.a)).toMatch(/ stop exit=0 stopped break=-?\d+(,-?\d+)*\r$/m);
		expect(serversOf(copies.a)).toEqual([]);
		expect(await healthy(copies.a.port)).toBe(false);
		// PocketBase closed its database: the WAL was checkpointed and removed.
		expect(existsSync(join(copies.a.dir, 'pb_data', 'data.db-wal'))).toBe(false);
		expect(existsSync(join(copies.a.dir, 'run', 'byl.state.json'))).toBe(false);
		expect(serversOf(copies.b)).toEqual([serverB]);
		expect(await healthy(copies.b.port)).toBe(true);
	});

	it('restart ends the server and starts a new one', async () => {
		const [before] = serversOf(copies.b);
		const result = control(copies.b, 'restart');
		expect(result.code, result.output).toBe(0);
		const after = serversOf(copies.b);
		expect(after).toHaveLength(1);
		expect(after[0].pid).not.toBe(before.pid);
		expect(readState(copies.b).pid).toBe(after[0].pid);
		expect(await healthy(copies.b.port)).toBe(true);
	});

	it('removes a stale state file of a process that ended', () => {
		expect(control(copies.b, 'stop').code).toBe(0);
		const gone = spawnSyncClean(process.execPath, ['-e', ''], { windowsHide: true });
		mkdirSync(join(copies.b.dir, 'run'), { recursive: true });
		writeFileSync(
			join(copies.b.dir, 'run', 'byl.state.json'),
			JSON.stringify({ schema: 1, pid: gone.pid, port: copies.b.port, processStartUtc: new Date().toISOString(), startedUtc: new Date().toISOString() })
		);
		const result = control(copies.b, 'stop');
		expect(result.code, result.output).toBe(0);
		expect(existsSync(join(copies.b.dir, 'run', 'byl.state.json'))).toBe(false);
	});
});

/** status -Json of a copy: exit code and the parsed JSON line. */
function status(copy) {
	const result = control(copy, 'status', '-Json');
	return { code: result.code, data: JSON.parse(result.output.trim()) };
}

describe('byl-control.ps1: status, reload, open, logs and doctor (BS-2)', CASE_TIMEOUT, () => {
	it('status and open report a stopped app with exit code 3, doctor finds no error', () => {
		const stopped = status(copies.a);
		expect(stopped.code).toBe(3);
		expect(stopped.data).toMatchObject({ state: 'stopped', pid: null, port: copies.a.port, verdict: 'current', exitCode: 3 });
		expect(control(copies.a, 'open').code).toBe(3);
		const doctor = control(copies.a, 'doctor', '-Json');
		expect(doctor.code, doctor.output).toBe(0);
		const checks = JSON.parse(doctor.output.trim());
		expect(checks.ok).toBe(true);
		const byName = Object.fromEntries(checks.checks.map((check) => [check.name, check.level]));
		expect(byName).toMatchObject({ pocketbase: 'ok', pb_hooks: 'ok', web: 'ok', config: 'ok', instance: 'info', port: 'ok', 'write-logs': 'ok' });
	});

	it('status after a start: running, current, with the start time', () => {
		expect(control(copies.a, 'start').code).toBe(0);
		const [server] = serversOf(copies.a);
		const running = status(copies.a);
		expect(running.code).toBe(0);
		expect(running.data).toMatchObject({ state: 'running', pid: server.pid, port: copies.a.port, verdict: 'current', restartReasons: [], reloadReasons: [] });
		expect(Date.parse(running.data.startedUtc)).not.toBeNaN();
		expect(readState(copies.a).fingerprint).toMatchObject({ port: String(copies.a.port) });
		const open = control(copies.a, 'open');
		expect(open.code).toBe(0);
		expect(open.output).toContain(`http://127.0.0.1:${copies.a.port}/`);
	});

	it('a new web build only asks for F5: reload keeps the server', () => {
		const [before] = serversOf(copies.a);
		mkdirSync(join(copies.a.dir, 'pb_public', '_app'), { recursive: true });
		writeFileSync(join(copies.a.dir, 'pb_public', '_app', 'version.json'), JSON.stringify({ version: String(Date.now()) }));
		const after = status(copies.a);
		expect(after.code).toBe(0);
		expect(after.data).toMatchObject({ verdict: 'reload', restartReasons: [], reloadReasons: ['web'] });
		const reload = control(copies.a, 'reload');
		expect(reload.code, reload.output).toBe(0);
		expect(reload.output).toMatch(/Kein Neustart n.+tig/);
		expect(serversOf(copies.a)).toEqual([before]);
	});

	it('changed hooks need a restart (exit code 6), and reload restarts', async () => {
		const [before] = serversOf(copies.a);
		writeFileSync(join(copies.a.dir, 'pb_hooks', 'zz-control-test.pb.js'), '// written by control-script.test.mjs\n');
		const needed = status(copies.a);
		expect(needed.code).toBe(6);
		expect(needed.data.restartReasons).toEqual(['hooks']);
		const reload = control(copies.a, 'reload');
		expect(reload.code, reload.output).toBe(0);
		expect(reload.output).toContain('Neustart n');
		const [after] = serversOf(copies.a);
		expect(after.pid).not.toBe(before.pid);
		expect(await healthy(copies.a.port)).toBe(true);
		expect(status(copies.a).data).toMatchObject({ verdict: 'current', pid: after.pid });
		// The previous run of the server log stays as *.1.log.
		expect(existsSync(join(copies.a.dir, 'logs', 'pocketbase.out.1.log'))).toBe(true);
	});

	it('a start without fingerprint (older scripts) counts as unknown; reload -Force always restarts', () => {
		const state = readState(copies.a);
		delete state.fingerprint;
		writeFileSync(join(copies.a.dir, 'run', 'byl.state.json'), JSON.stringify(state));
		const unknown = status(copies.a);
		expect(unknown.code).toBe(6);
		expect(unknown.data.restartReasons).toEqual(['unknown']);
		expect(control(copies.a, 'reload').code).toBe(0);
		const [restarted] = serversOf(copies.a);
		expect(restarted.pid).not.toBe(state.pid);
		expect(control(copies.a, 'reload', '-Force').code).toBe(0);
		expect(serversOf(copies.a)[0].pid).not.toBe(restarted.pid);
	});

	it('logs shows the logs, including one line per changing command without values', () => {
		const all = control(copies.a, 'logs', '-Lines', '5');
		expect(all.code).toBe(0);
		expect(all.output).toContain('== logs\\pocketbase.out.log');
		expect(all.output).toContain('== logs\\byl-control.log');
		const script = readFileSync(join(copies.a.dir, 'logs', 'byl-control.log'), 'utf8');
		expect(script).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ start exit=0 pid=\d+ port=\d+\r$/m);
		expect(script).toMatch(/ reload exit=0 action=reloadonly\r$/m);
		expect(script).toMatch(/ reload exit=0 action=restart pid=\d+ port=\d+ break=-?\d+(,-?\d+)*\r$/m);
		expect(script).not.toMatch(/status|@|BYL_/);
		expect(control(copies.a, 'logs', 'unbekannt').code).toBe(1);
		expect(control(copies.a, 'logs', '-Follow').code).toBe(1);
		expect(control(copies.a, 'stop').code).toBe(0);
	});
});

/** A listener of this test process on 127.0.0.1:<port> (another program on the port). */
async function occupy(port) {
	const server = createServer();
	await new Promise((done) => server.listen(port, '127.0.0.1', done));
	return () => new Promise((done) => server.close(done));
}

/** A .bat file of a copy through cmd.exe (never a wrapper that starts or stops something). */
function batch(file, ...args) {
	const result = spawnSyncClean(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), ['/d', '/c', file, ...args], {
		encoding: 'latin1',
		windowsHide: true,
		timeout: COMMAND_TIMEOUT_MS,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: CONTROL_ENV
	});
	if (result.error) throw result.error;
	return { code: result.status, output: result.stdout + result.stderr };
}

// Plan robuste-skripte RS-1 (ADR-0048): problems from the catalog, with the real paths of the copy.
describe('byl-control.ps1: problems with cause, steps and the command to copy (RS-1)', CASE_TIMEOUT, () => {
	it('names an unknown command with the list of commands and the help to copy, and logs only its code', () => {
		const result = control(copies.a, 'strat');
		expect(result.code).toBe(1);
		expect(result.output).toContain('Problem:   Unbekannter Befehl');
		expect(result.output).toContain('  Ursache:   byl-control.ps1 kennt nur diese Befehle: start, stop,');
		expect(result.output).toContain(`"${join(copies.a.dir, 'byl-control.ps1')}" help`);
		expect(controlLog(copies.a)).toMatch(/ unbekannt exit=1 problem=command-unknown\r$/m);
		expect(controlLog(copies.a)).not.toContain('strat');
	});

	it('reports a missing pocketbase.exe with the folder and the log, and without a command outside the repository', () => {
		const exe = join(copies.b.dir, 'pocketbase.exe');
		renameSync(exe, `${exe}.weg`);
		try {
			const result = control(copies.b, 'start');
			expect(result.code).toBe(1);
			expect(result.output).toContain('Problem:   pocketbase.exe fehlt im Ordner');
			expect(result.output).toContain(copies.b.dir);
			expect(result.output).toContain('scripts\\fetch-pocketbase.ps1');
			// The copy lies in no checkout of the repository: no command with a path that is not there.
			expect(result.output).not.toContain('Befehl zum Kopieren');
			expect(result.output).toContain(`  Details:   ${join(copies.b.dir, 'logs', 'byl-control.log')}`);
			expect(controlLog(copies.b)).toMatch(/ start exit=1 problem=pocketbase-missing\r$/m);
		} finally {
			renameSync(`${exe}.weg`, exe);
		}
	});

	it('starts without the interface but says so, with the hint of the catalog', async () => {
		const index = join(copies.b.dir, 'pb_public', 'index.html');
		const page = readFileSync(index);
		rmSync(index);
		try {
			const result = control(copies.b, 'start');
			expect(result.code, result.output).toBe(0);
			expect(result.output).toContain('! Hinweis:   Die Oberfl');
			expect(result.output).toContain('pb_public\\index.html');
			expect(await healthy(copies.b.port)).toBe(true);
			expect(control(copies.b, 'stop').code).toBe(0);
		} finally {
			writeFileSync(index, page);
		}
	});

	it('keeps an error of a run without window for status -Json and shows it once in the next console run', async () => {
		const release = await occupy(copies.b.port);
		try {
			// restart as the page System starts it: in the background, after its caller ended.
			const gone = spawnSyncClean(process.execPath, ['-e', ''], { windowsHide: true });
			const result = control(copies.b, 'restart', '-Quiet', '-WaitForProcess', String(gone.pid));
			expect(result.code, result.output).toBe(4);
			const kept = JSON.parse(readFileSync(join(copies.b.dir, 'run', 'hintergrund-problem.json'), 'utf8'));
			expect(kept).toMatchObject({ run: 'restart', report: { code: 'port-busy', level: 'error', exitCode: 4 } });
			expect(Date.parse(kept.atUtc)).not.toBeNaN();
			expect(kept.report.command).toContain(`"${join(copies.b.dir, 'byl-control.ps1')}" port `);
			const json = status(copies.b);
			expect(json.code).toBe(3);
			expect(json.data.backgroundProblem).toMatchObject({ run: 'restart', report: { code: 'port-busy' } });
			// status -Json leaves it; a run in a console window shows it once and removes it.
			expect(existsSync(join(copies.b.dir, 'run', 'hintergrund-problem.json'))).toBe(true);
			const shown = control(copies.b, 'status');
			expect(shown.output).toContain('Hinweis: Beim letzten Lauf ohne Fenster (restart, ');
			expect(shown.output).toContain(`Problem:   Port ${copies.b.port} auf 127.0.0.1 ist belegt`);
			expect(existsSync(join(copies.b.dir, 'run', 'hintergrund-problem.json'))).toBe(false);
			expect(status(copies.b).data.backgroundProblem).toBeNull();
		} finally {
			await release();
		}
	});

	it('a run without window that went well removes a kept problem', () => {
		writeFileSync(
			join(copies.b.dir, 'run', 'hintergrund-problem.json'),
			JSON.stringify({ atUtc: new Date().toISOString(), run: 'start', report: { code: 'health-timeout', level: 'error', exitCode: 5, problem: 'alt', steps: ['x'] } })
		);
		const gone = spawnSyncClean(process.execPath, ['-e', ''], { windowsHide: true });
		const result = control(copies.b, 'restart', '-Quiet', '-WaitForProcess', String(gone.pid));
		expect(result.code, result.output).toBe(0);
		expect(existsSync(join(copies.b.dir, 'run', 'hintergrund-problem.json'))).toBe(false);
		expect(control(copies.b, 'stop').code).toBe(0);
	});

	it('answers -Json with the entry of the catalog as report', () => {
		const result = control(copies.a, 'logs', 'unbekannt', '-Json');
		expect(result.code).toBe(1);
		const answer = JSON.parse(result.output.trim());
		expect(answer).toMatchObject({
			ok: false,
			exitCode: 1,
			report: { code: 'logs-unknown', level: 'error', exitCode: 1, command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${join(copies.a.dir, 'byl-control.ps1')}" logs` }
		});
		expect(answer.report.steps.length).toBeGreaterThan(0);
	});

	it('byl-pruefen.bat says nothing when the script runs, and shows the entry script-blocked when it cannot', () => {
		expect(batch(join(copies.a.dir, 'byl-pruefen.bat'), '1')).toEqual({ code: 0, output: '' });
		expect(batch(join(copies.a.dir, 'byl-pruefen.bat'), '4')).toEqual({ code: 0, output: '' });
		// A copy without byl-functions.ps1 and byl-problems.ps1: PowerShell cannot run the script.
		const broken = join(base, 'Pruefung', 'app');
		mkdirSync(broken, { recursive: true });
		for (const file of ['byl-control.ps1', 'byl-pruefen.bat']) copyFileSync(join(APP_DIR, file), join(broken, file));
		const result = batch(join(broken, 'byl-pruefen.bat'), '1');
		expect(result.code).toBe(1);
		expect(result.output).toContain('X Problem:   byl-control.ps1 konnte nicht ausgefuehrt werden.');
		expect(result.output).toContain(`             Ordner: ${broken}\\`);
		expect(result.output).toContain(`powershell -NoProfile -Command "Get-ChildItem -LiteralPath '${broken}\\' | Unblock-File"`);
	});
});
