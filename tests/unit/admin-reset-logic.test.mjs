// Input checks and command line of the admin reset (admin-zuruecksetzen.bat, E1.1). Only the pure
// functions of app/byl-functions.ps1 run; the batch file is never executed (CLAUDE.md §11.3).
// The quoting is checked against a real Windows command line parser (node's argv).

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSyncClean } from '../support/clean-env.mjs';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');
const APP = 'C:\\Program Files\\byl #1\\app';

const CREDENTIALS = {
	valid: ['admin@example.com', 'richtig-lang', 'richtig-lang'],
	validUnicode: ['admin@example.com', 'Grüße aus Köln', 'Grüße aus Köln'],
	validMaxBytes: ['admin@example.com', 'a'.repeat(71), 'a'.repeat(71)],
	emailEmpty: ['', 'richtig-lang', 'richtig-lang'],
	emailNoAt: ['admin.example.com', 'richtig-lang', 'richtig-lang'],
	emailNoDot: ['admin@localhost', 'richtig-lang', 'richtig-lang'],
	emailSpace: ['ad min@example.com', 'richtig-lang', 'richtig-lang'],
	emailQuote: ['"admin"@example.com', 'richtig-lang', 'richtig-lang'],
	mismatch: ['admin@example.com', 'richtig-lang', 'richtig-lanG'],
	tooShort: ['admin@example.com', 'kurz-9-zz', 'kurz-9-zz'],
	emptyPassword: ['admin@example.com', '', ''],
	tooLong: ['admin@example.com', 'a'.repeat(72), 'a'.repeat(72)],
	tooLongBytes: ['admin@example.com', 'ä'.repeat(36), 'ä'.repeat(36)],
	quote: ['admin@example.com', 'mit "Zitat"', 'mit "Zitat"'],
	control: ['admin@example.com', 'mit\ttabulator', 'mit\ttabulator']
};

const ARGUMENTS = [
	'plain',
	'',
	'with space',
	'trailing\\',
	'trailing space\\',
	'two\\\\ back\\\\',
	'a\\"b',
	'"quoted"',
	'-dash start',
	'Grüße ä',
	'C:\\Program Files\\byl #1\\app\\pb_data'
];

const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = @{}
$checks = @{}
foreach ($entry in $in.credentials.PSObject.Properties) {
    $value = $entry.Value
    $checks[$entry.Name] = Test-AdminCredential -Email $value[0] -Password $value[1] -Confirmation $value[2]
}
$result.checks = $checks
$result.quoted = @($in.arguments | ForEach-Object { ConvertTo-ProcessArgument -Value $_ })
$result.upsert = Get-AdminUpsertArgument -AppDir $in.appDir -Email 'admin@example.com' -Password '-geheim mit Leer\'
$result.throwaway = Get-AdminUpsertArgument -AppDir $in.appDir -Email 'p@example.invalid' -Password 'Pzufall' -DataDir 'C:\Temp\byl-pruefung-1\pb_data' -HooksDir 'C:\Temp\byl-pruefung-1\hooks'
$result.limits = @{ min = $BylAdminPasswordMinLength; max = $BylAdminPasswordMaxBytes }
$result | ConvertTo-Json -Depth 4 -Compress
`;

let result;

beforeAll(() => {
	result = runPowerShellJson(
		SCRIPT,
		{ credentials: CREDENTIALS, arguments: ARGUMENTS, appDir: APP },
		{ BYL_FUNCTIONS: FUNCTIONS_FILE }
	);
}, 60_000);

/** argv as a Windows program sees it for the given raw command line tail. */
function parseCommandLine(tail) {
	const child = spawnSyncClean(process.execPath, ['-p', 'JSON.stringify(process.argv.slice(1))', tail], {
		encoding: 'utf8',
		windowsHide: true,
		windowsVerbatimArguments: true
	});
	if (child.status !== 0) throw new Error(child.stderr);
	return JSON.parse(child.stdout);
}

describe('Test-AdminCredential', () => {
	it.each([
		['valid', null],
		['validUnicode', null],
		['validMaxBytes', null],
		['emailEmpty', 'EmailInvalid'],
		['emailNoAt', 'EmailInvalid'],
		['emailNoDot', 'EmailInvalid'],
		['emailSpace', 'EmailInvalid'],
		['emailQuote', 'EmailInvalid'],
		['mismatch', 'PasswordMismatch'],
		['tooShort', 'PasswordTooShort'],
		['emptyPassword', 'PasswordTooShort'],
		['tooLong', 'PasswordTooLong'],
		['tooLongBytes', 'PasswordTooLong'],
		['quote', 'PasswordCharacter'],
		['control', 'PasswordCharacter']
	])('%s -> %s', (name, expected) => {
		expect(result.checks[name]).toBe(expected);
	});

	it('requires at least 10 characters and at most 71 bytes', () => {
		expect(result.limits).toEqual({ min: 10, max: 71 });
	});
});

describe('ConvertTo-ProcessArgument', () => {
	it('round-trips every value through a real Windows command line parser', () => {
		expect(parseCommandLine(result.quoted.join(' '))).toEqual(ARGUMENTS);
	});

	it('leaves simple values unquoted', () => {
		expect(result.quoted[0]).toBe('plain');
		expect(result.quoted[1]).toBe('""');
	});
});

describe('Get-AdminUpsertArgument', () => {
	it('puts the flags first and ends them with "--" before e-mail and password', () => {
		expect(parseCommandLine(result.upsert)).toEqual([
			'superuser',
			'upsert',
			`--dir=${APP}\\pb_data`,
			`--hooksDir=${APP}\\pb_hooks`,
			`--migrationsDir=${APP}\\pb_migrations`,
			'--automigrate=false',
			'--',
			'admin@example.com',
			'-geheim mit Leer\\'
		]);
	});

	it('takes the copy of a backup and an empty hooks folder for the throwaway server of a check (ADR-0046)', () => {
		expect(parseCommandLine(result.throwaway)).toEqual([
			'superuser',
			'upsert',
			'--dir=C:\\Temp\\byl-pruefung-1\\pb_data',
			'--hooksDir=C:\\Temp\\byl-pruefung-1\\hooks',
			`--migrationsDir=${APP}\\pb_migrations`,
			'--automigrate=false',
			'--',
			'p@example.invalid',
			'Pzufall'
		]);
	});
});
