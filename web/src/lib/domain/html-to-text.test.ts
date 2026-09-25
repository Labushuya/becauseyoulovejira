// HTML of a mail as plain text (ADR-0017 section 2; E4 plan, package 8): script, style and image
// tags are removed, links, entities, tables and lists become text; nothing is rendered or loaded.

import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from './inbox-mail';

describe('htmlToText', () => {
	it.each([
		['script', '<p>A</p><script>fetch("https://x.example")</script><p>B</p>', 'A\n\nB'],
		['script without end', '<p>A</p><script>alert(1)', 'A'],
		['style', '<style>body{background:url(https://x.example/a.png)}</style>Text', 'Text'],
		['head and title', '<head><title>T</title><meta charset="utf-8"></head>Text', 'Text'],
		['image', 'Vor<img src="https://x.example/p.gif" alt="Pixel">nach', 'Vornach'],
		[
			'svg and iframe',
			'<svg><image href="https://x.example"/></svg><iframe src="https://x.example"></iframe>X',
			'X'
		],
		['comment', 'A<!-- <img src="https://x.example"> -->B', 'AB'],
		['event attribute', '<p onclick="alert(1)">Klick</p>', 'Klick']
	])('removes %s', (_name, html, text) => {
		expect(htmlToText(html)).toBe(text);
	});

	it('writes links as text with the address and drops unsafe ones', () => {
		expect(htmlToText('<a href="https://example.com/a">Seite</a>')).toBe(
			'Seite (https://example.com/a)'
		);
		expect(htmlToText('<a href="https://example.com/a">https://example.com/a</a>')).toBe(
			'https://example.com/a'
		);
		expect(htmlToText("<a href='mailto:a@b.de'>a@b.de</a>")).toBe('a@b.de');
		expect(htmlToText('<a href="mailto:a@b.de">Anna</a>')).toBe('Anna (mailto:a@b.de)');
		expect(htmlToText('<a href="javascript:alert(1)">Klick</a>')).toBe('Klick');
		expect(htmlToText('<a href="data:text/html,x">Klick</a>')).toBe('Klick');
		expect(htmlToText('<a href="https://a.de/?x=1&amp;y=&lt;2">A &amp; B</a>')).toBe(
			'A & B (https://a.de/?x=1&y=<2)'
		);
		expect(htmlToText('<a href="https://a.de/"><img src="https://a.de/b.png"></a>')).toBe(
			'https://a.de/'
		);
	});

	it('keeps blocks, line breaks, lists and tables readable', () => {
		expect(htmlToText('<h1>Titel</h1><p>Eins<br>Zwei</p><div>Drei</div>')).toBe(
			'Titel\n\nEins\nZwei\n\nDrei'
		);
		expect(htmlToText('<ul><li>A</li><li>B</li></ul>')).toBe('- A\n- B');
		expect(
			htmlToText(
				'<table><tr><th>Name</th><th>Preis</th></tr><tr><td>Brot</td> <td>3 &euro;</td></tr></table>'
			)
		).toBe('Name | Preis\nBrot | 3 €');
	});

	it('collapses whitespace and empty lines', () => {
		expect(htmlToText('  A \t  B\r\n\r\n\r\n\r\nC  ')).toBe('A B\n\nC');
		expect(htmlToText('A&nbsp;&nbsp;B')).toBe('A B');
	});
});

describe('decodeEntities', () => {
	it('decodes named and numeric references and keeps unknown ones', () => {
		expect(decodeEntities('&auml;&Ouml;&szlig; &amp; &lt;b&gt; &quot;x&quot; &apos;')).toBe(
			'äÖß & <b> "x" \''
		);
		expect(decodeEntities('&#8364; &#x20AC; &#X1F600;')).toBe('€ € 😀');
		expect(decodeEntities('&unbekannt; &#xD800; &#0; &#x110000; & a')).toBe(
			'&unbekannt; &#xD800; &#0; &#x110000; & a'
		);
	});
});
