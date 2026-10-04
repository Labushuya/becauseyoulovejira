// Temp folders of the harness (ST-1, tests/support/temp-folders.mjs): every folder carries the
// process ID of its test process, and a later run removes the folders of test processes that no
// longer run. Everything here happens with empty folders in a temp folder of this test process
// (itself one of the harness); nothing else in the temp folder of the system is touched.

import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSyncClean } from '../support/clean-env.mjs';
import {
	LEGACY_MIN_AGE_MS,
	classifyTempName,
	createTempFolder,
	processRunning,
	removeStaleTempFolders
} from '../support/temp-folders.mjs';

let parent;

beforeEach(async () => {
	parent = await createTempFolder();
});

afterEach(() => {
	rmSync(parent, { recursive: true, force: true });
});

/** An empty folder `name` in the parent, `ageMs` old. */
function folder(name, ageMs = 0) {
	const path = join(parent, name);
	mkdirSync(join(path, 'pb_data'), { recursive: true });
	const seconds = (Date.now() - ageMs) / 1000;
	utimesSync(path, seconds, seconds);
	return path;
}

const sorted = (list) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('names of the temp folders of the harness (ST-1)', () => {
	it('names a folder after the test process that makes it', async () => {
		const path = await createTempFolder(parent);
		expect(basename(path)).toMatch(new RegExp(`^byl-test-${process.pid}-[A-Za-z0-9]{6}$`));
		expect(classifyTempName(basename(path))).toEqual({ kind: 'owned', owner: process.pid });
	});

	it('knows only the exact names of the harness, old and new', () => {
		expect(classifyTempName('byl-test-4711-Ab12Cd')).toEqual({ kind: 'owned', owner: 4711 });
		expect(classifyTempName('byl-test-Ab12Cd')).toEqual({ kind: 'legacy' });
		expect(classifyTempName('byl-test-123456')).toEqual({ kind: 'legacy' });
		expect(classifyTempName('byl-test-4711-Ab12Cd.stale')).toEqual({ kind: 'stale' });
		expect(classifyTempName('byl-test-Ab12Cd.stale')).toEqual({ kind: 'stale' });
		const others = [
			'byl-test-public-Ab12Cd',
			'byl-test-backup-Ab12Cd',
			'byl-ordner-test-Ab12Cd',
			'byl-pruefung-Ab12Cd',
			'byl-test-Ab12C',
			'byl-test-Ab12Cde',
			'byl-test-Ab_2Cd',
			'byl-test-4711-Ab12Cd-x',
			'byl-test-4711-Ab12Cd.stale.stale',
			'xbyl-test-Ab12Cd',
			'BYL-TEST-Ab12Cd'
		];
		for (const name of others) expect(classifyTempName(name), name).toBeNull();
	});

	it('tells a running process from one that ended', () => {
		expect(processRunning(process.pid)).toBe(true);
		const ended = spawnSyncClean(process.execPath, ['-e', ''], { windowsHide: true });
		expect(processRunning(ended.pid)).toBe(false);
	});
});

describe('removal of left-over temp folders (ST-1)', () => {
	it('removes the folders of test processes that no longer run and keeps those of running ones', async () => {
		folder('byl-test-111-Aaaaaa');
		folder('byl-test-222-Bbbbbb');
		folder('byl-test-111-Cccccc.stale');
		const result = await removeStaleTempFolders({ parent, isRunning: (pid) => pid === 222 });
		expect(result.removed.sort()).toEqual(['byl-test-111-Aaaaaa', 'byl-test-111-Cccccc.stale']);
		expect(result.kept).toEqual([{ name: 'byl-test-222-Bbbbbb', reason: 'owner running' }]);
		expect(existsSync(join(parent, 'byl-test-111-Aaaaaa'))).toBe(false);
		expect(existsSync(join(parent, 'byl-test-111-Aaaaaa.stale'))).toBe(false);
		expect(existsSync(join(parent, 'byl-test-111-Cccccc.stale'))).toBe(false);
		expect(existsSync(join(parent, 'byl-test-222-Bbbbbb', 'pb_data'))).toBe(true);
	});

	it('leaves folders of an older harness alone, unless asked, and then removes only old ones no process uses', async () => {
		folder('byl-test-Old111', 2 * LEGACY_MIN_AGE_MS);
		folder('byl-test-Used11', 2 * LEGACY_MIN_AGE_MS);
		folder('byl-test-Young1', 0);
		expect(await removeStaleTempFolders({ parent, isRunning: () => false })).toEqual({ removed: [], kept: [] });
		const asked = [];
		const result = await removeStaleTempFolders({
			parent,
			isRunning: () => false,
			legacyInUse: (path) => {
				asked.push(basename(path));
				return basename(path) === 'byl-test-Used11';
			}
		});
		expect(result.removed).toEqual(['byl-test-Old111']);
		expect(sorted(result.kept)).toEqual([
			{ name: 'byl-test-Used11', reason: 'in use' },
			{ name: 'byl-test-Young1', reason: 'younger than an hour' }
		]);
		// A young folder is never looked at further.
		expect(asked.sort()).toEqual(['byl-test-Old111', 'byl-test-Used11']);
		expect(existsSync(join(parent, 'byl-test-Used11', 'pb_data'))).toBe(true);
		expect(existsSync(join(parent, 'byl-test-Young1', 'pb_data'))).toBe(true);
	});

	it('never touches other names, files with such a name or the folders of this test process', async () => {
		folder('byl-test-public-Abcdef', 2 * LEGACY_MIN_AGE_MS);
		folder('byl-ordner-test-Abcdef', 2 * LEGACY_MIN_AGE_MS);
		writeFileSync(join(parent, 'byl-test-333-Dddddd'), 'a file, no folder');
		const own = await createTempFolder(parent);
		const result = await removeStaleTempFolders({ parent, legacyInUse: () => false });
		expect(result).toEqual({ removed: [], kept: [{ name: basename(own), reason: 'owner running' }] });
		for (const name of ['byl-test-public-Abcdef', 'byl-ordner-test-Abcdef', 'byl-test-333-Dddddd', basename(own)]) {
			expect(existsSync(join(parent, name)), name).toBe(true);
		}
	});

	it('never throws, also without the parent folder', async () => {
		expect(await removeStaleTempFolders({ parent: join(parent, 'fehlt') })).toEqual({ removed: [], kept: [] });
	});
});
