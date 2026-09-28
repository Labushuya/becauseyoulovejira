// Consistency of the CI workflow and the ruleset for main (CLAUDE.md §12, manifest BYL-X-005):
// every required check is a job of .github/workflows/ci.yml, every required job is skipped only
// for documentation-only pull requests (a skipped required job counts as passed), and the
// ruleset keeps pull requests, squash merges, no force pushes and no deletion. The live ruleset
// is put on the state of main.json with the GitHub API; this test guards the file.

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

	it('counts only Markdown and docs/ as documentation, except the test manifest', () => {
		expect(workflow).toContain('docs/test-manifest.html) code=true ;;');
		expect(workflow).toContain('docs/* | *.md) ;;');
		expect(workflow).toContain('*) code=true ;;');
		expect(workflow.indexOf('docs/test-manifest.html) code=true')).toBeLessThan(
			workflow.indexOf('docs/* | *.md)')
		);
	});

	it('runs on pull requests to main and cancels a superseded run', () => {
		expect(workflow).toMatch(/\non:\n {2}pull_request:\n {4}branches: \[main\]\n/);
		expect(workflow).toMatch(/\nconcurrency:\n {2}group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n {2}cancel-in-progress: true\n/);
	});
});
