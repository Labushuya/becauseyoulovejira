// The tar container of a sealed backup (ADR-0046 §3): headers, padding, pax sizes and the checks
// of the reader. The interplay with the tar programs of Windows and Linux is checked as a process
// in tests/integration/backup-helper-process.test.mjs.

import { describe, expect, it } from 'vitest';
import { BLOCK, fileHeader, padding, readTar, TarError, trailer } from './tar';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MTIME = new Date('2026-10-01T12:00:00Z');

async function* chunks(parts: Uint8Array[], size = 100): AsyncGenerator<Uint8Array> {
	const all = Buffer.concat(parts);
	for (let offset = 0; offset < all.length; offset += size) yield all.subarray(offset, offset + size);
}

function archive(entries: [string, string][]): Uint8Array[] {
	return entries.flatMap(([name, content]) => {
		const bytes = encoder.encode(content);
		return [fileHeader(name, bytes.length, MTIME), bytes, padding(bytes.length)];
	}).concat([trailer()]);
}

async function readAll(parts: Uint8Array[], size?: number): Promise<[string, string][]> {
	const result: [string, string][] = [];
	for await (const entry of readTar(chunks(parts, size))) {
		const body: Uint8Array[] = [];
		for await (const chunk of entry.body) body.push(chunk);
		result.push([entry.name, decoder.decode(Buffer.concat(body))]);
	}
	return result;
}

describe('tar container', () => {
	it('writes ustar headers with octal fields, a checksum and blocks of 512 bytes', () => {
		const header = fileHeader('manifest.json', 1234, MTIME);
		expect(header.length).toBe(BLOCK);
		const text = (from: number, length: number) => decoder.decode(header.subarray(from, from + length));
		expect(text(0, 13)).toBe('manifest.json');
		expect(text(124, 12)).toBe('00000002322\0');
		expect(text(136, 12)).toBe(`${(MTIME.getTime() / 1000).toString(8).padStart(11, '0')}\0`);
		expect(text(156, 1)).toBe('0');
		expect(text(257, 8)).toBe('ustar\u000000');
		let sum = 0;
		for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
		expect(text(148, 8)).toBe(`${sum.toString(8).padStart(6, '0')}\0 `);
		expect(padding(1234).length).toBe(BLOCK * 3 - 1234);
		expect(padding(BLOCK).length).toBe(0);
	});

	it('reads back what it wrote, in any chunk size', async () => {
		const entries: [string, string][] = [
			['LIESMICH.txt', 'Hallo'],
			['leer.json', ''],
			['genau.bin', 'x'.repeat(BLOCK)],
			['umlaute.txt', 'Prüfung äöü ß']
		];
		for (const size of [1, 7, 511, 512, 513, 4096]) {
			expect(await readAll(archive(entries), size)).toEqual(entries);
		}
	});

	it('skips what a reader leaves unread of an entry', async () => {
		const names: string[] = [];
		for await (const entry of readTar(chunks(archive([['a.bin', 'a'.repeat(1500)], ['b.txt', 'b']]), 64))) {
			names.push(entry.name);
			for await (const chunk of entry.body) {
				void chunk;
				break;
			}
		}
		expect(names).toEqual(['a.bin', 'b.txt']);
	});

	it('puts the size of a file from 8 GiB into a pax header', async () => {
		const size = 9 * 1024 * 1024 * 1024;
		const blocks = fileHeader('pb_data.zip', size, MTIME);
		expect(blocks.length).toBe(3 * BLOCK);
		expect(String.fromCharCode(blocks[156] ?? 0)).toBe('x');
		expect(decoder.decode(blocks.subarray(BLOCK, BLOCK + 20))).toBe('19 size=9663676416\n\0');
		for await (const entry of readTar(chunks([blocks], 512))) {
			expect(entry).toMatchObject({ name: 'pb_data.zip', size });
			break;
		}
	});

	it('accepts zero records after the end, as tar programs write them', async () => {
		expect(await readAll([...archive([['a.txt', 'a']]), new Uint8Array(10 * BLOCK)])).toEqual([['a.txt', 'a']]);
	});

	it('refuses a changed header, other entry types, a cut archive and data after the end', async () => {
		const changed = archive([['a.txt', 'a']]);
		changed[0] = Uint8Array.from(changed[0] ?? []);
		(changed[0] as Uint8Array)[0] = 'b'.charCodeAt(0);
		await expect(readAll(changed)).rejects.toThrow(/checksum/);

		const folder = fileHeader('ordner', 0, MTIME);
		folder[156] = '5'.charCodeAt(0);
		let sum = 0;
		for (let index = 0; index < BLOCK; index += 1) sum += index >= 148 && index < 156 ? 32 : (folder[index] ?? 0);
		folder.set(encoder.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
		await expect(readAll([folder, trailer()])).rejects.toThrow(/regular files/);

		const whole = Buffer.concat(archive([['a.txt', 'abc']]));
		await expect(readAll([whole.subarray(0, BLOCK + 2)])).rejects.toThrow(TarError);
		await expect(readAll([whole.subarray(0, whole.length - BLOCK)])).rejects.toThrow(/ends too early/);
		await expect(readAll([whole, encoder.encode('x')])).rejects.toThrow(/after the end/);
		await expect(readAll([new Uint8Array(BLOCK).fill(1)])).rejects.toThrow(TarError);
	});

	it('refuses names that could leave the folder of the bundle', () => {
		for (const name of ['../a', 'a/b', 'a\\b', '', 'x'.repeat(100), 'ä.txt']) {
			expect(() => fileHeader(name, 0, MTIME), name).toThrow(TarError);
		}
	});
});
