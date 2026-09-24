// Static check for ADR-0008: {@html} appears only in Markdown.svelte, and there it shows only
// the result of renderMarkdown.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');
const MARKDOWN = join(SRC_DIR, 'lib', 'components', 'Markdown.svelte');

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return svelteFiles(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

const files = svelteFiles(SRC_DIR);
const others = files.filter((path) => path !== MARKDOWN);

describe('{@html}', () => {
	it('finds the components', () => {
		expect(files).toContain(MARKDOWN);
		expect(others.length).toBeGreaterThan(5);
	});

	it.each(others.map((path) => [relative(SRC_DIR, path), path]))(
		'%s does not use it',
		(_name, path) => {
			expect(readFileSync(path, 'utf8')).not.toMatch(/\{@html\b/);
		}
	);

	it('appears once in Markdown.svelte, fed only by renderMarkdown', () => {
		const source = readFileSync(MARKDOWN, 'utf8');

		expect(source.match(/\{@html\b[^}]*\}/g)).toEqual(['{@html html}']);
		expect(source).toMatch(/const html = \$derived\(renderMarkdown\(source\)\);/);
	});
});
