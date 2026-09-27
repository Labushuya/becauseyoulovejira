// Reads web/src/lib/styles/tokens.css for the token tests (CLAUDE.md section 8, ADR-0027, ADR-0029):
// the rule blocks with their declarations, keyed by selector. A block inside an at-rule carries the
// at-rule in its key (for example "@media (forced-colors: active) :root"), except the media query of
// the dark mode, whose blocks keep their plain selector. Only tests use it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TOKENS_SOURCE = readFileSync(
	join(import.meta.dirname, '..', 'styles', 'tokens.css'),
	'utf8'
);

export type Mode = 'light' | 'dark' | 'forced light' | 'forced dark';

export const MODES: readonly Mode[] = ['light', 'dark', 'forced light', 'forced dark'];

export const MODE_SELECTORS: Record<Mode, string> = {
	light: ':root',
	dark: ":root:not([data-theme='light'])",
	'forced light': ":root[data-theme='light']",
	'forced dark': ":root[data-theme='dark']"
};

/** The media query of the dark mode; its blocks are keyed by their selector alone. */
const DARK_MODE_MEDIA = '@media (prefers-color-scheme: dark)';

/**
 * The blocks of the switch point "opaque" (ADR-0029 section 6). Each one sets the materials to the
 * surface, the glass filters to none and switches the background gradient off. The first one is
 * the switch "Transparenz" (G-3), the others follow the system and the browser.
 */
export const OPAQUE_BLOCKS = [
	":root[data-transparency='off']",
	'@media (prefers-reduced-transparency: reduce) :root',
	'@media (prefers-contrast: more) :root',
	'@media (forced-colors: active) :root',
	'@supports not (backdrop-filter: blur(1px)) :root'
] as const;

export function accentSelector(accent: string, mode: Mode): string {
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

/** Every innermost rule block with all its declarations (custom properties and others). */
export function parseBlocks(css: string): Map<string, Map<string, string>> {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const blocks = new Map<string, Map<string, string>>();
	const preludes: string[] = [];
	let start = 0;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === '{') {
			preludes.push(text.slice(start, index).trim());
			start = index + 1;
		} else if (char === '}') {
			const prelude = preludes.pop();
			if (prelude !== undefined && !prelude.startsWith('@')) {
				const declarations = new Map<string, string>();
				for (const [, name = '', value = ''] of text
					.slice(start, index)
					.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
					// Values that Prettier wraps (the font stack) count as one line.
					declarations.set(name, value.trim().replace(/\s+/g, ' '));
				}
				const context = preludes.filter((outer) => outer !== DARK_MODE_MEDIA);
				blocks.set([...context, prelude].join(' '), declarations);
			}
			start = index + 1;
		}
	}
	return blocks;
}

/** Only the custom properties of a block. */
export function customProperties(block: Map<string, string>): Map<string, string> {
	return new Map([...block].filter(([name]) => name.startsWith('--')));
}
