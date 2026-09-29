// Environment of every child process a test starts: PocketBase, byl-mail.exe, Windows PowerShell
// with the operation scripts, Node. The shell of the developer and the CI runner may carry the
// BYL_* variables of the Windows account (access data of the channels and the mail helper,
// ADR-0018); a disposable instance or copy must never see them. A child gets the own environment
// without access data, plus only the values the test sets explicitly. Test files start child
// processes only through spawnClean and spawnSyncClean; tests/unit/clean-env.test.mjs checks that
// no other file imports node:child_process.

import { spawn, spawnSync } from 'node:child_process';

// Tokens of the development tools that a shell or the CI runner may hold. None of the children needs
// them.
const TOOL_TOKENS = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_TOKEN']);

/** Whether `name` holds access data: every BYL_* variable (any case, as Windows) and the tool tokens. */
export function isCredentialName(name) {
	return /^BYL_/i.test(name) || TOOL_TOKENS.has(name.toUpperCase());
}

/** The names of access data in `env`, e.g. what this process inherited from the shell. */
export function credentialNames(env = process.env) {
	return Object.keys(env).filter(isCredentialName);
}

/**
 * `base` without access data, plus the explicit test values of `extra`. A test invents its values:
 * handing on the inherited value of an access-data name (for example
 * `BYL_WEBDE_PASSWORD: process.env.BYL_WEBDE_PASSWORD`) throws.
 * @param {Record<string, string | undefined>} [extra]
 * @param {Record<string, string | undefined>} [base]
 * @returns {Record<string, string>}
 */
export function cleanEnv(extra = {}, base = process.env) {
	const env = {};
	for (const [name, value] of Object.entries(base)) {
		if (value !== undefined && !isCredentialName(name)) env[name] = value;
	}
	for (const [name, value] of Object.entries(extra)) {
		if (value === undefined) continue;
		if (isCredentialName(name) && value !== '' && process.env[name] === value) {
			throw new Error(`${name} hands on the inherited value; a test sets invented values only.`);
		}
		env[name] = value;
	}
	return env;
}

/**
 * child_process.spawn with cleanEnv: `options.env` holds only the explicit test values,
 * `options.baseEnv` replaces the environment of this process as the base (e.g. one without Node).
 * @param {string} command
 * @param {readonly string[]} [args]
 * @param {import('node:child_process').SpawnOptions & { baseEnv?: Record<string, string | undefined> }} [options]
 */
export function spawnClean(command, args = [], options = {}) {
	const { env, baseEnv, ...rest } = options;
	return spawn(command, args, { ...rest, env: cleanEnv(env, baseEnv) });
}

/**
 * child_process.spawnSync with cleanEnv, options as for spawnClean.
 * @param {string} command
 * @param {readonly string[]} [args]
 * @param {import('node:child_process').SpawnSyncOptions & { baseEnv?: Record<string, string | undefined> }} [options]
 */
export function spawnSyncClean(command, args = [], options = {}) {
	const { env, baseEnv, ...rest } = options;
	return spawnSync(command, args, { ...rest, env: cleanEnv(env, baseEnv) });
}

/**
 * Which of `names` are set in the environment of a test server, asked with its superuser client
 * `pb` (route of tests/fixtures/pb_hooks/environment-probe.pb.js, names only, never values).
 * @param {import('pocketbase').default} pb
 * @param {string[]} names
 * @returns {Promise<string[]>} sorted
 */
export async function visibleNames(pb, names) {
	const { set } = await pb.send('/api/byl-test/environment', {
		query: { names: [...new Set(names)].join(',') }
	});
	return [...set].sort();
}
