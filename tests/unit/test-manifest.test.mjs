// Consistency of docs/test-manifest.html (CLAUDE.md §12: every work package updates the manifest).
// The manifest keeps its cases as JSON in <script type="application/json" id="manifest-data">,
// so this test reads them without a browser.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const MANIFEST_PATH = 'docs/test-manifest.html';
const html = readFileSync(new URL(MANIFEST_PATH, ROOT), 'utf8');

const ARTS = ['unit', 'komponente', 'integration', 'manuell'];
const STATUSES = ['bestanden', 'offen', 'geplant', 'nicht zutreffend'];
const ID_PATTERN = /^BYL-(E\d|X)-\d{3}$/;
const VOID_ELEMENTS = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'wbr', 'col', 'area', 'base', 'embed', 'track']);
// Words that only occur in the template of another project the manifest was built from.
const TEMPLATE_LEFTOVERS = [/stoqr/i, /\bGlobus\b/, /\bPenny\b/, /\bEAN\b/, /Lagerort/, /Einkaufsliste/, /Vollmilch/, /Märkte/, /Regressions-Report/];

function manifestData() {
	const match = /<script type="application\/json" id="manifest-data">([\s\S]*?)<\/script>/.exec(html);
	if (!match) throw new Error('No manifest-data block in ' + MANIFEST_PATH);
	return JSON.parse(match[1]);
}

function allItems() {
	return manifestData().blocks.flatMap((block) => block.items);
}

/** Test files the manifest must cover: tests/unit, tests/integration and web/src/**\/*.test.ts. */
function testFiles() {
	const list = (dir, pattern) =>
		readdirSync(new URL(dir, ROOT), { recursive: true })
			.map((file) => `${dir}/${String(file).replaceAll('\\', '/')}`)
			.filter((file) => pattern.test(file));
	return [
		...list('tests/unit', /\.test\.(js|mjs|ts)$/),
		...list('tests/integration', /\.test\.(js|mjs|ts)$/),
		...list('web/src', /\.test\.ts$/)
	].sort();
}

describe('docs/test-manifest.html', () => {
	it('is a well-formed HTML document', () => {
		expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
		expect(html).toMatch(/<html lang="de">/);
		expect(html).toMatch(/<meta charset="utf-8" \/>/);
		for (const tag of ['html', 'head', 'body', 'title']) {
			expect(html.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length, `<${tag}>`).toBe(1);
		}

		// Tags outside of script and style must nest properly.
		const markup = html
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
			.replace(/<!DOCTYPE[^>]*>/i, '');
		const stack = [];
		for (const [, closing, name, selfClosing] of markup.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
			const tag = name.toLowerCase();
			if (VOID_ELEMENTS.has(tag) || selfClosing) continue;
			if (!closing) {
				stack.push(tag);
				continue;
			}
			expect(stack.pop(), `closing </${tag}>`).toBe(tag);
		}
		expect(stack).toEqual([]);
	});

	it('works offline: no external scripts, styles, fonts or images', () => {
		expect(html).not.toMatch(/\b(src|href)\s*=\s*["']?(https?:)?\/\//i);
		expect(html).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//i);
		expect(html).not.toMatch(/<link\b/i);
	});

	it('has parseable data with project, date and commit', () => {
		const { meta, blocks } = manifestData();
		expect(meta.projekt).toBe('becauseyoulovejira');
		expect(meta.stand).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(meta.commit).toMatch(/^[0-9a-f]{7,40}$/);
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			expect(block.name, 'block name').toBeTruthy();
			expect(block.items.length, block.name).toBeGreaterThan(0);
		}
	});

	it('has unique, well-formed IDs', () => {
		const ids = allItems().map((item) => item.id);
		expect(ids.filter((id) => !ID_PATTERN.test(id))).toEqual([]);
		expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
	});

	it('describes every case completely', () => {
		for (const item of allItems()) {
			expect(item.title, item.id).toBeTruthy();
			expect(item.pre, item.id).toBeTruthy();
			expect(item.expect, item.id).toBeTruthy();
			expect(item.steps.length, item.id).toBeGreaterThan(0);
			expect(item.art.length, item.id).toBeGreaterThan(0);
			expect(item.art.filter((art) => !ARTS.includes(art)), item.id).toEqual([]);
			expect(STATUSES, item.id).toContain(item.status);
			const automated = item.art.some((art) => art !== 'manuell');
			if (item.status === 'bestanden') {
				expect(automated, `${item.id} passed but not automated`).toBe(true);
				expect(item.tests.length, `${item.id} has no test file`).toBeGreaterThan(0);
			}
			if (item.art.length === 1 && item.art[0] === 'manuell') {
				expect(['offen', 'geplant', 'nicht zutreffend'], item.id).toContain(item.status);
			}
		}
	});

	it('references only existing test files and test names', () => {
		const missing = [];
		for (const item of allItems()) {
			for (const ref of item.tests) {
				const [file, name] = ref.split('::');
				const url = new URL(file, ROOT);
				if (!existsSync(url)) {
					missing.push(`${item.id}: ${file}`);
					continue;
				}
				if (name !== undefined && !readFileSync(url, 'utf8').includes(name)) {
					missing.push(`${item.id}: "${name}" in ${file}`);
				}
			}
		}
		expect(missing).toEqual([]);
	});

	it('covers every test file of the repository', () => {
		const referenced = new Set(allItems().flatMap((item) => item.tests.map((ref) => ref.split('::')[0])));
		expect(testFiles().filter((file) => !referenced.has(file))).toEqual([]);
	});

	it('contains nothing left over from the template', () => {
		for (const pattern of TEMPLATE_LEFTOVERS) {
			expect(html, String(pattern)).not.toMatch(pattern);
		}
	});
});
