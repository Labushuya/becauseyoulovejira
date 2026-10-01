// Page "Einstellungen → Speicher" against a disposable copy of the app folder (ADR-0047 §6 to §9,
// SPE-2): only the own instance of a folder app under Windows shows program files, leftovers of
// updates, safety copies, logs and the free space (from byl-control.ps1 doctor of the copy), and only
// there does "Liegengebliebenes aufräumen" remove program leftovers and expired safety copies.
// Everything happens ONLY in a copy under .tmp\byl-storage-* of the repo, with a superuser created
// beforehand (CLAUDE.md §11.2), a random port (never 8090 or 8099) and a clean environment with
// BYL_TEST_ISOLATED=1 (tests/support/clean-env.mjs). app\ and the instance of the user are never
// started, stopped or asked. The server of the copy ends in afterAll, and the copy is removed.

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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSyncClean } from '../support/clean-env.mjs';
import { POCKETBASE_EXE } from '../support/pocketbase-harness.mjs';
import { POWERSHELL_EXE } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(ROOT_DIR, 'app');
const TEMP_ROOT = join(ROOT_DIR, '.tmp');
const RESERVED_PORTS = new Set([8090, 8091, 8099]);
const COMMAND_TIMEOUT_MS = 60_000;
const LEFTOVERS = ['byl-mail.exe.old-20260101000000', 'byl-backup.exe.old-20260101000000'];
const EXPIRED = 'pb_data.vor-wiederherstellung-20200101-000000';

let CONTROL_ENV;
let base;
let copy;
let owner;

async function freePort() {
	for (;;) {
		const probe = createServer();
		await new Promise((done) => probe.listen(0, '127.0.0.1', done));
		const { port } = probe.address();
		await new Promise((done) => probe.close(done));
		if (!RESERVED_PORTS.has(port)) return port;
	}
}

function call(method, path, { token, origin, body } = {}) {
	return new Promise((done, fail) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const req = request(
			{
				host: '127.0.0.1',
				port: copy.port,
				path,
				method,
				agent: false,
				timeout: 90_000,
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

const app = (method, path, options = {}) =>
	call(method, path, { token: owner, origin: method === 'POST' ? `http://127.0.0.1:${copy.port}` : undefined, ...options });

let outputs = 0;

/** byl-control.ps1 of the copy, never without -NoBrowser, with a clean environment. */
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

async function authToken(collection, email, password) {
	const answer = await call('POST', `/api/collections/${collection}/auth-with-password`, { body: { identity: email, password } });
	if (answer.status !== 200) throw new Error(`sign-in failed (${answer.status})`);
	return answer.body.token;
}

/** A folder of the safety copy `name` next to pb_data with one file of `bytes` bytes. */
function safetyCopy(name, bytes) {
	mkdirSync(join(copy.dir, name, 'storage'), { recursive: true });
	writeFileSync(join(copy.dir, name, 'data.db'), Buffer.alloc(bytes));
}

/** pb_data.vor-wiederherstellung-<UTC now>: a safety copy that is not expired. */
function freshName() {
	const now = new Date().toISOString();
	return `pb_data.vor-wiederherstellung-${now.slice(0, 10).replaceAll('-', '')}-${now.slice(11, 19).replaceAll(':', '')}`;
}

beforeAll(async () => {
	// Not in %TEMP%: PocketBase takes a program there for "go run" and switches to its dev mode.
	mkdirSync(TEMP_ROOT, { recursive: true });
	base = realpathSync.native(mkdtempSync(join(TEMP_ROOT, 'byl-storage-')));
	// Guard: everything happens below .tmp of this worktree, never in app\ of this or another folder.
	expect(base.toLowerCase().startsWith(`${realpathSync.native(TEMP_ROOT).toLowerCase()}\\byl-storage-`)).toBe(true);
	expect(base.toLowerCase().startsWith(APP_DIR.toLowerCase())).toBe(false);
	const dir = join(base, 'Kopie Speicher', 'app');
	mkdirSync(join(dir, 'pb_public'), { recursive: true });
	for (const file of ['byl-control.ps1', 'byl-functions.ps1']) copyFileSync(join(APP_DIR, file), join(dir, file));
	copyFileSync(POCKETBASE_EXE, join(dir, 'pocketbase.exe'));
	cpSync(join(APP_DIR, 'pb_hooks'), join(dir, 'pb_hooks'), { recursive: true });
	cpSync(join(APP_DIR, 'pb_migrations'), join(dir, 'pb_migrations'), { recursive: true });
	writeFileSync(join(dir, 'pb_public', 'index.html'), '<!doctype html><title>test</title>');
	const port = await freePort();
	writeFileSync(join(dir, 'byl-config.json'), JSON.stringify({ port }));
	CONTROL_ENV = { BYL_TEST_ISOLATED: '1', BYL_TEST_STARTUP_DIR: join(base, 'startup') };
	mkdirSync(CONTROL_ENV.BYL_TEST_STARTUP_DIR);
	const email = `speicher-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64');
	const upsert = spawnSyncClean(
		join(dir, 'pocketbase.exe'),
		['superuser', 'upsert', `--dir=${join(dir, 'pb_data')}`, `--hooksDir=${join(dir, 'pb_hooks')}`, `--migrationsDir=${join(dir, 'pb_migrations')}`, '--automigrate=false', email, password],
		{ encoding: 'utf8', windowsHide: true, timeout: 60_000 }
	);
	if (upsert.status !== 0) throw new Error(`superuser upsert failed (exit code ${upsert.status})`);
	copy = { dir, port };
	const started = control('start');
	if (started.code !== 0) throw new Error(`start failed: ${started.output}`);
	const superuser = await authToken('_superusers', email, password);
	const userEmail = `speicher-${randomBytes(6).toString('hex')}@example.com`;
	const userPassword = randomBytes(18).toString('base64url');
	const created = await call('POST', '/api/collections/users/records', {
		token: superuser,
		body: { email: userEmail, password: userPassword, passwordConfirm: userPassword }
	});
	if (created.status !== 200) throw new Error(`user not created (${created.status})`);
	owner = await authToken('users', userEmail, userPassword);
	for (const name of LEFTOVERS) writeFileSync(join(dir, name), Buffer.alloc(1234));
}, 180_000);

afterAll(() => {
	if (copy) control('stop');
	if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}, 120_000);

// Windows only (WINDOWS_ONLY in vitest.config.mjs): the copy runs byl-control.ps1.
describe('page Speicher on a disposable copy (ADR-0047)', { timeout: 120_000 }, () => {
	it('shows program files, leftovers, safety copies, logs and the free space of its own instance', async () => {
		safetyCopy(EXPIRED, 300);
		const fresh = freshName();
		safetyCopy(fresh, 200);
		const answer = await app('GET', '/api/byl/storage');
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		const overview = answer.body;
		expect(overview.own_instance).toBe(true);
		expect(overview.program.files.count).toBe(1);
		expect(overview.program.leftovers).toMatchObject({ count: 2, bytes: 2468 });
		expect(overview.program.web.bytes).toBeGreaterThan(0);
		expect(overview.logs).not.toBeNull();
		expect(overview.disk.text).toMatch(/MB frei/);
		expect(overview.backups.safety.count).toBeGreaterThanOrEqual(1);
		expect(overview.actions.leftovers.programs).toMatchObject({ count: 2, bytes: 2468 });
		expect(existsSync(join(copy.dir, fresh))).toBe(true);
	});

	it('removes program leftovers and expired safety copies, never a fresh one', async () => {
		safetyCopy(EXPIRED, 300);
		const fresh = freshName();
		safetyCopy(fresh, 200);
		const answer = await app('POST', '/api/byl/storage/actions/leftovers', { body: { groups: ['programs', 'safety'] } });
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		expect(answer.body.result.removed.programs).toEqual({ count: 2, bytes: 2468 });
		expect(answer.body.result.skipped).toEqual([]);
		for (const name of LEFTOVERS) expect(existsSync(join(copy.dir, name)), name).toBe(false);
		expect(existsSync(join(copy.dir, EXPIRED))).toBe(false);
		expect(existsSync(join(copy.dir, fresh))).toBe(true);
		expect(existsSync(join(copy.dir, 'pocketbase.exe'))).toBe(true);
	});
});
