// The inner container of a sealed backup (ADR-0046 §3): a POSIX tar archive (ustar, with a pax
// header for sizes from 8 GiB). tar streams in both directions, so a backup is sealed and opened
// without a temporary copy in plain text, and every tar program opens it in an emergency (Windows
// 10 and 11 ship tar.exe). Only regular files with the names the bundle knows are written and
// read; anything else counts as a damaged archive.

export const BLOCK = 512;
// The largest size the 11 octal digits of the ustar size field hold (8 GiB - 1).
const USTAR_MAX_SIZE = 0o77777777777;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class TarError extends Error {}

function writeText(header: Uint8Array, offset: number, length: number, text: string): void {
	const bytes = encoder.encode(text);
	if (bytes.length > length) throw new TarError(`field too long: ${text}`);
	header.set(bytes, offset);
}

function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
	// length - 1 digits and a NUL, as GNU tar and bsdtar write them.
	writeText(header, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function checksum(header: Uint8Array): number {
	let sum = 0;
	for (let index = 0; index < BLOCK; index += 1) {
		sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
	}
	return sum;
}

function ustarHeader(name: string, size: number, mtimeSeconds: number, type: '0' | 'x'): Uint8Array {
	const header = new Uint8Array(BLOCK);
	writeText(header, 0, 100, name);
	writeOctal(header, 100, 8, 0o644);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, size);
	writeOctal(header, 136, 12, mtimeSeconds);
	writeText(header, 156, 1, type);
	writeText(header, 257, 6, 'ustar\0');
	writeText(header, 263, 2, '00');
	writeText(header, 148, 8, `${checksum(header).toString(8).padStart(6, '0')}\0 `);
	return header;
}

/** A pax record "<length> <key>=<value>\n", whose length counts itself. */
function paxRecord(key: string, value: string): string {
	const body = ` ${key}=${value}\n`;
	let length = body.length + 1;
	while (`${length}${body}`.length !== length) length = `${length}${body}`.length;
	return `${length}${body}`;
}

/** Zero bytes that fill `size` up to the next block. */
export function padding(size: number): Uint8Array {
	const rest = size % BLOCK;
	return rest === 0 ? new Uint8Array(0) : new Uint8Array(BLOCK - rest);
}

/**
 * The header blocks of a regular file `name` with `size` bytes: one ustar block, and before it a
 * pax header with the exact size when the size does not fit the ustar field.
 */
export function fileHeader(name: string, size: number, mtime: Date): Uint8Array {
	if (!/^[A-Za-z0-9._-]{1,99}$/.test(name)) throw new TarError(`invalid entry name: ${name}`);
	if (!Number.isSafeInteger(size) || size < 0) throw new TarError(`invalid size: ${size}`);
	const seconds = Math.max(0, Math.floor(mtime.getTime() / 1000));
	if (size <= USTAR_MAX_SIZE) return ustarHeader(name, size, seconds, '0');
	const records = encoder.encode(paxRecord('size', String(size)));
	const pax = ustarHeader(`PaxHeader/${name}`.slice(0, 99), records.length, seconds, 'x');
	const blocks = new Uint8Array(BLOCK + records.length + padding(records.length).length + BLOCK);
	blocks.set(pax, 0);
	blocks.set(records, BLOCK);
	blocks.set(ustarHeader(name, 0, seconds, '0'), blocks.length - BLOCK);
	return blocks;
}

/** The end of an archive: two zero blocks. */
export function trailer(): Uint8Array {
	return new Uint8Array(2 * BLOCK);
}

/** Reads exactly as many bytes as asked from a stream of chunks. */
export class ChunkReader {
	readonly #source: AsyncIterator<Uint8Array>;
	#buffer: Uint8Array = new Uint8Array(0);
	#offset = 0;
	#done = false;

	constructor(source: AsyncIterable<Uint8Array>) {
		this.#source = source[Symbol.asyncIterator]();
	}

	async #fill(): Promise<boolean> {
		while (this.#offset >= this.#buffer.length) {
			if (this.#done) return false;
			const next = await this.#source.next();
			if (next.done === true) {
				this.#done = true;
				return false;
			}
			this.#buffer = next.value;
			this.#offset = 0;
		}
		return true;
	}

	/** Exactly `length` bytes; throws if the stream ends before. */
	async read(length: number): Promise<Uint8Array> {
		const result = new Uint8Array(length);
		let filled = 0;
		while (filled < length) {
			if (!(await this.#fill())) throw new TarError('archive ends too early');
			const take = Math.min(length - filled, this.#buffer.length - this.#offset);
			result.set(this.#buffer.subarray(this.#offset, this.#offset + take), filled);
			this.#offset += take;
			filled += take;
		}
		return result;
	}

	/** The next `length` bytes as chunks, without holding them all in memory. */
	async *take(length: number): AsyncGenerator<Uint8Array> {
		let left = length;
		while (left > 0) {
			if (!(await this.#fill())) throw new TarError('archive ends too early');
			const take = Math.min(left, this.#buffer.length - this.#offset);
			const chunk = this.#buffer.slice(this.#offset, this.#offset + take);
			// Advanced before the yield: a consumer that stops after this chunk has it behind it.
			this.#offset += take;
			left -= take;
			yield chunk;
		}
	}

	/** Everything that is left, to the end of the stream. */
	async *rest(): AsyncGenerator<Uint8Array> {
		while (await this.#fill()) {
			const chunk = this.#buffer.slice(this.#offset);
			this.#offset = this.#buffer.length;
			yield chunk;
		}
	}
}

function fieldText(header: Uint8Array, offset: number, length: number): string {
	const field = header.subarray(offset, offset + length);
	const end = field.indexOf(0);
	try {
		return decoder.decode(end === -1 ? field : field.subarray(0, end));
	} catch {
		throw new TarError('header is not UTF-8');
	}
}

function fieldNumber(header: Uint8Array, offset: number, length: number): number {
	const text = fieldText(header, offset, length).trim();
	if (!/^[0-7]+$/.test(text)) throw new TarError('invalid number in header');
	return Number.parseInt(text, 8);
}

function isZero(block: Uint8Array): boolean {
	return block.every((byte) => byte === 0);
}

function parsePax(bytes: Uint8Array): Map<string, string> {
	let text: string;
	try {
		text = decoder.decode(bytes);
	} catch {
		throw new TarError('pax header is not UTF-8');
	}
	const records = new Map<string, string>();
	let rest = text;
	while (rest.length > 0) {
		const match = /^(\d+) ([^=\n]+)=/.exec(rest);
		const length = match === null ? Number.NaN : Number(match[1]);
		if (match === null || !Number.isSafeInteger(length) || length > rest.length || rest[length - 1] !== '\n') {
			throw new TarError('invalid pax record');
		}
		const record = rest.slice(0, length);
		records.set(match[2] ?? '', record.slice(match[0].length, -1));
		rest = rest.slice(length);
	}
	return records;
}

export interface TarEntry {
	name: string;
	size: number;
	/** The content as chunks; must be consumed before the next entry is read. */
	body: AsyncGenerator<Uint8Array>;
}

/**
 * The regular files of the archive in `source`, in their order. Checks every header (checksum,
 * ustar magic, type) and the end of the archive; a pax header may give the size. After the end
 * the source is read to its last byte (tar programs fill the last record with zeros): only then
 * has a decrypting source checked its last chunk.
 */
export async function* readTar(source: AsyncIterable<Uint8Array>): AsyncGenerator<TarEntry> {
	const reader = new ChunkReader(source);
	let paxSize: number | null = null;
	for (;;) {
		const header = await reader.read(BLOCK);
		if (isZero(header)) {
			if (!isZero(await reader.read(BLOCK))) throw new TarError('invalid end of archive');
			for await (const chunk of reader.rest()) {
				if (!isZero(chunk)) throw new TarError('data after the end of the archive');
			}
			return;
		}
		if (fieldNumber(header, 148, 8) !== checksum(header)) throw new TarError('header checksum mismatch');
		if (fieldText(header, 257, 6) !== 'ustar') throw new TarError('not a ustar archive');
		const type = String.fromCharCode(header[156] ?? 0);
		const size = fieldNumber(header, 124, 12);
		if (type === 'x') {
			if (size > 64 * 1024) throw new TarError('pax header too large');
			const records = parsePax(await reader.read(size));
			await reader.read(padding(size).length);
			const declared = records.get('size');
			paxSize = declared === undefined ? null : Number(declared);
			if (paxSize !== null && (!Number.isSafeInteger(paxSize) || paxSize < 0)) throw new TarError('invalid pax size');
			continue;
		}
		if (type !== '0' && type !== '\0') throw new TarError('only regular files are expected');
		const prefix = fieldText(header, 345, 155);
		const name = prefix === '' ? fieldText(header, 0, 100) : `${prefix}/${fieldText(header, 0, 100)}`;
		const length = paxSize ?? size;
		paxSize = null;
		let consumed = 0;
		const body = (async function* () {
			for await (const chunk of reader.take(length)) {
				consumed += chunk.length;
				yield chunk;
			}
		})();
		yield { name, size: length, body };
		// Whatever the consumer left unread of the body is skipped, then the padding.
		for await (const chunk of reader.take(length - consumed)) void chunk;
		await reader.read(padding(length).length);
	}
}
