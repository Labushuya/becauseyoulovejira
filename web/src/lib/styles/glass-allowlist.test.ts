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

/** Files of the control layer that may carry glass (G-1, G-2, G-6): the complete list. */
const GLASS_FILES = [
	'lib/components/AppHeader.svelte',
	'lib/components/overlay/Popover.svelte',
	'lib/components/overlay/Modal.svelte',
	'lib/components/overlay/Drawer.svelte',
	'lib/components/overlay/FlagGroup.svelte',
	// The list of suggestions of the TagPicker, since RT-4 shared with the "/" menu of the editor.
	'lib/components/SuggestionList.svelte',
	'lib/components/CenteredCard.svelte',
	'lib/components/SettingsNav.svelte',
	// The bar of the bulk actions above the ticket table (plan BI-2, ADR-0036 §3), thick material.
	'lib/components/BulkActionBar.svelte',
	'lib/styles/tour.css'
];

/** Where the regular material may stand: below it only the gradient or the tables scroll. */
const REGULAR_FILES = [
	'lib/components/AppHeader.svelte',
	'lib/components/overlay/Drawer.svelte',
	'lib/components/SettingsNav.svelte'
];

/** Elements with a backdrop-filter must not hold fixed descendants of their own. */
const NO_FIXED_FILES = ['lib/components/AppHeader.svelte', 'lib/components/overlay/Drawer.svelte'];

/** Opaque on purpose (ADR-0029 section 1): the full view and the blanket never get glass. */
const OPAQUE_FILES = [
	'lib/components/overlay/FullView.svelte',
	'lib/components/ViewWithPanel.svelte'
];

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
		for (const file of [...GLASS_FILES, ...REGULAR_FILES, ...NO_FIXED_FILES, ...OPAQUE_FILES]) {
			expect(
				SOURCES.map((source) => source.file),
				file
			).toContain(file);
		}
	});

	it('keeps the full view and the blanket of the panel opaque, without blur', () => {
		for (const { file, css } of SOURCES.filter((source) => OPAQUE_FILES.includes(source.file))) {
			expect(css, file).not.toMatch(/--material-|backdrop-filter|filter:\s*blur/);
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

	// G-6: the settings navigation floats as glass only from 64rem; narrower it is a line of links.
	it('makes the settings navigation a glass card from 64rem only', () => {
		const nav = SOURCES.find((source) => source.file === 'lib/components/SettingsNav.svelte');
		const css = nav?.css ?? '';
		const wide = /@media \(min-width: 64rem\) \{([\s\S]*?)\n\t\}\n/.exec(css)?.[1] ?? '';
		expect(wide).toMatch(/background:\s*var\(--material-regular\)/);
		expect(wide).toMatch(/backdrop-filter:\s*var\(--glass-filter-regular\)/);
		expect(wide).toMatch(/border-radius:\s*var\(--radius-overlay\)/);
		const outside = css.replace(wide, '');
		expect(outside).not.toMatch(/--material-|backdrop-filter/);
		// Rows as rounded surfaces, the current one by surface and weight, no line on the left.
		expect(css).not.toMatch(/border-left/);
		expect(css).toMatch(/a\[aria-current='page'\] \{[^}]*font-weight:\s*600/);
	});
});
