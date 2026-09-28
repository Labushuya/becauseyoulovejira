// Static check for ADR-0032 section 5: the editor (Tiptap, ProseMirror, prosemirror-markdown and
// lib/editor/**) is a chunk of its own that loads on the first "Bearbeiten". Outside lib/editor
// nothing imports it statically (only `import type` and `import('…')`), and only lib/editor
// imports the packages themselves. There is one markdown-it: prosemirror-markdown uses the
// version of the display (overrides in web/package.json).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..', '..');
const WEB_DIR = resolve(SRC_DIR, '..');
const EDITOR_DIR = join('lib', 'editor');
const PACKAGES = /^(?:@tiptap\/|prosemirror-)/;

/** Source files below src without tests, with their path relative to src. */
function sources(): { file: string; text: string }[] {
	return readdirSync(SRC_DIR, { recursive: true })
		.map((entry) => String(entry))
		.filter((file) => /\.(ts|svelte)$/.test(file) && !file.includes('.test.'))
		.map((file) => ({ file, text: readFileSync(join(SRC_DIR, file), 'utf8') }));
}

/** Static imports (`import … from '…'` and `import '…'`) that are not type-only. */
function staticImports(text: string): string[] {
	return [...text.matchAll(/^\s*import\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)].map(
		(match) => match[1] ?? ''
	);
}

describe('the editor chunk', () => {
	const files = sources();

	it('finds the editor and its users', () => {
		expect(files.some(({ file }) => file.startsWith(EDITOR_DIR))).toBe(true);
		expect(files.some(({ text }) => text.includes("import('$lib/editor/create-editor')"))).toBe(
			true
		);
	});

	it('is imported outside lib/editor only as type or with import()', () => {
		const offenders = files
			.filter(({ file }) => !file.startsWith(EDITOR_DIR))
			.flatMap(({ file, text }) =>
				staticImports(text)
					.filter((path) => path.startsWith('$lib/editor') || /(^|\/)editor\/[a-z-]+$/.test(path))
					.map((path) => `${relative('.', file)}: ${path}`)
			);
		expect(offenders).toEqual([]);
	});

	it('is the only place that imports Tiptap and ProseMirror', () => {
		const offenders = files
			.filter(({ file }) => !file.startsWith(EDITOR_DIR))
			.flatMap(({ file, text }) =>
				staticImports(text)
					.filter((path) => PACKAGES.test(path))
					.map((path) => `${file}: ${path}`)
			);
		expect(offenders).toEqual([]);
	});

	it('shares the one markdown-it of the display', () => {
		const lock = JSON.parse(readFileSync(join(WEB_DIR, 'package-lock.json'), 'utf8')) as {
			packages: Record<string, { version?: string }>;
		};
		const copies = Object.keys(lock.packages).filter((path) =>
			path.endsWith('node_modules/markdown-it')
		);
		expect(copies).toEqual(['node_modules/markdown-it']);
		const manifest = JSON.parse(readFileSync(join(WEB_DIR, 'package.json'), 'utf8')) as {
			overrides?: Record<string, Record<string, string>>;
		};
		expect(manifest.overrides?.['prosemirror-markdown']?.['markdown-it']).toBe('$markdown-it');
	});
});
