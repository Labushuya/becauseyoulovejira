// Guards the design tokens (CLAUDE.md section 8, ADR-0009, ADR-0025): every theme block defines
// the same color tokens and its color-scheme, the error color reaches WCAG AA contrast in light
// and dark mode, and the overlay sizes, radii and motion exist once in :root.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

const LIGHT = ':root';
const DARK = ":root:not([data-theme='light'])";
const FORCED_LIGHT = ":root[data-theme='light']";
const FORCED_DARK = ":root[data-theme='dark']";

/** Innermost rule blocks of the file, keyed by selector, with their custom properties. */
function parseBlocks(css: string): Map<string, Map<string, string>> {
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const blocks = new Map<string, Map<string, string>>();
	for (const [, selector = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const properties = new Map<string, string>();
		for (const [, name = '', value = ''] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
			properties.set(name, value.trim());
		}
		blocks.set(selector.trim(), properties);
	}
	return blocks;
}

/**
 * Tokens that are the same in every theme (ADR-0025 section 2): defined once in :root, never in a
 * theme block. The font stacks belong to them as well.
 */
const NON_COLOR_TOKENS = {
	'--font-ui': "'Inter Variable', system-ui, sans-serif",
	'--font-mono': "'JetBrains Mono Variable', ui-monospace, monospace",
	'--overlay-width-s': '25rem',
	'--overlay-width-m': '37.5rem',
	'--overlay-width-l': '50rem',
	'--overlay-width-xl': '62.5rem',
	'--overlay-max-height': 'calc(100dvh - 2rem)',
	'--overlay-max-height-xl': '92dvh',
	'--drawer-width': '30rem',
	'--full-view-sidebar': '21.25rem',
	'--radius-control': '0.375rem',
	'--radius-surface': '0.5rem',
	'--motion-fast': '120ms',
	'--motion-medium': '200ms',
	'--motion-ease': 'cubic-bezier(0.2, 0, 0, 1)'
} as const;

function isNonColorToken(name: string): boolean {
	return Object.hasOwn(NON_COLOR_TOKENS, name);
}

/** Theme-dependent tokens of a block. */
function colorTokens(block: Map<string, string>): Map<string, string> {
	return new Map([...block].filter(([name]) => !isNonColorToken(name)));
}

/** Value of the color-scheme property of each innermost block, keyed by selector. */
function colorSchemes(css: string): Map<string, string | undefined> {
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const schemes = new Map<string, string | undefined>();
	for (const [, selector = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		schemes.set(selector.trim(), /(?:^|[;\s])color-scheme\s*:\s*([^;]+);/.exec(body)?.[1]?.trim());
	}
	return schemes;
}

function channel(value: number): number {
	const srgb = value / 255;
	return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (WCAG 2.x) of a #rrggbb color. */
function luminance(hex: string): number {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!match) throw new Error(`Not a #rrggbb color: ${hex}`);
	const [r, g, b] = match.slice(1).map((part) => channel(parseInt(part, 16)));
	return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(first: string, second: string): number {
	const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
	return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

const blocks = parseBlocks(SOURCE);

function block(selector: string): Map<string, string> {
	const found = blocks.get(selector);
	if (!found) throw new Error(`tokens.css has no block ${selector}`);
	return colorTokens(found);
}

function token(selector: string, name: string): string {
	const value = block(selector).get(name);
	if (value === undefined) throw new Error(`${selector} does not define ${name}`);
	return value;
}

describe('tokens.css', () => {
	it('has exactly the four theme blocks', () => {
		expect([...blocks.keys()].sort()).toEqual([LIGHT, DARK, FORCED_LIGHT, FORCED_DARK].sort());
	});

	it('defines the same color tokens in every block', () => {
		const names = [...block(LIGHT).keys()].sort();
		expect(names.length).toBeGreaterThan(0);
		for (const selector of [DARK, FORCED_LIGHT, FORCED_DARK]) {
			expect([...block(selector).keys()].sort(), selector).toEqual(names);
		}
	});

	it('uses the same values for the default and the forced variant of each mode', () => {
		expect(Object.fromEntries(block(FORCED_LIGHT))).toEqual(Object.fromEntries(block(LIGHT)));
		expect(Object.fromEntries(block(FORCED_DARK))).toEqual(Object.fromEntries(block(DARK)));
	});

	it('defines the sizes, radii and motion of ADR-0025 once in :root and nowhere else', () => {
		const light = blocks.get(LIGHT) ?? new Map<string, string>();
		for (const [name, value] of Object.entries(NON_COLOR_TOKENS)) {
			expect(light.get(name), name).toBe(value);
		}
		for (const selector of [DARK, FORCED_LIGHT, FORCED_DARK]) {
			const names = [...(blocks.get(selector)?.keys() ?? [])];
			expect(names.filter(isNonColorToken), selector).toEqual([]);
		}
	});

	it('has no shadow token (ADR-0010 section 3, ADR-0025 section 2)', () => {
		for (const [selector, properties] of blocks) {
			expect(
				[...properties.keys()].filter((name) => /shadow/.test(name)),
				selector
			).toEqual([]);
		}
	});

	it('darkens with the blanket of ADR-0025 in both modes', () => {
		expect(token(LIGHT, '--color-blanket')).toBe('rgb(23 35 38 / 0.45)');
		expect(token(DARK, '--color-blanket')).toBe('rgb(0 0 0 / 0.6)');
	});

	it('sets color-scheme in every block, so native controls follow the mode', () => {
		const schemes = colorSchemes(SOURCE);
		expect(schemes.get(LIGHT)).toBe('light');
		expect(schemes.get(FORCED_LIGHT)).toBe('light');
		expect(schemes.get(DARK)).toBe('dark');
		expect(schemes.get(FORCED_DARK)).toBe('dark');
	});

	it('has the error colors of ADR-0009', () => {
		expect(token(LIGHT, '--color-danger')).toBe('#a13a40');
		expect(token(LIGHT, '--color-danger-soft-bg')).toBe('#f8e9e9');
		expect(token(DARK, '--color-danger')).toBe('#eaa0a0');
		expect(token(DARK, '--color-danger-soft-bg')).toBe('#3b1e21');
	});

	describe.each([
		['light', LIGHT],
		['dark', DARK],
		['forced light', FORCED_LIGHT],
		['forced dark', FORCED_DARK]
	])('error color contrast (%s)', (_mode, selector) => {
		it.each(['--color-surface', '--color-bg', '--color-danger-soft-bg'])(
			'--color-danger on %s reaches at least 4.5 : 1',
			(background) => {
				const ratio = contrast(token(selector, '--color-danger'), token(selector, background));
				expect(ratio).toBeGreaterThanOrEqual(4.5);
			}
		);
	});

	it('computes the contrast ratios documented in ADR-0009', () => {
		expect(contrast('#a13a40', '#ffffff')).toBeCloseTo(6.57, 2);
		expect(contrast('#eaa0a0', '#0e1517')).toBeCloseTo(8.82, 2);
		expect(contrast('#000000', '#ffffff')).toBe(21);
	});
});
