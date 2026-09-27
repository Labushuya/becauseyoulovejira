// Contrast on glass (ADR-0029 section 5): for every theme of the store, every mode block and every
// material, text stays readable whatever lies behind the glass. The effective background is
// alpha * material + (1 - alpha) * saturate(B); B runs over every color of the palette. "thick"
// lets B act in full (a menu above a primary button), "regular" mixes B 50 : 50 with the page
// background first (the blur model: 24px never let text below the header shine through as a full
// area). The focus ring is --color-brand-text since ADR-0029, so it counts as text here. The
// background gradient runs from --color-bg to --color-brand-soft-bg, so what stands on the page
// must reach its contrast on the accent surface as well.

import { describe, expect, it } from 'vitest';
import { ACCENT_THEMES, type AccentTheme } from '$lib/accent.svelte';
import { contrast } from '$lib/test/color-math';
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

const blocks = parseBlocks(TOKENS_SOURCE);

function own(selector: string): Map<string, string> {
	const found = blocks.get(selector);
	if (!found) throw new Error(`tokens.css has no block ${selector}`);
	return customProperties(found);
}

/** The custom properties as they apply with this theme in this mode. */
function palette(theme: AccentTheme, mode: Mode): Map<string, string> {
	const merged = new Map(own(MODE_SELECTORS[mode]));
	if (theme !== 'petrol') {
		for (const [name, value] of own(accentSelector(theme, mode))) merged.set(name, value);
	}
	return merged;
}

function rgb(hex: string): Rgb {
	return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb;
}

function hex([r, g, b]: Rgb): string {
	return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

/** "rgb(r g b / a)" of a material: its color and its opacity. */
function material(value: string): { color: Rgb; alpha: number } {
	const match = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
	if (!match) throw new Error(`Not a material: ${value}`);
	return { color: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) };
}

/** The saturate() factor of a glass filter such as "blur(24px) saturate(140%)". */
function saturation(filter: string): number {
	const match = /saturate\((\d+)%\)/.exec(filter);
	return match ? Number(match[1]) / 100 : 1;
}

/** saturate() as the fixed color matrix of Filter Effects (feColorMatrix type="saturate"). */
function saturate([r, g, b]: Rgb, s: number): Rgb {
	const clamp = (value: number) => Math.min(255, Math.max(0, value));
	return [
		clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
		clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
		clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b)
	];
}

function mix(top: Rgb, bottom: Rgb, alpha: number): Rgb {
	return [0, 1, 2].map(
		(i) => alpha * (top[i] ?? 0) + (1 - alpha) * (bottom[i] ?? 0)
	) as unknown as Rgb;
}

const MATERIALS = [
	{ name: '--material-regular', filter: '--glass-filter-regular', blurModel: true },
	{ name: '--material-thick', filter: '--glass-filter-thick', blurModel: false }
] as const;

/** Must reach 4.5 : 1 on glass and on the gradient; the focus ring (brand text) included. */
const TEXT_ON_GLASS = [
	'--color-text',
	'--color-text-muted',
	'--color-brand-text',
	'--color-danger'
] as const;

/** Stands on the page and therefore on the gradient as well: 4.5 : 1 on the accent surface. */
const TEXT_ON_PAGE = [
	'--color-text',
	'--color-text-muted',
	'--color-brand-text',
	'--color-danger',
	'--status-open-text',
	'--status-backlog-text'
] as const;

const root = own(MODE_SELECTORS.light);

const CASES = ACCENT_THEMES.flatMap((theme) => MODES.map((mode) => [theme, mode] as const));

describe.each(CASES)('glass in %s (%s)', (theme, mode) => {
	const colors = palette(theme, mode);
	const value = (name: string) => {
		const found = colors.get(name) ?? root.get(name);
		if (found === undefined) throw new Error(`${theme} (${mode}) does not define ${name}`);
		return found;
	};
	const backgrounds = [...colors].filter(([, token]) => /^#[0-9a-f]{6}$/.test(token));

	it.each(MATERIALS)('keeps text readable on $name over every color of the palette', (glass) => {
		const { color, alpha } = material(value(glass.name));
		expect(alpha).toBeGreaterThanOrEqual(0.82);
		const factor = saturation(value(glass.filter));
		expect(factor).toBeLessThanOrEqual(1.5);
		const page = rgb(value('--color-bg'));
		const failures: string[] = [];
		for (const [behindName, behind] of backgrounds) {
			const blurred = glass.blurModel ? mix(rgb(behind), page, 0.5) : rgb(behind);
			const effective = hex(mix(color, saturate(blurred, factor), alpha));
			for (const text of TEXT_ON_GLASS) {
				const ratio = contrast(value(text), effective);
				if (ratio < 4.5) failures.push(`${text} over ${behindName}: ${ratio.toFixed(2)}`);
			}
		}
		expect(failures).toEqual([]);
	});

	it('keeps what stands on the page readable on the gradient (accent surface)', () => {
		const surface = value('--color-brand-soft-bg');
		for (const text of TEXT_ON_PAGE) {
			expect(contrast(value(text), surface), text).toBeGreaterThanOrEqual(4.5);
		}
	});
});

describe('tokens of the glass', () => {
	it('uses no brightness() in a glass filter and saturates at most 150 %', () => {
		for (const name of ['--glass-filter-regular', '--glass-filter-thick']) {
			const filter = root.get(name) ?? '';
			expect(filter, name).not.toMatch(/brightness/);
			expect(saturation(filter), name).toBeLessThanOrEqual(1.5);
			const blur = /blur\((\d+)px\)/.exec(filter);
			expect(Number(blur?.[1]), name).toBeLessThanOrEqual(30);
		}
	});
});
