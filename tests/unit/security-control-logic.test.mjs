// Pure functions of byl-control.ps1 for the security hardening (ADR-0055, plan docs/plan/sicherheit.md,
// SH-1): the further hosts of byl-config.json (the same rule as lib/security-rules.js), the CORS
// origins of the start, the merge of the file and the server arguments. Only app/byl-functions.ps1
// runs here, never a script or a server.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');
const rules = loadHookLib('security-rules.js');

const HOSTS = [
	'rechner.tailnet.ts.net',
	' Rechner.Tailnet.TS.net ',
	'pi.local:8443',
	'a-b.c1.example',
	'',
	'localhost',
	'127.0.0.1',
	'100.64.0.1',
	'[::1]',
	'https://rechner.ts.net',
	'rechner.ts.net/pfad',
	'*.ts.net',
	'-a.example.org',
	'a..example.org',
	'rechner.ts.net:0',
	'rechner.ts.net:65535',
	'rechner.ts.net:65536',
	'räch.ts.net',
	`${'a'.repeat(63)}.example.org`,
	`${'a'.repeat(64)}.example.org`,
	`${'abc.'.repeat(63)}org`,
	'rechner.ts.net:\u0661\u0662\u0663'
];
const MANY = Array.from({ length: 12 }, (_, index) => `host${index}.example.org`);
const CONFIGS = {
	none: '',
	portOnly: '{ "port": 8091 }',
	broken: '{',
	empty: JSON.stringify({ security: { hosts: [] } }),
	noHosts: JSON.stringify({ security: {} }),
	listed: JSON.stringify({ port: 8091, security: { hosts: ['Rechner.tailnet.ts.net', 'rechner.tailnet.ts.net', 'localhost', 42, 'pi.local:8443'] } }),
	single: JSON.stringify({ security: { hosts: 'rechner.tailnet.ts.net' } }),
	many: JSON.stringify({ security: { hosts: MANY } }),
	wrongType: JSON.stringify({ security: 'rechner.tailnet.ts.net' }),
	full: JSON.stringify({ port: 8091, backup: { target: 'E:\\Sicherung', daily: 3, weekly: 2, monthly: 6, credentials: false }, security: { hosts: ['rechner.tailnet.ts.net'] } })
};

const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = @{}
$result.hosts = @(foreach ($value in @($in.hosts)) { ConvertTo-BylExtraHost -Text $value })
$result.hostsNull = $null -eq (ConvertTo-BylExtraHost -Text $null)
$configs = @{}
foreach ($case in $in.configs.PSObject.Properties) {
    $parsed = ConvertFrom-BylSecurityConfig -Text $case.Value
    $configs[$case.Name] = @{ present = $parsed.Present; hosts = @($parsed.Hosts) }
}
$result.configs = $configs
$result.origins = @{
    own = Get-BylOrigins -Port 8095
    further = Get-BylOrigins -Port 8095 -Hosts @('rechner.tailnet.ts.net', 'pi.local:8443')
    nullHosts = Get-BylOrigins -Port 8095 -Hosts $null
}
$result.merge = @{
    portKeepsHosts = Merge-BylConfigText -Text $in.configs.full -Port 8092
    setHosts = Merge-BylConfigText -Text $in.configs.portOnly -Hosts @('Pi.Local:8443', 'kaputt', 'pi.local:8443')
    removeHosts = Merge-BylConfigText -Text $in.configs.full -Hosts @()
    fresh = Merge-BylConfigText -Text '' -Hosts @('rechner.tailnet.ts.net')
}
$result.mergeRead = @((ConvertFrom-BylSecurityConfig -Text $result.merge.portKeepsHosts).Hosts)
$result.mergeBackup = (ConvertFrom-BylBackupConfig -Text $result.merge.portKeepsHosts).Target
$result.mergePort = (ConvertFrom-BylConfig -Text $result.merge.removeHosts).Port
$result.serverArgs = Get-ServerArgumentString -AppDir 'C:\app' -Port 8095 -Hosts @('rechner.tailnet.ts.net')
$result | ConvertTo-Json -Depth 6 -Compress
`;

let result;

beforeAll(() => {
	result = runPowerShellJson(SCRIPT, { hosts: HOSTS, configs: CONFIGS }, { BYL_FUNCTIONS: FUNCTIONS_FILE });
}, 60_000);

describe('further hosts (ADR-0055 section 3)', () => {
	it('follow the same rule as security-rules.js', () => {
		const expected = HOSTS.map((value) => rules.normalizeExtraHost(value) || null);
		expect(result.hosts.map((value) => value ?? null)).toEqual(expected);
		expect(expected.filter((value) => value !== null)).toEqual([
			'rechner.tailnet.ts.net',
			'rechner.tailnet.ts.net',
			'pi.local:8443',
			'a-b.c1.example',
			'rechner.ts.net:65535',
			`${'a'.repeat(63)}.example.org`
		]);
		expect(result.hostsNull).toBe(true);
	});

	it('are read from security.hosts: valid, lower case, once, at most ten; everything else is left out', () => {
		expect(result.configs.none).toEqual({ present: false, hosts: [] });
		expect(result.configs.portOnly).toEqual({ present: false, hosts: [] });
		expect(result.configs.broken).toEqual({ present: false, hosts: [] });
		expect(result.configs.empty).toEqual({ present: true, hosts: [] });
		expect(result.configs.noHosts).toEqual({ present: true, hosts: [] });
		expect(result.configs.listed).toEqual({ present: true, hosts: ['rechner.tailnet.ts.net', 'pi.local:8443'] });
		expect(result.configs.single).toEqual({ present: true, hosts: ['rechner.tailnet.ts.net'] });
		expect(result.configs.many).toEqual({ present: true, hosts: MANY.slice(0, 10) });
		expect(result.configs.wrongType).toEqual({ present: false, hosts: [] });
	});
});

describe('CORS origins of the start', () => {
	it('allow only the app on this machine and the further hosts over HTTPS', () => {
		expect(result.origins.own).toBe('http://127.0.0.1:8095,http://localhost:8095');
		expect(result.origins.nullHosts).toBe(result.origins.own);
		expect(result.origins.further).toBe(
			'http://127.0.0.1:8095,http://localhost:8095,https://rechner.tailnet.ts.net,https://pi.local:8443'
		);
		// The guard of the server reads back exactly these hosts.
		expect(rules.originHosts(result.origins.further)).toEqual([
			'127.0.0.1:8095',
			'localhost:8095',
			'rechner.tailnet.ts.net',
			'pi.local:8443'
		]);
		expect(result.serverArgs).toMatch(
			/^serve --http=127\.0\.0\.1:8095 --origins=http:\/\/127\.0\.0\.1:8095,http:\/\/localhost:8095,https:\/\/rechner\.tailnet\.ts\.net --dir=/
		);
	});
});

describe('byl-config.json with further hosts', () => {
	it('keeps them when the port or the backup changes, and sets or removes them on request', () => {
		expect(result.mergeRead).toEqual(['rechner.tailnet.ts.net']);
		expect(result.mergeBackup).toBe('E:\\Sicherung');
		expect(result.merge.portKeepsHosts).toContain('"port": 8092');
		expect(result.merge.setHosts).toBe('{\r\n  "port": 8091,\r\n  "security": {\r\n    "hosts": ["pi.local:8443"]\r\n  }\r\n}\r\n');
		expect(result.merge.removeHosts).not.toContain('security');
		expect(result.merge.removeHosts).toContain('"backup"');
		expect(result.mergePort).toBe(8091);
		expect(JSON.parse(result.merge.fresh)).toEqual({ security: { hosts: ['rechner.tailnet.ts.net'] } });
	});
});
