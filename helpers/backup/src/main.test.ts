// The command line of byl-backup.exe (ADR-0046 §3): one JSON line per call, parameters only on
// standard input, the values of the access data only on request, exit codes 0, 1 and 2.

import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seal } from './bundle';
import { main, readInput, selfTest } from './main';

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'byl-backup-main-'));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function* stdin(text: string): AsyncGenerator<Uint8Array> {
	yield new TextEncoder().encode(text);
}

async function run(args: string[], input = ''): Promise<{ code: number; lines: string[] }> {
	const lines: string[] = [];
	const code = await main(args, stdin(input), { write: (line) => lines.push(line) });
	return { code, lines };
}

describe('byl-backup command line', () => {
	it('prints its version and refuses wrong calls with 2', async () => {
		expect(await run(['--version'])).toEqual({ code: 0, lines: ['byl-backup dev'] });
		for (const args of [[], ['seal', 'extra'], ['unbekannt']]) {
			const { code, lines } = await run(args, '{}');
			expect(code, args.join(' ')).toBe(2);
			expect(JSON.parse(lines[0] ?? '')).toMatchObject({ ok: false, reason: 'usage' });
		}
	});

	it('takes its parameters only as a JSON object of at most 1 MB', async () => {
		await expect(readInput(stdin('[1]'))).rejects.toMatchObject({ reason: 'input' });
		await expect(readInput(stdin('kein json'))).rejects.toMatchObject({ reason: 'input' });
		await expect(readInput(stdin(`{"a":"${'x'.repeat(1024 * 1024)}"}`))).rejects.toMatchObject({ reason: 'input' });
		expect(await readInput(stdin('{"a":"ä"}'))).toEqual({ a: 'ä' });
		const missing = await run(['seal'], '{"data":"x"}');
		expect(missing.code).toBe(1);
		expect(JSON.parse(missing.lines[0] ?? '')).toMatchObject({ ok: false, reason: 'input' });
	});

	it('names the variables of a backup, and their values only on request', async () => {
		const data = join(dir, 'daten.zip');
		const file = join(dir, 'probe.tar.age');
		const out = join(dir, 'offen');
		await mkdir(out);
		await writeFile(data, 'PK');
		const value = `geheim-${randomBytes(6).toString('hex')}`;
		await seal({ data, out: file, config: null, passphrase: 'p', manifest: {}, secrets: { BYL_X: value }, workFactor: 10 });

		const names = await run(['open'], JSON.stringify({ file, out, passphrase: 'p' }));
		expect(names.code).toBe(0);
		expect(names.lines[0]).not.toContain(value);
		expect(JSON.parse(names.lines[0] ?? '')).toMatchObject({ ok: true, variables: ['BYL_X'], config: false, dataBytes: 2 });

		const values = await run(['open'], JSON.stringify({ file, out, passphrase: 'p', secrets: true }));
		expect(JSON.parse(values.lines[0] ?? '')).toMatchObject({ secrets: { BYL_X: value } });

		const wrong = await run(['open'], JSON.stringify({ file, out, passphrase: 'q' }));
		expect(wrong.code).toBe(1);
		expect(JSON.parse(wrong.lines[0] ?? '')).toMatchObject({ ok: false, reason: 'passphrase' });
	});

	it('passes its self-test without network', async () => {
		expect(await selfTest()).toEqual({
			ok: true,
			checks: { roundTrip: true, secrets: true, manifest: true, wrongPassphrase: true }
		});
	});
});
