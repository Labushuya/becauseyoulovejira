// Static check for testing feedback package A, item 6: checkboxes and radios look the same in the
// whole app. base.css styles them once (appearance: none, tokens, accent of the theme, focus ring,
// checked, indeterminate, disabled, forced colors); components give them at most a place in their
// layout (grid, margin, order), never an own size, color, border or appearance. Checked in every
// component style and every CSS file except base.css.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');
const BASE_CSS = join('lib', 'styles', 'base.css');

/**
 * The one exception: the chips of ChipGroup are radios that lie invisible over the whole chip
 * (opacity 0, full size), so the chip itself shows the choice and the focus.
 */
const HIDDEN_RADIOS = [join('lib', 'components', 'ChipGroup.svelte')];

function files(dir: string, pattern: RegExp): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path, pattern);
		return pattern.test(entry.name) ? [path] : [];
	});
}

/** The CSS of a file: the <style> block of a component or the whole CSS file, without comments. */
function css(path: string): string {
	const source = readFileSync(path, 'utf8');
	const style = path.endsWith('.svelte')
		? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
		: source;
	return style.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Innermost rules of a style sheet as [selector, declarations]. */
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

/** Whether a component renders a checkbox or a radio itself. */
function rendersControl(path: string): boolean {
	return /type=["'](?:checkbox|radio)["']/.test(
		readFileSync(join(SRC_DIR, path), 'utf8').replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
	);
}

/** A selector (one part of a list) without the parts inside :not(…), which only exclude. */
function withoutNot(selector: string): string {
	return selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
}

/** Types of input that are no checkbox and no radio, named in a selector. */
const OTHER_INPUT_TYPE = /\binput\[type=['"]?(?!checkbox|radio)[a-z-]+['"]?\]/;
const CONTROL_TYPE = /\[type=['"]?(?:checkbox|radio)['"]?\]/;
/** Properties that make up the look of a control. */
const LOOK =
	/(?:^|[;\s])(accent-color|appearance|width|height|background(?:-color)?|border(?:-[a-z-]+)?|clip-path)\s*:/;

/**
 * Whether a selector may reach a checkbox or radio: its last compound is an input that neither
 * excludes both types with :not(…) nor names another type.
 */
function mayReachControl(selector: string): boolean {
	const compounds = selector
		.trim()
		.split(/\s+|>|\+|~/)
		.filter(Boolean);
	const last = compounds.at(-1) ?? '';
	if (!/^input\b/.test(last)) return false;
	if (/:not\(\[type=['"]?radio['"]?\],\s*\[type=['"]?checkbox['"]?\]\)/.test(last)) return false;
	if (/:not\(\[type=['"]?checkbox['"]?\],\s*\[type=['"]?radio['"]?\]\)/.test(last)) return false;
	return !OTHER_INPUT_TYPE.test(last);
}

const SOURCES = [...files(SRC_DIR, /\.svelte$/), ...files(SRC_DIR, /\.css$/)]
	.map((path) => relative(SRC_DIR, path))
	.filter((path) => path !== BASE_CSS)
	.sort();

describe('checkboxes and radios only from base.css (package A, item 6)', () => {
	it('finds the component styles and base.css', () => {
		expect(SOURCES.length).toBeGreaterThan(50);
		expect(SOURCES).toContain(join('lib', 'components', 'DoneToggle.svelte'));
		expect(SOURCES).not.toContain(BASE_CSS);
	});

	it.each(SOURCES)('%s names no checkbox or radio and sets no accent-color', (path) => {
		for (const [list, body] of rules(css(join(SRC_DIR, path)))) {
			for (const selector of selectors(list)) {
				expect(withoutNot(selector), `${path}: ${selector}`).not.toMatch(CONTROL_TYPE);
			}
			// Only a progress bar may take the accent through accent-color.
			if (!/\bprogress\b/.test(list)) {
				expect(body, `${path}: ${list}`).not.toMatch(/accent-color|appearance\s*:/);
			}
		}
	});

	const RENDERING = SOURCES.filter((path) => path.endsWith('.svelte') && rendersControl(path));

	it('finds the components with checkboxes or radios', () => {
		expect(RENDERING).toEqual(
			expect.arrayContaining([
				join('lib', 'components', 'DoneToggle.svelte'),
				join('lib', 'components', 'ChipGroup.svelte'),
				join('routes', '(app)', 'einstellungen', 'darstellung', '+page.svelte')
			])
		);
	});

	it.each(RENDERING.filter((path) => !HIDDEN_RADIOS.includes(path)))(
		'%s gives an input that may be a checkbox or radio no own look',
		(path) => {
			for (const [selectorList, body] of rules(css(join(SRC_DIR, path)))) {
				const reaching = selectors(selectorList).filter(mayReachControl);
				if (reaching.length === 0) continue;
				expect(LOOK.exec(body)?.[1], `${path}: ${reaching.join(', ')}`).toBeUndefined();
			}
		}
	);

	it('knows which selectors reach a checkbox or radio', () => {
		expect(mayReachControl('.tile input')).toBe(true);
		expect(mayReachControl('input:disabled')).toBe(true);
		expect(mayReachControl(".field input:not([type='radio'], [type='checkbox'])")).toBe(false);
		expect(mayReachControl("input[type='date']")).toBe(false);
		expect(mayReachControl('.field textarea')).toBe(false);
		expect(withoutNot("input:not([type='radio'], [type='checkbox'])")).toBe('input');
	});
});

describe('base.css styles checkboxes and radios once', () => {
	const base = css(join(SRC_DIR, BASE_CSS));

	it('draws them itself with tokens, in every state', () => {
		const all = /input\[type='checkbox'\],\s*input\[type='radio'\]\s*\{[^}]*appearance:\s*none/;
		expect(base).toMatch(all);
		expect(base).toMatch(/border:\s*1\.5px solid var\(--color-text-muted\)/);
		const states = [':checked', ':indeterminate', ':disabled', "[aria-disabled='true']", ':hover'];
		for (const state of states) {
			expect(base, state).toContain(`input[type='checkbox']${state}`);
		}
		expect(base).toMatch(/input\[type='radio'\]:checked::before/);
		expect(base).toMatch(/background:\s*var\(--color-brand\)/);
		expect(base).toMatch(/background:\s*var\(--color-on-brand\)/);
	});

	it('keeps the focus ring of :focus-visible and gives forced colors the native controls', () => {
		expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-brand-text\)/);
		const forced = /@media \(forced-colors: active\)\s*\{([\s\S]*?\}\s*)\}/.exec(base)?.[1] ?? '';
		expect(forced).toMatch(/appearance:\s*auto/);
		expect(forced).toMatch(/content:\s*none/);
	});

	it('uses only tokens, no color values', () => {
		const controlRules = rules(base).filter(([selector]) => CONTROL_TYPE.test(selector));
		expect(controlRules.length).toBeGreaterThan(5);
		for (const [selector, body] of controlRules) {
			expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
		}
	});

	it('draws the switch from the role of a checkbox, with its knob, motion and forced colors (ADR-0029)', () => {
		const SWITCH = "input[type='checkbox'][role='switch']";
		const rule = (selector: string) =>
			rules(base).find(([list]) => selectors(list).includes(selector))?.[1] ?? '';
		expect(rule(SWITCH)).toMatch(/border-radius:\s*var\(--radius-pill\)/);
		expect(rule(`${SWITCH}::before`)).toMatch(/visibility:\s*visible/);
		expect(rule(`${SWITCH}::before`)).toMatch(/background:\s*var\(--color-text-muted\)/);
		expect(rule(`${SWITCH}::before`)).toMatch(/transition:\s*translate var\(--motion-fast\)/);
		expect(rule(`${SWITCH}:checked::before`)).toMatch(/translate:/);
		expect(rule(`${SWITCH}:checked::before`)).toMatch(/background:\s*var\(--color-on-brand\)/);
		const reduced =
			/@media \(prefers-reduced-motion: reduce\)\s*\{\s*input\[type='checkbox'\]\[role='switch'\]::before\s*\{([^}]*)\}/.exec(
				base
			)?.[1];
		expect(reduced).toMatch(/transition:\s*none/);
		const forced = /@media \(forced-colors: active\)\s*\{([\s\S]*?\}\s*)\}/.exec(base)?.[1] ?? '';
		expect(forced).toContain(SWITCH);
	});

	it('gives role="switch" only to checkboxes and never names a class for it', () => {
		const components = SOURCES.filter((path) => path.endsWith('.svelte'));
		for (const path of components) {
			const markup = readFileSync(join(SRC_DIR, path), 'utf8').replace(
				/<style[^>]*>[\s\S]*?<\/style>/g,
				''
			);
			for (const [tag = ''] of markup.matchAll(/<[a-zA-Z][^<>]*role=["']switch["'][^<>]*>/g)) {
				expect(tag, path).toMatch(/^<input\b/);
				expect(tag, path).toMatch(/type=["']checkbox["']/);
			}
		}
		expect(base).not.toMatch(/\.switch\b/);
	});

	// Apple HIG, toggles (G-5): a switch for an emphasized single setting, checkboxes for lists
	// and choices. The single setting of a section bar is a switch; "Erledigte anzeigen" of
	// "Aufgaben" gave way to the view "Erledigte" with ER-1 (ADR-0066).
	it.each([[join('lib', 'components', 'ProjectsView.svelte'), 'Archivierte anzeigen']])(
		'%s shows "%s" as a switch',
		(path, name) => {
			const markup = readFileSync(join(SRC_DIR, path), 'utf8');
			const label = new RegExp(`<label class="switch"[^>]*>\\s*<input([^>]*)>\\s*${name}`).exec(
				markup
			);
			expect(label?.[1], path).toMatch(/type="checkbox"/);
			expect(label?.[1], path).toMatch(/role="switch"/);
		}
	);
});
