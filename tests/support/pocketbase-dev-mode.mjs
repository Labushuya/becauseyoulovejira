// Where PocketBase 0.40.4 switches to its dev mode (ST-1). It takes its program for one started with
// "go run" when os.Args[0] starts with the temp folder or the cache folder of Go
// (tools/osutils/run.go, IsProbablyGoRun):
// - the temp folder: os.TempDir(), on Windows the first of TMP, TEMP, USERPROFILE and the Windows
//   folder, elsewhere TMPDIR or /tmp;
// - the cache folder: GOCACHE, unless it is "off"; without it os.UserCacheDir(), on Windows
//   %LocalAppData% (so every folder below C:\Users\<name>\AppData\Local, %TEMP% included), on macOS
//   $HOME/Library/Caches, elsewhere XDG_CACHE_HOME (none if it is relative) or $HOME/.cache.
// The dev mode prints every SQL statement, among them the check for the installer account at every
// start, and serves files without caching. A checkout there (e.g. `git archive` unpacked into
// %TEMP%) made the harness stop with "installer link (no superuser?)", although every instance had
// its superuser. The harness refuses such a location with this explanation instead.

import { realpathSync } from 'node:fs';
import { posix } from 'node:path';

/** The temp folder of Go (os.TempDir) for `env` on `platform`, with the variable it comes from. */
function goTempFolder(env, platform) {
	if (platform !== 'win32') return { folder: env.TMPDIR || '/tmp', source: env.TMPDIR ? 'TMPDIR' : '/tmp' };
	for (const name of ['TMP', 'TEMP', 'USERPROFILE', 'SystemRoot']) {
		if (env[name]) return { folder: env[name], source: name };
	}
	return null;
}

/** The cache folder of Go for PocketBase (GOCACHE, else os.UserCacheDir), or null. */
function goCacheFolder(env, platform) {
	if (env.GOCACHE === 'off') return null;
	if (env.GOCACHE) return { folder: env.GOCACHE, source: 'GOCACHE' };
	if (platform === 'win32') return env.LOCALAPPDATA ? { folder: env.LOCALAPPDATA, source: 'LOCALAPPDATA' } : null;
	if (platform === 'darwin') return env.HOME ? { folder: `${env.HOME}/Library/Caches`, source: '$HOME/Library/Caches' } : null;
	if (env.XDG_CACHE_HOME) {
		return posix.isAbsolute(env.XDG_CACHE_HOME) ? { folder: env.XDG_CACHE_HOME, source: 'XDG_CACHE_HOME' } : null;
	}
	return env.HOME ? { folder: `${env.HOME}/.cache`, source: '$HOME/.cache' } : null;
}

/** The long, real form of `path` (8.3 names and links resolved), itself if it does not exist. */
function realPath(path) {
	try {
		return realpathSync.native(path);
	} catch {
		return path;
	}
}

/**
 * The folder because of which PocketBase would run `program` in its dev mode, or null. Matches
 * like PocketBase (the plain start of the text) and also after resolving both paths, case
 * insensitive on Windows, so a short or linked spelling of the same folder counts as well.
 * @param {string} program full path of pocketbase.exe as the tests start it
 * @param {Record<string, string | undefined>} [env] environment of the server
 * @param {{ platform?: string, real?: (path: string) => string }} [options]
 * @returns {{ folder: string, source: string } | null}
 */
export function devModeFolder(program, env = process.env, options = {}) {
	const { platform = process.platform, real = realPath } = options;
	const fold = (path) => (platform === 'win32' ? path.toLowerCase() : path);
	for (const candidate of [goTempFolder(env, platform), goCacheFolder(env, platform)]) {
		if (candidate === null || candidate.folder === '') continue;
		if (program.startsWith(candidate.folder)) return candidate;
		if (fold(real(program)).startsWith(fold(real(candidate.folder)))) return candidate;
	}
	return null;
}

/** The message for a program in such a folder. */
export function devModeMessage(program, { folder, source }) {
	return (
		`${program} lies below ${folder} (${source}). PocketBase 0.40.4 takes a program there for one ` +
		'started with "go run" and switches to its dev mode: it prints every SQL statement (also the ' +
		'check for its installer account, which looks like a missing superuser) and serves files ' +
		'without caching, so the tests would not see the app as it runs. Run the tests from a checkout ' +
		'outside the temp folder and %LOCALAPPDATA% (Windows) or ~/.cache (Linux), e.g. a worktree next ' +
		'to the repository, and with GOCACHE unset or pointing elsewhere.'
	);
}
