// Removes the temp folders the PocketBase harness of the tests left behind (ST-1,
// tests/support/temp-folders.mjs), also those of older versions of the harness ("byl-test-XXXXXX"
// without owner). A folder of the current harness goes when its test process no longer runs; one
// of an older harness when it is at least an hour old and no running process names it in its
// command line. On Windows a folder a process still works in cannot be renamed either and stays.
// Contents are never read or listed. The start of every integration run removes the folders of
// the current harness by itself; this script is for the older ones and for cleaning by hand.
//
// Call: npm run test:clean   (node scripts/clean-test-temp.mjs)

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSyncClean } from '../tests/support/clean-env.mjs';
import { removeStaleTempFolders } from '../tests/support/temp-folders.mjs';

/** Command line and program path of every running process, in lower case. */
function processLines() {
	if (process.platform === 'win32') {
		const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
		const script = "Get-CimInstance -ClassName Win32_Process | ForEach-Object { [string]$_.ExecutablePath + ' ' + [string]$_.CommandLine }";
		const result = spawnSyncClean(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
			encoding: 'utf8',
			windowsHide: true,
			maxBuffer: 64 * 1024 * 1024
		});
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`Listing the processes failed (exit code ${result.status}):\n${result.stderr}`);
		return result.stdout.toLowerCase().split(/\r?\n/);
	}
	const lines = [];
	for (const pid of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
		try {
			lines.push(readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').toLowerCase());
		} catch {
			// The process ended meanwhile, or belongs to another account.
		}
	}
	return lines;
}

const lines = processLines();
// The name of a folder is unique (six random characters); a process that works in it names it,
// whatever spelling of the temp folder (short or long) its command line uses.
const inUse = (path) => lines.some((line) => line.includes(basename(path).toLowerCase()));
const { removed, kept } = await removeStaleTempFolders({ legacyInUse: inUse });
console.log(`Removed ${removed.length} left-over temp folder(s) of the tests.`);
for (const { name, reason } of kept) console.log(`  kept ${name} (${reason})`);
