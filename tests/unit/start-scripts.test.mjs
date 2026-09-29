// Static checks of the operation scripts in app/ (E1 plan package 8, ADR-0039). The logic behind
// them is covered by start-logic.test.mjs and control-logic.test.mjs; the scripts themselves run
// only against disposable copies in tests/integration/control-script.test.mjs (CLAUDE.md
// section 11.3).

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(ROOT_DIR, 'app');
const SCRIPTS_DIR = join(ROOT_DIR, 'scripts');

const WRAPPERS = {
	'start.bat': 'start',
	'stop.bat': 'stop',
	'autostart-an.bat': 'autostart-on',
	'autostart-aus.bat': 'autostart-off',
	'admin-zuruecksetzen.bat': 'reset-admin'
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

/** One branch of the switch in Invoke-Start, e.g. 'Open'. */
function startBranch(name) {
	const body = functionBody(control(), 'Invoke-Start');
	const start = body.indexOf(`        '${name}' {`);
	if (start < 0) throw new Error(`branch ${name} not found`);
	const next = body.indexOf("\r\n        '", start + 1);
	return body.slice(start, next < 0 ? body.lastIndexOf('return Start-Server') : next);
}

describe('wrappers', () => {
	it.each(Object.entries(WRAPPERS))(
		'%s calls byl-control.ps1 %s with -NoProfile -ExecutionPolicy Bypass',
		(name, command) => {
			const lines = read(name)
				.split(/\r\n/)
				.filter((line) => /powershell/i.test(line) && !/^\s*rem\b/i.test(line));
			expect(lines).toEqual([
				`"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" ${command}`
			]);
		}
	);

	it('start-hidden.vbs starts the control script hidden with -NoProfile -ExecutionPolicy Bypass', () => {
		const source = read('start-hidden.vbs');
		expect(source).toContain('WScript.ScriptFullName');
		expect(source).toContain('"byl-control.ps1"');
		expect(source).toMatch(/" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "/);
		expect(source).toContain('" start -Hidden"');
		expect(source).toMatch(/shell\.Run\(command, 0, True\)/);
	});

	it('every command of a wrapper is a command of byl-control.ps1', () => {
		const set = control().match(/\[ValidateSet\(([^)]*)\)\]\r\n\s*\[string\]\$Command = 'help'/)[1];
		const commands = [...set.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
		for (const command of [...Object.values(WRAPPERS), 'restart', 'port', 'help']) expect(commands).toContain(command);
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

describe('address and port (ADR-0039 section 2)', () => {
	it('keeps 8090 as the standard and builds every address from one port on 127.0.0.1', () => {
		expect(functions()).toContain('$BylDefaultPort = 8090');
		const set = functionBody(functions(), 'Set-BylAddress');
		for (const line of [
			'$script:BylAppUrl = "http://127.0.0.1:$Port/"',
			'$script:BylHealthUrl = "http://127.0.0.1:$Port/api/health"',
			'$script:BylPresenceUrl = "http://127.0.0.1:$Port/api/byl/presence"',
			'$script:BylAttentionUrl = "http://127.0.0.1:$Port/api/byl/attention"',
			'$script:BylMailHelperUrl = "http://127.0.0.1:$Port"'
		]) {
			expect(set).toContain(line);
		}
		expect(functions()).toContain('Set-BylAddress -Port $BylDefaultPort');
		// Nowhere else a fixed address.
		const rest = functions().replace(set, '');
		expect(rest).not.toMatch(/127\.0\.0\.1:8090/);
		expect(control()).not.toMatch(/127\.0\.0\.1:8090|:8090\b/);
	});

	it('reads the port from byl-config.json only and binds only to the loopback address', () => {
		expect(functions()).toContain("$BylConfigName = 'byl-config.json'");
		expect(functionBody(functions(), 'Get-ServerArgumentString')).toContain("'serve --http=127.0.0.1:{0} ");
		const main = control().slice(control().lastIndexOf('try {'));
		expect(main).toContain('$config = Get-Config');
		expect(main).toContain('Set-BylAddress -Port $config.Port');
		expect(control()).not.toMatch(/BYL_PORT/);
	});

	it('refuses a broken byl-config.json before a start instead of using another port', () => {
		const start = functionBody(control(), 'Invoke-Start');
		expect(start.indexOf('$Config.Problem')).toBeLessThan(start.indexOf('Get-Look'));
		expect(functionBody(control(), 'Invoke-Restart').indexOf('$Config.Problem')).toBeGreaterThan(-1);
	});

	it('names the program on a busy port and suggests a free port with the command to switch', () => {
		const text = functionBody(control(), 'Get-PortBusyText');
		expect(text).toContain('$PortState.ExecutablePath');
		expect(text).toContain('Find-NextFreePort -Start $Port -IsFree { param($Candidate) Test-PortFree -Port $Candidate }');
		expect(text).toContain('$ControlCall port $next');
		expect(text).not.toMatch(/Stop-Process|Kill\(/);
	});

	it('writes the address of the landing page at start, stop and port', () => {
		expect(functionBody(control(), 'Start-Server')).toContain('Update-AddressFile -Port $Port');
		expect(functionBody(control(), 'Invoke-StopCore').match(/Update-AddressFile -Port \$Config\.Port/g)).toHaveLength(2);
		expect(functionBody(control(), 'Invoke-Port')).toContain('Update-AddressFile -Port $port');
		expect(functionBody(functions(), 'ConvertTo-AddressScript')).toContain("window.BYL_APP_URL = 'http://127.0.0.1:$Port/';");
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

	it('polls /api/health with a timeout and shows the progress', () => {
		expect(functionBody(functions(), 'Wait-ServerReady')).toMatch(/Test-Health/);
		expect(functionBody(functions(), 'Wait-ServerReady')).toMatch(/& \$Progress \$elapsed/);
		expect(functionBody(control(), 'Wait-Ready')).toMatch(
			/Wait-ServerReady -Process \$Server -TimeoutSeconds \$HealthTimeoutSeconds -Progress/
		);
		expect(functionBody(control(), 'Start-Server')).toContain('$state = Wait-Ready -Server $server');
		expect(control()).toMatch(/\$HealthTimeoutSeconds = 30\b/);
	});

	it('looks at the own instance and the port before starting and aborts for a foreign owner', () => {
		const start = functionBody(control(), 'Invoke-Start');
		expect(start.indexOf('Get-Look')).toBeLessThan(start.indexOf('Start-Server'));
		expect(start).toContain('Resolve-StartAction -ServerState $look.ServerState -PortState $look.PortState.State -Force $Force.IsPresent');
		expect(startBranch('PortBusy')).toMatch(/return \$BylExitPortBusy/);
		expect(startBranch('PortBusy')).not.toMatch(/Stop-|Invoke-StopCore/);
		const look = functionBody(control(), 'Get-Look');
		expect(look).toContain('Select-AppProcess -Process $processes -AppDir $AppDir');
		expect(look).toContain('Resolve-PortState -Listener (Get-ListenerSnapshot -Port $Port) -Process $processes -AppDir $AppDir -Port $Port');
		expect(look).toContain('Resolve-StateMatch -State $state -Own $own');
		expect(functions()).toMatch(/Get-NetTCPConnection -State Listen/);
		expect(functions()).toMatch(/Get-CimInstance -ClassName Win32_Process/);
	});

	it('starts nothing twice: a running instance only opens the browser, an unhealthy one needs -Force', () => {
		expect(startBranch('Open')).not.toMatch(/Start-Server|Start-Process -FilePath \$exe/);
		expect(startBranch('Unhealthy')).toMatch(/return \$BylExitUnhealthy/);
		expect(startBranch('Unhealthy')).not.toMatch(/Invoke-StopCore|Start-Server/);
		expect(startBranch('Restart')).toMatch(/Invoke-StopCore -Config \$Config[\s\S]*Start-Server -Port \$Config\.Port/);
	});

	it('starts the server with the arguments from Get-ServerArgumentString and writes the state file', () => {
		const start = functionBody(control(), 'Start-Server');
		expect(start).toMatch(
			/Start-Process -FilePath \$exe -ArgumentList \(Get-ServerArgumentString -AppDir \$AppDir -Port \$Port\)/
		);
		expect(start.indexOf('ConvertTo-BylStateText -ProcessId $server.Id -Port $Port')).toBeGreaterThan(
			start.indexOf('Start-Process -FilePath $exe')
		);
		expect(start.indexOf('ConvertTo-BylStateText')).toBeLessThan(start.indexOf('Wait-Ready'));
	});

	it('hands the BYL_* variables of the user scope to the server without printing them', () => {
		const start = functionBody(control(), 'Start-Server');
		expect(start.indexOf('Sync-BylEnvironment')).toBeGreaterThan(-1);
		expect(start.indexOf('Sync-BylEnvironment')).toBeLessThan(start.indexOf('Start-Process -FilePath $exe'));
		const sync = functionBody(control(), 'Sync-BylEnvironment');
		expect(sync).toContain("GetEnvironmentVariables('User')");
		expect(sync).toMatch(/Get-BylEnvironmentChange/);
		expect(sync).not.toMatch(/Write-|Show-Message|Out-|Add-Content|Set-Content/);
	});

	it('starts the mail helper after PocketBase, also when the app runs already (package 11)', () => {
		const complete = functionBody(control(), 'Complete-Start');
		expect(complete.indexOf('Start-MailHelper')).toBeGreaterThan(-1);
		expect(complete.indexOf('Start-MailHelper')).toBeLessThan(complete.indexOf('Open-Browser'));
		expect(startBranch('Open')).toContain('Start-MailHelper');
		const start = functionBody(control(), 'Start-Server');
		// Not in the first-run branch: before the setup there is no connection.
		const firstRun = start.slice(start.indexOf('if (Wait-FirstRunSignal'), start.indexOf('Complete-Start'));
		expect(firstRun).not.toMatch(/Start-MailHelper/);
		expect(start.indexOf('Complete-Start -ProcessId $server.Id -ColdStart $true')).toBeGreaterThan(start.indexOf('Wait-FirstRunSignal'));
		const helper = functionBody(control(), 'Start-MailHelper');
		expect(helper.indexOf('Initialize-IngestToken')).toBeLessThan(helper.indexOf('Sync-BylEnvironment'));
		expect(helper.indexOf('Sync-BylEnvironment')).toBeLessThan(helper.indexOf('Start-Process'));
		expect(helper).toMatch(/Get-MailHelperDecision -HelperExists \$exists -TokenSet \$tokenSet -Running \$running -MailConnectionCount \$count/);
		expect(helper).toMatch(/Start-Process -FilePath \$helper -ArgumentList \(Get-MailHelperArgumentString\)/);
		expect(helper).toMatch(/-WindowStyle Hidden/);
		expect(helper).toMatch(/-RedirectStandardOutput \$log\.Output -RedirectStandardError \$log\.Error/);
		expect(helper).not.toMatch(/Write-\w+[^\n]*\$token|Exception\.Message/);
		const count = functionBody(control(), 'Get-MailConnectionCount');
		expect(count).toMatch(/\$request\.Proxy = \$null/);
		expect(count).toContain('"$($BylAppUrl)api/byl/ingest/connections"');
		expect(count).not.toMatch(/Write-|Show-Message/);
	});

	it('creates the ingest token before handing on the variables and never prints it', () => {
		const start = functionBody(control(), 'Start-Server');
		expect(start.indexOf('Initialize-IngestToken')).toBeGreaterThan(-1);
		expect(start.indexOf('Initialize-IngestToken')).toBeLessThan(start.indexOf('Sync-BylEnvironment'));
		const init = functionBody(control(), 'Initialize-IngestToken');
		expect(init).toMatch(/Test-IngestTokenNeeded -HelperExists \(Test-Path -LiteralPath \$helper -PathType Leaf\)/);
		expect(init).toContain("[Environment]::SetEnvironmentVariable($BylIngestTokenName, (New-IngestTokenValue), 'User')");
		// The only output is a hint with the type of the exception, never a value.
		expect(init.match(/Write-\w+|Show-Message|Out-\w+|Add-Content|Set-Content/g)).toEqual(['Write-Status']);
		expect(init).not.toMatch(/\$current\b[^\n]*Write|Write[^\n]*\$current|Exception\.Message/);
	});

	it('has a first-run branch that opens no second tab', () => {
		const body = functionBody(control(), 'Start-Server');
		const firstRun = body.slice(body.indexOf('if (Wait-FirstRunSignal'));
		const branch = firstRun.slice(0, firstRun.indexOf('return $BylExitSetupPending') + 'return $BylExitSetupPending'.length);
		expect(branch).toContain('$FirstRunHint');
		expect(branch).not.toContain('Open-App');
		expect(branch).not.toContain('Open-Browser');
		expect(branch).not.toContain('Complete-Start');
		// The link is shown, never opened a second time (PocketBase opened it already).
		expect(branch).toContain(
			'Wait-InstallerLink -ReadLog { Read-ServerLog } -ProcessStartUtc (Get-ProcessStartUtc -Process $server)'
		);
		expect(branch).not.toContain('Start-Process');
	});

	it('opens a still working installer link of the running instance once and pauses', () => {
		const running = startBranch('Open');
		const branch = running.slice(running.indexOf('$link = '), running.indexOf('return $BylExitSetupPending') + 'return $BylExitSetupPending'.length);
		expect(branch).toContain('$link = Get-PendingInstallerLink -ProcessId $processId');
		expect(branch).toContain('$PendingSetupHint');
		expect(branch.match(/Start-Process/g)).toHaveLength(1);
		expect(branch).toMatch(/Start-Process -FilePath \$link\.Url\r\n\s*return \$BylExitSetupPending$/);
		expect(branch).not.toContain('Open-App');

		const pending = functionBody(control(), 'Get-PendingInstallerLink');
		expect(pending).toContain('Get-InstallerLink -LogText (Read-ServerLog) -ProcessStartUtc $startUtc');
		expect(pending).toContain('Test-InstallerPending -Token $link.Token');
		const hint = control().match(/\$PendingSetupHint = @"\r\n([\s\S]*?)\r\n"@/)[1];
		expect(hint).toContain('{0} Uhr');
		expect(hint).toContain('{1}');
		expect(hint).toContain('$MissedLinkHint');
	});

	it('only opens links it rebuilt on the address of the app', () => {
		const body = functionBody(functions(), 'Get-InstallerLink');
		expect(body).toContain('Url        = "$($BylAppUrl)_/#/pbinstall/$token"');
		expect(body).toContain(String.raw`'/_/#/pbinstall/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)'`);
	});

	it('the first-run hint matches the login page', () => {
		const hint = control().match(/\$FirstRunHint = @"\r\n([\s\S]*?)\r\n"@/)[1];
		expect(hint).toContain('Erster Start');
		expect(hint).toContain('Admin-Konto');
		expect(hint).toContain('({0}_/)');
		expect(hint).toContain('„users“');
		expect(hint).toContain('30 Minuten');
		expect(hint).toContain('$MissedLinkHint');
		expect(functionBody(control(), 'Start-Server')).toContain('Show-Message (($FirstRunHint -f $BylAppUrl) + $where)');
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

describe('open tabs before opening the browser (ADR-0035, SF-4)', () => {
	it('opens the browser only through Open-Browser, after Resolve-BrowserAction', () => {
		const source = control();
		const openApp = functionBody(source, 'Open-App');
		const rest = source.replace(openApp, '');
		expect(rest.match(/\bOpen-App\b/g)).toHaveLength(1);
		const open = functionBody(source, 'Open-Browser');
		expect(open).toContain('Open-App');
		expect(open.indexOf('Resolve-BrowserAction')).toBeGreaterThan(-1);
		expect(open.indexOf('Resolve-BrowserAction')).toBeLessThan(open.indexOf('Open-App'));
		expect(open).toMatch(/if \(\$action -eq 'Skip'\) \{[\s\S]*?return\s*\}/);
		expect(open).toContain(
			"Write-Status 'becauseyoulovejira ist bereits in einem Browser-Tab offen; dort erscheint ein Hinweis.'"
		);
		expect(open).toContain("Send-Attention -Reason 'start'");
	});

	it('asks without waiting when the app runs already and with the wait of a cold start after it started', () => {
		const calls = [...control().matchAll(/^.*Open-Browser -ColdStart.*$/gm)].map((match) => match[0].trim());
		expect(calls).toEqual([
			'if (-not $Hidden -and -not $NoBrowser) { Open-Browser -ColdStart $ColdStart }',
			'if (-not $Hidden -and -not $NoBrowser) { Open-Browser -ColdStart $false }',
			'Open-Browser -ColdStart $false'
		]);
		expect(startBranch('Open')).toContain('Open-Browser -ColdStart $false');
		// "open" asks like a start of a running app, after its own check for -Hidden and -NoBrowser.
		const open = functionBody(control(), 'Invoke-Open');
		expect(open.indexOf('if ($Hidden -or $NoBrowser)')).toBeLessThan(open.indexOf('Open-Browser -ColdStart $false'));
		const start = functionBody(control(), 'Start-Server');
		expect(start.indexOf('Complete-Start -ProcessId $server.Id -ColdStart $true')).toBeGreaterThan(start.indexOf('Wait-Ready'));
	});

	it('asks the server without proxy, without Origin and with a timeout', () => {
		const request = functionBody(functions(), 'Invoke-LocalRequest');
		expect(request).toMatch(/\$request\.Proxy = \$null/);
		expect(request).toMatch(/\$request\.KeepAlive = \$false/);
		expect(request).toMatch(/\$request\.Timeout = \$TimeoutMilliseconds/);
		for (const source of [control(), functions()]) {
			expect(source).not.toMatch(/Headers\.Add\(\s*'Origin'|Sec-Fetch/i);
		}
		for (const name of ['Get-Presence', 'Send-Attention', 'Get-AttentionAcked']) {
			const body = functionBody(control(), name);
			expect(body, name).toMatch(/try \{[\s\S]*Invoke-LocalRequest[\s\S]*\}\s*catch \{/);
			expect(body, name).not.toMatch(/Write-|Show-Message/);
		}
	});

	it('never fails the start because of the question (fail-open)', () => {
		const resolve = functionBody(functions(), 'Resolve-BrowserAction');
		expect(resolve).toMatch(/try \{[\s\S]*\}\s*catch \{\s*return 'Open'\s*\}\s*\}\s*$/);
		expect(functions()).toContain('$BylColdStartWaitMs = 3000');
		expect(functions()).toContain('$BylAckWaitMs = 2000');
		expect(functions()).toContain('$BylLandingWindowMs = 10000');
	});

	it('prefers the installed web app and falls back to the question and the tab (SF-5)', () => {
		const open = functionBody(control(), 'Open-Browser');
		expect(open.indexOf('Find-PwaShortcut')).toBeGreaterThan(-1);
		expect(open.indexOf('Find-PwaShortcut')).toBeLessThan(open.indexOf('Resolve-BrowserAction'));
		expect(open).toMatch(/try \{\s*Start-Process -FilePath \$shortcut\s*Write-Status [^\n]*\s*return\s*\}\s*catch \{/);
		const find = functionBody(control(), 'Find-PwaShortcut');
		expect(find).toMatch(/^function Find-PwaShortcut \{[\s\S]*?try \{[\s\S]*\}\s*catch \{\s*return \$null\s*\}\s*\}\s*$/);
		expect(find).toContain("[Environment]::GetFolderPath('Programs')");
		expect(find).toContain("-Filter 'becauseyoulovejira*.lnk' -Recurse");
		expect(find).toContain('Select-PwaShortcut -Shortcuts @($shortcuts)');
		expect(find).not.toMatch(/Start-Process|Remove-Item|Set-Content|\.Save\(/);
	});

	it('stop tells the open tabs before it stops, without waiting and without failing', () => {
		const stop = functionBody(control(), 'Invoke-StopCore');
		expect(stop).toMatch(/if \(\$own\.Count -gt 0\) \{\s*Set-BylAddress -Port \$ports\[0\]\s*Send-StopNotice\s*\}/);
		expect(stop.indexOf('Send-StopNotice')).toBeLessThan(stop.indexOf('Stop-OwnProcess'));
		const notice = functionBody(control(), 'Send-StopNotice');
		expect(notice).toMatch(/try \{[\s\S]*Get-AttentionSendUrl -Reason 'stop'[\s\S]*\}\s*catch \{/);
		expect(notice).toContain('-TimeoutMilliseconds 1000');
		expect(notice).not.toMatch(/Get-AttentionAcked|Wait-AttentionAck|Write-|Show-Message|return 1/);
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
		const body = functionBody(control(), 'Invoke-StopCore');
		expect(body).toMatch(/\$snapshot = Get-ProcessSnapshot/);
		expect(body).toMatch(/Select-AppProcess -Process \$snapshot -AppDir \$AppDir/);
		expect(body).toMatch(/Stop-OwnProcess -Candidates \$own -Name 'PocketBase'/);
		const stop = functionBody(control(), 'Stop-OwnProcess');
		expect(stop).toMatch(/-Kill \{ param\(\$id\) Stop-Process -Id \$id -Force \}/);
		expect(stop).toMatch(/Stop-SelectedProcess -Candidates \$Candidates -Select \$Select -Name \$Name/);
		expect(stop).toMatch(/-Filter "ProcessId = \$\(\[int\]\$processId\)"/);
		const selected = functionBody(functions(), 'Stop-SelectedProcess');
		expect(selected).toMatch(/if \(@\(& \$Select @\(& \$GetCurrent \$processId\)\)\.Count -eq 0\) \{ continue \}/);
		for (const source of [control(), functions()]) {
			expect(source).not.toMatch(/Stop-Process\s+-Name|Get-Process\s+-Name|\|\s*Stop-Process/i);
		}
	});

	it('ends in order first (console break, waiting) and hard only after that, with a warning', () => {
		const stop = functionBody(control(), 'Stop-OwnProcess');
		expect(stop).toContain('Stop-Gracefully -ProcessId $processId -GraceMilliseconds ($StopGraceSeconds * 1000)');
		expect(stop).toContain('-SendBreak { param($id) (Send-ConsoleBreak -ProcessId $id) -eq 0 }');
		expect(stop).toContain("if ($result -eq 'Forced') { $Forced.Add(\"$Name (PID $processId)\") }");
		expect(control()).toMatch(/\$StopGraceSeconds = 15\b/);
		expect(functionBody(control(), 'Invoke-StopCore')).toContain('Warnung: Nicht rechtzeitig geordnet beendet, daher hart beendet: ');
		const send = functionBody(control(), 'Send-ConsoleBreak');
		expect(send).toContain('Get-ConsoleBreakCommand -ProcessId $ProcessId');
		expect(send).toContain('$startInfo.CreateNoWindow = $true');
		expect(send).toContain('$startInfo.UseShellExecute = $false');
		// The child sends CTRL_BREAK_EVENT only to a console of the target alone, and survives it.
		const source = functions().match(/\$BylConsoleBreakSource = @'\r\n([\s\S]*?)\r\n'@/)[1];
		expect(source).toContain('GenerateConsoleCtrlEvent(1, 0)');
		expect(source).toContain('if (ids[i] != processId && ids[i] != self) return 3;');
		expect(source.indexOf('AttachConsole(processId)')).toBeLessThan(source.indexOf('SetConsoleCtrlHandler(Ignore, true)'));
	});

	it('waits for the port and removes the state file', () => {
		const body = functionBody(control(), 'Invoke-StopCore');
		expect(body.indexOf('Wait-PortFree -Port $port')).toBeGreaterThan(body.indexOf("-Name 'PocketBase'"));
		expect(body.lastIndexOf('Remove-StateFile')).toBeGreaterThan(body.indexOf('Wait-PortFree'));
		expect(control()).toMatch(/\$PortFreeTimeoutSeconds = 10\b/);
	});

	it('collects the failures as single strings, never as a nested array ("System.String[]")', () => {
		const body = functionBody(control(), 'Invoke-StopCore');
		const stop = functionBody(control(), 'Stop-OwnProcess');
		const selected = functionBody(functions(), 'Stop-SelectedProcess');
		for (const source of [body, stop, selected]) {
			expect(source).not.toMatch(/return\s*,/);
			expect(source).not.toMatch(/\$failed \+= /);
		}
		expect(body).toMatch(/\$failed = New-Object System\.Collections\.Generic\.List\[string\]/);
		expect(body.match(/\{ \$failed\.Add\(\[string\]\$line\) \}/g)).toHaveLength(2);
	});

	it('stops the own mail helper before PocketBase, for every address of the own instance (package 11)', () => {
		const body = functionBody(control(), 'Invoke-StopCore');
		expect(body).toMatch(/Select-MailHelperProcess -Process \$snapshot -AppDir \$AppDir -Url \$urls/);
		expect(body.indexOf("-Name 'byl-mail.exe'")).toBeGreaterThan(-1);
		expect(body.indexOf("-Name 'byl-mail.exe'")).toBeLessThan(body.indexOf("-Name 'PocketBase'"));
		expect(body).toMatch(/Select-MailHelperProcess -Process \$Process -AppDir \$AppDir -Url \$urls/);
	});
});

describe('status, reload, logs and doctor (ADR-0039 sections 5 to 7, BS-2)', () => {
	it('stores the start fingerprint taken before the start, and rotates the logs of the run', () => {
		const start = functionBody(control(), 'Start-Server');
		const fingerprint = start.indexOf('$fingerprint = Get-BylFingerprint -AppDir $AppDir -Port $Port -EnvironmentNames (Get-EnvironmentName)');
		expect(fingerprint).toBeGreaterThan(start.indexOf('Sync-BylEnvironment'));
		expect(fingerprint).toBeLessThan(start.indexOf('Start-Process -FilePath $exe'));
		expect(start).toContain('-Fingerprint $fingerprint');
		expect(start.indexOf('Invoke-LogRotation -Path $log.Output')).toBeLessThan(start.indexOf('Start-Process -FilePath $exe'));
		expect(start.indexOf('Show-PreStartNotice -Processes $Processes')).toBeLessThan(start.indexOf('Start-Process -FilePath $exe'));
		const helper = functionBody(control(), 'Start-MailHelper');
		expect(helper.indexOf('Invoke-LogRotation -Path $log.Output')).toBeLessThan(helper.indexOf('Start-Process'));
		expect(functionBody(control(), 'Get-EnvironmentName')).not.toMatch(/GetEnvironmentVariable\(|\.Values|\[\$name\]/);
	});

	it('restarts in reload only through Resolve-ReloadAction and says so otherwise', () => {
		const reload = functionBody(control(), 'Invoke-Reload');
		expect(reload).toContain('Resolve-ReloadAction -ServerState $data.ServerState -Verdict $data.Comparison.Verdict -Force $Force.IsPresent');
		expect(reload).toMatch(/if \(\$action -eq 'Nothing'\) \{[\s\S]*?Kein Neustart nötig[\s\S]*?return \$BylExitOk/);
		expect(reload).toMatch(/if \(\$action -eq 'ReloadOnly'\) \{[\s\S]*?F5[\s\S]*?return \$BylExitOk/);
		expect(reload.match(/Invoke-StopCore/g)).toHaveLength(1);
		expect(reload.indexOf('Invoke-StopCore')).toBeGreaterThan(reload.indexOf("if ($action -eq 'Restart')"));
	});

	it('prints JSON only with -Json, as one line on standard output, and nothing else then', () => {
		for (const name of ['Invoke-Status', 'Invoke-Doctor']) {
			const body = functionBody(control(), name);
			expect(body, name).toMatch(/if \(\$Json\) \{[\s\S]*?\[Console\]::Out\.WriteLine\(\([\s\S]*?ConvertTo-Json -Depth 4 -Compress\)\)\s*return \$code/);
		}
		for (const name of ['Write-Status', 'Write-Notice']) expect(functionBody(control(), name)).toContain('-not $Json');
		expect(control().match(/\[Console\]::Out\.WriteLine/g)).toHaveLength(2);
	});

	it('names every reason of a restart and returns the documented exit codes of status', () => {
		const reasons = control().match(/\$RestartReasonText = @\{([\s\S]*?)\r\n\}/)[1];
		for (const part of ['unknown', 'server', 'migrations', 'hooks', 'port', 'environment', 'mailHelper']) expect(reasons).toMatch(new RegExp(`\\b${part}\\s+=`));
		expect(functionBody(control(), 'Invoke-Status')).toContain('Resolve-StatusExitCode -ServerState $data.ServerState -Verdict $data.Comparison.Verdict');
		expect(functions()).toContain('$BylExitNotRunning = 3');
		expect(functions()).toContain('$BylExitRestartNeeded = 6');
	});

	it('logs changing commands only, with numbers and fixed words, never the admin e-mail', () => {
		const main = control().slice(control().lastIndexOf('try {'));
		expect(main).toContain("if (@('start', 'stop', 'restart', 'reload', 'port', 'autostart-on', 'autostart-off', 'reset-admin') -contains $Command) {");
		const write = functionBody(control(), 'Write-ControlLog');
		expect(write).toContain('Invoke-LogRotation -Path $path -LimitBytes $BylControlLogLimitBytes');
		expect(write).toContain('[System.IO.File]::AppendAllText($path');
		expect(functionBody(control(), 'Invoke-ResetAdmin')).not.toContain('LogDetail');
		for (const line of control().split('\r\n').filter((text) => /\$script:LogDetail = /.test(text))) {
			expect(line, line).not.toMatch(/\$email|\$password|\$token|Exception|\$Value/i);
		}
	});

	it('shows logs read-only and follows one log only', () => {
		const logs = functionBody(control(), 'Invoke-Logs');
		expect(logs).toContain("Get-Content -LiteralPath $path -Tail $Lines -Wait | Out-Host");
		expect(logs).toMatch(/if \(\$name -eq 'alle'\) \{[\s\S]*?-Follow folgt genau einem Log/);
		expect(logs).not.toMatch(/Remove-Item|WriteAll|Delete\(|Set-Content|Clear-Content/);
	});

	it('doctor checks files, settings, instance, port, write access, disk, copies, mail helper and autostart', () => {
		const doctor = functionBody(control(), 'Invoke-Doctor');
		for (const name of ["'pocketbase'", '$folder', "'web'", "'config'", "'instance'", "'port'", '"write-$folder"', "'disk'", "'copies'", "'mail'", "'autostart'"]) {
			expect(doctor, name).toContain(`& $add ${name}`);
		}
		expect(doctor).not.toMatch(/Stop-|Invoke-StopCore|Start-Server/);
		expect(functionBody(control(), 'Test-WriteAccess')).toMatch(/WriteAllText\(\$probe, 'x'\)\s*\[System\.IO\.File\]::Delete\(\$probe\)/);
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

// The parser of Windows PowerShell 5.1 is the reference; other systems skip it (plan plattformen S0).
describe.skipIf(process.platform !== 'win32')('PowerShell syntax', () => {
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
