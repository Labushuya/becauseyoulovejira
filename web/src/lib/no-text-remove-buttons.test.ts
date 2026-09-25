// Static checks for the 480 px side panel (fix after UI-9): text buttons such as "Entfernen"
// pushed rows past the right edge of the panel. Removing is an icon button in the style of
// ".button-icon" with a name that says what goes ("Fälligkeit entfernen"), and the columns of the
// panel and the full view may shrink, so long values wrap instead of widening them.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');
const COMPONENTS = join(SRC_DIR, 'lib', 'components');

function components(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return components(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

/** Markup without comments and without the script and style blocks. */
function markup(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<script[\s\S]*?<\/script>/g, '')
		.replace(/<style[\s\S]*?<\/style>/g, '');
}

/** A button or link whose visible text starts with "Entfernen". */
const TEXT_REMOVE = /<(button|a)\b[^>]*>\s*Entfernen\b/;

const files = components(COMPONENTS).map((path) => [relative(SRC_DIR, path), path] as const);

describe('no text buttons "Entfernen"', () => {
	it('finds the components', () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it.each(files)('%s has no text button "Entfernen"', (_name, path) => {
		expect(markup(path)).not.toMatch(TEXT_REMOVE);
	});

	it.each([
		['<button class="clear" type="button">\n\tEntfernen<span>x</span>', true],
		['<button type="button">Entfernen</button>', true],
		['<button aria-label="Fälligkeit entfernen">', false],
		['<p>Entfernen: in der Systemsteuerung</p>', false]
	])('recognizes a text button in %s', (sample, found) => {
		expect(TEXT_REMOVE.test(sample)).toBe(found);
	});

	it('removes the due date with a named icon button', () => {
		const source = markup(join(COMPONENTS, 'DueInput.svelte'));
		const button = /<button\b[^>]*>/.exec(source)?.[0] ?? '';
		expect(button).toMatch(/class="button-icon\b/);
		expect(button).toMatch(/aria-label="Fälligkeit entfernen"/);
		expect(button).toMatch(/title="Fälligkeit entfernen"/);
	});
});

describe('shrinking columns in panel and full view', () => {
	it.each([
		['overlay/Drawer.svelte', /\.body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/],
		['overlay/FullView.svelte', /\.full-view\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/],
		[
			'overlay/FullView.svelte',
			/\.main,\s*\.side\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
		],
		['TicketFields.svelte', /\.control\s*\{[^}]*min-width:\s*0/],
		['DueInput.svelte', /\.due-input\s*\{[^}]*flex-wrap:\s*wrap/]
	])('%s lets its content shrink', (file, rule) => {
		expect(readFileSync(join(COMPONENTS, file), 'utf8')).toMatch(rule);
	});
});
