// Installable web app as PocketBase serves it (ADR-0035 section 8; plan start-fenster, SF-5; open
// question of stage S1 in docs/plan/plattformen.md): the web build in the public folder of an own
// disposable instance. PocketBase takes the type from the file extension (Go, mime package), so
// the manifest is a .json file; the service worker needs a JavaScript type, or the browser
// refuses to register it.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';

const WEB_BUILD = resolve(fileURLToPath(new URL('../../app/pb_public', import.meta.url)));

let instance;

beforeAll(async () => {
	if (!existsSync(join(WEB_BUILD, 'index.html'))) {
		throw new Error('app/pb_public/index.html is missing. Run npm run build first.');
	}
	instance = await startPocketBase({ publicFiles: WEB_BUILD });
});

afterAll(async () => {
	await instance?.stop();
});

const get = (path) => fetch(`${instance.url}${path}`);

describe('installable web app (SF-5)', () => {
	it('serves the manifest as JSON', async () => {
		const response = await get('/manifest.json');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/^application\/json/);
		const manifest = await response.json();
		expect(manifest.launch_handler).toEqual({ client_mode: ['focus-existing', 'auto'] });
	});

	it('serves the service worker as JavaScript at the root, so its scope is the whole app', async () => {
		const response = await get('/service-worker.js');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/^(text|application)\/javascript/);
		const source = await response.text();
		expect(source).toContain('/offline.html');
	});

	it('serves the offline page and the icons with their types', async () => {
		const page = await get('/offline.html');
		expect(page.status).toBe(200);
		expect(page.headers.get('content-type')).toMatch(/^text\/html/);
		expect(await page.text()).toContain('becauseyoulovejira läuft gerade nicht');
		for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
			const response = await get(`/icons/${icon}`);
			expect(response.status, icon).toBe(200);
			expect(response.headers.get('content-type'), icon).toBe('image/png');
		}
	});

	it('links the manifest and registers the service worker on every page of the app', async () => {
		const html = await (await get('/tickets/abc123def456ghi')).text();
		expect(html).toContain('<link rel="manifest" href="/manifest.json" />');
		expect(html).toMatch(/navigator\.serviceWorker\.register/);
		expect(html).toMatch(/service-worker\.js/);
	});

	// The minified build keeps no license comments (AR-4): the notices ship as files of the build.
	it('ships the licenses of the symbols, the fonts and the bundled libraries as text', async () => {
		const symbols = await get('/licenses.txt');
		expect(symbols.status).toBe(200);
		expect(symbols.headers.get('content-type')).toMatch(/^text\/plain/);
		const shipped = await symbols.text();
		for (const part of ['ISC License', 'Copyright (c) 2026 Lucide Icons and Contributors', 'Copyright (c) 2013-present Cole Bemis', 'licenses-libraries.txt']) {
			expect(shipped, part).toContain(part);
		}
		const libraries = await get('/licenses-libraries.txt');
		expect(libraries.status).toBe(200);
		expect(libraries.headers.get('content-type')).toMatch(/^text\/plain/);
		const bundled = await libraries.text();
		for (const name of ['@fontsource-variable/inter', '@fontsource-variable/jetbrains-mono', 'svelte', '@sveltejs/kit', 'pocketbase', 'driver.js', '@tiptap/core', 'markdown-it', 'dompurify']) {
			expect(bundled, name).toMatch(new RegExp(`^## ${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} - \\d`, 'm'));
		}
		expect(bundled).toContain('SIL OPEN FONT LICENSE Version 1.1');
	});
});
