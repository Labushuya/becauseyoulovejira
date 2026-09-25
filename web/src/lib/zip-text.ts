// One text file out of a .zip (E4 plan, package 16; ADR-0017 section 3): the WhatsApp export of
// iOS and, with "Medien einbeziehen" switched off, of Android comes as a .zip with `_chat.txt`
// or one other .txt. Reads the central directory, takes that entry and inflates it with the
// browser's DecompressionStream ("deflate-raw"); no library. ZIP64, encryption and other methods
// than "stored" and "deflate" are refused, and the CRC-32 is checked.

/** Largest text taken out of a .zip (the limit of the export file). */
export const ZIP_TEXT_MAX_BYTES = 20 * 1024 * 1024;

export const ZIP_DAMAGED_MESSAGE = 'Die ZIP-Datei ist beschädigt.';
export const ZIP_NO_TEXT_MESSAGE =
	'In der ZIP-Datei steht kein Chat (_chat.txt oder eine .txt-Datei).';
export const ZIP_UNSUPPORTED_MESSAGE =
	'Diese ZIP-Datei lässt sich nicht lesen (verschlüsselt oder unbekanntes Verfahren).';
export const ZIP_TOO_LARGE_MESSAGE = 'Der Chat in der ZIP-Datei ist größer als 20 MB.';

export type ZipTextResult =
	{ ok: true; name: string; text: string } | { ok: false; message: string };

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const UTF8_NAME = 0x0800;
const ENCRYPTED = 0x0001;
const ZIP64_MARK = 0xffffffff;

interface Entry {
	name: string;
	flags: number;
	method: number;
	crc: number;
	compressedSize: number;
	size: number;
	localOffset: number;
}

class ZipError extends Error {}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
	if (crcTable === null) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function findEnd(view: DataView): number {
	// The record is 22 bytes plus a comment of at most 65 535 bytes.
	const last = view.byteLength - 22;
	const first = Math.max(0, last - 0xffff);
	for (let at = last; at >= first; at--) {
		if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) return at;
	}
	throw new ZipError(ZIP_DAMAGED_MESSAGE);
}

function readEntries(bytes: Uint8Array): Entry[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.byteLength < 22) throw new ZipError(ZIP_DAMAGED_MESSAGE);
	const end = findEnd(view);
	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	if (at === ZIP64_MARK || count === 0xffff) throw new ZipError(ZIP_UNSUPPORTED_MESSAGE);
	const entries: Entry[] = [];
	for (let i = 0; i < count; i++) {
		if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL_ENTRY) {
			throw new ZipError(ZIP_DAMAGED_MESSAGE);
		}
		const flags = view.getUint16(at + 8, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		if (at + 46 + nameLength > view.byteLength) throw new ZipError(ZIP_DAMAGED_MESSAGE);
		const rawName = bytes.subarray(at + 46, at + 46 + nameLength);
		const name = new TextDecoder(flags & UTF8_NAME ? 'utf-8' : 'latin1').decode(rawName);
		entries.push({
			name,
			flags,
			method: view.getUint16(at + 10, true),
			crc: view.getUint32(at + 16, true),
			compressedSize: view.getUint32(at + 20, true),
			size: view.getUint32(at + 24, true),
			localOffset: view.getUint32(at + 42, true)
		});
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

function baseName(name: string): string {
	return name.replace(/^.*\//, '');
}

/** `_chat.txt` first, else the only .txt file (outside of hidden macOS folders). */
function chooseEntry(entries: readonly Entry[]): Entry {
	const texts = entries.filter(
		(entry) => /\.txt$/i.test(entry.name) && !entry.name.startsWith('__MACOSX/')
	);
	const chat = texts.find((entry) => baseName(entry.name).toLowerCase() === '_chat.txt');
	if (chat !== undefined) return chat;
	if (texts.length === 1 && texts[0] !== undefined) return texts[0];
	throw new ZipError(ZIP_NO_TEXT_MESSAGE);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
	const input = new ReadableStream<BufferSource>({
		start(controller) {
			// A copy on its own ArrayBuffer, as the stream types ask for.
			controller.enqueue(new Uint8Array(data));
			controller.close();
		}
	});
	const reader = input.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > ZIP_TEXT_MAX_BYTES) {
			await reader.cancel();
			throw new ZipError(ZIP_TOO_LARGE_MESSAGE);
		}
		chunks.push(value);
	}
	const result = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

async function contentOf(bytes: Uint8Array, entry: Entry): Promise<Uint8Array> {
	if (entry.flags & ENCRYPTED) throw new ZipError(ZIP_UNSUPPORTED_MESSAGE);
	if (entry.method !== STORED && entry.method !== DEFLATED) {
		throw new ZipError(ZIP_UNSUPPORTED_MESSAGE);
	}
	if (entry.size === ZIP64_MARK || entry.compressedSize === ZIP64_MARK) {
		throw new ZipError(ZIP_UNSUPPORTED_MESSAGE);
	}
	if (entry.size > ZIP_TEXT_MAX_BYTES) throw new ZipError(ZIP_TOO_LARGE_MESSAGE);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const at = entry.localOffset;
	if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL_HEADER) {
		throw new ZipError(ZIP_DAMAGED_MESSAGE);
	}
	const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
	const end = start + entry.compressedSize;
	if (end > view.byteLength) throw new ZipError(ZIP_DAMAGED_MESSAGE);
	const data = bytes.subarray(start, end);
	let content: Uint8Array;
	try {
		content = entry.method === STORED ? data : await inflate(data);
	} catch (error) {
		if (error instanceof ZipError) throw error;
		throw new ZipError(ZIP_DAMAGED_MESSAGE);
	}
	if (content.byteLength !== entry.size || crc32(content) !== entry.crc) {
		throw new ZipError(ZIP_DAMAGED_MESSAGE);
	}
	return content;
}

/** Reads the chat text (UTF-8, without BOM) out of the bytes of a .zip file. */
export async function readZipText(data: ArrayBuffer | Uint8Array): Promise<ZipTextResult> {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	try {
		const entry = chooseEntry(readEntries(bytes));
		const content = await contentOf(bytes, entry);
		const text = new TextDecoder('utf-8').decode(content);
		return { ok: true, name: baseName(entry.name), text };
	} catch (error) {
		if (error instanceof ZipError) return { ok: false, message: error.message };
		return { ok: false, message: ZIP_DAMAGED_MESSAGE };
	}
}
