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

$result.serverArgs = Get-ServerArgumentString -AppDir $in.appDir
$result.serverArgsSplit = Split-CommandLine -CommandLine ('pocketbase.exe ' + $result.serverArgs)
$result.shortcut = Get-AutostartShortcut -AppDir ($in.appDir + '\') -StartupDir 'C:\Users\me\Start Menu\Startup' -SystemDir 'C:\Windows\system32'
$result.logPath = Get-ServerLogPath -AppDir $in.appDir
$result.split = Split-CommandLine -CommandLine '"C:\a b\x.exe"  serve --dir="C:\a b\#c" plain'
$result.flag = Get-FlagValue -Arguments @('--dir=first', 'serve', '--dir=last', '--http=x') -Name 'dir'
$result.health = @{ url = $BylHealthUrl; app = $BylAppUrl }

$result | ConvertTo-Json -Depth 6 -Compress
`;

let result;

beforeAll(() => {
	result = runPowerShellJson(
		SCRIPT,
		{ appDir: APP, processes: PROCESSES, ports: PORT_CASES },
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

describe('command line parsing', () => {
	it('splits on whitespace and removes grouping quotes', () => {
		expect(result.split).toEqual(['C:\\a b\\x.exe', 'serve', '--dir=C:\\a b\\#c', 'plain']);
	});

	it('takes the last value of a repeated flag', () => {
		expect(result.flag).toBe('last');
	});
});
