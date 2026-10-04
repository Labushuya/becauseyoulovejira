// Pure functions of byl-control.ps1 for the access in the home network (plan docs/plan/heimnetz.md,
// ADR-0055 addendum): the addresses (the same rule as lib/lan-rules.js), byl-config.json, the start
// arguments and origins, the fingerprint, the own instance on 0.0.0.0, the addresses of the
// computer to choose from, the network category, the state of the firewall rule (also read from
// rules shaped like HNetCfg.FwPolicy2, and a read that is denied), the script and command that
// change it and what a change came to (elevation, then the rule read again). Only
// app/byl-functions.ps1 runs here, never a script, a server, the firewall or a prompt for
// administrator rights; the network, the firewall and the elevation are fakes.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { runPowerShellJson } from '../support/powershell.mjs';
import { scaled } from '../support/timing.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');
const lan = loadHookLib('lan-rules.js');
const security = loadHookLib('security-rules.js');

const ADDRESSES = [
	'192.168.178.20',
	' 192.168.178.20 ',
	'10.0.0.1',
	'10.255.255.254',
	'172.16.0.1',
	'172.31.255.1',
	'172.15.0.1',
	'172.32.0.1',
	'192.169.0.1',
	'127.0.0.1',
	'100.64.0.1',
	'169.254.1.2',
	'8.8.8.8',
	'0.0.0.0',
	'192.168.178.020',
	'192.168.178.256',
	'192.168.178',
	'192.168.178.20:8090',
	'http://192.168.178.20',
	'Tower2.Fritz.Box',
	'tower2.local',
	'nas.home.arpa',
	'pc.lan',
	'pc.internal',
	'fritz.box',
	'tower2.example.org',
	'tower2.fritz.box:8090',
	'-pc.fritz.box',
	'pc..fritz.box',
	'localhost',
	'räch.fritz.box',
	'',
	`${'a'.repeat(63)}.fritz.box`,
	`${'a'.repeat(64)}.fritz.box`
];

const APP = 'C:\\Users\\Anna Beispiel\\Meine Apps\\byl #1\\app';
const EXE = `${APP}\\pocketbase.exe`;
const QUOTED = "C:\\Users\\O'Brien\\app\\pocketbase.exe";
const CONFIGS = {
	none: '',
	portOnly: '{ "port": 8091 }',
	on: JSON.stringify({ port: 8091, network: { lan: { enabled: true, addresses: ['192.168.178.20', 'Tower2.fritz.box', '8.8.8.8', 42, '192.168.178.20'] } } }),
	off: JSON.stringify({ network: { lan: { enabled: false, addresses: ['192.168.178.20'] } } }),
	textSwitch: JSON.stringify({ network: { lan: { enabled: 'true', addresses: ['192.168.178.20'] } } }),
	noAddresses: JSON.stringify({ network: { lan: { enabled: true } } }),
	single: JSON.stringify({ network: { lan: { enabled: true, addresses: '10.0.0.5' } } }),
	many: JSON.stringify({ network: { lan: { enabled: true, addresses: ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5', '10.0.0.6'] } } }),
	wrongType: JSON.stringify({ network: 'lan' }),
	broken: '{',
	full: JSON.stringify({
		port: 8091,
		backup: { target: 'E:\\Sicherung', daily: 3, weekly: 2, monthly: 6, credentials: false },
		security: { hosts: ['rechner.tailnet.ts.net'] },
		network: { lan: { enabled: true, addresses: ['192.168.178.20'] } }
	})
};

// Shaped like Get-NetIPAddress, Get-NetConnectionProfile and Get-DnsClient.
const NETWORK = {
	addresses: [
		{ IPAddress: '127.0.0.1', InterfaceIndex: 1, InterfaceAlias: 'Loopback Pseudo-Interface 1', AddressState: 'Preferred' },
		{ IPAddress: '169.254.69.168', InterfaceIndex: 10, InterfaceAlias: 'Bluetooth-Netzwerkverbindung', AddressState: 'Tentative' },
		{ IPAddress: '192.168.178.20', InterfaceIndex: 8, InterfaceAlias: 'Ethernet', AddressState: 'Preferred' },
		{ IPAddress: '172.20.48.1', InterfaceIndex: 30, InterfaceAlias: 'vEthernet (WSL)', AddressState: 'Preferred' },
		{ IPAddress: '10.0.0.7', InterfaceIndex: 12, InterfaceAlias: 'WLAN', AddressState: 'Preferred' },
		{ IPAddress: '10.0.0.8', InterfaceIndex: 12, InterfaceAlias: 'WLAN', AddressState: 'Deprecated' },
		{ IPAddress: '203.0.113.5', InterfaceIndex: 13, InterfaceAlias: 'Modem', AddressState: 'Preferred' }
	],
	profiles: [
		{ InterfaceIndex: 8, NetworkCategory: 'Public' },
		{ InterfaceIndex: 12, NetworkCategory: 'Private' },
		{ InterfaceIndex: 13, NetworkCategory: 'DomainAuthenticated' }
	],
	suffixes: [
		{ InterfaceIndex: 8, ConnectionSpecificSuffix: 'fritz.box' },
		{ InterfaceIndex: 12, ConnectionSpecificSuffix: 'Example.ORG' },
		{ InterfaceIndex: 30, ConnectionSpecificSuffix: '' }
	]
};

const rule = (overrides = {}) => ({
	Enabled: 'True',
	Direction: 'Inbound',
	Action: 'Allow',
	Profile: 'Private',
	Program: EXE,
	Protocol: 'TCP',
	LocalPort: ['8090'],
	...overrides
});

const FIREWALL = {
	present: [rule()],
	presentAny: [rule({ Protocol: 'Any', LocalPort: ['Any'], Profile: 'Any' })],
	presentBoth: [rule({ Profile: 'Private, Public' })],
	otherCase: [rule({ Program: EXE.toUpperCase().replace(/\\/g, '/') })],
	oldPort: [rule({ LocalPort: ['8091'] })],
	publicOnly: [rule({ Profile: 'Public' })],
	off: [rule({ Enabled: 'False' })],
	blockAction: [rule({ Action: 'Block' })],
	outbound: [rule({ Direction: 'Outbound' })],
	udp: [rule({ Protocol: 'UDP' })],
	otherFolder: [rule({ Program: 'D:\\backup\\app\\pocketbase.exe' })],
	none: [],
	mixed: [rule({ LocalPort: ['8091'] }), rule()]
};

// Rules as HNetCfg.FwPolicy2 tells them (INetFwRule), like on the computer of the bug report: the
// rule of the button and a second one made by hand with netsh, the rules "pocketbase" of the alert of
// Windows (public networks, all ports), block rules and rules of other programs.
const LIVE = 'H:\\Apps\\becauseyoulovejira\\app\\pocketbase.exe';
const com = (overrides = {}) => ({
	Name: 'becauseyoulovejira (Heimnetz)',
	ApplicationName: LIVE,
	Protocol: 6,
	LocalPorts: '8090',
	Direction: 1,
	Enabled: true,
	Profiles: 2,
	Action: 1,
	...overrides
});
const COM_RULES = [
	com(),
	com(),
	com({ Name: 'pocketbase', ApplicationName: LIVE.toLowerCase(), Protocol: 17, LocalPorts: '*', Profiles: 4 }),
	com({ Name: 'pocketbase', ApplicationName: LIVE.toLowerCase(), LocalPorts: '*', Profiles: 4 }),
	com({ Name: 'pocketbase.exe', Action: 0, LocalPorts: '*', Profiles: 4 }),
	com({ Name: 'pocketbase.exe', Action: 0, Enabled: false }),
	com({ Name: 'pocketbase.exe', Action: 0, Direction: 2 }),
	com({ ApplicationName: 'D:\\backup\\app\\pocketbase.exe' }),
	com({ Name: 'Alle', ApplicationName: '%SystemRoot%\\system32\\svchost.exe', Protocol: 256, LocalPorts: null, Profiles: 2147483647 }),
	com({ Name: 'Mehrere', LocalPorts: '8090, 8091', Profiles: 3, Protocol: 41 })
];

const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = [ordered]@{}
$result.addresses = @(foreach ($value in @($in.addresses)) { ConvertTo-BylLanAddress -Text $value })
$result.addressNull = $null -eq (ConvertTo-BylLanAddress -Text $null)
$result.private = @(foreach ($value in @($in.addresses)) { Test-BylPrivateIPv4 -Text $value })
$configs = [ordered]@{}
foreach ($case in $in.configs.PSObject.Properties) {
    $parsed = ConvertFrom-BylLanConfig -Text $case.Value
    # Assign first: the functions of the home network return their list as one pipeline object.
    $used = Get-BylLanAddress -Lan $parsed
    $configs[$case.Name] = [ordered]@{ present = $parsed.Present; enabled = $parsed.Enabled; addresses = @($parsed.Addresses); used = $used }
}
$result.configs = $configs
$usedNull = Get-BylLanAddress -Lan $null
$result.usedNull = $usedNull.Count
$on = ConvertFrom-BylLanConfig -Text $in.configs.on
$lanUsed = Get-BylLanAddress -Lan $on
$result.origins = [ordered]@{
    lan = Get-BylOrigins -Port 8095 -Lan $lanUsed
    both = Get-BylOrigins -Port 8095 -Hosts @('rechner.tailnet.ts.net') -Lan $lanUsed
    none = Get-BylOrigins -Port 8095 -Lan @()
}
$result.serverArgs = [ordered]@{
    lan = Get-ServerArgumentString -AppDir 'C:\app' -Port 8095 -Lan $lanUsed
    off = Get-ServerArgumentString -AppDir 'C:\app' -Port 8095 -Lan @()
    emptyEntry = Get-ServerArgumentString -AppDir 'C:\app' -Port 8095 -Lan @('')
}
$off = [pscustomobject]@{ Enabled = $false; Addresses = [string[]]@('192.168.178.20') }
$gone = [pscustomobject]@{ Enabled = $false; Addresses = [string[]]@() }
$switched = [pscustomobject]@{ Enabled = $true; Addresses = [string[]]@('Tower2.fritz.box', 'kaputt', '10.0.0.5', 'tower2.fritz.box') }
$result.merge = [ordered]@{
    portKeepsLan = Merge-BylConfigText -Text $in.configs.full -Port 8092
    hostsKeepLan = Merge-BylConfigText -Text $in.configs.full -Hosts @()
    setLan = Merge-BylConfigText -Text $in.configs.portOnly -Lan $switched
    offKeeps = Merge-BylConfigText -Text $in.configs.full -Lan $off
    remove = Merge-BylConfigText -Text $in.configs.full -Lan $gone
    fresh = Merge-BylConfigText -Text '' -Lan $switched
}
$result.mergeRead = [ordered]@{
    port = ConvertFrom-BylLanConfig -Text $result.merge.portKeepsLan
    hosts = @((ConvertFrom-BylSecurityConfig -Text $result.merge.portKeepsLan).Hosts)
    backup = (ConvertFrom-BylBackupConfig -Text $result.merge.offKeeps).Target
    off = ConvertFrom-BylLanConfig -Text $result.merge.offKeeps
}
$folder = Join-Path ([System.IO.Path]::GetTempPath()) ('byl-lan-' + [guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($folder)
try {
    $started = Get-BylFingerprint -AppDir $folder -Port 8095 -Lan @('192.168.178.20')
    $result.fingerprintLan = $started['lan']
    $result.fingerprintNone = (Get-BylFingerprint -AppDir $folder -Port 8095)['lan']
    $result.compare = [ordered]@{
        same = Compare-BylFingerprint -Started $started -Current (Get-BylFingerprint -AppDir $folder -Port 8095 -Lan @('192.168.178.20'))
        changed = Compare-BylFingerprint -Started $started -Current (Get-BylFingerprint -AppDir $folder -Port 8095 -Lan @('192.168.178.21'))
        off = Compare-BylFingerprint -Started $started -Current (Get-BylFingerprint -AppDir $folder -Port 8095)
    }
    $before = Get-BylFingerprint -AppDir $folder -Port 8095
    $before.Remove('lan')
    $result.compare.before = Compare-BylFingerprint -Started $before -Current (Get-BylFingerprint -AppDir $folder -Port 8095)
    $result.compare.beforeOn = Compare-BylFingerprint -Started $before -Current (Get-BylFingerprint -AppDir $folder -Port 8095 -Lan @('192.168.178.20'))
}
finally {
    Remove-Item -LiteralPath $folder -Recurse -Force
}
$result.restartParts = @($BylRestartParts)
$result.http = [ordered]@{ loopback = Get-HttpPort -Value '127.0.0.1:8090'; any = Get-HttpPort -Value '0.0.0.0:8090'; lan = Get-HttpPort -Value '192.168.178.20:8090'; ipv6 = Get-HttpPort -Value '[::]:8090' }
$appArgs = '--dir="' + $in.app + '\pb_data" --hooksDir="' + $in.app + '\pb_hooks"'
$processes = @(
    [pscustomobject]@{ ProcessId = 100; Name = 'pocketbase.exe'; ExecutablePath = $in.exe; CommandLine = ('"' + $in.exe + '" serve --http=0.0.0.0:8090 --origins=http://127.0.0.1:8090,http://localhost:8090,http://192.168.178.20:8090 ' + $appArgs) }
    [pscustomobject]@{ ProcessId = 400; Name = 'node.exe'; ExecutablePath = 'C:\node\node.exe'; CommandLine = 'node server.js' }
)
$result.select = @(Select-AppProcess -Process $processes -AppDir $in.app | ForEach-Object { [int]$_.ProcessId })
$result.ports = [ordered]@{
    ownAny = (Resolve-PortState -Listener @([pscustomobject]@{ LocalAddress = '0.0.0.0'; LocalPort = 8090; OwningProcess = 100 }) -Process $processes -AppDir $in.app -Port 8090).State
    ownDual = (Resolve-PortState -Listener @([pscustomobject]@{ LocalAddress = '::'; LocalPort = 8090; OwningProcess = 100 }) -Process $processes -AppDir $in.app -Port 8090).State
    foreignAny = (Resolve-PortState -Listener @([pscustomobject]@{ LocalAddress = '0.0.0.0'; LocalPort = 8090; OwningProcess = 400 }) -Process $processes -AppDir $in.app -Port 8090).State
}
$active = Get-BylActiveLan -Arguments (Get-ProcessArgument -Process $processes[0])
$result.active = [ordered]@{ bound = $active.Bound; hosts = @($active.Hosts) }
$quiet = Get-BylActiveLan -Arguments @('serve', '--http=127.0.0.1:8090', '--origins=http://127.0.0.1:8090,http://localhost:8090,https://rechner.tailnet.ts.net')
$result.activeOff = [ordered]@{ bound = $quiet.Bound; hosts = @($quiet.Hosts) }
$result.categories = @(foreach ($value in @('Private', 'Public', 'DomainAuthenticated', '', $null, 'x')) { ConvertTo-BylNetworkCategory -Value $value })
$candidates = Select-BylLanCandidate -Addresses @($in.network.addresses) -Profiles @($in.network.profiles) -Suffixes @($in.network.suffixes) -HostName 'TOWER2'
$result.candidates = @($candidates | ForEach-Object { [ordered]@{ address = $_.Address; kind = $_.Kind; adapter = $_.Adapter; category = $_.Category } })
# Assign first: the function returns its list as one pipeline object.
$badName = Select-BylLanCandidate -Addresses @($in.network.addresses) -Profiles @($in.network.profiles) -Suffixes @($in.network.suffixes) -HostName 'räch'
$result.candidatesBadName = @($badName | ForEach-Object { $_.Address })
$none = Select-BylLanCandidate -Addresses @() -Profiles @() -Suffixes @() -HostName ''
$result.candidatesNone = $none.Count
$states = Resolve-BylLanAddressState -Lan @('192.168.178.20', '192.168.178.99', '10.0.0.7', 'tower2.fritz.box') -Addresses @($in.network.addresses) -Profiles @($in.network.profiles)
$result.states = @($states | ForEach-Object { [ordered]@{ address = $_.Address; present = $_.Present; adapter = $_.Adapter; index = $_.Index; category = $_.Category } })
$firewall = [ordered]@{}
foreach ($case in $in.firewall.PSObject.Properties) {
    $state = Resolve-BylFirewallState -Rules @($case.Value) -Program $in.exe -Port 8090
    $firewall[$case.Name] = $state.State
}
$result.firewall = $firewall
$result.blocked = (Resolve-BylFirewallState -Rules @($in.firewall.present) -Blocks @([pscustomobject]@{ Name = 'pocketbase.exe'; Profile = 'Public' }) -Program $in.exe -Port 8090).Blocked
$result.notBlocked = (Resolve-BylFirewallState -Rules @() -Blocks @() -Program $in.exe -Port 8090).Blocked
$result.comRules = @(foreach ($comRule in @($in.com)) {
        $converted = ConvertFrom-BylFirewallRule -Rule $comRule
        [ordered]@{
            name = $converted.Name; enabled = $converted.Enabled; direction = $converted.Direction; action = $converted.Action
            profile = $converted.Profile; program = $converted.Program; protocol = $converted.Protocol; localPort = @($converted.LocalPort)
        }
    })
$snapshot = Get-BylFirewallSnapshot -Program $in.live -Read { @($in.com) }
$liveState = Resolve-BylFirewallState -Rules $snapshot.Rules -Blocks $snapshot.Blocks -Program $in.live -Port 8090
$result.snapshot = [ordered]@{
    available = $snapshot.Available; rules = @($snapshot.Rules).Count; blocks = @(@($snapshot.Blocks) | ForEach-Object { $_.Name })
    state = $liveState.State; blocked = $liveState.Blocked
}
$empty = Get-BylFirewallSnapshot -Program $in.live -Read { @() }
$result.unreadable = [ordered]@{
    denied = (Get-BylFirewallSnapshot -Program $in.live -Read { throw (New-Object System.UnauthorizedAccessException('Zugriff verweigert')) }).Available
    written = (Get-BylFirewallSnapshot -Program $in.live -Read { Write-Error 'Zugriff verweigert'; @() }).Available
    broken = (Get-BylFirewallSnapshot -Program $in.live -Read { @([pscustomobject]@{ Name = 'kaputt' }) }).Available
    empty = $empty.Available
    emptyState = (Resolve-BylFirewallState -Rules $empty.Rules -Blocks $empty.Blocks -Program $in.live -Port 8090).State
}
$result.elevation = [ordered]@{
    session0 = Resolve-BylElevationOutcome -Interactive $false -Finished $true -ExitCode 0
    declined = Resolve-BylElevationOutcome -Interactive $true -StartError 1223
    refused = Resolve-BylElevationOutcome -Interactive $true -StartError 5
    noCode = Resolve-BylElevationOutcome -Interactive $true -StartError -1
    waiting = Resolve-BylElevationOutcome -Interactive $true -Finished $false
    done = Resolve-BylElevationOutcome -Interactive $true -Finished $true -ExitCode 0
    netsh = Resolve-BylElevationOutcome -Interactive $true -Finished $true -ExitCode 1
    noExit = Resolve-BylElevationOutcome -Interactive $true -Finished $true
}
$result.elevationOutcomes = $BylElevationOutcomes
$result.win32 = [ordered]@{
    wrapped = Get-BylWin32ErrorCode -Exception (New-Object System.Management.Automation.MethodInvocationException('x', (New-Object System.ComponentModel.Win32Exception(1223))))
    deeper = Get-BylWin32ErrorCode -Exception (New-Object System.InvalidOperationException('a', (New-Object System.Exception('b', (New-Object System.ComponentModel.Win32Exception(5))))))
    without = Get-BylWin32ErrorCode -Exception (New-Object System.InvalidOperationException('kein Code'))
    nothing = Get-BylWin32ErrorCode -Exception $null
}
$final = [ordered]@{}
foreach ($action in @('add', 'remove')) {
    foreach ($elevation in @('done', 'failed', 'cancelled', 'timeout', 'unavailable')) {
        $final["$action/$elevation"] = @(foreach ($state in @('present', 'missing', 'mismatch', 'unknown')) {
                Resolve-BylFirewallOutcome -Action $action -Elevation $elevation -State $state
            })
    }
}
$result.final = $final
$scripts = [ordered]@{
    add = Get-BylFirewallScript -Action 'add' -Program $in.quoted -Port 8090
    remove = Get-BylFirewallScript -Action 'remove' -Program $in.quoted -Port 8090
}
$result.scripts = $scripts
$parse = [ordered]@{}
foreach ($name in @('add', 'remove')) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($scripts[$name], [ref]$tokens, [ref]$errors)
    $parse[$name] = [ordered]@{
        errors = @($errors).Count
        program = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$program' }, $true) | ForEach-Object { $_.Right.Expression.Value })
        commands = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ })
    }
}
$result.parse = $parse
$arguments = Get-BylElevatedArgumentString -Script $scripts.add
$result.arguments = $arguments
$encoded = ($arguments -split ' ')[-1]
$result.decoded = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded))
$result.commands = [ordered]@{
    add = Get-BylFirewallCommand -Action 'add' -Program $in.exe -Port 8090
    remove = Get-BylFirewallCommand -Action 'remove' -Program $in.exe -Port 8090
}
$result.ruleName = $BylLanRuleName
$result.max = $BylLanMax
$result | ConvertTo-Json -Depth 8 -Compress
`;

let result;

beforeAll(() => {
	result = runPowerShellJson(
		SCRIPT,
		{ addresses: ADDRESSES, configs: CONFIGS, app: APP, exe: EXE, quoted: QUOTED, network: NETWORK, firewall: FIREWALL, com: COM_RULES, live: LIVE },
		{ BYL_FUNCTIONS: FUNCTIONS_FILE }
	);
}, 60_000);

describe('addresses of the home network', () => {
	it('follow the same rule as lan-rules.js: private IPv4 or a local name, lower case, no port', () => {
		const expected = ADDRESSES.map((value) => lan.normalizeLanAddress(value) || null);
		expect(result.addresses.map((value) => value ?? null)).toEqual(expected);
		expect(expected.filter((value) => value !== null)).toEqual([
			'192.168.178.20',
			'192.168.178.20',
			'10.0.0.1',
			'10.255.255.254',
			'172.16.0.1',
			'172.31.255.1',
			'tower2.fritz.box',
			'tower2.local',
			'nas.home.arpa',
			'pc.lan',
			'pc.internal',
			`${'a'.repeat(63)}.fritz.box`
		]);
		expect(result.addressNull).toBe(true);
		expect(result.private).toEqual(ADDRESSES.map((value) => lan.isPrivateIPv4(value)));
		expect(result.max).toBe(lan.LAN_MAX);
		expect(result.ruleName).toBe(lan.RULE_NAME);
	});

	it('are read from network.lan: on only with a real true, valid entries once, at most five', () => {
		expect(result.configs.none).toEqual({ present: false, enabled: false, addresses: [], used: [] });
		expect(result.configs.portOnly).toEqual({ present: false, enabled: false, addresses: [], used: [] });
		expect(result.configs.on).toEqual({
			present: true,
			enabled: true,
			addresses: ['192.168.178.20', 'tower2.fritz.box'],
			used: ['192.168.178.20', 'tower2.fritz.box']
		});
		expect(result.configs.off).toEqual({ present: true, enabled: false, addresses: ['192.168.178.20'], used: [] });
		expect(result.configs.textSwitch).toMatchObject({ enabled: false, used: [] });
		expect(result.configs.noAddresses).toEqual({ present: true, enabled: true, addresses: [], used: [] });
		expect(result.configs.single.used).toEqual(['10.0.0.5']);
		expect(result.configs.many.addresses).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5']);
		for (const name of ['wrongType', 'broken']) {
			expect(result.configs[name], name).toEqual({ present: false, enabled: false, addresses: [], used: [] });
		}
		expect(result.usedNull).toBe(0);
	});
});

describe('start with the home network', () => {
	it('listens on 0.0.0.0 with the http origins of the addresses, the further hosts over https after them', () => {
		expect(result.origins.lan).toBe(
			'http://127.0.0.1:8095,http://localhost:8095,http://192.168.178.20:8095,http://tower2.fritz.box:8095'
		);
		expect(result.origins.both).toBe(`${result.origins.lan},https://rechner.tailnet.ts.net`);
		expect(result.origins.none).toBe('http://127.0.0.1:8095,http://localhost:8095');
		expect(result.serverArgs.lan).toMatch(
			/^serve --http=0\.0\.0\.0:8095 --origins=http:\/\/127\.0\.0\.1:8095,http:\/\/localhost:8095,http:\/\/192\.168\.178\.20:8095,http:\/\/tower2\.fritz\.box:8095 --dir=/
		);
		expect(result.serverArgs.off).toMatch(/^serve --http=127\.0\.0\.1:8095 --origins=http:\/\/127\.0\.0\.1:8095,http:\/\/localhost:8095 --dir=/);
		expect(result.serverArgs.emptyEntry).toBe(result.serverArgs.off);
	});

	it('gives the guard exactly these hosts, and the page keeps them apart from the further hosts', () => {
		const port = 8095;
		const hosts = security.originHosts(result.origins.both);
		expect(hosts).toEqual(['127.0.0.1:8095', 'localhost:8095', '192.168.178.20:8095', 'tower2.fritz.box:8095', 'rechner.tailnet.ts.net']);
		expect(lan.activeLanHosts(result.origins.both)).toEqual(['192.168.178.20:8095', 'tower2.fritz.box:8095']);
		expect(security.activeExtraHosts(result.origins.both, port)).toEqual(['rechner.tailnet.ts.net']);
		expect(lan.lanBound(/--http=(\S+)/.exec(result.serverArgs.lan)[1])).toBe(true);
		expect(lan.lanBound(/--http=(\S+)/.exec(result.serverArgs.off)[1])).toBe(false);
	});

	it('keeps the setting when port, backup or hosts change, keeps the addresses when switched off', () => {
		expect(result.mergeRead.port).toEqual({ Present: true, Enabled: true, Addresses: ['192.168.178.20'] });
		expect(result.mergeRead.hosts).toEqual(['rechner.tailnet.ts.net']);
		expect(result.merge.portKeepsLan).toContain('"port": 8092');
		expect(JSON.parse(result.merge.hostsKeepLan).network).toEqual({ lan: { enabled: true, addresses: ['192.168.178.20'] } });
		expect(result.merge.setLan).toBe(
			'{\r\n  "port": 8091,\r\n  "network": {\r\n    "lan": {\r\n      "enabled": true,\r\n      "addresses": ["tower2.fritz.box", "10.0.0.5"]\r\n    }\r\n  }\r\n}\r\n'
		);
		expect(JSON.parse(result.merge.offKeeps).network).toEqual({ lan: { enabled: false, addresses: ['192.168.178.20'] } });
		expect(result.mergeRead.off).toEqual({ Present: true, Enabled: false, Addresses: ['192.168.178.20'] });
		expect(result.mergeRead.backup).toBe('E:\\Sicherung');
		expect(JSON.parse(result.merge.remove)).not.toHaveProperty('network');
		expect(JSON.parse(result.merge.remove)).toMatchObject({ port: 8091, security: { hosts: ['rechner.tailnet.ts.net'] } });
		expect(JSON.parse(result.merge.fresh)).toEqual({ network: { lan: { enabled: true, addresses: ['tower2.fritz.box', '10.0.0.5'] } } });
	});

	it('needs a restart when the addresses in use change, not for a state of before without the part', () => {
		expect(result.restartParts).toContain('lan');
		expect(result.fingerprintLan).toBe('192.168.178.20');
		expect(result.fingerprintNone).toBe('');
		expect(result.compare.same).toMatchObject({ Verdict: 'Current', Restart: [] });
		expect(result.compare.changed).toMatchObject({ Verdict: 'Restart', Restart: ['lan'] });
		expect(result.compare.off).toMatchObject({ Verdict: 'Restart', Restart: ['lan'] });
		expect(result.compare.before).toMatchObject({ Verdict: 'Current', Restart: [] });
		expect(result.compare.beforeOn).toMatchObject({ Verdict: 'Restart', Restart: ['lan'] });
	});
});

describe('the own instance on 0.0.0.0', () => {
	it('is found by its program and data folder, also on the wildcard addresses; a foreign one stays foreign', () => {
		expect(result.http).toEqual({ loopback: 8090, any: 8090, lan: null, ipv6: null });
		expect(result.select).toEqual([100]);
		expect(result.ports).toEqual({ ownAny: 'App', ownDual: 'App', foreignAny: 'Foreign' });
	});

	it('tells what it allows in the home network from its arguments', () => {
		expect(result.active).toEqual({ bound: true, hosts: ['192.168.178.20:8090'] });
		expect(result.activeOff).toEqual({ bound: false, hosts: [] });
	});
});

describe('addresses of this computer', () => {
	it('offers the private IPv4 addresses in use with adapter and network, private networks first, and the name of the FRITZ!Box', () => {
		expect(result.categories).toEqual(['private', 'public', 'domain', 'unknown', 'unknown', 'unknown']);
		expect(result.candidates).toEqual([
			{ address: '10.0.0.7', kind: 'ip', adapter: 'WLAN', category: 'private' },
			{ address: '172.20.48.1', kind: 'ip', adapter: 'vEthernet (WSL)', category: 'unknown' },
			{ address: '192.168.178.20', kind: 'ip', adapter: 'Ethernet', category: 'public' },
			{ address: 'tower2.fritz.box', kind: 'name', adapter: 'Ethernet', category: 'public' }
		]);
		// A name that is no DNS label gives no name; without anything there is nothing to offer.
		expect(result.candidatesBadName).toEqual(['10.0.0.7', '172.20.48.1', '192.168.178.20']);
		expect(result.candidatesNone).toBe(0);
	});

	it('says for every chosen address whether an adapter has it and in which network', () => {
		expect(result.states).toEqual([
			{ address: '192.168.178.20', present: true, adapter: 'Ethernet', index: 8, category: 'public' },
			{ address: '192.168.178.99', present: false, adapter: '', index: null, category: 'unknown' },
			{ address: '10.0.0.7', present: true, adapter: 'WLAN', index: 12, category: 'private' },
			{ address: 'tower2.fritz.box', present: null, adapter: '', index: null, category: 'unknown' }
		]);
	});
});

describe('the firewall rule', () => {
	it('is present only as a switched-on inbound allow rule for this program, TCP on the port, in private networks', () => {
		expect(result.firewall).toEqual({
			present: 'present',
			presentAny: 'present',
			presentBoth: 'present',
			otherCase: 'present',
			oldPort: 'mismatch',
			publicOnly: 'mismatch',
			off: 'mismatch',
			blockAction: 'mismatch',
			outbound: 'mismatch',
			udp: 'mismatch',
			otherFolder: 'missing',
			none: 'missing',
			mixed: 'present'
		});
		expect(result.blocked).toBe(true);
		expect(result.notBlocked).toBe(false);
	});

	it('is changed by netsh of the system folder in a script that only names the rule, the quoted program and the port', () => {
		for (const name of ['add', 'remove']) {
			expect(result.parse[name].errors, name).toBe(0);
			expect(result.parse[name].program, name).toEqual([QUOTED]);
			// No cmdlet changes the firewall; netsh runs as "& $netsh", only Out-Null is named.
			expect(new Set(result.parse[name].commands), name).toEqual(new Set(['Out-Null']));
		}
		const head = [
			"$netsh = [System.IO.Path]::Combine([Environment]::SystemDirectory, 'netsh.exe')",
			"$name = 'becauseyoulovejira (Heimnetz)'",
			"$program = 'C:\\Users\\O''Brien\\app\\pocketbase.exe'"
		];
		const show = '& $netsh advfirewall firewall show rule "name=$name" | Out-Null';
		const remove = '& $netsh advfirewall firewall delete rule "name=$name" "program=$program" | Out-Null';
		// add: first away with every rule of the name for this program (old port, a second one by hand).
		expect(result.scripts.add.split('\r\n')).toEqual([
			...head,
			"$description = 'Access of devices in the home network to becauseyoulovejira (private networks only), created by byl-control.ps1'",
			show,
			`if ($LASTEXITCODE -eq 0) { ${remove} }`,
			'& $netsh advfirewall firewall add rule "name=$name" "description=$description" dir=in action=allow protocol=TCP localport=8090 "program=$program" profile=private enable=yes | Out-Null',
			'exit $LASTEXITCODE'
		]);
		// remove: nothing named so is nothing to remove.
		expect(result.scripts.remove.split('\r\n')).toEqual([...head, show, 'if ($LASTEXITCODE -ne 0) { exit 0 }', remove, 'exit $LASTEXITCODE']);
		expect(result.arguments).toMatch(/^-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/);
		expect(result.decoded).toBe(result.scripts.add);
	});

	it('has the same change as a command to copy, the one of the catalog with the real paths', () => {
		expect(result.commands.add).toBe(
			`netsh advfirewall firewall add rule name="becauseyoulovejira (Heimnetz)" dir=in action=allow protocol=TCP localport=8090 program="${EXE}" profile=private`
		);
		expect(result.commands.remove).toBe(`netsh advfirewall firewall delete rule name="becauseyoulovejira (Heimnetz)" program="${EXE}"`);
		// The script of the button changes the same: every part of the command by hand is in it.
		for (const part of ['advfirewall firewall add rule', 'dir=in', 'action=allow', 'protocol=TCP', 'localport=8090', 'profile=private']) {
			expect(result.scripts.add, part).toContain(part);
		}
	});

	it('is read like HNetCfg.FwPolicy2 tells it, without administrator rights: both rules of the bug report count as present', () => {
		expect(result.comRules[0]).toEqual({
			name: 'becauseyoulovejira (Heimnetz)',
			enabled: 'True',
			direction: 'Inbound',
			action: 'Allow',
			profile: 'Private',
			program: LIVE,
			protocol: 'TCP',
			localPort: ['8090']
		});
		expect(result.comRules[2]).toMatchObject({ name: 'pocketbase', protocol: 'UDP', profile: 'Public', localPort: ['Any'] });
		expect(result.comRules[5]).toMatchObject({ enabled: 'False', action: 'Block' });
		expect(result.comRules[6]).toMatchObject({ direction: 'Outbound' });
		expect(result.comRules[8]).toMatchObject({ protocol: 'Any', profile: 'Any', localPort: ['Any'] });
		expect(result.comRules[8].program).toMatch(/^[A-Za-z]:\\windows\\system32\\svchost\.exe$/i);
		expect(result.comRules[9]).toMatchObject({ profile: 'Domain, Private', protocol: '41', localPort: ['8090', '8091'] });
		// Named rules of this and another folder; the one switched-on inbound block rule of the program.
		expect(result.snapshot).toEqual({ available: true, rules: 3, blocks: ['pocketbase.exe'], state: 'present', blocked: true });
	});

	it('is "not readable" when Windows denies the read, never "missing" (regression of the bug report)', () => {
		// Get-NetFirewallRule -ErrorAction SilentlyContinue gave nothing on "Zugriff verweigert", and
		// the page showed "Fehlt" right after the button had created the rule.
		expect(result.unreadable).toEqual({ denied: false, written: false, broken: false, empty: true, emptyState: 'missing' });
	});
});

describe('a change of the firewall rule', () => {
	it('tells declined, no answer, not possible and an error of netsh apart', () => {
		expect(result.elevation).toEqual({
			session0: 'unavailable',
			declined: 'cancelled',
			refused: 'unavailable',
			noCode: 'unavailable',
			waiting: 'timeout',
			done: 'done',
			netsh: 'failed',
			noExit: 'failed'
		});
		expect(result.elevationOutcomes).toEqual(['done', 'cancelled', 'timeout', 'unavailable', 'failed']);
		expect(result.win32).toEqual({ wrapped: 1223, deeper: 5, without: null, nothing: null });
	});

	it('counts as done only when the rule read again afterwards really is so (state present, missing, mismatch, unknown)', () => {
		expect(result.final).toEqual({
			'add/done': ['done', 'unconfirmed', 'unconfirmed', 'unconfirmed'],
			'add/failed': ['done', 'failed', 'failed', 'failed'],
			'add/cancelled': ['cancelled', 'cancelled', 'cancelled', 'cancelled'],
			'add/timeout': ['timeout', 'timeout', 'timeout', 'timeout'],
			'add/unavailable': ['unavailable', 'unavailable', 'unavailable', 'unavailable'],
			'remove/done': ['unconfirmed', 'done', 'unconfirmed', 'unconfirmed'],
			'remove/failed': ['failed', 'done', 'failed', 'failed'],
			'remove/cancelled': ['cancelled', 'cancelled', 'cancelled', 'cancelled'],
			'remove/timeout': ['timeout', 'timeout', 'timeout', 'timeout'],
			'remove/unavailable': ['unavailable', 'unavailable', 'unavailable', 'unavailable']
		});
		// Every outcome the page reads, and no other.
		const outcomes = new Set(Object.values(result.final).flat());
		expect([...outcomes].sort()).toEqual([...lan.FIREWALL_OUTCOMES].sort());
	});

	it('starts the script in a runspace of its own: exit code, code of Windows of a failed start, and it gives up after the time (verb runas taken out, never elevated)', () => {
		// The start of byl-control.ps1 itself, with the one line of the verb taken out: harmless
		// programs instead of the elevated Windows PowerShell, so nothing asks and nothing changes.
		const probe = runPowerShellJson(
			String.raw`
. $env:BYL_FUNCTIONS
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$control = [System.IO.File]::ReadAllText($env:BYL_CONTROL)
$start = $control.IndexOf('$runner.AddScript({') + '$runner.AddScript('.Length
$text = $control.Substring($start + 1, $control.IndexOf('}.ToString())', $start) - $start - 1)
$plain = $text.Replace('$info.Verb = ''runas''', '')
function Invoke-Runner([string]$File, [string]$Arguments, [int]$Milliseconds) {
    $runner = [powershell]::Create()
    [void]$runner.AddScript($plain).AddArgument($File).AddArgument($Arguments)
    $pending = $runner.BeginInvoke()
    if (-not $pending.AsyncWaitHandle.WaitOne($Milliseconds)) { return 'timeout' }
    $answer = @($runner.EndInvoke($pending))[0]
    $runner.Dispose()
    if ($null -ne $answer.Error) { return Get-BylWin32ErrorCode -Exception $answer.Error }
    return $answer.ExitCode
}
$cmd = [System.IO.Path]::Combine([Environment]::SystemDirectory, 'cmd.exe')
[ordered]@{
    removed = $plain -ne $text -and $plain -notmatch 'runas'
    exit = Invoke-Runner -File $cmd -Arguments '/c exit 3' -Milliseconds $in.wait
    missing = Invoke-Runner -File ([System.IO.Path]::Combine($in.dir, 'gibt-es-nicht.exe')) -Arguments '' -Milliseconds $in.wait
    slow = Invoke-Runner -File $cmd -Arguments '/c ping -n 3 127.0.0.1' -Milliseconds 100
} | ConvertTo-Json -Compress`,
			{ wait: scaled(30_000), dir: ROOT_DIR },
			{ BYL_FUNCTIONS: FUNCTIONS_FILE, BYL_CONTROL: join(ROOT_DIR, 'app', 'byl-control.ps1') }
		);
		expect(probe).toEqual({ removed: true, exit: 3, missing: 2, slow: 'timeout' });
	});
});
