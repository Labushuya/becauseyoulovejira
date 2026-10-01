// Admin reset (admin-zuruecksetzen.bat, E1.1) against an own disposable data folder: the real
// Invoke-AdminUpsert of app/byl-functions.ps1 runs pocketbase.exe on a copy of the app layout
// (pb_data, pb_hooks, pb_migrations in one folder). The batch file itself is never executed.
//
// Order: the reset creates the first superuser in the still empty folder (as after a missed
// installer), the harness starts the server on the same folder, then the reset runs again while
// the server is running (new password, second admin). App data must survive every step.

import { randomBytes } from 'node:crypto';
import { cp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POCKETBASE_EXE, startPocketBase } from '../support/pocketbase-harness.mjs';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');

const UPSERT_SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
Invoke-AdminUpsert -ExePath $in.exe -AppDir $in.appDir -Email $in.email -Password $in.password -TimeoutSeconds 30 |
    ConvertTo-Json -Compress
`;

/** A password that needs every kind of quoting: leading dash, spaces, backslashes, umlaut. */
function trickyPassword() {
	return `-Start ${randomBytes(6).toString('hex')} ä \\x\\`;
}

function adminEmail() {
	return `admin-${randomBytes(6).toString('hex')}@example.com`;
}

function resetAdmin(appDir, email, password) {
	return runPowerShellJson(
		UPSERT_SCRIPT,
		{ exe: POCKETBASE_EXE, appDir, email, password },
		{ BYL_FUNCTIONS: FUNCTIONS_FILE }
	);
}

async function superuserLogin(url, email, password) {
	const client = new PocketBase(url);
	client.autoCancellation(false);
	try {
		await client.collection('_superusers').authWithPassword(email, password);
		return 200;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return error.status;
	}
}

let instance;
let appDir;
const first = { email: adminEmail(), password: trickyPassword() };
let firstReset;

beforeAll(async () => {
	instance = await startPocketBase({
		prepareDataDir: async (dataDir) => {
			appDir = dirname(dataDir);
			await cp(join(ROOT_DIR, 'app', 'pb_hooks'), join(appDir, 'pb_hooks'), { recursive: true });
			await cp(join(ROOT_DIR, 'app', 'pb_migrations'), join(appDir, 'pb_migrations'), {
				recursive: true
			});
			firstReset = resetAdmin(appDir, first.email, first.password);
		}
	});
});

afterAll(async () => {
	await instance?.stop();
});

describe('admin reset', () => {
	it('creates the first admin in a folder without data and never echoes the password', async () => {
		expect(firstReset.ExitCode, firstReset.Output).toBe(0);
		expect(firstReset.Output).toContain(`Successfully saved superuser "${first.email}"`);
		expect(firstReset.Output).not.toContain(first.password);

		expect(await superuserLogin(instance.url, first.email, first.password)).toBe(200);
	});

	it('sets a new password and adds an admin while the server runs, keeping app data', async () => {
		const admin = new PocketBase(instance.url);
		admin.autoCancellation(false);
		await admin.collection('_superusers').authWithPassword(first.email, first.password);
		const appUser = {
			email: `user-${randomBytes(6).toString('hex')}@example.com`,
			password: randomBytes(18).toString('base64url')
		};
		await admin
			.collection('users')
			.create({ ...appUser, passwordConfirm: appUser.password });

		const newPassword = trickyPassword();
		const changed = resetAdmin(appDir, first.email, newPassword);
		const second = { email: adminEmail(), password: trickyPassword() };
		const added = resetAdmin(appDir, second.email, second.password);

		expect(changed.ExitCode, changed.Output).toBe(0);
		expect(added.ExitCode, added.Output).toBe(0);
		expect(await superuserLogin(instance.url, first.email, newPassword)).toBe(200);
		expect(await superuserLogin(instance.url, first.email, first.password)).toBe(400);
		expect(await superuserLogin(instance.url, second.email, second.password)).toBe(200);

		const user = new PocketBase(instance.url);
		const auth = await user.collection('users').authWithPassword(appUser.email, appUser.password);
		expect(auth.record.email).toBe(appUser.email);
	});

	it('reports a failure with the password redacted', () => {
		const password = trickyPassword();
		const failed = resetAdmin(appDir, 'kein-gueltiger-name', password);

		expect(failed.ExitCode).not.toBe(0);
		expect(failed.Output).not.toContain(password);
	});
});
