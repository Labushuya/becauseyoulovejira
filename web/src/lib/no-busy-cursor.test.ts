// Pointer over locked and busy controls (ADR-0026, addendum of 2026-09-30). base.css gave every
// locked button (disabled, aria-disabled) the busy pointer: after a Notion import had finished,
// the locked import button still said "busy", and the user read it as "still running". Now a
// locked control shows "not allowed", and the busy pointer only shows while something really
// runs, marked with aria-busy="true" on the control or on its region. jsdom does not compute a
// pointer from the style sheets, so the rules are checked statically in base.css and in the
// style of every component; the regions that carry aria-busy are checked where they are rendered.

import { render, screen } from '@testing-library/svelte';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import SelectionBar from './components/SelectionBar.svelte';

const SRC_DIR = resolve(import.meta.dirname, '..');
const BASE_CSS = join('lib', 'styles', 'base.css');

function files(dir: string, pattern: RegExp): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path, pattern);
		return pattern.test(entry.name) ? [path] : [];
	});
}

/** The CSS of a file: the <style> blocks of a component or the whole CSS file, without comments. */
function css(path: string): string {
	const source = readFileSync(path, 'utf8');
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

function cursorOf(declarations: string): string | null {
	return /(?:^|;)\s*cursor\s*:\s*([^;]+)/.exec(declarations)?.[1]?.trim() ?? null;
}

const LOCKED = /:disabled|\[aria-disabled/;
const BUSY = /\[aria-busy=['"]true['"]\]/;

/** Whether a selector targets a locked control; ":not(:disabled)" does not count. */
function locked(selector: string): boolean {
	return LOCKED.test(selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ''));
}

describe('pointer over locked and busy controls (ADR-0026, addendum of 2026-09-30)', () => {
	const sheets = files(SRC_DIR, /\.(svelte|css)$/).map((path) => ({
		name: relative(SRC_DIR, path),
		rules: rules(css(path))
	}));
	const base = rules(css(join(SRC_DIR, BASE_CSS)));

	it('shows "not allowed" over a locked button of base.css', () => {
		for (const button of ['button-primary', 'button-secondary', 'button-subtle', 'button-icon']) {
			for (const state of [':disabled', "[aria-disabled='true']"]) {
				const rule = base.find(([list]) => selectors(list).includes(`.${button}${state}`));
				expect(rule, `.${button}${state}`).toBeDefined();
				expect(cursorOf(rule?.[1] ?? ''), `.${button}${state}`).toBe('not-allowed');
			}
		}
	});

	it('shows the busy pointer on a busy control and on locked controls of a busy region', () => {
		const index = base.findIndex(([list]) => {
			const parts = selectors(list);
			return (
				parts.includes("[aria-busy='true']") &&
				parts.includes("[aria-busy='true']:is(:disabled, [aria-disabled='true'])") &&
				parts.includes("[aria-busy='true'] :is(:disabled, [aria-disabled='true'])")
			);
		});
		expect(index, 'rule for busy controls and regions').toBeGreaterThan(-1);
		expect(cursorOf(base[index]?.[1] ?? '')).toBe('progress');
		// After every rule of a locked button, so it wins at equal specificity.
		const lastLocked = base.findLastIndex(
			([list, declarations]) =>
				/\.button-/.test(list) && locked(list) && cursorOf(declarations) === 'not-allowed'
		);
		expect(lastLocked).toBeGreaterThan(-1);
		expect(index).toBeGreaterThan(lastLocked);
		// Checkboxes and radios have their own rules with a higher specificity.
		const boxes = base.find(([list]) =>
			selectors(list).some((part) => /\[aria-busy='true'\]\s+input:is\(/.test(part))
		);
		expect(cursorOf(boxes?.[1] ?? '')).toBe('progress');
	});

	it('shows the busy pointer nowhere without aria-busy', () => {
		const offenders = sheets.flatMap(({ name, rules: list }) =>
			list
				.filter(([, declarations]) => cursorOf(declarations) === 'progress')
				.flatMap(([selectorList]) =>
					selectors(selectorList)
						.filter((selector) => !BUSY.test(selector))
						.map((selector) => `${name}: ${selector}`)
				)
		);
		expect(offenders).toEqual([]);
	});

	it('shows "not allowed" over a control that is only locked', () => {
		const offenders = sheets.flatMap(({ name, rules: list }) =>
			list.flatMap(([selectorList, declarations]) => {
				const cursor = cursorOf(declarations);
				if (cursor === null || cursor === 'not-allowed') return [];
				return selectors(selectorList)
					.filter((selector) => locked(selector) && !BUSY.test(selector))
					.map((selector) => `${name}: ${selector} → ${cursor}`);
			})
		);
		expect(offenders).toEqual([]);
	});
});

describe('busy regions', () => {
	const actions = createRawSnippet(() => ({
		render: () => '<button class="button-secondary" type="button">Erledigen</button>'
	}));

	it('marks the selection bar busy only while a bulk action runs', async () => {
		const { rerender } = render(SelectionBar, {
			props: { countText: '3 Tickets ausgewählt', onclear: () => undefined, actions }
		});
		const bar = screen.getByRole('region', { name: '3 Tickets ausgewählt' });
		expect(bar.getAttribute('aria-busy')).toBeNull();
		await rerender({ progress: { total: 3, done: 1, text: '1 von 3 bearbeitet …' } });
		expect(bar.getAttribute('aria-busy')).toBe('true');
		await rerender({ progress: null });
		expect(bar.getAttribute('aria-busy')).toBeNull();
	});
});
