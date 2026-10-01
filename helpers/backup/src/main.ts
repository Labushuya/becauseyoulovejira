// Entry of byl-backup.exe (ADR-0046 §3). byl-control.ps1 calls it for one command and gives the
// parameters as one JSON object on standard input, never on the command line, which other programs
// of the account could read; the passphrase and the access data therefore never appear in a
// process list. Every command prints exactly one JSON line and ends: 0 done, 1 failed (with a
// reason), 2 wrong call. "--version" and "--self-test" run without input, so the build checks the
// executable on a machine without Node.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgeError } from './age';
import { BundleError, open, seal } from './bundle';
import { checkData } from './check';

declare const __BYL_BACKUP_VERSION__: string | undefined;

/** Version of the helper; set by the build (esbuild define), "dev" when run from source. */
export const VERSION = typeof __BYL_BACKUP_VERSION__ === 'string' ? __BYL_BACKUP_VERSION__ : 'dev';

export const USAGE = 'byl-backup <seal|open|check> (parameters as JSON on standard input) | --version | --self-test';
// The input is a few paths, a manifest and the access data: far below this.
const INPUT_MAX = 1024 * 1024;

export interface Output {
	write(line: string): void;
}

type Answer = { ok: true } & Record<string, unknown>;

class UsageError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== 'string' || value === '') throw new BundleError('input', `${key} is missing`);
	return value;
}

function stringMap(value: unknown): Record<string, string> {
	if (value === undefined || value === null) return {};
	if (!isRecord(value)) throw new BundleError('input', 'secrets must be an object');
	const result: Record<string, string> = {};
	for (const [name, entry] of Object.entries(value)) {
		if (typeof entry !== 'string') throw new BundleError('input', 'secrets must be strings');
		result[name] = entry;
	}
	return result;
}

/**
 * Reads the JSON object of standard input (UTF-8, at most 1 MB). Windows PowerShell 5.1 writes the
 * preamble of the input encoding of its console when it closes a redirected standard input: in a
 * console with the UTF-8 code page (65001) a byte order mark arrives after the data. Space and byte
 * order marks around the object are therefore no error (trim() removes U+FEFF as well).
 */
export async function readInput(stream: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
	const parts: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of stream) {
		size += chunk.length;
		if (size > INPUT_MAX) throw new BundleError('input', 'input too large');
		parts.push(chunk);
	}
	let value: unknown;
	try {
		value = JSON.parse(Buffer.concat(parts).toString('utf8').trim());
	} catch {
		throw new BundleError('input', 'input is not JSON');
	}
	if (!isRecord(value)) throw new BundleError('input', 'input must be a JSON object');
	return value;
}

/** Runs `command` with `input`; the answer of a successful command. */
export async function runCommand(command: string, input: Record<string, unknown>): Promise<Answer> {
	switch (command) {
		case 'seal': {
			const manifest = input.manifest;
			if (!isRecord(manifest)) throw new BundleError('input', 'manifest is missing');
			const { bytes } = await seal({
				data: text(input, 'data'),
				out: text(input, 'out'),
				config: typeof input.config === 'string' && input.config !== '' ? input.config : null,
				passphrase: text(input, 'passphrase'),
				manifest,
				secrets: stringMap(input.secrets)
			});
			return { ok: true, bytes };
		}
		case 'check': {
			// The verdict (integrity, missing files) is the business of the caller; only the first
			// lines of a failed integrity check go back.
			const result = checkData(text(input, 'dir'));
			return { ok: true, integrity: result.integrity.slice(0, 5), counts: result.counts, files: result.files };
		}
		case 'open': {
			const result = await open({
				file: text(input, 'file'),
				out: text(input, 'out'),
				passphrase: text(input, 'passphrase')
			});
			// The values only when the caller asks for them (restoring), never otherwise.
			return {
				ok: true,
				manifest: result.manifest,
				variables: result.variables,
				config: result.config,
				dataBytes: result.dataBytes,
				...(input.secrets === true ? { secrets: result.secrets } : {})
			};
		}
		default:
			throw new UsageError(`unknown command: ${command}`);
	}
}

/** Seals and opens a small invented backup in a temporary folder, without network. */
export async function selfTest(): Promise<{ ok: boolean; checks: Record<string, boolean> }> {
	const dir = await mkdtemp(join(tmpdir(), 'byl-backup-selftest-'));
	try {
		const data = join(dir, 'daten.zip');
		const sealed = join(dir, 'probe.tar.age');
		const out = join(dir, 'offen');
		await writeFile(data, 'PK selbsttest');
		await seal({
			data,
			out: sealed,
			config: null,
			passphrase: 'selbsttest-passphrase',
			manifest: { app: 'becauseyoulovejira' },
			secrets: { BYL_SELBSTTEST: 'wert' },
			workFactor: 10
		});
		await mkdir(out);
		const opened = await open({ file: sealed, out, passphrase: 'selbsttest-passphrase' });
		let wrong = false;
		try {
			await open({ file: sealed, out, passphrase: 'falsch' });
		} catch (error) {
			wrong = error instanceof AgeError && error.reason === 'passphrase';
		}
		const memory = new DatabaseSync(':memory:');
		let sqlite = false;
		try {
			sqlite = Object.values(memory.prepare('PRAGMA integrity_check').get() ?? {})[0] === 'ok';
		} finally {
			memory.close();
		}
		const checks = {
			roundTrip: (await readFile(join(out, 'pb_data.zip'), 'utf8')) === 'PK selbsttest',
			secrets: opened.secrets.BYL_SELBSTTEST === 'wert',
			manifest: opened.manifest.app === 'becauseyoulovejira',
			wrongPassphrase: wrong,
			sqlite
		};
		return { ok: Object.values(checks).every(Boolean), checks };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function failure(error: unknown): { code: number; answer: Record<string, unknown> } {
	if (error instanceof UsageError) return { code: 2, answer: { ok: false, reason: 'usage', message: error.message } };
	if (error instanceof BundleError || error instanceof AgeError) {
		return { code: 1, answer: { ok: false, reason: error.reason, message: error.message } };
	}
	return { code: 1, answer: { ok: false, reason: 'internal', message: error instanceof Error ? error.message : String(error) } };
}

/** The whole run for `args`; returns the exit code. */
export async function main(
	args: readonly string[],
	stdin: AsyncIterable<Uint8Array>,
	stdout: Output
): Promise<number> {
	const [command] = args;
	if (args.length !== 1 || command === undefined) {
		stdout.write(JSON.stringify({ ok: false, reason: 'usage', message: USAGE }));
		return 2;
	}
	if (command === '--version') {
		stdout.write(`byl-backup ${VERSION}`);
		return 0;
	}
	try {
		if (command === '--self-test') {
			const result = await selfTest();
			stdout.write(JSON.stringify(result));
			return result.ok ? 0 : 1;
		}
		if (command !== 'seal' && command !== 'open' && command !== 'check') throw new UsageError(`unknown command: ${command}`);
		stdout.write(JSON.stringify(await runCommand(command, await readInput(stdin))));
		return 0;
	} catch (error) {
		const { code, answer } = failure(error);
		stdout.write(JSON.stringify(answer));
		return code;
	}
}
