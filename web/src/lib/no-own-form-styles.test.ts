// Static check for UI-1 (ADR-0060): every field, select, text area, checkbox, radio and switch of
// the app looks the same. base.css draws them from the tokens in every state (hover, focus,
// locked, read-only, invalid, placeholder, autofill, touch screens), and form/Field.svelte lays out
// label, error and hint. Everywhere else a component gives a control at most a place and a width
// (width, flex, grid, margin, position, text-transform …), never an own look: no padding,
// background, line, radius, color, type, height, shadow, outline, appearance or cursor, neither by
// tag (`input`, `.form :global(select)`) nor by a class the control carries in the markup, and no
// style attribute on a control. Exceptions stand in ALLOWED with their reason; the list may only
// shrink (an entry that no longer matches fails). jsdom lays nothing out, so the look itself is the
// manual case of the overview page /einstellungen/hilfe/elemente.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');

/** The central files: they draw the controls (base.css) and lay out a field (Field.svelte). */
const CENTRAL = [
	join('lib', 'styles', 'base.css'),
	join('lib', 'components', 'form', 'Field.svelte')
];

interface Exception {
	/** Path below src, with "/". */
	readonly file: string;
	/** The selector as written in the style of the file. */
	readonly selector: string;
	readonly reason: string;
}

/** Exceptions with their reason. Only shrink this list. */
const EXCEPTIONS: readonly Exception[] = [
	{
		file: 'lib/components/ChipGroup.svelte',
		selector: '.chip input',
		reason:
			'Die Radios der Chips liegen unsichtbar über dem ganzen Chip (opacity 0, volle Größe); der Chip selbst zeigt Wahl und Fokus.'
	},
	{
		file: 'lib/components/EditableTitle.svelte',
		selector: '.input',
		reason:
			'Das Feld ersetzt die Überschrift des Tickets an derselben Stelle und behält deren Größe und Gewicht, damit der Titel beim Bearbeiten nicht springt.'
	},
	{
		file: 'lib/components/TicketPicker.svelte',
		selector: '.project select',
		reason:
			'Das Select ist Teil des Filter-Chips „Projekt“: Der Chip zeichnet Rahmen und Fläche, das Select darin bleibt rahmenlos in der Schrift des Chips.'
	}
];

const ALLOWED = EXCEPTIONS.map(
	({ file, selector, reason }) => [join(...file.split('/')), selector, reason] as const
);

function files(dir: string, pattern: RegExp): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path, pattern);
		return pattern.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
	});
}

/** The CSS of a file: the <style> blocks of a component or the whole CSS file, without comments. */
function css(source: string, path: string): string {
	const style = path.endsWith('.svelte')
		? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
		: source;
	return style.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The markup of a component: without script, style and comments. */
function markup(source: string): string {
	return source
		.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
		.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '');
}

/** Innermost rules of a style sheet as [selector list, declarations]. */
function rules(style: string): [string, string][] {
	return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [
		(match[1] ?? '').trim().replace(/\s+/g, ' '),
		match[2] ?? ''
	]);
}

/** The parts of a comma-separated list, split outside of parentheses. */
function splitList(list: string): string[] {
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

/** The start tags of the inputs, selects and text areas of a component. */
function controlTags(source: string): string[] {
	const text = markup(source);
	const tags: string[] = [];
	for (const match of text.matchAll(/<(?:input|select|textarea)\b/g)) {
		let depth = 0;
		let end = match.index;
		for (; end < text.length; end += 1) {
			const char = text[end];
			if (char === '{') depth += 1;
			else if (char === '}') depth -= 1;
			else if (char === '>' && depth === 0) break;
		}
		tags.push(text.slice(match.index, end + 1));
	}
	return tags;
}

/** Classes a component puts on its controls: static ones and class:name directives. */
function controlClasses(source: string): string[] {
	return controlTags(source).flatMap((tag) => [
		...(/\sclass="([^"]*)"/.exec(tag)?.[1] ?? '')
			.replace(/\{[^}]*\}/g, ' ')
			.split(/\s+/)
			.filter(Boolean),
		...[...tag.matchAll(/\sclass:([\w-]+)/g)].map((match) => match[1] ?? '')
	]);
}

/** The last compound of a selector, with :global(…) unwrapped and :not(…)/:has(…) left out. */
function lastCompound(selector: string): string {
	const plain = selector
		.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
		.replace(/:(?:not|has)\((?:[^()]|\([^()]*\))*\)/g, '');
	return (
		plain
			.trim()
			.split(/\s+|>|\+|~/)
			.filter(Boolean)
			.at(-1) ?? ''
	);
}

/**
 * Whether a selector reaches an input, select or textarea: its last compound is one by tag, holds
 * one in :is(…)/:where(…), or names a class the component puts on a control.
 */
function reachesControl(selector: string, classes: readonly string[]): boolean {
	const last = lastCompound(selector);
	if (/^(?:input|select|textarea)\b/.test(last)) return true;
	const inner = /:(?:is|where)\(((?:[^()]|\([^()]*\))*)\)/.exec(last)?.[1];
	if (inner !== undefined && splitList(inner).some((part) => reachesControl(part, classes))) {
		return true;
	}
	return classes.some((name) => new RegExp(`\\.${name}(?![\\w-])`).test(last));
}

/** Properties that make up the look of a control. */
const LOOK =
	/(?:^|[;\s])(padding(?:-[a-z-]+)?|background(?:-[a-z-]+)?|border(?:-[a-z-]+)?|outline(?:-[a-z-]+)?|box-shadow|color|caret-color|font(?:-family|-size|-weight|-style)?|line-height|letter-spacing|height|min-height|max-height|appearance|-webkit-appearance|accent-color|cursor|opacity|filter)\s*:/g;

function lookOf(body: string): string[] {
	return [...body.matchAll(LOOK)].map((match) => match[1] ?? '');
}

const SOURCES = [...files(SRC_DIR, /\.svelte$/), ...files(SRC_DIR, /\.css$/)]
	.map((path) => relative(SRC_DIR, path))
	.filter((path) => !CENTRAL.includes(path) && path !== join('lib', 'styles', 'tokens.css'))
	.sort();

/** Every selector of every file that gives a control an own look: [file, selector, properties]. */
function ownLooks(): [string, string, string[]][] {
	const found: [string, string, string[]][] = [];
	for (const path of SOURCES) {
		const source = readFileSync(join(SRC_DIR, path), 'utf8');
		const classes = path.endsWith('.svelte') ? controlClasses(source) : [];
		for (const [list, body] of rules(css(source, path))) {
			const look = lookOf(body);
			if (look.length === 0) continue;
			for (const selector of splitList(list)) {
				if (reachesControl(selector, classes)) found.push([path, selector, look]);
			}
		}
	}
	return found;
}

const OWN_LOOKS = ownLooks();

function allowed(path: string, selector: string): boolean {
	return ALLOWED.some(([file, allowedSelector]) => file === path && allowedSelector === selector);
}

describe('controls take their look only from base.css (UI-1, ADR-0060)', () => {
	it('finds the component styles, but not the central files', () => {
		expect(SOURCES.length).toBeGreaterThan(50);
		expect(SOURCES).toContain(join('lib', 'components', 'accounts', 'OwnAccountView.svelte'));
		for (const path of CENTRAL) expect(SOURCES).not.toContain(path);
	});

	it('gives no input, select or textarea an own look outside the allowlist', () => {
		const offenders = OWN_LOOKS.filter(([path, selector]) => !allowed(path, selector)).map(
			([path, selector, look]) => `${path}: ${selector} { ${look.join(', ')} }`
		);
		expect(offenders).toEqual([]);
	});

	it('keeps only exceptions that still apply, each with a reason', () => {
		for (const [file, selector, reason] of ALLOWED) {
			expect(
				OWN_LOOKS.some(([path, own]) => path === file && own === selector),
				`${file}: ${selector} no longer needs an exception, take it off the list`
			).toBe(true);
			expect(reason.length, `${file}: ${selector}`).toBeGreaterThan(40);
		}
	});

	it.each(SOURCES.filter((path) => path.endsWith('.svelte')))(
		'%s puts no style attribute on a control',
		(path) => {
			for (const tag of controlTags(readFileSync(join(SRC_DIR, path), 'utf8'))) {
				expect(tag, path).not.toMatch(/\sstyle(?::[\w-]+)?=/);
			}
		}
	);

	it('knows which selectors reach a control and which properties are a look', () => {
		expect(reachesControl('.form :global(select)', [])).toBe(true);
		expect(reachesControl(".field input:not([type='radio'])", [])).toBe(true);
		expect(reachesControl('.prose :where(li[data-task] > input)', [])).toBe(true);
		expect(reachesControl('.title', ['title'])).toBe(true);
		expect(reachesControl('.title-row', ['title'])).toBe(false);
		expect(reachesControl('.tile:has(input:checked)', [])).toBe(false);
		expect(reachesControl('.search-field', [])).toBe(false);
		expect(lookOf('width: 100%; flex: 1; margin-top: 0.125rem;')).toEqual([]);
		expect(lookOf('padding: 0; border-radius: 0; font-size: 1rem')).toEqual([
			'padding',
			'border-radius',
			'font-size'
		]);
		expect(
			controlClasses(
				'<input id="a" class="code {wide}" class:busy type="text" /><select class="x">'
			)
		).toEqual(['code', 'busy', 'x']);
		expect(
			controlTags('<input style="color: red" /><textarea style:color="red"></textarea>')
		).toEqual(['<input style="color: red" />', '<textarea style:color="red">']);
	});
});

describe('base.css draws the fields once, from the tokens (UI-1)', () => {
	const base = css(readFileSync(join(SRC_DIR, CENTRAL[0] ?? ''), 'utf8'), 'base.css');
	const FIELD = /^:where\( ?input:not\(/;
	/** Rules whose selector starts with the selector list of the fields, :where(input:not(…), …). */
	const fieldRules = rules(base).filter(([list]) => FIELD.test(list));
	/** What follows the :where(…) of the fields in a selector, e.g. ":hover:not(…)". */
	function stateOf(list: string): string {
		let depth = 0;
		for (let i = list.indexOf('('); i < list.length; i += 1) {
			if (list[i] === '(') depth += 1;
			if (list[i] === ')') depth -= 1;
			if (depth === 0) return list.slice(i + 1).trim();
		}
		return list;
	}
	const rule = (state: RegExp) => fieldRules.find(([list]) => state.test(stateOf(list)))?.[1] ?? '';

	it('excludes checkboxes, radios and buttons from the look of the fields', () => {
		const [list = ''] = fieldRules[0] ?? [];
		for (const type of [
			'checkbox',
			'radio',
			'hidden',
			'file',
			'range',
			'color',
			'button',
			'submit'
		]) {
			expect(list).toContain(`[type='${type}']`);
		}
		expect(list).toMatch(/select, textarea ?\)$/);
	});

	it('draws the normal field with the surface, a line of 3 : 1, the radius and the height m', () => {
		const body = rule(/^$/);
		expect(body).toMatch(/background:\s*var\(--color-surface\)/);
		expect(body).toMatch(/border:\s*1px solid var\(--color-text-muted\)/);
		expect(body).toMatch(/border-radius:\s*var\(--radius-control\)/);
		expect(body).toMatch(/min-height:\s*var\(--control-height-m\)/);
		expect(body).toMatch(/font-size:\s*var\(--font-size-body\)/);
		expect(body).toMatch(/color:\s*var\(--color-text\)/);
	});

	it('has hover, locked and read-only states, and no color value', () => {
		expect(
			rule(
				/^:hover:not\(:disabled, \[aria-disabled='true'\], \[readonly\], \[aria-invalid='true'\]\)$/
			)
		).toMatch(/border-color:\s*var\(--color-brand\)/);
		const locked = rule(/^:is\(:disabled, \[aria-disabled='true'\]\)$/);
		expect(locked).toMatch(/cursor:\s*not-allowed/);
		expect(locked).toMatch(/color:\s*var\(--color-text-muted\)/);
		const readOnly = rules(base).find(([list]) => list === ':where(input, textarea)[readonly]');
		expect(readOnly?.[1]).toMatch(/background:\s*var\(--color-bg\)/);
		for (const [list, body] of fieldRules)
			expect(body, list).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
	});

	it('keeps the red line of an invalid field (ADR-0009) and the focus ring', () => {
		expect(rules(base).find(([list]) => list === ":root [aria-invalid='true']")?.[1]).toMatch(
			/border-color:\s*var\(--color-danger\)/
		);
		expect(rules(base).find(([list]) => list === ':focus-visible')?.[1]).toMatch(
			/outline:\s*2px solid var\(--color-brand-text\)/
		);
	});

	it('dims placeholders to the muted text and covers the autofill colour of the browser', () => {
		expect(rules(base).find(([list]) => list === '::placeholder')?.[1]).toMatch(
			/color:\s*var\(--color-text-muted\)/
		);
		const autofill = rules(base).find(([list]) => list.includes(':autofill'));
		expect(autofill?.[0]).toContain(':-webkit-autofill');
		expect(autofill?.[1]).toMatch(/box-shadow:\s*inset 0 0 0 100vmax var\(--color-surface\)/);
		expect(autofill?.[1]).toMatch(/-webkit-text-fill-color:\s*var\(--color-text\)/);
	});

	it('gives touch screens 16 px in fields and 44 px high targets', () => {
		const touch = /@media \(pointer: coarse\) \{([\s\S]*)\}\s*$/.exec(base)?.[1] ?? '';
		expect(touch).toMatch(/font-size:\s*var\(--font-size-field-touch\)/);
		expect(touch).toMatch(/min-height:\s*var\(--control-height-touch\)/);
		expect(touch).toMatch(/\.button-primary,\s*\.button-secondary,\s*\.button-subtle/);
		expect(touch).toMatch(/label:has\(> input:is\(\[type='checkbox'\], \[type='radio'\]\)\)/);
		const tokens = readFileSync(join(SRC_DIR, 'lib', 'styles', 'tokens.css'), 'utf8');
		expect(tokens).toMatch(/--font-size-field-touch:\s*1rem;/);
		expect(tokens).toMatch(/--control-height-touch:\s*2\.75rem;/);
	});

	it('has the small button size and the mono variant for codes', () => {
		expect(rules(base).find(([list]) => list === '.button-small')?.[1]).toMatch(
			/min-height:\s*var\(--control-height-s\)/
		);
		expect(
			rules(base).find(([list]) => list === ':where(input, textarea).input-mono')?.[1]
		).toMatch(/font-family:\s*var\(--font-mono\)/);
	});
});
