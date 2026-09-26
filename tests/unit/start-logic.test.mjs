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

/** Mail helpers (E4 plan, package 11), shaped like Win32_Process. */
const HELPER = `${APP}\\byl-mail.exe`;
const HELPERS = {
	own: { ProcessId: 600, Name: 'byl-mail.exe', ExecutablePath: HELPER, CommandLine: `"${HELPER}" run --url=http://127.0.0.1:8090` },
	ownOtherSpelling: {
		ProcessId: 601,
		Name: 'byl-mail.exe',
		ExecutablePath: 'c:\\program files\\BYL #1\\app\\BYL-MAIL.EXE',
		CommandLine: '"c:\\program files\\BYL #1\\app\\BYL-MAIL.EXE" run "--url=http://127.0.0.1:8090"'
	},
	test: {
		ProcessId: 602,
		Name: 'byl-mail.exe',
		ExecutablePath: 'C:\\repo\\helpers\\mail\\dist\\byl-mail.exe',
		CommandLine: '"C:\\repo\\helpers\\mail\\dist\\byl-mail.exe" run --url=http://127.0.0.1:53211'
	},
	otherPort: { ProcessId: 603, Name: 'byl-mail.exe', ExecutablePath: HELPER, CommandLine: `"${HELPER}" run --url=http://127.0.0.1:53211` },
	version: { ProcessId: 604, Name: 'byl-mail.exe', ExecutablePath: HELPER, CommandLine: `"${HELPER}" --version` },
	selfTest: { ProcessId: 605, Name: 'byl-mail.exe', ExecutablePath: HELPER, CommandLine: `"${HELPER}" --self-test run` },
	noUrl: { ProcessId: 606, Name: 'byl-mail.exe', ExecutablePath: HELPER, CommandLine: `"${HELPER}" run` },
	pocketbase: PROCESSES.own,
	unreadable: { ProcessId: 607, Name: 'byl-mail.exe', ExecutablePath: null, CommandLine: null }
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
// Start of the server process for the late link: the token is issued one second after it. Near the
// real time, because Wait-InstallerLink checks the expiry against the clock (30 minutes ahead).
const LATE_START = Math.floor(Date.now() / 1000);

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
# The link shows at the third read; the grace window is only an upper bound here, so a slow
# machine cannot end the wait before that read (the bounded case follows with 300 ms).
$late = Wait-FirstRunSignal -ReadLog { $script:calls++; if ($script:calls -ge 3) { '.../_/#/pbinstall/tok' } else { 'Server started' } } -DatabaseExisted $true -GraceMilliseconds 600000 -PollMilliseconds 10
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

# Process start and token of the late link come from the same input value (lateStart), not from
# the clock of this process: PowerShell may start seconds after the test built the token, which
# made the token look older than the process (more than the 5 s tolerance) and the link vanish.
$script:calls = 0
$lateStart = ConvertFrom-UnixTime $in.lateStart
$late = Wait-InstallerLink -ReadLog { $script:calls++; if ($script:calls -ge 3) { $in.lateLog } else { 'Server started' } } -ProcessStartUtc $lateStart -GraceMilliseconds 600000 -PollMilliseconds 10
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

$helpers = @($in.helpers.PSObject.Properties | ForEach-Object { $_.Value })
$helperSingle = @{}
foreach ($entry in $in.helpers.PSObject.Properties) {
    $helperSingle[$entry.Name] = @(Select-MailHelperProcess -Process @($entry.Value) -AppDir $in.appDir).Count
}
$decisions = @{}
foreach ($case in $in.decisions) {
    $decisions[$case.name] = Get-MailHelperDecision -HelperExists $case.exists -TokenSet $case.token -Running $case.running -MailConnectionCount $case.count
}
$answers = @{}
foreach ($case in $in.answers) {
    $answers[$case.name] = ConvertFrom-MailConnectionAnswer -StatusCode $case.status -Body $case.body
}
$result.mailHelper = @{
    selectAll = @(Select-MailHelperProcess -Process $helpers -AppDir $in.appDir | ForEach-Object { [int]$_.ProcessId })
    single = $helperSingle
    arguments = Get-MailHelperArgumentString
    argumentsSplit = Split-CommandLine -CommandLine ('byl-mail.exe ' + (Get-MailHelperArgumentString))
    log = Get-MailHelperLogPath -AppDir $in.appDir
    decisions = $decisions
    answers = $answers
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
			lateStart: LATE_START,
			lateLog: installerLog(fakeToken(LATE_START + 1 + LIFETIME)),
			helpers: HELPERS,
			decisions: [
				{ name: 'start', exists: true, token: true, running: false, count: 1 },
				{ name: 'unknownCount', exists: true, token: true, running: false, count: -1 },
				{ name: 'noConnection', exists: true, token: true, running: false, count: 0 },
				{ name: 'noRoute', exists: true, token: true, running: false, count: -2 },
				{ name: 'running', exists: true, token: true, running: true, count: 1 },
				{ name: 'noToken', exists: true, token: false, running: false, count: 1 },
				{ name: 'noHelper', exists: false, token: true, running: false, count: 1 }
			],
			answers: [
				{ name: 'two', status: 200, body: '{"items":[{"id":"a"},{"id":"b"}]}' },
				{ name: 'none', status: 200, body: '{"items":[]}' },
				{ name: 'noItems', status: 200, body: '{"message":"x"}' },
				{ name: 'broken', status: 200, body: 'kein json' },
				{ name: 'noRoute', status: 404, body: '{"message":"Not Found."}' },
				{ name: 'unauthorized', status: 401, body: '' },
				{ name: 'unavailable', status: 503, body: '' }
			]
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

describe('mail helper byl-mail.exe (E4 plan, package 11)', () => {
	it('selects only the own helper, like the own PocketBase', () => {
		expect(result.mailHelper.selectAll).toEqual([600, 601]);
		expect(result.mailHelper.single).toEqual({
			own: 1,
			ownOtherSpelling: 1,
			test: 0,
			otherPort: 0,
			version: 0,
			selfTest: 0,
			noUrl: 0,
			pocketbase: 0,
			unreadable: 0
		});
	});

	it('starts the helper for the own PocketBase and logs into app\\logs', () => {
		expect(result.mailHelper.arguments).toBe('run --url=http://127.0.0.1:8090');
		expect(result.mailHelper.argumentsSplit.slice(1)).toEqual(['run', '--url=http://127.0.0.1:8090']);
		expect(result.mailHelper.log).toEqual({
			Directory: `${APP}\\logs`,
			Output: `${APP}\\logs\\byl-mail.log`,
			Error: `${APP}\\logs\\byl-mail.err.log`
		});
	});

	it('starts it only with the file, the token and a switched-on mail connection', () => {
		expect(result.mailHelper.decisions).toEqual({
			start: 'Start',
			unknownCount: 'Start',
			noConnection: 'NoConnection',
			noRoute: 'NoRoute',
			running: 'Running',
			noToken: 'NoToken',
			noHelper: 'NoHelper'
		});
	});

	it('reads the number of mail connections from the answer of PocketBase', () => {
		expect(result.mailHelper.answers).toEqual({
			two: 2,
			none: 0,
			noItems: -1,
			broken: -1,
			noRoute: -2,
			unauthorized: -1,
			unavailable: -1
		});
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

// stop.bat (fix after user feedback): Stop-SelectedProcess with fake processes. Each fake stop
// behaves as named: kill ends the process, throwGone throws although the process ended,
// throwAlive throws and the process runs on, ignore does nothing, reuse hands the PID to a
// foreign process. Collected exactly like Invoke-Stop does it.
const STOP_SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$appDir = $in.appDir
$script:table = @{}
$script:behaviour = @{}
$script:reports = New-Object System.Collections.Generic.List[string]
function Reset-Table {
    $script:table = @{}
    $script:behaviour = @{}
    $script:reports.Clear()
    foreach ($entry in @($in.table)) {
        $script:table[[int]$entry.process.ProcessId] = $entry.process
        $script:behaviour[[int]$entry.process.ProcessId] = $entry.behaviour
    }
}
$getCurrent = { param($processId) if ($script:table.ContainsKey([int]$processId)) { $script:table[[int]$processId] } }
$stop = {
    param($processId)
    $id = [int]$processId
    switch ($script:behaviour[$id]) {
        'kill' { $script:table.Remove($id) }
        'throwGone' { $script:table.Remove($id); throw 'Es wurde kein Prozess gefunden.' }
        'throwAlive' { throw 'Zugriff verweigert' }
        'ignore' { }
        'reuse' { $script:table[$id] = $in.foreign }
    }
}
$report = { param($Text) $script:reports.Add($Text) }
$selectHelper = { param($Process) Select-MailHelperProcess -Process $Process -AppDir $appDir }
$selectApp = { param($Process) Select-AppProcess -Process $Process -AppDir $appDir }
function Invoke-Case($Helpers, $Apps) {
    Reset-Table
    $failed = New-Object System.Collections.Generic.List[string]
    foreach ($line in @(Stop-SelectedProcess -Candidates @($Helpers) -Select $selectHelper -Name 'byl-mail.exe' -GetCurrent $getCurrent -StopProcess $stop -StillRunningText 'still running' -Report $report)) { $failed.Add([string]$line) }
    foreach ($line in @(Stop-SelectedProcess -Candidates @($Apps) -Select $selectApp -Name 'PocketBase' -GetCurrent $getCurrent -StopProcess $stop -StillRunningText 'still running' -Report $report)) { $failed.Add([string]$line) }
    return @{ failed = @($failed.ToArray()); count = $failed.Count; message = ($failed -join '|'); reports = @($script:reports.ToArray()); left = @($script:table.Keys | Sort-Object) }
}
$c = $in.candidates
$result = @{
    allOk = Invoke-Case @($c.helper) @($c.app)
    nothing = Invoke-Case @() @()
    nullCandidates = Invoke-Case $null $null
    goneBefore = Invoke-Case @($c.gone) @()
    foreignBefore = Invoke-Case @() @($c.foreignBefore)
    throwGone = Invoke-Case @($c.throwGone) @()
    throwAlive = Invoke-Case @() @($c.throwAlive)
    ignore = Invoke-Case @($c.ignore) @()
    reuse = Invoke-Case @() @($c.reuse)
}
$result | ConvertTo-Json -Depth 6 -Compress
`;

describe('Stop-SelectedProcess (stop.bat)', () => {
	const withId = (process, ProcessId) => ({ ...process, ProcessId });
	const table = [
		{ process: withId(HELPERS.own, 700), behaviour: 'kill' },
		{ process: withId(PROCESSES.own, 701), behaviour: 'kill' },
		{ process: withId(PROCESSES.foreignNode, 703), behaviour: 'kill' },
		{ process: withId(HELPERS.own, 704), behaviour: 'throwGone' },
		{ process: withId(PROCESSES.own, 705), behaviour: 'throwAlive' },
		{ process: withId(HELPERS.own, 706), behaviour: 'ignore' },
		{ process: withId(PROCESSES.own, 707), behaviour: 'reuse' }
	];
	const candidate = (ProcessId) => ({ ProcessId });
	let stop;

	beforeAll(() => {
		stop = runPowerShellJson(
			STOP_SCRIPT,
			{
				appDir: APP,
				table,
				foreign: PROCESSES.foreignNode,
				candidates: {
					helper: candidate(700),
					app: candidate(701),
					gone: candidate(702),
					foreignBefore: candidate(703),
					throwGone: candidate(704),
					throwAlive: candidate(705),
					ignore: candidate(706),
					reuse: candidate(707)
				}
			},
			{ BYL_FUNCTIONS: FUNCTIONS_FILE }
		);
	}, 60_000);

	it('reports no failure when both processes end (the old code showed "System.String[]" twice)', () => {
		expect(stop.allOk.count).toBe(0);
		expect(stop.allOk.message).toBe('');
		expect(stop.allOk.message).not.toContain('System.');
		expect(stop.allOk.reports).toEqual(['Beende byl-mail.exe (PID 700) ...', 'Beende PocketBase (PID 701) ...']);
		expect(stop.allOk.left).not.toContain(700);
		expect(stop.allOk.left).not.toContain(701);
	});

	it.each(['nothing', 'nullCandidates'])('has nothing to report for %s', (name) => {
		expect(stop[name].count).toBe(0);
		expect(stop[name].reports).toEqual([]);
	});

	it('skips a process that is gone or foreign before the stop', () => {
		expect(stop.goneBefore.count).toBe(0);
		expect(stop.goneBefore.reports).toEqual([]);
		expect(stop.foreignBefore.count).toBe(0);
		expect(stop.foreignBefore.reports).toEqual([]);
		expect(stop.foreignBefore.left).toContain(703);
	});

	it('counts a stop that throws only if the process still runs', () => {
		expect(stop.throwGone.count).toBe(0);
		expect(stop.throwAlive.failed).toEqual(['PocketBase (PID 705): Zugriff verweigert']);
	});

	it('names a process that runs on in a readable line', () => {
		expect(stop.ignore.failed).toEqual(['byl-mail.exe (PID 706): still running']);
	});

	it('does not count a foreign process that reused the PID as still running', () => {
		expect(stop.reuse.count).toBe(0);
		expect(stop.reuse.reports).toEqual(['Beende PocketBase (PID 707) ...']);
	});
});
