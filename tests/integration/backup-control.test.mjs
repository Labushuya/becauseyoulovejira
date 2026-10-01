// Backups with a target folder against a disposable copy of the app folder (ADR-0046): the routes of
// app/pb_hooks/backup.pb.js run the real byl-control.ps1 of the copy, which keeps the passphrase
// with DPAPI and seals the backups with the real byl-backup.exe into a target folder of the test.
// Everything happens ONLY in a copy under .tmp\byl-bak-* of the repo, with a superuser created
// beforehand (CLAUDE.md §11.2), a random port (never 8090 or 8099) and a clean environment with
// BYL_TEST_ISOLATED=1 (tests/support/clean-env.mjs): the copy reads only the invented BYL_* values
// of this file as "access data of the account", keeps its passphrase only in a folder of the test
// (BYL_TEST_SECRET_DIR), never under %LOCALAPPDATA%, and its autostart goes into a folder of the
// test. app\ and the instance of the user are never started, stopped or asked. Every server of the
// copy ends in afterAll, and the copy is removed.

import { createHash, randomBytes } from 'node:crypto';
import {
	closeSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSyncClean } from '../support/clean-env.mjs';
import { POCKETBASE_EXE } from '../support/pocketbase-harness.mjs';
import { POWERSHELL_EXE, runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(ROOT_DIR, 'app');
const TEMP_ROOT = join(ROOT_DIR, '.tmp');
const BACKUP_HELPER = join(ROOT_DIR, 'helpers', 'backup', 'dist', 'byl-backup.exe');
const FIXTURE_HOOKS = join(ROOT_DIR, 'tests', 'fixtures', 'pb_hooks');
const RESERVED_PORTS = new Set([8090, 8091, 8099]);
const COMMAND_TIMEOUT_MS = 60_000;
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Invented values: the access data the copy takes for those of the account, and the passphrase.
const SECRET_VALUE = `erfunden-${randomBytes(9).toString('hex')}`;
const PASSPHRASE = `Pferd Batterie Heftklammer ${randomBytes(4).toString('hex')} äöü`;
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
function call(method, path, { token, origin, headers = {}, body } = {}) {
	return new Promise((done, fail) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const req = request(
			{
				host: '127.0.0.1',
				port: copy.port,
				path,
				method,
				agent: false,
				timeout: 120_000,
				headers: {
					...(token ? { Authorization: token } : {}),
					...(origin ? { Origin: origin } : {}),
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
					done({ status: response.statusCode, body: parsed });
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

/** One run of the backups with a given clock (fixture route, superusers only). */
const runAt = (now, force) => call('POST', '/api/byl-test/backup/run', { token: superuserToken, body: { now, force } });

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

/** byl-backup.exe open on a sealed file; the parsed answer (with the values only on request). */
function openSealed(file, passphrase, secrets = false) {
	const out = mkdtempSync(join(base, 'offen-'));
	const result = spawnSyncClean(BACKUP_HELPER, ['open'], {
		input: JSON.stringify({ file, out, passphrase, secrets }),
		encoding: 'utf8',
		windowsHide: true,
		timeout: 120_000
	});
	return { out, code: result.status, answer: JSON.parse(result.stdout.trim().split('\n').pop()) };
}

/** Names of the files a ZIP holds (Windows PowerShell, ZipFile). */
function zipEntries(file) {
	return runPowerShellJson(
		String.raw`
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead(($env:BYL_TEST_INPUT | ConvertFrom-Json))
try { ConvertTo-Json -InputObject @($zip.Entries | ForEach-Object { $_.FullName }) -Compress } finally { $zip.Dispose() }`,
		file
	);
}

/** Processes whose program lies below the temp base of this file. */
function processes() {
	return runPowerShellJson(
		String.raw`
$base = $env:BYL_TEST_INPUT | ConvertFrom-Json
$found = @(Get-CimInstance -ClassName Win32_Process |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { @{ pid = [int]$_.ProcessId; name = $_.Name } })
ConvertTo-Json -InputObject $found -Compress`,
		base
	);
}

async function authToken(collection, email, password) {
	const answer = await call('POST', `/api/collections/${collection}/auth-with-password`, { body: { identity: email, password } });
	if (answer.status !== 200) throw new Error(`sign-in failed (${answer.status})`);
	return answer.body.token;
}

async function createUser() {
	const email = `bak-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64url');
	const created = await call('POST', '/api/collections/users/records', {
		token: superuserToken,
		body: { email, password, passwordConfirm: password }
	});
	if (created.status !== 200) throw new Error(`user not created (${created.status})`);
	return { id: created.body.id, token: await authToken('users', email, password) };
}

const sealedIn = (folder) => readdirSync(folder).filter((name) => name.endsWith('.tar.age')).sort();
const localBackups = () => readdirSync(join(copy.dir, 'pb_data', 'backups')).filter((name) => /^byl-.*\.zip$/.test(name)).sort();

beforeAll(async () => {
	// Not in %TEMP%: PocketBase takes a program there for "go run" and switches to its dev mode.
	mkdirSync(TEMP_ROOT, { recursive: true });
	base = realpathSync.native(mkdtempSync(join(TEMP_ROOT, 'byl-bak-')));
	// Guard: everything happens below .tmp of this worktree, never in app\ of this or another folder.
	expect(base.toLowerCase().startsWith(`${realpathSync.native(TEMP_ROOT).toLowerCase()}\\byl-bak-`)).toBe(true);
	expect(base.toLowerCase().startsWith(APP_DIR.toLowerCase())).toBe(false);
	const dir = join(base, 'Kopie Sicherung', 'app');
	const startup = join(base, 'startup');
	const secrets = join(base, 'geheim');
	const target = join(base, 'Ziel Sicherung');
	for (const folder of [join(dir, 'pb_public'), startup, secrets, target]) mkdirSync(folder, { recursive: true });
	for (const file of ['byl-control.ps1', 'byl-functions.ps1']) copyFileSync(join(APP_DIR, file), join(dir, file));
	copyFileSync(POCKETBASE_EXE, join(dir, 'pocketbase.exe'));
	copyFileSync(BACKUP_HELPER, join(dir, 'byl-backup.exe'));
	cpSync(join(APP_DIR, 'pb_hooks'), join(dir, 'pb_hooks'), { recursive: true });
	// The clock of the backups, and the mark of the test mode: the cron of the copy makes no backup
	// of its own between the cases (every case runs one with the route or the clock).
	for (const file of ['backup-clock.pb.js', 'test-mode.pb.js']) copyFileSync(join(FIXTURE_HOOKS, file), join(dir, 'pb_hooks', file));
	cpSync(join(APP_DIR, 'pb_migrations'), join(dir, 'pb_migrations'), { recursive: true });
	writeFileSync(join(dir, 'pb_public', 'index.html'), '<!doctype html><title>test</title>');
	const port = await freePort();
	writeFileSync(join(dir, 'byl-config.json'), JSON.stringify({ port }));
	CONTROL_ENV = {
		BYL_TEST_ISOLATED: '1',
		BYL_TEST_STARTUP_DIR: startup,
		BYL_TEST_SECRET_DIR: secrets,
		// The "access data of the account" of the copy: invented.
		BYL_BACKUPTEST_TOKEN: SECRET_VALUE
	};
	const email = `bak-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64');
	const upsert = spawnSyncClean(
		join(dir, 'pocketbase.exe'),
		['superuser', 'upsert', `--dir=${join(dir, 'pb_data')}`, `--hooksDir=${join(dir, 'pb_hooks')}`, `--migrationsDir=${join(dir, 'pb_migrations')}`, '--automigrate=false', email, password],
		{ encoding: 'utf8', windowsHide: true, timeout: 60_000 }
	);
	if (upsert.status !== 0) throw new Error(`superuser upsert failed (exit code ${upsert.status})`);
	copy = { dir, port, startup, secrets, target };
	const started = control('start');
	if (started.code !== 0) throw new Error(`start failed: ${started.output}`);
	superuserToken = await authToken('_superusers', email, password);
	// The account created first owns the instance (ADR-0043 §3).
	owner = await createUser();
	other = await createUser();
	// A ticket, so the manifest has something to count.
	const ticket = await call('POST', '/api/collections/tickets/records', { token: owner.token, body: { title: 'Vor der Sicherung', owner: owner.id } });
	if (ticket.status !== 200) throw new Error(`ticket not created (${ticket.status})`);
}, 180_000);

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
}, 120_000);

// The cases build on each other and run in this order.
const CASE_TIMEOUT = { timeout: 120_000 };

describe('backups with a target folder on a disposable copy (ADR-0046)', CASE_TIMEOUT, () => {
	it('shows the state without a target and without a passphrase, and only names of variables', async () => {
		const answer = await app('GET', '/api/byl/backup');
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		expect(answer.body).toMatchObject({
			settings: { target: null, daily: 7, weekly: 4, monthly: 6, credentials: true },
			passphrase: 'missing',
			helper: true,
			target: null,
			sealed: [],
			warnings: []
		});
		expect(answer.body.variables).toContain('BYL_BACKUPTEST_TOKEN');
		expect(answer.body.variables.some((name) => name.startsWith('BYL_TEST_'))).toBe(false);
		expect(JSON.stringify(answer.body)).not.toContain(SECRET_VALUE);
	});

	it('refuses other accounts, foreign origins and the actions of the page System', async () => {
		const foreign = await call('GET', '/api/byl/backup', { token: other.token });
		expect(foreign).toMatchObject({ status: 403, body: { reason: 'owner' } });
		const withoutOrigin = await call('POST', '/api/byl/backup/run', { token: owner.token, body: {} });
		expect(withoutOrigin).toMatchObject({ status: 403, body: { reason: 'origin' } });
		const otherSite = await call('POST', '/api/byl/backup/passphrase', {
			token: owner.token,
			origin: 'http://evil.example.com',
			body: { passphrase: PASSPHRASE, confirmation: PASSPHRASE }
		});
		expect(otherSite).toMatchObject({ status: 403, body: { reason: 'origin' } });
		for (const action of ['backup-export', 'backup-passphrase', 'backup-configure', 'backup-info']) {
			const answer = await app('POST', `/api/byl/system/actions/${action}`);
			expect(answer, action).toMatchObject({ status: 404, body: { reason: 'unknown' } });
		}
		const anonymous = await call('GET', '/api/byl/backup');
		expect(anonymous.status).toBe(401);
	});

	it('checks the target folder: full path, outside of app, existing', async () => {
		const settings = (target, extra = {}) => ({ target, daily: 7, weekly: 4, monthly: 6, credentials: true, ...extra });
		const inside = await app('POST', '/api/byl/backup/settings', { body: settings(join(copy.dir, 'run')) });
		expect(inside).toMatchObject({ status: 400, body: { reason: 'invalid', problem: 'inside-app' } });
		const missing = await app('POST', '/api/byl/backup/settings', { body: settings(join(base, 'gibt es nicht')) });
		expect(missing).toMatchObject({ status: 400, body: { problem: 'missing' } });
		const relative = await app('POST', '/api/byl/backup/settings', { body: settings('Sicherung') });
		expect(relative).toMatchObject({ status: 400, body: { problem: 'format' } });
		const keep = await app('POST', '/api/byl/backup/settings', { body: settings(copy.target, { daily: 0 }) });
		expect(keep).toMatchObject({ status: 400, body: { problem: 'keep' } });

		const saved = await app('POST', '/api/byl/backup/settings', { body: settings(`${copy.target}\\`) });
		expect(saved.status, JSON.stringify(saved.body)).toBe(200);
		expect(saved.body.settings.target).toBe(copy.target);
		expect(saved.body.target).toMatchObject({ path: copy.target, reachable: true, problem: null, sameDrive: true });
		expect(saved.body.target.freeBytes).toBeGreaterThan(0);
		// The port stays in the same file.
		expect(JSON.parse(readFileSync(join(copy.dir, 'byl-config.json'), 'utf8'))).toEqual({
			port: copy.port,
			backup: { target: copy.target, daily: 7, weekly: 4, monthly: 6, credentials: true }
		});
	});

	it('backs up locally and waits for a passphrase before it copies into the target', async () => {
		const answer = await app('POST', '/api/byl/backup/run');
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		expect(answer.body.result).toMatchObject({ backup: expect.stringMatching(/^byl-\d{8}-\d{6}\.zip$/), export: { ok: false, reason: 'no-passphrase' } });
		expect(localBackups()).toEqual([answer.body.result.backup]);
		expect(sealedIn(copy.target)).toEqual([]);
		expect(answer.body.warnings).toContainEqual({ code: 'no-passphrase', tone: 'warning', since: null, reason: 'missing' });
		expect(answer.body.last.exportProblem).toMatchObject({ reason: 'no-passphrase' });
	});

	it('keeps the passphrase with DPAPI in the folder of the test, never in plain text', async () => {
		const mismatch = await app('POST', '/api/byl/backup/passphrase', { body: { passphrase: PASSPHRASE, confirmation: `${PASSPHRASE}!` } });
		expect(mismatch).toMatchObject({ status: 400, body: { problem: 'mismatch' } });
		const saved = await app('POST', '/api/byl/backup/passphrase', { body: { passphrase: PASSPHRASE, confirmation: PASSPHRASE } });
		expect(saved.status, JSON.stringify(saved.body)).toBe(200);
		expect(saved.body.passphrase).toBe('set');
		expect(JSON.stringify(saved.body)).not.toContain(PASSPHRASE);
		const files = readdirSync(copy.secrets);
		expect(files).toEqual([expect.stringMatching(/^sicherung-[0-9a-f]{16}\.passphrase$/)]);
		const stored = readFileSync(join(copy.secrets, files[0]), 'utf8');
		expect(stored).toMatch(/^[A-Za-z0-9+/=]+$/);
		expect(stored).not.toContain(PASSPHRASE);
		expect(Buffer.from(stored, 'base64').includes(Buffer.from(PASSPHRASE))).toBe(false);
		// Nothing in the folder of the account (read only).
		const id = createHash('sha256').update(copy.dir.toLowerCase()).digest('hex').slice(0, 16);
		expect(files[0]).toBe(`sicherung-${id}.passphrase`);
		expect(existsSync(join(process.env.LOCALAPPDATA ?? '', 'becauseyoulovejira', files[0]))).toBe(false);
	});

	it('seals the backup into the target with settings, manifest and access data, readable with the passphrase', async () => {
		const answer = await app('POST', '/api/byl/backup/run');
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		const { backup, export: exported } = answer.body.result;
		const sealedName = backup.replace(/\.zip$/, '.tar.age');
		expect(exported).toEqual({ ok: true, reason: '', file: sealedName });
		expect(sealedIn(copy.target)).toEqual([sealedName]);
		expect(answer.body.sealed).toEqual([expect.objectContaining({ name: sealedName })]);
		expect(answer.body.warnings).toEqual([]);
		expect(answer.body.last.exportProblem).toBeNull();
		const sealedFile = join(copy.target, sealedName);
		const raw = readFileSync(sealedFile);
		expect(raw.subarray(0, 22).toString('latin1')).toBe('age-encryption.org/v1\n');
		for (const value of [SECRET_VALUE, PASSPHRASE, 'Vor der Sicherung']) expect(raw.includes(Buffer.from(value))).toBe(false);

		expect(openSealed(sealedFile, 'falsch').answer).toMatchObject({ ok: false, reason: 'passphrase' });
		const names = openSealed(sealedFile, PASSPHRASE);
		expect(names.code).toBe(0);
		expect(JSON.stringify(names.answer)).not.toContain(SECRET_VALUE);
		expect(names.answer).toMatchObject({
			ok: true,
			config: true,
			variables: ['BYL_BACKUPTEST_TOKEN'],
			manifest: {
				format: 1,
				app: 'becauseyoulovejira',
				name: backup.replace(/\.zip$/, ''),
				variables: ['BYL_BACKUPTEST_TOKEN'],
				counts: { tickets: 1, users: 2 },
				migration: expect.stringMatching(/^\d{10}_.+\.js$/)
			}
		});
		expect(names.answer.manifest.createdUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		expect(readdirSync(names.out).sort()).toEqual(['byl-config.json', 'manifest.json', 'pb_data.zip']);
		expect(zipEntries(join(names.out, 'pb_data.zip'))).toEqual(expect.arrayContaining(['data.db', 'auxiliary.db']));
		expect(openSealed(sealedFile, PASSPHRASE, true).answer.secrets).toEqual({ BYL_BACKUPTEST_TOKEN: SECRET_VALUE });
	});

	it('catches up the copy once the target is reachable again', async () => {
		const away = `${copy.target} weg`;
		renameSync(copy.target, away);
		const now = Date.now();
		const missed = await runAt(now, true);
		expect(missed.status, JSON.stringify(missed.body)).toBe(200);
		expect(missed.body.export).toEqual({ ok: false, reason: 'unreachable', file: '', bytes: 0 });
		const state = await app('GET', '/api/byl/backup');
		expect(state.body.target).toMatchObject({ reachable: false, problem: 'missing' });
		expect(state.body.last.exportProblem).toMatchObject({ reason: 'unreachable' });

		renameSync(away, copy.target);
		// Within 15 minutes the cron does not try again; after that it copies the newest backup.
		expect((await runAt(now + 5 * MINUTE, false)).body.export).toBeNull();
		const caught = await runAt(now + 16 * MINUTE, false);
		expect(caught.body.backup).toBe('');
		expect(caught.body.export).toMatchObject({ ok: true, file: missed.body.backup.replace(/\.zip$/, '.tar.age') });
		expect(sealedIn(copy.target)).toContain(caught.body.export.file);
	});

	it('leaves the access data out when switched off, and keeps the generations in both places', async () => {
		const saved = await app('POST', '/api/byl/backup/settings', {
			body: { target: copy.target, daily: 2, weekly: 0, monthly: 0, credentials: false }
		});
		expect(saved.status, JSON.stringify(saved.body)).toBe(200);
		let newest;
		for (let day = 1; day <= 4; day += 1) {
			newest = await runAt(Date.now() + day * DAY, false);
			expect(newest.body.export, `day ${day}`).toMatchObject({ ok: true });
		}
		expect(localBackups()).toHaveLength(2);
		expect(sealedIn(copy.target)).toEqual(localBackups().map((name) => name.replace(/\.zip$/, '.tar.age')));
		const opened = openSealed(join(copy.target, newest.body.export.file), PASSPHRASE, true);
		expect(opened.answer).toMatchObject({ ok: true, variables: [], secrets: {} });
		expect(opened.answer.manifest.variables).toEqual([]);
	});

	it('writes audit entries and log lines without values', async () => {
		const filter = encodeURIComponent("message ~ 'byl-backup:'");
		const answer = await call('GET', `/api/logs?filter=${filter}&perPage=500&sort=created`, { token: superuserToken });
		const entries = answer.body.items ?? [];
		const actions = entries.filter((entry) => entry.message === 'byl-backup: Aktion ausgeführt');
		expect(actions.map((entry) => entry.data.action)).toEqual(
			expect.arrayContaining(['backup-configure', 'backup-passphrase', 'backup-run'])
		);
		for (const entry of actions) expect(entry.data.user).toBe(owner.id);
		expect(entries).toContainEqual(
			expect.objectContaining({ message: 'byl-backup: Anfrage abgelehnt', data: expect.objectContaining({ reason: 'owner', user: other.id }) })
		);
		const log = readFileSync(join(copy.dir, 'logs', 'byl-control.log'), 'utf8');
		expect(log).toMatch(/ backup-passphrase exit=0 passphrase=set\r$/m);
		expect(log).toMatch(/ backup-export exit=0 file=byl-\d{8}-\d{6}\.tar\.age bytes=\d+\r$/m);
		expect(log).toMatch(/ backup-configure exit=1 problem=inside-app\r$/m);
		const everything = [JSON.stringify(entries), ...readdirSync(join(copy.dir, 'logs')).map((file) => readFileSync(join(copy.dir, 'logs', file), 'latin1'))].join('\n');
		for (const value of [SECRET_VALUE, PASSPHRASE, copy.target]) expect(everything).not.toContain(value);
	});
});
