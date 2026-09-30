// Pure functions of byl-control.ps1 (ADR-0039, plan betriebsskripte BS-1 and BS-2): port and
// settings, the address for the landing page, the state file, the decisions of start, reload and
// status, the orderly stop, the start fingerprint and the logs, all with fake inputs and files in a
// temp folder. Only app/byl-functions.ps1 runs here, never a script or a server.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');

const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = @{}

$configs = @{}
foreach ($case in $in.configs.PSObject.Properties) { $configs[$case.Name] = ConvertFrom-BylConfig -Text $case.Value }
$configs.null = ConvertFrom-BylConfig -Text $null
$result.configs = $configs
$result.configText = ConvertTo-BylConfigText -Port 8091
$result.configRoundTrip = (ConvertFrom-BylConfig -Text (ConvertTo-BylConfigText -Port 8091)).Port

$numbers = @{}
foreach ($case in $in.portTexts.PSObject.Properties) { $numbers[$case.Name] = ConvertTo-PortNumber -Text $case.Value }
$result.portNumbers = $numbers

$script:asked = New-Object System.Collections.Generic.List[int]
$busy = @(8091, 8092)
$result.nextFree = Find-NextFreePort -Start 8090 -IsFree { param($Port) $script:asked.Add($Port); $busy -notcontains $Port }
$result.nextAsked = @($script:asked.ToArray())
$result.nextSkips8099 = Find-NextFreePort -Start 8098 -IsFree { param($Port) $true }
$result.nextNone = Find-NextFreePort -Start 8090 -Attempts 3 -IsFree { param($Port) $false }
$result.nextTop = Find-NextFreePort -Start 65535 -IsFree { param($Port) $true }

$before = @{ app = $BylAppUrl; health = $BylHealthUrl; mail = $BylMailHelperUrl; port = $BylPort }
Set-BylAddress -Port 8091
$result.address = @{
    before = $before
    after = @{ app = $BylAppUrl; health = $BylHealthUrl; presence = $BylPresenceUrl; attention = $BylAttentionUrl; mail = $BylMailHelperUrl; port = $BylPort }
    helperArgs = Get-MailHelperArgumentString
    serverArgs = Get-ServerArgumentString -AppDir 'C:\app'
    attentionSend = Get-AttentionSendUrl -Reason 'stop'
}
Set-BylAddress -Port 8090
$result.addressScript = ConvertTo-AddressScript -Port 8091
$result.runPath = Get-BylRunPath -AppDir 'C:\byl #1\app'

$start = [DateTime]::new(2026, 9, 29, 10, 0, 0, [DateTimeKind]::Utc)
$text = ConvertTo-BylStateText -ProcessId 4711 -Port 8091 -ProcessStartUtc $start -StartedUtc $start.AddSeconds(1)
$state = ConvertFrom-BylState -Text $text
$result.state = @{
    text = $text
    processId = $state.ProcessId; port = $state.Port
    processStart = $state.ProcessStartUtc.ToString('o'); started = $state.StartedUtc.ToString('o')
}
$invalid = @{}
foreach ($case in $in.invalidStates.PSObject.Properties) { $invalid[$case.Name] = $null -eq (ConvertFrom-BylState -Text $case.Value) }
$invalid.null = $null -eq (ConvertFrom-BylState -Text $null)
$result.invalidStates = $invalid

$own = [pscustomobject]@{ ProcessId = 4711; CreationDate = $start.AddMilliseconds(900).ToLocalTime() }
$result.stateMatch = @{
    none = Resolve-StateMatch -State $null -Own @($own)
    match = Resolve-StateMatch -State $state -Own @($own)
    gone = Resolve-StateMatch -State $state -Own @()
    reused = Resolve-StateMatch -State $state -Own @([pscustomobject]@{ ProcessId = 4711; CreationDate = $start.AddMinutes(5) })
    other = Resolve-StateMatch -State $state -Own @([pscustomobject]@{ ProcessId = 99; CreationDate = $start })
    noDate = Resolve-StateMatch -State $state -Own @([pscustomobject]@{ ProcessId = 4711; CreationDate = $null })
}

$result.serverState = @{
    stopped = Resolve-ServerState -ProcessFound $false -Healthy $false
    running = Resolve-ServerState -ProcessFound $true -Healthy $true -AgeSeconds 1
    starting = Resolve-ServerState -ProcessFound $true -Healthy $false -AgeSeconds 5
    unhealthy = Resolve-ServerState -ProcessFound $true -Healthy $false -AgeSeconds 31 -StartGraceSeconds 30
    unknownAge = Resolve-ServerState -ProcessFound $true -Healthy $false
}
$actions = @{}
foreach ($case in $in.startActions) {
    $actions[$case.name] = Resolve-StartAction -ServerState $case.server -PortState $case.port -Force ([bool]$case.force)
}
$result.startActions = $actions

$paths = @{}
foreach ($case in $in.inFolder) { $paths[$case.name] = Test-FileInFolder -Path $case.path -Folder 'C:\byl #1\app' }
$result.inFolder = $paths
$http = @{}
foreach ($case in $in.httpValues.PSObject.Properties) { $http[$case.Name] = Get-HttpPort -Value $case.Value }
$result.http = $http

# $Replies: exit code of the sender per attempt ('throw': the sender does not start). $EndsAfter:
# number of attempts after which the process ends by itself (0: never). (Not "$Codes": the
# script blocks run in the scope of Stop-Gracefully, which has a parameter of that name.)
function Invoke-StopCase([object[]]$Replies, [int]$EndsAfter, [bool]$EndsAfterKill, [bool]$KillThrows) {
    $script:log = New-Object System.Collections.Generic.List[string]
    $script:alive = $true
    $script:attempts = 0
    $sent = New-Object System.Collections.Generic.List[int]
    $outcome = Stop-Gracefully -ProcessId 42 -GraceMilliseconds 1234 -RetryMilliseconds 250 -Codes $sent -SendBreak {
        param($id)
        $script:log.Add("break $id")
        $code = $Replies[$script:attempts]
        $script:attempts += 1
        if ($EndsAfter -gt 0 -and $script:attempts -ge $EndsAfter) { $script:alive = $false }
        if ($code -eq 'throw') { throw 'no powershell' }
        [int]$code
    } -WaitExit {
        param($id, $milliseconds)
        $script:log.Add("wait $id $milliseconds")
        -not $script:alive
    } -Kill {
        param($id)
        $script:log.Add("kill $id")
        if ($KillThrows) { throw 'denied' }
        if ($EndsAfterKill) { $script:alive = $false }
    }
    return @{ outcome = $outcome; log = @($script:log.ToArray()); codes = @($sent.ToArray()) }
}
$result.stop = @{
    graceful = Invoke-StopCase @(0) 1 $true $false
    slow = Invoke-StopCase @(0, 0) 0 $true $false
    endedSender = Invoke-StopCase @(-1073741510) 1 $true $false
    retried = Invoke-StopCase @(1, 0) 2 $true $false
    hungButDelivered = Invoke-StopCase @(-1) 1 $true $false
    unknownTwice = Invoke-StopCase @(-1, 9) 0 $true $false
    notSent = Invoke-StopCase @(2, 4) 0 $true $false
    refused = Invoke-StopCase @(3, 0) 0 $true $false
    throws = Invoke-StopCase @('throw', 'throw') 0 $true $false
    stuck = Invoke-StopCase @(0) 0 $false $true
}
$kinds = @{}
foreach ($code in -2, -1, 0, 1, 2, 3, 4, 5, -1073741510) { $kinds["$code"] = Resolve-BreakCode -Code $code }
$result.breakKinds = $kinds

$encoded = Get-ConsoleBreakCommand -ProcessId 4711
$result.breakCommand = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded))
try { [void](Get-ConsoleBreakCommand -ProcessId 0); $result.breakZero = 'accepted' } catch { $result.breakZero = 'rejected' }

$shortcuts = @(
    [pscustomobject]@{ Path = 'C:\s\a.lnk'; Name = 'becauseyoulovejira'; TargetPath = 'C:\x\chrome_proxy.exe'; Arguments = '--app-id=abcdefghijklmnopabcdefghijklmnop "--app-url=http://127.0.0.1:8091/"' }
)
$result.pwa = @{
    standard = Select-PwaShortcut -Shortcuts $shortcuts
    configured = Select-PwaShortcut -Shortcuts $shortcuts -Port 8091
}

$result | ConvertTo-Json -Depth 6 -Compress
`;

let result;

beforeAll(() => {
	result = runPowerShellJson(
		SCRIPT,
		{
			configs: {
				empty: '',
				spaces: '   ',
				standard: '{"port":8090}',
				other: '{ "port": 8091 }',
				noPort: '{"other":1}',
				low: '{"port":80}',
				high: '{"port":70000}',
				text: '{"port":"8091"}',
				fraction: '{"port":8091.5}',
				array: '[8091]',
				broken: '{"port":'
			},
			portTexts: { plain: '8091', spaced: ' 8091 ', low: '1023', min: '1024', max: '65535', high: '65536', sign: '-8091', word: 'abc', empty: '', decimal: '8091.0' },
			invalidStates: {
				empty: '',
				broken: '{',
				noPid: '{"port":8090,"processStartUtc":"2026-09-29T10:00:00Z","startedUtc":"2026-09-29T10:00:00Z"}',
				zeroPid: '{"pid":0,"port":8090,"processStartUtc":"2026-09-29T10:00:00Z","startedUtc":"2026-09-29T10:00:00Z"}',
				textPid: '{"pid":"1","port":8090,"processStartUtc":"2026-09-29T10:00:00Z","startedUtc":"2026-09-29T10:00:00Z"}',
				badPort: '{"pid":1,"port":70000,"processStartUtc":"2026-09-29T10:00:00Z","startedUtc":"2026-09-29T10:00:00Z"}',
				badTime: '{"pid":1,"port":8090,"processStartUtc":"gestern","startedUtc":"2026-09-29T10:00:00Z"}',
				noTime: '{"pid":1,"port":8090,"processStartUtc":"2026-09-29T10:00:00Z"}'
			},
			startActions: [
				{ name: 'stoppedFree', server: 'Stopped', port: 'Free', force: false },
				{ name: 'stoppedForeign', server: 'Stopped', port: 'Foreign', force: false },
				{ name: 'stoppedForeignForce', server: 'Stopped', port: 'Foreign', force: true },
				{ name: 'running', server: 'Running', port: 'App', force: false },
				{ name: 'runningOtherPort', server: 'Running', port: 'Free', force: false },
				{ name: 'starting', server: 'Starting', port: 'Free', force: false },
				{ name: 'unhealthy', server: 'Unhealthy', port: 'App', force: false },
				{ name: 'unhealthyForce', server: 'Unhealthy', port: 'App', force: true }
			],
			inFolder: [
				{ name: 'direct', path: 'C:\\byl #1\\app\\byl-mail.exe' },
				{ name: 'otherCase', path: 'c:/BYL #1/APP/byl-mail.exe' },
				{ name: 'subfolder', path: 'C:\\byl #1\\app\\sub\\byl-mail.exe' },
				{ name: 'parent', path: 'C:\\byl #1\\byl-mail.exe' },
				{ name: 'sibling', path: 'C:\\byl #1\\app2\\byl-mail.exe' },
				{ name: 'relative', path: 'app\\byl-mail.exe' },
				{ name: 'empty', path: '' }
			],
			httpValues: { standard: '127.0.0.1:8090', other: '127.0.0.1:53211', any: '0.0.0.0:8090', name: 'localhost:8090', ipv6: '[::1]:8090', noPort: '127.0.0.1', tooHigh: '127.0.0.1:70000', empty: '' }
		},
		{ BYL_FUNCTIONS: FUNCTIONS_FILE }
	);
}, 60_000);

describe('settings byl-config.json (ADR-0039 section 2)', () => {
	it('uses the standard port without a file or without "port"', () => {
		for (const name of ['empty', 'spaces', 'null', 'noPort']) {
			expect(result.configs[name], name).toEqual({ Port: 8090, Problem: null });
		}
		expect(result.configs.standard).toEqual({ Port: 8090, Problem: null });
		expect(result.configs.other).toEqual({ Port: 8091, Problem: null });
	});

	it('reports a broken file or an invalid port instead of guessing', () => {
		for (const name of ['low', 'high', 'text', 'fraction']) {
			expect(result.configs[name], name).toEqual({ Port: 8090, Problem: 'Port' });
		}
		for (const name of ['array', 'broken']) {
			expect(result.configs[name], name).toEqual({ Port: 8090, Problem: 'Json' });
		}
	});

	it('writes a file it reads back', () => {
		expect(result.configText).toBe('{\r\n  "port": 8091\r\n}\r\n');
		expect(result.configRoundTrip).toBe(8091);
	});

	it('takes only whole numbers from 1024 to 65535 as input', () => {
		expect(result.portNumbers).toEqual({
			plain: 8091,
			spaced: 8091,
			low: null,
			min: 1024,
			max: 65535,
			high: null,
			sign: null,
			word: null,
			empty: null,
			decimal: null
		});
	});

	it('suggests the next free port, skipping 8099, and gives up after the attempts', () => {
		expect(result.nextFree).toBe(8093);
		expect(result.nextAsked).toEqual([8091, 8092, 8093]);
		expect(result.nextSkips8099).toBe(8100);
		expect(result.nextNone).toBeNull();
		expect(result.nextTop).toBeNull();
	});
});

describe('one address for everything (ADR-0039 section 2)', () => {
	it('starts on 127.0.0.1:8090 and moves every address with Set-BylAddress', () => {
		expect(result.address.before).toEqual({
			app: 'http://127.0.0.1:8090/',
			health: 'http://127.0.0.1:8090/api/health',
			mail: 'http://127.0.0.1:8090',
			port: 8090
		});
		expect(result.address.after).toEqual({
			app: 'http://127.0.0.1:8091/',
			health: 'http://127.0.0.1:8091/api/health',
			presence: 'http://127.0.0.1:8091/api/byl/presence',
			attention: 'http://127.0.0.1:8091/api/byl/attention',
			mail: 'http://127.0.0.1:8091',
			port: 8091
		});
		expect(result.address.helperArgs).toBe('run --url=http://127.0.0.1:8091');
		expect(result.address.serverArgs).toMatch(/^serve --http=127\.0\.0\.1:8091 /);
		expect(result.address.attentionSend).toBe('http://127.0.0.1:8091/api/byl/attention?reason=stop');
	});

	it('writes the address for the landing page into run\\app-adresse.js', () => {
		expect(result.addressScript).toContain("window.BYL_APP_URL = 'http://127.0.0.1:8091/';");
		expect(result.runPath).toEqual({
			Directory: 'C:\\byl #1\\app\\run',
			State: 'C:\\byl #1\\app\\run\\byl.state.json',
			Address: 'C:\\byl #1\\app\\run\\app-adresse.js'
		});
	});

	it('matches the installed web app on the address of the app', () => {
		expect(result.pwa.standard).toBeNull();
		expect(result.pwa.configured).toBe('C:\\s\\a.lnk');
	});
});

describe('state file byl.state.json (ADR-0039 section 3)', () => {
	it('holds process id, port, times and the fingerprint only, and reads back', () => {
		expect(JSON.parse(result.state.text)).toEqual({
			schema: 1,
			pid: 4711,
			port: 8091,
			processStartUtc: '2026-09-29T10:00:00.0000000Z',
			startedUtc: '2026-09-29T10:00:01.0000000Z',
			fingerprint: null,
			environmentKey: null
		});
		expect(result.state).toMatchObject({
			processId: 4711,
			port: 8091,
			processStart: '2026-09-29T10:00:00.0000000Z',
			started: '2026-09-29T10:00:01.0000000Z'
		});
	});

	it('ignores a file that is no valid state', () => {
		for (const [name, invalid] of Object.entries(result.invalidStates)) expect(invalid, name).toBe(true);
	});

	it('matches only the same process (same id, same start); everything else is stale', () => {
		expect(result.stateMatch).toEqual({
			none: 'None',
			match: 'Match',
			gone: 'Stale',
			reused: 'Stale',
			other: 'Stale',
			noDate: 'Stale'
		});
	});
});

describe('decisions of start (ADR-0039 section 4)', () => {
	it('tells running, starting and unhealthy apart', () => {
		expect(result.serverState).toEqual({
			stopped: 'Stopped',
			running: 'Running',
			starting: 'Starting',
			unhealthy: 'Unhealthy',
			unknownAge: 'Unhealthy'
		});
	});

	it('never starts twice, never stops a foreign program and restarts an unhealthy app only with -Force', () => {
		expect(result.startActions).toEqual({
			stoppedFree: 'Start',
			stoppedForeign: 'PortBusy',
			stoppedForeignForce: 'PortBusy',
			running: 'Open',
			runningOtherPort: 'Open',
			starting: 'Wait',
			unhealthy: 'Unhealthy',
			unhealthyForce: 'Restart'
		});
	});

	it('knows files directly in the app folder only', () => {
		expect(result.inFolder).toEqual({
			direct: true,
			otherCase: true,
			subfolder: false,
			parent: false,
			sibling: false,
			relative: false,
			empty: false
		});
	});

	it('reads ports of 127.0.0.1 only', () => {
		expect(result.http).toEqual({
			standard: 8090,
			other: 53211,
			any: null,
			name: null,
			ipv6: null,
			noPort: null,
			tooHigh: null,
			empty: null
		});
	});
});

describe('orderly stop (ADR-0039 section 4)', () => {
	it('ends a process with the console break and waits for it, without killing', () => {
		expect(result.stop.graceful).toEqual({ outcome: 'Graceful', log: ['break 42', 'wait 42 1234'], codes: [0] });
	});

	it('kills only after the wait, and only a process still there', () => {
		// A break that went out is not repeated: the process had the signal and its time.
		expect(result.stop.slow).toEqual({
			outcome: 'Forced',
			log: ['break 42', 'wait 42 1234', 'kill 42', 'wait 42 10000'],
			codes: [0]
		});
	});

	it('reports a process that survives even the hard stop', () => {
		expect(result.stop.stuck).toEqual({
			outcome: 'Running',
			log: ['break 42', 'wait 42 1234', 'kill 42', 'wait 42 10000'],
			codes: [0]
		});
	});

	// Plan test-haertung, T-3: whether the stop was in order, the process decides, not the sender.
	it('names what the code of the sender says about the break', () => {
		expect(result.breakKinds).toEqual({
			'-2': 'NotSent',
			'-1': 'Unknown',
			0: 'Sent',
			1: 'NotSent',
			2: 'NotSent',
			3: 'Refused',
			4: 'NotSent',
			5: 'Unknown',
			'-1073741510': 'Sent'
		});
	});

	it('counts a break the sender did not survive, or reported late, as delivered once the process ends', () => {
		expect(result.stop.endedSender).toEqual({ outcome: 'Graceful', log: ['break 42', 'wait 42 1234'], codes: [-1073741510] });
		expect(result.stop.hungButDelivered).toEqual({ outcome: 'Graceful', log: ['break 42', 'wait 42 1234'], codes: [-1] });
	});

	it('sends a break that did not go out once more, and only then stops hard', () => {
		expect(result.stop.retried).toEqual({
			outcome: 'Graceful',
			log: ['break 42', 'wait 42 250', 'break 42', 'wait 42 1234'],
			codes: [1, 0]
		});
		expect(result.stop.notSent).toEqual({
			outcome: 'Forced',
			log: ['break 42', 'wait 42 250', 'break 42', 'wait 42 250', 'kill 42', 'wait 42 10000'],
			codes: [2, 4]
		});
		expect(result.stop.throws).toEqual({
			outcome: 'Forced',
			log: ['break 42', 'wait 42 250', 'break 42', 'wait 42 250', 'kill 42', 'wait 42 10000'],
			codes: [-2, -2]
		});
		expect(result.stop.unknownTwice).toEqual({
			outcome: 'Forced',
			log: ['break 42', 'wait 42 1234', 'break 42', 'wait 42 1234', 'kill 42', 'wait 42 10000'],
			codes: [-1, 9]
		});
	});

	it('never repeats a break the shared console refused', () => {
		expect(result.stop.refused).toEqual({ outcome: 'Forced', log: ['break 42', 'kill 42', 'wait 42 10000'], codes: [3] });
	});

	it('builds the console break for exactly one process id', () => {
		expect(result.breakCommand).toContain('exit ([BylConsoleBreak]::Send([uint32]4711))');
		expect(result.breakCommand).toContain('GenerateConsoleCtrlEvent(1, 0)');
		expect(result.breakZero).toBe('rejected');
	});
});

// BS-2: the start fingerprint on a fake app folder in %TEMP% (files only, no program runs), the
// decisions of reload and status, the logs and the other servers.
const FINGERPRINT_SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = @{}
$app = Join-Path $env:TEMP ('byl-fp-' + [guid]::NewGuid().ToString('N'))
try {
    foreach ($folder in @('pb_migrations', 'pb_hooks\lib', 'pb_public\_app', 'logs')) { [void](New-Item -ItemType Directory -Force -Path (Join-Path $app $folder)) }
    $write = { param($Relative, $Text) [System.IO.File]::WriteAllText((Join-Path $app $Relative), $Text) }
    & $write 'pocketbase.exe' 'binary'
    & $write 'pb_migrations\1_a.js' 'migrate(1)'
    & $write 'pb_migrations\readme.md' 'not a migration'
    & $write 'pb_hooks\main.pb.js' 'hook'
    & $write 'pb_hooks\lib\rules.js' 'rules'
    & $write 'pb_public\_app\version.json' '{"version":"1"}'
    & $write 'pb_public\index.html' '<html>'
    $names = Get-BylVariableName -UserNames @('BYL_TOKEN', 'PATH', 'byl_lower', 'BYL_A') -MachineNames @('BYL_TOKEN', 'BYL_M')
    $result.variableNames = @($names)
    $key = [byte[]](1..32)
    $otherKey = [byte[]](2..33)
    $entries = @('BYL_TOKEN=secret-1', 'BYL_A=a')
    $hash = Get-EnvironmentHash -Entries $entries -Key $key
    $result.environmentHash = @{
        shape = $hash -match '^[0-9a-f]{64}$'
        order = $hash -eq (Get-EnvironmentHash -Entries @('BYL_A=a', 'BYL_TOKEN=secret-1') -Key $key)
        value = $hash -ne (Get-EnvironmentHash -Entries @('BYL_TOKEN=secret-2', 'BYL_A=a') -Key $key)
        name = $hash -ne (Get-EnvironmentHash -Entries @('BYL_TOKEN=secret-1') -Key $key)
        key = $hash -ne (Get-EnvironmentHash -Entries $entries -Key $otherKey)
        plain = -not $hash.Contains('secret')
        empty = (Get-EnvironmentHash -Entries @() -Key $key) -match '^[0-9a-f]{64}$'
    }
    $take = { Get-BylFingerprint -AppDir $app -Port 8090 -EnvironmentHash $hash }
    $base = & $take
    $result.fingerprintKeys = @($base.Keys)
    $result.fingerprintShape = @{
        server = $base.server -match '^\d+:\d+$'; migrations = $base.migrations -match '^[0-9a-f]{64}$'
        hooks = $base.hooks -match '^[0-9a-f]{64}$'; port = $base.port; environment = $base.environment -match '^[0-9a-f]{64}$'
        mailHelper = $base.mailHelper; web = $base.web -match '^[0-9a-f]{64}$'
    }
    $result.same = (Compare-BylFingerprint -Started $base -Current (& $take)).Verdict
    $result.readmeIgnored = $base.migrations -eq (Get-BylFingerprint -AppDir $app -Port 8090 -EnvironmentHash $hash).migrations

    $changes = @{}
    & $write 'pb_public\_app\version.json' '{"version":"2"}'
    $changes.web = Compare-BylFingerprint -Started $base -Current (& $take)
    & $write 'pb_hooks\lib\rules.js' 'rules changed'
    $changes.hooks = Compare-BylFingerprint -Started $base -Current (& $take)
    & $write 'pb_migrations\2_b.js' 'migrate(2)'
    $changes.migrations = Compare-BylFingerprint -Started $base -Current (& $take)
    $changes.port = Compare-BylFingerprint -Started $base -Current (Get-BylFingerprint -AppDir $app -Port 8091 -EnvironmentHash $hash)
    $changes.environment = Compare-BylFingerprint -Started $base -Current (Get-BylFingerprint -AppDir $app -Port 8090 -EnvironmentHash (Get-EnvironmentHash -Entries @('BYL_TOKEN=secret-2', 'BYL_A=a') -Key $key))
    & $write 'byl-mail.exe' 'helper'
    $changes.all = Compare-BylFingerprint -Started $base -Current (& $take)
    $changes.unknown = Compare-BylFingerprint -Started $null -Current (& $take)
    $result.changes = $changes

    $state = ConvertFrom-BylState -Text (ConvertTo-BylStateText -ProcessId 7 -Port 8090 -ProcessStartUtc ([DateTime]::UtcNow) -StartedUtc ([DateTime]::UtcNow) -Fingerprint $base -EnvironmentKey 'AQID+/8=')
    $result.stateFingerprint = (Compare-BylFingerprint -Started $state.Fingerprint -Current $base).Verdict
    $result.stateKey = $state.EnvironmentKey
    $result.stateBadKey = $null -eq (ConvertFrom-BylState -Text '{"pid":7,"port":8090,"processStartUtc":"2026-09-29T10:00:00Z","startedUtc":"2026-09-29T10:00:00Z","environmentKey":"a b"}').EnvironmentKey

    $log = Join-Path $app 'logs\byl-control.log'
    & $write 'logs\byl-control.log' 'first'
    Invoke-LogRotation -Path $log -LimitBytes 100
    $result.rotationBelowLimit = @{ current = Test-Path $log; old = Test-Path (Join-Path $app 'logs\byl-control.1.log') }
    Invoke-LogRotation -Path $log -LimitBytes 3
    & $write 'logs\byl-control.log' 'second'
    Invoke-LogRotation -Path $log
    $result.rotation = @{
        old = [System.IO.File]::ReadAllText((Join-Path $app 'logs\byl-control.1.log'))
        current = Test-Path $log
        rotatedName = [System.IO.Path]::GetFileName((Get-RotatedLogPath -Path (Join-Path $app 'logs\pocketbase.out.log')))
    }
    Invoke-LogRotation -Path (Join-Path $app 'logs\missing.log')
}
finally {
    Remove-Item -LiteralPath $app -Recurse -Force -ErrorAction SilentlyContinue
}

$reload = @{}
foreach ($case in $in.reload) { $reload[$case.name] = Resolve-ReloadAction -ServerState $case.server -Verdict $case.verdict -Force ([bool]$case.force) }
$result.reload = $reload
$status = @{}
foreach ($case in $in.status) { $status[$case.name] = Resolve-StatusExitCode -ServerState $case.server -Verdict $case.verdict }
$result.status = $status
$result.disk = @(Get-DiskVerdict -FreeBytes 50MB; Get-DiskVerdict -FreeBytes 200MB; Get-DiskVerdict -FreeBytes 2GB)

$time = [DateTime]::new(2026, 9, 29, 10, 0, 0, [DateTimeKind]::Utc)
$result.logLine = Format-ControlLogLine -TimeUtc $time -Command 'start' -ExitCode 0 -Detail "pid=1 port=8090"
$crlf = [string][char]13 + [char]10
$lf = [string][char]10
$result.logLineBreaks = Format-ControlLogLine -TimeUtc $time -Command 'stop' -ExitCode 1 -Detail ('a' + $crlf + 'b')
$result.logLineEmpty = Format-ControlLogLine -TimeUtc $time -Command 'port' -ExitCode 0
$result.tail = Get-LogTailLines -Text ('a' + $crlf + $crlf + 'b' + $lf + 'c' + $lf + ' d ' + $lf) -Count 2
$result.tailShort = Get-LogTailLines -Text "only" -Count 5
$result.tailEmpty = (Get-LogTailLines -Text $null).Count

$others = @(Select-OtherServerProcess -Process @($in.processes) -AppDir $in.appDir)
$result.others = @($others | ForEach-Object { @{ pid = $_.ProcessId; port = $_.Port; sameFolder = $_.SameFolder } })
$result | ConvertTo-Json -Depth 6 -Compress
`;

describe('start fingerprint, reload, status and logs (ADR-0039 sections 5 and 6)', () => {
	const APP = 'C:\\byl #1\\app';
	const appArgs = `--dir="${APP}\\pb_data" --automigrate=false`;
	let fp;

	beforeAll(() => {
		fp = runPowerShellJson(
			FINGERPRINT_SCRIPT,
			{
				appDir: APP,
				processes: [
					{ ProcessId: 1, Name: 'pocketbase.exe', ExecutablePath: `${APP}\\pocketbase.exe`, CommandLine: `"${APP}\\pocketbase.exe" serve --http=127.0.0.1:8090 ${appArgs}` },
					{ ProcessId: 2, Name: 'pocketbase.exe', ExecutablePath: 'D:\\copy\\app\\pocketbase.exe', CommandLine: '"D:\\copy\\app\\pocketbase.exe" serve --http=127.0.0.1:8091 --dir=D:\\copy\\app\\pb_data' },
					{ ProcessId: 3, Name: 'pocketbase.exe', ExecutablePath: `${APP}\\pocketbase.exe`, CommandLine: `"${APP}\\pocketbase.exe" serve --http=127.0.0.1:53211 --dir=C:\\Temp\\byl-test-1\\pb_data` },
					{ ProcessId: 4, Name: 'pocketbase.exe', ExecutablePath: 'D:\\copy\\app\\pocketbase.exe', CommandLine: '"D:\\copy\\app\\pocketbase.exe" migrate up' },
					{ ProcessId: 5, Name: 'node.exe', ExecutablePath: 'C:\\node\\node.exe', CommandLine: 'node serve' },
					{ ProcessId: 6, Name: 'pocketbase.exe', ExecutablePath: null, CommandLine: null }
				],
				reload: [
					{ name: 'stopped', server: 'Stopped', verdict: 'Current', force: false },
					{ name: 'current', server: 'Running', verdict: 'Current', force: false },
					{ name: 'reloadOnly', server: 'Running', verdict: 'Reload', force: false },
					{ name: 'restart', server: 'Running', verdict: 'Restart', force: false },
					{ name: 'forced', server: 'Running', verdict: 'Current', force: true },
					{ name: 'unhealthy', server: 'Unhealthy', verdict: 'Current', force: false },
					{ name: 'starting', server: 'Starting', verdict: 'Restart', force: false },
					{ name: 'startingForced', server: 'Starting', verdict: 'Current', force: true }
				],
				status: [
					{ name: 'stopped', server: 'Stopped', verdict: 'Current' },
					{ name: 'current', server: 'Running', verdict: 'Current' },
					{ name: 'reload', server: 'Running', verdict: 'Reload' },
					{ name: 'restart', server: 'Running', verdict: 'Restart' },
					{ name: 'starting', server: 'Starting', verdict: 'Current' },
					{ name: 'unhealthy', server: 'Unhealthy', verdict: 'Restart' }
				]
			},
			{ BYL_FUNCTIONS: FUNCTIONS_FILE }
		);
	}, 60_000);

	it('takes the valid BYL_* names, sorted and once, and hashes names and values with a key', () => {
		expect(fp.variableNames).toEqual(['BYL_A', 'BYL_M', 'BYL_TOKEN']);
		// Order does not matter; a changed value, a missing name or another key change the hash; the
		// value itself is never in it.
		expect(fp.environmentHash).toEqual({ shape: true, order: true, value: true, name: true, key: true, plain: true, empty: true });
	});

	it('fingerprints what the server loads, without values', () => {
		expect(fp.fingerprintKeys).toEqual(['server', 'migrations', 'hooks', 'port', 'environment', 'mailHelper', 'web']);
		expect(fp.fingerprintShape).toEqual({
			server: true,
			migrations: true,
			hooks: true,
			port: '8090',
			environment: true,
			mailHelper: '',
			web: true
		});
		expect(fp.same).toBe('Current');
		expect(fp.readmeIgnored).toBe(true);
		expect(fp.stateFingerprint).toBe('Current');
		expect(fp.stateKey).toBe('AQID+/8=');
		expect(fp.stateBadKey).toBe(true);
	});

	it('says reload for a new web build and restart with the reason for everything else', () => {
		const pick = (change) => ({ verdict: change.Verdict, restart: change.Restart, reload: change.Reload });
		expect(pick(fp.changes.web)).toEqual({ verdict: 'Reload', restart: [], reload: ['web'] });
		expect(pick(fp.changes.hooks)).toEqual({ verdict: 'Restart', restart: ['hooks'], reload: ['web'] });
		expect(pick(fp.changes.migrations)).toEqual({ verdict: 'Restart', restart: ['migrations', 'hooks'], reload: ['web'] });
		expect(pick(fp.changes.port).restart).toEqual(['migrations', 'hooks', 'port']);
		expect(pick(fp.changes.environment).restart).toEqual(['migrations', 'hooks', 'environment']);
		expect(pick(fp.changes.all).restart).toEqual(['migrations', 'hooks', 'mailHelper']);
		expect(pick(fp.changes.unknown)).toEqual({ verdict: 'Restart', restart: ['unknown'], reload: [] });
	});

	it('restarts only when needed, never while starting without -Force', () => {
		expect(fp.reload).toEqual({
			stopped: 'Start',
			current: 'Nothing',
			reloadOnly: 'ReloadOnly',
			restart: 'Restart',
			forced: 'Restart',
			unhealthy: 'Restart',
			starting: 'Wait',
			startingForced: 'Restart'
		});
	});

	it('gives status the documented exit codes', () => {
		expect(fp.status).toEqual({ stopped: 3, current: 0, reload: 0, restart: 6, starting: 5, unhealthy: 5 });
		expect(fp.disk).toEqual(['Critical', 'Low', 'Ok']);
	});

	it('rotates a log into one older generation and writes one line per command', () => {
		expect(fp.rotationBelowLimit).toEqual({ current: true, old: false });
		expect(fp.rotation).toEqual({ old: 'second', current: false, rotatedName: 'pocketbase.out.1.log' });
		expect(fp.logLine).toBe('2026-09-29T10:00:00Z start exit=0 pid=1 port=8090');
		expect(fp.logLineBreaks).toBe('2026-09-29T10:00:00Z stop exit=1 a b');
		expect(fp.logLineEmpty).toBe('2026-09-29T10:00:00Z port exit=0');
		expect(fp.tail).toEqual(['c', ' d ']);
		expect(fp.tailShort).toEqual(['only']);
		expect(fp.tailEmpty).toBe(0);
	});

	it('reports other servers (another copy, a test instance) and leaves out the own one', () => {
		expect(fp.others).toEqual([
			{ pid: 2, port: 8091, sameFolder: false },
			{ pid: 3, port: 53211, sameFolder: true }
		]);
	});
});
