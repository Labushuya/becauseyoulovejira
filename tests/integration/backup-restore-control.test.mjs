// Restore of backups against disposable copies of the app folder (ADR-0046 §7): byl-control.ps1
// restore with -Json (what the console does after its questions) and the detached run of the page
// (POST /api/byl/backup/restore), on copies under .tmp\byl-rst-* with a superuser created
// beforehand, random ports and BYL_TEST_ISOLATED=1 (tests/support/clean-env.mjs).
//
// The "Windows account" of a copy is its process environment plus the file BYL_TEST_ACCOUNT_FILE of
// this test: a restore writes access data only there (Set-BylAccountVariable refuses in a test copy
// without that file and never reaches the user scope there, start-scripts.test.mjs), and every
// value a copy sees is invented here. A second, fresh copy without pb_data and without settings
// stands for a new machine. app\ and the instance of the user are never started, stopped or asked.
// Every server ends in afterAll, and the copies are removed.

import { randomBytes } from 'node:crypto';
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
const COMMAND_TIMEOUT_MS = 180_000;
const DAY = 24 * 60 * 60 * 1000;
const CONFIRM = 'WIEDERHERSTELLEN';
// The codes of the console breaks of a stop end a line of byl-control.log (ADR-0039 T-3).
const BREAKS = '( break=-?\\d+(,-?\\d+)*)?';

// Invented values: the access data of the account of a copy, another value, the passphrases.
const SECRET_NAME = 'BYL_RESTORETEST_TOKEN';
const SECRET_VALUE = `erfunden-${randomBytes(9).toString('hex')}`;
const OTHER_VALUE = `erfunden-anders-${randomBytes(6).toString('hex')}`;
const PASSPHRASE = `Wiederherstellen ${randomBytes(4).toString('hex')} äöü`;
const WRONG_PASSPHRASE = `Falsch ${randomBytes(6).toString('hex')}`;

let base;
let copy;
let fresh;
let owner;
let other;
let superuserToken;
let sealedName;
let localName;

async function freePort() {
	for (;;) {
		const probe = createServer();
		await new Promise((done) => probe.listen(0, '127.0.0.1', done));
		const { port } = probe.address();
		await new Promise((done) => probe.close(done));
		if (!RESERVED_PORTS.has(port)) return port;
	}
}

/** One HTTP request to the server on `port`, on a new connection; the body parsed when it is JSON. */
function call(port, method, path, { token, origin, body } = {}) {
	return new Promise((done, fail) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path,
				method,
				agent: false,
				timeout: 60_000,
				headers: {
					...(token ? { Authorization: token } : {}),
					...(origin ? { Origin: origin } : {}),
					...(data ? { 'Content-Type': 'application/json' } : {})
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

/** A request of the app on the first copy: token of the owner, Origin of its address for POST. */
const app = (method, path, options = {}) =>
	call(copy.port, method, path, {
		token: owner.token,
		origin: method === 'POST' ? `http://127.0.0.1:${copy.port}` : undefined,
		...options
	});

/** A changing request of the app; waits for Retry-After once when the ten a minute are used up. */
async function appChange(path, body) {
	const answer = await app('POST', path, { body });
	if (answer.status !== 429 || answer.body?.reason !== 'rate') return answer;
	await new Promise((done) => setTimeout(done, Number(answer.headers['retry-after']) * 1000 + 250));
	return app('POST', path, { body });
}

async function until(check, timeoutMs, everyMs = 1000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await check()) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((done) => setTimeout(done, everyMs));
	}
}

let outputs = 0;

/**
 * byl-control.ps1 of `target` with `args` and -NoBrowser, a clean environment plus `env`, and
 * `input` as JSON on standard input when given. Exit code, output and the last line parsed.
 */
function control(target, args, { env = target.env, input } = {}) {
	outputs += 1;
	const file = join(base, `output-${outputs}.txt`);
	const fd = openSync(file, 'w');
	let result;
	try {
		result = spawnSyncClean(
			POWERSHELL_EXE,
			['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(target.dir, 'byl-control.ps1'), ...args, '-NoBrowser'],
			{
				windowsHide: true,
				timeout: COMMAND_TIMEOUT_MS,
				input: input === undefined ? undefined : JSON.stringify(input),
				stdio: [input === undefined ? 'ignore' : 'pipe', fd, fd],
				env
			}
		);
	} finally {
		closeSync(fd);
	}
	if (result.error) throw result.error;
	const output = readFileSync(file, 'utf8');
	let answer = null;
	try {
		answer = JSON.parse(output.trim().split('\n').pop());
	} catch {
		// no JSON line
	}
	return { code: result.status, output, answer };
}

/** Processes whose program lies below the temp base of this file. */
function processes() {
	return runPowerShellJson(
		String.raw`
$base = $env:BYL_TEST_INPUT | ConvertFrom-Json
$found = @(Get-CimInstance -ClassName Win32_Process |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { @{ pid = [int]$_.ProcessId; name = $_.Name; path = $_.ExecutablePath } })
ConvertTo-Json -InputObject $found -Compress`,
		base
	);
}

const serversOf = (target) =>
	processes().filter((entry) => entry.name === 'pocketbase.exe' && entry.path.toLowerCase().startsWith(target.dir.toLowerCase()));

async function healthy(port) {
	try {
		return (await call(port, 'GET', '/api/health')).status === 200;
	} catch {
		return false;
	}
}

async function signIn(port, collection, email, password) {
	const answer = await call(port, 'POST', `/api/collections/${collection}/auth-with-password`, { body: { identity: email, password } });
	if (answer.status !== 200) throw new Error(`sign-in failed (${answer.status})`);
	return answer.body.token;
}

/** Titles of the tickets the owner sees on the server of `port`, sorted. */
async function ticketTitles(port, token = owner.token) {
	const answer = await call(port, 'GET', '/api/collections/tickets/records?perPage=200&fields=title', { token });
	expect(answer.status, JSON.stringify(answer.body)).toBe(200);
	return answer.body.items.map((item) => item.title).sort();
}

async function createTicket(title) {
	const answer = await call(copy.port, 'POST', '/api/collections/tickets/records', { token: owner.token, body: { title, owner: owner.id } });
	if (answer.status !== 200) throw new Error(`ticket not created (${answer.status})`);
}

const safetyCopies = (target) => readdirSync(target.dir).filter((name) => name.startsWith('pb_data.vor-wiederherstellung-')).sort();
const account = (target) => (existsSync(target.accountFile) ? JSON.parse(readFileSync(target.accountFile, 'utf8')) : {});
const restoreState = (target) => JSON.parse(readFileSync(join(target.dir, 'run', 'wiederherstellung.json'), 'utf8'));
const controlLog = (target) => readFileSync(join(target.dir, 'logs', 'byl-control.log'), 'utf8');

/** A copy of app\ under `name` of the base: scripts, programs, hooks with the fixtures, migrations. */
function makeCopy(name, { port, config = true }) {
	const dir = join(base, name, 'app');
	const startup = join(base, name, 'startup');
	const secrets = join(base, name, 'geheim');
	for (const folder of [join(dir, 'pb_public'), startup, secrets]) mkdirSync(folder, { recursive: true });
	for (const file of ['byl-control.ps1', 'byl-functions.ps1']) copyFileSync(join(APP_DIR, file), join(dir, file));
	copyFileSync(POCKETBASE_EXE, join(dir, 'pocketbase.exe'));
	copyFileSync(BACKUP_HELPER, join(dir, 'byl-backup.exe'));
	cpSync(join(APP_DIR, 'pb_hooks'), join(dir, 'pb_hooks'), { recursive: true });
	for (const file of ['backup-clock.pb.js', 'test-mode.pb.js', 'environment-probe.pb.js']) {
		copyFileSync(join(FIXTURE_HOOKS, file), join(dir, 'pb_hooks', file));
	}
	cpSync(join(APP_DIR, 'pb_migrations'), join(dir, 'pb_migrations'), { recursive: true });
	writeFileSync(join(dir, 'pb_public', 'index.html'), '<!doctype html><title>test</title>');
	if (config) writeFileSync(join(dir, 'byl-config.json'), JSON.stringify({ port }));
	const accountFile = join(base, name, 'konto.json');
	return {
		dir,
		port,
		accountFile,
		env: {
			BYL_TEST_ISOLATED: '1',
			BYL_TEST_STARTUP_DIR: startup,
			BYL_TEST_SECRET_DIR: secrets,
			BYL_TEST_ACCOUNT_FILE: accountFile
		}
	};
}

beforeAll(async () => {
	// Not in %TEMP%: PocketBase takes a program there for "go run" and switches to its dev mode.
	mkdirSync(TEMP_ROOT, { recursive: true });
	base = realpathSync.native(mkdtempSync(join(TEMP_ROOT, 'byl-rst-')));
	expect(base.toLowerCase().startsWith(`${realpathSync.native(TEMP_ROOT).toLowerCase()}\\byl-rst-`)).toBe(true);
	copy = makeCopy('Kopie', { port: await freePort() });
	copy.target = join(base, 'Ziel Sicherung');
	mkdirSync(copy.target);
	// The "account" of the first copy has the access data; the sealed backup takes them along.
	copy.env[SECRET_NAME] = SECRET_VALUE;
	const email = `rst-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64');
	const upsert = spawnSyncClean(
		join(copy.dir, 'pocketbase.exe'),
		['superuser', 'upsert', `--dir=${join(copy.dir, 'pb_data')}`, `--hooksDir=${join(copy.dir, 'pb_hooks')}`, `--migrationsDir=${join(copy.dir, 'pb_migrations')}`, '--automigrate=false', email, password],
		{ encoding: 'utf8', windowsHide: true, timeout: 60_000 }
	);
	if (upsert.status !== 0) throw new Error(`superuser upsert failed (exit code ${upsert.status})`);
	const started = control(copy, ['start']);
	if (started.code !== 0) throw new Error(`start failed: ${started.output}`);
	superuserToken = await signIn(copy.port, '_superusers', email, password);
	for (const role of ['owner', 'other']) {
		const userEmail = `rst-${role}-${randomBytes(6).toString('hex')}@example.com`;
		const userPassword = randomBytes(18).toString('base64url');
		const created = await call(copy.port, 'POST', '/api/collections/users/records', {
			token: superuserToken,
			body: { email: userEmail, password: userPassword, passwordConfirm: userPassword }
		});
		if (created.status !== 200) throw new Error(`user not created (${created.status})`);
		const user = { id: created.body.id, email: userEmail, password: userPassword, token: await signIn(copy.port, 'users', userEmail, userPassword) };
		if (role === 'owner') owner = user;
		else other = user;
	}
	await createTicket('Vor der Sicherung');
	const settings = await app('POST', '/api/byl/backup/settings', { body: { target: copy.target, daily: 7, weekly: 4, monthly: 6, credentials: true } });
	if (settings.status !== 200) throw new Error(`settings refused (${settings.status})`);
	const passphrase = await app('POST', '/api/byl/backup/passphrase', { body: { passphrase: PASSPHRASE, confirmation: PASSPHRASE } });
	if (passphrase.status !== 200) throw new Error(`passphrase refused (${passphrase.status})`);
	const made = await call(copy.port, 'POST', '/api/byl-test/backup/run', { token: superuserToken, body: { now: Date.now(), force: true } });
	if (made.status !== 200 || made.body.export?.ok !== true) throw new Error(`backup failed: ${JSON.stringify(made.body)}`);
	localName = made.body.backup;
	sealedName = made.body.export.file;
	// After the backup: what a restore takes back.
	await createTicket('Nach der Sicherung');
}, 240_000);

afterAll(() => {
	for (const target of [copy, fresh]) {
		if (target) control(target, ['stop']);
	}
	for (const left of base ? processes() : []) {
		try {
			process.kill(left.pid);
		} catch {
			// gone already
		}
	}
	if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}, 180_000);

// The cases build on each other and run in this order.
const CASE_TIMEOUT = { timeout: 300_000 };

describe('restore on disposable copies (ADR-0046 §7)', CASE_TIMEOUT, () => {
	it('refuses a restore without the word, with an unknown choice or name, from other accounts and through the page System', async () => {
		const body = { source: 'target', name: sealedName, credentials: 'missing' };
		expect(await appChange('/api/byl/backup/restore', body)).toMatchObject({ status: 400, body: { reason: 'invalid', problem: 'confirm' } });
		expect(await appChange('/api/byl/backup/restore', { ...body, confirm: 'wiederherstellen' })).toMatchObject({ status: 400, body: { problem: 'confirm' } });
		expect(await appChange('/api/byl/backup/restore', { ...body, confirm: CONFIRM, credentials: 'erfunden' })).toMatchObject({
			status: 400,
			body: { problem: 'credentials' }
		});
		expect(await appChange('/api/byl/backup/restore', { ...body, confirm: CONFIRM, name: '..\\pb_data.zip' })).toMatchObject({
			status: 400,
			body: { problem: 'name' }
		});
		// The control script finds no such backup: it refuses before it starts anything.
		const gone = await appChange('/api/byl/backup/restore', { ...body, confirm: CONFIRM, name: 'byl-20200101-000000.tar.age' });
		expect(gone).toMatchObject({ status: 400, body: { reason: 'invalid', problem: 'missing' } });
		const foreign = await call(copy.port, 'POST', '/api/byl/backup/restore', {
			token: other.token,
			origin: `http://127.0.0.1:${copy.port}`,
			body: { ...body, confirm: CONFIRM }
		});
		expect(foreign).toMatchObject({ status: 403, body: { reason: 'owner' } });
		const withoutOrigin = await call(copy.port, 'POST', '/api/byl/backup/restore', { token: owner.token, body: { ...body, confirm: CONFIRM } });
		expect(withoutOrigin).toMatchObject({ status: 403, body: { reason: 'origin' } });
		expect(await app('POST', '/api/byl/system/actions/backup-restore')).toMatchObject({ status: 404, body: { reason: 'unknown' } });
		expect(await ticketTitles(copy.port)).toEqual(['Nach der Sicherung', 'Vor der Sicherung']);
		expect(safetyCopies(copy)).toEqual([]);
	});

	it('stops at a wrong passphrase before anything changes', async () => {
		const [before] = serversOf(copy);
		const result = control(copy, ['restore', '-Json'], {
			input: { source: 'target', name: sealedName, passphrase: WRONG_PASSPHRASE, confirm: CONFIRM }
		});
		expect(result.code, result.output).toBe(1);
		expect(result.answer).toEqual({ ok: false, reason: 'passphrase', name: sealedName });
		expect(serversOf(copy).map((entry) => entry.pid)).toEqual([before.pid]);
		expect(await ticketTitles(copy.port)).toEqual(['Nach der Sicherung', 'Vor der Sicherung']);
		expect(safetyCopies(copy)).toEqual([]);
		expect(restoreState(copy)).toMatchObject({ phase: 'failed', reason: 'passphrase', name: sealedName, source: 'target' });
	});

	it('restores a sealed backup, keeps the former data as a safety copy and writes missing access data only into the account of the test', async () => {
		const [before] = serversOf(copy);
		// The account of the copy lacks the variable now (a new Windows account, say).
		const withoutSecret = { ...copy.env };
		delete withoutSecret[SECRET_NAME];
		const result = control(copy, ['restore', '-Json'], {
			env: withoutSecret,
			input: { source: 'target', name: sealedName, confirm: CONFIRM, credentials: 'missing' }
		});
		expect(result.code, result.output).toBe(0);
		expect(result.answer).toMatchObject({
			ok: true,
			name: sealedName,
			safety: expect.stringMatching(/^pb_data\.vor-wiederherstellung-\d{8}-\d{6}$/),
			credentials: { mode: 'missing', written: [SECRET_NAME], failed: false },
			config: 'kept',
			counts: { tickets: 1 }
		});
		expect(JSON.stringify(result.answer)).not.toContain(SECRET_VALUE);
		expect(await healthy(copy.port)).toBe(true);
		const [after] = serversOf(copy);
		expect(after.pid).not.toBe(before.pid);
		expect(await ticketTitles(copy.port)).toEqual(['Vor der Sicherung']);
		// The former data are the safety copy; the local backups moved into the new data folder.
		expect(safetyCopies(copy)).toEqual([result.answer.safety]);
		expect(existsSync(join(copy.dir, result.answer.safety, 'data.db'))).toBe(true);
		expect(readdirSync(join(copy.dir, 'pb_data', 'backups'))).toContain(localName);
		expect(readdirSync(copy.dir).filter((name) => name.startsWith('pb_data.neu-'))).toEqual([]);
		// Written into the file of the test (the "account"); the new server sees it by name.
		expect(account(copy)).toEqual({ [SECRET_NAME]: SECRET_VALUE });
		const seen = await call(copy.port, 'GET', `/api/byl-test/environment?names=${SECRET_NAME}`, { token: superuserToken });
		expect(seen.body).toEqual({ set: [SECRET_NAME] });
		expect(restoreState(copy)).toMatchObject({ phase: 'done', ok: true, credentials: { written: [SECRET_NAME] } });
	});

	it('goes back to the former state, access data included, when the restored app does not start', async () => {
		await createTicket('Nach der Wiederherstellung');
		const safetyBefore = safetyCopies(copy);
		const result = control(copy, ['restore', '-Json'], {
			env: { ...copy.env, [SECRET_NAME]: OTHER_VALUE, BYL_TEST_RESTORE_FAULT: 'start' },
			input: { source: 'target', name: sealedName, confirm: CONFIRM, credentials: 'all' }
		});
		expect(result.code, result.output).toBe(1);
		expect(result.answer).toEqual({ ok: false, reason: 'start', rolledBack: true, name: sealedName });
		expect(await healthy(copy.port)).toBe(true);
		expect(await ticketTitles(copy.port)).toEqual(['Nach der Wiederherstellung', 'Vor der Sicherung']);
		expect(safetyCopies(copy)).toEqual(safetyBefore);
		expect(readdirSync(join(copy.dir, 'pb_data', 'backups'))).toContain(localName);
		// "all" wrote the value of the backup; the way back the value the account had.
		expect(account(copy)).toEqual({ [SECRET_NAME]: OTHER_VALUE });
		expect(restoreState(copy)).toMatchObject({ phase: 'rolled-back', reason: 'start', safety: '' });
		// The former app started again from the process with the fault switch and would hand it on:
		// one restart with the environment of the copy.
		expect(control(copy, ['restart']).code).toBe(0);
	});

	it('restores from the page in a detached process that outlives the server, and the page finds the result after the restart', async () => {
		const [before] = serversOf(copy);
		const answer = await appChange('/api/byl/backup/restore', { source: 'local', name: localName, confirm: CONFIRM, credentials: 'none' });
		expect(answer.status, JSON.stringify(answer.body)).toBe(202);
		expect(answer.body).toEqual({ restoring: true, since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
		// A second restore while the first runs is refused.
		expect((await appChange('/api/byl/backup/restore', { source: 'local', name: localName, confirm: CONFIRM })).status).toBe(409);
		let final = null;
		const ended = await until(
			async () => {
				try {
					const state = await app('GET', '/api/byl/backup/restore');
					const restore = state.status === 200 ? state.body.restore : null;
					if (restore && restore.at >= answer.body.since && !restore.running) final = restore;
				} catch {
					// the server is away for its restart
				}
				return final !== null;
			},
			240_000,
			3000
		);
		expect(ended).toBe(true);
		expect(final, `${JSON.stringify(final)}\n${controlLog(copy)}`).toMatchObject({
			phase: 'done',
			ok: true,
			name: localName,
			source: 'local',
			credentials: { mode: 'none', written: [] }
		});
		expect(serversOf(copy).map((entry) => entry.pid)).not.toContain(before.pid);
		expect(await ticketTitles(copy.port)).toEqual(['Vor der Sicherung']);
		expect(safetyCopies(copy)).toHaveLength(2);
		const overview = await app('GET', '/api/byl/backup');
		expect(overview.body.restore).toMatchObject({ phase: 'done', running: false });
		expect(overview.body.safety.map((entry) => entry.name)).toEqual([...safetyCopies(copy)].reverse());
		expect(controlLog(copy)).toMatch(/ restore exit=0 detached=\d+ name=byl-\d{8}-\d{6}\.zip\r$/m);
	});

	it('removes safety copies after seven days and keeps newer ones', async () => {
		const old = 'pb_data.vor-wiederherstellung-20200101-000000';
		mkdirSync(join(copy.dir, old, 'storage'), { recursive: true });
		const kept = safetyCopies(copy).filter((name) => name !== old);
		const now = await call(copy.port, 'POST', '/api/byl-test/backup/prune-safety', { token: superuserToken, body: { now: Date.now() } });
		expect(now.body).toEqual({ removed: [old] });
		expect(safetyCopies(copy)).toEqual(kept);
		const later = await call(copy.port, 'POST', '/api/byl-test/backup/prune-safety', {
			token: superuserToken,
			body: { now: Date.now() + 8 * DAY }
		});
		expect([...later.body.removed].sort()).toEqual(kept);
		expect(safetyCopies(copy)).toEqual([]);
	});

	it('restores into a fresh folder without pb_data and takes the settings of the backup (new machine)', async () => {
		// The first copy ends: the backup brings its port along.
		expect(control(copy, ['stop']).code).toBe(0);
		fresh = makeCopy('Neuer Rechner', { port: copy.port, config: false });
		const result = control(fresh, ['restore', '-Json'], {
			input: { source: 'path', name: join(copy.target, sealedName), passphrase: PASSPHRASE, confirm: CONFIRM }
		});
		expect(result.code, result.output).toBe(0);
		expect(result.answer).toMatchObject({ ok: true, safety: '', config: 'taken', credentials: { mode: 'missing', written: [SECRET_NAME] } });
		expect(JSON.parse(readFileSync(join(fresh.dir, 'byl-config.json'), 'utf8'))).toEqual({
			port: copy.port,
			backup: { target: copy.target, daily: 7, weekly: 4, monthly: 6, credentials: true }
		});
		expect(serversOf(fresh)).toHaveLength(1);
		expect(await healthy(copy.port)).toBe(true);
		const token = await signIn(copy.port, 'users', owner.email, owner.password);
		expect(await ticketTitles(copy.port, token)).toEqual(['Vor der Sicherung']);
		expect(account(fresh)).toEqual({ [SECRET_NAME]: SECRET_VALUE });
		expect(readdirSync(fresh.dir).filter((name) => name.startsWith('pb_data.'))).toEqual([]);
	});

	it('logs names and numbers only, never values or the passphrase', () => {
		const log = controlLog(copy);
		expect(log).toMatch(/ restore exit=1 name=byl-\d{8}-\d{6}\.tar\.age ok=false reason=passphrase\r$/m);
		expect(log).toMatch(
			new RegExp(` restore exit=0 name=byl-\\d{8}-\\d{6}\\.tar\\.age ok=true safety=pb_data\\.vor-wiederherstellung-\\d{8}-\\d{6} credentials=missing written=1 config=kept${BREAKS}\\r$`, 'm')
		);
		expect(log).toMatch(new RegExp(` restore exit=1 name=byl-\\d{8}-\\d{6}\\.tar\\.age ok=false reason=start rolled-back${BREAKS}\\r$`, 'm'));
		expect(log).toMatch(new RegExp(` restore exit=0 name=byl-\\d{8}-\\d{6}\\.zip ok=true safety=pb_data\\.vor-wiederherstellung-\\d{8}-\\d{6} credentials=none written=0 config=kept${BREAKS}\\r$`, 'm'));
		expect(controlLog(fresh)).toMatch(/ restore exit=0 name=byl-\d{8}-\d{6}\.tar\.age ok=true safety= credentials=missing written=1 config=taken\r$/m);
		const logs = [copy, fresh].flatMap((target) =>
			readdirSync(join(target.dir, 'logs')).map((file) => readFileSync(join(target.dir, 'logs', file), 'latin1'))
		);
		const states = [copy, fresh].map((target) => readFileSync(join(target.dir, 'run', 'wiederherstellung.json'), 'utf8'));
		for (const value of [SECRET_VALUE, OTHER_VALUE, PASSPHRASE, WRONG_PASSPHRASE]) {
			expect([...logs, ...states].join('\n')).not.toContain(value);
		}
	});
});
