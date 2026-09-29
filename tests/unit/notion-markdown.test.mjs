// Notion blocks as Markdown of the app (ADR-0041, editor conventions of ADR-0032):
// app/pb_hooks/lib/notion-markdown.js. The output is read back with the parser of the display
// (web/src/lib/markdown.ts), so escaped text shows exactly as typed in Notion, and formats, lists,
// tasks and tables become what they were.

import { describe, expect, it } from 'vitest';
import { markdownTokens } from '../../web/src/lib/markdown.ts';
import { loadHookLib } from '../support/hook-lib.mjs';

const md = loadHookLib('notion-markdown.js');

const PLAIN = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };

function rt(content, annotations = {}, link = null) {
	return { type: 'text', text: { content, link: link === null ? null : { url: link } }, annotations: { ...PLAIN, ...annotations }, plain_text: content, href: link };
}

let next = 0;
function block(type, payload = {}, children) {
	next += 1;
	const id = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
	return { object: 'block', id, type, has_children: children !== undefined, [type]: payload, ...(children === undefined ? {} : { children }) };
}

const paragraph = (...items) => block('paragraph', { rich_text: items });
const render = (blocks, maxBlocks = 500, maxChars = 50_000) => md.blocksToMarkdown(blocks, maxBlocks, maxChars);

/** Text of the inline tokens as the display shows it, line breaks as "\n". */
function shownText(markdown) {
	return markdownTokens(markdown)
		.filter((token) => token.type === 'inline')
		.map((token) =>
			token.children
				.map((child) => (child.type === 'softbreak' || child.type === 'hardbreak' ? '\n' : child.type === 'task_checkbox' ? '' : child.content))
				.join('')
		)
		.join('\n');
}

describe('escaping: what Notion shows stays text', () => {
	const TEXTS = [
		'*nicht fett* und _nicht kursiv_',
		'**auch nicht** __so__',
		'`kein Code`',
		'[kein](https://example.com/link) Link',
		'<b>kein HTML</b> <https://example.com>',
		'~~nicht durch~~ und ~5 Minuten',
		'C++ und ++nicht unterstrichen++',
		'a\\b und \\*',
		'&amp; &#169; & bleibt',
		'Preis: 3 | 4',
		'snake_case_name',
		'![kein Bild](https://example.com/b.png)'
	];

	it.each(TEXTS)('%s', (text) => {
		const { markdown } = render([paragraph(rt(text))]);
		expect(shownText(markdown)).toBe(text);
		expect(markdownTokens(markdown).map((token) => token.type)).toEqual(['paragraph_open', 'inline', 'paragraph_close']);
	});

	const STARTS = ['# kein Titel', '## auch nicht', '> kein Zitat', '- kein Punkt', '+ kein Punkt', '* kein Punkt', '1. kein Punkt', '2) auch nicht', '---', '===', '    kein Code'];

	it.each(STARTS)('keeps "%s" at the start of a line a paragraph', (text) => {
		const { markdown } = render([paragraph(rt(`Zeile\n${text}`))]);
		const types = markdownTokens(markdown).map((token) => token.type);
		expect(types).toEqual(['paragraph_open', 'inline', 'paragraph_close']);
		expect(shownText(render([paragraph(rt(text))]).markdown)).toBe(text.trim());
	});
});

describe('rich text', () => {
	it('writes the marks of the editor, outside of the white space', () => {
		expect(md.richTextToMarkdown([rt('fett', { bold: true }), rt(' und '), rt('kursiv', { italic: true })])).toBe('**fett** und *kursiv*');
		expect(md.richTextToMarkdown([rt(' Leer ', { bold: true })])).toBe(' **Leer** ');
		expect(md.richTextToMarkdown([rt('x', { strikethrough: true }), rt(' '), rt('y', { underline: true })])).toBe('~~x~~ ++y++');
		expect(md.richTextToMarkdown([rt('a`b', { code: true })])).toBe('``a`b``');
		expect(md.richTextToMarkdown([rt('beides', { bold: true, italic: true })])).toBe('***beides***');
	});

	it('joins runs with the same marks', () => {
		expect(md.richTextToMarkdown([rt('ein', { bold: true }), rt('Wort', { bold: true })])).toBe('**einWort**');
	});

	it('keeps only http(s) and mailto links and links mentioned pages to Notion', () => {
		expect(md.richTextToMarkdown([rt('Seite', {}, 'https://example.com/a(b)')])).toBe('[Seite](https://example.com/a%28b%29)');
		expect(md.richTextToMarkdown([rt('Mail', {}, 'mailto:anna@example.com')])).toBe('[Mail](mailto:anna@example.com)');
		expect(md.richTextToMarkdown([rt('Böse', {}, 'javascript:alert(1)')])).toBe('Böse');
		const mention = { type: 'mention', mention: { type: 'page', page: { id: '0000000000004000800000000000abcd' } }, annotations: PLAIN, plain_text: 'Plan', href: null };
		expect(md.richTextToMarkdown([mention])).toBe('[Plan](https://www.notion.so/0000000000004000800000000000abcd)');
	});

	it('writes a date mention as German date and an equation as code', () => {
		const date = { type: 'mention', mention: { type: 'date', date: { start: '2026-10-02', end: '2026-10-04' } }, annotations: PLAIN, plain_text: '2026-10-02 → 2026-10-04', href: null };
		expect(md.richTextToMarkdown([date])).toBe('02.10.2026 – 04.10.2026');
		expect(md.plainText([date])).toBe('02.10.2026 – 04.10.2026');
		const equation = { type: 'equation', equation: { expression: 'a*b' }, annotations: PLAIN, plain_text: 'a*b', href: null };
		expect(md.richTextToMarkdown([equation])).toBe('`a*b`');
	});

	it('ignores what is no rich text', () => {
		expect(md.richTextToMarkdown(undefined)).toBe('');
		expect(md.richTextToMarkdown([null, 5, rt('')])).toBe('');
		expect(md.plainText('text')).toBe('');
	});
});

describe('blocks', () => {
	it('writes headings, paragraphs, quotes, callouts, code and rules', () => {
		const { markdown } = render([
			block('heading_1', { rich_text: [rt('Eins')] }),
			block('heading_4', { rich_text: [rt('Vier')] }),
			paragraph(rt('Absatz')),
			block('quote', { rich_text: [rt('Zitat')] }, [paragraph(rt('darin'))]),
			block('callout', { rich_text: [rt('Achtung')], icon: { type: 'emoji', emoji: '💡' } }),
			block('code', { rich_text: [rt('a = "```"\nb = 1')], language: 'python' }),
			block('code', { rich_text: [rt('text')], language: 'plain text' }),
			block('divider'),
			block('equation', { expression: 'e=mc^2' })
		]);
		expect(markdown).toBe(
			['# Eins', '#### Vier', 'Absatz', '> Zitat\n>\n> darin', '> 💡 Achtung', '````python\na = "```"\nb = 1\n````', '```\ntext\n```', '---', '`e=mc^2`'].join('\n\n')
		);
	});

	it('writes lists with nested points, tasks and numbering', () => {
		const { markdown } = render([
			block('to_do', { rich_text: [rt('offen')], checked: false }, [block('bulleted_list_item', { rich_text: [rt('darunter')] })]),
			block('to_do', { rich_text: [rt('erledigt')], checked: true }),
			block('numbered_list_item', { rich_text: [rt('drei')], list_start_index: 3 }, [paragraph(rt('Text'))]),
			block('numbered_list_item', { rich_text: [rt('vier')] }),
			block('toggle', { rich_text: [rt('Aufklappen')] }, [paragraph(rt('Inhalt'))])
		]);
		expect(markdown).toBe('- [ ] offen\n  - darunter\n- [x] erledigt\n\n3. drei\n   Text\n4. vier\n\n- Aufklappen\n  Inhalt');
		const tokens = markdownTokens(markdown);
		const tasks = tokens.flatMap((token) => token.children ?? []).filter((child) => child.type === 'task_checkbox');
		expect(tasks.map((task) => task.meta.checked)).toEqual([false, true]);
		expect(tokens.filter((token) => token.type === 'ordered_list_open')[0].attrGet('start')).toBe(3);
	});

	it('writes tables with and without header, pipes escaped', () => {
		const table = (header) =>
			block('table', { table_width: 2, has_column_header: header }, [
				block('table_row', { cells: [[rt('A')], [rt('B|C')]] }),
				block('table_row', { cells: [[rt('1')], []] })
			]);
		expect(render([table(true)]).markdown).toBe('| A | B\\|C |\n| --- | --- |\n| 1 |  |');
		expect(render([table(false)]).markdown).toBe('|  |  |\n| --- | --- |\n| A | B\\|C |\n| 1 |  |');
		expect(markdownTokens(render([table(true)]).markdown).some((token) => token.type === 'table_open')).toBe(true);
	});

	it('links external media and bookmarks, names files of Notion without their address', () => {
		const { markdown } = render([
			block('image', { type: 'external', external: { url: 'https://example.com/bild.png' }, caption: [rt('Skizze')] }),
			block('file', { type: 'file', file: { url: 'https://s3.example.com/signed?X-Amz=1', expiry_time: '' }, name: 'plan.pdf', caption: [] }),
			block('bookmark', { url: 'https://example.com/artikel', caption: [] }),
			block('child_page', { title: 'Unterseite' }),
			block('child_database', { title: 'Tabelle' })
		]);
		expect(markdown).toContain('[Bild: Skizze](https://example.com/bild.png)');
		expect(markdown).toContain('_Datei: plan.pdf (in Notion)_');
		expect(markdown).not.toContain('s3.example.com');
		expect(markdown).toContain('[https://example.com/artikel](https://example.com/artikel)');
		expect(markdown).toMatch(/\[Unterseite: Unterseite\]\(https:\/\/www\.notion\.so\/[0-9a-f]{32}\)/);
		expect(markdown).toMatch(/\[Datenbank: Tabelle\]\(https:\/\/www\.notion\.so\/[0-9a-f]{32}\)/);
	});

	it('renders the children of containers, leaves out empty blocks and names unsupported ones', () => {
		const { markdown } = render([
			block('column_list', {}, [block('column', {}, [paragraph(rt('links'))]), block('column', {}, [paragraph(rt('rechts'))])]),
			block('table_of_contents', {}),
			paragraph(),
			block('unsupported', { block_type: 'form' }),
			block('meeting_notes', {})
		]);
		expect(markdown).toBe('links\n\nrechts\n\n_Nicht übernommen: Inhalt der Art „form“._\n\n_Nicht übernommen: Inhalt der Art „meeting\\_notes“._');
	});

	it('stops at the limits and says so', () => {
		const many = Array.from({ length: 10 }, (_, index) => paragraph(rt(`Absatz ${index}`)));
		const byBlocks = render(many, 3);
		expect(byBlocks).toMatchObject({ markdown: 'Absatz 0\n\nAbsatz 1\n\nAbsatz 2', blocks: 3, truncated: true });
		const byChars = render(many, 500, 25);
		expect(byChars.truncated).toBe(true);
		expect(byChars.markdown.length).toBeLessThanOrEqual(25);
		expect(render(many)).toMatchObject({ blocks: 10, truncated: false });
	});
});

describe('addresses', () => {
	it('builds Notion addresses only from IDs', () => {
		expect(md.notionUrl('0000000A-0000-4000-8000-00000000000B')).toBe('https://www.notion.so/0000000a000040008000' + '00000000000b');
		expect(md.notionUrl('../x')).toBe('');
		expect(md.safeHref('https://example.com/ a')).toBe('');
		expect(md.safeHref('ftp://example.com')).toBe('');
		expect(md.safeHref(`https://example.com/${'a'.repeat(2000)}`)).toBe('');
	});
});
