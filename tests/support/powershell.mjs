// Runs Windows PowerShell for tests of the start/stop logic (app/byl-functions.ps1).
// Always -NoProfile -ExecutionPolicy Bypass (script execution is disabled on the target machine).
// The script travels as -EncodedCommand, the input as JSON in an environment variable, so no
// temp files are needed. The script prints JSON; the parsed value is returned. PowerShell and what
// it starts get a clean environment without the BYL_* variables of the developer (clean-env.mjs).

import { join } from 'node:path';
import { spawnSyncClean } from './clean-env.mjs';
import { scaled } from './timing.mjs';

export const POWERSHELL_EXE = join(
	process.env.SystemRoot ?? 'C:\\Windows',
	'System32',
	'WindowsPowerShell',
	'v1.0',
	'powershell.exe'
);

/**
 * @param {string} script PowerShell code; the JSON input is available as `$env:BYL_TEST_INPUT`.
 * @param {unknown} input serialised to JSON
 * @param {Record<string, string>} [env] explicit test values of the environment
 * @returns {any} the parsed JSON the script printed
 */
export function runPowerShellJson(script, input, env = {}) {
	const encoded = Buffer.from(`$ErrorActionPreference = 'Stop'\n${script}`, 'utf16le').toString(
		'base64'
	);
	const result = spawnSyncClean(
		POWERSHELL_EXE,
		['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
		{
			encoding: 'utf8',
			windowsHide: true,
			timeout: scaled(60_000),
			env: { ...env, BYL_TEST_INPUT: JSON.stringify(input) }
		}
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`PowerShell failed (exit code ${result.status}):\n${result.stderr}${result.stdout}`);
	}
	return JSON.parse(result.stdout);
}
