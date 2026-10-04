// Pure functions of byl-control.ps1 for the access in the home network (plan docs/plan/heimnetz.md,
// ADR-0055 addendum): the addresses (the same rule as lib/lan-rules.js), byl-config.json, the start
// arguments and origins, the fingerprint, the own instance on 0.0.0.0, the addresses of the
// computer to choose from, the network category, the state of the firewall rule and the script and
// command that change it. Only app/byl-functions.ps1 runs here, never a script, a server, the
// firewall or a prompt for administrator rights; the network and the firewall are fakes.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { runPowerShellJson } from '../support/powershell.mjs';

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
		{ addresses: ADDRESSES, configs: CONFIGS, app: APP, exe: EXE, quoted: QUOTED, network: NETWORK, firewall: FIREWALL },
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

	it('is changed by a script that only names the rule, the quoted program and the port', () => {
		for (const name of ['add', 'remove']) {
			expect(result.parse[name].errors, name).toBe(0);
			expect(result.parse[name].program, name).toEqual([QUOTED]);
		}
		expect(result.parse.add.commands).toEqual([
			'Get-NetFirewallRule',
			'Get-NetFirewallApplicationFilter',
			'Remove-NetFirewallRule',
			'New-NetFirewallRule',
			'Out-Null'
		]);
		expect(result.parse.remove.commands).toEqual(['Get-NetFirewallRule', 'Get-NetFirewallApplicationFilter', 'Remove-NetFirewallRule']);
		expect(result.scripts.add).toContain(
			'New-NetFirewallRule -DisplayName $name -Description \'Access of devices in the home network to becauseyoulovejira (private networks only), created by byl-control.ps1\' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8090 -Program $program -Profile Private -Enabled True | Out-Null'
		);
		expect(result.scripts.add).toContain("$name = 'becauseyoulovejira (Heimnetz)'");
		expect(result.scripts.add).toContain("$program = 'C:\\Users\\O''Brien\\app\\pocketbase.exe'");
		expect(result.scripts.remove).not.toContain('New-NetFirewallRule');
		expect(result.arguments).toMatch(/^-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/);
		expect(result.decoded).toBe(result.scripts.add);
	});

	it('has the same change as a command to copy, the one of the catalog with the real paths', () => {
		expect(result.commands.add).toBe(
			`netsh advfirewall firewall add rule name="becauseyoulovejira (Heimnetz)" dir=in action=allow protocol=TCP localport=8090 program="${EXE}" profile=private`
		);
		expect(result.commands.remove).toBe(`netsh advfirewall firewall delete rule name="becauseyoulovejira (Heimnetz)" program="${EXE}"`);
	});
});
