// Static check for CLAUDE.md section 8: color values live only in tokens.css. Every other
// stylesheet and component uses the custom properties (plus transparent, currentColor, inherit).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// import.meta.dirname: under jsdom, URL is the jsdom class, which node:url does not accept.
const SRC_DIR = resolve(import.meta.dirname, '..', '..');
const TOKENS = join(SRC_DIR, 'lib', 'styles', 'tokens.css');

// CSS named colors (CSS Color Module Level 4), without the allowed keywords transparent,
// currentcolor and inherit.
const NAMED_COLORS = new Set(
	(
		'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
		'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
		'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
		'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
		'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
		'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
		'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
		'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
		'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
		'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
		'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
		'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
		'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
		'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
		'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
		'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
		'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
		'yellowgreen ' +
		// System colors
		'accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas ' +
		'canvastext field fieldtext graytext highlight highlighttext linktext mark marktext ' +
		'selecteditem selecteditemtext visitedtext'
	).split(' ')
);

const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const HEX_COLOR = /#[0-9a-f]{3,8}\b/i;
// SVG presentation attributes and inline styles in component markup.
const COLOR_ATTRIBUTE =
	/\b(?:fill|stroke|stop-color|flood-color|lighting-color|color|style)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** Values of all declarations in a piece of CSS, without comments and strings. */
function declarationValues(css: string): string[] {
	const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
	return [...cleaned.matchAll(/[\w-]+\s*:\s*([^;{}]+)(?=[;}])/g)].map((match) => match[1] ?? '');
}

/** Color literals found in one CSS value or attribute value. */
function colorLiterals(value: string): string[] {
	const found: string[] = [];
	const hex = HEX_COLOR.exec(value);
	if (hex) found.push(hex[0]);
	const fn = COLOR_FUNCTION.exec(value);
	if (fn) found.push(fn[0]);
	// Custom property names and var() references are no literals.
	const words = value.replace(/--[\w-]+/g, ' ').match(/[a-z]+/gi) ?? [];
	for (const word of words) {
		if (NAMED_COLORS.has(word.toLowerCase())) found.push(word);
	}
	return found;
}

/** Color literals of a stylesheet or a Svelte component (style blocks and color attributes). */
function findColorLiterals(source: string, kind: 'css' | 'svelte'): string[] {
	const values: string[] = [];
	if (kind === 'css') {
		values.push(...declarationValues(source));
	} else {
		for (const [, css = ''] of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
			values.push(...declarationValues(css));
		}
		const markup = source.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
		for (const [, doubleQuoted, singleQuoted] of markup.matchAll(COLOR_ATTRIBUTE)) {
			values.push(doubleQuoted ?? singleQuoted ?? '');
		}
	}
	return values.flatMap(colorLiterals);
}

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(svelte|css)$/.test(entry.name) ? [path] : [];
	});
}

const files = sourceFiles(SRC_DIR).filter((path) => path !== TOKENS);

describe('color literals outside tokens.css', () => {
	it('finds the stylesheets and components', () => {
		expect(files.some((path) => path.endsWith('base.css'))).toBe(true);
		expect(files.some((path) => path.endsWith('+page.svelte'))).toBe(true);
	});

	it.each(files.map((path) => [relative(SRC_DIR, path), path]))('%s has none', (_name, path) => {
		const kind = path.endsWith('.css') ? 'css' : 'svelte';
		expect(findColorLiterals(readFileSync(path, 'utf8'), kind)).toEqual([]);
	});
});

describe('findColorLiterals', () => {
	it.each([
		['a { color: #fff; }', '#fff'],
		['a { border: 1px solid #07838F; }', '#07838F'],
		['a { background: rgb(0 0 0 / 50%); }', 'rgb('],
		['a { color: hsl(10 20% 30%); }', 'hsl('],
		['a { box-shadow: 0 0 2px oklch(0.5 0.1 200); }', 'oklch('],
		['a { color: Red; }', 'Red'],
		['a { outline: 2px solid white }', 'white']
	])('reports %s', (css, literal) => {
		expect(findColorLiterals(css, 'css')).toEqual([literal]);
	});

	it('accepts tokens and the allowed keywords', () => {
		const css = `
			/* red comment */
			a { color: var(--color-danger); background: transparent; fill: currentColor; }
			b { color: inherit; font-family: 'Red Hat'; animation: spin 1s; white-space: nowrap; }
			c:hover { border-color: var(--color-line, transparent); }`;
		expect(findColorLiterals(css, 'css')).toEqual([]);
	});

	it('checks style blocks and color attributes of components, not the rest of the markup', () => {
		const component = `
			{#each items as item (item.id)}<a href="#add">rot, red</a>{/each}
			<svg><path fill="none" stroke="currentColor" /><circle fill="black" /></svg>
			<p style="color: #123456">Text</p>
			<style>p { color: var(--color-text); background: navy; }</style>`;
		expect(findColorLiterals(component, 'svelte')).toEqual(['navy', 'black', '#123456']);
	});
});
