// Guards the design tokens (CLAUDE.md section 8, ADR-0009, ADR-0025, ADR-0027): every mode block
// defines the same color tokens and its color-scheme, every accent theme overrides exactly the
// accent tokens in its four blocks, all text and UI pairs reach WCAG AA in every theme and mode,
// the accents keep a measurable distance (CIEDE2000) from the error color, from Petrol and from
// each other, and the overlay sizes, radii and motion exist once in :root.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENT_THEMES, STORED_ACCENTS, type AccentTheme } from '$lib/accent.svelte';
import { contrast, deltaE2000, hexToLab, hslHue } from '$lib/test/color-math';

const SOURCE = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

type Mode = 'light' | 'dark' | 'forced light' | 'forced dark';

const MODES: readonly Mode[] = ['light', 'dark', 'forced light', 'forced dark'];

const MODE_SELECTORS: Record<Mode, string> = {
	light: ':root',
	dark: ":root:not([data-theme='light'])",
	'forced light': ":root[data-theme='light']",
	'forced dark': ":root[data-theme='dark']"
};

/** The accent themes besides the default Petrol, as in data-accent (ADR-0027), from the store. */
const ACCENTS = STORED_ACCENTS;
type Accent = (typeof ACCENTS)[number];
type Theme = AccentTheme;
const THEMES: readonly Theme[] = ACCENT_THEMES;

function accentSelector(accent: Accent, mode: Mode): string {
	const root = `:root[data-accent='${accent}']`;
	switch (mode) {
		case 'light':
			return root;
		case 'dark':
			return `${root}:not([data-theme='light'])`;
		case 'forced light':
			return `${root}[data-theme='light']`;
		case 'forced dark':
			return `${root}[data-theme='dark']`;
	}
}

/** Tokens an accent theme sets, in every one of its four blocks and nothing else (ADR-0027 §2). */
const ACCENT_TOKENS = [
	'--color-brand',
	'--color-brand-text',
	'--color-brand-soft-bg',
	'--color-brand-soft-text',
	'--color-on-brand',
	'--color-danger',
	'--color-danger-soft-bg',
	'--status-open-text',
	'--status-open-border',
	'--status-in-progress-bg',
	'--status-in-progress-text',
	'--status-waiting-bg',
	'--status-waiting-text',
	'--status-waiting-border'
].sort();

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

const blocks = parseBlocks(SOURCE);

function block(selector: string): Map<string, string> {
	const found = blocks.get(selector);
	if (!found) throw new Error(`tokens.css has no block ${selector}`);
	return colorTokens(found);
}

/** Every color token as it applies with this theme in this mode: mode block plus accent block. */
function palette(theme: Theme, mode: Mode): Map<string, string> {
	const merged = new Map(block(MODE_SELECTORS[mode]));
	if (theme !== 'petrol') {
		for (const [name, value] of block(accentSelector(theme, mode))) merged.set(name, value);
	}
	return merged;
}

function color(theme: Theme, mode: Mode, name: string): string {
	const value = palette(theme, mode).get(name);
	if (value === undefined) throw new Error(`${theme} (${mode}) does not define ${name}`);
	return value;
}

const LIGHT = MODE_SELECTORS.light;
const DARK = MODE_SELECTORS.dark;

describe('tokens.css', () => {
	it('has the four mode blocks and four blocks per accent theme', () => {
		const expected = [
			...MODES.map((mode) => MODE_SELECTORS[mode]),
			...ACCENTS.flatMap((accent) => MODES.map((mode) => accentSelector(accent, mode)))
		];
		expect([...blocks.keys()].sort()).toEqual(expected.sort());
	});

	it('defines the same color tokens in every mode block', () => {
		const names = [...block(LIGHT).keys()].sort();
		expect(names.length).toBeGreaterThan(0);
		for (const mode of MODES) {
			expect([...block(MODE_SELECTORS[mode]).keys()].sort(), mode).toEqual(names);
		}
	});

	it('defines every accent token in the mode blocks (Petrol is complete)', () => {
		for (const mode of MODES) {
			const names = [...block(MODE_SELECTORS[mode]).keys()];
			expect(
				ACCENT_TOKENS.filter((name) => !names.includes(name)),
				mode
			).toEqual([]);
		}
	});

	it.each(ACCENTS)(
		'gives the theme %s exactly the accent tokens in each of its blocks',
		(accent) => {
			for (const mode of MODES) {
				expect([...block(accentSelector(accent, mode)).keys()].sort(), mode).toEqual(ACCENT_TOKENS);
			}
		}
	);

	it.each(THEMES)('uses the same values for the default and the forced variant (%s)', (theme) => {
		expect(Object.fromEntries(palette(theme, 'forced light'))).toEqual(
			Object.fromEntries(palette(theme, 'light'))
		);
		expect(Object.fromEntries(palette(theme, 'forced dark'))).toEqual(
			Object.fromEntries(palette(theme, 'dark'))
		);
	});

	it('keeps neutral surfaces, lines and text the same in every theme', () => {
		for (const mode of MODES) {
			const neutral = [...palette('petrol', mode)].filter(
				([name]) => !ACCENT_TOKENS.includes(name)
			);
			for (const theme of ACCENTS) {
				const own = palette(theme, mode);
				expect(
					neutral.filter(([name, value]) => own.get(name) !== value),
					`${theme} (${mode})`
				).toEqual([]);
			}
		}
	});

	it('uses #rrggbb for every accent value', () => {
		for (const accent of ACCENTS) {
			for (const mode of MODES) {
				for (const [name, value] of block(accentSelector(accent, mode))) {
					expect(value, `${accent} ${mode} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
				}
			}
		}
	});

	it('defines the sizes, radii and motion of ADR-0025 once in :root and nowhere else', () => {
		const light = blocks.get(LIGHT) ?? new Map<string, string>();
		for (const [name, value] of Object.entries(NON_COLOR_TOKENS)) {
			expect(light.get(name), name).toBe(value);
		}
		for (const [selector, properties] of blocks) {
			if (selector === LIGHT) continue;
			expect([...properties.keys()].filter(isNonColorToken), selector).toEqual([]);
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
		expect(block(LIGHT).get('--color-blanket')).toBe('rgb(23 35 38 / 0.45)');
		expect(block(DARK).get('--color-blanket')).toBe('rgb(0 0 0 / 0.6)');
	});

	it('sets color-scheme in every mode block, so native controls follow the mode', () => {
		const schemes = colorSchemes(SOURCE);
		expect(schemes.get(MODE_SELECTORS.light)).toBe('light');
		expect(schemes.get(MODE_SELECTORS['forced light'])).toBe('light');
		expect(schemes.get(MODE_SELECTORS.dark)).toBe('dark');
		expect(schemes.get(MODE_SELECTORS['forced dark'])).toBe('dark');
	});

	it('has the error colors of ADR-0009 in Petrol', () => {
		expect(color('petrol', 'light', '--color-danger')).toBe('#a13a40');
		expect(color('petrol', 'light', '--color-danger-soft-bg')).toBe('#f8e9e9');
		expect(color('petrol', 'dark', '--color-danger')).toBe('#eaa0a0');
		expect(color('petrol', 'dark', '--color-danger-soft-bg')).toBe('#3b1e21');
	});

	it('has blocks for exactly the themes of the store, with Petrol first', () => {
		expect(THEMES[0]).toBe('petrol');
		const accents = [...SOURCE.matchAll(/data-accent='([a-z]+)'/g)].map((match) => match[1]);
		expect([...new Set(accents)].sort()).toEqual([...ACCENTS].sort());
	});

	it.each(MODES)('shows each theme with its own accent as the swatch (%s)', (mode) => {
		for (const theme of THEMES) {
			expect(color('petrol', mode, `--swatch-${theme}`), theme).toBe(
				color(theme, mode, '--color-brand')
			);
		}
	});
});

/** Text pairs: at least 4.5 : 1 (WCAG 1.4.3). Foreground first. */
const TEXT_PAIRS = [
	['--color-text', '--color-surface'],
	['--color-text', '--color-bg'],
	['--color-text-muted', '--color-surface'],
	['--color-text-muted', '--color-bg'],
	['--color-brand-text', '--color-surface'],
	['--color-brand-text', '--color-bg'],
	['--color-brand-text', '--color-brand-soft-bg'],
	['--color-brand-soft-text', '--color-brand-soft-bg'],
	['--color-text', '--color-brand-soft-bg'],
	['--color-text-muted', '--color-brand-soft-bg'],
	['--color-on-brand', '--color-brand'],
	['--color-danger', '--color-surface'],
	['--color-danger', '--color-bg'],
	['--color-danger', '--color-danger-soft-bg'],
	['--status-backlog-text', '--color-surface'],
	['--status-open-text', '--color-surface'],
	['--status-open-text', '--color-bg'],
	['--status-in-progress-text', '--status-in-progress-bg'],
	['--status-waiting-text', '--status-waiting-bg'],
	['--status-done-text', '--status-done-bg']
] as const;

/** UI pairs (focus ring, borders, icons, the primary button against the page): 3 : 1 (1.4.11). */
const UI_PAIRS = [
	['--color-brand', '--color-surface'],
	['--color-brand', '--color-bg'],
	['--status-open-border', '--color-surface']
] as const;

describe.each(THEMES.flatMap((theme) => MODES.map((mode) => [theme, mode] as const)))(
	'contrast of %s (%s)',
	(theme, mode) => {
		it.each(TEXT_PAIRS)('%s on %s reaches 4.5 : 1', (foreground, background) => {
			const ratio = contrast(color(theme, mode, foreground), color(theme, mode, background));
			expect(ratio).toBeGreaterThanOrEqual(4.5);
		});

		it.each(UI_PAIRS)('%s against %s reaches 3 : 1', (foreground, background) => {
			const ratio = contrast(color(theme, mode, foreground), color(theme, mode, background));
			expect(ratio).toBeGreaterThanOrEqual(3);
		});
	}
);

describe('distance of the colors (CIEDE2000, ADR-0027 section 4)', () => {
	const BASE_MODES = ['light', 'dark'] as const;

	describe.each(THEMES)('%s', (theme) => {
		it.each(BASE_MODES)('keeps the accent apart from the error color (%s)', (mode) => {
			const danger = color(theme, mode, '--color-danger');
			for (const name of ['--color-brand', '--color-brand-text', '--color-brand-soft-text']) {
				const distance = deltaE2000(color(theme, mode, name), danger);
				expect(distance, name).toBeGreaterThanOrEqual(20);
			}
		});

		it.each(BASE_MODES)('keeps the error color apart from "Wartet" (%s)', (mode) => {
			const distance = deltaE2000(
				color(theme, mode, '--color-danger'),
				color(theme, mode, '--status-waiting-text')
			);
			expect(distance).toBeGreaterThanOrEqual(15);
		});

		it.each(BASE_MODES)('keeps "Wartet" apart from "In Arbeit" (%s)', (mode) => {
			const text = deltaE2000(
				color(theme, mode, '--status-waiting-text'),
				color(theme, mode, '--status-in-progress-text')
			);
			const surface = deltaE2000(
				color(theme, mode, '--status-waiting-bg'),
				color(theme, mode, '--status-in-progress-bg')
			);
			expect(text).toBeGreaterThanOrEqual(20);
			expect(surface).toBeGreaterThanOrEqual(10);
		});
	});

	it('moves the error color of Rubin and Kupfer away from ADR-0009 and keeps it in Smaragd', () => {
		for (const mode of BASE_MODES) {
			for (const theme of ['rubin', 'kupfer'] as const) {
				expect(color(theme, mode, '--color-danger'), theme).not.toBe(
					color('petrol', mode, '--color-danger')
				);
			}
			expect(color('smaragd', mode, '--color-danger')).toBe(
				color('petrol', mode, '--color-danger')
			);
		}
	});

	describe('addendum 2026-09-27: Rubin darker, Smaragd deep, Honig becomes Kupfer, no Purpur', () => {
		it('has no blocks and no swatches of Purpur and Honig any more', () => {
			expect(SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/purpur|honig/i);
		});

		it.each(BASE_MODES)('keeps the hue of Rubin and makes it darker than before (%s)', (mode) => {
			const before = { light: '#a0174f', dark: '#ca2b70' }[mode];
			const rubin = color('rubin', mode, '--color-brand');
			expect(hslHue(rubin)).toBeGreaterThanOrEqual(330);
			expect(hslHue(rubin)).toBeLessThanOrEqual(345);
			expect(hexToLab(rubin)[0]).toBeLessThan(hexToLab(before)[0]);
		});

		it.each(BASE_MODES)('makes Smaragd clearly darker than before (%s)', (mode) => {
			const before = { light: '#13854a', dark: '#15874a' }[mode];
			const lightness = hexToLab(color('smaragd', mode, '--color-brand'))[0];
			expect(lightness).toBeLessThan(hexToLab(before)[0] - (mode === 'light' ? 10 : 2));
		});

		it('makes Kupfer a copper brown on macchiato (light) and a warm copper on espresso (dark)', () => {
			for (const mode of BASE_MODES) {
				expect(hslHue(color('kupfer', mode, '--color-brand'))).toBeGreaterThanOrEqual(15);
				expect(hslHue(color('kupfer', mode, '--color-brand'))).toBeLessThanOrEqual(30);
			}
			expect(hexToLab(color('kupfer', 'light', '--color-brand-soft-bg'))[0]).toBeGreaterThan(90);
			expect(hexToLab(color('kupfer', 'dark', '--color-brand-soft-bg'))[0]).toBeLessThan(20);
			// Dark text on the warm copper of the dark mode, as with the old Honig.
			expect(hexToLab(color('kupfer', 'dark', '--color-on-brand'))[0]).toBeLessThan(15);
			// "Wartet" stays slate, apart from the copper.
			expect(color('kupfer', 'light', '--status-waiting-text')).not.toBe(
				color('petrol', 'light', '--status-waiting-text')
			);
		});
	});

	it.each(BASE_MODES)('makes Smaragd a true green, clearly apart from Petrol (%s)', (mode) => {
		const smaragd = color('smaragd', mode, '--color-brand');
		const petrol = color('petrol', mode, '--color-brand');
		expect(hslHue(smaragd)).toBeGreaterThanOrEqual(140);
		expect(hslHue(smaragd)).toBeLessThanOrEqual(160);
		expect(hslHue(petrol)).toBeGreaterThanOrEqual(180);
		expect(hslHue(petrol)).toBeLessThanOrEqual(190);
		for (const name of ['--color-brand', '--color-brand-text']) {
			const distance = deltaE2000(color('smaragd', mode, name), color('petrol', mode, name));
			expect(distance, name).toBeGreaterThanOrEqual(20);
		}
	});

	it.each(BASE_MODES)('keeps every pair of themes apart (%s)', (mode) => {
		for (const [index, first] of THEMES.entries()) {
			for (const second of THEMES.slice(index + 1)) {
				const distance = deltaE2000(
					color(first, mode, '--color-brand'),
					color(second, mode, '--color-brand')
				);
				expect(distance, `${first} / ${second}`).toBeGreaterThanOrEqual(20);
			}
		}
	});
});
