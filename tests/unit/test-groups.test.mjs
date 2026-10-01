// Groups of the integration tests (plan test-haertung T-4, tests/support/test-groups.mjs): the
// files on the shared instance only run first and alone, every file that starts processes of its
// own runs afterwards with the unit and helper tests. Guards the split and the configuration.

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config.mjs';
import { integrationGroups, startsProcesses } from '../support/test-groups.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const groups = integrationGroups(ROOT, 'tests/integration');
const projects = Object.fromEntries(config.test.projects.map((project) => [project.test.name, project.test]));

describe('groups of the integration tests (T-4)', () => {
	it('knows a test file by the modules it imports', () => {
		expect(startsProcesses("import { superuserClient } from '../support/api.mjs';")).toBe(false);
		expect(startsProcesses("import { startPocketBase } from '../support/pocketbase-harness.mjs';")).toBe(true);
		expect(startsProcesses("import { runPowerShellJson } from '../support/powershell.mjs';")).toBe(true);
		expect(startsProcesses('import { spawnClean } from "../support/clean-env.mjs";')).toBe(true);
		// A mention in a comment or a string is no import.
		expect(startsProcesses('// like pocketbase-harness.mjs, but without a server')).toBe(false);
	});

	it('puts every integration file into exactly one group', () => {
		const all = [...groups.shared, ...groups.processes];
		expect(new Set(all).size).toBe(all.length);
		expect(groups.shared).toContain('tests/integration/inbox-link.test.mjs');
		expect(groups.shared).toContain('tests/integration/web-filter-parity.test.mjs');
		for (const name of ['control-script', 'system-control', 'migrations-rollback', 'mail-helper-process', 'installer-check', 'host-route']) {
			expect(groups.processes).toContain(`tests/integration/${name}.test.mjs`);
		}
	});

	it('runs the shared instance first and alone, everything else afterwards', () => {
		expect(projects.integration.include).toEqual(groups.shared);
		expect(projects['integration-processes'].include).toEqual(groups.processes);
		expect(projects.integration.sequence.groupOrder).toBe(0);
		for (const name of ['unit', 'helper', 'integration-processes']) {
			expect(projects[name].sequence.groupOrder).toBe(1);
		}
		// Both integration projects get the shared instance and the same limits.
		for (const name of ['integration', 'integration-processes']) {
			expect(projects[name].globalSetup).toEqual(['tests/support/global-setup.mjs']);
			expect(projects[name].testTimeout).toBe(15_000);
		}
	});
});
