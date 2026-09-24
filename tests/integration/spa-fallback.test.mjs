// SPA fallback (E1 plan, package 7): PocketBase serves the web build from its public folder and
// answers every unknown path with index.html, so /login and deep links survive a reload. The
// test copies app/pb_public (npm run build; scripts/build.ps1 builds before testing) into the
// public folder of an own disposable instance.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';

const WEB_BUILD = resolve(fileURLToPath(new URL('../../app/pb_public', import.meta.url)));
const INDEX_HTML = join(WEB_BUILD, 'index.html');

let instance;
let indexHtml;

beforeAll(async () => {
	if (!existsSync(INDEX_HTML)) {
		throw new Error('app/pb_public/index.html is missing. Run npm run build first.');
	}
	indexHtml = await readFile(INDEX_HTML, 'utf8');
	instance = await startPocketBase({ publicFiles: WEB_BUILD });
});

afterAll(async () => {
	await instance?.stop();
});

describe('SPA fallback', () => {
	it.each(['/', '/login', '/eine/unbekannte/route'])('serves index.html for %s', async (path) => {
		const response = await fetch(`${instance.url}${path}`);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/^text\/html/);
		expect(await response.text()).toBe(indexHtml);
	});

	it('keeps answering API requests with JSON', async () => {
		const response = await fetch(`${instance.url}/api/health`);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/^application\/json/);
	});
});
