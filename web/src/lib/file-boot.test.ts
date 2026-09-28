// Switch for file:// in app.html (ADR-0035 section 1; plan start-fenster, SF-2): a double click on
// pb_public\index.html used to show an empty page, because the modules cannot load from a file. The
// first statement of the inline script sends such a page to the landing page app\becauseyoulovejira.html
// (relative, so spaces and "#" in the folder name survive) and leaves theme, accent and
// transparency alone. Over http nothing changes (theme-boot.test.ts covers the rest).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from './theme.svelte';

const APP_HTML = readFileSync(join(import.meta.dirname, '..', 'app.html'), 'utf8');
const LANDING = join(import.meta.dirname, '..', '..', '..', 'app', 'becauseyoulovejira.html');

function bootScript(): string {
	const scripts = [...APP_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
	const script = scripts.find((text) => text?.includes(THEME_STORAGE_KEY));
	if (script === undefined) throw new Error('app.html has no boot script');
	return script;
}

function storage(entries: Record<string, string>) {
	const data = new Map(Object.entries(entries));
	return {
		getItem: vi.fn((key: string) => data.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
		removeItem: vi.fn((key: string) => void data.delete(key))
	};
}

function boot(href: string, entries: Record<string, string> = {}) {
	const location = { href, protocol: new URL(href).protocol, replace: vi.fn() };
	const store = storage(entries);
	new Function('localStorage', 'document', 'location', bootScript())(store, document, location);
	return { replace: location.replace, store };
}

afterEach(() => {
	for (const name of ['data-theme', 'data-accent', 'data-transparency']) {
		document.documentElement.removeAttribute(name);
	}
});

describe('file:// switch in app.html (ADR-0035)', () => {
	it('is the first statement of the boot script', () => {
		const script = bootScript();
		expect(script.indexOf("location.protocol === 'file:'")).toBeGreaterThan(-1);
		expect(script.indexOf("location.protocol === 'file:'")).toBeLessThan(script.indexOf('try {'));
	});

	it('sends pb_public\\index.html to the landing page next to start.bat', () => {
		const { replace } = boot('file:///C:/Users/anna/byl/app/pb_public/index.html');
		expect(replace).toHaveBeenCalledExactlyOnceWith(
			'file:///C:/Users/anna/byl/app/becauseyoulovejira.html'
		);
	});

	it('keeps spaces and "#" of the folder name and ignores a hash of the page', () => {
		const { replace } = boot(
			'file:///D:/Program%20Files/byl%20%231/app/pb_public/index.html#/tickets'
		);
		expect(replace).toHaveBeenCalledExactlyOnceWith(
			'file:///D:/Program%20Files/byl%20%231/app/becauseyoulovejira.html'
		);
	});

	it('sets neither theme, accent nor transparency and does not touch the storage under file://', () => {
		const { store } = boot('file:///C:/byl/app/pb_public/index.html', {
			'byl-theme': 'dark',
			'byl-accent': 'rubin',
			'byl-transparency': 'off'
		});
		expect(store.getItem).not.toHaveBeenCalled();
		expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
		expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
		expect(document.documentElement.hasAttribute('data-transparency')).toBe(false);
	});

	it('changes nothing over http', () => {
		const { replace } = boot('http://127.0.0.1:8090/tickets', {
			'byl-theme': 'dark',
			'byl-accent': 'kupfer'
		});
		expect(replace).not.toHaveBeenCalled();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		expect(document.documentElement.getAttribute('data-accent')).toBe('kupfer');
	});

	it('points to a landing page that exists in the app folder', () => {
		expect(existsSync(LANDING)).toBe(true);
	});
});
