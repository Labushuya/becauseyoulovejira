// Static check against form controls that grow beyond their container (docs/plan/layout-ueberlauf.md).
// A select is as wide as its longest option, "Gesundheit › Christa (CHRS)" for a sub project
// (ADR-0034); as a grid or flex item its automatic minimum width is that width, so max-width: 100%
// alone does not hold it. base.css gives every input, select and textarea min-width: 0 and
// max-width: 100% and ends long values in an ellipsis; this test keeps those rules there and
// makes sure no component takes them back. jsdom lays nothing out, so a test on the rendered
// element could not see the overflow; the cause, however, is purely declarative, and these rules
// are exactly what removes it (measured once in Chromium, see the plan). The effect in the
// browser is the manual case BYL-E6-382 of the test manifest.
//
// Since the fix of renaming in a channel card (plan §6): a flex row that holds a field and
// buttons (or a group of buttons inside such a row) must wrap, and the channel card and its
// details are one column that cannot grow beyond the card. Otherwise the row has all its items
// side by side as minimum width, and the auto column of the card grid takes that width for every
// row of the card and the page (measured in Chromium: 402 px header in a 263 px card).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');
const BASE_CSS = join('lib', 'styles', 'base.css');

function files(dir: string, pattern: RegExp): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path, pattern);
		return pattern.test(entry.name) ? [path] : [];
	});
}

/** The CSS of a file: the <style> block of a component or the whole CSS file, without comments. */
function css(source: string, path: string): string {
	const style = path.endsWith('.svelte')
		? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
		: source;
	return style.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Innermost rules of a style sheet as [selector list, declarations]. */
function rules(style: string): [string, string][] {
	return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [
		(match[1] ?? '').trim(),
		match[2] ?? ''
	]);
}

/** The selectors of a selector list, split at commas outside of parentheses. */
function selectors(list: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const char of list) {
		if (char === '(') depth += 1;
		if (char === ')') depth -= 1;
		if (char === ',' && depth === 0) {
			parts.push(current.trim());
			current = '';
		} else {
			current += char;
		}
	}
	parts.push(current.trim());
	return parts.filter(Boolean);
}

/** The last compound of a selector, without :global(…) around it and without :not(…). */
function lastCompound(selector: string): string {
	const plain = selector.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1');
	const last =
		plain
			.trim()
			.split(/\s+|>|\+|~/)
			.filter(Boolean)
			.at(-1) ?? '';
	return last.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
}

/** Static classes the markup of a component puts on an input, select or textarea. */
function controlClasses(source: string): string[] {
	const markup = source.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
	return [...markup.matchAll(/<(?:input|select|textarea)\b[^<>]*?\sclass="([^"{}]*)"/g)].flatMap(
		(match) => (match[1] ?? '').split(/\s+/).filter(Boolean)
	);
}

/** Whether a selector reaches an input, select or textarea by its tag or by a class of one. */
function reachesControl(selector: string, classes: readonly string[]): boolean {
	const last = lastCompound(selector);
	if (/^(?:input|select|textarea)\b/.test(last)) return true;
	return classes.some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(last));
}

/** A limit that still lets the control shrink with its container. */
const MIN_WIDTH_OK = /^(?:0|min\([^()]+,\s*100%\))$/;
const MAX_WIDTH_OK = /^(?:100%|min\([^()]+,\s*100%\))$/;

function declared(body: string, property: string): string[] {
	return [...body.matchAll(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`, 'g'))].map(
		(match) => (match[1] ?? '').trim()
	);
}

/** First arguments of minmax(…) in repeat(auto-fill|auto-fit, …): the minimum of a tile. */
function tileMinimums(style: string): string[] {
	return [...style.matchAll(/repeat\(\s*auto-(?:fill|fit)\s*,\s*minmax\(/g)].map((match) => {
		let depth = 0;
		let argument = '';
		for (const char of style.slice((match.index ?? 0) + match[0].length)) {
			if (char === ',' && depth === 0) break;
			if (char === '(') depth += 1;
			if (char === ')') depth -= 1;
			argument += char;
		}
		return argument.trim();
	});
}

const SOURCES = [...files(SRC_DIR, /\.svelte$/), ...files(SRC_DIR, /\.css$/)]
	.map((path) => relative(SRC_DIR, path))
	.filter((path) => path !== BASE_CSS)
	.sort();

describe('base.css keeps form controls inside their container', () => {
	const base = css(readFileSync(join(SRC_DIR, BASE_CSS), 'utf8'), BASE_CSS);
	/** Declarations of the first rule with exactly this selector list. */
	const rule = (selector: string) =>
		rules(base).find(
			([list]) => selectors(list).join(',') === selectors(selector).join(',')
		)?.[1] ?? '';

	it('gives every input, select and textarea min-width: 0 and max-width: 100%', () => {
		const body = rule('input, select, textarea');
		expect(body).toMatch(/min-width:\s*0\s*;/);
		expect(body).toMatch(/max-width:\s*100%\s*;/);
	});

	it('ends a long value of a select or a text field in an ellipsis', () => {
		expect(rule("select, input:not([type='checkbox'], [type='radio'])")).toMatch(
			/text-overflow:\s*ellipsis/
		);
	});

	it('lets a fieldset and the search field shrink', () => {
		expect(rule('fieldset')).toMatch(/min-width:\s*0\s*;/);
		const search = rule('.search-field');
		expect(search).toMatch(/min-width:\s*0\s*;/);
		expect(search).toMatch(/max-width:\s*100%\s*;/);
	});
});

describe('components keep the limits of base.css', () => {
	it('finds the component styles', () => {
		expect(SOURCES.length).toBeGreaterThan(50);
		expect(SOURCES).toContain(join('lib', 'components', 'TicketFields.svelte'));
		expect(SOURCES).not.toContain(BASE_CSS);
	});

	it.each(SOURCES)('%s sets no min-width or max-width that lets a control overflow', (path) => {
		const source = readFileSync(join(SRC_DIR, path), 'utf8');
		const classes = controlClasses(source);
		for (const [list, body] of rules(css(source, path))) {
			const reaching = selectors(list).filter((selector) => reachesControl(selector, classes));
			if (reaching.length === 0) continue;
			for (const value of declared(body, 'min-width')) {
				expect(value, `${path}: ${reaching.join(', ')}`).toMatch(MIN_WIDTH_OK);
			}
			for (const value of declared(body, 'max-width')) {
				expect(value, `${path}: ${reaching.join(', ')}`).toMatch(MAX_WIDTH_OK);
			}
		}
	});

	it.each(SOURCES)('%s lets the columns of a tile grid shrink below their minimum', (path) => {
		const style = css(readFileSync(join(SRC_DIR, path), 'utf8'), path);
		for (const minimum of tileMinimums(style)) {
			expect(minimum, path).toMatch(/^min\([^()]+,\s*100%\)$/);
		}
	});

	it('knows which selectors reach a control', () => {
		expect(reachesControl('.fields :global(select)', [])).toBe(true);
		expect(reachesControl(".field input:not([type='date'])", [])).toBe(true);
		expect(reachesControl('.rename input', [])).toBe(true);
		expect(reachesControl('.number', ['number'])).toBe(true);
		expect(reachesControl('.number-row', ['number'])).toBe(false);
		expect(reachesControl('.select', [])).toBe(false);
		expect(reachesControl('.search-field', [])).toBe(false);
		expect(controlClasses('<input id="a" class="number wide" type="number" />')).toEqual([
			'number',
			'wide'
		]);
		expect(tileMinimums('grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));')).toEqual([
			'16rem'
		]);
		expect(tileMinimums('repeat(auto-fit, minmax(min(18rem, 100%), 1fr))')).toEqual([
			'min(18rem, 100%)'
		]);
		expect('min(10rem, 100%)').toMatch(MIN_WIDTH_OK);
		expect('10rem').not.toMatch(MIN_WIDTH_OK);
		expect('none').not.toMatch(MAX_WIDTH_OK);
	});
});

// --- Flex rows with a field and buttons (plan §6, renaming a channel in its card) ---------------

/** An element of the markup of a component: tag, static classes, type and children. */
interface MarkupNode {
	tag: string;
	classes: string[];
	type: string;
	children: MarkupNode[];
}

const VOID_TAGS = new Set([
	'area',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr'
]);

/** Index after a Svelte expression `{…}` that starts at `start`, strings inside skipped. */
function skipExpression(source: string, start: number): number {
	let depth = 0;
	for (let i = start; i < source.length; i += 1) {
		const char = source[i];
		if (char === '"' || char === "'" || char === '`') {
			const end = source.indexOf(char, i + 1);
			i = end === -1 ? source.length : end;
		} else if (char === '{') {
			depth += 1;
		} else if (char === '}') {
			depth -= 1;
			if (depth === 0) return i + 1;
		}
	}
	return source.length;
}

/** Value of a static attribute in the text of a start tag, '' when missing or dynamic. */
function attribute(tag: string, name: string): string {
	const match = new RegExp(`\\s${name}="([^"{}]*)"`).exec(tag);
	return match?.[1] ?? '';
}

/** Index of the end ">" of the start tag at `start`, expressions and quoted values skipped. */
function startTagEnd(markup: string, start: number): number {
	let end = start + 1;
	while (end < markup.length && markup[end] !== '>') {
		const char = markup[end];
		if (char === '{') {
			end = skipExpression(markup, end);
		} else if (char === '"' || char === "'") {
			const close = markup.indexOf(char, end + 1);
			end = close === -1 ? markup.length : close + 1;
		} else {
			end += 1;
		}
	}
	return end;
}

/**
 * The element tree of the markup of a component (script, style and comments left out). Svelte
 * expressions in text and attributes are skipped; classes are the static ones plus class:name.
 */
function markupTree(source: string): MarkupNode {
	const markup = source
		.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
		.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '');
	const root: MarkupNode = { tag: '#root', classes: [], type: '', children: [] };
	const stack: MarkupNode[] = [root];
	let i = 0;
	while (i < markup.length) {
		const char = markup[i];
		const next = markup[i + 1] ?? '';
		if (char === '{') {
			i = skipExpression(markup, i);
		} else if (char === '<' && next === '/') {
			const end = markup.indexOf('>', i);
			const name = markup.slice(i + 2, end).trim();
			const at = stack.findLastIndex((node) => node.tag === name);
			if (at > 0) stack.length = at;
			i = end + 1;
		} else if (char === '<' && /[A-Za-z]/.test(next)) {
			const end = startTagEnd(markup, i);
			const tag = markup.slice(i, end + 1);
			const name = /^<([A-Za-z][\w.-]*)/.exec(tag)?.[1] ?? '';
			const node: MarkupNode = {
				tag: name,
				classes: [
					...attribute(tag, 'class').split(/\s+/).filter(Boolean),
					...[...tag.matchAll(/\sclass:([\w-]+)/g)].map((match) => match[1] ?? '')
				],
				type: attribute(tag, 'type'),
				children: []
			};
			stack.at(-1)?.children.push(node);
			if (!tag.endsWith('/>') && !VOID_TAGS.has(name)) stack.push(node);
			i = end + 1;
		} else {
			i += 1;
		}
	}
	return root;
}

function descendants(node: MarkupNode): MarkupNode[] {
	return node.children.flatMap((child) => [child, ...descendants(child)]);
}

/** A control to type or choose a value in: text-like inputs, selects and text areas. */
function isTextControl(node: MarkupNode): boolean {
	if (node.tag === 'select' || node.tag === 'textarea') return true;
	return node.tag === 'input' && !['checkbox', 'radio', 'hidden'].includes(node.type);
}

/** Classes a component lays out as a flex row, and whether one of its rules lets the row wrap. */
function flexRows(style: string): Map<string, boolean> {
	const rows = new Map<string, boolean>();
	const wraps = new Set<string>();
	for (const [list, body] of rules(style)) {
		const flex = /(?:^|[;\s])display\s*:\s*(?:inline-)?flex\s*(?:;|$)/.test(body);
		const wrap =
			/(?:^|[;\s])flex-wrap\s*:\s*wrap/.test(body) ||
			/(?:^|[;\s])flex-flow\s*:[^;]*\bwrap\b/.test(body);
		for (const selector of selectors(list)) {
			const names = [...lastCompound(selector).matchAll(/\.([\w-]+)/g)].map(
				(match) => match[1] ?? ''
			);
			for (const name of names) {
				if (flex && !rows.has(name)) rows.set(name, false);
				if (wrap) wraps.add(name);
			}
		}
	}
	for (const name of rows.keys()) rows.set(name, wraps.has(name));
	return rows;
}

/**
 * Flex rows of a component that hold a field and buttons, or a group of text buttons inside such
 * a row, but never wrap: [class, what it holds]. Such a row has all its items side by side as its
 * minimum width, and a grid with an auto column around it takes that width for every row. Icon
 * buttons (2rem each) may stay together; components inside the row (ProjectSelect, TagPicker …)
 * are not looked into.
 */
function rigidRows(source: string, path: string): [string, string][] {
	const rows = flexRows(css(source, path));
	const found: [string, string][] = [];
	const visit = (node: MarkupNode, insideFieldRow: boolean) => {
		const below = descendants(node);
		const flexClass = node.classes.find((name) => rows.has(name));
		const fieldRow = below.some(isTextControl) && below.some((child) => child.tag === 'button');
		const buttonGroup =
			below.filter((child) => child.tag === 'button' && !child.classes.includes('button-icon'))
				.length >= 2;
		if (flexClass !== undefined && rows.get(flexClass) !== true) {
			if (fieldRow) found.push([flexClass, 'a field and buttons']);
			else if (insideFieldRow && buttonGroup) found.push([flexClass, 'buttons beside a field']);
		}
		for (const child of node.children) {
			visit(child, insideFieldRow || (flexClass !== undefined && fieldRow));
		}
	};
	visit(markupTree(source), false);
	return found;
}

const COMPONENTS = SOURCES.filter((path) => path.endsWith('.svelte'));

describe('flex rows with a field and buttons wrap', () => {
	it.each(COMPONENTS)('%s lets its rows of fields and buttons wrap', (path) => {
		const source = readFileSync(join(SRC_DIR, path), 'utf8');
		expect(rigidRows(source, path), path).toEqual([]);
	});

	it('finds the rows that do not wrap', () => {
		const rigid = `<form class="rename"><input type="text" /><span class="actions"><button>A</button><button>B</button></span></form>
			<style>.rename { display: flex; } .actions { display: inline-flex; }</style>`;
		expect(rigidRows(rigid, 'Row.svelte')).toEqual([
			['rename', 'a field and buttons'],
			['actions', 'buttons beside a field']
		]);
		const group = `<form class="rename"><input bind:value={x} onkeydown={(e) => e.key === 'a' && go()} /><span class="actions"><button>A</button><button>B</button></span></form>
			<style>.rename { display: flex; flex-wrap: wrap; } .actions { display: inline-flex; }</style>`;
		expect(rigidRows(group, 'Row.svelte')).toEqual([['actions', 'buttons beside a field']]);
		const fine = `<div class="row" class:busy><input type="text" /><button>A</button><span class="moves"><button class="button-icon">↑</button><button class="button-icon">↓</button></span></div>
			<label class="check"><input type="checkbox" /> <button>Hilfe</button></label>
			{#if a < b}<span>{'<'}</span>{/if}
			<style>.row { display: flex; flex-flow: row wrap; } .moves, .check { display: flex; }</style>`;
		expect(rigidRows(fine, 'Row.svelte')).toEqual([]);
		expect(markupTree(fine).children.map((node) => node.classes)).toEqual([
			['row', 'busy'],
			['check'],
			[]
		]);
	});
});

describe('channel cards keep their width (plan §6)', () => {
	const card = css(
		readFileSync(join(SRC_DIR, 'lib', 'components', 'channels', 'ChannelCard.svelte'), 'utf8'),
		'ChannelCard.svelte'
	);
	const body = (selector: string) => rules(card).find(([list]) => list === selector)?.[1] ?? '';

	it('lays the card and its details out in one column that cannot grow beyond the card', () => {
		for (const selector of ['.channel-card', '.details']) {
			expect(body(selector), selector).toMatch(/display:\s*grid/);
			expect(body(selector), selector).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
		}
	});

	it('lets the header wrap, so the field of renaming does not push the lozenge out', () => {
		expect(body('.head')).toMatch(/flex-wrap:\s*wrap/);
		expect(body('.names')).toMatch(/min-width:\s*0/);
		expect(body('.rename')).toMatch(/flex-wrap:\s*wrap/);
		expect(body('.rename-actions')).toMatch(/flex-wrap:\s*wrap/);
	});
});

describe('popovers stay inside the viewport', () => {
	const popover = css(
		readFileSync(join(SRC_DIR, 'lib', 'components', 'overlay', 'Popover.svelte'), 'utf8'),
		'Popover.svelte'
	);
	const body = rules(popover).find(([list]) => list === '.popover')?.[1] ?? '';

	it('limits the width to the viewport and lets long entries wrap, even from a nowrap cell', () => {
		expect(body).toMatch(/max-width:\s*calc\(100vw - 1rem\)/);
		expect(body).toMatch(/white-space:\s*normal/);
	});
});
