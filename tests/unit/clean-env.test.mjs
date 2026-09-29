// Clean environment of the child processes of the tests (tests/support/clean-env.mjs): no BYL_*
// variable and no tool token reaches PocketBase, byl-mail.exe, Windows PowerShell or Node started by
// a test, only the values a test sets explicitly. A child echoes what it sees; a static check keeps
// new spawn sites from going around the helper. The servers themselves are checked in
// tests/integration/harness.test.mjs and control-script.test.mjs.

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
	cleanEnv,
	credentialNames,
	isCredentialName,
	spawnClean,
	spawnSyncClean
} from '../support/clean-env.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const HELPER_FILE = 'tests/support/clean-env.mjs';

// The child prints the names of the access data it sees and the value of BYL_TEST_EXPLICIT.
const ECHO = `const names = Object.keys(process.env).filter((name) => /^BYL_|^(GH|GITHUB|NODE_AUTH|NPM)_TOKEN$/i.test(name)).sort();
process.stdout.write(JSON.stringify({ names, explicit: process.env.BYL_TEST_EXPLICIT ?? null }));`;

const canaries = [];

/** Sets a BYL_* variable in this process only; removed after the test. */
function canary() {
	const name = `BYL_TEST_CANARY_${randomBytes(4).toString('hex').toUpperCase()}`;
	process.env[name] = `wert-${randomBytes(4).toString('hex')}`;
	canaries.push(name);
	return name;
}

afterEach(() => {
	for (const name of canaries.splice(0)) delete process.env[name];
});

describe('cleanEnv', () => {
	it('drops BYL_* in any case and the tool tokens, keeps everything else', () => {
		const base = {
			PATH: '/usr/bin',
			SystemRoot: 'C:\\Windows',
			BYL_WEBDE_PASSWORD: 'geheim',
			byl_lower: 'x',
			Byl_Mixed: 'x',
			GH_TOKEN: 't',
			GITHUB_TOKEN: 't',
			NODE_AUTH_TOKEN: 't',
			NPM_TOKEN: 't',
			BYLINE: 'bleibt',
			MY_BYL_VALUE: 'bleibt'
		};
		expect(cleanEnv({}, base)).toEqual({ PATH: '/usr/bin', SystemRoot: 'C:\\Windows', BYLINE: 'bleibt', MY_BYL_VALUE: 'bleibt' });
		expect(base.BYL_WEBDE_PASSWORD).toBe('geheim');
	});

	it('adds the explicit test values, also BYL_* ones, over the base', () => {
		expect(cleanEnv({ BYL_TEST_TOKEN: 'erfunden', PATH: '/bin' }, { PATH: '/usr/bin', BYL_TEST_TOKEN: 'echt' })).toEqual({
			PATH: '/bin',
			BYL_TEST_TOKEN: 'erfunden'
		});
		expect(cleanEnv({ BYL_TEST_UNSET: undefined }, {})).toEqual({});
	});

	it('refuses to hand on an inherited value of access data as a test value', () => {
		const name = canary();
		expect(() => cleanEnv({ [name]: process.env[name] })).toThrow(`${name} hands on the inherited value`);
		expect(cleanEnv({ [name]: 'erfunden' })[name]).toBe('erfunden');
	});

	it('names the access data of an environment', () => {
		expect(credentialNames({ PATH: 'x', BYL_A: 'x', npm_token: 'x', GH_TOKENS: 'x' })).toEqual(['BYL_A', 'npm_token']);
		expect(isCredentialName('BYL_')).toBe(true);
		expect(isCredentialName('BYLX')).toBe(false);
	});
});

describe('child processes of the tests', () => {
	it('spawnSyncClean: the child sees no BYL_* variable of this process, only the explicit value', () => {
		const inherited = canary();
		const result = spawnSyncClean(process.execPath, ['-e', ECHO], {
			encoding: 'utf8',
			windowsHide: true,
			env: { BYL_TEST_EXPLICIT: 'erfunden' }
		});
		expect(result.status, result.stderr).toBe(0);
		const seen = JSON.parse(result.stdout);
		expect(credentialNames()).toContain(inherited);
		expect(seen).toEqual({ names: ['BYL_TEST_EXPLICIT'], explicit: 'erfunden' });
	});

	it('spawnClean cleans a given base as well and adds only the explicit value', async () => {
		canary();
		const child = spawnClean(process.execPath, ['-e', ECHO], {
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'inherit'],
			baseEnv: { ...process.env, BYL_OF_THE_BASE: 'x' },
			env: { BYL_TEST_EXPLICIT: 'erfunden' }
		});
		let output = '';
		child.stdout.on('data', (chunk) => (output += chunk));
		const code = await new Promise((resolvePromise, reject) => {
			child.once('error', reject);
			child.once('close', resolvePromise);
		});
		expect(code).toBe(0);
		expect(JSON.parse(output)).toEqual({ names: ['BYL_TEST_EXPLICIT'], explicit: 'erfunden' });
	});
});

/** Code files of the tests: tests/, the test files and helpers of web, mail helper and extension. */
function testCodeFiles() {
	const list = (dir, pattern) =>
		readdirSync(join(ROOT_DIR, dir), { recursive: true })
			.map((file) => `${dir}/${String(file).replaceAll('\\', '/')}`)
			.filter((file) => pattern.test(file));
	const code = /\.(js|mjs|cjs|ts)$/;
	return [
		...list('tests', code),
		...list('web/src', /(\.test\.ts|\/lib\/test\/.+\.ts)$/),
		...list('helpers/mail/src', /\.test\.ts$/),
		...list('helpers/mail/test', code),
		...list('extensions/whatsapp-web/src', /\.test\.ts$/)
	];
}

describe('spawn sites of the tests', () => {
	it('start child processes only through tests/support/clean-env.mjs', () => {
		const files = testCodeFiles();
		// The scan reaches the spawn sites that exist.
		for (const file of [
			'tests/support/pocketbase-harness.mjs',
			'tests/support/powershell.mjs',
			'tests/integration/control-script.test.mjs',
			'tests/integration/mail-helper-process.test.mjs'
		]) {
			expect(files).toContain(file);
		}
		const direct = /['"`](node:)?child_process['"`]|process\.binding\(/;
		const offenders = files.filter(
			(file) => file !== HELPER_FILE && direct.test(readFileSync(join(ROOT_DIR, file), 'utf8'))
		);
		expect(offenders).toEqual([]);
		expect(readFileSync(join(ROOT_DIR, HELPER_FILE), 'utf8')).toMatch(direct);
	});
});
