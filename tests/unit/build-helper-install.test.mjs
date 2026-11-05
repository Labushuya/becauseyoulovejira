// Only a changed helper replaces the installed one (ADR-0039, addendum BW-2a). Two builds of the
// same sources give the same bytes, so scripts/build-mail-helper.ps1 and build-backup-helper.ps1
// leave app\byl-mail.exe and app\byl-backup.exe untouched, last write time included, when the new
// build has their SHA-256: the start fingerprint (Get-FileStamp, length and last write time of
// byl-mail.exe) then sees no new helper, and the page "System" asks for no restart. A missing helper
// is installed, a changed one replaced, a running one renamed first (AR-4), and a file another
// program holds still fails into helper-install. The static parts run everywhere; Install-BylHelper
// of scripts/build-functions.ps1 runs in Windows PowerShell on folders of this test under the temp
// folder, never on the helpers of the repository.

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnClean } from '../support/clean-env.mjs';
import { runPowerShellJson } from '../support/powershell.mjs';
import { scaled } from '../support/timing.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'scripts', 'build-functions.ps1');
const read = (path) => readFileSync(join(ROOT_DIR, path), 'utf8');
// The way in the browser first (BW-2), the file of the folder app only as the emergency way.
const MAIL_HINT =
	'The new version runs after the next restart (in the browser: Einstellungen > System > "Jetzt neu starten"; emergency: app\\neu-starten.bat).';
const OLD_NAME = /^byl-mail\.exe\.old-\d{14}$/;

/** Body of a PowerShell function, up to the next top-level function. */
function functionBody(source, name) {
	const start = source.indexOf(`function ${name} {`);
	if (start < 0) throw new Error(`function ${name} not found`);
	const next = source.indexOf('\nfunction ', start + 1);
	return source.slice(start, next < 0 ? undefined : next);
}

describe('installing a built helper (static)', () => {
	it('both helper builds put their file into place only through Install-BylHelper, an error as helper-install', () => {
		for (const [script, call] of [
			['scripts/build-mail-helper.ps1', `[void](Install-BylHelper -Built $built -Target $target -RunningHint '${MAIL_HINT}')`],
			['scripts/build-backup-helper.ps1', '[void](Install-BylHelper -Built $built -Target $target)']
		]) {
			const source = read(script);
			const install = source.indexOf(call);
			expect(install, script).toBeGreaterThan(0);
			expect(source.match(/Install-BylHelper/g), script).toHaveLength(1);
			// After the check without Node and the removal of leftovers, inside the try of helper-install.
			expect(install, script).toBeGreaterThan(source.indexOf("Invoke-WithoutNode -Arguments '--self-test'"));
			expect(install, script).toBeGreaterThan(source.indexOf('Remove-BylHelperLeftover -AppDir $appDir'));
			expect(source.slice(install), script).toMatch(/^[^\n]*\r?\n\s+\}\r?\n\s+catch \{\r?\n\s+exit \(Write-BylBuildProblem -Code 'helper-install' /);
			expect(source, script).not.toMatch(/(Remove-Item|Rename-Item|Copy-Item) -LiteralPath \$target/);
		}
	});

	it('compares the SHA-256 before it removes, renames or copies anything', () => {
		const body = functionBody(read('scripts/build-functions.ps1'), 'Install-BylHelper');
		const compare = body.indexOf('-Algorithm SHA256');
		expect(compare).toBeGreaterThan(0);
		expect(body.indexOf("return 'Unchanged'")).toBeGreaterThan(compare);
		for (const step of ['Remove-Item', 'Rename-Item', 'Copy-Item']) {
			expect(body.indexOf(step), step).toBeGreaterThan(body.indexOf("return 'Unchanged'"));
		}
	});
});

describe.skipIf(process.platform !== 'win32')('Install-BylHelper in Windows PowerShell', { timeout: scaled(60_000) }, () => {
	// Per case: the stamp of the start fingerprint before and after (Get-FileStamp of
	// app/byl-functions.ps1, as for mailHelper), the result, the printed lines (yellow or not), the
	// error and the files next to the target afterwards.
	const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
# Windows PowerShell passes the array of ConvertFrom-Json on as one object; foreach takes it apart.
$cases = $env:BYL_TEST_INPUT | ConvertFrom-Json
$results = foreach ($case in $cases) {
    $entry = [ordered]@{ before = (Get-FileStamp -Path $case.target); result = ''; lines = @(); error = ''; after = ''; files = @() }
    $held = $null
    try {
        # Open without sharing deletion, like a file another program holds (not a running helper).
        if ($case.hold) { $held = [System.IO.File]::Open($case.target, 'Open', 'Read', 'Read') }
        $output = @(Install-BylHelper -Built $case.built -Target $case.target -RunningHint $case.hint 6>&1)
        $entry.result = @($output | Where-Object { $_ -is [string] }) -join ','
        # Without -ForegroundColor, Write-Host records the colour of the console; only yellow counts.
        $entry.lines = @($output | Where-Object { $_ -is [System.Management.Automation.InformationRecord] } | ForEach-Object { [ordered]@{ text = [string]$_.MessageData.Message; yellow = ($_.MessageData.ForegroundColor -eq [ConsoleColor]::Yellow) } })
    }
    catch {
        $entry.error = $_.Exception.Message
    }
    finally {
        if ($null -ne $held) { $held.Dispose() }
    }
    $entry.after = Get-FileStamp -Path $case.target
    $entry.files = @([System.IO.Directory]::GetFiles([System.IO.Path]::GetDirectoryName($case.target)) | ForEach-Object { [System.IO.Path]::GetFileName($_) })
    $entry
}
ConvertTo-Json -InputObject @($results) -Depth 4 -Compress
`;
	// A time long before the test, so a copy shows in the stamp.
	const EARLIER = new Date('2026-01-02T03:04:05.000Z');
	let base;
	let running;

	/** A folder `name` with the build `built` of the helper `helper` and, unless null, the installed file `installed`. */
	function folder(name, helper, built, installed) {
		const dir = join(base, name);
		mkdirSync(join(dir, 'dist'), { recursive: true });
		mkdirSync(join(dir, 'app'));
		const paths = { built: join(dir, 'dist', helper), target: join(dir, 'app', helper) };
		writeFileSync(paths.built, built);
		if (installed !== null) {
			writeFileSync(paths.target, installed);
			utimesSync(paths.target, EARLIER, EARLIER);
		}
		return paths;
	}

	function install(cases) {
		return runPowerShellJson(SCRIPT, cases.map((entry) => ({ hint: '', hold: false, ...entry })), { BYL_FUNCTIONS: FUNCTIONS_FILE });
	}

	beforeAll(() => {
		base = mkdtempSync(join(tmpdir(), 'byl-helper-install-'));
	});
	afterAll(async () => {
		// The copy of Node of the last case, should the case have ended before its own finally.
		if (running) {
			running.child.kill();
			await running.exited;
		}
		if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
	});

	it('leaves a helper with the same content untouched, its last write time and the stamp of the fingerprint included', () => {
		const mail = folder('gleich-mail', 'byl-mail.exe', 'byl-mail 0.9.1 gleich', 'byl-mail 0.9.1 gleich');
		const backup = folder('gleich-backup', 'byl-backup.exe', 'byl-backup 1.0.0 gleich', 'byl-backup 1.0.0 gleich');
		const [first, second] = install([{ ...mail, hint: MAIL_HINT }, backup]);

		expect(first.error).toBe('');
		expect(first.result).toBe('Unchanged');
		expect(first.before).toMatch(/^21:\d+$/);
		expect(first.after).toBe(first.before);
		expect(first.lines).toEqual([{ text: 'app\\byl-mail.exe unchanged (same SHA-256 as the new build), not replaced.', yellow: false }]);
		expect(first.files).toEqual(['byl-mail.exe']);
		expect(statSync(mail.target).mtimeMs).toBe(EARLIER.getTime());
		expect(readFileSync(mail.target, 'utf8')).toBe('byl-mail 0.9.1 gleich');

		expect(second.result).toBe('Unchanged');
		expect(second.after).toBe(second.before);
		expect(second.lines).toEqual([{ text: 'app\\byl-backup.exe unchanged (same SHA-256 as the new build), not replaced.', yellow: false }]);
		expect(statSync(backup.target).mtimeMs).toBe(EARLIER.getTime());
	});

	it('replaces a changed helper, also one of the same length, and installs a missing one', () => {
		const changed = folder('geaendert', 'byl-mail.exe', 'byl-mail 0.9.2', 'byl-mail 0.9.1');
		const missing = folder('fehlt', 'byl-backup.exe', 'byl-backup 1.0.0', null);
		const [replaced, installed] = install([{ ...changed, hint: MAIL_HINT }, missing]);

		expect(replaced.error).toBe('');
		expect(replaced.result).toBe('Replaced');
		// Same length: only the time tells the fingerprint, and it changed with the copy.
		expect(replaced.after).not.toBe(replaced.before);
		expect(replaced.after.split(':')[0]).toBe(replaced.before.split(':')[0]);
		expect(replaced.lines).toEqual([{ text: 'Replaced app\\byl-mail.exe (0 MB).', yellow: false }]);
		expect(replaced.files).toEqual(['byl-mail.exe']);
		expect(readFileSync(changed.target, 'utf8')).toBe('byl-mail 0.9.2');
		expect(statSync(changed.target).mtimeMs).not.toBe(EARLIER.getTime());

		expect(installed.error).toBe('');
		expect(installed.result).toBe('Installed');
		expect(installed.before).toBe('');
		expect(installed.after).toMatch(/^16:\d+$/);
		expect(installed.lines).toEqual([{ text: 'Installed app\\byl-backup.exe (0 MB).', yellow: false }]);
		expect(readFileSync(missing.target, 'utf8')).toBe('byl-backup 1.0.0');
	});

	it('keeps the way of a locked file: a running helper is renamed only when it changed, a held file fails as before', async () => {
		// The running helper: a copy of this Node as app\byl-mail.exe of a folder of the test, and a
		// build with the same bytes.
		const paths = folder('laeuft', 'byl-mail.exe', 'byl-mail 0.9.2', null);
		const same = join(base, 'laeuft', 'dist', 'gleich.exe');
		copyFileSync(process.execPath, paths.target);
		copyFileSync(process.execPath, same);
		const child = spawnClean(paths.target, ['-e', "process.stdout.write('bereit\\n'); setInterval(() => {}, 1000);"], {
			stdio: ['ignore', 'pipe', 'ignore'],
			windowsHide: true
		});
		running = {
			child,
			exited: new Promise((resolvePromise) => {
				child.once('exit', resolvePromise);
				child.once('error', resolvePromise);
			})
		};
		await new Promise((resolvePromise, reject) => {
			const timer = setTimeout(() => reject(new Error('the copy of Node did not start')), scaled(30_000));
			child.once('error', (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.stdout.on('data', (chunk) => {
				if (String(chunk).includes('bereit')) {
					clearTimeout(timer);
					resolvePromise();
				}
			});
		});
		const held = folder('gehalten', 'byl-mail.exe', 'byl-mail 0.9.2', 'byl-mail 0.9.1');

		let results;
		try {
			results = install([
				{ built: same, target: paths.target, hint: MAIL_HINT },
				{ built: paths.built, target: paths.target, hint: MAIL_HINT },
				{ ...held, hint: MAIL_HINT, hold: true }
			]);
		}
		finally {
			child.kill();
			await running.exited;
		}
		const [unchanged, renamed, failed] = results;

		// Same bytes while it runs: nothing renamed, nothing copied.
		expect(unchanged.error).toBe('');
		expect(unchanged.result).toBe('Unchanged');
		expect(unchanged.after).toBe(unchanged.before);
		expect(unchanged.files).toEqual(['byl-mail.exe']);

		// Changed while it runs: renamed to <name>.old-<time> (AR-4), then the new file, as before.
		expect(renamed.error).toBe('');
		expect(renamed.result).toBe('Replaced');
		const old = renamed.files.filter((name) => OLD_NAME.test(name));
		expect(old).toHaveLength(1);
		expect([...renamed.files].sort()).toEqual(['byl-mail.exe', old[0]].sort());
		expect(renamed.lines).toEqual([
			{ text: `app\\byl-mail.exe is running; the old file is now app\\${old[0]}. ${MAIL_HINT}`, yellow: true },
			{ text: 'Replaced app\\byl-mail.exe (0 MB).', yellow: false }
		]);
		expect(readFileSync(paths.target, 'utf8')).toBe('byl-mail 0.9.2');
		expect(statSync(join(base, 'laeuft', 'app', old[0])).size).toBe(statSync(process.execPath).size);

		// Held by another program: neither removed nor renamed; the error goes to the caller
		// (helper-install), the file stays as it was.
		expect(failed.result).toBe('');
		expect(failed.error).not.toBe('');
		expect(failed.lines).toEqual([]);
		expect(failed.after).toBe(failed.before);
		expect(failed.files).toEqual(['byl-mail.exe']);
		expect(readFileSync(held.target, 'utf8')).toBe('byl-mail 0.9.1');
		expect(readdirSync(join(base, 'gehalten', 'app'))).toEqual(['byl-mail.exe']);
	});
});
