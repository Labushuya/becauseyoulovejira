// Emergency page src/error.html (ADR-0040): SvelteKit shows it when even the root layout or the
// error page of the app cannot be loaded. It used to be the English default "500 Internal Error".
// SvelteKit fills in status and message (escaped) and puts head and body into the open document,
// where scripts do not run; the test does the same.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE_LOAD_MESSAGE } from '$lib/app-update';

const TEMPLATE = readFileSync(join(import.meta.dirname, 'error.html'), 'utf8');

/** Like the client of SvelteKit: fill in status and escaped message, parse the page. */
function show(status: number, message: string): Document {
	const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const html = TEMPLATE.replaceAll('%sveltekit.status%', String(status)).replaceAll(
		'%sveltekit.error.message%',
		escaped
	);
	return new DOMParser().parseFromString(html, 'text/html');
}

describe('emergency page src/error.html', () => {
	it('explains the error in German with status and message', () => {
		const page = show(500, MODULE_LOAD_MESSAGE);

		expect(page.documentElement.lang).toBe('de');
		expect(page.querySelector('h1')?.textContent).toBe(
			'becauseyoulovejira konnte nicht geladen werden'
		);
		expect(page.body.textContent).toContain(MODULE_LOAD_MESSAGE);
		expect(page.body.textContent).toContain('Fehlercode 500');
		expect(page.body.textContent).not.toMatch(/Internal Error/);
	});

	it('reloads with a button that works without scripts and leaves to the overview as a new document', () => {
		const page = show(500, MODULE_LOAD_MESSAGE);

		const button = page.querySelector('button');
		expect(button?.textContent).toBe('Neu laden');
		expect(button?.getAttribute('type')).toBe('button');
		expect(button?.getAttribute('onclick')).toBe('location.reload()');
		const link = page.querySelector('a');
		expect(link?.textContent).toBe('Zur Übersicht');
		expect(link?.getAttribute('href')).toBe('/');
		expect(link?.hasAttribute('data-sveltekit-reload')).toBe(true);
		expect(page.querySelector('script')).toBeNull();
	});

	it('shows markup in the message as text', () => {
		const page = show(500, '<img src=x onerror=alert(1)>');
		expect(page.querySelector('img')).toBeNull();
		expect(page.body.textContent).toContain('<img src=x onerror=alert(1)>');
	});

	it('needs nothing from outside and only system colors', () => {
		expect(TEMPLATE).not.toMatch(/\b(src|href)\s*=\s*["']?(https?:)?\/\//i);
		expect(TEMPLATE).not.toMatch(/<link\b|@import|url\(/i);
		expect(TEMPLATE).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
	});
});
