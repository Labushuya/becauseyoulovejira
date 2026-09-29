// Publishes the web build without a gap (ADR-0040): SvelteKit builds into web/build (staging) and
// this script moves the build into app/pb_public while PocketBase serves that folder. Order:
//   1. new files under _app/immutable (content-hashed names, nothing refers to them yet),
//   2. the other files with fixed names (icons, manifest, offline page, service worker),
//   3. _app/version.json, 4. index.html as the very last file.
// Every file is written as a copy next to its target and then renamed over it, so a request sees
// the old or the new file, never a missing or half written one. Files of older builds under
// _app/immutable stay for tabs that still run them; _app/builds.json records which files belong to
// the last KEEP_BUILDS builds, older ones are deleted after the switch.
//
// Call: node scripts/publish-web.mjs   (part of "npm run build" in the root)

import * as nodeFs from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

/** Builds whose files stay in app/pb_public: the new one and the nine before it. */
export const KEEP_BUILDS = 10;
export const ENTRY_FILE = 'index.html';
export const VERSION_FILE = '_app/version.json';
export const HISTORY_FILE = '_app/builds.json';
const IMMUTABLE_PREFIX = '_app/immutable/';
const TEMP_PREFIX = '.byl-publish-';
/** Error codes of Windows when another process holds the file open. */
const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** Waits between attempts to replace a locked file (about 3 s in total). */
export const RETRY_DELAYS_MS = Object.freeze([25, 50, 100, 200, 400, 800, 1600]);

/**
 * @typedef {{ version: string, published: string | null, files: string[] }} Build
 *   `published` is null for the files found before the first run of this script.
 */

/** Whether a path (relative, with "/") lies below _app/immutable. */
export function isImmutable(path) {
	return path.startsWith(IMMUTABLE_PREFIX);
}

/**
 * What a publish does, without touching a file.
 * @param {{ staged: string[], current: string[], history: Build[] | null, version: string,
 *   previousVersion: string | null, now: string, keep?: number }} input
 *   `staged` and `current` are the files of web/build and app/pb_public; `history` is the content
 *   of _app/builds.json (null if it is missing or unreadable), newest build first.
 * @returns {{ copy: string[], replace: string[], remove: string[], prune: string[],
 *   history: Build[] }}
 *   `copy`: immutable files to add; `replace`: files with a fixed name in the order they are
 *   written (index.html last); `remove`: files with a fixed name the new build no longer has;
 *   `prune`: immutable files no kept build refers to; `history`: the new _app/builds.json.
 */
export function planPublish({ staged, current, history, version, previousVersion, now, keep = KEEP_BUILDS }) {
	if (!staged.includes(ENTRY_FILE) || !staged.includes(VERSION_FILE)) {
		throw new Error(`The build has no ${ENTRY_FILE} or ${VERSION_FILE}.`);
	}
	const stagedSet = new Set(staged);
	const newBuild = { version, published: now, files: staged.filter(isImmutable) };
	let previous = history ?? [];
	if (history === null) {
		// First run (or unreadable record): the files already there are the build that was live.
		const found = current.filter((path) => isImmutable(path) && !stagedSet.has(path));
		previous = found.length > 0 ? [{ version: previousVersion ?? 'unknown', published: null, files: found }] : [];
	}
	const builds = [newBuild, ...previous.filter((build) => build.version !== version)].slice(0, keep);
	const kept = new Set(builds.flatMap((build) => build.files));
	const fixed = staged.filter((path) => !isImmutable(path) && path !== VERSION_FILE && path !== ENTRY_FILE);
	return {
		copy: newBuild.files,
		replace: [...fixed, VERSION_FILE, ENTRY_FILE],
		remove: current.filter((path) => !isImmutable(path) && !stagedSet.has(path) && path !== HISTORY_FILE),
		prune: current.filter((path) => isImmutable(path) && !kept.has(path)),
		history: builds
	};
}

/** Relative paths (with "/") of all files below `dir`, without leftovers of an aborted run. */
export function listFiles(dir, fs = nodeFs) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && !entry.name.startsWith(TEMP_PREFIX))
		.map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
		.sort();
}

function readJson(path, fs) {
	try {
		return JSON.parse(fs.readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

/** The version in a _app/version.json, or null. */
export function readVersion(path, fs = nodeFs) {
	const data = readJson(path, fs);
	return typeof data?.version === 'string' && data.version !== '' ? data.version : null;
}

/** The builds in _app/builds.json, or null if the file is missing or not in the expected shape. */
export function readHistory(path, fs = nodeFs) {
	const builds = readJson(path, fs)?.builds;
	if (!Array.isArray(builds)) return null;
	const valid = builds.every(
		(build) =>
			typeof build?.version === 'string' &&
			(build.published === null || typeof build.published === 'string') &&
			Array.isArray(build.files) &&
			build.files.every((file) => typeof file === 'string' && isImmutable(file))
	);
	return valid ? builds : null;
}

let tempCounter = 0;

function tempPathFor(target) {
	tempCounter += 1;
	return join(dirname(target), `${TEMP_PREFIX}${process.pid}-${tempCounter}.tmp`);
}

function removeQuietly(path, fs) {
	try {
		fs.unlinkSync(path);
	} catch {
		// Already gone, or locked: listFiles skips it and the next publish removes it.
	}
}

/**
 * Renames `temp` over `target`. While another process holds the target open (Windows), it tries
 * again for about 3 s; then it copies over the file in place, which works as long as the reader
 * allows writing (PocketBase does). A reader in that very moment may get a mix of old and new
 * bytes, which is why this is only the last way out.
 */
async function replaceFile(temp, target, fs, stats) {
	try {
		for (let attempt = 0; ; attempt += 1) {
			try {
				fs.renameSync(temp, target);
				return;
			} catch (error) {
				if (!LOCK_CODES.has(error.code)) throw error;
				if (attempt >= RETRY_DELAYS_MS.length) break;
				stats.retries += 1;
				await delay(RETRY_DELAYS_MS[attempt]);
			}
		}
		try {
			fs.copyFileSync(temp, target);
			stats.fallbacks += 1;
		} catch (error) {
			throw new Error(
				`${target} is locked by another program and could not be replaced (${error.code}). ` +
					'The previous build in this folder is still complete; run the build again.',
				{ cause: error }
			);
		}
	} finally {
		removeQuietly(temp, fs);
	}
}

async function copyInto(source, target, fs, stats, now) {
	fs.mkdirSync(dirname(target), { recursive: true });
	const temp = tempPathFor(target);
	fs.copyFileSync(source, temp);
	// Last-Modified is the time of the publish, not of the build (Windows keeps it when copying):
	// a browser that once got index.html as the answer for a missing module and asks again with
	// If-Modified-Since must then get the module and not "304 Not Modified".
	fs.utimesSync(temp, now, now);
	await replaceFile(temp, target, fs, stats);
}

async function writeInto(target, text, fs, stats) {
	fs.mkdirSync(dirname(target), { recursive: true });
	const temp = tempPathFor(target);
	fs.writeFileSync(temp, text);
	await replaceFile(temp, target, fs, stats);
}

function sameContent(a, b, fs) {
	if (!fs.existsSync(b) || fs.statSync(a).size !== fs.statSync(b).size) return false;
	return fs.readFileSync(a).equals(fs.readFileSync(b));
}

/** Deletes a file of an old build; a locked one stays for the next publish. */
function deleteOld(path, fs, stats) {
	try {
		fs.unlinkSync(path);
		return true;
	} catch (error) {
		if (error.code !== 'ENOENT') stats.locked.push(path);
		return false;
	}
}

/**
 * Publishes the build in `from` into `to` (see the head of this file).
 * @param {{ from: string, to: string, keep?: number, now?: Date, fs?: typeof nodeFs }} options
 *   `fs` exists for tests that simulate locked files.
 */
export async function publish({ from, to, keep = KEEP_BUILDS, now = new Date(), fs = nodeFs }) {
	const staged = listFiles(from, fs);
	const version = readVersion(join(from, VERSION_FILE), fs);
	if (!staged.includes(ENTRY_FILE) || version === null) {
		throw new Error(
			`${from} holds no complete web build (${ENTRY_FILE} and ${VERSION_FILE}); run "npm --prefix web run build" first.`
		);
	}
	fs.mkdirSync(to, { recursive: true });
	for (const entry of fs.readdirSync(to, { recursive: true, withFileTypes: true })) {
		if (entry.isFile() && entry.name.startsWith(TEMP_PREFIX)) {
			removeQuietly(join(entry.parentPath, entry.name), fs);
		}
	}
	const plan = planPublish({
		staged,
		current: listFiles(to, fs),
		history: readHistory(join(to, HISTORY_FILE), fs),
		version,
		previousVersion: readVersion(join(to, VERSION_FILE), fs),
		now: now.toISOString(),
		keep
	});
	const stats = { version, added: 0, replaced: 0, removed: 0, pruned: 0, retries: 0, fallbacks: 0, locked: [] };
	for (const path of plan.copy) {
		const target = join(to, path);
		// Same name means same content; only a file cut short by an aborted run is written again.
		if (fs.existsSync(target) && fs.statSync(target).size === fs.statSync(join(from, path)).size) continue;
		await copyInto(join(from, path), target, fs, stats, now);
		stats.added += 1;
	}
	for (const path of plan.replace) {
		if (sameContent(join(from, path), join(to, path), fs)) continue;
		await copyInto(join(from, path), join(to, path), fs, stats, now);
		stats.replaced += 1;
	}
	for (const path of plan.remove) {
		if (deleteOld(join(to, path), fs, stats)) stats.removed += 1;
	}
	await writeInto(join(to, HISTORY_FILE), `${JSON.stringify({ builds: plan.history }, null, '\t')}\n`, fs, stats);
	for (const path of plan.prune) {
		if (deleteOld(join(to, path), fs, stats)) stats.pruned += 1;
	}
	return stats;
}

async function main() {
	const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
	const stats = await publish({ from: join(rootDir, 'web', 'build'), to: join(rootDir, 'app', 'pb_public') });
	console.log(
		`Published web build ${stats.version} to app/pb_public: ${stats.added} new, ${stats.replaced} replaced, ` +
			`${stats.removed} removed, ${stats.pruned} files of older builds deleted (the last ${KEEP_BUILDS} builds stay).`
	);
	if (stats.retries > 0 || stats.fallbacks > 0) {
		console.log(`Locked files: ${stats.retries} retries, ${stats.fallbacks} copied in place.`);
	}
	if (stats.locked.length > 0) {
		console.log(`${stats.locked.length} old files were locked and stay until the next build.`);
	}
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error.message);
		process.exit(1);
	});
}
