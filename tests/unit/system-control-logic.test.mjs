// Pure functions of byl-control.ps1 for the page System (ADR-0043): log lines without the values of
// the BYL_* variables (logs -Json) and the command line of the detached restart (restart -Detach).
// Only app/byl-functions.ps1 runs here, never a script or a server.

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
$result.lines = @(foreach ($line in $in.lines) { Protect-LogText -Text $line -Secrets @($in.secrets) })
$result.withoutSecrets = Protect-LogText -Text 'nichts geheim' -Secrets @()
$result.nullText = Protect-LogText -Text $null -Secrets @('geheim')
$result.long = (Protect-LogText -Text ('x' * 5000) -Secrets @()).Length
$result.longEnd = (Protect-LogText -Text ('x' * 5000) -Secrets @()).EndsWith('...')
$result.lineMax = $BylLogLineMax
$result.detached = Get-DetachedRestartArgumentString -ScriptPath 'C:\Apps\byl #1\app\byl-control.ps1' -WaitForProcess 4711
ConvertTo-Json -InputObject $result -Depth 4 -Compress`;

let result;

beforeAll(() => {
	result = runPowerShellJson(
		SCRIPT,
		{
			// "abc" is too short to replace; "geheim+/1" also appears URL-encoded; the longer secret
			// goes first, so it is not cut in half by the shorter one inside it.
			secrets: ['abc', 'geheim+/1', 'Kennwort', 'Kennwort-lang', ''],
			lines: [
				'Anmeldung mit geheim+/1 fehlgeschlagen',
				'Adresse https://example.com/?pw=geheim%2B%2F1',
				'abc bleibt, Kennwort-lang und Kennwort nicht',
				'ohne Geheimnis'
			]
		},
		{ BYL_FUNCTIONS: FUNCTIONS_FILE }
	);
}, 60_000);

describe('log lines without secrets (logs -Json, ADR-0043)', () => {
	it('replaces every value of at least four characters, also URL-encoded, the longest first', () => {
		expect(result.lines).toEqual([
			'Anmeldung mit *** fehlgeschlagen',
			'Adresse https://example.com/?pw=***',
			'abc bleibt, *** und *** nicht',
			'ohne Geheimnis'
		]);
		expect(result.withoutSecrets).toBe('nichts geheim');
		expect(result.nullText).toBe('');
	});

	it('cuts a line to the length the page shows', () => {
		expect(result.lineMax).toBe(2000);
		expect(result.long).toBe(2000);
		expect(result.longEnd).toBe(true);
	});
});

describe('detached restart (restart -Detach, ADR-0043)', () => {
	it('restarts the script of the same folder quietly, without browser, after the caller ended', () => {
		expect(result.detached).toBe(
			'-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\Apps\\byl #1\\app\\byl-control.ps1" restart -NoBrowser -Quiet -WaitForProcess 4711'
		);
	});
});
