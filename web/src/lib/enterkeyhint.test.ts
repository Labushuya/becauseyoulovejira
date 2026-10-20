// The Enter key of the on-screen keyboard (MO-1b, ADR-0073 addendum): an attribute only, the same
// on the PC, where it changes nothing. Every search field says "search", a line that saves with
// Enter says "done", a field with another field after it says "next". Checked in the markup of
// every component, so a new search field cannot forget it.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '..');

/** Every component below src, with its markup only (no script, no style, no comments). */
function components(): { file: string; markup: string }[] {
	return readdirSync(SRC_DIR, { recursive: true })
		.map((entry) => String(entry).replaceAll('\\', '/'))
		.filter((file) => file.endsWith('.svelte'))
		.map((file) => ({
			file: relative(SRC_DIR, join(SRC_DIR, file)).replaceAll('\\', '/'),
			markup: readFileSync(join(SRC_DIR, file), 'utf8')
				.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
				.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
				.replace(/<!--[\s\S]*?-->/g, '')
		}));
}

/** The start tags of the inputs of a markup; braces of attributes may hold ">". */
function inputTags(markup: string): string[] {
	const tags: string[] = [];
	for (const match of markup.matchAll(/<input\b/g)) {
		let depth = 0;
		let end = match.index;
		for (; end < markup.length; end += 1) {
			const char = markup[end];
			if (char === '{') depth += 1;
			else if (char === '}') depth -= 1;
			else if (char === '>' && depth === 0) break;
		}
		tags.push(markup.slice(match.index, end + 1));
	}
	return tags;
}

const COMPONENTS = components();

function inputsOf(file: string): string[] {
	const component = COMPONENTS.find((entry) => entry.file === file);
	expect(component, file).toBeDefined();
	return inputTags(component?.markup ?? '');
}

describe('enterkeyhint (MO-1b)', () => {
	it('finds the search fields of the app', () => {
		const files = COMPONENTS.filter(({ markup }) =>
			inputTags(markup).some((tag) => /\btype="search"/.test(tag))
		);
		expect(files.length).toBeGreaterThanOrEqual(12);
	});

	it('gives every search field the key "search"', () => {
		const missing = COMPONENTS.flatMap(({ file, markup }) =>
			inputTags(markup)
				.filter((tag) => /\btype="search"/.test(tag) && !/\benterkeyhint="search"/.test(tag))
				.map(() => file)
		);
		expect(missing).toEqual([]);
	});

	it('says "done" where Enter saves a line: the quick entry and the title of a ticket', () => {
		const files = ['lib/components/QuickCapture.svelte', 'lib/components/EditableTitle.svelte'];
		for (const file of files) {
			const lines = inputsOf(file).filter((tag) => /\btype="text"/.test(tag));
			expect(lines.length, file).toBe(1);
			expect(lines[0], file).toMatch(/\benterkeyhint="done"/);
		}
	});

	it('says "next" in the e-mail of the sign-in and "done" in its password', () => {
		const [email, password] = inputsOf('routes/login/+page.svelte');
		expect(email).toMatch(/\btype="email"/);
		expect(email).toMatch(/\benterkeyhint="next"/);
		expect(password).toMatch(/\btype="password"/);
		expect(password).toMatch(/\benterkeyhint="done"/);
	});

	it('uses only the values of the standard for Enter keys', () => {
		const values = COMPONENTS.flatMap(({ markup }) =>
			[...markup.matchAll(/\benterkeyhint="([^"]*)"/g)].map((match) => match[1])
		);
		expect(values.length).toBeGreaterThan(0);
		for (const value of values) {
			expect(['enter', 'done', 'go', 'next', 'previous', 'search', 'send']).toContain(value);
		}
	});
});
