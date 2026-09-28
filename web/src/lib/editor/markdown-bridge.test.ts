// The bridge between editor and Markdown (ADR-0032 section 2) is the core gate of the editor
// (plan editor section 3.6): for every text of the corpus the editor can open, the display of
// the written Markdown equals the display of the text, the round trip is stable after the first
// pass, raw HTML stays text, and task indices match the display. Documents built in the editor
// write Markdown that shows what the editor showed.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { markdownTokens, renderMarkdown } from '$lib/markdown';
import { bridge, checkEditable, editorSchema as schema } from './create-editor';
import { NotEditableError } from './markdown-bridge';
import { canonicalHtml, sameDisplay } from './parity';
import { richEditable } from './rich-editable';

const CORPUS_DIR = join(import.meta.dirname, '..', 'test', 'markdown-corpus');
const corpus = readdirSync(CORPUS_DIR)
	.filter((name) => name.endsWith('.md'))
	.map((name) => [name, readFileSync(join(CORPUS_DIR, name), 'utf8')] as const);

/** Texts the editor cannot hold (ADR-0032 section 4). */
const NOT_EDITABLE: Record<string, string> = {
	'table.md': 'table',
	'tasks-mixed.md': 'mixed-list'
};

/** A long page text as HK-4 stores it: unmasked, close to 100 000 characters. */
function longPage(): string {
	const lines = [
		'Startseite | Produkte | Kontakt',
		'* Menü',
		'1. Schritt: Anmelden',
		'#hashtag und @name',
		'[Anzeige] Jetzt <kaufen> & sparen',
		'Preis: 19,99 € *inkl.* MwSt. _Versand_ extra',
		'https://example.com/seite?a=1&b=2',
		'> Zitat aus der Seite',
		'    eingerückte Zeile',
		'===',
		'© 2026 Beispiel GmbH',
		''
	];
	let text = '- **Link:** <https://example.com/lange-seite>\n\n> Auszug der Seite\\.\n\n';
	for (let i = 0; text.length < 99_000; i++) text += `${lines[i % lines.length]}\n`;
	return text;
}

const roundTrip = (markdown: string) => bridge.serialize(bridge.parse(markdown));

const editable = [
	...corpus.filter(([name]) => !(name in NOT_EDITABLE)),
	['mail.md with CRLF', readFileSync(join(CORPUS_DIR, 'mail.md'), 'utf8').replace(/\n/g, '\r\n')],
	['long page', longPage()]
] as const;

describe('markdown bridge: corpus', () => {
	it.each(editable)(
		'%s shows the same after the round trip and stays stable',
		(_name, markdown) => {
			const once = roundTrip(markdown);
			expect(canonicalHtml(renderMarkdown(once))).toBe(canonicalHtml(renderMarkdown(markdown)));
			expect(roundTrip(once)).toBe(once);
			expect(checkEditable(markdown).editable).toBe(true);
		},
		// The long page text takes seconds in jsdom (DOMPurify and the parity), more on CI.
		30_000
	);

	it.each(Object.entries(NOT_EDITABLE))('%s is not editable (%s)', (name, reason) => {
		const markdown = readFileSync(join(CORPUS_DIR, name), 'utf8');
		expect(() => bridge.parse(markdown)).toThrow(NotEditableError);
		expect(checkEditable(markdown)).toEqual({ editable: false, reason });
	});

	it('keeps raw HTML as text', () => {
		const markdown = readFileSync(join(CORPUS_DIR, 'underline-html.md'), 'utf8');
		const doc = bridge.parse(markdown);
		expect(doc.textContent).toContain('<b>roh</b>');
		expect(doc.textContent).toContain('<script>alert(1)</script>');
		const html = renderMarkdown(roundTrip(markdown));
		expect(html).not.toMatch(/<(b|script|img|span|table)\b/);
	});

	it('numbers the tasks like the display', () => {
		const markdown = readFileSync(join(CORPUS_DIR, 'tasks.md'), 'utf8');
		const doc = bridge.parse(markdown);
		const items: boolean[] = [];
		doc.descendants((node) => {
			if (node.type.name === 'taskItem') items.push(node.attrs.checked as boolean);
		});
		const display = markdownTokens(markdown)
			.flatMap((token) => token.children ?? [])
			.filter((child) => child.type === 'task_checkbox')
			.map((child) => (child.meta as { checked: boolean }).checked);
		expect(items).toEqual(display);
		expect(items.length).toBeGreaterThan(2);
	});

	it('keeps tightness, bullets, delimiters and the start of lists', () => {
		const markdown = '* a\n* b\n\n+ c\n\n  d\n+ e\n\n3) x\n4) y\n';
		const parsed = bridge.parse(markdown);
		const lists = parsed.content.content.map((node) => [node.type.name, node.attrs]);
		expect(lists).toEqual([
			['bulletList', expect.objectContaining({ tight: true, bullet: '*' })],
			['bulletList', expect.objectContaining({ tight: false, bullet: '+' })],
			['orderedList', expect.objectContaining({ tight: true, delimiter: ')', start: 3 })]
		]);
		expect(roundTrip(markdown)).toBe('* a\n* b\n\n\n+ c\n\n  d\n\n+ e\n\n3) x\n4) y');
		expect(sameDisplay(renderMarkdown(roundTrip(markdown)), renderMarkdown(markdown))).toBe(true);
	});
});

/** Nodes of the editor schema for built documents. */
const text = (value: string, ...marks: string[]) =>
	schema.text(
		value,
		marks.map((mark) => schema.marks[mark]!.create())
	);
const br = () => schema.nodes.hardBreak!.create();
const p = (...content: Node[]) => schema.nodes.paragraph!.create(null, content);
const doc = (...content: Node[]) => schema.nodes.doc!.create(null, content);
const item = (...content: Node[]) => schema.nodes.listItem!.create(null, content);
const task = (checked: boolean, ...content: Node[]) =>
	schema.nodes.taskItem!.create({ checked }, content);
const bullets = (...items: Node[]) => schema.nodes.bulletList!.create(null, items);
const tasks = (...items: Node[]) => schema.nodes.taskList!.create(null, items);
const numbered = (...items: Node[]) => schema.nodes.orderedList!.create(null, items);

/** The document shows in the display as the editor shows it (its own HTML through the parity). */
function showsLikeEditor(built: Node, expectedHtml: string) {
	const markdown = bridge.serialize(built);
	expect(sameDisplay(renderMarkdown(markdown), expectedHtml), markdown).toBe(true);
	const again = roundTrip(markdown);
	expect(sameDisplay(renderMarkdown(again), expectedHtml), again).toBe(true);
	expect(roundTrip(again)).toBe(again);
	return markdown;
}

describe('markdown bridge: documents built in the editor', () => {
	it.each([
		['- b', '<p>a<br>- b</p>'],
		['1. b', '<p>a<br>1. b</p>'],
		['1) b', '<p>a<br>1) b</p>'],
		['+', '<p>a<br>+</p>'],
		['# b', '<p>a<br># b</p>'],
		['> b', '<p>a<br>&gt; b</p>'],
		['===', '<p>a<br>===</p>'],
		['---', '<p>a<br>---</p>'],
		['| x | y |', '<p>a<br>| x | y |</p>'],
		[':-- | --', '<p>a<br>:-- | --</p>']
	])('escapes "%s" at the start of a line after a line break', (line, html) => {
		showsLikeEditor(doc(p(text('a'), br(), text(line))), html);
	});

	it.each([
		['1) b', '<p>1) b</p>'],
		['+', '<p>+</p>'],
		['1.', '<p>1.</p>'],
		['    vier Leerzeichen', '<p>vier Leerzeichen</p>']
	])('escapes "%s" at the start of a paragraph', (line, html) => {
		showsLikeEditor(doc(p(text(line))), html);
	});

	it('keeps two line breaks in a row inside the paragraph', () => {
		const markdown = showsLikeEditor(doc(p(text('a'), br(), br(), text('b'))), '<p>a<br><br>b</p>');
		expect(markdown).toBe('a\n\\\nb');
	});

	it('drops line breaks at the end of a paragraph and turns one in a heading into a space', () => {
		expect(bridge.serialize(doc(p(text('a'), br())))).toBe('a');
		const heading = schema.nodes.heading!.create({ level: 2 }, [text('a'), br(), text('b')]);
		expect(bridge.serialize(doc(heading))).toBe('## a b');
	});

	it('keeps lists apart that follow each other', () => {
		showsLikeEditor(
			doc(bullets(item(p(text('a')))), bullets(item(p(text('b'))))),
			'<ul><li>a</li></ul><ul><li>b</li></ul>'
		);
		showsLikeEditor(
			doc(bullets(item(p(text('a')))), tasks(task(false, p(text('b'))))),
			'<ul><li>a</li></ul><ul><li data-task="0"><input type="checkbox" disabled aria-label="b">b</li></ul>'
		);
		showsLikeEditor(
			doc(numbered(item(p(text('a')))), numbered(item(p(text('b'))))),
			'<ol><li>a</li></ol><ol><li>b</li></ol>'
		);
	});

	it('writes underline, "C++" and marks around each other', () => {
		const markdown = showsLikeEditor(
			doc(p(text('C++ und '), text('fett unterstrichen', 'bold', 'underline'))),
			'<p>C++ und <strong><u>fett unterstrichen</u></strong></p>'
		);
		expect(markdown).toContain('\\+\\+');
	});

	it('writes links with brackets and quotes and inline code with backticks', () => {
		const link = schema.marks.link!.create({ href: 'https://example.com/a_(b)', title: 'Ein "T"' });
		showsLikeEditor(
			doc(p(schema.text('Link', [link]), text(' und '), text('a`b', 'code'))),
			'<p><a href="https://example.com/a_(b)" title="Ein &quot;T&quot;">Link</a> und <code>a`b</code></p>'
		);
	});

	it('writes a code block holding a fence', () => {
		const block = schema.nodes.codeBlock!.create({ language: 'md' }, [schema.text('```\nx\n```')]);
		const markdown = bridge.serialize(doc(block));
		expect(bridge.parse(markdown).eq(doc(block))).toBe(true);
	});

	it('keeps "&", entities and autolinks in text as text', () => {
		// The display links a bare address in any text (linkify); the brackets stay text.
		showsLikeEditor(
			doc(p(text('A & B, &amp; und <https://example.com>'))),
			'<p>A &amp; B, &amp;amp; und &lt;<a href="https://example.com">https://example.com</a>&gt;</p>'
		);
	});
});

describe('parity', () => {
	it('ignores the order of nested marks and blanks between tags', () => {
		expect(
			sameDisplay('<p><u><strong>x</strong></u> y</p>\n', '<p><strong><u>x</u></strong> y</p>')
		).toBe(true);
	});

	it('sees different text, marks, links and blocks', () => {
		expect(sameDisplay('<p>a b</p>', '<p>ab</p>')).toBe(false);
		expect(sameDisplay('<p><em>a</em></p>', '<p><strong>a</strong></p>')).toBe(false);
		expect(
			sameDisplay('<p><a href="https://a">x</a></p>', '<p><a href="https://b">x</a></p>')
		).toBe(false);
		expect(sameDisplay('<p>a</p><p>b</p>', '<p>a<br>b</p>')).toBe(false);
		expect(sameDisplay('<ol start="3"><li>a</li></ol>', '<ol><li>a</li></ol>')).toBe(false);
	});

	it('opens a text in the source mode when the display would change', () => {
		// A bridge that loses a mark: the check compares the displays and says no.
		const lossy = { parse: bridge.parse, serialize: () => 'fett' };
		expect(richEditable('**fett**', lossy)).toEqual({ editable: false, reason: 'difference' });
		expect(richEditable('**fett**', bridge).editable).toBe(true);
		expect(richEditable('', lossy).editable).toBe(true);
	});
});
