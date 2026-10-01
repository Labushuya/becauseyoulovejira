// A sealed backup (ADR-0046 §3): an age file (passphrase) around a tar archive with fixed entries.
// `seal` writes it from the backup ZIP of PocketBase, the settings of the installation, a manifest
// and, if wanted, the values of the BYL_* variables; nothing of it touches the disk in plain text.
// `open` reads it back: the data, manifest and settings go to a folder, the access data only to the
// caller in memory. Both stream, so the size of the data does not matter.

import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { decrypt, encrypt } from './age';
import { fileHeader, padding, readTar, trailer } from './tar';

/** Names of the entries, in the order `seal` writes them. */
export const ENTRY = {
	readme: 'LIESMICH.txt',
	manifest: 'manifest.json',
	config: 'byl-config.json',
	credentials: 'zugangsdaten.json',
	data: 'pb_data.zip'
} as const;

const KNOWN_ENTRIES: readonly string[] = Object.values(ENTRY);
// Limits for the entries that are read into memory.
const SMALL_ENTRY_MAX = 1024 * 1024;
const CONFIG_MAX = 64 * 1024;
const VALUE_MAX = 32 * 1024;
export const VARIABLE_PATTERN = /^BYL_[A-Z0-9_]{1,60}$/;
export const MANIFEST_FORMAT = 1;

export const README = [
	'becauseyoulovejira - Sicherung',
	'',
	'Diese Datei gehoert zu einer verschluesselten Sicherung (Format age, mit Passphrase).',
	'Nach dem Entschluesseln ist sie ein tar-Archiv mit:',
	'  pb_data.zip        Daten der App (Tickets, Eingang, Originaldateien, Konten)',
	'  manifest.json      Datum, Zaehlungen und Namen der Zugangsdaten-Variablen',
	'  byl-config.json    Einstellungen der Installation (Port, Sicherung), falls vorhanden',
	'  zugangsdaten.json  Werte der Windows-Variablen BYL_*, falls mitgesichert - geheim!',
	'',
	'Am einfachsten: wiederherstellen.bat im Ordner app der App.',
	'Ohne die App (Notfall):',
	'  1. age --decrypt --output sicherung.tar <Datei>.tar.age   (fragt nach der Passphrase)',
	'  2. tar -xf sicherung.tar',
	'  3. stop.bat, dann pb_data.zip in einen leeren Ordner app\\pb_data entpacken.',
	'  4. Zugangsdaten je Variable setzen: setx NAME "Wert", danach neu-starten.bat.',
	'Danach sicherung.tar und zugangsdaten.json loeschen.',
	''
].join('\r\n');

const CREDENTIALS_NOTE =
	'Werte der Windows-Benutzervariablen BYL_* zum Zeitpunkt der Sicherung. wiederherstellen.bat schreibt sie auf Wunsch zurück; von Hand: setx NAME "Wert".';

export type BundleFailure = 'input' | 'format' | 'damaged' | 'missing' | 'access' | 'space' | 'io';

export class BundleError extends Error {
	readonly reason: BundleFailure;

	constructor(reason: BundleFailure, message: string) {
		super(message);
		this.reason = reason;
	}
}

const encoder = new TextEncoder();

function ioError(error: unknown, what: string): BundleError {
	const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
	if (code === 'ENOSPC') return new BundleError('space', `no space left while writing ${what}`);
	if (code === 'EACCES' || code === 'EPERM') return new BundleError('access', `no access to ${what}`);
	if (code === 'ENOENT') return new BundleError('missing', `${what} does not exist`);
	return new BundleError('io', `${what}: ${error instanceof Error ? error.message : String(error)}`);
}

export interface SealInput {
	/** The backup ZIP of PocketBase. */
	data: string;
	/** The sealed file to write (replaced if it exists). */
	out: string;
	/** byl-config.json of the installation; missing or null: not part of the backup. */
	config: string | null;
	passphrase: string;
	manifest: Record<string, unknown>;
	/** Values of the BYL_* variables; empty: no entry with access data. */
	secrets: Record<string, string>;
	/** scrypt exponent; only the self-test and the tests lower it. */
	workFactor?: number;
}

export function checkSecrets(secrets: Record<string, string>): void {
	for (const [name, value] of Object.entries(secrets)) {
		if (!VARIABLE_PATTERN.test(name) || typeof value !== 'string' || value.length > VALUE_MAX) {
			throw new BundleError('input', 'invalid access data');
		}
	}
}

async function readConfig(path: string | null): Promise<Uint8Array | null> {
	if (path === null) return null;
	try {
		const bytes = await readFile(path);
		if (bytes.length > CONFIG_MAX) throw new BundleError('input', 'byl-config.json is too large');
		return bytes;
	} catch (error) {
		if (error instanceof BundleError) throw error;
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
		throw ioError(error, 'byl-config.json');
	}
}

function json(value: unknown): Uint8Array {
	return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

/** Writes the sealed backup; the size of the file. */
export async function seal(input: SealInput): Promise<{ bytes: number }> {
	if (input.passphrase === '') throw new BundleError('input', 'no passphrase');
	checkSecrets(input.secrets);
	let dataSize: number;
	try {
		const info = await stat(input.data);
		if (!info.isFile()) throw new BundleError('missing', 'the backup ZIP is not a file');
		dataSize = info.size;
	} catch (error) {
		throw error instanceof BundleError ? error : ioError(error, 'the backup ZIP');
	}
	const now = new Date();
	const small: [string, Uint8Array][] = [
		[ENTRY.readme, encoder.encode(README)],
		[ENTRY.manifest, json({ ...input.manifest, format: MANIFEST_FORMAT })]
	];
	const config = await readConfig(input.config);
	if (config !== null) small.push([ENTRY.config, config]);
	if (Object.keys(input.secrets).length > 0) {
		small.push([ENTRY.credentials, json({ hinweis: CREDENTIALS_NOTE, variablen: input.secrets })]);
	}
	const dataPath = input.data;

	async function* plain(): AsyncGenerator<Uint8Array> {
		for (const [name, bytes] of small) {
			yield fileHeader(name, bytes.length, now);
			yield bytes;
			yield padding(bytes.length);
		}
		yield fileHeader(ENTRY.data, dataSize, now);
		let read = 0;
		for await (const chunk of createReadStream(dataPath)) {
			const bytes = chunk as Uint8Array;
			read += bytes.length;
			if (read > dataSize) throw new BundleError('io', 'the backup ZIP grew while it was sealed');
			yield bytes;
		}
		if (read !== dataSize) throw new BundleError('io', 'the backup ZIP shrank while it was sealed');
		yield padding(dataSize);
		yield trailer();
	}

	const sealed = await encrypt(input.passphrase, ReadableStream.from(plain()), input.workFactor);
	// Written beside the target and renamed at the end: an interrupted run leaves no file that looks
	// like a backup. flush: the data is on the disk before the name says it is complete.
	const partial = `${input.out}.partial-${randomBytes(4).toString('hex')}`;
	try {
		await pipeline(Readable.fromWeb(sealed), createWriteStream(partial, { flags: 'wx', flush: true }));
		await rename(partial, input.out);
	} catch (error) {
		await rm(partial, { force: true }).catch(() => undefined);
		if (error instanceof BundleError) throw error;
		throw ioError(error, 'the sealed backup');
	}
	return { bytes: (await stat(input.out)).size };
}

export interface OpenInput {
	file: string;
	/** Existing folder for pb_data.zip, manifest.json and byl-config.json. */
	out: string;
	passphrase: string;
}

export interface OpenResult {
	manifest: Record<string, unknown>;
	/** Names of the variables in the backup (also without asking for their values). */
	variables: string[];
	secrets: Record<string, string>;
	config: boolean;
	dataBytes: number;
}

async function collect(body: AsyncIterable<Uint8Array>, limit: number, name: string): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of body) {
		size += chunk.length;
		if (size > limit) throw new BundleError('damaged', `${name} is too large`);
		parts.push(chunk);
	}
	const result = new Uint8Array(size);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

function parseJson(bytes: Uint8Array, name: string): unknown {
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new BundleError('damaged', `${name} is not JSON`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function credentialsOf(value: unknown): Record<string, string> {
	if (!isRecord(value) || !isRecord(value.variablen)) throw new BundleError('damaged', 'invalid access data');
	const secrets: Record<string, string> = {};
	for (const [name, entry] of Object.entries(value.variablen)) {
		if (!VARIABLE_PATTERN.test(name) || typeof entry !== 'string' || entry.length > VALUE_MAX) {
			throw new BundleError('damaged', 'invalid access data');
		}
		secrets[name] = entry;
	}
	return secrets;
}

/** Whether `error` comes from the file system (it names its system call). */
function isFileError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'syscall' in error;
}

async function writeBody(body: AsyncIterable<Uint8Array>, path: string): Promise<void> {
	try {
		await pipeline(Readable.from(body), createWriteStream(path, { flags: 'w', flush: true }));
	} catch (error) {
		// Errors of the source (damaged or cut data) go on as they are.
		throw isFileError(error) ? ioError(error, ENTRY.data) : error;
	}
}

/**
 * Decrypts and checks a sealed backup completely and writes its data, manifest and settings into
 * `out`. The access data stay in memory.
 */
export async function open(input: OpenInput): Promise<OpenResult> {
	try {
		if (!(await stat(input.file)).isFile()) throw new BundleError('missing', 'the backup is not a file');
	} catch (error) {
		throw error instanceof BundleError ? error : ioError(error, 'the backup');
	}
	const source = Readable.toWeb(createReadStream(input.file)) as ReadableStream<Uint8Array>;
	const plain = await decrypt(input.passphrase, source);
	const seen = new Set<string>();
	let manifest: Record<string, unknown> | null = null;
	let secrets: Record<string, string> = {};
	let dataBytes = -1;
	try {
		for await (const entry of readTar(plain)) {
			if (!KNOWN_ENTRIES.includes(entry.name) || seen.has(entry.name)) {
				throw new BundleError('damaged', `unexpected entry ${entry.name}`);
			}
			seen.add(entry.name);
			switch (entry.name) {
				case ENTRY.manifest: {
					const bytes = await collect(entry.body, SMALL_ENTRY_MAX, entry.name);
					await writeFile(join(input.out, ENTRY.manifest), bytes);
					const value = parseJson(bytes, entry.name);
					if (!isRecord(value) || value.format !== MANIFEST_FORMAT) {
						throw new BundleError('format', 'unknown manifest format');
					}
					manifest = value;
					break;
				}
				case ENTRY.config: {
					const bytes = await collect(entry.body, CONFIG_MAX, entry.name);
					parseJson(bytes, entry.name);
					await writeFile(join(input.out, ENTRY.config), bytes);
					break;
				}
				case ENTRY.credentials:
					secrets = credentialsOf(parseJson(await collect(entry.body, SMALL_ENTRY_MAX, entry.name), entry.name));
					break;
				case ENTRY.data:
					await writeBody(entry.body, join(input.out, ENTRY.data));
					dataBytes = entry.size;
					break;
				default:
					await collect(entry.body, SMALL_ENTRY_MAX, entry.name);
			}
		}
	} catch (error) {
		if (error instanceof BundleError) throw error;
		// A broken archive, or age found a changed or cut chunk while decrypting.
		const message = error instanceof Error ? error.message : String(error);
		throw new BundleError('damaged', `damaged backup: ${message}`);
	}
	if (manifest === null || dataBytes < 0) throw new BundleError('damaged', 'manifest or data missing');
	return { manifest, variables: Object.keys(secrets).sort(), secrets, config: seen.has(ENTRY.config), dataBytes };
}
