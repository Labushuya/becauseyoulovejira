// Text of a page for the page copy (ADR-0031 section 6): app/pb_hooks/lib/html-text.js is an ES5
// copy of htmlToText in web/src/lib/domain/inbox-mail.ts. Both give the same text for the same
// HTML (parity over hand-written cases, the HTML mail fixture and random markup), and the title
// of a page is read on one line.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from '../../web/src/lib/domain/inbox-mail.ts';
import { loadHookLib } from '../support/hook-lib.mjs';

const lib = loadHookLib('html-text.js');

const CASES = [
	'<p>Hallo <b>Welt</b></p>',
	'<html><head><title>Titel</title><style>p{color:red}</style></head><body><h1>Kopf</h1><p>Text</p></body></html>',
	'<script>alert(1)</script><p>Nach dem Skript</p><script>ohne Ende',
	'<!-- Kommentar --><div>A<br>B<br/>C</div><!-- offen',
	'<ul><li>Eins</li><li>Zwei</li></ul><ol><li>Drei</ol>',
	'<table><tr><th>Artikel</th><th>Preis</th></tr><tr><td>Brot</td><td>3 &euro;</td></tr></table>',
	'<a href="https://example.com/a">Seite</a> und <a href="https://example.com/a">https://example.com/a</a>',
	"<a href='mailto:a@b.de'>a@b.de</a> <a href=\"mailto:a@b.de\">Anna</a> <a href=javascript:alert(1)>Klick</a>",
	'<a href="https://a.de/?x=1&amp;y=&lt;2">A &amp; B</a> <a href="https://a.de/"><img src="https://a.de/b.png"></a>',
	'<a href="data:text/html,x">Daten</a><a href=" https://a.de/ ">Leer</a>',
	'<svg><text>weg</text></svg><iframe src="https://evil.example/">weg</iframe><object>weg</object><noscript>weg</noscript>',
	'<template><p>weg</p></template><img src="x" onerror="alert(1)">Bild',
	'A&nbsp;&nbsp;B &auml;&ouml;&uuml; &Auml; &szlig; &#8364; &#x1F600; &#0; &#xD800; &bogus; &#99999999;',
	'  A \t  B\r\n\r\n\r\n\r\nC  ',
	'<blockquote>Zitat</blockquote><pre>  vor  </pre><hr><dl><dt>Wort</dt><dd>Bedeutung</dd></dl>',
	'<p>Absatz<p>ohne Ende<div>verschachtelt <span>innen</span></div>',
	'',
	'nur Text ohne Tags'
];

describe('htmlToText of the hook and of the SPA', () => {
	it.each(CASES.map((html, index) => [index, html]))('case %i gives the same text', (_index, html) => {
		expect(lib.htmlToText(html)).toBe(htmlToText(html));
	});

	it('gives the same text for the HTML mail fixture', () => {
		const mail = readFileSync(new URL('../fixtures/eml/html-only.eml', import.meta.url), 'latin1');
		const html = mail.slice(mail.indexOf('<'));
		expect(lib.htmlToText(html)).toBe(htmlToText(html));
		expect(lib.htmlToText(html)).toContain('Zum Angebot (https://shop.example.com/angebot?a=1&b=2)');
	});

	it('gives the same text for random markup', () => {
		const parts = ['<p>', '</p>', '<br>', '<a href="https://x.de/?a&amp;b">', '</a>', '<li>', '<td>', '</td>', '<tr>', '&amp;', '&#228;', 'Wort', ' ', '\n', '<script>', '</script>', '<!--', '-->', '<b>', '</b>'];
		let seed = 42;
		const next = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed;
		};
		for (let round = 0; round < 300; round++) {
			let html = '';
			const length = next() % 40;
			for (let i = 0; i < length; i++) html += parts[next() % parts.length];
			expect(lib.htmlToText(html), html).toBe(htmlToText(html));
		}
	});

	it('decodes entities like the SPA', () => {
		for (const text of ['&amp;lt;', '&#x41;&#66;', '&euro;&hellip;&bogus;', '&#1114111;', '&#1114112;']) {
			expect(lib.decodeEntities(text), text).toBe(decodeEntities(text));
		}
	});
});

describe('pageTitle', () => {
	it('reads the title on one line with entities decoded', () => {
		expect(lib.pageTitle('<html><head><title>\n  Rezepte &amp; Tipps\n</title></head></html>')).toBe(
			'Rezepte & Tipps'
		);
		expect(lib.pageTitle('<TITLE lang="de">Kurz</TITLE>')).toBe('Kurz');
		expect(lib.pageTitle('<p>ohne Titel</p>')).toBe('');
	});
});
