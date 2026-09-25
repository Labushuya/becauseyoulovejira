// Static checks of the start, stop and autostart scripts in app/ (E1 plan, package 8). The
// scripts are never executed by agents or tests (CLAUDE.md section 11.3); the logic behind them
// is covered by start-logic.test.mjs.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(ROOT_DIR, 'app');
const SCRIPTS_DIR = join(ROOT_DIR, 'scripts');

const WRAPPERS = {
	'start.bat': 'Start',
	'stop.bat': 'Stop',
	'autostart-an.bat': 'AutostartOn',
	'autostart-aus.bat': 'AutostartOff',
	'admin-zuruecksetzen.bat': 'ResetAdmin'
};
const APP_SCRIPTS = [...Object.keys(WRAPPERS), 'start-hidden.vbs', 'byl-control.ps1', 'byl-functions.ps1'];
const POWERSHELL_FILES = [
	...['byl-control.ps1', 'byl-functions.ps1'].map((name) => join(APP_DIR, name)),
	...readdirSync(SCRIPTS_DIR)
		.filter((name) => name.endsWith('.ps1'))
		.map((name) => join(SCRIPTS_DIR, name))
];

// The only allowed wait: stop.bat shows its success message for 5 s (a key ends it at once).
const STOP_CLOSE_LINE = 'if "%BYL_EXIT%"=="0" (timeout /t 5 2>nul) else (pause)';

const read = (name) => readFileSync(join(APP_DIR, name), 'utf8').replace(/^﻿/, '');
const control = () => read('byl-control.ps1');
const functions = () => read('byl-functions.ps1');

/** Body of a PowerShell function, up to the next top-level function. */
function functionBody(source, name) {
	const start = source.indexOf(`function ${name} {`);
	if (start < 0) throw new Error(`function ${name} not found`);
	const next = source.indexOf('\nfunction ', start + 1);
	return source.slice(start, next < 0 ? undefined : next);
}

describe('wrappers', () => {
	it.each(Object.entries(WRAPPERS))(
		'%s calls byl-control.ps1 -Action %s with -NoProfile -ExecutionPolicy Bypass',
		(name, action) => {
			const lines = read(name)
				.split(/\r\n/)
				.filter((line) => /powershell/i.test(line) && !/^\s*rem\b/i.test(line));
			expect(lines).toEqual([
				`"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" -Action ${action}`
			]);
		}
	);

	it('start-hidden.vbs starts the control script hidden with -NoProfile -ExecutionPolicy Bypass', () => {
		const source = read('start-hidden.vbs');
		expect(source).toContain('WScript.ScriptFullName');
		expect(source).toContain('"byl-control.ps1"');
		expect(source).toMatch(/" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "/);
		expect(source).toContain('" -Action Start -Hidden"');
		expect(source).toMatch(/shell\.Run\(command, 0, True\)/);
	});

	it.each(APP_SCRIPTS)('%s has CRLF line endings', (name) => {
		const raw = readFileSync(join(APP_DIR, name), 'utf8');
		expect(raw).toContain('\r\n');
		expect(raw.replace(/\r\n/g, '')).not.toContain('\n');
	});

	it.each([...Object.keys(WRAPPERS), 'start-hidden.vbs', 'byl-functions.ps1'])(
		'%s is plain ASCII (cmd and WSH read the ANSI code page)',
		(name) => {
			expect(readFileSync(join(APP_DIR, name), 'utf8')).toMatch(/^[\x00-\x7F]*$/);
		}
	);

	it('byl-control.ps1 has a UTF-8 BOM (Windows PowerShell 5.1 reads BOM-less files as ANSI)', () => {
		expect(readFileSync(join(APP_DIR, 'byl-control.ps1'))[0]).toBe(0xef);
	});

	it.each(APP_SCRIPTS)('%s has no absolute paths and no credentials', (name) => {
		const source = read(name);
		expect(source).not.toMatch(/\b[A-Za-z]:[\\/]/);
		expect(source).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
	});

	it.each(APP_SCRIPTS)(
		'%s builds a superuser command only in Get-AdminUpsertArgument, from runtime input',
		(name) => {
			let source = read(name);
			if (name === 'byl-functions.ps1') {
				const body = functionBody(source, 'Get-AdminUpsertArgument');
				expect(body).toMatch(/'superuser', 'upsert'/);
				expect(body).toMatch(/'--', \$Email, \$Password\s*\)/);
				source = source.replace(body, '');
			}
			expect(source).not.toMatch(/superuser['",\s]+(upsert|create)/i);
		}
	);

	it.each(APP_SCRIPTS)('%s uses neither wmic nor taskkill by image name', (name) => {
		const source = read(name);
		expect(source).not.toMatch(/\bwmic\b/i);
		expect(source).not.toMatch(/taskkill[^\r\n]*\/IM\b/i);
	});

	it('the old helper autostart-create.ps1 is gone', () => {
		expect(readdirSync(APP_DIR)).not.toContain('autostart-create.ps1');
	});
});

describe('start', () => {
	it('has no fixed waiting time (only stop.bat keeps its message readable)', () => {
		for (const name of APP_SCRIPTS) {
			const source = read(name).replace(STOP_CLOSE_LINE, '');
			expect(source, name).not.toMatch(/\btimeout(\.exe)?\s+\/t\b/i);
			expect(source, name).not.toMatch(/\bping(\.exe)?\s+-n\b/i);
			expect(source, name).not.toMatch(/Start-Sleep\s+(-Seconds\s+)?\d/i);
			expect(source, name).not.toMatch(/WScript\.Sleep/i);
		}
	});

	it('polls /api/health with a timeout', () => {
		expect(functions()).toContain("'http://127.0.0.1:8090/api/health'");
		expect(functionBody(functions(), 'Wait-ServerReady')).toMatch(/Test-Health/);
		expect(functionBody(control(), 'Invoke-Start')).toMatch(
			/Wait-ServerReady -Process \$server -TimeoutSeconds \$HealthTimeoutSeconds/
		);
		expect(control()).toMatch(/\$HealthTimeoutSeconds = 30\b/);
	});

	it('checks the port before starting and aborts for a foreign owner', () => {
		const body = functionBody(control(), 'Invoke-Start');
		expect(body.indexOf('Resolve-PortState')).toBeLessThan(body.indexOf('Start-Process -FilePath $exe'));
		expect(body).toMatch(/'Foreign'\)[\s\S]*?return 1/);
		expect(functions()).toMatch(/Get-NetTCPConnection -State Listen/);
		expect(functions()).toMatch(/Get-CimInstance -ClassName Win32_Process/);
	});

	it('starts the server with the arguments from Get-ServerArgumentString', () => {
		expect(functionBody(control(), 'Invoke-Start')).toMatch(
			/Start-Process -FilePath \$exe -ArgumentList \(Get-ServerArgumentString -AppDir \$AppDir\)/
		);
	});

	it('hands the BYL_* variables of the user scope to the server without printing them', () => {
		const start = functionBody(control(), 'Invoke-Start');
		expect(start.indexOf('Sync-BylEnvironment')).toBeGreaterThan(-1);
		expect(start.indexOf('Sync-BylEnvironment')).toBeLessThan(start.indexOf('Start-Process -FilePath $exe'));
		const sync = functionBody(control(), 'Sync-BylEnvironment');
		expect(sync).toContain("GetEnvironmentVariables('User')");
		expect(sync).toMatch(/Get-BylEnvironmentChange/);
		expect(sync).not.toMatch(/Write-|Show-Message|Out-|Add-Content|Set-Content/);
	});

	it('has a first-run branch that opens no second tab', () => {
		const body = functionBody(control(), 'Invoke-Start');
		const firstRun = body.slice(body.indexOf('if (Wait-FirstRunSignal'));
		const branch = firstRun.slice(0, firstRun.indexOf('return 2') + 'return 2'.length);
		expect(branch).toContain('$FirstRunHint');
		expect(branch).not.toContain('Open-App');
		expect(body.indexOf('if (Wait-FirstRunSignal')).toBeLessThan(body.lastIndexOf('Open-App'));
		// The link is shown, never opened a second time (PocketBase opened it already).
		expect(branch).toContain(
			'Wait-InstallerLink -ReadLog { Read-ServerLog } -ProcessStartUtc (Get-ProcessStartUtc -Process $server)'
		);
		expect(branch).not.toContain('Start-Process');
	});

	it('opens a still working installer link of the running instance once and pauses', () => {
		const body = functionBody(control(), 'Invoke-Start');
		const running = body.slice(body.indexOf("if ($port.State -eq 'App')"));
		const branch = running.slice(0, running.indexOf('return 2') + 'return 2'.length);
		expect(branch).toContain('$link = Get-PendingInstallerLink -ProcessId $port.ProcessId');
		expect(branch).toContain('$PendingSetupHint');
		expect(branch.match(/Start-Process/g)).toHaveLength(1);
		expect(branch).toMatch(/Start-Process -FilePath \$link\.Url\r\n\s*return 2$/);
		expect(branch).not.toContain('Open-App');

		const pending = functionBody(control(), 'Get-PendingInstallerLink');
		expect(pending).toContain('Get-InstallerLink -LogText (Read-ServerLog) -ProcessStartUtc $startUtc');
		expect(pending).toContain('Test-InstallerPending -Token $link.Token');
		const hint = control().match(/\$PendingSetupHint = @"\r\n([\s\S]*?)\r\n"@/)[1];
		expect(hint).toContain('{0} Uhr');
		expect(hint).toContain('{1}');
		expect(hint).toContain('$MissedLinkHint');
	});

	it('only opens links it rebuilt on the fixed binding', () => {
		const body = functionBody(functions(), 'Get-InstallerLink');
		expect(body).toContain('Url        = "$($BylAppUrl)_/#/pbinstall/$token"');
		expect(body).toContain(String.raw`'/_/#/pbinstall/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)'`);
	});

	it('the first-run hint matches the login page', () => {
		const hint = control().match(/\$FirstRunHint = @"\r\n([\s\S]*?)\r\n"@/)[1];
		expect(hint).toContain('Erster Start');
		expect(hint).toContain('Admin-Konto');
		expect(hint).toContain('_/)');
		expect(hint).toContain('„users“');
		expect(hint).toContain('30 Minuten');
		expect(hint).toContain('$MissedLinkHint');
		expect(control()).toContain(
			"$MissedLinkHint = 'Link verpasst oder abgelaufen? admin-zuruecksetzen.bat legt ein Admin-Konto an, ohne Daten zu löschen.'"
		);
		const login = readFileSync(join(ROOT_DIR, 'web', 'src', 'routes', 'login', '+page.svelte'), 'utf8');
		expect(login).toContain('href="/_/"');
		expect(login).toContain('Verwaltung (nur Admin)');
	});

	it('start.bat pauses on errors and on the first-run hint only', () => {
		expect(read('start.bat')).toMatch(/if not "%BYL_EXIT%"=="0" pause/);
	});
});

describe('stop', () => {
	it('stop.bat shows success for 5 seconds and waits for a key on errors', () => {
		const lines = read('stop.bat').split('\r\n');
		expect(lines).toContain(STOP_CLOSE_LINE);
		expect(lines.filter((line) => /\b(pause|timeout)\b/i.test(line) && !/^rem\b/i.test(line))).toEqual([
			STOP_CLOSE_LINE
		]);
	});

	it('stops only processes chosen by Select-AppProcess, by process id', () => {
		const body = functionBody(control(), 'Invoke-Stop');
		expect(body).toMatch(/Select-AppProcess -Process \(Get-ProcessSnapshot\) -AppDir \$AppDir/);
		expect(body).toMatch(/Stop-Process -Id \$processId -Force/);
		expect(body).not.toMatch(/Stop-Process\s+-Name|Get-Process\s+-Name|\|\s*Stop-Process/i);
	});
});

describe('admin reset', () => {
	it('admin-zuruecksetzen.bat always pauses, so the result stays readable', () => {
		expect(read('admin-zuruecksetzen.bat')).toMatch(/set "BYL_EXIT=%ERRORLEVEL%"\r\npause\r\nexit \/b %BYL_EXIT%/);
	});

	it('reads the password twice as SecureString and frees the unmanaged copy with ZeroFreeBSTR', () => {
		const reader = functionBody(control(), 'Read-Secret');
		expect(reader).toMatch(/Read-Host -Prompt \$Prompt -AsSecureString/);
		expect(reader).toMatch(/SecureStringToBSTR\(\$secure\)/);
		expect(reader).toMatch(/finally \{[\s\S]*ZeroFreeBSTR\(\$bstr\)/);
		const body = functionBody(control(), 'Invoke-ResetAdmin');
		expect(body.match(/Read-Secret -Prompt/g)).toHaveLength(2);
		expect(body).toMatch(/Test-AdminCredential -Email \$email -Password \$password -Confirmation \$confirmation/);
		expect(body.indexOf('Test-AdminCredential')).toBeLessThan(body.indexOf('Invoke-AdminUpsert'));
	});

	it('never prints, logs or passes the password anywhere but to Invoke-AdminUpsert', () => {
		const body = functionBody(control(), 'Invoke-ResetAdmin');
		const uses = [...body.matchAll(/^.*\$password\b.*$/gim)].map((match) => match[0].trim());
		expect(uses).toEqual([
			'$password = $null',
			"$password = Read-Secret -Prompt \"Neues Passwort (mindestens $BylAdminPasswordMinLength Zeichen)\"",
			'$problem = Test-AdminCredential -Email $email -Password $password -Confirmation $confirmation',
			'$result = Invoke-AdminUpsert -ExePath $exe -AppDir $AppDir -Email $email -Password $password',
			'$password = $null'
		]);
		for (const source of [control(), functions()]) {
			expect(source).not.toMatch(/Start-Transcript|Out-File|Add-Content|Set-Content/i);
		}
	});

	it('starts PocketBase via ProcessStartInfo with redirected output and redacts the password', () => {
		const body = functionBody(functions(), 'Invoke-AdminUpsert');
		expect(body).toMatch(/New-Object System\.Diagnostics\.ProcessStartInfo/);
		expect(body).toMatch(/\.UseShellExecute = \$false/);
		expect(body).toMatch(/\.RedirectStandardOutput = \$true/);
		expect(body).toMatch(/\.RedirectStandardError = \$true/);
		expect(body).toMatch(/\.Replace\(\$Password, '\*\*\*'\)/);
	});
});

describe('PowerShell syntax', () => {
	let errors;

	beforeAll(() => {
		errors = runPowerShellJson(
			String.raw`
$files = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = @{}
foreach ($file in $files) {
    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$parseErrors)
    $result[$file] = @($parseErrors | ForEach-Object { $_.Message + ' (line ' + $_.Extent.StartLineNumber + ')' })
}
$result | ConvertTo-Json -Depth 4 -Compress`,
			POWERSHELL_FILES
		);
	}, 60_000);

	it.each(POWERSHELL_FILES)('%s parses without errors', (file) => {
		expect(errors[file]).toEqual([]);
	});
});
