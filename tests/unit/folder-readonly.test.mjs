// The folder channel only reads (ADR-0051 §1): statically, no module of the channel writes, moves,
// renames or deletes a file or folder, opens one for writing or starts a program other than the
// streaming helper of the system (Windows PowerShell with the fixed script of folder-rules.js, or
// sha256sum). tests/integration/folder-channel.test.mjs checks the same on the disk: every file of
// a watched folder is as it was after the runs.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HOOKS = new URL('../../app/pb_hooks/', import.meta.url);
const read = (path) => readFileSync(new URL(path, HOOKS), 'utf8');
// Code without comments, so a sentence like "never deletes" does not count.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const CHANNEL_FILES = ['folders.pb.js', 'lib/folder-service.js', 'lib/folder-hash.js', 'lib/folder-rules.js'];
// Every function of $os that changes the disk, and the methods of os.Root and os.File that write.
const WRITING = [
	/\$os\.(?:writeFile|remove|removeAll|rename|mkdir|mkdirAll|truncate|openInRoot|chmod|chtimes)\b/,
	/\.(?:create|writeFile|writeString|remove|removeAll|rename|mkdir|mkdirAll|chmod|chown|chtimes|symlink|link|truncate|openFile)\(/,
	/\$filesystem\./,
	/newFilesystem\(/
];

describe('folder channel: read only', () => {
	it('names no writing function or method in the modules of the channel', () => {
		for (const file of CHANNEL_FILES) {
			const source = code(read(file));
			for (const pattern of WRITING) {
				expect(source, `${file} ${pattern}`).not.toMatch(pattern);
			}
		}
	});

	it('reads folders and files only through readDir, stat, openRoot and its open, lstat and fs', () => {
		const used = new Set();
		for (const file of CHANNEL_FILES) {
			for (const match of code(read(file)).matchAll(/\$os\.(\w+)/g)) used.add(match[1]);
		}
		expect([...used].sort()).toEqual(['cmd', 'getenv', 'openRoot', 'readDir', 'stat']);
		const service = code(read('lib/folder-service.js'));
		const hash = code(read('lib/folder-hash.js'));
		expect([...`${service}\n${hash}`.matchAll(/\broot\.(\w+)\(/g)].map((match) => match[1]).sort()).toEqual(
			expect.arrayContaining(['close', 'lstat', 'open'])
		);
		for (const method of [...`${service}\n${hash}`.matchAll(/\broot\.(\w+)\(/g)].map((match) => match[1])) {
			expect(['close', 'lstat', 'open', 'fs'], method).toContain(method);
		}
	});

	it('starts no program but the streaming helper of the system, with fixed arguments', () => {
		const service = code(read('lib/folder-service.js'));
		expect(service).not.toMatch(/\$os\.cmd/);
		const hash = code(read('lib/folder-hash.js'));
		expect(hash.match(/\$os\.cmd\(/g)).toHaveLength(2);
		expect(hash).toContain(
			"$os.cmd(powershell(), '-NoProfile', '-NonInteractive', '-EncodedCommand', rules.encodedCommand(rules.HASH_SCRIPT))"
		);
		expect(hash).toContain("$os.cmd('sha256sum', '-b', '--', path)");
		expect(hash).toContain("'\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe'");
	});

	it('logs no path: the log lines of the channel name only connection, entry, user and reason', () => {
		for (const file of CHANNEL_FILES) {
			for (const match of code(read(file)).matchAll(/logger\(\)\s*\.warn\(([^;]*)\);/g)) {
				expect(match[1], file).not.toMatch(/path|abs|source_ref|rel\b/);
			}
		}
	});
});
