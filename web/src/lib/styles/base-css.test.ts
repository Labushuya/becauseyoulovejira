// Static checks of base.css for the overlay foundation (ADR-0025 section 2; plan UI-Konsistenz,
// package UI-1): scroll lock without script, reserved scrollbar room, reduced motion for every
// overlay, the shared buttons, and no shadows. jsdom has no layout, so the effect itself is a
// manual case (BYL-E6-002, BYL-E6-012).

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

	it('uses no shadows, gradients or glass effects (ADR-0010 section 3)', () => {
		expect(SOURCE).not.toMatch(/box-shadow|gradient|backdrop-filter/);
	});
});
