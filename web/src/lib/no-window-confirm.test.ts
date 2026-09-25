// Static check for ADR-0025 section 4: no browser dialogs. Questions go through the confirmation
// building block, so they look alike and work with the keyboard; window.confirm, alert and prompt
// do not appear in the app code (tests may mention them).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');
const BROWSER_DIALOG =
	/(?:\b(?:window|globalThis|self)\.|(?<![\w.$]))(?:confirm|alert|prompt)\s*\(/;

function appFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return appFiles(path);
		return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
	});
}

const files = appFiles(SRC_DIR);

describe('browser dialogs', () => {
	it('finds the app code', () => {
		expect(files.some((path) => path.endsWith('+page.svelte'))).toBe(true);
		expect(files.some((path) => path.endsWith('NewTicketForm.svelte'))).toBe(true);
	});

	it.each(files.map((path) => [relative(SRC_DIR, path), path]))('%s uses none', (_name, path) => {
		const code = readFileSync(path, 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/(^|[^:])\/\/.*$/gm, '$1');
		expect(code).not.toMatch(BROWSER_DIALOG);
	});

	it.each([
		['window.confirm("Löschen?")', true],
		['if (!confirm(text)) return;', true],
		['globalThis.alert(x)', true],
		['onconfirm()', false],
		['store.confirm()', false],
		['confirmDelete()', false],
		['role="alert"', false]
	])('recognizes %s', (code, found) => {
		expect(BROWSER_DIALOG.test(code)).toBe(found);
	});
});
