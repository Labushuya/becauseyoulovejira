// Markdown rendering and sanitizing (ADR-0008, ADR-0032): XSS cases are neutralised, Markdown
// formatting stays, images are not rendered; underline and task lists with the second layer.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMarkdown, sanitizeMarkdownHtml } from './markdown';

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

	it('drops relative links other than to a ticket', () => {
		for (const href of [
			'/tickets/abc',
			'/tickets/abc123def456ghi/voll',
			'/einstellungen',
			'//example.com/tickets/abc123def456ghi',
			'../tickets/abc123def456ghi'
		]) {
			const link = dom(`[intern](${href})`).querySelector('a');
			expect(link?.hasAttribute('href'), href).toBe(false);
			expect(link?.textContent).toBe('intern');
		}
	});

	it('keeps a link to a ticket of the app, opened in the app (ADR-0042)', () => {
		const link = dom('[HAUS-12 Dach prüfen](/tickets/abc123def456ghi)').querySelector('a');

		expect(link?.getAttribute('href')).toBe('/tickets/abc123def456ghi');
		expect(link?.hasAttribute('target')).toBe(false);
		expect(link?.hasAttribute('rel')).toBe(false);
		expect(link?.textContent).toBe('HAUS-12 Dach prüfen');
	});

	it('does not render images', () => {
		const root = dom('![Bild](https://example.com/bild.png)');

		expect(root.querySelector('img')).toBeNull();
		expect(root.textContent).toContain('Bild');
	});

	it('renders an empty text as nothing', () => {
		expect(renderMarkdown('')).toBe('');
	});

	it('keeps the start of a numbered list', () => {
		expect(dom('3. drei\n4. vier').querySelector('ol')?.getAttribute('start')).toBe('3');
	});
});

describe('renderMarkdown: underline (ADR-0032)', () => {
	it('underlines ++text++ with <u>, also around other marks', () => {
		const root = dom('++unter++ und ++**fett**++ und mitten++drin++');
		const underlined = [...root.querySelectorAll('u')].map((node) => node.innerHTML);

		expect(underlined).toEqual(['unter', '<strong>fett</strong>', 'drin']);
		expect(root.querySelector('ins')).toBeNull();
		expect(attributesOf(root)).toEqual([]);
	});

	it.each([
		['C++ und C++', 'C++ und C++'],
		['a ++ b ++ c', 'a ++ b ++ c'],
		['\\+\\+maskiert\\+\\+', '++maskiert++'],
		['`++code++`', '++code++']
	])('leaves %s as text', (source, text) => {
		const root = dom(source);

		expect(root.querySelector('u')).toBeNull();
		expect(root.textContent?.trim()).toBe(text);
	});
});

describe('renderMarkdown: task lists (ADR-0032)', () => {
	function boxes(root: HTMLElement): HTMLInputElement[] {
		return [...root.querySelectorAll('input')];
	}

	it('turns - [ ] and - [x] into disabled checkboxes named by their text', () => {
		const root = dom('- [ ] Milch\n- [x] Brot\n- [X] Äpfel `bio`');
		const [milk, bread, apples] = boxes(root);

		expect(boxes(root)).toHaveLength(3);
		for (const box of boxes(root)) {
			expect(box.type).toBe('checkbox');
			expect(box.disabled).toBe(true);
		}
		expect([milk?.checked, bread?.checked, apples?.checked]).toEqual([false, true, true]);
		expect(boxes(root).map((box) => box.getAttribute('aria-label'))).toEqual([
			'Milch',
			'Brot',
			'Äpfel bio'
		]);
		expect([...root.querySelectorAll('li')].map((item) => item.dataset.task)).toEqual([
			'0',
			'1',
			'2'
		]);
		expect(root.querySelector('li')?.textContent).toBe('Milch');
	});

	it('counts tasks through nested lists, quotes and loose lists in document order', () => {
		const root = dom(
			['- [ ] Eltern', '  - [x] Kind', '', '> - [ ] Zitat', '', '* [ ] a', '', '* [x] b'].join('\n')
		);

		expect(boxes(root).map((box) => box.getAttribute('aria-label'))).toEqual([
			'Eltern',
			'Kind',
			'Zitat',
			'a',
			'b'
		]);
		expect(
			[...root.querySelectorAll('li[data-task]')].map((item) => item.getAttribute('data-task'))
		).toEqual(['0', '1', '2', '3', '4']);
	});

	it('knows an empty task and falls back to a number as its name', () => {
		const root = dom('- [ ]\n- [x] ');

		expect(boxes(root).map((box) => box.getAttribute('aria-label'))).toEqual([
			'Aufgabe 1',
			'Aufgabe 2'
		]);
	});

	it.each([
		['numbered list', '1. [ ] eins'],
		['code block', '```\n- [ ] Code\n```'],
		['indented code', '    - [ ] Code'],
		['inline code', '- `[ ] Code`'],
		['middle of a sentence', 'Text [ ] mitten'],
		['no space after the marker', '- [ ]x'],
		['formatting right after the marker', '- [ ]**fett**'],
		['escaped brackets', '- \\[ \\] maskiert'],
		['other letter', '- [y] nein'],
		['second paragraph of an item', '- Punkt\n\n  [ ] zweiter Absatz'],
		['link', '- [x](https://example.com)']
	])('makes no task of a %s', (_name, source) => {
		const root = dom(source);

		expect(root.querySelector('input')).toBeNull();
		expect(root.querySelector('[data-task]')).toBeNull();
	});

	it('escapes the name of the checkbox', () => {
		const box = dom('- [ ] <b onclick="x()">roh</b> & "zitiert"').querySelector('input');

		expect(box?.getAttribute('aria-label')).toBe('<b onclick="x()">roh</b> & "zitiert"');
		expect(box?.getAttributeNames().sort()).toEqual(['aria-label', 'disabled', 'type']);
	});

	it('shortens a long name', () => {
		const label = dom(`- [ ] ${'x'.repeat(300)}`)
			.querySelector('input')
			?.getAttribute('aria-label');

		expect(label).toHaveLength(200);
		expect(label?.endsWith('…')).toBe(true);
	});
});

describe('sanitizeMarkdownHtml: second layer for underline and tasks (ADR-0032 section 3)', () => {
	function fragment(html: string): HTMLElement {
		const container = document.createElement('div');
		container.innerHTML = sanitizeMarkdownHtml(html);
		return container;
	}

	it('keeps the checkbox of a task, always disabled', () => {
		const root = fragment(
			'<ul><li data-task="12"><input type="checkbox" checked aria-label="A"> A</li></ul>'
		);
		const box = root.querySelector('input');

		expect(root.querySelector('li')?.dataset.task).toBe('12');
		expect(box?.checked).toBe(true);
		expect(box?.disabled).toBe(true);
		expect(box?.getAttribute('aria-label')).toBe('A');
	});

	it.each([
		['text input', '<input type="text" value="x">'],
		['input without type', '<input value="x">'],
		['hidden input', '<input type="hidden" name="x" value="y">'],
		['submit button', '<input type="submit" formaction="https://example.com">'],
		['image input', '<input type="image" src="https://example.com/x.png">'],
		['radio', '<input type="radio" name="r">']
	])('removes an input that is no checkbox (%s)', (_name, html) => {
		expect(fragment(`<p>${html}</p>`).querySelector('input')).toBeNull();
	});

	it('strips everything but the own attributes from a checkbox', () => {
		const box = fragment(
			'<input type="checkbox" onclick="alert(1)" onchange="alert(2)" name="n" form="f" value="v" formaction="https://example.com" id="i" class="c" style="color:red" title="t" data-task="1" data-x="y">'
		).querySelector('input');

		expect(box?.getAttributeNames().sort()).toEqual(['disabled', 'type']);
	});

	it.each([
		['words', '1 onclick'],
		['a script', 'javascript:alert(1)'],
		['a negative number', '-1'],
		['too many digits', '12345'],
		['nothing', '']
	])('drops data-task with %s', (_name, value) => {
		const item = fragment(`<ul><li data-task="${value}">x</li></ul>`).querySelector('li');

		expect(item?.hasAttribute('data-task')).toBe(false);
	});

	it('allows data-task on li only and checkbox attributes on input only', () => {
		const root = fragment(
			'<p data-task="1" aria-label="p" type="x">a</p><ol type="a" start="2" disabled><li checked>b</li></ol><a href="https://example.com" aria-label="l" data-task="2">c</a>'
		);

		expect(attributesOf(root).sort()).toEqual(['a[href]', 'a[rel]', 'a[target]', 'ol[start]']);
	});

	it('keeps <u> without event handlers or styles', () => {
		const root = fragment('<u onmouseover="alert(1)" style="color:red" class="x">u</u>');

		expect(root.innerHTML).toBe('<u>u</u>');
	});
});

describe('renderMarkdown: raw HTML around the extensions stays text', () => {
	it.each([
		['script in underline', '++<script>alert(1)</script>++'],
		['input in a task', '- [ ] <input type="text" autofocus onfocus="alert(1)">'],
		['checkbox with handler', '<input type="checkbox" onclick="alert(1)">'],
		['u with handler', '<u onmouseover="alert(1)">x</u>'],
		['data-task with handler', '<li data-task="1 onclick">x</li>'],
		['javascript link in a task', '- [ ] [klick](javascript:alert(1))'],
		['data link in underline', '++[x](data:text/html,<script>alert(1)</script>)++']
	])('%s', (_name, source) => {
		const root = dom(source);

		for (const element of root.querySelectorAll('*')) {
			for (const name of element.getAttributeNames()) {
				expect(name.startsWith('on'), `${element.tagName} ${name}`).toBe(false);
			}
		}
		expect(root.querySelector('script')).toBeNull();
		for (const input of root.querySelectorAll('input')) {
			expect(input.type).toBe('checkbox');
			expect(input.disabled).toBe(true);
		}
		for (const link of root.querySelectorAll('a')) {
			expect(link.getAttribute('href') ?? '').toMatch(/^(?:https?:|mailto:|$)/i);
		}
	});
});

describe('renderMarkdown: corpus (web/src/lib/test/markdown-corpus)', () => {
	const corpusDir = join(import.meta.dirname, 'test', 'markdown-corpus');
	const corpus = readdirSync(corpusDir)
		.filter((name) => name.endsWith('.md'))
		.map((name) => [name, readFileSync(join(corpusDir, name), 'utf8')] as const);

	it('holds the texts of the generators and hand-written Markdown', () => {
		expect(corpus.map(([name]) => name)).toEqual(
			expect.arrayContaining(['hand.md', 'mail.md', 'tasks.md', 'underline-html.md'])
		);
	});

	it.each(corpus)(
		'%s renders without scripts, handlers or foreign inputs, also with CRLF',
		(_name, source) => {
			for (const text of [source, source.replace(/\n/g, '\r\n')]) {
				const root = dom(text);

				expect(root.querySelector('script, style, img, iframe, form, svg')).toBeNull();
				for (const element of root.querySelectorAll('*')) {
					expect(element.getAttributeNames().filter((name) => name.startsWith('on'))).toEqual([]);
				}
				for (const input of root.querySelectorAll('input')) {
					expect(input.type).toBe('checkbox');
					expect(input.disabled).toBe(true);
					expect(input.closest('li[data-task]')).not.toBeNull();
				}
			}
			expect(renderMarkdown(source.replace(/\n/g, '\r\n'))).toBe(renderMarkdown(source));
		}
	);

	it('keeps a page text of 100 000 characters as text', () => {
		const line =
			'[Anzeige] Jetzt <kaufen> & sparen *inkl.* _Versand_ ++C++ https://example.com/?a=1\n';
		const source = line.repeat(Math.ceil(100_000 / line.length)).slice(0, 100_000);
		const root = dom(source);

		expect(root.textContent).toContain('<kaufen>');
		expect(root.querySelector('input')).toBeNull();
		expect(root.querySelectorAll('a').length).toBeGreaterThan(1000);
	});
});
