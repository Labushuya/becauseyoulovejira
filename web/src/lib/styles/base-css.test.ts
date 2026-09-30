// Static checks of base.css for the overlay foundation (ADR-0025 section 2; plan UI-Konsistenz,
// package UI-1): scroll lock without script, reserved scrollbar room, reduced motion for every
// overlay, the shared buttons; since ADR-0029 the background gradient on a fixed layer, shadows
// only as tokens and the focus ring in the accent as text. jsdom has no layout, so the effect
// itself is a manual case (BYL-E6-002, BYL-E6-012, BYL-E6-102).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(import.meta.dirname, 'base.css'), 'utf8').replace(
	/\/\*[\s\S]*?\*\//g,
	''
);

/** Declarations of the first rule with exactly this selector list. */
function rule(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
	const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(SOURCE);
	if (!match) throw new Error(`base.css has no rule ${selector}`);
	return match[1] ?? '';
}

describe('base.css', () => {
	it('keeps the room of the scrollbar and locks scrolling while a modal dialog is open', () => {
		expect(rule('html')).toMatch(/scrollbar-gutter:\s*stable/);
		expect(rule('html:has(dialog:modal)')).toMatch(/overflow:\s*hidden/);
	});

	it('switches off the motion of overlays for reduced motion', () => {
		const media = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(
			SOURCE
		);
		expect(media?.[1]).toMatch(/\[data-overlay\],\s*\[data-overlay\]::backdrop/);
		expect(media?.[1]).toMatch(/animation:\s*none\s*!important/);
		expect(media?.[1]).toMatch(/transition:\s*none\s*!important/);
	});

	it('has the shared buttons with the radius token', () => {
		expect(rule('.button-secondary,\n.button-subtle,\n.button-icon')).toMatch(
			/border-radius:\s*var\(--radius-control\)/
		);
		expect(rule('.button-secondary')).toMatch(/border:\s*1px solid var\(--color-line\)/);
		expect(rule('.button-icon')).toMatch(/width:\s*2rem/);
	});

	it('draws the gradient of ADR-0029 on a fixed layer, only there and only from the accent surface', () => {
		const layer = rule('body::before');
		expect(layer).toMatch(/position:\s*fixed/);
		expect(layer).toMatch(/z-index:\s*-1/);
		expect(layer).toMatch(/pointer-events:\s*none/);
		expect(layer).toMatch(/background-color:\s*var\(--color-bg\)/);
		// The opaque blocks of tokens.css switch it off through --backdrop-image.
		expect(layer).toMatch(/background-image:\s*var\(\s*--backdrop-image,/);
		const fromAccent = SOURCE.match(
			/radial-gradient\([^()]*var\(--color-brand-soft-bg\),\s*transparent [^()]*\)/g
		);
		expect(fromAccent).toHaveLength(2);
		// Besides the background only the mask that fades folded comments out (ADR-0044 §3): it paints
		// no colour, only the alpha of the gradient counts.
		expect(SOURCE.match(/gradient\(/g)).toHaveLength(3);
		expect(rule('.fade-end')).toMatch(
			/mask-image:\s*linear-gradient\(to bottom, var\(--color-text\) calc\(100% - 3rem\), transparent\)/
		);
		expect(SOURCE).not.toMatch(/background-attachment/);
		// The page shows the background of html; body paints none, so the layer stays visible.
		expect(rule('body')).not.toMatch(/background/);
	});

	it('uses shadows only as tokens and no glass (ADR-0029 sections 1 and 4)', () => {
		for (const [, value = ''] of SOURCE.matchAll(/box-shadow:\s*([^;]+);/g)) {
			expect(value.trim()).toMatch(/^var\(--shadow-(control|popover|modal)\)$/);
		}
		expect(SOURCE).not.toMatch(/backdrop-filter/);
	});

	it('draws the focus ring in the accent as text (ADR-0029 section 5)', () => {
		expect(rule(':focus-visible')).toMatch(/outline:\s*2px solid var\(--color-brand-text\)/);
	});
});
