// One text file out of a .zip (E4 plan, package 16). The archives are built here with node:zlib
// (deflate and stored) instead of being checked in, so every case shows its bytes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	ZIP_DAMAGED_MESSAGE,
	ZIP_NO_TEXT_MESSAGE,
	ZIP_UNSUPPORTED_MESSAGE,
	readZipText
} from './zip-text';

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/whatsapp');
const CHAT = readFileSync(join(FIXTURES, '_chat.txt'));

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

interface ZipFile {
	name: string;
	content: Uint8Array;
	method?: 0 | 8 | 12;
	flags?: number;
	crc?: number;
}

/** A minimal ZIP archive: local headers, central directory, end record. */
function zip(files: ZipFile[]): Uint8Array {
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	for (const file of files) {
		const method = file.method ?? 8;
		const name = new TextEncoder().encode(file.name);
		const data = method === 8 ? new Uint8Array(deflateRawSync(file.content)) : file.content;
		const crc = file.crc ?? crc32(file.content);
		const flags = (file.flags ?? 0) | 0x0800;
		const local = new Uint8Array(30 + name.length + data.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, flags, true);
		lv.setUint16(8, method, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, data.length, true);
		lv.setUint32(22, file.content.length, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);
		local.set(data, 30 + name.length);
		const central = new Uint8Array(46 + name.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(8, flags, true);
		cv.setUint16(10, method, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, data.length, true);
		cv.setUint32(24, file.content.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		central.set(name, 46);
		locals.push(local);
		centrals.push(central);
		offset += local.length;
	}
	const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, files.length, true);
	ev.setUint16(10, files.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);
	const parts = [...locals, ...centrals, end];
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

const text = (value: string) => new TextEncoder().encode(value);

describe('readZipText', () => {
	it('inflates _chat.txt next to media files (deflate)', async () => {
		const archive = zip([
			{ name: '00000012-PHOTO-2026-09-25.jpg', content: new Uint8Array([1, 2, 3]), method: 0 },
			{ name: '_chat.txt', content: CHAT }
		]);
		const result = await readZipText(archive);
		expect(result).toEqual({ ok: true, name: '_chat.txt', text: CHAT.toString('utf8') });
	});

	it('reads a stored entry, the only .txt in a folder, and drops a BOM', async () => {
		const archive = zip([
			{ name: 'Chat/WhatsApp Chat mit Anna.txt', content: text('\uFEFFHallo Welt'), method: 0 },
			{ name: '__MACOSX/Chat/._WhatsApp Chat mit Anna.txt', content: text('x'), method: 0 }
		]);
		expect(await readZipText(archive.buffer as ArrayBuffer)).toEqual({
			ok: true,
			name: 'WhatsApp Chat mit Anna.txt',
			text: 'Hallo Welt'
		});
	});

	it('refuses an archive without a single chat text', async () => {
		expect(await readZipText(zip([{ name: 'bild.jpg', content: text('x') }]))).toEqual({
			ok: false,
			message: ZIP_NO_TEXT_MESSAGE
		});
		const two = zip([
			{ name: 'a.txt', content: text('a') },
			{ name: 'b.txt', content: text('b') }
		]);
		expect(await readZipText(two)).toEqual({ ok: false, message: ZIP_NO_TEXT_MESSAGE });
	});

	it('refuses damaged archives: no end record, wrong checksum, broken data', async () => {
		expect(await readZipText(text('kein zip'))).toEqual({
			ok: false,
			message: ZIP_DAMAGED_MESSAGE
		});
		const wrongCrc = zip([{ name: '_chat.txt', content: CHAT, crc: 1 }]);
		expect(await readZipText(wrongCrc)).toEqual({ ok: false, message: ZIP_DAMAGED_MESSAGE });
		const broken = zip([{ name: '_chat.txt', content: CHAT }]);
		broken.fill(0xff, 40, 80);
		expect(await readZipText(broken)).toEqual({ ok: false, message: ZIP_DAMAGED_MESSAGE });
		const cut = zip([{ name: '_chat.txt', content: CHAT }]);
		expect(await readZipText(cut.subarray(0, cut.length - 30))).toEqual({
			ok: false,
			message: ZIP_DAMAGED_MESSAGE
		});
	});

	it('refuses encrypted entries and unknown methods', async () => {
		const encrypted = zip([{ name: '_chat.txt', content: CHAT, method: 0, flags: 1 }]);
		expect(await readZipText(encrypted)).toEqual({ ok: false, message: ZIP_UNSUPPORTED_MESSAGE });
		const bzip2 = zip([{ name: '_chat.txt', content: CHAT, method: 12 }]);
		expect(await readZipText(bzip2)).toEqual({ ok: false, message: ZIP_UNSUPPORTED_MESSAGE });
	});
});
