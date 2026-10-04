// The fast build of the live folder: scripts\build.ps1 -SkipTests skips only the test runs (root,
// web, extension) and runs only on a clean working tree whose HEAD is a commit of origin/main, a
// state the CI tested (CLAUDE.md section 11.6). The static parts run everywhere; the functions of
// scripts/build-functions.ps1 and build.ps1 itself run in Windows PowerShell on git repositories of
// this test under the temp folder. Every case there refuses, so npm and Node never run.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSyncClean } from '../support/clean-env.mjs';
import { POWERSHELL_EXE, runPowerShellJson } from '../support/powershell.mjs';
import { scaled } from '../support/timing.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'scripts', 'build-functions.ps1');
const read = (path) => readFileSync(join(ROOT_DIR, path), 'utf8').replace(/^﻿/, '');

/** The entry `code` of the catalog app/byl-problems.ps1, as text. */
function catalogEntry(code) {
	const match = new RegExp(`^ {4}'${code}'\\s*=\\s*@\\{\\r?\\n([\\s\\S]*?)\\r?\\n {4}\\}`, 'm').exec(read('app/byl-problems.ps1'));
	if (match === null) throw new Error(`entry ${code} not found`);
	return match[1];
}

describe('build.ps1 -SkipTests (static)', () => {
	const build = read('scripts/build.ps1');

	it('declares the switch first and checks the state before Node, npm ci and every step', () => {
		expect(build).toMatch(/^param\(\r?\n(\t#[^\n]*\n)+\t\[switch\]\$SkipTests\r?\n\)\r?\n/);
		const check = build.indexOf('$refused = Get-BylSkipTestsProblem -Root $rootDir');
		expect(check).toBeGreaterThan(-1);
		expect(build).toMatch(/if \(\$null -ne \$refused\) \{\s+exit \(Write-BylBuildProblem -Code \$refused\.Code -Values \$refused\.Values -Facts \$refused\.Facts\)\s+\}/);
		for (const later of ['Assert-BylNode', 'Update-BylDependency', 'npm run check']) {
			expect(check, later).toBeLessThan(build.indexOf(later));
		}
	});

	it('skips only the tests: check, lint, build, publishing and the helpers run either way', () => {
		// $SkipTests appears in the declaration and in the two decisions, nowhere else.
		expect(build.match(/\$SkipTests\b/g)).toHaveLength(3);
		const skip = build.lastIndexOf('if ($SkipTests) {');
		for (const step of ["-Name 'npm run check'", "-Name 'npm run lint'", "-Name 'npm run build'", "-Name 'build-mail-helper.ps1'", "-Name 'build-backup-helper.ps1'"]) {
			expect(build.indexOf(step), step).toBeGreaterThan(build.indexOf('Write-Host "Skipping the tests'));
			expect(build.indexOf(step), step).toBeLessThan(skip);
		}
		const decision = build.slice(skip, build.indexOf('Write-Host "Build complete!"'));
		expect(decision).toMatch(
			/^if \(\$SkipTests\) \{\s+\[void\]\(Write-BylBuildProblem -Code 'build-tests-skipped'\)\s+\}\s+else \{\s+Write-Host "Running tests\.\.\."\s+Invoke-BylBuildStep -Name 'npm test' -Rerun \(\$npm -f \$rootDir, 'test'\) -Run \{ npm test \}\s+\}\s+$/
		);
		expect(build.match(/Invoke-BylBuildStep -Name 'npm test'/g)).toHaveLength(1);
		// "npm run build" publishes into app\pb_public without a gap (ADR-0040) in both builds.
		expect(JSON.parse(read('package.json')).scripts.build).toContain('node scripts/publish-web.mjs');
	});

	it('says clearly that the tests were skipped, as a hint of the catalog', () => {
		const entry = catalogEntry('build-tests-skipped');
		expect(entry).toMatch(/^ {8}Exit {4}= 0\r?$/m);
		expect(entry).toMatch(/^ {8}Level {3}= 'warning'\r?$/m);
		expect(entry).toContain("Problem = 'Tests übersprungen – nur für Stände verwenden, die in der CI grün sind.'");
		for (const code of ['build-skip-tests-git', 'build-skip-tests-dirty', 'build-skip-tests-off-main']) {
			const refusal = catalogEntry(code);
			expect(refusal, code).toMatch(/^ {8}Exit {4}= 1\r?$/m);
			// The way out is always the build with the tests.
			expect(refusal, code).toMatch(/^ {8}Command = '\{build\}'\r?$/m);
		}
	});
});

describe.skipIf(process.platform !== 'win32')('build.ps1 -SkipTests in Windows PowerShell', { timeout: scaled(60_000) }, () => {
	let base;
	// Git of the tests without the configuration of the system and the account (hooks, signing,
	// line endings); no repository above the temp folder of this test counts.
	let gitEnv;

	function git(dir, ...args) {
		const result = spawnSyncClean('git', ['-c', 'user.name=Anna Beispiel', '-c', 'user.email=anna@example.com', ...args], {
			cwd: dir,
			encoding: 'utf8',
			windowsHide: true,
			timeout: scaled(30_000),
			env: gitEnv
		});
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed (exit code ${result.status}):\n${result.stderr}`);
		return result.stdout.trim();
	}

	/** A repository `name` with the files `files` (path -> content) in one commit; origin/main on it unless `origin` is false. */
	function repository(name, files = { 'datei.txt': 'eins\n' }, origin = true) {
		const dir = join(base, name);
		mkdirSync(dir);
		git(dir, 'init', '-q');
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(join(dir, path, '..'), { recursive: true });
			writeFileSync(join(dir, path), content);
		}
		git(dir, 'add', '-A');
		git(dir, 'commit', '-q', '--no-verify', '-m', 'erster Stand');
		if (origin) git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
		return dir;
	}

	function commit(dir, file, content) {
		writeFileSync(join(dir, file), content);
		git(dir, 'add', '-A');
		git(dir, 'commit', '-q', '--no-verify', '-m', `${file} geändert`);
		return git(dir, 'rev-parse', '--short', 'HEAD');
	}

	beforeAll(() => {
		// The long form of the path: git compares the ceiling with the real path.
		base = realpathSync.native(mkdtempSync(join(tmpdir(), 'byl-skip-tests-')));
		writeFileSync(join(base, 'gitconfig'), '');
		gitEnv = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(base, 'gitconfig'), GIT_CEILING_DIRECTORIES: base };
	});
	afterAll(() => {
		if (base) rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});

	it('refuses after a git error, then for changes, then off origin/main, and names at most ten files', () => {
		const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
# Windows PowerShell passes the array of ConvertFrom-Json on as one object; foreach takes it apart.
$cases = $env:BYL_TEST_INPUT | ConvertFrom-Json
$results = foreach ($case in $cases) {
    $problem = Resolve-BylSkipTestsProblem -GitError $case.gitError -Changes @($case.changes) -Head $case.head -OnMain $case.onMain
    if ($null -eq $problem) { [ordered]@{ code = 'ok' } } else { [ordered]@{ code = $problem.Code; values = $problem.Values; facts = @($problem.Facts) } }
}
ConvertTo-Json -InputObject @($results) -Depth 4 -Compress
`;
		const many = Array.from({ length: 12 }, (_, index) => ` M datei-${index}.txt`);
		const cases = [
			{ gitError: '', changes: [], head: 'abc1234', onMain: true },
			{ gitError: '', changes: ['', '  '], head: 'abc1234', onMain: true },
			{ gitError: 'git nicht im PATH', changes: [' M a.txt'], head: '', onMain: false },
			{ gitError: '', changes: [' M a.txt', '?? neu.txt'], head: 'abc1234', onMain: false },
			{ gitError: '', changes: many, head: 'abc1234', onMain: true },
			{ gitError: '', changes: [], head: 'abc1234', onMain: false }
		];
		const results = runPowerShellJson(SCRIPT, cases, { BYL_FUNCTIONS: FUNCTIONS_FILE });
		expect(results).toEqual([
			{ code: 'ok' },
			{ code: 'ok' },
			{ code: 'build-skip-tests-git', values: { detail: 'git nicht im PATH' }, facts: [] },
			{ code: 'build-skip-tests-dirty', values: {}, facts: ['git status: M a.txt', 'git status: ?? neu.txt'] },
			{
				code: 'build-skip-tests-dirty',
				values: {},
				facts: [...many.slice(0, 10).map((line) => `git status: ${line.trim()}`), 'git status: ... (2 weitere)']
			},
			{ code: 'build-skip-tests-off-main', values: { head: 'abc1234' }, facts: [] }
		]);
	});

	it('asks git: a clean HEAD on origin/main or older passes; changes, a newer commit, no origin/main or no repository refuse', () => {
		const clean = repository('sauber');
		const older = repository('aelter');
		const first = git(older, 'rev-parse', 'HEAD');
		commit(older, 'datei.txt', 'zwei\n');
		git(older, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
		git(older, 'checkout', '-q', '--detach', first);
		const dirty = repository('geaendert');
		writeFileSync(join(dirty, 'datei.txt'), 'geändert\n');
		writeFileSync(join(dirty, 'neu.txt'), 'neu\n');
		const ahead = repository('voraus');
		const head = commit(ahead, 'datei.txt', 'lokal\n');
		const noOrigin = repository('ohne-origin', undefined, false);
		const noRepository = join(base, 'kein-repo');
		mkdirSync(noRepository);

		const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$folders = $env:BYL_TEST_INPUT | ConvertFrom-Json
$results = foreach ($folder in $folders) {
    $problem = Get-BylSkipTestsProblem -Root $folder
    if ($null -eq $problem) { [ordered]@{ code = 'ok' } } else { [ordered]@{ code = $problem.Code; values = $problem.Values; facts = @($problem.Facts) } }
}
ConvertTo-Json -InputObject @($results) -Depth 4 -Compress
`;
		const results = runPowerShellJson(SCRIPT, [clean, older, dirty, ahead, noOrigin, noRepository], { BYL_FUNCTIONS: FUNCTIONS_FILE, ...gitEnv });
		expect(results.slice(0, 4)).toEqual([
			{ code: 'ok' },
			{ code: 'ok' },
			{ code: 'build-skip-tests-dirty', values: {}, facts: ['git status: M datei.txt', 'git status: ?? neu.txt'] },
			{ code: 'build-skip-tests-off-main', values: { head }, facts: [] }
		]);
		expect(results[4]).toEqual({ code: 'build-skip-tests-git', values: { detail: 'origin/main ist in diesem Klon unbekannt' }, facts: [] });
		expect(results[5].code).toBe('build-skip-tests-git');
		expect(results[5].values.detail).toMatch(/^kein Git-Arbeitsbaum, git status: Exit-Code \d+$/);
	});

	it('build.ps1 -SkipTests ends with the entry of the catalog before Node or npm run', () => {
		const files = Object.fromEntries(
			['scripts/build.ps1', 'scripts/build-functions.ps1', 'app/byl-problems.ps1'].map((path) => [path, readFileSync(join(ROOT_DIR, path))])
		);
		const copy = repository('kopie', files);
		const run = () => {
			const result = spawnSyncClean(
				POWERSHELL_EXE,
				['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(copy, 'scripts', 'build.ps1'), '-SkipTests'],
				{ cwd: copy, encoding: 'latin1', windowsHide: true, timeout: scaled(60_000), env: gitEnv }
			);
			if (result.error) throw result.error;
			// Texts wrap at 100 columns; commands and facts never do.
			const output = `${result.stdout}${result.stderr}`;
			return { code: result.status, output, text: output.replace(/\s+/g, ' ') };
		};

		writeFileSync(join(copy, 'neu.txt'), 'nicht committet\n');
		const dirty = run();
		expect(dirty.code, dirty.output).toBe(1);
		// An umlaut is one or two characters, depending on the code page of the console.
		expect(dirty.text).toMatch(/Problem: build\.ps1 -SkipTests l.{1,2}uft nur auf einem sauberen Arbeitsbaum;/);
		expect(dirty.output).toContain('git status: ?? neu.txt');
		expect(dirty.output).toContain(`powershell -NoProfile -ExecutionPolicy Bypass -File "${join(copy, 'scripts', 'build.ps1')}"`);

		const head = commit(copy, 'neu.txt', 'committet, aber nicht auf origin/main\n');
		const ahead = run();
		expect(ahead.code, ahead.output).toBe(1);
		expect(ahead.text).toMatch(/Problem: build\.ps1 -SkipTests l.{1,2}uft nur auf einem Stand von origin\/main;/);
		expect(ahead.text).toContain(`HEAD (${head}) liegt nicht darauf.`);

		for (const output of [dirty.output, ahead.output]) {
			expect(output).not.toMatch(/Using Node\.js|Dependencies of|Running /);
		}
	});
});
