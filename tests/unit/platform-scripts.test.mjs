// Platform-neutral scripts (ADR-0028, plan plattformen S0): names of the executables per system
// and scripts/fetch-pocketbase.mjs (pinned archive per platform, ZIP reading without an unzip tool).
// Nothing here downloads; the fetch itself runs in both CI jobs.

import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	POCKETBASE_ARCHIVES,
	POCKETBASE_VERSION,
	pocketBaseTarget,
	readZipEntry
} from '../../scripts/fetch-pocketbase.mjs';
import { executableName } from '../../scripts/platform.mjs';

/** A ZIP archive with the given files, stored (method 0) or deflated (method 8). */
function zipOf(files, method = 8) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const data = Buffer.from(text);
		const packed = method === 8 ? deflateRawSync(data) : data;
		const nameBytes = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(crc32(data), 14);
		local.writeUInt32LE(packed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(method, 10);
		central.writeUInt32LE(crc32(data), 16);
		central.writeUInt32LE(packed.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBytes, packed);
		centrals.push(central, nameBytes);
		offset += local.length + nameBytes.length + packed.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}

describe('executableName', () => {
	it('adds .exe only on Windows', () => {
		expect(executableName('pocketbase', 'win32')).toBe('pocketbase.exe');
		expect(executableName('byl-mail', 'win32')).toBe('byl-mail.exe');
		expect(executableName('pocketbase', 'linux')).toBe('pocketbase');
		expect(executableName('byl-mail', 'darwin')).toBe('byl-mail');
	});
});

describe('pocketBaseTarget', () => {
	it.each([
		['win32', 'x64', 'windows_amd64', 'pocketbase.exe'],
		['linux', 'x64', 'linux_amd64', 'pocketbase'],
		['linux', 'arm64', 'linux_arm64', 'pocketbase'],
		['linux', 'arm', 'linux_armv7', 'pocketbase']
	])('picks the archive for %s/%s', (platform, arch, key, binary) => {
		const target = pocketBaseTarget(platform, arch);
		expect(target).toEqual({
			key,
			archive: `pocketbase_${POCKETBASE_VERSION}_${key}.zip`,
			url: `https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_${key}.zip`,
			sha256: POCKETBASE_ARCHIVES[key],
			binary
		});
	});

	it.each([
		['darwin', 'arm64'],
		['win32', 'arm64'],
		['linux', 'ppc64']
	])('refuses %s/%s without a pinned archive', (platform, arch) => {
		expect(() => pocketBaseTarget(platform, arch)).toThrow(`No pinned PocketBase build for ${platform}/${arch}.`);
	});

	it('pins the version of CLAUDE.md and a SHA256 per archive', () => {
		expect(POCKETBASE_VERSION).toBe('0.40.4');
		const claude = readFileSync(new URL('../../CLAUDE.md', import.meta.url), 'utf8');
		expect(claude).toContain(`PocketBase **v${POCKETBASE_VERSION}**`);
		expect(Object.keys(POCKETBASE_ARCHIVES).sort()).toEqual(['linux_amd64', 'linux_arm64', 'linux_armv7', 'windows_amd64']);
		for (const hash of Object.values(POCKETBASE_ARCHIVES)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(new Set(Object.values(POCKETBASE_ARCHIVES)).size).toBe(4);
	});

	it('keeps the Windows entry a thin call of the Node script', () => {
		const wrapper = readFileSync(new URL('../../scripts/fetch-pocketbase.ps1', import.meta.url), 'utf8');
		expect(wrapper).toContain("fetch-pocketbase.mjs'");
		expect(wrapper).not.toMatch(/Invoke-WebRequest|checksums\.txt/);
	});
});

describe('readZipEntry', () => {
	it.each([
		['deflated', 8],
		['stored', 0]
	])('reads a %s entry among others', (_, method) => {
		const zip = zipOf({ 'LICENSE.md': 'MIT', pocketbase: 'binary content', 'CHANGELOG.md': 'notes' }, method);
		expect(readZipEntry(zip, 'pocketbase').toString()).toBe('binary content');
		expect(readZipEntry(zip, 'CHANGELOG.md').toString()).toBe('notes');
	});

	it('matches the name exactly', () => {
		const zip = zipOf({ 'pocketbase.exe': 'windows' });
		expect(() => readZipEntry(zip, 'pocketbase')).toThrow('pocketbase not found in the archive.');
		expect(readZipEntry(zip, 'pocketbase.exe').toString()).toBe('windows');
	});

	it('refuses a damaged entry, a damaged directory and data that is no archive', () => {
		const zip = zipOf({ pocketbase: 'binary content' }, 0);
		const flipped = Buffer.from(zip);
		flipped[30 + 'pocketbase'.length] ^= 0xff;
		expect(() => readZipEntry(flipped, 'pocketbase')).toThrow('damaged (size or CRC-32)');

		const brokenDirectory = Buffer.from(zip);
		brokenDirectory.writeUInt32LE(0, zip.length - 22 - 46 - 'pocketbase'.length);
		expect(() => readZipEntry(brokenDirectory, 'pocketbase')).toThrow('Damaged ZIP archive (central directory).');

		expect(() => readZipEntry(Buffer.from('no zip at all, just text of some length'), 'pocketbase')).toThrow(
			'Not a ZIP archive'
		);
	});
});
