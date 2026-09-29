// Publishing a web build while PocketBase serves the folder (ADR-0040, scripts/publish-web.mjs).
// Before, adapter-static emptied app/pb_public and wrote it anew: for 2 to 3 s every page load got
// the JSON 404 of PocketBase, and open tabs could no longer load the modules of their version. Here
// a request loop in a worker thread (the publish itself blocks this thread) runs against a
// disposable instance while several builds are published one after the other: every answer is a
// complete index.html whose modules load, and the modules of the first build stay for tabs that
// still run it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publish } from '../../scripts/publish-web.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';

const MODULES_PER_BUILD = 40;
const staging = [];
let instance;
let publicDir;

beforeAll(async () => {
	instance = await startPocketBase();
	// The harness serves <temp>/pb_public next to the data folder.
	publicDir = join(dirname(instance.dataDir), 'pb_public');
});

afterAll(async () => {
	for (const dir of staging) rmSync(dir, { recursive: true, force: true });
	await instance?.stop();
});

/** A staging folder like web/build: index.html refers to the entry module of build `name`. */
function build(name) {
	const dir = mkdtempSync(join(tmpdir(), 'byl-publish-it-'));
	staging.push(dir);
	const write = (path, text) => {
		mkdirSync(join(dir, dirname(path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	};
	write('index.html', `<!doctype html><title>${name}</title><script type="module" src="/_app/immutable/entry/start.${name}.js"></script>`);
	write('_app/version.json', JSON.stringify({ version: name }));
	write('service-worker.js', `// ${name}`);
	write(`_app/immutable/entry/start.${name}.js`, `export const build = '${name}';`);
	for (let index = 0; index < MODULES_PER_BUILD; index += 1) {
		write(`_app/immutable/nodes/${index}.${name}.js`, `export const node = '${name}';${' '.repeat(20_000)}`);
	}
	return dir;
}

// The load of the worker: like a browser a page and then its entry module, and like an open tab of
// build b0 a module of its own version. It stops when the main thread sets the shared flag.
const LOAD = `
const { parentPort, workerData } = require('node:worker_threads');
const { url, stop } = workerData;
const flag = new Int32Array(stop);

async function loadPage() {
	const page = await fetch(url + '/tickets/abc');
	const html = await page.text();
	const name = /start\\.(b\\d+)\\.js/.exec(html)?.[1];
	if (page.status !== 200 || name === undefined) return { page: page.status + ': ' + html.slice(0, 80) };
	const entry = await fetch(url + '/_app/immutable/entry/start.' + name + '.js');
	const code = await entry.text();
	const type = entry.headers.get('content-type') ?? '';
	if (entry.status !== 200 || !/javascript/.test(type) || !code.includes(name)) {
		return { name, module: 'module of ' + name + ': ' + entry.status + ' ' + type };
	}
	return { name };
}

async function loadOldModule() {
	const response = await fetch(url + '/_app/immutable/nodes/7.b0.js');
	const code = await response.text();
	return response.status === 200 && code.includes("'b0'") ? null : 'old module: ' + response.status;
}

(async () => {
	const pageFailures = [];
	const moduleFailures = [];
	const seen = new Set();
	let requests = 0;
	let inARow = 0;
	let mostInARow = 0;
	while (Atomics.load(flag, 0) === 0) {
		const [page, old] = await Promise.all([loadPage(), loadOldModule()]);
		requests += 1;
		if (page.page) {
			pageFailures.push(page.page);
			inARow += 1;
			mostInARow = Math.max(mostInARow, inARow);
		} else {
			inARow = 0;
			seen.add(page.name);
		}
		if (page.module) moduleFailures.push(page.module);
		if (old) moduleFailures.push(old);
	}
	parentPort.postMessage({ pageFailures, moduleFailures, mostInARow, requests, seen: [...seen] });
})();
`;

describe('publishing while PocketBase serves the folder', () => {
	it('always answers with a complete build whose modules load, old tabs included', async () => {
		await publish({ from: build('b0'), to: publicDir });
		const stop = new SharedArrayBuffer(4);
		const worker = new Worker(LOAD, { eval: true, workerData: { url: instance.url, stop } });
		const result = new Promise((resolve, reject) => {
			worker.once('message', resolve);
			worker.once('error', reject);
		});
		// Let the load start before the first publish.
		await new Promise((resolve) => setTimeout(resolve, 300));

		const stats = [];
		for (let index = 1; index <= 5; index += 1) {
			stats.push(await publish({ from: build(`b${index}`), to: publicDir }));
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		Atomics.store(new Int32Array(stop), 0, 1);
		const { pageFailures, moduleFailures, mostInARow, requests, seen } = await result;
		await worker.terminate();

		// Modules never fail: new ones exist before index.html names them, old ones stay.
		expect(moduleFailures).toEqual([]);
		// Replacing index.html is a rename. On Windows a request that opens the file in the same
		// fraction of a millisecond may still get the 404 of PocketBase (sharing violation, about
		// 0.1 ms per publish, ADR-0040); there is never a gap of several requests as before.
		expect(mostInARow).toBeLessThanOrEqual(1);
		expect(pageFailures.length).toBeLessThanOrEqual(stats.length);
		expect(requests).toBeGreaterThan(10);
		expect(seen).toContain('b5');
		expect(stats.map((entry) => entry.version)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
		const index = await (await fetch(`${instance.url}/`)).text();
		expect(index).toContain('start.b5.js');
	}, 60_000);
});
