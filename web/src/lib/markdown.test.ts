// Markdown rendering and sanitizing (ADR-0008): XSS cases are neutralised, Markdown formatting
// stays, images are not rendered.

import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

/** Rendered HTML as a DOM fragment for structural checks. */
function dom(source: string): HTMLElement {
	const container = document.createElement('div');
	container.innerHTML = renderMarkdown(source);
	return container;
}

function attributesOf(root: HTMLElement): string[] {
	return [...root.querySelectorAll('*')].flatMap((element) =>
		[...element.attributes].map(
			(attribute) => `${element.tagName.toLowerCase()}[${attribute.name}]`
		)
	);
}

describe('renderMarkdown: XSS', () => {
	it.each([
		['script tag', '<script>alert(1)</script>'],
		['img onerror', '<img src=x onerror="alert(1)">'],
		['svg onload', '<svg onload="alert(1)"><circle /></svg>'],
		['anchor with onclick', '<a href="https://example.com" onclick="alert(1)">x</a>'],
		['iframe', '<iframe src="https://example.com"></iframe>'],
		['style', '<style>body { display: none }</style>'],
		['form', '<form action="https://example.com"><input></form>']
	])('shows raw HTML (%s) as text only', (_name, source) => {
		const root = dom(source);

		expect(root.querySelector('script, img, svg, iframe, style, form, input')).toBeNull();
		expect(root.textContent).toContain(source.slice(0, 5));
		// Only the linkified URL inside the text becomes a link.
		const unexpected = attributesOf(root).filter(
			(name) => !['a[href]', 'a[target]', 'a[rel]'].includes(name)
		);
		expect(unexpected).toEqual([]);
		for (const link of root.querySelectorAll('a')) {
			expect(link.getAttribute('href')).toBe('https://example.com');
		}
	});

	it.each([
		['javascript link', '[x](javascript:alert(1))'],
		['upper case javascript link', '[x](JAVASCRIPT:alert(1))'],
		['javascript with entities', '[x](&#106;avascript:alert(1))'],
		['javascript with hex entities', '[x](&#x6A;&#x61;vascript:alert(1))'],
		['javascript with a tab entity', '[x](java&#9;script:alert(1))'],
		['vbscript link', '[x](vbscript:msgbox(1))'],
		['data link', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
		['data image link', '[x](data:image/png;base64,iVBORw0KGgo=)'],
		['file link', '[x](file:///C:/Windows/win.ini)'],
		['autolink', '<javascript:alert(1)>'],
		['reference link', '[r][x]\n\n[x]: javascript:alert(1)']
	])('never renders a dangerous href (%s)', (_name, source) => {
		const root = dom(source);

		for (const link of root.querySelectorAll('a')) {
			expect(link.getAttribute('href') ?? '').toMatch(/^(?:https?:|mailto:|$)/i);
		}
		expect(renderMarkdown(source)).not.toMatch(/href="\s*(?:javascript|vbscript|data|file):/i);
	});

	it('keeps nested links safe', () => {
		const source = '[a [b](javascript:alert(1))](https://example.com)';
		const hrefs = [...dom(source).querySelectorAll('a')].map((link) => link.getAttribute('href'));

		expect(hrefs.every((href) => href === null || /^https?:/.test(href))).toBe(true);
	});
});

describe('renderMarkdown: formatting', () => {
	it('keeps headings, lists, emphasis, code, quotes and tables', () => {
		const root = dom(
			[
				'# Titel',
				'',
				'- eins',
				'- **zwei**',
				'',
				'1. *erstens*',
				'',
				'`inline`',
				'',
				'```',
				'block',
				'```',
				'',
				'> Zitat',
				'',
				'| A | B |',
				'|---|---|',
				'| 1 | 2 |',
				'',
				'~~weg~~',
				'',
				'---'
			].join('\n')
		);

		expect(root.querySelector('h1')?.textContent).toBe('Titel');
		expect(root.querySelectorAll('ul > li')).toHaveLength(2);
		expect(root.querySelector('li strong')?.textContent).toBe('zwei');
		expect(root.querySelector('ol em')?.textContent).toBe('erstens');
		expect(root.querySelector('p > code')?.textContent).toBe('inline');
		expect(root.querySelector('pre > code')?.textContent).toBe('block\n');
		expect(root.querySelector('blockquote')?.textContent?.trim()).toBe('Zitat');
		expect(root.querySelectorAll('table th')).toHaveLength(2);
		expect(root.querySelector('table td')?.textContent).toBe('1');
		expect(root.querySelector('s')?.textContent).toBe('weg');
		expect(root.querySelector('hr')).not.toBeNull();
		expect(attributesOf(root)).toEqual([]);
	});

	it('keeps line breaks inside a paragraph', () => {
		expect(dom('Zeile 1\nZeile 2').querySelector('p br')).not.toBeNull();
	});

	it('opens external links in a new tab with rel="noopener noreferrer"', () => {
		const root = dom('[Doku](https://example.com/a?b=1 "Hilfe") und https://example.org');
		const [named, linkified] = root.querySelectorAll('a');

		expect(named?.getAttribute('href')).toBe('https://example.com/a?b=1');
		expect(named?.getAttribute('title')).toBe('Hilfe');
		expect(linkified?.getAttribute('href')).toBe('https://example.org');
		for (const link of [named, linkified]) {
			expect(link?.getAttribute('target')).toBe('_blank');
			expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
		}
	});

	it('keeps mailto links without a new tab', () => {
		const link = dom('[Mail](mailto:anna@example.com)').querySelector('a');

		expect(link?.getAttribute('href')).toBe('mailto:anna@example.com');
		expect(link?.hasAttribute('target')).toBe(false);
	});

	it('drops relative links to keep only http, https and mailto', () => {
		const link = dom('[intern](/tickets/abc)').querySelector('a');

		expect(link?.hasAttribute('href')).toBe(false);
		expect(link?.textContent).toBe('intern');
	});

	it('does not render images', () => {
		const root = dom('![Bild](https://example.com/bild.png)');

		expect(root.querySelector('img')).toBeNull();
		expect(root.textContent).toContain('Bild');
	});

	it('renders an empty text as nothing', () => {
		expect(renderMarkdown('')).toBe('');
	});
});
