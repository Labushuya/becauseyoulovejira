// The palette of projects and tickets (ADR-0052): one token per color of PROJECT_COLORS in each of
// the four mode blocks of tokens.css and nowhere else, the same in every theme. Stripes and dots are
// no text, so each color reaches 3 : 1 (WCAG 1.4.11) on every surface it stands on, in all 4 themes
// x 4 variants: surface (tables, tiles, cards, full view), page background (hovered rows, the list
// of open tickets), accent surface (chosen and open rows, the gradient of the page) and glass
// (head of the side panel, popovers and menus, modals on the blanket). No color counts as the red of
// errors (ADR-0009): each keeps Delta E 2000 of at least 20 from the error color of every theme, as
// the accents do (ADR-0027 section 5). And the colors stay apart from each other.

import { describe, expect, it } from 'vitest';
import { ACCENT_THEMES, type AccentTheme } from '$lib/accent.svelte';
import { PROJECT_COLORS } from '$lib/domain/colors';
import { contrast, deltaE2000 } from '$lib/test/color-math';
import {
	MODES,
	MODE_SELECTORS,
	TOKENS_SOURCE,
	accentSelector,
	customProperties,
	parseBlocks,
	type Mode
} from '$lib/test/tokens-css';

type Rgb = readonly [number, number, number];

const blocks = new Map(
	[...parseBlocks(TOKENS_SOURCE)].map(([selector, block]) => [selector, customProperties(block)])
);

function own(selector: string): Map<string, string> {
	const found = blocks.get(selector);
	if (!found) throw new Error(`tokens.css has no block ${selector}`);
	return found;
}

/** The custom properties as they apply with this theme in this mode. */
function palette(theme: AccentTheme, mode: Mode): Map<string, string> {
	const merged = new Map(own(MODE_SELECTORS[mode]));
	if (theme !== 'petrol') {
		for (const [name, value] of own(accentSelector(theme, mode))) merged.set(name, value);
	}
	return merged;
}

const token = (color: string) => `--project-color-${color}`;

function rgb(hex: string): Rgb {
	return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb;
}

function hex([r, g, b]: Rgb): string {
	return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function mix(top: Rgb, bottom: Rgb, alpha: number): Rgb {
	return [0, 1, 2].map(
		(i) => alpha * (top[i] ?? 0) + (1 - alpha) * (bottom[i] ?? 0)
	) as unknown as Rgb;
}

/** saturate() as the color matrix of Filter Effects, as in glass-contrast.test.ts. */
function saturate([r, g, b]: Rgb, s: number): Rgb {
	const clamp = (value: number) => Math.min(255, Math.max(0, value));
	return [
		clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
		clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
		clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b)
	];
}

/** "rgb(r g b / a)" of a material or the blanket. */
function translucent(value: string): { color: Rgb; alpha: number } {
	const match = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
	if (!match) throw new Error(`Not a translucent color: ${value}`);
	return { color: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) };
}

function saturation(filter: string): number {
	const match = /saturate\((\d+)%\)/.exec(filter);
	return match ? Number(match[1]) / 100 : 1;
}

const root = own(MODE_SELECTORS.light);

/**
 * Every ground a stripe or dot stands on, as opaque colors: the opaque surfaces, then the glass of
 * the side panel (regular, over page and gradient, blurred 50 : 50 with the page) and of popovers
 * and modals (thick, over page, gradient and surface, and over the blanket).
 */
function grounds(colors: Map<string, string>): [string, string][] {
	const value = (name: string) => colors.get(name) ?? root.get(name) ?? '';
	const page = rgb(value('--color-bg'));
	const list: [string, string][] = [
		['surface', value('--color-surface')],
		['page', value('--color-bg')],
		['accent surface', value('--color-brand-soft-bg')]
	];
	const regular = translucent(value('--material-regular'));
	const thick = translucent(value('--material-thick'));
	const regularFactor = saturation(value('--glass-filter-regular'));
	const thickFactor = saturation(value('--glass-filter-thick'));
	for (const ground of ['--color-bg', '--color-brand-soft-bg']) {
		const blurred = mix(rgb(value(ground)), page, 0.5);
		list.push([
			`regular glass over ${ground}`,
			hex(mix(regular.color, saturate(blurred, regularFactor), regular.alpha))
		]);
	}
	for (const ground of ['--color-bg', '--color-brand-soft-bg', '--color-surface']) {
		list.push([
			`thick glass over ${ground}`,
			hex(mix(thick.color, saturate(rgb(value(ground)), thickFactor), thick.alpha))
		]);
	}
	const veil = translucent(value('--color-blanket'));
	const veiled = mix(veil.color, page, veil.alpha);
	list.push([
		'thick glass over the blanket',
		hex(mix(thick.color, saturate(veiled, thickFactor), thick.alpha))
	]);
	return list;
}

const CASES = ACCENT_THEMES.flatMap((theme) => MODES.map((mode) => [theme, mode] as const));

describe('palette of projects and tickets in tokens.css (ADR-0052)', () => {
	it('has a token for every color of the palette in each mode block, and no other', () => {
		for (const mode of MODES) {
			const names = [...own(MODE_SELECTORS[mode]).keys()].filter((name) =>
				name.startsWith('--project-color-')
			);
			expect(names.sort(), mode).toEqual(PROJECT_COLORS.map(token).sort());
			for (const color of PROJECT_COLORS) {
				expect(own(MODE_SELECTORS[mode]).get(token(color)), `${mode} ${color}`).toMatch(
					/^#[0-9a-f]{6}$/
				);
			}
		}
	});

	it('keeps the palette out of the theme blocks: it is the same in every theme', () => {
		for (const [selector, properties] of blocks) {
			if (!selector.includes('data-accent')) continue;
			expect(
				[...properties.keys()].filter((name) => name.startsWith('--project-color-')),
				selector
			).toEqual([]);
		}
	});

	it('is lighter in dark mode than in light mode for every color', () => {
		for (const color of PROJECT_COLORS) {
			const light = palette('petrol', 'light').get(token(color)) ?? '';
			const dark = palette('petrol', 'dark').get(token(color)) ?? '';
			expect(contrast(dark, '#000000'), color).toBeGreaterThan(contrast(light, '#000000'));
		}
	});
});

describe.each(CASES)('palette in %s (%s)', (theme, mode) => {
	const colors = palette(theme, mode);
	const color = (name: string) => colors.get(token(name)) ?? '';

	it('reaches 3 : 1 on every ground a stripe or dot stands on (WCAG 1.4.11)', () => {
		const failures: string[] = [];
		for (const name of PROJECT_COLORS) {
			for (const [ground, value] of grounds(colors)) {
				const ratio = contrast(color(name), value);
				if (ratio < 3) failures.push(`${name} on ${ground}: ${ratio.toFixed(2)}`);
			}
		}
		expect(failures).toEqual([]);
	});

	it('never counts as the red of errors: Delta E 2000 of at least 20 from the error color', () => {
		const danger = colors.get('--color-danger') ?? '';
		const failures: string[] = [];
		for (const name of PROJECT_COLORS) {
			const distance = deltaE2000(color(name), danger);
			if (distance < 20) failures.push(`${name}: ${distance.toFixed(1)}`);
		}
		expect(failures).toEqual([]);
	});
});

describe('the colors of the palette stay apart from each other (Delta E 2000)', () => {
	it.each(['light', 'dark'] as const)('at least 12 between any two in %s mode', (mode) => {
		const colors = palette('petrol', mode);
		const failures: string[] = [];
		for (const [index, first] of PROJECT_COLORS.entries()) {
			for (const second of PROJECT_COLORS.slice(index + 1)) {
				const distance = deltaE2000(
					colors.get(token(first)) ?? '',
					colors.get(token(second)) ?? ''
				);
				if (distance < 12) failures.push(`${first} / ${second}: ${distance.toFixed(1)}`);
			}
		}
		expect(failures).toEqual([]);
	});
});
