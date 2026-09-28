// Markdown rendering (ADR-0008, extended by ADR-0032): markdown-it without raw HTML, then DOMPurify
// as a second, independent layer. The only consumer of the HTML is Markdown.svelte, the one place
// with {@html}. Two extensions of the format (ADR-0032 section 1): "++text++" underlines
// (markdown-it-ins, rendered as <u>), and GFM task lists ("- [ ]", "- [x]") in bullet lists become
// disabled checkboxes, numbered by their index in the document. `toggleTask` ticks one of them in
// the source text with the same parser (RT-2).

import DOMPurify, { type DOMPurify as Purifier } from 'dompurify';
import MarkdownIt, { type StateCore, type Token } from 'markdown-it';
import markdownItIns from 'markdown-it-ins';

/** Task marker at the start of the first paragraph of a list item (GFM). */
const TASK_MARKER = /^\[([ xX])\](?=[ \t]|$)/;

/** What the checkbox of a task shows; `line` is the source line of its marker (0-based). */
type TaskMeta = {
	index: number;
	checked: boolean;
	label: string;
	line: number;
};

/** Plain text of the inline tokens of a task, as the name of its checkbox. */
function labelOf(children: readonly Token[]): string {
	const text = children
		.map((child) => {
			if (child.type === 'softbreak' || child.type === 'hardbreak') return ' ';
			if (child.type === 'text' || child.type === 'text_special' || child.type === 'code_inline') {
				return child.content;
			}
			return '';
		})
		.join('')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * Checked state of a task marker at the start of an inline token, or null if there is none. A
 * marker needs a space or the end of the line after it; "[ ]" alone is an empty task, "[ ]**x**"
 * is none. Escaped brackets ("\[ \]") are `text_special` tokens and never a marker.
 */
function markerOf(inline: Token): boolean | null {
	const children = inline.children ?? [];
	const first = children[0];
	if (first?.type !== 'text') return null;
	const match = TASK_MARKER.exec(first.content);
	if (match === null) return null;
	if (first.content.length === 3) {
		const next = children[1];
		if (next !== undefined && next.type !== 'softbreak' && next.type !== 'hardbreak') return null;
	}
	return match[1] !== ' ';
}

/**
 * Core rule after "inline" (before "linkify" and "text_join"): the first paragraph of an item of a
 * bullet list that starts with a task marker gets a checkbox token instead of the marker, and the
 * item the attribute data-task with the running index. Numbered lists have no tasks (ADR-0032
 * section 1). Only tokens, never html_inline, so `html: false` stays intact.
 */
function taskLists(state: StateCore): void {
	const tokens = state.tokens;
	const lists: string[] = [];
	let index = 0;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
			lists.push(token.type);
			continue;
		}
		if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
			lists.pop();
			continue;
		}
		if (token.type !== 'list_item_open' || lists.at(-1) !== 'bullet_list_open') continue;
		const paragraph = tokens[i + 1];
		const inline = tokens[i + 2];
		if (paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
		const checked = markerOf(inline);
		if (checked === null) continue;
		const children = inline.children ?? [];
		const first = children[0]!;
		first.content = first.content.slice(3).replace(/^[ \t]+/, '');
		const box = new state.Token('task_checkbox', 'input', 0);
		const meta: TaskMeta = {
			index,
			checked,
			label: labelOf(children) || `Aufgabe ${index + 1}`,
			line: inline.map?.[0] ?? paragraph.map?.[0] ?? 0
		};
		box.meta = meta;
		inline.children = [box, ...children];
		token.attrSet('data-task', String(index));
		index += 1;
	}
}

const parser = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: true });
// Images would load external resources (offline rule, CLAUDE.md section 3); attachments are
// stage 2. Without the rule "![alt](url)" stays a "!" followed by an ordinary link.
parser.disable('image');
parser.use(markdownItIns);
parser.renderer.rules.ins_open = () => '<u>';
parser.renderer.rules.ins_close = () => '</u>';
parser.core.ruler.after('inline', 'task_lists', taskLists);
parser.renderer.rules.task_checkbox = (tokens, idx) => {
	const { checked, label } = tokens[idx]!.meta as TaskMeta;
	const name = parser.utils.escapeHtml(label);
	return `<input type="checkbox" disabled${checked ? ' checked' : ''} aria-label="${name}">`;
};

/** The tasks of a Markdown text in document order, as the display numbers them. */
function tasksOf(source: string): TaskMeta[] {
	return parser
		.parse(source, {})
		.flatMap((token) => token.children ?? [])
		.filter((child) => child.type === 'task_checkbox')
		.map((child) => child.meta as TaskMeta);
}

/**
 * Containers in front of a task marker on its line: indentation, quote markers and list markers
 * ("- ", "> - ", "1. - "); the line is known to hold the marker of a task.
 */
const TASK_LINE = /^([ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+[ \t>]*)*)\[[ xX]\]/;

/**
 * Ticks (`checked`) or unticks the task with the given index (ADR-0032 section 6): only the
 * character between the brackets of that task changes, every other byte stays, line breaks
 * included. Returns the text unchanged if the task already has the state, and null if there is
 * no such task or the change cannot be made safely.
 */
export function toggleTask(source: string, index: number, checked: boolean): string | null {
	const task = tasksOf(source)[index];
	if (task === undefined) return null;
	if (task.checked === checked) return source;
	// Lines as markdown-it counts them, with their breaks kept at the odd positions.
	const parts = source.split(/(\r\n|\r|\n)/);
	const line = parts[task.line * 2];
	const match = line === undefined ? null : TASK_LINE.exec(line);
	if (line === undefined || match === null) return null;
	const at = (match[1] ?? '').length;
	parts[task.line * 2] = `${line.slice(0, at)}[${checked ? 'x' : ' '}]${line.slice(at + 3)}`;
	const next = parts.join('');
	return tasksOf(next)[index]?.checked === checked ? next : null;
}

/** Everything markdown-it produces except images, plus underline and the task checkbox. */
const ALLOWED_TAGS = [
	'p',
	'br',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'strong',
	'em',
	's',
	'u',
	'code',
	'pre',
	'blockquote',
	'ul',
	'ol',
	'li',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'hr',
	'a',
	'input'
];
/** The attributes of the task checkbox; they appear on no other element. */
const CHECKBOX_ATTR = ['type', 'checked', 'disabled', 'aria-label'];
const ALLOWED_ATTR = ['href', 'title', 'start', 'target', 'rel', 'data-task', ...CHECKBOX_ATTR];
/**
 * DOMPurify checks the value of every attribute outside its list of URI-safe attributes against
 * ALLOWED_URI_REGEXP. These carry no URL; without them "start", "type" and the rest would be lost.
 */
const URI_SAFE_ATTR = ['start', 'type', 'aria-label', 'data-task'];
/** Index of a task: digits only. */
const TASK_INDEX = /^\d{1,4}$/;
/** Links only to http, https and mailto; everything else loses its href. */
const ALLOWED_URI_REGEXP = /^(?:https?|mailto):/i;
const EXTERNAL = /^https?:/i;

let purifier: Purifier | null = null;

/** External links open in a new tab without referrer; others lose target and rel. */
function secureLink(node: Element): void {
	const href = node.getAttribute('href');
	if (href !== null && EXTERNAL.test(href)) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	} else {
		node.removeAttribute('target');
		node.removeAttribute('rel');
	}
}

/**
 * ADR-0032 section 3: an input stays only as a disabled checkbox with its own attributes; data-task
 * stays only on li and only with digits; the checkbox attributes appear on no other element.
 */
function secureTask(node: Element): void {
	if (node.tagName === 'INPUT') {
		if (node.getAttribute('type') !== 'checkbox') {
			node.remove();
			return;
		}
		for (const name of node.getAttributeNames()) {
			if (!CHECKBOX_ATTR.includes(name)) node.removeAttribute(name);
		}
		node.setAttribute('disabled', '');
		return;
	}
	for (const name of CHECKBOX_ATTR) node.removeAttribute(name);
	const task = node.getAttribute('data-task');
	if (task !== null && (node.tagName !== 'LI' || !TASK_INDEX.test(task))) {
		node.removeAttribute('data-task');
	}
}

/** Own DOMPurify instance, so the hooks do not affect other users of the library. */
function purify(): Purifier {
	if (purifier !== null) return purifier;
	const instance = DOMPurify(window);
	instance.addHook('afterSanitizeAttributes', (node) => {
		if (node.tagName === 'A') secureLink(node);
		secureTask(node);
	});
	purifier = instance;
	return instance;
}

/**
 * The second layer on its own: HTML reduced to the allowlist of ADR-0008 and ADR-0032. Exported
 * for the tests of that layer, which feed it HTML that markdown-it never produces.
 */
export function sanitizeMarkdownHtml(html: string): string {
	return purify().sanitize(html, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ADD_URI_SAFE_ATTR: URI_SAFE_ATTR,
		ALLOWED_URI_REGEXP,
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false
	});
}

/** Safe HTML for a Markdown text (ticket description, comment). */
export function renderMarkdown(source: string): string {
	return sanitizeMarkdownHtml(parser.render(source));
}
