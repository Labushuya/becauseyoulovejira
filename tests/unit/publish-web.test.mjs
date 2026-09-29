// Publishing the web build without a gap (ADR-0040, scripts/publish-web.mjs): order of the files,
// index.html last, files of older builds kept for open tabs, retention, and locked files on
// Windows (PocketBase holds a file open while it serves it).

import * as fs from 'node:fs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnClean } from '../support/clean-env.mjs';
import {
	ENTRY_FILE,
	HISTORY_FILE,
	KEEP_BUILDS,
	VERSION_FILE,
	listFiles,
	planPublish,
	publish,
	readHistory
} from '../../scripts/publish-web.mjs';

const dirs = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
});

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'byl-publish-test-'));
	dirs.push(dir);
	return dir;
}

/** A staging folder like web/build with a few files of build `name`. */
function stagedBuild(name, { extra = {}, shared = 'shared' } = {}) {
	const dir = tempDir();
	const files = {
		[ENTRY_FILE]: `<!doctype html><script type="module" src="/_app/immutable/entry/start.${name}.js"></script>`,
		[VERSION_FILE]: JSON.stringify({ version: `v-${name}` }),
		'service-worker.js': `// sw ${name}`,
		'offline.html': '<!doctype html><title>offline</title>',
		'icons/icon-192.png': 'png',
		[`_app/immutable/entry/start.${name}.js`]: `export const build = '${name}';`,
		[`_app/immutable/nodes/0.${name}.js`]: `export const node = '${name}';`,
		[`_app/immutable/chunks/${shared}.js`]: 'export const shared = true;',
		...extra
	};
	for (const [path, text] of Object.entries(files)) {
		fs.mkdirSync(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
		fs.writeFileSync(join(dir, ...path.split('/')), text);
	}
	return dir;
}

function read(dir, path) {
	return readFileSync(join(dir, ...path.split('/')), 'utf8');
}

function plan(input) {
	return planPublish({
		version: 'v2',
		previousVersion: 'v1',
		now: '2026-09-29T10:00:00.000Z',
		history: null,
		current: [],
		...input
	});
}

describe('planPublish', () => {
	const staged = [
		'_app/immutable/chunks/a.js',
		'_app/immutable/entry/start.b.js',
		VERSION_FILE,
		'icons/icon.png',
		ENTRY_FILE,
		'service-worker.js'
	];

	it('adds the new immutable files first and writes version.json and index.html last', () => {
		const result = plan({ staged });

		expect(result.copy).toEqual(['_app/immutable/chunks/a.js', '_app/immutable/entry/start.b.js']);
		expect(result.replace).toEqual(['icons/icon.png', 'service-worker.js', VERSION_FILE, ENTRY_FILE]);
	});

	it('keeps the files found on the first run as the build that was live until now', () => {
		const current = ['_app/immutable/chunks/old.js', '_app/immutable/chunks/a.js', ENTRY_FILE];
		const result = plan({ staged, current });

		expect(result.prune).toEqual([]);
		expect(result.history).toEqual([
			{
				version: 'v2',
				published: '2026-09-29T10:00:00.000Z',
				files: ['_app/immutable/chunks/a.js', '_app/immutable/entry/start.b.js']
			},
			{ version: 'v1', published: null, files: ['_app/immutable/chunks/old.js'] }
		]);
	});

	it('deletes the files of builds beyond the last ten, but never a file a kept build uses', () => {
		const history = Array.from({ length: KEEP_BUILDS }, (_, index) => ({
			version: `old-${index}`,
			published: '2026-09-28T10:00:00.000Z',
			files: [`_app/immutable/nodes/${index}.js`, '_app/immutable/chunks/a.js']
		}));
		const current = history.flatMap((build) => build.files).concat('_app/immutable/chunks/stray.js');
		const result = plan({ staged, current: [...new Set(current)], history });

		expect(result.history.map((build) => build.version)).toEqual([
			'v2',
			...history.slice(0, KEEP_BUILDS - 1).map((build) => build.version)
		]);
		// The oldest build and a file no build names go; the shared chunk stays.
		expect(result.prune).toEqual([`_app/immutable/nodes/${KEEP_BUILDS - 1}.js`, '_app/immutable/chunks/stray.js']);
	});

	it('removes files with a fixed name the new build no longer has, but not its own record', () => {
		const current = ['old-page.html', HISTORY_FILE, 'icons/icon.png', ENTRY_FILE];
		expect(plan({ staged, current }).remove).toEqual(['old-page.html']);
	});

	it('refuses a build without index.html or version.json', () => {
		expect(() => plan({ staged: ['_app/immutable/chunks/a.js', VERSION_FILE] })).toThrow(/index\.html/);
		expect(() => plan({ staged: [ENTRY_FILE] })).toThrow(/version\.json/);
	});
});

describe('readHistory', () => {
	it('accepts only the expected shape', () => {
		const dir = tempDir();
		const path = join(dir, 'builds.json');
		expect(readHistory(path)).toBeNull();
		fs.writeFileSync(path, '{ broken');
		expect(readHistory(path)).toBeNull();
		fs.writeFileSync(path, JSON.stringify({ builds: [{ version: 'v1', published: null, files: ['index.html'] }] }));
		expect(readHistory(path)).toBeNull();
		const builds = [{ version: 'v1', published: null, files: ['_app/immutable/chunks/a.js'] }];
		fs.writeFileSync(path, JSON.stringify({ builds }));
		expect(readHistory(path)).toEqual(builds);
	});
});

describe('publish', () => {
	it('switches to the new build and keeps the files of the previous one', async () => {
		const target = tempDir();
		await publish({ from: stagedBuild('a'), to: target });
		const now = new Date('2026-09-29T10:00:00.000Z');
		const stats = await publish({ from: stagedBuild('b'), to: target, now });

		// Last-Modified is the time of the publish (a module that appears later is never "304").
		expect(fs.statSync(join(target, '_app/immutable/entry/start.b.js')).mtime).toEqual(now);
		expect(fs.statSync(join(target, ENTRY_FILE)).mtime).toEqual(now);

		expect(stats).toMatchObject({ version: 'v-b', added: 2, replaced: 3, removed: 0, pruned: 0, retries: 0 });
		expect(read(target, ENTRY_FILE)).toContain('start.b.js');
		expect(read(target, VERSION_FILE)).toContain('v-b');
		expect(read(target, '_app/immutable/entry/start.a.js')).toContain("'a'");
		expect(read(target, '_app/immutable/entry/start.b.js')).toContain("'b'");
		expect(JSON.parse(read(target, HISTORY_FILE)).builds.map((build) => build.version)).toEqual(['v-b', 'v-a']);
		expect(listFiles(target).filter((path) => path.includes('.byl-publish-'))).toEqual([]);
	});

	it('deletes the files of a build once ten newer builds are published', async () => {
		const target = tempDir();
		await publish({ from: stagedBuild('first'), to: target });
		for (let index = 1; index < KEEP_BUILDS; index += 1) {
			await publish({ from: stagedBuild(`n${index}`), to: target });
		}
		expect(fs.existsSync(join(target, '_app/immutable/entry/start.first.js'))).toBe(true);

		const stats = await publish({ from: stagedBuild('last'), to: target });

		expect(stats.pruned).toBe(2);
		expect(fs.existsSync(join(target, '_app/immutable/entry/start.first.js'))).toBe(false);
		expect(fs.existsSync(join(target, '_app/immutable/entry/start.n1.js'))).toBe(true);
		expect(fs.existsSync(join(target, '_app/immutable/chunks/shared.js'))).toBe(true);
		expect(JSON.parse(read(target, HISTORY_FILE)).builds).toHaveLength(KEEP_BUILDS);
	});

	it('takes over a folder of the old adapter build and removes files the build no longer has', async () => {
		const target = stagedBuild('legacy', { extra: { 'old-page.html': 'old' } });
		const stats = await publish({ from: stagedBuild('b'), to: target });

		expect(stats.removed).toBe(1);
		expect(fs.existsSync(join(target, 'old-page.html'))).toBe(false);
		expect(fs.existsSync(join(target, '_app/immutable/entry/start.legacy.js'))).toBe(true);
		expect(JSON.parse(read(target, HISTORY_FILE)).builds[1]).toMatchObject({
			version: 'v-legacy',
			published: null
		});
	});

	it('removes leftovers of an aborted run and rewrites an immutable file that was cut short', async () => {
		const target = tempDir();
		const from = stagedBuild('a');
		fs.mkdirSync(join(target, '_app', 'immutable', 'entry'), { recursive: true });
		fs.writeFileSync(join(target, '_app', 'immutable', 'entry', 'start.a.js'), 'exp');
		fs.writeFileSync(join(target, '.byl-publish-1-1.tmp'), 'half');

		await publish({ from, to: target });

		expect(read(target, '_app/immutable/entry/start.a.js')).toBe(read(from, '_app/immutable/entry/start.a.js'));
		expect(fs.existsSync(join(target, '.byl-publish-1-1.tmp'))).toBe(false);
	});

	it('refuses an incomplete staging folder and leaves the target alone', async () => {
		const target = stagedBuild('a');
		const from = stagedBuild('b');
		fs.rmSync(join(from, ENTRY_FILE));

		await expect(publish({ from, to: target })).rejects.toThrow(/no complete web build/);
		expect(read(target, ENTRY_FILE)).toContain('start.a.js');
	});
});

describe('publish with locked files', () => {
	/** node:fs where renaming onto index.html fails with EPERM for the first `times` attempts. */
	function lockedIndex(times, { copyFails = false } = {}) {
		let left = times;
		return {
			...fs,
			renameSync(from, to) {
				if (to.endsWith(ENTRY_FILE) && left > 0) {
					left -= 1;
					throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
				}
				return fs.renameSync(from, to);
			},
			copyFileSync(from, to) {
				if (copyFails && to.endsWith(ENTRY_FILE)) {
					throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
				}
				return fs.copyFileSync(from, to);
			}
		};
	}

	it('tries again while PocketBase holds index.html open', async () => {
		const target = tempDir();
		await publish({ from: stagedBuild('a'), to: target });

		const stats = await publish({ from: stagedBuild('b'), to: target, fs: lockedIndex(3) });

		expect(stats.retries).toBe(3);
		expect(stats.fallbacks).toBe(0);
		expect(read(target, ENTRY_FILE)).toContain('start.b.js');
	});

	it('copies over index.html in place when it stays locked', async () => {
		const target = tempDir();
		await publish({ from: stagedBuild('a'), to: target });

		const stats = await publish({ from: stagedBuild('b'), to: target, fs: lockedIndex(Infinity) });

		expect(stats.fallbacks).toBe(1);
		expect(read(target, ENTRY_FILE)).toContain('start.b.js');
		expect(listFiles(target).filter((path) => path.includes('.byl-publish-'))).toEqual([]);
	}, 10_000);

	it('fails with a clear message and keeps the previous build complete', async () => {
		const target = tempDir();
		await publish({ from: stagedBuild('a'), to: target });

		await expect(
			publish({ from: stagedBuild('b'), to: target, fs: lockedIndex(Infinity, { copyFails: true }) })
		).rejects.toThrow(/locked by another program.*previous build in this folder is still complete/);
		expect(read(target, ENTRY_FILE)).toContain('start.a.js');
		expect(fs.existsSync(join(target, '_app/immutable/entry/start.a.js'))).toBe(true);
		expect(listFiles(target).filter((path) => path.includes('.byl-publish-'))).toEqual([]);
	}, 10_000);

	// A real lock like the one of pocketbase.exe while it serves the file: opened for reading with
	// shared read and write access but without FILE_SHARE_DELETE, so a rename over it fails.
	it.skipIf(process.platform !== 'win32')(
		'waits for a real Windows lock on index.html to end',
		async () => {
			const target = tempDir();
			await publish({ from: stagedBuild('a'), to: target });
			const index = join(target, ENTRY_FILE).replaceAll("'", "''");
			const holder = spawnClean(
				'powershell.exe',
				[
					'-NoProfile',
					'-NonInteractive',
					'-Command',
					`$f = [System.IO.File]::Open('${index}', 'Open', 'Read', 'ReadWrite'); ` +
						"[Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); Start-Sleep -Milliseconds 1200; $f.Close()"
				],
				{ windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] }
			);
			const exited = new Promise((resolve) => holder.once('exit', resolve));
			await new Promise((resolve, reject) => {
				holder.stdout.on('data', (chunk) => String(chunk).includes('locked') && resolve());
				holder.once('error', reject);
				holder.once('exit', () => reject(new Error('lock holder ended early')));
			});

			const stats = await publish({ from: stagedBuild('b'), to: target });
			await exited;

			expect(stats.retries).toBeGreaterThan(0);
			expect(stats.fallbacks).toBe(0);
			expect(read(target, ENTRY_FILE)).toContain('start.b.js');
		},
		20_000
	);
});
