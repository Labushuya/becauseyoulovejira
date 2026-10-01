// Page "Einstellungen → System" against a disposable copy of the app folder (ADR-0043): the routes
// of app/pb_hooks/system.pb.js run the real byl-control.ps1 of the copy, including the detached
// restart that ends the server it was started from. Everything happens ONLY in a copy under
// .tmp\byl-sys-* of the repo, with a superuser created beforehand (CLAUDE.md §11.2), a random port
// (never 8090 or 8099) and a clean environment with BYL_TEST_ISOLATED=1 (tests/support/clean-env.mjs):
// the copy sees only the invented values of this file, never access data of the account, and its
// autostart goes into a folder of the test (BYL_TEST_STARTUP_DIR), never into the startup folder of
// the account. app\ and the instance of the user are never started, stopped or asked. Every server
// and helper of the copy ends in afterAll, and the copy is removed.

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
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSyncClean } from '../support/clean-env.mjs';
import { POCKETBASE_EXE } from '../support/pocketbase-harness.mjs';
import { POWERSHELL_EXE, runPowerShellJson } from '../support/powershell.mjs';
import { LOG_WRITE_MS, scaled } from '../support/timing.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(ROOT_DIR, 'app');
const TEMP_ROOT = join(ROOT_DIR, '.tmp');
const MAIL_HELPER = join(ROOT_DIR, 'helpers', 'mail', 'dist', 'byl-mail.exe');
// 8090 and 8091: app and mail helper of the user; 8099: spikes.
const RESERVED_PORTS = new Set([8090, 8091, 8099]);
const COMMAND_TIMEOUT_MS = scaled(60_000);

// Invented values: the switch for disposable copies, the ingest token of the copy (so its server has
// the ingest route and mail-restart can start a helper) and a secret that must never leave a log.
const LOG_SECRET = `geheim-${randomBytes(9).toString('hex')}`;
let CONTROL_ENV;

let base;
let copy;
let owner;
let other;
let superuserToken;

async function freePort() {
	for (;;) {
		const probe = createServer();
		await new Promise((done) => probe.listen(0, '127.0.0.1', done));
		const { port } = probe.address();
		await new Promise((done) => probe.close(done));
		if (!RESERVED_PORTS.has(port)) return port;
	}
}

/** One HTTP request on a new connection; the body parsed as JSON when it is JSON. */
function call(method, path, { token, origin, host, headers = {}, body } = {}) {
	return new Promise((done, fail) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const req = request(
			{
				host: '127.0.0.1',
				port: copy.port,
				path,
				method,
				agent: false,
				timeout: scaled(90_000),
				headers: {
					...(token ? { Authorization: token } : {}),
					...(origin ? { Origin: origin } : {}),
					...(host ? { Host: host } : {}),
					...(data ? { 'Content-Type': 'application/json' } : {}),
					...headers
				}
			},
			(response) => {
				let text = '';
				response.setEncoding('utf8');
				response.on('data', (chunk) => (text += chunk));
				response.on('end', () => {
					let parsed = text;
					try {
						parsed = JSON.parse(text);
					} catch {
						// not JSON
					}
					done({ status: response.statusCode, body: parsed, headers: response.headers });
				});
			}
		);
		req.once('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
		req.once('error', fail);
		if (data) req.write(data);
		req.end();
	});
}

/** A request of the app itself: token of the owner, Origin of the address it runs on. */
const app = (method, path, options = {}) =>
	call(method, path, { token: owner.token, origin: method === 'POST' ? `http://127.0.0.1:${copy.port}` : undefined, ...options });

async function healthy() {
	try {
		return (await call('GET', '/api/health')).status === 200;
	} catch {
		return false;
	}
}

let outputs = 0;

/** byl-control.ps1 of the copy, never without -NoBrowser, with a clean environment and CONTROL_ENV. */
function control(...args) {
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

/** Processes whose program lies below the temp base of this file (servers and mail helpers). */
function processes() {
	return runPowerShellJson(
		String.raw`
$base = $env:BYL_TEST_INPUT | ConvertFrom-Json
$found = @(Get-CimInstance -ClassName Win32_Process |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { @{ pid = [int]$_.ProcessId; path = $_.ExecutablePath; name = $_.Name } })
ConvertTo-Json -InputObject $found -Compress`,
		base
	);
}

const servers = () => processes().filter((process) => process.name.toLowerCase() === 'pocketbase.exe');
const helpers = () => processes().filter((process) => process.name.toLowerCase() === 'byl-mail.exe');

/** Whether the shortcut of the account's startup folder exists, and its time; read only. */
function accountStartup() {
	return runPowerShellJson(
		String.raw`
$path = [System.IO.Path]::Combine([Environment]::GetFolderPath('Startup'), 'becauseyoulovejira.lnk')
$exists = [System.IO.File]::Exists($path)
$time = if ($exists) { [System.IO.File]::GetLastWriteTimeUtc($path).Ticks } else { 0 }
ConvertTo-Json -InputObject @{ exists = $exists; time = [string]$time } -Compress`,
		null
	);
}

async function authToken(collection, email, password) {
	const answer = await call('POST', `/api/collections/${collection}/auth-with-password`, { body: { identity: email, password } });
	if (answer.status !== 200) throw new Error(`sign-in failed (${answer.status})`);
	return answer.body.token;
}

async function createUser() {
	const email = `sys-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64url');
	const created = await call('POST', '/api/collections/users/records', {
		token: superuserToken,
		body: { email, password, passwordConfirm: password }
	});
	if (created.status !== 200) throw new Error(`user not created (${created.status})`);
	return { id: created.body.id, token: await authToken('users', email, password) };
}

/** Waits until `check` holds, at most `ms`; returns whether it did. */
async function until(check, ms) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (await check()) return true;
		await delay(250);
	}
	return false;
}

beforeAll(async () => {
	// Not in %TEMP%: PocketBase takes a program there for "go run" and switches to its dev mode.
	mkdirSync(TEMP_ROOT, { recursive: true });
	base = realpathSync.native(mkdtempSync(join(TEMP_ROOT, 'byl-sys-')));
	// Guard: everything happens below .tmp of this worktree, never in app\ of this or another folder.
	expect(base.toLowerCase().startsWith(`${realpathSync.native(TEMP_ROOT).toLowerCase()}\\byl-sys-`)).toBe(true);
	expect(base.toLowerCase().startsWith(APP_DIR.toLowerCase())).toBe(false);
	const dir = join(base, 'Kopie System', 'app');
	const startup = join(base, 'startup');
	mkdirSync(join(dir, 'pb_public'), { recursive: true });
	mkdirSync(startup);
	// start-hidden.vbs only as the target of the test shortcut; it never runs.
	for (const file of ['byl-control.ps1', 'byl-functions.ps1', 'start-hidden.vbs']) copyFileSync(join(APP_DIR, file), join(dir, file));
	copyFileSync(POCKETBASE_EXE, join(dir, 'pocketbase.exe'));
	cpSync(join(APP_DIR, 'pb_hooks'), join(dir, 'pb_hooks'), { recursive: true });
	cpSync(join(APP_DIR, 'pb_migrations'), join(dir, 'pb_migrations'), { recursive: true });
	writeFileSync(join(dir, 'pb_public', 'index.html'), '<!doctype html><title>test</title>');
	const port = await freePort();
	let helperPort = await freePort();
	while (helperPort === port) helperPort = await freePort();
	writeFileSync(join(dir, 'byl-config.json'), JSON.stringify({ port }));
	CONTROL_ENV = {
		BYL_TEST_ISOLATED: '1',
		BYL_TEST_STARTUP_DIR: startup,
		BYL_INGEST_TOKEN: randomBytes(24).toString('base64'),
		// The helper of the copy listens here, never on 8091 of the user's helper.
		BYL_MAIL_HELPER_PORT: String(helperPort),
		BYL_TEST_LOG_SECRET: LOG_SECRET
	};
	const email = `sys-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64');
	const upsert = spawnSyncClean(
		join(dir, 'pocketbase.exe'),
		['superuser', 'upsert', `--dir=${join(dir, 'pb_data')}`, `--hooksDir=${join(dir, 'pb_hooks')}`, `--migrationsDir=${join(dir, 'pb_migrations')}`, '--automigrate=false', email, password],
		{ encoding: 'utf8', windowsHide: true, timeout: scaled(60_000) }
	);
	if (upsert.status !== 0) throw new Error(`superuser upsert failed (exit code ${upsert.status})`);
	copy = { dir, port, startup };
	const started = control('start');
	if (started.code !== 0) throw new Error(`start failed: ${started.output}`);
	superuserToken = await authToken('_superusers', email, password);
	// The account created first owns the instance (ADR-0043 §3).
	owner = await createUser();
	other = await createUser();
});

afterAll(() => {
	if (copy) control('stop');
	for (const left of base ? processes() : []) {
		try {
			process.kill(left.pid);
		} catch {
			// gone already
		}
	}
	if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

// The cases build on each other and run in this order; some start and stop real processes.
const CASE_TIMEOUT = { timeout: scaled(120_000) };

describe('page System on a disposable copy (ADR-0043)', CASE_TIMEOUT, () => {
	it('answers the status of its own instance from byl-control.ps1 status -Json', async () => {
		const [server] = servers();
		const answer = await app('GET', '/api/byl/system');
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		expect(answer.body.appDir.toLowerCase()).toBe(copy.dir.toLowerCase());
		expect(answer.body.status).toMatchObject({
			state: 'running',
			pid: server.pid,
			port: copy.port,
			configuredPort: copy.port,
			url: `http://127.0.0.1:${copy.port}/`,
			verdict: 'current',
			restartReasons: [],
			reload: false,
			mailHelperPid: null,
			autostart: 'off'
		});
		expect(Date.parse(answer.body.status.startedUtc)).not.toBeNaN();
		expect(answer.body.mail).toEqual({ installed: false, running: false, blocker: 'not-installed' });
	});

	it('refuses an account that does not own the instance', async () => {
		const answer = await call('GET', '/api/byl/system', { token: other.token });
		expect(answer.status).toBe(403);
		expect(answer.body.reason).toBe('owner');
	});

	it('names a needed restart with its reason (exit code 6 of status)', async () => {
		const extra = join(copy.dir, 'pb_hooks', 'zz-system-test.pb.js');
		writeFileSync(extra, '// written by system-control.test.mjs\n');
		try {
			const answer = await app('GET', '/api/byl/system');
			expect(answer.status).toBe(200);
			expect(answer.body.status).toMatchObject({ verdict: 'restart', restartReasons: ['hooks'] });
		} finally {
			rmSync(extra);
		}
		expect((await app('GET', '/api/byl/system')).body.status.verdict).toBe('current');
	});

	it('"Umgebung prüfen" lists the checks of doctor with their German texts', async () => {
		const answer = await app('GET', '/api/byl/system/doctor');
		expect(answer.status).toBe(200);
		expect(answer.body.ok).toBe(true);
		expect(answer.body.checks).toEqual(
			expect.arrayContaining([
				{ name: 'web', level: 'ok', text: 'Oberfläche gebaut (pb_public)' },
				{ name: 'instance', level: 'ok', text: expect.stringMatching(/^läuft \(PID \d+, Port \d+\)$/) },
				{ name: 'autostart', level: 'info', text: 'Autostart aus' }
			])
		);
	});

	it('shows the logs without secrets, addresses, e-mail addresses or tokens', async () => {
		const key = `byl_${'A1b2C3d4E5'.repeat(4)}`;
		writeFileSync(
			join(copy.dir, 'logs', 'byl-mail.log'),
			[
				`Anmeldung mit ${LOG_SECRET} fehlgeschlagen`,
				`Abruf von https://example.com/kalender/${LOG_SECRET}/basic.ics`,
				'Absender anna.beispiel@example.com',
				'Authorization: Bearer abcdef0123456789',
				`Schlüssel ${key}`,
				'Link http://127.0.0.1:8090/_/#/pbinstal/eyJhbGciOiJIUzI1.eyJ0eXBlIjoiYXV0aCJ9.c2lnbmF0dXJlLXRlc3Q'
			].join('\r\n')
		);
		const answer = await app('GET', '/api/byl/system/logs');
		expect(answer.status).toBe(200);
		expect(answer.body.lines).toBe(200);
		expect(answer.body.logs.map((set) => set.name)).toEqual(['server', 'mail', 'skript']);
		const mail = answer.body.logs.find((set) => set.name === 'mail').files.find((file) => file.file === 'byl-mail.log');
		expect(mail).toMatchObject({ exists: true });
		expect(mail.lines).toEqual([
			'Anmeldung mit *** fehlgeschlagen',
			'Abruf von https://example.com',
			'Absender ***@example.com',
			'Authorization: Bearer ***',
			'Schlüssel ***',
			'Link http://127.0.0.1:8090'
		]);
		const server = answer.body.logs.find((set) => set.name === 'server');
		expect(server.files.map((file) => file.file)).toEqual(['pocketbase.out.log', 'pocketbase.err.log']);
		const script = answer.body.logs.find((set) => set.name === 'skript').files[0];
		expect(script.lines.some((line) => / start exit=0 pid=\d+ port=\d+$/.test(line))).toBe(true);
		expect(JSON.stringify(answer.body)).not.toContain(LOG_SECRET);
		expect(JSON.stringify(answer.body)).not.toContain(CONTROL_ENV.BYL_INGEST_TOKEN);
	});

	it('switches the autostart on and off only in the folder of the test, never in the account', async () => {
		const before = accountStartup();
		const shortcut = join(copy.startup, 'becauseyoulovejira.lnk');
		const on = await app('POST', '/api/byl/system/actions/autostart-on');
		expect(on.status, JSON.stringify(on.body)).toBe(200);
		expect(on.body.status.autostart).toBe('on');
		expect(existsSync(shortcut)).toBe(true);
		const off = await app('POST', '/api/byl/system/actions/autostart-off');
		expect(off.status).toBe(200);
		expect(off.body.status.autostart).toBe('off');
		expect(existsSync(shortcut)).toBe(false);
		expect(accountStartup()).toEqual(before);
	});

	it('restarts the mail helper, and says why it does not run', async () => {
		const none = await app('POST', '/api/byl/system/actions/mail-restart');
		expect(none.status).toBe(200);
		expect(none.body.mail).toEqual({ installed: false, running: false, blocker: 'not-installed' });
		expect(helpers()).toEqual([]);

		// The real helper; its mailbox names a variable that is not set, so it never connects to a
		// mail server (it only reports "missing" to the server of the copy).
		copyFileSync(MAIL_HELPER, join(copy.dir, 'byl-mail.exe'));
		const noMailbox = await app('POST', '/api/byl/system/actions/mail-restart');
		expect(noMailbox.body.mail).toEqual({ installed: true, running: false, blocker: 'no-mailbox' });
		const created = await call('POST', '/api/collections/connections/records', {
			token: owner.token,
			body: {
				owner: owner.id,
				type: 'mail',
				label: 'Postfach des Tests',
				enabled: true,
				secret_env: 'BYL_TEST_MAIL_PASSWORD_NOT_SET',
				settings: { provider: 'webde', user: 'anna@example.com', keywords: ['todo'] }
			}
		});
		expect(created.status).toBe(200);

		const first = await app('POST', '/api/byl/system/actions/mail-restart');
		expect(first.status).toBe(200);
		expect(first.body.mail).toEqual({ installed: true, running: true, blocker: '' });
		const [helper] = helpers();
		expect(first.body.status.mailHelperPid).toBe(helper.pid);

		const second = await app('POST', '/api/byl/system/actions/mail-restart');
		expect(second.body.mail.running).toBe(true);
		expect(second.body.status.mailHelperPid).not.toBe(helper.pid);
		expect(helpers().map((process) => process.pid)).toEqual([second.body.status.mailHelperPid]);
	});

	it('restarts through a detached process that outlives the server it was started from', async () => {
		const [before] = servers();
		const started = Date.now();
		const answer = await app('POST', '/api/byl/system/actions/restart');
		expect(answer.status, JSON.stringify(answer.body)).toBe(202);
		expect(answer.body).toEqual({ restarting: true });
		// A second restart while the first runs is refused.
		const again = await app('POST', '/api/byl/system/actions/restart');
		expect(again.status).toBe(409);
		expect(again.body.reason).toBe('busy');

		// The server that started the process ends in order: a hard stop would come only after the
		// 15 s of the console break (ADR-0039 §4).
		expect(await until(() => !servers().some((process) => process.pid === before.pid), scaled(60_000))).toBe(true);
		expect(Date.now() - started).toBeLessThan(14_000);
		expect(await until(async () => servers().length === 1 && (await healthy()), scaled(60_000))).toBe(true);
		const [after] = servers();
		expect(after.pid).not.toBe(before.pid);
		expect(JSON.parse(readFileSync(join(copy.dir, 'run', 'byl.state.json'), 'utf8')).pid).toBe(after.pid);
		// The detached process ends after the new server answers: it starts the mail helper again,
		// then it writes its line.
		const log = () => readFileSync(join(copy.dir, 'logs', 'byl-control.log'), 'utf8');
		// The line ends with the exit codes of the senders of the console breaks (plan T-3).
		const finished = new RegExp(
			` restart exit=0 pid=${after.pid} port=${copy.port} break=-?\\d+(,-?\\d+)*\\r$`,
			'm'
		);
		expect(await until(() => finished.test(log()), scaled(30_000))).toBe(true);
		expect(log()).toMatch(/ restart exit=0 detached=\d+\r$/m);
		expect(helpers()).toHaveLength(1);

		const status = await app('GET', '/api/byl/system');
		expect(status.body.status).toMatchObject({ state: 'running', pid: after.pid, verdict: 'current' });
	});

	it('writes an audit entry per action and refusal: who, when, what, without values', async () => {
		// PocketBase writes its log in batches; the entries of the stopped server were written when
		// it ended in order, those of the new one follow. Wait for every expected entry.
		const filter = encodeURIComponent("message ~ 'byl-system:'");
		const audited = ['autostart-on', 'autostart-off', 'mail-restart', 'restart'];
		let entries = [];
		const found = await until(async () => {
			const answer = await call('GET', `/api/logs?filter=${filter}&perPage=500&sort=created`, { token: superuserToken });
			entries = answer.body.items ?? [];
			const done = entries.filter((entry) => entry.message === 'byl-system: Aktion ausgeführt').map((entry) => entry.data.action);
			const refused = entries.filter((entry) => entry.message === 'byl-system: Anfrage abgelehnt').map((entry) => entry.data.reason);
			return audited.every((action) => done.includes(action)) && refused.includes('owner') && refused.includes('busy');
		}, LOG_WRITE_MS);
		expect(found).toBe(true);
		const done = entries.filter((entry) => entry.message === 'byl-system: Aktion ausgeführt');
		expect(done.map((entry) => entry.data.action)).toEqual(
			expect.arrayContaining(['autostart-on', 'autostart-off', 'mail-restart', 'restart'])
		);
		for (const entry of done) {
			expect(entry.data).toMatchObject({ user: owner.id, exit: 0 });
			expect(Date.parse(entry.created.replace(' ', 'T'))).not.toBeNaN();
		}
		expect(entries).toContainEqual(
			expect.objectContaining({
				message: 'byl-system: Anfrage abgelehnt',
				data: expect.objectContaining({ action: 'status', reason: 'owner', user: other.id })
			})
		);
		expect(entries).toContainEqual(
			expect.objectContaining({
				message: 'byl-system: Anfrage abgelehnt',
				data: expect.objectContaining({ action: 'restart', reason: 'busy', user: owner.id })
			})
		);
		const text = JSON.stringify(entries);
		for (const value of [LOG_SECRET, CONTROL_ENV.BYL_INGEST_TOKEN, owner.token, other.token, '@example.com']) {
			expect(text).not.toContain(value);
		}
	});
});
