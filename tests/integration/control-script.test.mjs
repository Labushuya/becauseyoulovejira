// byl-control.ps1 against disposable copies of the app folder (ADR-0039, plan betriebsskripte
// BS-1 and BS-2). The script runs ONLY in two copies under .tmp\byl-ctl-* of the repo (one with a
// space in the path), each with a superuser created beforehand (CLAUDE.md §11.2), a random port
// (never 8090 or 8099) and -NoBrowser; app\ and the instance of the user are never touched. Every
// server this file starts is ended in afterAll, and the copies are removed. Like every start, the
// copies get the BYL_* variables of the Windows account; their databases have no connection, so no
// channel reaches a service.
//
// Proves: a start that starts once (second start: same process), the state file and the address
// for the landing page, the orderly stop (console break: exit without a hard stop, the SQLite WAL
// is checkpointed), a port used by another copy (reported with program path and a free port,
// nothing stopped), restart, a stale state file, and the safety rule: stop in one folder never
// ends the server of another folder. BS-2: status with its exit codes, reload only when needed
// (a new web build only asks for F5, changed hooks restart), open, logs and doctor.

import { spawnSync } from 'node:child_process';
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
	rmSync,
	writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POCKETBASE_EXE } from '../support/pocketbase-harness.mjs';
import { POWERSHELL_EXE, runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(ROOT_DIR, 'app');
const TEMP_ROOT = join(ROOT_DIR, '.tmp');
const RESERVED_PORTS = new Set([8090, 8099]);
const COMMAND_TIMEOUT_MS = 60_000;

let base;
/** @type {{ a: Copy, b: Copy }} */
const copies = {};

/** @typedef {{ dir: string, port: number }} Copy */

async function freePort() {
	for (;;) {
		const probe = createServer();
		await new Promise((done) => probe.listen(0, '127.0.0.1', done));
		const { port } = probe.address();
		await new Promise((done) => probe.close(done));
		if (!RESERVED_PORTS.has(port)) return port;
	}
}

/** A copy of the runtime parts of app/ with its own data folder, superuser and port. */
function makeCopy(name, port) {
	const dir = join(base, name, 'app');
	mkdirSync(join(dir, 'pb_public'), { recursive: true });
	for (const file of ['byl-control.ps1', 'byl-functions.ps1']) copyFileSync(join(APP_DIR, file), join(dir, file));
	copyFileSync(POCKETBASE_EXE, join(dir, 'pocketbase.exe'));
	cpSync(join(APP_DIR, 'pb_hooks'), join(dir, 'pb_hooks'), { recursive: true });
	cpSync(join(APP_DIR, 'pb_migrations'), join(dir, 'pb_migrations'), { recursive: true });
	writeFileSync(join(dir, 'pb_public', 'index.html'), '<!doctype html><title>test</title>');
	writeFileSync(join(dir, 'byl-config.json'), JSON.stringify({ port }));
	const email = `ctl-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64');
	const upsert = spawnSync(
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
		{ encoding: 'utf8', windowsHide: true, timeout: 60_000 }
	);
	if (upsert.status !== 0) throw new Error(`superuser upsert failed in ${dir} (exit code ${upsert.status})`);
	return { dir, port };
}

let outputs = 0;

/**
 * Runs byl-control.ps1 of a copy; never without -NoBrowser. The output goes into a file: the
 * started server inherits the handles of PowerShell, so a pipe would stay open until the server
 * ends (ADR-0039, limits).
 */
function control(copy, ...args) {
	outputs += 1;
	const file = join(base, `output-${outputs}.txt`);
	const fd = openSync(file, 'w');
	let result;
	try {
		result = spawnSync(
			POWERSHELL_EXE,
			['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(copy.dir, 'byl-control.ps1'), ...args, '-NoBrowser'],
			{ windowsHide: true, timeout: COMMAND_TIMEOUT_MS, stdio: ['ignore', fd, fd] }
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

async function healthy(port) {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
		return response.status === 200;
	} catch {
		return false;
	}
}

const readState = (copy) => JSON.parse(readFileSync(join(copy.dir, 'run', 'byl.state.json'), 'utf8'));

beforeAll(async () => {
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
}, 120_000);

afterAll(() => {
	for (const server of base ? servers() : []) {
		try {
			process.kill(server.pid);
		} catch {
			// gone already
		}
	}
	if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}, 60_000);

// The cases build on each other and run in this order (tests of one file run one after another).
describe('byl-control.ps1 on disposable copies (BS-1)', () => {
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
		expect(result.output).toContain(`Port ${copies.a.port} auf 127.0.0.1 ist belegt durch pocketbase.exe (PID ${serverA.pid})`);
		expect(result.output).toContain(join(copies.a.dir, 'pocketbase.exe'));
		expect(result.output).toMatch(/byl-control\.ps1" port \d+/);
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

	it('stops only its own server, in order, and leaves the other copy running', async () => {
		expect(control(copies.b, 'start').code).toBe(0);
		const [serverB] = serversOf(copies.b);
		const result = control(copies.a, 'stop');
		expect(result.code, result.output).toBe(0);
		expect(result.output).toContain('becauseyoulovejira wurde beendet.');
		expect(result.output).not.toContain('hart beendet');
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
		const gone = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
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

describe('byl-control.ps1: status, reload, open, logs and doctor (BS-2)', () => {
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
		expect(script).toMatch(/ reload exit=0 action=restart pid=\d+ port=\d+\r$/m);
		expect(script).not.toMatch(/status|@|BYL_/);
		expect(control(copies.a, 'logs', 'unbekannt').code).toBe(1);
		expect(control(copies.a, 'logs', '-Follow').code).toBe(1);
		expect(control(copies.a, 'stop').code).toBe(0);
	});
});
