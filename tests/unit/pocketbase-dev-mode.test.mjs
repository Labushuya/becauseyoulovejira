// Where PocketBase 0.40.4 switches to its dev mode (ST-1, tests/support/pocketbase-dev-mode.mjs):
// the rule of IsProbablyGoRun (tools/osutils/run.go) with the temp and cache folders of Go. The
// harness refuses such a location with an explanation instead of the misleading "installer link".

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { devModeFolder, devModeMessage } from '../support/pocketbase-dev-mode.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const same = (path) => path;
const windows = (env, program, real = same) => devModeFolder(program, env, { platform: 'win32', real });
const linux = (env, program) => devModeFolder(program, env, { platform: 'linux', real: same });

describe('dev mode of PocketBase by the location of its program (ST-1)', () => {
	const ACCOUNT = {
		TMP: 'C:\\Users\\anna\\AppData\\Local\\Temp',
		TEMP: 'C:\\Users\\anna\\AppData\\Local\\Temp',
		LOCALAPPDATA: 'C:\\Users\\anna\\AppData\\Local',
		USERPROFILE: 'C:\\Users\\anna'
	};

	it('finds a checkout in the temp folder or below %LOCALAPPDATA% on Windows, and nothing elsewhere', () => {
		expect(windows(ACCOUNT, 'C:\\Users\\anna\\AppData\\Local\\Temp\\byl-main\\app\\pocketbase.exe')).toEqual({ folder: ACCOUNT.TMP, source: 'TMP' });
		expect(windows(ACCOUNT, 'C:\\Users\\anna\\AppData\\Local\\Programme\\byl\\app\\pocketbase.exe')).toEqual({ folder: ACCOUNT.LOCALAPPDATA, source: 'LOCALAPPDATA' });
		expect(windows(ACCOUNT, 'H:\\DEV\\github\\byl-worktree-stabil\\app\\pocketbase.exe')).toBeNull();
		// The profile counts only when neither TMP nor TEMP is set (GetTempPath).
		expect(windows(ACCOUNT, 'C:\\Users\\anna\\code\\byl\\app\\pocketbase.exe')).toBeNull();
		expect(windows({ USERPROFILE: 'C:\\Users\\anna' }, 'C:\\Users\\anna\\code\\byl\\app\\pocketbase.exe')).toEqual({ folder: 'C:\\Users\\anna', source: 'USERPROFILE' });
	});

	it('takes TMP before TEMP like Go, and GOCACHE instead of %LOCALAPPDATA% unless it is "off"', () => {
		expect(windows({ TMP: 'D:\\t', TEMP: 'E:\\t' }, 'E:\\t\\byl\\app\\pocketbase.exe')).toBeNull();
		expect(windows({ TMP: 'D:\\t', TEMP: 'E:\\t' }, 'D:\\t\\byl\\app\\pocketbase.exe')).toEqual({ folder: 'D:\\t', source: 'TMP' });
		const cache = { TMP: 'D:\\t', GOCACHE: 'H:\\DEV', LOCALAPPDATA: 'C:\\L' };
		expect(windows(cache, 'H:\\DEV\\byl\\app\\pocketbase.exe')).toEqual({ folder: 'H:\\DEV', source: 'GOCACHE' });
		expect(windows(cache, 'C:\\L\\byl\\app\\pocketbase.exe')).toBeNull();
		expect(windows({ ...cache, GOCACHE: 'off' }, 'C:\\L\\byl\\app\\pocketbase.exe')).toBeNull();
		expect(windows({ ...cache, GOCACHE: 'off' }, 'H:\\DEV\\byl\\app\\pocketbase.exe')).toBeNull();
	});

	it('compares the plain start of the text like Go, and also the long, real form regardless of case', () => {
		expect(windows({ TMP: 'C:\\Temp' }, 'C:\\Temp2\\byl\\app\\pocketbase.exe')).toEqual({ folder: 'C:\\Temp', source: 'TMP' });
		const short = { TMP: 'C:\\Users\\CHRIST~1\\AppData\\Local\\Temp' };
		const real = (path) => path.replace('CHRIST~1', 'Christopher');
		expect(windows(short, 'C:\\Users\\christopher\\AppData\\Local\\Temp\\byl\\app\\pocketbase.exe', real)).toEqual({ folder: short.TMP, source: 'TMP' });
		expect(windows(short, 'C:\\Users\\christopher\\AppData\\Local\\Temp\\byl\\app\\pocketbase.exe')).toBeNull();
	});

	it('knows TMPDIR, /tmp, XDG_CACHE_HOME and $HOME/.cache on Linux and $HOME/Library/Caches on macOS', () => {
		const home = { HOME: '/home/anna' };
		expect(linux(home, '/tmp/byl/app/pocketbase')).toEqual({ folder: '/tmp', source: '/tmp' });
		expect(linux({ ...home, TMPDIR: '/var/tmp' }, '/tmp/byl/app/pocketbase')).toBeNull();
		expect(linux(home, '/home/anna/.cache/byl/app/pocketbase')).toEqual({ folder: '/home/anna/.cache', source: '$HOME/.cache' });
		expect(linux({ ...home, XDG_CACHE_HOME: '/srv/cache' }, '/srv/cache/byl/app/pocketbase')).toEqual({ folder: '/srv/cache', source: 'XDG_CACHE_HOME' });
		expect(linux({ ...home, XDG_CACHE_HOME: 'cache' }, '/home/anna/.cache/byl/app/pocketbase')).toBeNull();
		expect(linux({ HOME: '/home/runner' }, '/home/runner/work/becauseyoulovejira/app/pocketbase')).toBeNull();
		expect(devModeFolder('/Users/anna/Library/Caches/byl/pocketbase', { HOME: '/Users/anna' }, { platform: 'darwin', real: same })).toEqual({
			folder: '/Users/anna/Library/Caches',
			source: '$HOME/Library/Caches'
		});
	});

	it('says what happens and how to run the tests instead', () => {
		const text = devModeMessage('C:\\x\\app\\pocketbase.exe', { folder: 'C:\\x', source: 'TMP' });
		expect(text).toContain('C:\\x\\app\\pocketbase.exe lies below C:\\x (TMP).');
		expect(text).toContain('"go run"');
		expect(text).toContain('dev mode');
		expect(text).toContain('Run the tests from a checkout outside the temp folder');
	});

	it('accepts the checkout of this run', () => {
		expect(devModeFolder(join(ROOT_DIR, 'app', 'pocketbase.exe'))).toBeNull();
	});
});
