// Temp folders of the disposable PocketBase instances (ST-1). Every folder the harness makes is
// "byl-test-<PID>-XXXXXX" in the temp folder of the system: the process ID of the test process that
// made it, then the six characters of mkdtemp. The harness removes its folder when the instance
// stops, also on Ctrl+C, SIGTERM and process exit (pocketbase-harness.mjs). Only a hard end of the
// test process (taskkill /F, a closed terminal, a crash) leaves one behind; nothing can run in the
// process then. removeStaleTempFolders() removes such folders at the start of the next run
// (global-setup.mjs) and with "npm run test:clean" (scripts/clean-test-temp.mjs).
//
// A folder is never read or listed, only renamed and then removed. It goes only when its name is
// exactly one of the harness, its owner no longer runs, and it can be renamed: on Windows a process
// that still has a file open in it (a server left behind) prevents that, so it keeps its folder.
// Folders of older versions of the harness ("byl-test-XXXXXX", without owner) go only with
// "npm run test:clean", once they are an hour old and no process names them in its command line.

import { mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEMP_PREFIX = 'byl-test-';

const OWNED = /^byl-test-(\d{1,10})-[A-Za-z0-9]{6}$/;
const LEGACY = /^byl-test-[A-Za-z0-9]{6}$/;
/** Suffix of a folder renamed for removal; one left over (removal failed) goes in the next sweep. */
const STALE = '.stale';

/** Age from which a folder of an older harness counts as left over (the task of ST-1: 1 hour). */
export const LEGACY_MIN_AGE_MS = 60 * 60 * 1000;

/** A new, empty temp folder of this test process (`byl-test-<PID>-XXXXXX`). */
export function createTempFolder(parent = tmpdir()) {
	return mkdtemp(join(parent, `${TEMP_PREFIX}${process.pid}-`));
}

/**
 * The kind of a name in the temp folder: `{ kind: 'owned', owner }` for a folder of this harness,
 * `{ kind: 'legacy' }` for one of an older harness, `{ kind: 'stale' }` for one renamed for
 * removal, null for every other name.
 * @param {string} name
 */
export function classifyTempName(name) {
	const base = name.endsWith(STALE) ? name.slice(0, -STALE.length) : name;
	const owned = OWNED.exec(base);
	if (!owned && !LEGACY.test(base)) return null;
	if (base !== name) return { kind: 'stale' };
	return owned ? { kind: 'owned', owner: Number(owned[1]) } : { kind: 'legacy' };
}

/** Whether process `pid` runs (EPERM: it runs under another account). */
export function processRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
}

/** Renames `path` for removal and removes it; the reason when it stays, null when it is gone. */
async function removeFolder(path, renamed) {
	let target = path;
	if (!renamed) {
		target = `${path}${STALE}`;
		try {
			await rename(path, target);
		} catch (error) {
			return error.code === 'ENOENT' ? null : 'in use';
		}
	}
	try {
		await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		return null;
	} catch {
		return 'not removable';
	}
}

/**
 * Removes the left-over temp folders of the harness in `parent`. Never throws: a folder that cannot
 * be removed stays, with its reason in `kept`.
 * @param {{ parent?: string, now?: number, isRunning?: (pid: number) => boolean,
 *   legacyInUse?: ((path: string) => boolean) | null, legacyMinAgeMs?: number }} [options]
 *   `isRunning`: whether an owner runs (default processRunning). `legacyInUse`: whether a process
 *   works in a folder of an older harness; without it those folders are left alone (the start of a
 *   run does not ask the processes of the machine).
 * @returns {Promise<{ removed: string[], kept: { name: string, reason: string }[] }>}
 */
export async function removeStaleTempFolders(options = {}) {
	const {
		parent = tmpdir(),
		now = Date.now(),
		isRunning = processRunning,
		legacyInUse = null,
		legacyMinAgeMs = LEGACY_MIN_AGE_MS
	} = options;
	const removed = [];
	const kept = [];
	let entries;
	try {
		entries = await readdir(parent, { withFileTypes: true });
	} catch {
		return { removed, kept };
	}
	for (const entry of entries) {
		const kind = entry.isDirectory() ? classifyTempName(entry.name) : null;
		if (kind === null) continue;
		const path = join(parent, entry.name);
		let reason = null;
		if (kind.kind === 'owned' && isRunning(kind.owner)) {
			reason = 'owner running';
		} else if (kind.kind === 'legacy') {
			if (legacyInUse === null) continue;
			try {
				if (now - (await stat(path)).mtimeMs < legacyMinAgeMs) reason = 'younger than an hour';
				else if (legacyInUse(path)) reason = 'in use';
			} catch {
				continue;
			}
		}
		if (reason === null) reason = await removeFolder(path, kind.kind === 'stale');
		if (reason === null) removed.push(entry.name);
		else kept.push({ name: entry.name, reason });
	}
	return { removed, kept };
}
