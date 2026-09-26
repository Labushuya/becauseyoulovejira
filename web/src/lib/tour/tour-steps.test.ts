// Steps and files of the guided tour (plan EH-13): at most five steps, every target exists as a
// data-tour attribute in the sources, the texts are German and short, the pages are app addresses;
// the tour files ask no foreign server, and its stylesheet uses only tokens and no shadow.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import contextSource from './tour-context.ts?raw';
import stepsSource from './steps.ts?raw';
import tourSource from './tour.ts?raw';
import { TOUR_STEPS, tourSelector } from './steps';

// Read from disk: Vitest hands stylesheets over empty, also with ?raw.
const tourCss = readFileSync(join(import.meta.dirname, '..', 'styles', 'tour.css'), 'utf8');

const components = import.meta.glob('/src/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** Source without comments, so a comment may still name a URL. */
function code(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('tour steps', () => {
	it('has at most five steps with unique targets', () => {
		expect(TOUR_STEPS.length).toBeGreaterThan(0);
		expect(TOUR_STEPS.length).toBeLessThanOrEqual(5);
		const targets = TOUR_STEPS.map((step) => step.target);
		expect(new Set(targets).size).toBe(targets.length);
		expect(targets).toEqual([
			'quick-capture',
			'inbox',
			'filter-bar',
			'project-layout',
			'channel-catalog'
		]);
	});

	it.each(TOUR_STEPS.map((step) => [step.target]))(
		'finds the target %s as exactly one data-tour attribute in the sources',
		(target) => {
			const owners = Object.entries(components).filter(([, source]) =>
				source.includes(`data-tour="${target}"`)
			);
			expect(owners.map(([path]) => path)).toHaveLength(1);
			expect(tourSelector(target)).toBe(`[data-tour="${target}"]`);
		}
	);

	it.each(TOUR_STEPS.map((step) => [step.title, step]))(
		'has a German title and at most two sentences for %s',
		(_title, step) => {
			expect(step.title.trim()).not.toBe('');
			expect(step.description.trim()).not.toBe('');
			const sentences = step.description.split(/[.!?](?:\s|$)/).filter((part) => part !== '');
			expect(sentences.length).toBeLessThanOrEqual(2);
			expect(`${step.title} ${step.description}`).toMatch(/[äöüßÄÖÜ]|\b(?:die|der|und|du)\b/);
			if (step.path !== null) expect(step.path).toMatch(/^\/[a-z/-]*$/);
		}
	);

	it('asks no foreign server', () => {
		for (const source of [tourSource, stepsSource, contextSource, tourCss]) {
			expect(code(source)).not.toMatch(/https?:|\/\/[a-z]/i);
		}
		expect(tourSource).not.toMatch(/driver\.js\/dist\/driver\.css/);
		expect(tourSource).toMatch(/import\('driver\.js'\)/);
	});

	it('styles the tour with tokens only, without shadow', () => {
		const rules = code(tourCss);
		expect(rules).not.toMatch(/box-shadow|text-shadow|filter:\s*drop-shadow/);
		expect(rules).toMatch(/var\(--color-surface\)/);
		expect(rules).toMatch(/var\(--color-line\)/);
		expect(rules).toMatch(/var\(--radius-surface\)/);
		expect(rules).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
		expect(rules).toMatch(/var\(--motion-medium\) var\(--motion-ease\)/);
	});
});
