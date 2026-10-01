// Time limits of the tests with processes (plan robuste-skripte RS-3, tests/support/timing.mjs): one
// place for them, scalable for a busy machine, and no file with processes that sets a fixed limit of
// its own; and the log of PocketBase is read only once it is written (tests/support/logs.mjs).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { integrationGroups } from '../support/test-groups.mjs';
import { LOG_WRITE_MS, PROCESS_HOOK_MS, PROCESS_TEST_MS, SERVER_READY_MS, TIME_SCALE, parseTimeScale, processWorkers, scaled } from '../support/timing.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(new URL(path, new URL('../../', import.meta.url)), 'utf8');

describe('time limits of the tests with processes (RS-3)', () => {
	it('takes the factor of the machine from 1 to 10, else 1', () => {
		expect([undefined, '', 'abc', '0', '0.5', '-2', '11', 'Infinity'].map(parseTimeScale)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
		expect(['1', '2.5', '3', '10'].map(parseTimeScale)).toEqual([1, 2.5, 3, 10]);
		expect(scaled(1000)).toBe(Math.round(1000 * TIME_SCALE));
	});

	it('leaves room for a full load beside the run and scales every limit', () => {
		// Measured (timing.mjs): up to 45 s for one start with four at a time and 16 busy threads beside.
		expect(SERVER_READY_MS).toBe(scaled(90_000));
		expect(PROCESS_TEST_MS).toBe(scaled(60_000));
		expect(PROCESS_HOOK_MS).toBe(scaled(180_000));
		expect(LOG_WRITE_MS).toBe(scaled(30_000));
		expect(PROCESS_HOOK_MS).toBeGreaterThan(SERVER_READY_MS);
	});

	it('runs at most four files with processes at a time, one fewer than the processors', () => {
		expect([1, 2, 3, 4, 5, 16, 64].map((processors) => processWorkers(processors))).toEqual([1, 1, 2, 3, 4, 4, 4]);
	});

	it('the harness waits for /api/health as long as the central limit allows', () => {
		const harness = read('tests/support/pocketbase-harness.mjs');
		expect(harness).toContain('const HEALTH_TIMEOUT_MS = SERVER_READY_MS;');
		expect(harness).not.toMatch(/HEALTH_TIMEOUT_MS = \d/);
	});

	it('no file with processes sets a fixed time limit of its own, only scaled() ones', () => {
		const offending = [];
		for (const file of integrationGroups(ROOT, 'tests/integration').processes) {
			const lines = read(file).split(/\r?\n/);
			lines.forEach((line, index) => {
				// A literal limit of a test or hook ("}, 60_000);" or "60_000" on a line of its own as the
				// last argument) or of a request or a child ("timeout: 60_000").
				if (/\}, \d[\d_]*\)|timeout: *\d|^\s*\d{1,3}_\d{3},?$/.test(line)) offending.push(`${file}:${index + 1}: ${line.trim()}`);
			});
		}
		expect(offending).toEqual([]);
	});

	it('reads the log of PocketBase for a check only once it is written, and all of it', () => {
		const offending = [];
		for (const dir of ['tests/integration']) {
			const groups = integrationGroups(ROOT, dir);
			for (const file of [...groups.shared, ...groups.processes]) {
				const source = read(file);
				// A plain request for the first page of /api/logs (oldest first) misses newer entries.
				if (/send\('\/api\/logs', \{ query: \{ perPage/.test(source)) offending.push(file);
			}
		}
		expect(offending).toEqual([]);
	});
});
