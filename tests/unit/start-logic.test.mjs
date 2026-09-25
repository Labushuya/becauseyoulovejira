// Selection and detection logic of start.bat / stop.bat (E1 plan, package 8), tested with fake
// processes, sockets and log texts. The start and stop scripts themselves are never executed
// (CLAUDE.md section 11.3); only the side-effect-free functions of app/byl-functions.ps1 run.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');

// App folder with a space and '#', like a copy on a user's disk.
const APP = 'C:\\Program Files\\byl #1\\app';
const EXE = `${APP}\\pocketbase.exe`;
const TEMP_DATA = 'C:\\Users\\me\\AppData\\Local\\Temp\\byl-test-Ab12\\pb_data';

const appArgs = `--dir="${APP}\\pb_data" --hooksDir="${APP}\\pb_hooks" --migrationsDir="${APP}\\pb_migrations" --publicDir="${APP}\\pb_public" --automigrate=false --indexFallback=true`;

/** Process objects shaped like Win32_Process, keyed by case name. */
const PROCESSES = {
	own: { ProcessId: 100, Name: 'pocketbase.exe', ExecutablePath: EXE, CommandLine: `"${EXE}"  serve --http=127.0.0.1:8090 ${appArgs}` },
	ownOtherSpelling: {
		ProcessId: 101,
		Name: 'pocketbase.exe',
		ExecutablePath: 'c:\\program files\\BYL #1\\app\\pocketbase.exe',
		CommandLine: '"c:\\program files\\BYL #1\\app\\pocketbase.exe" serve "--dir=c:/program files/byl #1/app/pb_data/" --http=127.0.0.1:8090'
	},
	harness: {
		ProcessId: 200,
		Name: 'pocketbase.exe',
		ExecutablePath: EXE,
		CommandLine: `"${EXE}" serve --http=127.0.0.1:53211 --dir=${TEMP_DATA} --automigrate=false`
	},
	harnessOn8090: {
		ProcessId: 201,
		Name: 'pocketbase.exe',
		ExecutablePath: EXE,
		CommandLine: `"${EXE}" serve --http=127.0.0.1:8090 --dir=${TEMP_DATA} --automigrate=false`
	},
	migrate: { ProcessId: 202, Name: 'pocketbase.exe', ExecutablePath: EXE, CommandLine: `"${EXE}" migrate up ${appArgs}` },
	relativeDir: {
		ProcessId: 203,
		Name: 'pocketbase.exe',
		ExecutablePath: EXE,
		CommandLine: `"${EXE}" serve --http=127.0.0.1:8090 --dir=pb_data`
	},
	allInterfaces: {
		ProcessId: 204,
		Name: 'pocketbase.exe',
		ExecutablePath: EXE,
		CommandLine: `"${EXE}" serve --http=0.0.0.0:8090 ${appArgs}`
	},
	otherCopy: {
		ProcessId: 300,
		Name: 'pocketbase.exe',
		ExecutablePath: 'D:\\backup\\app\\pocketbase.exe',
		CommandLine: `"D:\\backup\\app\\pocketbase.exe" serve --http=127.0.0.1:8090 ${appArgs}`
	},
	foreignNode: {
		ProcessId: 400,
		Name: 'node.exe',
		ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
		CommandLine: `node server.js --http=127.0.0.1:8090 --dir="${APP}\\pb_data" serve`
	},
	unreadable: { ProcessId: 500, Name: 'pocketbase.exe', ExecutablePath: null, CommandLine: null }
};

const listener = (address, port, owner) => ({ LocalAddress: address, LocalPort: port, OwningProcess: owner });

const PORT_CASES = {
	free: [],
	ipv6LoopbackOnly: [listener('::1', 8090, 400)],
	otherPort: [listener('127.0.0.1', 8091, 400)],
	app: [listener('127.0.0.1', 8090, 100)],
	foreignNode: [listener('127.0.0.1', 8090, 400)],
	harnessOn8090: [listener('127.0.0.1', 8090, 201)],
	wildcard: [listener('0.0.0.0', 8090, 400)],
	unknownOwner: [listener('127.0.0.1', 8090, 999)]
};

// Installer links (E1.1): fake JWTs, only the "exp" claim matters. Times in Unix seconds.
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0) / 1000;
const PROCESS_START = NOW - 10 * 60;
const LIFETIME = 30 * 60;

function fakeToken(exp) {
	const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ exp, id: 'installer', type: 'auth' })}.c2lnbmF0dXJl`;
}

const TOKENS = {
	thisRun: fakeToken(PROCESS_START + 10 + LIFETIME),
	withinTolerance: fakeToken(PROCESS_START - 3 + LIFETIME),
	olderRun: fakeToken(PROCESS_START - 60 + LIFETIME),
	expired: fakeToken(NOW - 1),
	notJson: `aGVhZGVy.${Buffer.from('kein json').toString('base64url')}.c2ln`
};

const installerLog = (token, base = 'http://127.0.0.1:8090') =>
	`(!) Launch the URL below in the browser if it hasn't been open already to create your first superuser account:\n${base}/_/#/pbinstall/${token}\n(you can also create your first superuser by running: pocketbase superuser upsert EMAIL PASS)\n`;

const INSTALLER_LOGS = {
	thisRun: installerLog(TOKENS.thisRun),
	withinTolerance: installerLog(TOKENS.withinTolerance),
	olderRun: installerLog(TOKENS.olderRun),
	expired: installerLog(TOKENS.expired),
	lastWins: installerLog(TOKENS.olderRun) + installerLog(TOKENS.thisRun),
	lastIsOld: installerLog(TOKENS.thisRun) + installerLog(TOKENS.olderRun),
	colored: `\u001b[1;36mhttp://127.0.0.1:8090/_/#/pbinstall/${TOKENS.thisRun}\u001b[0m\n`,
	foreignHost: installerLog(TOKENS.thisRun, 'http://evil.example'),
	noJwt: 'http://127.0.0.1:8090/_/#/pbinstall/abc',
	notJson: installerLog(TOKENS.notJson),
	noLink: 'Server started at http://127.0.0.1:8090',
	empty: ''
};

const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$all = @($in.processes.PSObject.Properties | ForEach-Object { $_.Value })
$result = @{}

$result.selectAll = @(Select-AppProcess -Process $all -AppDir $in.appDir | ForEach-Object { [int]$_.ProcessId })
$single = @{}
foreach ($entry in $in.processes.PSObject.Properties) {
    $single[$entry.Name] = @(Select-AppProcess -Process @($entry.Value) -AppDir $in.appDir).Count
}
$result.selectSingle = $single
$result.selectNone = @(Select-AppProcess -Process $null -AppDir $in.appDir).Count

$ports = @{}
foreach ($entry in $in.ports.PSObject.Properties) {
    $ports[$entry.Name] = Resolve-PortState -Listener @($entry.Value) -Process $all -AppDir $in.appDir
}
$result.ports = $ports

$result.firstRun = @{
    installerLinkDbExists = Test-FirstRun -LogText 'Launch the URL: http://127.0.0.1:8090/_/#/pbinstall/abc' -DatabaseExisted $true
    emptyLogNoDb          = Test-FirstRun -LogText '' -DatabaseExisted $false
    nullLogNoDb           = Test-FirstRun -LogText $null -DatabaseExisted $false
    normalLogDbExists     = Test-FirstRun -LogText 'Server started at http://127.0.0.1:8090' -DatabaseExisted $true
    emptyLogDbExists      = Test-FirstRun -LogText '' -DatabaseExisted $true
}

$script:calls = 0
$noDb = Wait-FirstRunSignal -ReadLog { $script:calls++; '' } -DatabaseExisted $false -GraceMilliseconds 5000
$noDbCalls = $script:calls
$script:calls = 0
$late = Wait-FirstRunSignal -ReadLog { $script:calls++; if ($script:calls -ge 3) { '.../_/#/pbinstall/tok' } else { 'Server started' } } -DatabaseExisted $true -GraceMilliseconds 5000 -PollMilliseconds 10
$lateCalls = $script:calls
$script:calls = 0
$watch = [Diagnostics.Stopwatch]::StartNew()
$never = Wait-FirstRunSignal -ReadLog { $script:calls++; 'Server started' } -DatabaseExisted $true -GraceMilliseconds 300 -PollMilliseconds 20
$result.waitFirstRun = @{
    noDb = $noDb; noDbCalls = $noDbCalls
    late = $late; lateCalls = $lateCalls
    never = $never; neverCalls = $script:calls; neverMs = $watch.ElapsedMilliseconds
}

function ConvertFrom-UnixTime([double]$Seconds) { [DateTimeOffset]::FromUnixTimeSeconds([long]$Seconds).UtcDateTime }
function ConvertTo-LinkResult($Link) {
    if ($null -eq $Link) { return $null }
    return @{ url = $Link.Url; token = $Link.Token; expires = ([DateTimeOffset]$Link.ExpiresUtc).ToUnixTimeSeconds() }
}
$start = ConvertFrom-UnixTime $in.processStart
$now = ConvertFrom-UnixTime $in.now
$links = @{}
foreach ($entry in $in.installerLogs.PSObject.Properties) {
    $links[$entry.Name] = ConvertTo-LinkResult (Get-InstallerLink -LogText $entry.Value -ProcessStartUtc $start -NowUtc $now)
}
$links.nullLog = ConvertTo-LinkResult (Get-InstallerLink -LogText $null -ProcessStartUtc $start -NowUtc $now)
$result.installerLinks = $links

$script:calls = 0
$lateStart = [DateTime]::UtcNow
$late = Wait-InstallerLink -ReadLog { $script:calls++; if ($script:calls -ge 3) { $in.lateLog } else { 'Server started' } } -ProcessStartUtc $lateStart -GraceMilliseconds 5000 -PollMilliseconds 10
$lateCalls = $script:calls
$script:calls = 0
$watch = [Diagnostics.Stopwatch]::StartNew()
$none = Wait-InstallerLink -ReadLog { $script:calls++; 'Server started' } -ProcessStartUtc $lateStart -GraceMilliseconds 300 -PollMilliseconds 20
$result.waitInstaller = @{
    late = (ConvertTo-LinkResult $late); lateCalls = $lateCalls
    none = $none; noneCalls = $script:calls; noneMs = $watch.ElapsedMilliseconds
}

$result.serverArgs = Get-ServerArgumentString -AppDir $in.appDir
$result.serverArgsSplit = Split-CommandLine -CommandLine ('pocketbase.exe ' + $result.serverArgs)
$result.shortcut = Get-AutostartShortcut -AppDir ($in.appDir + '\') -StartupDir 'C:\Users\me\Start Menu\Startup' -SystemDir 'C:\Windows\system32'
$result.logPath = Get-ServerLogPath -AppDir $in.appDir
$result.split = Split-CommandLine -CommandLine '"C:\a b\x.exe"  serve --dir="C:\a b\#c" plain'
$result.flag = Get-FlagValue -Arguments @('--dir=first', 'serve', '--dir=last', '--http=x') -Name 'dir'
$result.health = @{ url = $BylHealthUrl; app = $BylAppUrl }
$bylEnv = Get-BylEnvironmentChange -UserNames @('BYL_TOKEN', 'byl_lower', 'PATH', 'BYL_CAL', 'BYL_TOKEN', 'BYL_') -MachineNames @('BYL_MACHINE', 'TEMP') -ProcessNames @('BYL_OLD', 'BYL_MACHINE', 'BYL_TOKEN', 'Path', 'byl_old2')
$result.bylEnv = @{ set = @($bylEnv.Set); remove = @($bylEnv.Remove) }
$noneEnv = Get-BylEnvironmentChange -UserNames @() -MachineNames @() -ProcessNames @()
$result.bylEnvNone = @{ set = @($noneEnv.Set).Count; remove = @($noneEnv.Remove).Count }

$result.ingestToken = @{
    needed = @(
        (Test-IngestTokenNeeded -HelperExists $true -CurrentValue $null),
        (Test-IngestTokenNeeded -HelperExists $true -CurrentValue ''),
        (Test-IngestTokenNeeded -HelperExists $true -CurrentValue '   '),
        (Test-IngestTokenNeeded -HelperExists $true -CurrentValue 'abc'),
        (Test-IngestTokenNeeded -HelperExists $false -CurrentValue $null)
    )
    first = New-IngestTokenValue
    second = New-IngestTokenValue
    name = $BylIngestTokenName
    helper = $BylMailHelperName
}

$result | ConvertTo-Json -Depth 6 -Compress
`;

let result;

beforeAll(() => {
	result = runPowerShellJson(
		SCRIPT,
		{
			appDir: APP,
			processes: PROCESSES,
			ports: PORT_CASES,
			now: NOW,
			processStart: PROCESS_START,
			installerLogs: INSTALLER_LOGS,
			lateLog: installerLog(fakeToken(Math.floor(Date.now() / 1000) + LIFETIME))
		},
		{ BYL_FUNCTIONS: FUNCTIONS_FILE }
	);
}, 60_000);

describe('Select-AppProcess (stop.bat and the start check)', () => {
	it('selects only the own instance from a mixed process list', () => {
		expect(result.selectAll).toEqual([100, 101]);
	});

	it.each([
		['own', 1],
		['ownOtherSpelling', 1],
		['harness', 0],
		['harnessOn8090', 0],
		['migrate', 0],
		['relativeDir', 0],
		['allInterfaces', 0],
		['otherCopy', 0],
		['foreignNode', 0],
		['unreadable', 0]
	])('%s -> %i', (name, expected) => {
		expect(result.selectSingle[name]).toBe(expected);
	});

	it('handles an empty process list', () => {
		expect(result.selectNone).toBe(0);
	});
});

describe('Resolve-PortState (no second server, clear error for a foreign port owner)', () => {
	it.each([
		['free', 'Free', null],
		['ipv6LoopbackOnly', 'Free', null],
		['otherPort', 'Free', null],
		['app', 'App', 100],
		['foreignNode', 'Foreign', 400],
		['harnessOn8090', 'Foreign', 201],
		['wildcard', 'Foreign', 400],
		['unknownOwner', 'Foreign', 999]
	])('%s -> %s', (name, state, processId) => {
		expect(result.ports[name].State).toBe(state);
		expect(result.ports[name].ProcessId).toBe(processId);
	});

	it('names the foreign owner', () => {
		expect(result.ports.foreignNode.ProcessName).toBe('node.exe');
		expect(result.ports.unknownOwner.ProcessName).toBe('unbekanntes Programm');
	});
});

describe('first-run detection', () => {
	it('prefers the installer link in the log and falls back to a missing data.db', () => {
		expect(result.firstRun).toEqual({
			installerLinkDbExists: true,
			emptyLogNoDb: true,
			nullLogNoDb: true,
			normalLogDbExists: false,
			emptyLogDbExists: false
		});
	});

	it('decides at once for a new database', () => {
		expect(result.waitFirstRun.noDb).toBe(true);
		expect(result.waitFirstRun.noDbCalls).toBe(0);
	});

	it('sees an installer link that appears after the health check', () => {
		expect(result.waitFirstRun.late).toBe(true);
		expect(result.waitFirstRun.lateCalls).toBe(3);
	});

	it('gives up after the bounded grace period', () => {
		expect(result.waitFirstRun.never).toBe(false);
		expect(result.waitFirstRun.neverCalls).toBeGreaterThan(1);
		expect(result.waitFirstRun.neverMs).toBeLessThan(3000);
	});
});

describe('server arguments and autostart shortcut', () => {
	it('uses the flags from CLAUDE.md with quoted paths from the app folder', () => {
		expect(result.serverArgsSplit).toEqual([
			'pocketbase.exe',
			'serve',
			'--http=127.0.0.1:8090',
			`--dir=${APP}\\pb_data`,
			`--hooksDir=${APP}\\pb_hooks`,
			`--migrationsDir=${APP}\\pb_migrations`,
			`--publicDir=${APP}\\pb_public`,
			'--automigrate=false',
			'--indexFallback=true'
		]);
		expect(result.serverArgs).not.toMatch(/--dev\b/);
	});

	it('points the shortcut at start-hidden.vbs via wscript.exe', () => {
		expect(result.shortcut).toEqual({
			Path: 'C:\\Users\\me\\Start Menu\\Startup\\becauseyoulovejira.lnk',
			TargetPath: 'C:\\Windows\\system32\\wscript.exe',
			Arguments: `"${APP}\\start-hidden.vbs"`,
			WorkingDirectory: APP
		});
	});

	it('writes the server log into app\\logs', () => {
		expect(result.logPath.Output).toBe(`${APP}\\logs\\pocketbase.out.log`);
		expect(result.logPath.Error).toBe(`${APP}\\logs\\pocketbase.err.log`);
	});

	it('polls the health endpoint of the fixed binding', () => {
		expect(result.health).toEqual({
			url: 'http://127.0.0.1:8090/api/health',
			app: 'http://127.0.0.1:8090/'
		});
	});
});

describe('BYL_* variables for PocketBase (ADR-0018 section 6)', () => {
	it('hands on the valid names of the user scope and drops stale ones of the process', () => {
		expect(result.bylEnv).toEqual({ set: ['BYL_CAL', 'BYL_TOKEN'], remove: ['BYL_OLD'] });
		expect(result.bylEnvNone).toEqual({ set: 0, remove: 0 });
	});
});

describe('ingest token of the mail helper (ADR-0018 section 8)', () => {
	it('is needed only with byl-mail.exe and without a usable value', () => {
		expect(result.ingestToken.needed).toEqual([true, true, true, false, false]);
		expect(result.ingestToken.name).toBe('BYL_INGEST_TOKEN');
		expect(result.ingestToken.helper).toBe('byl-mail.exe');
	});

	it('creates 24 random bytes as Base64', () => {
		for (const value of [result.ingestToken.first, result.ingestToken.second]) {
			expect(value).toMatch(/^[A-Za-z0-9+/]{32}$/);
			expect(Buffer.from(value, 'base64')).toHaveLength(24);
		}
		expect(result.ingestToken.first).not.toBe(result.ingestToken.second);
	});
});

describe('command line parsing', () => {
	it('splits on whitespace and removes grouping quotes', () => {
		expect(result.split).toEqual(['C:\\a b\\x.exe', 'serve', '--dir=C:\\a b\\#c', 'plain']);
	});

	it('takes the last value of a repeated flag', () => {
		expect(result.flag).toBe('last');
	});
});

describe('installer link of the running server (E1.1)', () => {
	const link = (token) => ({
		url: `http://127.0.0.1:8090/_/#/pbinstall/${token}`,
		token,
		expires: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp
	});

	it.each([
		['thisRun', TOKENS.thisRun],
		['withinTolerance', TOKENS.withinTolerance],
		['lastWins', TOKENS.thisRun],
		['colored', TOKENS.thisRun]
	])('finds the link of this run in the %s log', (name, token) => {
		expect(result.installerLinks[name]).toEqual(link(token));
	});

	it('rebuilds the URL on the fixed binding instead of trusting the log', () => {
		expect(result.installerLinks.foreignHost).toEqual(link(TOKENS.thisRun));
	});

	it.each(['olderRun', 'lastIsOld', 'expired', 'noJwt', 'notJson', 'noLink', 'empty', 'nullLog'])(
		'ignores the %s log',
		(name) => {
			expect(result.installerLinks[name]).toBeNull();
		}
	);

	it('waits a bounded time for a link that appears after the health check', () => {
		expect(result.waitInstaller.late?.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
		expect(result.waitInstaller.lateCalls).toBe(3);
		expect(result.waitInstaller.none).toBeNull();
		expect(result.waitInstaller.noneCalls).toBeGreaterThan(1);
		expect(result.waitInstaller.noneMs).toBeLessThan(3000);
	});
});
