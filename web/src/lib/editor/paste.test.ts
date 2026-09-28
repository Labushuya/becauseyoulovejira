// Cleaning of pasted HTML (plan editor RT-5) with the clipboard of Word 365, Google Docs and
// LibreOffice (made-up content in lib/test/paste-fixtures) and hostile HTML: only structure,
// formatting and safe links stay; lists of Word become lists.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, transformPastedHTML } from './paste';

const FIXTURES = join(import.meta.dirname, '..', 'test', 'paste-fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

/** The cleaned HTML as a DOM for structural checks. */
function clean(html: string): HTMLElement {
	const container = document.createElement('div');
	container.innerHTML = transformPastedHTML(html);
	return container;
}

/** Every attribute left, as "tag[name]". */
function attributes(root: HTMLElement): string[] {
	return [...root.querySelectorAll('*')].flatMap((element) =>
		element.getAttributeNames().map((name) => `${element.tagName.toLowerCase()}[${name}]`)
	);
}

describe('transformPastedHTML: Word 365', () => {
	const root = clean(fixture('word-365.html'));

	it('keeps headings, paragraphs and formatting and drops styles, comments and Office tags', () => {
		expect(root.querySelector('h1')?.textContent?.trim()).toBe('Umzug planen');
		expect(root.querySelector('b')?.textContent).toBe('bis Freitag');
		expect(root.querySelector('i')?.textContent).toBe('ohne Ausnahme');
		expect(root.querySelector('u')?.textContent).toBe('gründlich');
		expect(root.innerHTML).not.toMatch(/mso-|Comic|color|<o:|<v:|<style|<meta|<!--|MsoNormal/i);
		expect(root.textContent).toContain('Rot und bunt');
		expect(root.textContent).not.toContain('Style Definitions');
	});

	it('turns the list paragraphs into nested and numbered lists without their markers', () => {
		const lists = [...root.children].filter(
			(child) => child.tagName === 'UL' || child.tagName === 'OL'
		);
		expect(lists.map((list) => list.tagName)).toEqual(['UL', 'OL']);
		const [bullets, numbers] = lists as [HTMLElement, HTMLElement];
		expect([...bullets.children].map((item) => item.firstChild?.textContent?.trim())).toEqual([
			'Kartons besorgen',
			'Helfer'
		]);
		expect(bullets.querySelector('li > ul > li')?.textContent?.trim()).toBe('Beim Baumarkt fragen');
		expect([...numbers.children].map((item) => item.textContent?.trim())).toEqual([
			'Zählerstände notieren',
			'Schlüssel abgeben'
		]);
		expect(root.textContent).not.toMatch(/·|\bo\s+Beim|1\.\s+Zähler/);
	});

	it('keeps safe links, unwraps the others and drops images and empty paragraphs', () => {
		expect([...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
			'https://example.com/umzug'
		]);
		expect(root.textContent).toContain('nicht hier');
		expect(root.querySelector('img')).toBeNull();
		expect(root.innerHTML).not.toContain('file:');
		expect(
			[...root.querySelectorAll('p')].filter((p) => (p.textContent ?? '').trim() === '')
		).toEqual([]);
		expect(attributes(root)).toEqual(['a[href]']);
	});
});

describe('transformPastedHTML: Google Docs', () => {
	const root = clean(fixture('google-docs.html'));

	it('drops the bold wrapper and turns styled spans into formatting', () => {
		expect(root.querySelector('b')).toBeNull();
		expect(root.querySelector('h2')?.textContent).toBe('Einkauf für das Fest');
		expect(root.querySelector('h2 strong')).toBeNull();
		expect(root.querySelector('strong')?.textContent).toBe('rechtzeitig');
		expect(root.querySelector('em')?.textContent).toBe('kühl');
		expect([...root.querySelectorAll('u')].map((u) => u.textContent)).toEqual([
			'nichts vergessen',
			'Einladung'
		]);
		expect(root.querySelector('s')?.textContent).toBe('Sekt');
	});

	it('keeps lists and the link and loads no image', () => {
		expect([...root.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual([
			'Brot',
			'Käse'
		]);
		expect(root.querySelector('ol > li')?.textContent).toBe('Tisch decken');
		expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/fest');
		expect(root.querySelector('img')).toBeNull();
		expect(attributes(root)).toEqual(['a[href]']);
	});
});

describe('transformPastedHTML: LibreOffice', () => {
	const root = clean(fixture('libreoffice.html'));

	it('keeps formatting, nested lists, the start of a numbered list and mailto', () => {
		expect(root.querySelector('h3')?.textContent).toBe('Werkstatt');
		expect(root.querySelector('b')?.textContent).toBe('Reifen');
		expect(root.querySelector('strike')?.textContent).toBe('Politur');
		expect(root.querySelector('ul ul li')?.textContent?.trim()).toBe('Kurbel');
		expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
		expect(root.querySelector('a')?.getAttribute('href')).toBe('mailto:werkstatt@example.com');
		expect(root.querySelector('font')).toBeNull();
		expect(root.innerHTML).not.toMatch(/style=|class=|color|@page/);
	});
});

describe('transformPastedHTML: hostile HTML', () => {
	it.each([
		['<img src=x onerror="alert(1)">', /<img|onerror/],
		['<p onclick="alert(1)">a</p>', /onclick/],
		['<a href="javascript:alert(1)">x</a>', /javascript|<a/],
		['<a href="data:text/html,x">x</a>', /data:|<a/],
		['<u onmouseover="alert(1)">u</u>', /onmouseover/],
		['<input type="text" value="x"><input type="checkbox" onclick="x()">', /<input/],
		['<script>alert(1)</script><p>b</p>', /<script|alert/],
		['<iframe src="https://example.com"></iframe>', /<iframe/],
		['<svg onload="alert(1)"><circle/></svg>', /<svg|onload/],
		['<p style="background:url(https://example.com/x.png)">a</p>', /url\(|style/],
		[
			'<form action="https://example.com"><button formaction="x">b</button></form>',
			/<form|<button|formaction/
		]
	])('cleans %s', (html, forbidden) => {
		expect(transformPastedHTML(html)).not.toMatch(forbidden);
	});
});

describe('looksLikeMarkdown', () => {
	it.each([
		'# Titel',
		'- Punkt',
		'1. Eins',
		'> Zitat',
		'```\ncode\n```',
		'Das ist **fett**',
		'~~weg~~',
		'++unter++',
		'mit `code`',
		'[Link](https://example.com)'
	])('sees Markdown in %s', (text) => {
		expect(looksLikeMarkdown(text)).toBe(true);
	});

	it.each(['Einfacher Satz.', 'C++ ist eine Sprache', 'a * b = c', 'Preis: 5 - 3 Euro'])(
		'sees plain text in %s',
		(text) => {
			expect(looksLikeMarkdown(text)).toBe(false);
		}
	);
});
