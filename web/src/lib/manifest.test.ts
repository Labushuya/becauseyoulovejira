// Installable web app (ADR-0035 section 8; plan start-fenster, SF-5): the manifest has the fields
// Chrome and Edge need for the installation and focus-existing, its icons exist in web/static, its
// colors and the theme-color of app.html equal --color-bg of tokens.css (no color outside tokens),
// and the offline page is self-contained and loads the address again once the app runs.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WEB = join(import.meta.dirname, '..', '..');
const STATIC = join(WEB, 'static');
const MANIFEST = JSON.parse(readFileSync(join(STATIC, 'manifest.json'), 'utf8'));
const APP_HTML = readFileSync(join(WEB, 'src', 'app.html'), 'utf8');
const TOKENS = readFileSync(join(WEB, 'src', 'lib', 'styles', 'tokens.css'), 'utf8');
const OFFLINE = readFileSync(join(STATIC, 'offline.html'), 'utf8');

/** --color-bg of the first block that starts with `selector` in tokens.css. */
function background(selector: string): string {
	const start = TOKENS.indexOf(selector);
	if (start < 0) throw new Error(`tokens.css has no block ${selector}`);
	const value = /--color-bg:\s*(#[0-9a-f]{6})/i.exec(TOKENS.slice(start))?.[1];
	if (value === undefined) throw new Error(`no --color-bg after ${selector}`);
	return value.toLowerCase();
}

const LIGHT = background(':root {');
const DARK = background(":root:not([data-theme='light']) {");

describe('manifest.json', () => {
	it('has the fields of an installable app on the root of the server', () => {
		expect(MANIFEST).toMatchObject({
			id: '/',
			name: 'becauseyoulovejira',
			short_name: 'becauseyoulovejira',
			lang: 'de',
			start_url: '/',
			scope: '/',
			display: 'standalone'
		});
		expect(MANIFEST.start_url.startsWith(MANIFEST.scope)).toBe(true);
	});

	it('reuses the open window for every launch (focus-existing)', () => {
		expect(MANIFEST.launch_handler).toEqual({ client_mode: ['focus-existing', 'auto'] });
	});

	it('has icons of 192 and 512 px and a maskable one, all in web/static', () => {
		const icons = MANIFEST.icons as { src: string; sizes: string; type: string; purpose: string }[];
		expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
			'192x192 any',
			'512x512 any',
			'512x512 maskable'
		]);
		for (const icon of icons) {
			expect(icon.type).toBe('image/png');
			expect(icon.src.startsWith('/icons/')).toBe(true);
			expect(existsSync(join(STATIC, icon.src))).toBe(true);
		}
	});

	it('takes its colors from --color-bg of the light mode', () => {
		expect(LIGHT).toBe('#f5f8f8');
		expect(MANIFEST.background_color.toLowerCase()).toBe(LIGHT);
		expect(MANIFEST.theme_color.toLowerCase()).toBe(LIGHT);
	});
});

describe('app.html', () => {
	it('links the manifest', () => {
		expect(APP_HTML).toContain('<link rel="manifest" href="/manifest.json" />');
	});

	it('has the theme-color of the light and the dark mode from tokens.css', () => {
		expect(APP_HTML).toContain(
			`<meta name="theme-color" content="${LIGHT}" media="(prefers-color-scheme: light)" />`
		);
		expect(APP_HTML).toContain(
			`<meta name="theme-color" content="${DARK}" media="(prefers-color-scheme: dark)" />`
		);
		expect(APP_HTML.match(/#[0-9a-f]{6}\b/gi)?.map((value) => value.toLowerCase())).toEqual([
			LIGHT,
			DARK
		]);
	});
});

describe('offline.html', () => {
	it('loads nothing from outside and uses system colors only', () => {
		expect(OFFLINE).not.toMatch(/<script\b[^>]*\bsrc=|<link\b|@import|url\(/i);
		expect(OFFLINE).not.toMatch(/https?:\/\//);
		expect(OFFLINE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(OFFLINE).toMatch(/<html lang="de">/);
		expect(OFFLINE).toContain('Starte die App mit start.bat im Ordner app.');
	});

	function run(fetch: () => Promise<{ ok: boolean }>) {
		const body = /<body>([\s\S]*)<\/body>/.exec(OFFLINE)?.[1] ?? '';
		document.body.innerHTML = body;
		const script = /<script>([\s\S]*?)<\/script>/.exec(OFFLINE)?.[1] ?? '';
		const win = {
			location: { reload: vi.fn() },
			fetch: vi.fn(fetch),
			setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
			clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
		};
		new Function('window', 'document', script)(win, document);
		return win;
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		document.body.innerHTML = '';
	});

	it('checks the server every 2 s and loads the address again once it answers', async () => {
		let up = false;
		const win = run(async () => {
			if (!up) throw new TypeError('Failed to fetch');
			return { ok: true };
		});
		expect(document.activeElement?.id).toBe('byl-title');
		await vi.advanceTimersByTimeAsync(4000);
		expect(win.fetch).toHaveBeenCalledTimes(2);
		expect(win.fetch).toHaveBeenCalledWith('/api/health', { cache: 'no-store' });
		expect(win.location.reload).not.toHaveBeenCalled();
		up = true;
		await vi.advanceTimersByTimeAsync(2000);
		expect(win.location.reload).toHaveBeenCalledOnce();
	});

	it('"Erneut versuchen" loads the address again at once', () => {
		const win = run(async () => ({ ok: false }));
		document.getElementById('byl-retry')?.click();
		expect(win.location.reload).toHaveBeenCalledOnce();
	});
});
