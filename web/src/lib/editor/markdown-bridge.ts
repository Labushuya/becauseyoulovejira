// Bridge between the Tiptap schema of the editor and Markdown (ADR-0032 section 2, way B of the
// spike RT-0): MarkdownParser and MarkdownSerializer of prosemirror-markdown on the tokens of the
// markdown-it instance of the display. What the display shows as text stays text in the editor;
// the serializer writes Markdown that the display renders like the editor showed it.
//
// Only loaded with the editor (import() on the first "Bearbeiten", editor-lazy.test.ts).

import type { Token } from 'markdown-it';
import {
	MarkdownParser,
	MarkdownSerializer,
	type MarkdownSerializerState
} from 'prosemirror-markdown';
import type { Mark, Node, Schema } from '@tiptap/pm/model';
import { markdownTokens } from '$lib/markdown';

/** Why a text cannot be edited in the editor without changing it. */
export type NotEditableReason = 'table' | 'mixed-list' | 'unknown';

/** Thrown by `parse` for a text the schema cannot hold (ADR-0032 section 4). */
export class NotEditableError extends Error {
	constructor(readonly reason: NotEditableReason) {
		super(`Not editable: ${reason}`);
		this.name = 'NotEditableError';
	}
}

/** Block and inline tokens of the display the bridge maps; anything else is not editable. */
const KNOWN_TOKENS = new Set([
	'paragraph_open',
	'paragraph_close',
	'heading_open',
	'heading_close',
	'blockquote_open',
	'blockquote_close',
	'bullet_list_open',
	'bullet_list_close',
	'ordered_list_open',
	'ordered_list_close',
	'list_item_open',
	'list_item_close',
	'code_block',
	'fence',
	'hr',
	'inline',
	'text',
	'softbreak',
	'hardbreak',
	'em_open',
	'em_close',
	'strong_open',
	'strong_close',
	's_open',
	's_close',
	'ins_open',
	'ins_close',
	'link_open',
	'link_close',
	'code_inline',
	'task_checkbox'
]);

/** First token type that is not in the list, or null. */
function unknownToken(tokens: readonly Token[]): string | null {
	for (const token of tokens) {
		if (!KNOWN_TOKENS.has(token.type)) return token.type;
		const inner = token.children === null ? null : unknownToken(token.children);
		if (inner !== null) return inner;
	}
	return null;
}

/** Whether the items of the list opened at `index` are tight (paragraphs hidden). */
function listIsTight(tokens: readonly Token[], index: number): boolean {
	for (let i = index + 1; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token.type !== 'list_item_open' && token.type !== 'task_item_open') return token.hidden;
	}
	return false;
}

/**
 * Bullet lists whose items are all tasks become task lists; a list with tasks and other items is
 * not editable (the schema has no such list, ADR-0032 section 2). Numbered lists never hold tasks.
 */
function retypeTaskLists(tokens: Token[]): Token[] {
	const stack: { open: Token; items: Token[] }[] = [];
	const itemOpen: Token[] = [];
	for (const token of tokens) {
		switch (token.type) {
			case 'bullet_list_open':
			case 'ordered_list_open':
				stack.push({ open: token, items: [] });
				break;
			case 'list_item_open':
				stack.at(-1)?.items.push(token);
				itemOpen.push(token);
				break;
			case 'list_item_close':
				// Closes find their item after the retyping below, by nesting.
				break;
			case 'bullet_list_close':
			case 'ordered_list_close': {
				const list = stack.pop();
				if (list === undefined) break;
				const tasks = list.items.filter((item) => item.attrGet('data-task') !== null).length;
				if (tasks === 0) break;
				if (tasks !== list.items.length) throw new NotEditableError('mixed-list');
				list.open.type = 'task_list_open';
				token.type = 'task_list_close';
				for (const item of list.items) item.type = 'task_item_open';
				break;
			}
		}
	}
	const open: string[] = [];
	for (const token of tokens) {
		if (token.type === 'task_item_open' || token.type === 'list_item_open') open.push(token.type);
		else if (token.type === 'list_item_close' && open.pop() === 'task_item_open') {
			token.type = 'task_item_close';
		}
	}
	return tokens;
}

/** The tokens of the display, checked and with task lists retyped for the parser. */
function editorTokens(markdown: string): Token[] {
	const tokens = markdownTokens(markdown);
	const unknown = unknownToken(tokens);
	if (unknown !== null) {
		throw new NotEditableError(
			unknown.startsWith('table') || unknown === 'tr' ? 'table' : 'unknown'
		);
	}
	return retypeTaskLists(tokens);
}

/** Checked state of the task whose item opens at `index`. */
function taskChecked(tokens: readonly Token[], index: number): boolean {
	for (let i = index + 1; i < tokens.length; i++) {
		const box = tokens[i]!.children?.find((child) => child.type === 'task_checkbox');
		if (box !== undefined) return (box.meta as { checked: boolean }).checked;
	}
	return false;
}

const BULLETS = ['-', '*', '+'] as const;
const BULLET_LISTS = new Set(['bulletList', 'taskList']);

/**
 * The bullet a list writes: its own, unless the list right before it in the same parent writes
 * the same one; then CommonMark would merge both into one list, so it takes another.
 */
function bulletOf(parent: Node, index: number): string {
	const node = parent.child(index);
	const own = BULLETS.includes(node.attrs.bullet) ? (node.attrs.bullet as string) : '-';
	const previous = index > 0 ? parent.child(index - 1) : null;
	if (previous === null || !BULLET_LISTS.has(previous.type.name)) return own;
	const before = bulletOf(parent, index - 1);
	return own !== before ? own : (BULLETS.find((bullet) => bullet !== before) ?? '-');
}

/** The delimiter of a numbered list, with the same rule against merging as `bulletOf`. */
function delimiterOf(parent: Node, index: number): string {
	const node = parent.child(index);
	const own = node.attrs.delimiter === ')' ? ')' : '.';
	const previous = index > 0 ? parent.child(index - 1) : null;
	if (previous === null || previous.type.name !== 'orderedList') return own;
	const before = delimiterOf(parent, index - 1);
	return own !== before ? own : before === '.' ? ')' : '.';
}

/** Backticks around inline code that hold the longest run of backticks inside. */
function backticksFor(node: Node, side: -1 | 1): string {
	let longest = 0;
	if (node.isText) {
		for (const run of node.text?.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
	}
	const ticks = '`'.repeat(longest + 1);
	if (longest === 0) return ticks;
	return side < 0 ? `${ticks} ` : ` ${ticks}`;
}

/** A link whose text is its address can be written as autolink `<…>`. */
function isPlainUrl(link: Mark, parent: Node, index: number): boolean {
	const href = String(link.attrs.href ?? '');
	if (link.attrs.title || !/^\w+:/.test(href)) return false;
	const content = parent.child(index);
	if (!content.isText || content.text !== href || content.marks.at(-1) !== link) return false;
	return index === parent.childCount - 1 || !link.isInSet(parent.child(index + 1).marks);
}

/**
 * Characters that start a block at the beginning of a line and that the escaping of
 * prosemirror-markdown does not cover: "+" and "1." without text after them, "1)", "=" (setext
 * heading), "|" and ":-" (table rows). Leading blanks go, as the display drops them anyway and
 * four of them would start a code block.
 */
function escapeLineStart(line: string): string {
	return line
		.replace(/^[ \t]+/, '')
		.replace(/^\+(?=[ \t]|$)/, '\\+')
		.replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, '$1\\$2')
		.replace(/^(=|\||:(?=-))/, '\\$1');
}

/** What MarkdownParser takes as tokenizer (a markdown-it instance; it only calls parse). */
type Tokenizer = ConstructorParameters<typeof MarkdownParser>[1];

type State = MarkdownSerializerState & { out: string; inAutolink?: boolean; atBlockStart: boolean };

/** The node types of the editor that hold a hard break. */
const HARD_BREAK = 'hardBreak';

export interface MarkdownBridge {
	/** The document of a Markdown text; throws NotEditableError for what the schema cannot hold. */
	parse(markdown: string): Node;
	/** Markdown of a document, as the display renders it like the editor shows it. */
	serialize(doc: Node): string;
}

/** Bridge for the schema of the editor (create-editor.ts). */
export function createMarkdownBridge(schema: Schema): MarkdownBridge {
	const parser = new MarkdownParser(
		schema,
		// The parser only calls parse(); the tokens come from the instance of the display.
		{ parse: (text: string) => editorTokens(text) } as unknown as Tokenizer,
		{
			blockquote: { block: 'blockquote' },
			paragraph: { block: 'paragraph' },
			list_item: { block: 'listItem' },
			task_item: {
				block: 'taskItem',
				getAttrs: (_token, tokens, index) => ({ checked: taskChecked(tokens, index) })
			},
			bullet_list: {
				block: 'bulletList',
				getAttrs: (token, tokens, index) => ({
					tight: listIsTight(tokens, index),
					bullet: token.markup
				})
			},
			task_list: {
				block: 'taskList',
				getAttrs: (token, tokens, index) => ({
					tight: listIsTight(tokens, index),
					bullet: token.markup
				})
			},
			ordered_list: {
				block: 'orderedList',
				getAttrs: (token, tokens, index) => ({
					start: Number(token.attrGet('start') ?? 1) || 1,
					tight: listIsTight(tokens, index),
					delimiter: token.markup
				})
			},
			heading: { block: 'heading', getAttrs: (token) => ({ level: Number(token.tag.slice(1)) }) },
			code_block: { block: 'codeBlock', noCloseToken: true },
			fence: {
				block: 'codeBlock',
				getAttrs: (token) => ({ language: token.info.trim() || null }),
				noCloseToken: true
			},
			hr: { node: 'horizontalRule' },
			hardbreak: { node: HARD_BREAK },
			softbreak: { node: HARD_BREAK },
			task_checkbox: { ignore: true, noCloseToken: true },
			em: { mark: 'italic' },
			strong: { mark: 'bold' },
			s: { mark: 'strike' },
			ins: { mark: 'underline' },
			link: {
				mark: 'link',
				getAttrs: (token) => ({
					href: token.attrGet('href'),
					title: token.attrGet('title') || null
				})
			},
			code_inline: { mark: 'code', noCloseToken: true }
		}
	);

	const serializer = new MarkdownSerializer(
		{
			blockquote(state, node) {
				state.wrapBlock('> ', null, node, () => state.renderContent(node));
			},
			codeBlock(state, node) {
				const runs = node.textContent.match(/`{3,}/gm);
				const fence = runs ? `${runs.sort((a, b) => a.length - b.length).at(-1)}\`` : '```';
				state.write(`${fence}${node.attrs.language ?? ''}\n`);
				state.text(node.textContent, false);
				state.ensureNewLine();
				state.write(fence);
				state.closeBlock(node);
			},
			heading(state, node) {
				state.write(`${'#'.repeat(node.attrs.level as number)} `);
				state.renderInline(node, false);
				state.closeBlock(node);
			},
			horizontalRule(state, node) {
				state.write('---');
				state.closeBlock(node);
			},
			bulletList(state, node, parent, index) {
				const bullet = bulletOf(parent, index);
				state.renderList(node, '  ', () => `${bullet} `);
			},
			taskList(state, node, parent, index) {
				const bullet = bulletOf(parent, index);
				state.renderList(node, '  ', () => `${bullet} `);
			},
			orderedList(state, node, parent, index) {
				const start = (node.attrs.start as number | null) ?? 1;
				const delimiter = delimiterOf(parent, index);
				const width = String(start + node.childCount - 1).length;
				state.renderList(node, ' '.repeat(width + 2), (i) => {
					const number = String(start + i);
					return `${' '.repeat(width - number.length)}${number}${delimiter} `;
				});
			},
			listItem(state, node) {
				state.renderContent(node);
			},
			taskItem(state, node) {
				state.write(node.attrs.checked ? '[x] ' : '[ ] ');
				state.renderContent(node);
			},
			paragraph(state, node) {
				state.renderInline(node);
				state.closeBlock(node);
			},
			hardBreak(state, node, parent, index) {
				// A heading has one line; a break there becomes a space.
				if (parent.type.name === 'heading') {
					state.write(' ');
					return;
				}
				// Breaks at the end of a block show nothing in the display and are left out.
				let followed = false;
				for (let i = index + 1; i < parent.childCount; i++) {
					if (parent.child(i).type !== node.type) {
						followed = true;
						break;
					}
				}
				if (!followed) return;
				// One break is a line break (breaks: true); a further one needs a backslash, since an
				// empty line would end the paragraph.
				const previous = index > 0 ? parent.child(index - 1) : null;
				state.write(previous?.type === node.type ? '\\\n' : '\n');
			},
			text(state, node) {
				const s = state as State;
				const text = node.text ?? '';
				if (s.inAutolink) {
					s.text(text, false);
					return;
				}
				// At the start of a block and after a line break the text starts a line and is
				// escaped like one (ADR-0032 section 2).
				const lineStart = s.atBlockStart || /(^|\n)$/.test(s.out);
				const escaped = text
					.split('\n')
					.map((line, i) =>
						i > 0 || lineStart ? escapeLineStart(s.esc(line, true)) : s.esc(line, false)
					)
					.join('\n');
				s.text(escaped, false);
			}
		},
		{
			italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
			bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
			strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
			underline: { open: '++', close: '++', mixable: true, expelEnclosingWhitespace: true },
			link: {
				open(state, mark, parent, index) {
					const s = state as State;
					s.inAutolink = isPlainUrl(mark, parent, index);
					return s.inAutolink ? '<' : '[';
				},
				close(state, mark) {
					const s = state as State;
					const autolink = s.inAutolink;
					s.inAutolink = undefined;
					if (autolink) return '>';
					const href = String(mark.attrs.href ?? '').replace(/[()"\\\s]/g, (c) =>
						/\s/.test(c) ? encodeURI(c) : `\\${c}`
					);
					const title = mark.attrs.title
						? ` "${String(mark.attrs.title).replace(/["\\]/g, '\\$&')}"`
						: '';
					return `](${href}${title})`;
				},
				mixable: true
			},
			code: {
				open: (_state, _mark, parent, index) => backticksFor(parent.child(index), -1),
				close: (_state, _mark, parent, index) => backticksFor(parent.child(index - 1), 1),
				escape: false
			}
		},
		{
			// "++" (underline), "&" before an entity and "<" before an autolink would change the text.
			escapeExtraCharacters: /\+(?=\+)|(?<=\+)\+|&(?=#?[a-z0-9]+;)|<(?=[^\s<>]*>)/gi,
			hardBreakNodeName: HARD_BREAK,
			strict: true
		}
	);

	return {
		parse(markdown) {
			return parser.parse(markdown);
		},
		serialize(doc) {
			return serializer.serialize(doc);
		}
	};
}
