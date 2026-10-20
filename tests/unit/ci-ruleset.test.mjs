// Consistency of the CI workflow and the ruleset for main (CLAUDE.md §12, manifest BYL-X-005):
// every required check is a job of .github/workflows/ci.yml, every required job is skipped only
// for documentation-only pull requests (a skipped required job counts as passed), and the
// ruleset keeps pull requests, squash merges, no force pushes and no deletion. The live ruleset
// is put on the state of main.json with the GitHub API; this test guards the file. Since DOC-2 it
// also applies the classification of "Detect code changes" to sample paths: documentation that a
// test or the lint reads counts as code.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const ruleset = JSON.parse(readFileSync(new URL('.github/rulesets/main.json', ROOT), 'utf8'));
const workflow = readFileSync(new URL('.github/workflows/ci.yml', ROOT), 'utf8').replaceAll('\r\n', '\n');

/** GitHub Actions as the source of a required check. */
const GITHUB_ACTIONS_APP = 15368;
/** Condition of a job that runs unless the pull request changes documentation only. */
const RUNS_FOR_CODE = "${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.code == 'true') }}";

/** Jobs of the workflow with their top-level keys (name, needs, if) as plain text. */
function jobs() {
	const section = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length);
	const result = new Map();
	let current = null;
	for (const line of section.split('\n')) {
		const job = /^ {2}([A-Za-z0-9_-]+):$/.exec(line);
		if (job) {
			current = { id: job[1] };
			result.set(job[1], current);
			continue;
		}
		const key = /^ {4}(name|needs|if|runs-on): (.+)$/.exec(line);
		if (current && key) current[key[1]] = key[2].trim();
	}
	return [...result.values()];
}

function rule(type) {
	return ruleset.rules.find((entry) => entry.type === type);
}

/** One job of a workflow as text, from its key to the next job; empty if there is none. */
function jobText(text, id) {
	const start = text.indexOf(`\n  ${id}:\n`);
	if (start === -1) return '';
	const next = text.slice(start + 1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
	return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

/**
 * What is wrong with the place of the smoke test of the phone frame in a workflow (MO-1a,
 * ADR-0073); empty if nothing. It is the step "Mobile smoke test" with `npm run test:mobile` of the
 * Linux job after its build (it needs app/pb_public), in no other job, and nothing downloads
 * browsers.
 */
function smokeTestFindings(text) {
	const findings = [];
	const linux = jobText(text, 'linux');
	const build = linux.indexOf('run: npm run build');
	if (!/- name: Mobile smoke test\n {8}run: npm run test:mobile\n/.test(linux)) {
		findings.push('no step "Mobile smoke test" with npm run test:mobile in the Linux job');
	} else if (build === -1 || linux.indexOf('run: npm run test:mobile') < build) {
		findings.push('the smoke test does not come after the build of the Linux job');
	}
	for (const id of ['build', 'changes']) {
		if (/test:mobile|playwright/i.test(jobText(text, id))) findings.push(`the job ${id} runs the smoke test`);
	}
	if (/playwright install/.test(text)) findings.push('the workflow downloads browsers');
	return findings;
}

function requiredChecks() {
	return rule('required_status_checks').parameters.required_status_checks;
}

describe('CI workflow and ruleset for main', () => {
	it('protects the default branch without exceptions', () => {
		expect(ruleset.name).toBe('main');
		expect(ruleset.target).toBe('branch');
		expect(ruleset.enforcement).toBe('active');
		expect(ruleset.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH']);
		expect(ruleset.bypass_actors).toEqual([]);
		expect(ruleset.rules.map((entry) => entry.type).sort()).toEqual([
			'deletion',
			'non_fast_forward',
			'pull_request',
			'required_status_checks'
		]);
	});

	it('allows pull requests with squash merges only and requires no review', () => {
		const { parameters } = rule('pull_request');
		expect(parameters.allowed_merge_methods).toEqual(['squash']);
		expect(parameters.required_approving_review_count).toBe(0);
		expect(parameters.required_reviewers).toEqual([]);
	});

	it('requires the Windows and the Linux job (AR-3)', () => {
		expect(requiredChecks().map((check) => check.context)).toEqual([
			'Check, lint, build and test',
			'Linux build and test'
		]);
		const byName = new Map(jobs().map((job) => [job.name, job]));
		expect(byName.get('Check, lint, build and test')?.['runs-on']).toBe('windows-latest');
		expect(byName.get('Linux build and test')?.['runs-on']).toBe('ubuntu-latest');
	});

	it('requires only checks that are jobs of the CI workflow from GitHub Actions', () => {
		const names = jobs().map((job) => job.name);
		const checks = requiredChecks();
		expect(checks.length).toBeGreaterThan(0);
		for (const check of checks) {
			expect(names, check.context).toContain(check.context);
			expect(check.integration_id, check.context).toBe(GITHUB_ACTIONS_APP);
		}
	});

	it('skips every required job only for documentation-only pull requests', () => {
		const byName = new Map(jobs().map((job) => [job.name, job]));
		for (const { context } of requiredChecks()) {
			const job = byName.get(context);
			expect(job?.needs, context).toBe('changes');
			expect(job?.if, context).toBe(RUNS_FOR_CODE);
		}
	});

	// MO-1a (ADR-0073): the smoke test of the phone frame in the browser is a step of the Linux job,
	// after the build it needs (app/pb_public) and the Chrome of the runner image; never on Windows,
	// not in npm test and not in scripts\build.ps1, to spare the memory of the PC.
	it('runs the smoke test of the phone frame only in the Linux job, after the build', () => {
		expect(jobText(workflow, 'linux')).toContain('name: Linux build and test');
		expect(jobText(workflow, 'build')).toContain('name: Check, lint, build and test');
		expect(jobText(workflow, 'changes')).toContain('name: Detect code changes');
		expect(smokeTestFindings(workflow)).toEqual([]);
		const scripts = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')).scripts;
		expect(scripts['test:mobile']).toBe('playwright test');
		expect(scripts.test).not.toMatch(/test:mobile|playwright/);
		expect(readFileSync(new URL('scripts/build.ps1', ROOT), 'utf8')).not.toMatch(/test:mobile|playwright/i);
	});

	// Counter-check: each wrong place of the smoke test, made from the real workflow, is found.
	it('finds the smoke test missing, before the build, in another job or with a browser download', () => {
		const step = '      - name: Mobile smoke test\n        run: npm run test:mobile\n';
		expect(workflow).toContain(step);
		const windowsStep = '      - name: Check, lint, build and test\n';
		expect(workflow).toContain(windowsStep);
		const linuxBuild = '      - name: Build\n        run: npm run build\n';
		expect(workflow).toContain(linuxBuild);
		const cases = [
			[workflow.replace(step, ''), 'no step "Mobile smoke test" with npm run test:mobile in the Linux job'],
			[workflow.replace(step, step.replace('test:mobile', 'test')), 'no step "Mobile smoke test" with npm run test:mobile in the Linux job'],
			[workflow.replace(step, '').replace(linuxBuild, step + linuxBuild), 'the smoke test does not come after the build of the Linux job'],
			[workflow.replace(windowsStep, step + windowsStep), 'the job build runs the smoke test'],
			[`${workflow}      - run: npx playwright install chromium\n`, 'the workflow downloads browsers']
		];
		for (const [changed, finding] of cases) {
			expect(changed).not.toBe(workflow);
			expect(smokeTestFindings(changed), finding).toContain(finding);
		}
	});

	it('runs on pull requests to main and cancels a superseded run', () => {
		expect(workflow).toMatch(/\non:\n {2}pull_request:\n {4}branches: \[main\]\n/);
		expect(workflow).toMatch(/\nconcurrency:\n {2}group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n {2}cancel-in-progress: true\n/);
	});
});

// Classification of the job "Detect code changes" (CLAUDE.md §12, DOC-2): the case statement of
// ci.yml applied to sample paths. A pattern of a bash case statement is a glob whose * and ? also
// match "/"; the classification uses only *, ? and bracket expressions of letters, so a small
// translation into a regular expression evaluates it exactly. Any other syntax fails the test
// instead of being guessed.

/** Arms of `case "$file" in … esac`: patterns and whether the arm counts the path as code. */
function classificationArms() {
	const block = /\n( +)case "\$file" in\n([\s\S]*?)\n\1esac\n/.exec(workflow);
	if (!block) throw new Error('ci.yml: no case "$file" in … esac in "Classify changed files"');
	return block[2].split('\n').map((line) => {
		const arm = /^\s*([^)]+)\)( code=true)? ;;$/.exec(line);
		if (!arm) throw new Error(`ci.yml: arm of the classification not understood: ${line.trim()}`);
		return { patterns: arm[1].split(' | ').map(globToRegExp), code: arm[2] !== undefined };
	});
}

/** A glob of a bash case statement as a regular expression of the whole path. */
function globToRegExp(glob) {
	let source = '';
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === '*') source += '.*';
		else if (char === '?') source += '.';
		else if (char === '[') {
			const end = glob.indexOf(']', index);
			const letters = glob.slice(index + 1, end);
			if (end === -1 || !/^[A-Za-z0-9]+$/.test(letters)) throw new Error(`ci.yml: bracket expression not supported in ${glob}`);
			source += `[${letters}]`;
			index = end;
		} else if (/[A-Za-z0-9_/:-]/.test(char)) source += char;
		else if (char === '.') source += '\\.';
		else throw new Error(`ci.yml: character "${char}" not supported in pattern ${glob}`);
	}
	return new RegExp(`^${source}$`);
}

/** True if the classification counts the line of the file list as code (first matching arm). */
function countsAsCode(path) {
	const arm = classificationArms().find(({ patterns }) => patterns.some((pattern) => pattern.test(path)));
	if (!arm) throw new Error(`ci.yml: no arm matches ${path}`);
	return arm.code;
}

/**
 * Files that tests or the lint read although they are documentation (audit of DOC-2), with the
 * check that reads them; a change to any of them must run the build jobs. "removed:" marks a path
 * the pull request deletes or renames.
 */
const READ_BY_CHECKS = [
	['CLAUDE.md', 'claude-md-structure.test.mjs, platform-scripts.test.mjs'],
	['docs/regeln/README.md', 'claude-md-structure.test.mjs'],
	['docs/regeln/tickets.md', 'claude-md-structure.test.mjs'],
	['docs/regeln/neues-thema.md', 'claude-md-structure.test.mjs: index and head of every detail document'],
	['docs/plan/CLAUDE.md', 'claude-md-structure.test.mjs: no CLAUDE.md below docs/'],
	['docs/claude.md', 'claude-md-structure.test.mjs: no CLAUDE.md below docs/, in any case'],
	['docs/adr/Claude.MD', 'claude-md-structure.test.mjs: no CLAUDE.md below docs/, in any case'],
	['docs/test-manifest.html', 'test-manifest.test.mjs'],
	['web/src/lib/test/markdown-corpus/mail.md', 'web/src/lib/markdown.test.ts, web/src/lib/editor/markdown-bridge.test.ts'],
	['web/README.md', 'Prettier in npm run lint'],
	['extensions/whatsapp-web/README.md', 'Prettier in npm run lint'],
	['removed:docs/adr/0040-veroeffentlichen-ohne-unterbrechung.md', 'claude-md-structure.test.mjs, test-manifest.test.mjs: linked ADRs exist'],
	['removed:docs/plan/e1.md', 'claude-md-structure.test.mjs, test-manifest.test.mjs: linked plans exist'],
	['removed:docs/security/bewertungen/GHSA-pxg6-pf52-xh8x.md', 'claude-md-structure.test.mjs: the linked folder exists']
];

/** Documentation no check reads: a pull request that changes only these skips the build jobs. */
const DOCUMENTATION = [
	'README.md',
	'.github/pull_request_template.md',
	'.github/SECURITY.md',
	'docs/adr/0040-veroeffentlichen-ohne-unterbrechung.md',
	'docs/adr/README.md',
	'docs/plan/e1.md',
	'docs/plan/claude-md.md',
	'docs/security/bewertungen/GHSA-pxg6-pf52-xh8x.md',
	'docs/spikes/e0-pocketbase.md',
	'docs/assets/banner.svg',
	'helpers/mail/NOTIZEN.md'
];

describe('classification of changed files (Detect code changes)', () => {
	it.each(READ_BY_CHECKS)('counts %s as code (read by %s)', (path) => {
		expect(countsAsCode(path)).toBe(true);
	});

	it.each(DOCUMENTATION)('counts %s as documentation', (path) => {
		expect(countsAsCode(path)).toBe(false);
	});

	it('counts every other path as code, the last arm catching all', () => {
		for (const path of ['app/pb_hooks/tickets.pb.js', 'package.json', '.github/workflows/ci.yml', 'scripts/build.ps1']) {
			expect(countsAsCode(path), path).toBe(true);
		}
		const arms = classificationArms();
		expect(arms.at(-1)).toEqual({ patterns: [/^.*$/], code: true });
	});

	it('marks deleted files and the old name of renamed ones with "removed:"', () => {
		expect(workflow).toContain(
			`--jq '.[] | (if .status == "removed" then "removed:" else "" end) + .filename, (.previous_filename // empty | "removed:" + .)'`
		);
		expect(workflow).toContain('if [ -z "$files" ]; then code=true; fi');
	});
});
