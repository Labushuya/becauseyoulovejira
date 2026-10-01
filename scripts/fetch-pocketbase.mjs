// Fetches the pinned PocketBase release for this machine into app/ (ADR-0028, plan plattformen S0):
// app/pocketbase.exe on Windows, app/pocketbase on Linux. The archive is checked against the SHA256
// pinned below (from checksums.txt of the release), so a changed download never runs. Needs only
// Node (fetch, zlib, crypto); no unzip tool. If the binary is there in the pinned version, nothing
// is downloaded.
//
// Call: node scripts/fetch-pocketbase.mjs   (scripts\fetch-pocketbase.ps1 calls it on Windows)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { executableName } from './platform.mjs';

export const POCKETBASE_VERSION = '0.40.4';

/** SHA256 of the release archives, copied from checksums.txt of v0.40.4. */
export const POCKETBASE_ARCHIVES = Object.freeze({
	windows_amd64: '81c30964508fa7df15fe4571a6ee39e059859c566dad03ebf181aebe07366c3e',
	linux_amd64: '9042ec818570e79c3628dadcd0a756c1496d9e1173918ec409d133c02f82e5fa',
	linux_arm64: '86095bf8ed9345954f0d2bf0a5fb9b57584ae60b77ebf3b6cd23a8003a3fd418',
	linux_armv7: '9460e0be425cf8c7ae8e58f0186c13b59478b99ccef5cf0f734d05448952284b'
});

const LINUX_ARCHITECTURES = Object.freeze({ x64: 'linux_amd64', arm64: 'linux_arm64', arm: 'linux_armv7' });
const DOWNLOAD_TIMEOUT_MS = 180_000;

/**
 * The archive for `platform` and `arch` (values of process.platform and process.arch).
 * @returns {{ key: string, archive: string, url: string, sha256: string, binary: string }}
 */
export function pocketBaseTarget(platform = process.platform, arch = process.arch) {
	let key;
	if (platform === 'win32' && arch === 'x64') key = 'windows_amd64';
	if (platform === 'linux') key = LINUX_ARCHITECTURES[arch];
	if (key === undefined) {
		throw new Error(`No pinned PocketBase build for ${platform}/${arch}.`);
	}
	const archive = `pocketbase_${POCKETBASE_VERSION}_${key}.zip`;
	return {
		key,
		archive,
		url: `https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/${archive}`,
		sha256: POCKETBASE_ARCHIVES[key],
		binary: executableName('pocketbase', platform)
	};
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;

/**
 * Content of the file `name` in the ZIP archive `zip` (stored or deflated, no ZIP64), checked
 * against size and CRC-32 of the archive. Throws for a damaged archive or a missing entry.
 * @param {Buffer} zip
 * @param {string} name
 * @returns {Buffer}
 */
export function readZipEntry(zip, name) {
	let end = -1;
	for (let index = zip.length - 22; index >= Math.max(0, zip.length - 22 - 0xffff); index -= 1) {
		if (zip.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY) {
			end = index;
			break;
		}
	}
	if (end < 0) throw new Error('Not a ZIP archive (no end of central directory).');

	const count = zip.readUInt16LE(end + 10);
	let offset = zip.readUInt32LE(end + 16);
	for (let entry = 0; entry < count; entry += 1) {
		if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
			throw new Error('Damaged ZIP archive (central directory).');
		}
		const method = zip.readUInt16LE(offset + 10);
		const crc = zip.readUInt32LE(offset + 16);
		const compressedSize = zip.readUInt32LE(offset + 20);
		const size = zip.readUInt32LE(offset + 24);
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		const local = zip.readUInt32LE(offset + 42);
		const entryName = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
		offset += 46 + nameLength + extraLength + commentLength;
		if (entryName !== name) continue;

		if (compressedSize === ZIP64_MARKER || size === ZIP64_MARKER || local === ZIP64_MARKER) {
			throw new Error('ZIP64 archives are not supported.');
		}
		if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL_FILE_HEADER) {
			throw new Error('Damaged ZIP archive (local header).');
		}
		const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
		if (start + compressedSize > zip.length) throw new Error('Damaged ZIP archive (truncated).');
		const raw = zip.subarray(start, start + compressedSize);
		let data;
		if (method === 0) data = Buffer.from(raw);
		else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
		else throw new Error(`Unsupported ZIP compression method ${method}.`);
		if (data.length !== size || crc32(data) !== crc) {
			throw new Error(`${name} in the archive is damaged (size or CRC-32).`);
		}
		return data;
	}
	throw new Error(`${name} not found in the archive.`);
}

/** First line of `<binary> --version`, or "" if it does not run. */
function installedVersion(binary) {
	const result = spawnSync(binary, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
	if (result.error || result.status !== 0) return '';
	return (result.stdout ?? '').split(/\r?\n/)[0].trim();
}

/**
 * Exit codes of this script per cause; scripts\fetch-pocketbase.ps1 turns them into the entries
 * pocketbase-download, -checksum, -write, -version and -platform of the catalog app\byl-problems.ps1
 * (ADR-0048). Anything else ends with 1.
 */
export const FETCH_EXIT_CODES = Object.freeze({ download: 2, checksum: 3, write: 4, version: 5, platform: 6 });

/** An error of `cause` (a key of FETCH_EXIT_CODES) with its exit code. */
function failure(cause, message) {
	return Object.assign(new Error(message), { exitCode: FETCH_EXIT_CODES[cause] });
}

/** `action()`, with an error of it as one of `cause`. */
async function as(cause, action) {
	try {
		return await action();
	} catch (error) {
		throw failure(cause, error instanceof Error ? error.message : String(error));
	}
}

async function main() {
	const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
	const appDir = join(rootDir, 'app');
	const target = await as('platform', () => pocketBaseTarget());
	const destination = join(appDir, target.binary);
	await as('write', () => mkdirSync(appDir, { recursive: true }));

	if (existsSync(destination) && installedVersion(destination).includes(POCKETBASE_VERSION)) {
		console.log(`PocketBase ${POCKETBASE_VERSION} already present at ${destination}`);
		return;
	}

	console.log(`Downloading ${target.url} ...`);
	const zip = await as('download', async () => {
		const response = await fetch(target.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
		if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
		return Buffer.from(await response.arrayBuffer());
	});

	const actual = createHash('sha256').update(zip).digest('hex');
	if (actual !== target.sha256) {
		throw failure('checksum', `SHA256 mismatch for ${target.archive}: expected ${target.sha256}, got ${actual}`);
	}
	console.log(`Checksum verified: ${actual}`);

	const binary = await as('checksum', () => readZipEntry(zip, target.binary));
	const temporary = `${destination}.download`;
	await as('write', () => {
		try {
			writeFileSync(temporary, binary, { mode: 0o755 });
			if (process.platform !== 'win32') chmodSync(temporary, 0o755);
			renameSync(temporary, destination);
		} finally {
			rmSync(temporary, { force: true });
		}
	});

	const version = installedVersion(destination);
	if (!version.includes(POCKETBASE_VERSION)) {
		throw failure('version', `The installed binary does not report version ${POCKETBASE_VERSION} (got "${version}").`);
	}
	console.log(`Installed ${version} at ${destination}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(Number.isInteger(error?.exitCode) ? error.exitCode : 1);
	});
}
