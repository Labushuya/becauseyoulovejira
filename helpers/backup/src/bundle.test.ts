// Sealing and opening a backup (ADR-0046 §3) in a temporary folder: the round trip with and without
// access data and settings, wrong passphrases, changed, cut and foreign files, the input checks,
// and the official age test vectors for passphrases (cctv-age, c2sp.org/CCTV/age), so files of the
// age command line open here as well. The scrypt exponent is lowered to 10 for speed; the helper
// itself uses the default of the library (18).

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import * as vectors from 'cctv-age';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGE_MAGIC, AgeError, decrypt } from './age';
import { BundleError, open, seal, type SealInput } from './bundle';

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'byl-backup-test-'));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const PASSPHRASE = 'richtig Pferd Batterie Heftklammer äöü';
const SECRET = `geheim-${randomBytes(8).toString('hex')}`;

async function sealed(overrides: Partial<SealInput> = {}): Promise<{ file: string; data: Buffer }> {
	const data = randomBytes(300_000);
	const dataPath = join(dir, 'byl-20261001-120000.zip');
	await writeFile(dataPath, data);
	const file = join(dir, 'byl-20261001-120000.tar.age');
	await seal({
		data: dataPath,
		out: file,
		config: null,
		passphrase: PASSPHRASE,
		manifest: { app: 'becauseyoulovejira', counts: { tickets: 3 } },
		secrets: {},
		workFactor: 10,
		...overrides
	});
	return { file, data };
}

async function opened(file: string, passphrase = PASSPHRASE) {
	const out = join(dir, `offen-${randomBytes(3).toString('hex')}`);
	await mkdir(out);
	return { out, result: await open({ file, out, passphrase }) };
}

async function* bytes(data: Uint8Array): AsyncGenerator<Uint8Array> {
	yield data;
}

async function decryptAll(file: Uint8Array, passphrase: string): Promise<Buffer> {
	const plain = await decrypt(passphrase, Readable.toWeb(Readable.from(bytes(file))) as ReadableStream<Uint8Array>);
	const parts: Uint8Array[] = [];
	for await (const chunk of plain) parts.push(chunk);
	return Buffer.concat(parts);
}

describe('sealed backup', () => {
	it('opens again with data, manifest, settings and access data, and holds nothing in plain text', async () => {
		const config = join(dir, 'byl-config.json');
		await writeFile(config, '{ "port": 8095 }');
		const { file, data } = await sealed({ config, secrets: { BYL_TELEGRAM_TOKEN: SECRET, BYL_A: 'x' } });
		const raw = await readFile(file);
		expect(raw.subarray(0, AGE_MAGIC.length).toString('latin1')).toBe(AGE_MAGIC);
		expect(raw.includes(Buffer.from(SECRET))).toBe(false);
		expect(raw.includes(Buffer.from('becauseyoulovejira'))).toBe(false);

		const { out, result } = await opened(file);
		expect(result).toMatchObject({
			manifest: { app: 'becauseyoulovejira', counts: { tickets: 3 }, format: 1 },
			variables: ['BYL_A', 'BYL_TELEGRAM_TOKEN'],
			secrets: { BYL_TELEGRAM_TOKEN: SECRET, BYL_A: 'x' },
			config: true,
			dataBytes: data.length
		});
		expect((await readFile(join(out, 'pb_data.zip'))).equals(data)).toBe(true);
		expect(JSON.parse(await readFile(join(out, 'byl-config.json'), 'utf8'))).toEqual({ port: 8095 });
		// The access data never reach the folder.
		expect((await readdir(out)).sort()).toEqual(['byl-config.json', 'manifest.json', 'pb_data.zip']);
		expect(await readFile(join(out, 'manifest.json'), 'utf8')).not.toContain(SECRET);
	});

	it('leaves out settings and access data that are not there', async () => {
		const { file } = await sealed({ config: join(dir, 'fehlt.json') });
		const { result } = await opened(file);
		expect(result).toMatchObject({ variables: [], secrets: {}, config: false });
	});

	it('replaces a file of the same name and leaves no partial file behind', async () => {
		const { file } = await sealed();
		await sealed();
		expect((await readdir(dir)).filter((name) => name.includes('.partial-'))).toEqual([]);
		await expect(sealed({ out: join(dir, 'fehlt', 'x.tar.age') })).rejects.toMatchObject({ reason: 'missing' });
		expect((await readdir(dir)).filter((name) => name.includes('.partial-'))).toEqual([]);
		expect((await opened(file)).result.dataBytes).toBe(300_000);
	});

	it('names a wrong passphrase, a foreign file, a changed and a cut backup', async () => {
		const { file } = await sealed();
		await expect(opened(file, 'falsch')).rejects.toSatisfy(
			(error) => error instanceof AgeError && error.reason === 'passphrase'
		);

		const foreign = join(dir, 'fremd.tar.age');
		await writeFile(foreign, 'PK\u0003\u0004 kein age');
		await expect(opened(foreign)).rejects.toMatchObject({ reason: 'format' });

		const raw = await readFile(file);
		const changed = Buffer.from(raw);
		const middle = Math.floor(changed.length / 2);
		changed[middle] = (changed[middle] ?? 0) ^ 0xff;
		await writeFile(join(dir, 'geaendert.tar.age'), changed);
		await expect(opened(join(dir, 'geaendert.tar.age'))).rejects.toMatchObject({ reason: 'damaged' });

		await writeFile(join(dir, 'gekuerzt.tar.age'), raw.subarray(0, raw.length - 100));
		await expect(opened(join(dir, 'gekuerzt.tar.age'))).rejects.toMatchObject({ reason: 'damaged' });

		await expect(opened(join(dir, 'gibt-es-nicht.tar.age'))).rejects.toMatchObject({ reason: 'missing' });
	});

	it('refuses invalid access data and an empty passphrase before writing anything', async () => {
		await expect(sealed({ secrets: { PATH: 'x' } })).rejects.toBeInstanceOf(BundleError);
		await expect(sealed({ secrets: { BYL_A: 'x'.repeat(40_000) } })).rejects.toMatchObject({ reason: 'input' });
		await expect(sealed({ passphrase: '' })).rejects.toMatchObject({ reason: 'input' });
		expect((await readdir(dir)).filter((name) => name.endsWith('.tar.age'))).toEqual([]);
	});
});

describe('official age test vectors (passphrase)', () => {
	function vector(name: string): { header: Map<string, string>; file: Uint8Array } {
		const raw = (vectors as unknown as Record<string, Uint8Array>)[name];
		if (raw === undefined) throw new Error(`no vector ${name}`);
		const text = Buffer.from(raw).toString('latin1');
		const cut = text.indexOf('\n\n');
		const header = new Map(
			text
				.slice(0, cut)
				.split('\n')
				.map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)] as [string, string])
		);
		return { header, file: raw.subarray(cut + 2) };
	}

	it('decrypts the file of the reference implementation to its payload', async () => {
		const { header, file } = vector('scrypt');
		expect(header.get('expect')).toBe('success');
		const plain = await decryptAll(file, header.get('passphrase') ?? '');
		expect(createHash('sha256').update(plain).digest('hex')).toBe(header.get('payload'));
	});

	it('refuses a wrong passphrase and a changed tag like the reference implementation', async () => {
		for (const name of ['scrypt_no_match', 'scrypt_bad_tag']) {
			const { header, file } = vector(name);
			expect(header.get('expect'), name).toBe('no match');
			await expect(decryptAll(file, header.get('passphrase') ?? ''), name).rejects.toMatchObject({ reason: 'passphrase' });
		}
	});
});
