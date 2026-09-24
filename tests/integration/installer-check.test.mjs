// Test-InstallerPending of app/byl-functions.ps1 (E1.1) against the disposable instance. A real
// installer token cannot be produced here (serve without a superuser is forbidden, CLAUDE.md
// §11.2), so a valid superuser token stands in for "installer still pending" and an invalid one
// for "installer account deleted": PocketBase answers both kinds the same way.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { pocketBaseUrl, superuserClient } from '../support/api.mjs';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');
const CHECK_PATH = '/api/collections/_superusers/records?perPage=1&skipTotal=1&fields=id';

const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = @{}
foreach ($case in $in.cases) {
    $result[$case.name] = Test-InstallerPending -Token $case.token -Url $case.url -TimeoutMilliseconds 2000
}
$result | ConvertTo-Json -Compress
`;

let result;

beforeAll(async () => {
	const superuser = await superuserClient();
	const url = `${pocketBaseUrl()}${CHECK_PATH}`;
	result = runPowerShellJson(
		SCRIPT,
		{
			cases: [
				{ name: 'validToken', token: superuser.authStore.token, url },
				{ name: 'deletedAccount', token: 'aaa.bbb.ccc', url },
				{ name: 'unreachable', token: superuser.authStore.token, url: 'http://127.0.0.1:9/api/health' }
			]
		},
		{ BYL_FUNCTIONS: FUNCTIONS_FILE }
	);
}, 60_000);

describe('Test-InstallerPending', () => {
	it('reports a working token as pending setup', () => {
		expect(result.validToken).toBe(true);
	});

	it('reports a rejected token as finished setup (no false alarm)', () => {
		expect(result.deletedAccount).toBe(false);
	});

	it('treats an unknown outcome as pending, so a missed installer is never hidden', () => {
		expect(result.unreachable).toBe(true);
	});
});
