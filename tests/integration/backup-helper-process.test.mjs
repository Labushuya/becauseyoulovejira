// byl-backup.exe as process (ADR-0046 §3): the executable built by scripts/build-backup-helper.ps1
// (on Linux helpers/backup/build.mjs, then without ".exe") runs without Node (PATH only with the
// system folders), answers --version and --self-test, takes its parameters only on standard input,
// seals and opens a backup and names a wrong passphrase. The tar archive inside a sealed backup is
// the one of the tar programs of the system (Windows 10 and 11: tar.exe; Linux: GNU tar), so a
// backup opens in an emergency without the app.

import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSyncClean } from '../support/clean-env.mjs';
import { executableName } from '../../scripts/platform.mjs';
import { fileHeader, padding, readTar, trailer } from '../../helpers/backup/src/tar.ts';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const HELPER = join(ROOT_DIR, 'helpers', 'backup', 'dist', executableName('byl-backup'));
const SYSTEM_ROOT = process.env.SystemRoot ?? 'C:\\Windows';
const TAR = process.platform === 'win32' ? join(SYSTEM_ROOT, 'System32', 'tar.exe') : 'tar';
const SECRET = `geheim-${randomBytes(8).toString('hex')}`;

let dir;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'byl-test-backup-'));
});

afterAll(() => {
	if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
});

/** The base environment of the helper, without Node: only the system folders in PATH. */
function withoutNode() {
	if (process.platform !== 'win32') {
		return { PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR ?? '/tmp' };
	}
	return {
		SystemRoot: SYSTEM_ROOT,
		PATH: `${SYSTEM_ROOT}\\System32;${SYSTEM_ROOT}`,
		TEMP: process.env.TEMP ?? '',
		TMP: process.env.TMP ?? ''
	};
}

/** The helper with `input` as JSON on standard input (`after` follows it, e.g. a byte order mark). */
function helper(args, input, after = '') {
	const result = spawnSyncClean(HELPER, args, {
		baseEnv: withoutNode(),
		input: input === undefined ? '' : JSON.stringify(input) + after,
		encoding: 'utf8',
		windowsHide: true,
		timeout: 120_000
	});
	if (result.error) throw result.error;
	return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function tar(args, cwd) {
	const result = spawnSyncClean(TAR, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
	if (result.error) throw result.error;
	expect(result.status, `${TAR} ${args.join(' ')}: ${result.stderr}`).toBe(0);
	return result.stdout;
}

describe('byl-backup.exe without Node', () => {
	it('answers its version and passes its self-test', () => {
		expect(helper(['--version'])).toMatchObject({ code: 0, stdout: expect.stringMatching(/^byl-backup \d+\.\d+\.\d+\n$/) });
		const selfTest = helper(['--self-test']);
		expect(selfTest.code, selfTest.stdout + selfTest.stderr).toBe(0);
		expect(JSON.parse(selfTest.stdout)).toMatchObject({ ok: true });
	});

	it('takes its input with the byte order mark Windows PowerShell adds when it closes the input in a UTF-8 console', () => {
		const answer = helper(['check'], { dir: join(dir, 'gibt es nicht') }, '﻿');
		expect(answer.code).toBe(1);
		// "missing", not "input": the JSON was read.
		expect(JSON.parse(answer.stdout)).toMatchObject({ ok: false, reason: 'missing' });
	});

	it('seals and opens a backup with parameters only on standard input', () => {
		const data = join(dir, 'byl-20261001-120000.zip');
		const sealed = join(dir, 'byl-20261001-120000.tar.age');
		const out = join(dir, 'offen');
		mkdirSync(out);
		writeFileSync(data, randomBytes(100_000));
		const seal = helper(['seal'], {
			data,
			out: sealed,
			config: null,
			passphrase: 'richtig Pferd Batterie',
			manifest: { app: 'becauseyoulovejira' },
			secrets: { BYL_PROZESS_TEST: SECRET }
		});
		expect(seal.code, seal.stdout + seal.stderr).toBe(0);
		expect(JSON.parse(seal.stdout)).toEqual({ ok: true, bytes: expect.any(Number) });
		expect(readFileSync(sealed).includes(Buffer.from(SECRET))).toBe(false);

		const wrong = helper(['open'], { file: sealed, out, passphrase: 'falsch' });
		expect(wrong.code).toBe(1);
		expect(JSON.parse(wrong.stdout)).toMatchObject({ ok: false, reason: 'passphrase' });

		const opened = helper(['open'], { file: sealed, out, passphrase: 'richtig Pferd Batterie' });
		expect(opened.code).toBe(0);
		expect(opened.stdout).not.toContain(SECRET);
		expect(JSON.parse(opened.stdout)).toMatchObject({ ok: true, variables: ['BYL_PROZESS_TEST'], dataBytes: 100_000 });
		expect(readFileSync(join(out, 'pb_data.zip')).equals(readFileSync(data))).toBe(true);

		const usage = helper(['seal', '--passphrase=geheim'], {});
		expect(usage.code).toBe(2);
		expect(JSON.parse(usage.stdout)).toMatchObject({ ok: false, reason: 'usage' });
	});
});

describe('the tar archive inside a sealed backup', () => {
	it('opens with the tar program of the system', () => {
		const archive = join(dir, 'eigen.tar');
		const entries = [
			['manifest.json', '{"format":1}\n'],
			['LIESMICH.txt', 'Hallo\r\n'],
			['pb_data.zip', randomBytes(70_000).toString('base64')]
		];
		const time = new Date('2026-10-01T12:00:00Z');
		writeFileSync(
			archive,
			Buffer.concat([
				...entries.flatMap(([name, content]) => {
					const bytes = Buffer.from(content);
					return [fileHeader(name, bytes.length, time), bytes, padding(bytes.length)];
				}),
				trailer()
			])
		);
		expect(tar(['-tf', archive], dir).trim().split(/\r?\n/)).toEqual(entries.map(([name]) => name));
		const out = join(dir, 'entpackt');
		mkdirSync(out);
		tar(['-xf', archive, '-C', out], dir);
		expect(readdirSync(out).sort()).toEqual(entries.map(([name]) => name).sort());
		for (const [name, content] of entries) expect(readFileSync(join(out, name), 'utf8'), name).toBe(content);
	});

	it('reads an archive of the tar program of the system', async () => {
		const source = join(dir, 'quelle');
		mkdirSync(source);
		writeFileSync(join(source, 'a.txt'), 'erste Datei');
		writeFileSync(join(source, 'b.bin'), Buffer.alloc(1500, 7));
		const archive = join(dir, 'fremd.tar');
		tar(['--format=ustar', '-cf', archive, 'a.txt', 'b.bin'], source);
		const found = [];
		async function* chunks() {
			yield readFileSync(archive);
		}
		for await (const entry of readTar(chunks())) {
			const parts = [];
			for await (const chunk of entry.body) parts.push(chunk);
			found.push([entry.name, Buffer.concat(parts)]);
		}
		expect(found.map(([name]) => name)).toEqual(['a.txt', 'b.bin']);
		expect(found[0][1].toString()).toBe('erste Datei');
		expect(found[1][1].equals(Buffer.alloc(1500, 7))).toBe(true);
	});
});
