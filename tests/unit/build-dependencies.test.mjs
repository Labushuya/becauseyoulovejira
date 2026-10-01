// Dependencies of the build (ADR-0040, addendum "Build und Abhaengigkeiten"; plan robuste-skripte
// RS-2): scripts\build.ps1 runs "npm ci" wherever node_modules does not match the package-lock.json
// of its folder, and only esbuild may run an install script (allowScripts of npm 11). The functions
// of scripts/build-functions.ps1 run in Windows PowerShell on folders of this test under the temp
// folder; npm never runs here.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'scripts', 'build-functions.ps1');
const read = (path) => readFileSync(join(ROOT_DIR, path), 'utf8');

/** Folders of the repository with a package-lock.json, relative with forward slashes ('.' = root). */
function lockfileFolders(dir = ROOT_DIR) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory() && !['node_modules', '.git', '.tmp', '.svelte-kit'].includes(entry.name)) {
			found.push(...lockfileFolders(join(dir, entry.name)));
		} else if (entry.name === 'package-lock.json') {
			found.push(relative(ROOT_DIR, dir).replaceAll('\\', '/') || '.');
		}
	}
	return found;
}

/** Body of a PowerShell function, up to the next top-level function. */
function functionBody(source, name) {
	const start = source.indexOf(`function ${name} {`);
	if (start < 0) throw new Error(`function ${name} not found`);
	const next = source.indexOf('\nfunction ', start + 1);
	return source.slice(start, next < 0 ? undefined : next);
}

describe('npm ci after a changed lockfile (scripts/build-functions.ps1)', () => {
	it('names exactly the folders with a package-lock.json', () => {
		const listed = read('scripts/build-functions.ps1').match(/\$BylDependencyFolders = @\(([^)]*)\)/)[1];
		const folders = [...listed.matchAll(/'([^']+)'/g)].map((match) => match[1]);
		expect([...folders].sort()).toEqual(lockfileFolders().sort());
	});

	it('build.ps1 brings every folder up to date before the check, the helper builds their own', () => {
		const build = read('scripts/build.ps1');
		expect(build).toContain(". (Join-Path $PSScriptRoot 'build-functions.ps1')");
		expect(build).toMatch(/foreach \(\$folder in \$BylDependencyFolders\) \{\s+try \{\s+\[void\]\(Update-BylDependency -Root \$rootDir -Folder \$folder\)/);
		expect(build.indexOf('Update-BylDependency')).toBeLessThan(build.indexOf('npm run check'));
		expect(build).not.toMatch(/Test-Path '[^']*node_modules'/);
		for (const [script, folder] of [
			['scripts/build-mail-helper.ps1', 'helpers/mail'],
			['scripts/build-backup-helper.ps1', 'helpers/backup']
		]) {
			const source = read(script);
			expect(source).toContain(`Update-BylDependency -Root $rootDir -Folder '${folder}'`);
			expect(source).not.toMatch(/Test-Path 'node_modules'/);
			expect(source.indexOf('Update-BylDependency')).toBeLessThan(source.indexOf('node build.mjs'));
		}
	});

	it('writes the marker only after npm ci succeeded', () => {
		const body = functionBody(read('scripts/build-functions.ps1'), 'Update-BylDependency');
		const install = body.indexOf('& npm --prefix $path ci');
		const check = body.indexOf('if ($LASTEXITCODE -ne 0) { throw');
		const marker = body.indexOf('Set-BylDependencyMarker');
		expect(install).toBeGreaterThan(0);
		expect(check).toBeGreaterThan(install);
		expect(marker).toBeGreaterThan(check);
	});

	describe.skipIf(process.platform !== 'win32')('in Windows PowerShell', () => {
		const base = mkdtempSync(join(tmpdir(), 'byl-deps-'));
		afterAll(() => rmSync(base, { recursive: true, force: true }));

		const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$folder = ($env:BYL_TEST_INPUT | ConvertFrom-Json).folder
$steps = New-Object System.Collections.Generic.List[object]
$note = { param($Name) $state = Get-BylDependencyState -Folder $folder; $steps.Add([ordered]@{ name = $Name; state = $state.State; hash = $state.Hash; reason = Get-BylDependencyReason -State $state.State }) }
& $note 'no lockfile'
[System.IO.File]::WriteAllText((Join-Path $folder 'package-lock.json'), '{"lockfileVersion":3}')
& $note 'no node_modules'
[void](New-Item -ItemType Directory -Path (Join-Path $folder 'node_modules'))
& $note 'no marker'
Set-BylDependencyMarker -Folder $folder -Hash (Get-BylDependencyState -Folder $folder).Hash
& $note 'installed'
[System.IO.File]::WriteAllText((Join-Path $folder 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}')
& $note 'lockfile changed'
ConvertTo-Json -InputObject @($steps.ToArray()) -Compress
`;

		it('tells missing, unknown, current and changed apart by the SHA-256 of the lockfile', () => {
			const folder = join(base, 'web');
			mkdirSync(folder);
			const steps = runPowerShellJson(SCRIPT, { folder }, { BYL_FUNCTIONS: FUNCTIONS_FILE });
			const sha = (text) => createHash('sha256').update(text).digest('hex');
			const first = sha('{"lockfileVersion":3}');
			expect(steps).toEqual([
				{ name: 'no lockfile', state: 'NoLockfile', hash: null, reason: null },
				{ name: 'no node_modules', state: 'Missing', hash: first, reason: 'node_modules is missing' },
				{ name: 'no marker', state: 'Unknown', hash: first, reason: 'installed without a lockfile marker (older build or by hand)' },
				{ name: 'installed', state: 'Current', hash: first, reason: null },
				{
					name: 'lockfile changed',
					state: 'Changed',
					hash: sha('{"lockfileVersion":3,"packages":{}}'),
					reason: 'package-lock.json changed since the last install'
				}
			]);
			expect(readFileSync(join(folder, 'node_modules', '.byl-lockfile.sha256'), 'utf8')).toBe(first);
		});
	});
});

describe('install scripts of dependencies (npm 11 allowScripts)', () => {
	// esbuild is the only dependency with an install script (npm approve-scripts
	// --allow-scripts-pending, 2026-10-01). Its code runs in every build anyway, so the approval goes
	// by name, not by version: a version pin would lose it with every update of esbuild.
	it('allows the postinstall of esbuild by name wherever esbuild is a dependency, and nothing else', () => {
		for (const folder of lockfileFolders()) {
			const pkg = JSON.parse(read(join(folder, 'package.json')));
			const uses = { ...pkg.dependencies, ...pkg.devDependencies }.esbuild !== undefined;
			expect(pkg.allowScripts, folder).toEqual(uses ? { esbuild: true } : undefined);
		}
	});
});
