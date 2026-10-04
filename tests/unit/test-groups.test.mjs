// Groups of the integration tests (plan test-haertung T-4, tests/support/test-groups.mjs): the
// files on the shared instance only run first and alone, then the unit and helper tests, and last
// every file that starts processes of its own, a few at a time (plan robuste-skripte RS-3). Guards
// the split and the configuration.

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config.mjs';
import { integrationGroups, startsProcesses } from '../support/test-groups.mjs';
import { PROCESS_HOOK_MS, PROCESS_TEST_MS, SHARED_HOOK_MS, SHARED_TEST_MS, processWorkers } from '../support/timing.mjs';

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
		// Since ST-1 on an own instance: the heaviest file of the shared one ran past its limits under load.
		for (const name of ['control-script', 'system-control', 'migrations-rollback', 'mail-helper-process', 'installer-check', 'host-route', 'web-filter-parity']) {
			expect(groups.processes).toContain(`tests/integration/${name}.test.mjs`);
		}
	});

	it('runs the shared instance first and alone, everything else afterwards', () => {
		expect(projects.integration.include).toEqual(groups.shared);
		expect(projects['integration-processes'].include).toEqual(groups.processes);
		expect(projects.integration.sequence.groupOrder).toBe(0);
		for (const name of ['unit', 'helper']) {
			expect(projects[name].sequence.groupOrder).toBe(1);
		}
		// Last and a few at a time (plan robuste-skripte RS-3): the files that start processes.
		expect(projects['integration-processes'].sequence.groupOrder).toBe(2);
		expect(projects['integration-processes'].maxWorkers).toBe(processWorkers());
		// Both integration projects get the shared instance.
		for (const name of ['integration', 'integration-processes']) {
			expect(projects[name].globalSetup).toEqual(['tests/support/global-setup.mjs']);
		}
		// The shared instance keeps its 15 s (T-4), scalable since ST-1; the files with processes get the
		// central limits.
		expect(projects.integration).toMatchObject({ testTimeout: SHARED_TEST_MS, hookTimeout: SHARED_HOOK_MS });
		expect(projects['integration-processes']).toMatchObject({ testTimeout: PROCESS_TEST_MS, hookTimeout: PROCESS_HOOK_MS });
	});
});
