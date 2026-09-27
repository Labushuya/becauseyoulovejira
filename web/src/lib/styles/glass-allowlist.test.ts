// Static checks of the glass rules (ADR-0029 sections 1, 4 and 5) over every stylesheet and
// component: backdrop-filter only in the files of the control layer and only with a glass filter
// token, the regular material only where the blur model of the contrast test holds, shadows only
// as tokens (plus the named row marker and the light edge), gradients only in base.css, and no
// descendant with position: fixed in the header, whose backdrop-filter would become its containing
// block.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..', '..');

/** Files of the control layer that may carry glass (grows with G-2 and G-6). */
const GLASS_FILES = ['lib/components/AppHeader.svelte', 'lib/components/overlay/Popover.svelte'];

/** Where the regular material may stand: below it only the gradient or the tables scroll. */
const REGULAR_FILES = ['lib/components/AppHeader.svelte'];

/** Elements with a backdrop-filter must not hold fixed descendants of their own. */
const NO_FIXED_FILES = ['lib/components/AppHeader.svelte'];

/** Allowed parts of a box-shadow outside tokens.css. */
const SHADOW_PARTS = [
	/^var\(--shadow-(control|popover|modal)\)$/,
	// The light edge on glass, inside at the top.
	/^inset 0 1px 0 var\(--glass-edge\)$/,
	// The marker of a chosen row (five tables and lists), no shadow.
	/^inset 3px 0 0 var\(--color-brand\)$/
];

/** Every .svelte and .css file below src, except tests, with its style text. */
function styleSources(): { file: string; css: string }[] {
	return readdirSync(SRC_DIR, { recursive: true })
		.map((entry) => String(entry).replaceAll('\\', '/'))
		.filter((file) => /\.(svelte|css)$/.test(file) && !file.includes('.test.'))
		.filter((file) => file !== 'lib/styles/tokens.css')
		.map((file) => {
			const text = readFileSync(join(SRC_DIR, file), 'utf8');
			const css = file.endsWith('.css')
				? text
				: [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
						.map((match) => match[1])
						.join('\n');
			return {
				file: relative(SRC_DIR, join(SRC_DIR, file)).replaceAll('\\', '/'),
				css: css.replace(/\/\*[\s\S]*?\*\//g, '')
			};
		});
}

const SOURCES = styleSources();

function values(css: string, property: string): string[] {
	return [...css.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'g'))].map(
		(match) => (match[1] ?? '').trim()
	);
}

describe('glass rules (ADR-0029)', () => {
	it('finds the stylesheets and components', () => {
		expect(SOURCES.length).toBeGreaterThan(50);
		for (const file of [...GLASS_FILES, ...REGULAR_FILES, ...NO_FIXED_FILES]) {
			expect(
				SOURCES.map((source) => source.file),
				file
			).toContain(file);
		}
	});

	it('uses backdrop-filter only in the control layer and only with a glass filter token', () => {
		for (const { file, css } of SOURCES) {
			const filters = values(css, 'backdrop-filter');
			if (!GLASS_FILES.includes(file)) {
				expect(filters, file).toEqual([]);
				continue;
			}
			expect(filters.length, file).toBeGreaterThan(0);
			for (const value of filters) {
				expect(value, file).toMatch(/^var\(--glass-filter-(regular|thick)\)$/);
			}
		}
	});

	it('puts the materials only on glass and the regular one only where the blur model holds', () => {
		for (const { file, css } of SOURCES) {
			if (/--material-/.test(css)) expect(GLASS_FILES, file).toContain(file);
			if (/--material-regular/.test(css)) expect(REGULAR_FILES, file).toContain(file);
		}
	});

	it('uses shadows only as tokens, the light edge or the row marker', () => {
		for (const { file, css } of SOURCES) {
			for (const value of values(css, 'box-shadow')) {
				for (const part of value.split(/,(?![^(]*\))/).map((piece) => piece.trim())) {
					expect(
						SHADOW_PARTS.some((pattern) => pattern.test(part)),
						`${file}: ${part}`
					).toBe(true);
				}
			}
		}
	});

	it('draws gradients only in base.css', () => {
		for (const { file, css } of SOURCES) {
			if (file === 'lib/styles/base.css') continue;
			expect(css, file).not.toMatch(/gradient\(/);
		}
	});

	it('gives the header no descendant with position: fixed', () => {
		for (const { file, css } of SOURCES) {
			if (!NO_FIXED_FILES.includes(file)) continue;
			expect(css, file).not.toMatch(/position:\s*fixed/);
		}
	});
});
