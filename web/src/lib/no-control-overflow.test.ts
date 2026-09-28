// Static check against form controls that grow beyond their container (docs/plan/layout-ueberlauf.md).
// A select is as wide as its longest option, "Gesundheit › Christa (CHRS)" for a sub project
// (ADR-0034); as a grid or flex item its automatic minimum width is that width, so max-width: 100%
// alone does not hold it. base.css gives every input, select and textarea min-width: 0 and
// max-width: 100% and ends long values in an ellipsis; this test keeps those rules there and
// makes sure no component takes them back. jsdom lays nothing out, so a test on the rendered
// element could not see the overflow; the cause, however, is purely declarative, and these rules
// are exactly what removes it (measured once in Chromium, see the plan). The effect in the
// browser is the manual case BYL-E6-382 of the test manifest.

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
