// Static checks for package G-4 (ADR-0029 sections 4 and 9): radii only as tokens, every search
// field on the shared .search-field of base.css and the view switches on the shared .segmented.
// Checked in every component style and every CSS file except tokens.css, which defines the radii.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');
const TOKENS_CSS = join('lib', 'styles', 'tokens.css');

/**
 * Files that still carry a radius literal. They belong to the parallel work on the mail keywords
 * and move to the tokens with their next change. The list may only shrink: a file listed here
 * without a literal fails the test.
 */
const LEGACY_RADII = [
	join('lib', 'components', 'ConnectionsSection.svelte'),
	join('lib', 'components', 'ImportKeywordsSection.svelte'),
	join('lib', 'components', 'KeywordEditor.svelte')
];

/** Values a radius may take besides a token: none, a circle, or what the parent has. */
const PLAIN_RADII = new Set(['0', '50%', 'inherit']);

function files(dir: string, pattern: RegExp): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path, pattern);
		return pattern.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
	});
}

/** The CSS of a file: the <style> blocks of a component or the whole CSS file, without comments. */
function css(path: string): string {
	const source = readFileSync(path, 'utf8');
	const style = path.endsWith('.svelte')
		? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
		: source;
	return style.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Every value of border-radius and its longhands with a part that is neither a token nor a plain
 * value; shorthands with several corners are checked part by part.
 */
function literalRadii(style: string): string[] {
	return [...style.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)]
		.map((match) => (match[1] ?? '').replace(/\s*!important$/, '').trim())
		.filter((value) =>
			value
				.split(/\s+(?![^(]*\))|\s*\/\s*/)
				.some((part) => !PLAIN_RADII.has(part) && !/^var\(--radius-[a-z]+\)$/.test(part))
		);
}

const SOURCES = [...files(SRC_DIR, /\.svelte$/), ...files(SRC_DIR, /\.css$/)]
	.map((path) => relative(SRC_DIR, path))
	.filter((path) => path !== TOKENS_CSS)
	.sort();

describe('radii only as tokens (ADR-0029 section 4)', () => {
	it('finds the component styles and style sheets', () => {
		expect(SOURCES.length).toBeGreaterThan(50);
		expect(SOURCES).toContain(join('lib', 'styles', 'base.css'));
		expect(SOURCES).not.toContain(TOKENS_CSS);
	});

	it.each(SOURCES.filter((path) => !LEGACY_RADII.includes(path)))(
		'%s uses only --radius-* tokens, 0, 50% or inherit',
		(path) => {
			expect(literalRadii(css(join(SRC_DIR, path)))).toEqual([]);
		}
	);

	it.each(LEGACY_RADII)('%s is still on the list that may only shrink', (path) => {
		expect(literalRadii(css(join(SRC_DIR, path))).length, path).toBeGreaterThan(0);
	});

	it('knows a literal from a token', () => {
		expect(literalRadii('a { border-radius: 0.375rem; }')).toEqual(['0.375rem']);
		expect(literalRadii('a { border-top-left-radius: 2px; }')).toEqual(['2px']);
		expect(literalRadii('a { border-radius: var(--radius-pill); b: 0 }')).toEqual([]);
		expect(literalRadii('a { border-radius: 50%; } b { border-radius: 0 }')).toEqual([]);
		expect(
			literalRadii('a { border-radius: var(--radius-surface) 0 0 var(--radius-surface); }')
		).toEqual([]);
		expect(literalRadii('a { border-radius: var(--radius-item) 0.5rem; }')).toHaveLength(1);
	});
});

describe('shared search field and segmented control (ADR-0029 section 9)', () => {
	const components = SOURCES.filter((path) => path.endsWith('.svelte'));
	const markup = (path: string) =>
		readFileSync(join(SRC_DIR, path), 'utf8').replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');

	it('puts every input of type search into a .search-field with the magnifier', () => {
		const withSearch = components.filter((path) => /type="search"/.test(markup(path)));
		expect(withSearch).toEqual(
			expect.arrayContaining([
				join('lib', 'components', 'FilterBar.svelte'),
				join('lib', 'components', 'FilterPopover.svelte'),
				join('lib', 'components', 'ProjectsView.svelte')
			])
		);
		for (const path of withSearch) {
			const text = markup(path);
			const fields = [...text.matchAll(/class="[^"]*\bsearch-field\b[^"]*"/g)].length;
			const inputs = [...text.matchAll(/type="search"/g)].length;
			expect(fields, path).toBe(inputs);
			for (const [, inner = ''] of text.matchAll(
				/class="[^"]*\bsearch-field\b[^"]*">([\s\S]*?)type="search"/g
			)) {
				expect(inner, path).toMatch(/<svg viewBox="0 0 16 16" aria-hidden="true"/);
			}
		}
	});

	it('draws the view switch and the layout of the projects as segmented controls', () => {
		expect(markup(join('lib', 'components', 'ViewSwitch.svelte'))).toMatch(
			/<nav class="view-switch segmented" aria-label="Ansicht">/
		);
		const projects = markup(join('lib', 'components', 'ProjectsView.svelte'));
		expect(projects).toMatch(/class="layout-switch segmented"\s+role="group"/);
		expect(projects).toMatch(/aria-label="Liste"[\s\S]*?aria-pressed=/);
	});

	it('keeps the look of search fields and segments in base.css only', () => {
		for (const path of SOURCES.filter((source) => source !== join('lib', 'styles', 'base.css'))) {
			const style = css(join(SRC_DIR, path));
			expect(style, path).not.toMatch(/\.segmented[^{]*\{[^}]*(background|border)/);
			expect(style, path).not.toMatch(/\.search-field\s*\{[^}]*(background|border)/);
		}
	});
});
