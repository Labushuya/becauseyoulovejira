// Pure functions of byl-control.ps1 for the access data of the page "Kanäle" (BW-3, ADR-0075): the
// second check of a name and of a value in the control script, after the one of the server
// (app/pb_hooks/lib/credential-rules.js, the same lists and limits). Only app/byl-functions.ps1
// runs here, never a script, a server or a write into the environment.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');
const rules = loadHookLib('credential-rules.js');

const NAMES = [
	'BYL_TELEGRAM_TOKEN',
	'BYL_FOREIGN',
	'BYL_INGEST_TOKEN',
	'BYL_TELEGRAM_API_BASE',
	'BYL_TEST_ISOLATED',
	'BYL_TEST_ACCOUNT_FILE',
	'byl_telegram_token',
	'PATH',
	'BYL_',
	`BYL_${'A'.repeat(61)}`,
	''
];
const VALUES = [' geheim ', 'äöü € 🔑', 'a'.repeat(4096), '', '   ', 'a\nb', 'a\r\nb', '\tx', 'x\u0000', 'x\u007f', 'x\u0085', 'a'.repeat(4097)];

const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = @{}
$result.names = @(foreach ($name in $in.names) { [string](Test-BylCredentialName -Name $name) })
$result.values = @(foreach ($value in $in.values) { [string](Test-BylCredentialValue -Value $value) })
$result.nullName = [string](Test-BylCredentialName -Name $null)
$result.nullValue = [string](Test-BylCredentialValue -Value $null)
$result.numberValue = [string](Test-BylCredentialValue -Value 42)
ConvertTo-Json -InputObject $result -Depth 4 -Compress`;

let result;

beforeAll(() => {
	result = runPowerShellJson(SCRIPT, { names: NAMES, values: VALUES }, { BYL_FUNCTIONS: FUNCTIONS_FILE });
}, 60_000);

/** The answer of the server for the same input: '' where the control script answers $null. */
const serverName = (name) => {
	const problem = rules.nameProblem(name, [name], loadHookLib('secrets.js'));
	return problem === 'unknown' ? '' : problem;
};

describe('credential-set checks again what the server checked (S4, S8)', () => {
	it('refuses names outside the pattern and names of the system like the server', () => {
		expect(result.names).toEqual(NAMES.map(serverName));
		expect(result.names).toEqual(['', '', 'blocked', 'blocked', 'blocked', 'blocked', 'name', 'name', 'name', 'name', 'name']);
		expect(result.nullName).toBe('name');
	});

	it('refuses empty values, control characters and more than 4096 characters like the server, never trimmed', () => {
		expect(result.values).toEqual(VALUES.map((value) => rules.valueProblem(value)));
		expect(result.values).toEqual(['', '', '', 'empty', 'empty', 'control', 'control', 'control', 'control', 'control', 'control', 'long']);
		expect(result.nullValue).toBe('invalid');
		expect(result.numberValue).toBe('invalid');
	});
});
