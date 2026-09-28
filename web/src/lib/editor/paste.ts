// Pasting into the editor (plan editor section 3.2, RT-5). HTML from Word, Google Docs, LibreOffice
// or a web page is cleaned before ProseMirror reads it against the schema: comments (also the
// conditional ones of Word), style sheets, meta data, Office tags (<o:p>, <v:…>), images, media,
// forms and scripts go; Word lists (paragraphs with mso-list) become ul/ol; formatting that only
// lives in inline styles (Google Docs) becomes strong, em, u and s; then every attribute goes
// except the address of a link (http, https, mailto) and the start of a numbered list. What the
// schema does not know (colours, fonts, tables, images) ProseMirror drops anyway, and the stored
// result is Markdown that the display sanitizes again (ADR-0008, ADR-0032 section 3).
// Plain text that looks like Markdown is read as Markdown; Ctrl+Shift+V always pastes plain text.

/** Elements removed together with everything in them. */
const DROP =
	'script, style, meta, link, title, xml, template, noscript, img, picture, video, audio, source, ' +
	'track, iframe, frame, object, embed, svg, math, canvas, map, input, button, select, textarea, ' +
	'option, head';

/** Links that stay links (CLAUDE.md section 7). */
const ALLOWED_HREF = /^(?:https?:|mailto:)/i;

/** Marker text of a Word list item that numbers it (1. a) iv.), otherwise it is a bullet. */
const NUMBERED_MARKER = /^\(?(?:\d+|[a-z]|[ivxlcdm]+)[.)]$/i;

/** Level and list id of a Word list paragraph ("mso-list:l0 level2 lfo1"), or null. */
function wordListOf(element: Element): { list: string; level: number } | null {
	const style = element.getAttribute('style') ?? '';
	const match = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(style);
	if (match === null) return null;
	return { list: match[1] ?? 'l0', level: Number(match[2] ?? 1) };
}

/** Whether a node is only blank text between two elements. */
function isBlank(node: Node | null): boolean {
	return (
		node !== null && node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === ''
	);
}

/** The next sibling element, skipping blank text; null if something else comes first. */
function nextElement(element: Element): Element | null {
	let node = element.nextSibling;
	while (isBlank(node)) node = node?.nextSibling ?? null;
	return node instanceof Element ? node : null;
}

/**
 * Word writes list items as paragraphs with "mso-list" and a marker span ("mso-list:Ignore").
 * Consecutive ones of the same list become one list; the level nests, the marker decides between
 * ul and ol.
 */
function convertWordLists(doc: Document): void {
	const paragraphs = [...doc.body.querySelectorAll('p')].filter((p) => wordListOf(p) !== null);
	const done = new Set<Element>();
	for (const first of paragraphs) {
		if (done.has(first)) continue;
		const id = wordListOf(first)?.list;
		const run: Element[] = [];
		for (let item: Element | null = first; item && wordListOf(item)?.list === id;) {
			run.push(item);
			done.add(item);
			item = nextElement(item);
		}
		const root = doc.createElement('div');
		first.before(root);
		const stack: { level: number; list: HTMLElement }[] = [];
		for (const paragraph of run) {
			const level = wordListOf(paragraph)?.level ?? 1;
			const marker = paragraph.querySelector('[style*="mso-list:Ignore" i]');
			const numbered = NUMBERED_MARKER.test((marker?.textContent ?? '').replace(/\s+/g, ''));
			marker?.remove();
			while (stack.length > 0 && (stack.at(-1)?.level ?? 0) > level) stack.pop();
			let top = stack.at(-1);
			if (top === undefined || top.level < level) {
				const list = doc.createElement(numbered ? 'ol' : 'ul');
				const parentItem = top?.list.lastElementChild;
				(parentItem ?? root).append(list);
				top = { level, list };
				stack.push(top);
			}
			const item = doc.createElement('li');
			item.append(...paragraph.childNodes);
			top.list.append(item);
			paragraph.remove();
		}
		root.replaceWith(...root.childNodes);
	}
}

/** Replaces an element by its children. */
function unwrap(element: Element): void {
	element.replaceWith(...element.childNodes);
}

/** Wraps the children of an element in a new element of `tag`. */
function wrapChildren(element: Element, tag: string): void {
	const wrapper = element.ownerDocument.createElement(tag);
	wrapper.append(...element.childNodes);
	element.append(wrapper);
}

/** Whether a font weight means bold. */
function isBold(weight: string): boolean {
	return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
}

/**
 * Formatting that only lives in inline styles (Google Docs writes spans with font-weight:700) is
 * turned into elements; bold that says font-weight:normal (the wrapper of Google Docs) goes.
 */
function convertInlineStyles(doc: Document): void {
	for (const element of [...doc.body.querySelectorAll<HTMLElement>('[style]')]) {
		const style = element.style;
		const weight = style.fontWeight.trim();
		if (
			(element.tagName === 'B' || element.tagName === 'STRONG') &&
			weight !== '' &&
			!isBold(weight)
		) {
			unwrap(element);
			continue;
		}
		if (element.tagName !== 'SPAN' && element.tagName !== 'FONT') continue;
		const decoration = `${style.textDecoration} ${style.textDecorationLine}`;
		if (isBold(weight)) wrapChildren(element, 'strong');
		if (style.fontStyle === 'italic') wrapChildren(element, 'em');
		if (decoration.includes('underline')) wrapChildren(element, 'u');
		if (decoration.includes('line-through')) wrapChildren(element, 's');
	}
}

/** Removes every attribute except a safe href on links and the start of numbered lists. */
function stripAttributes(doc: Document): void {
	for (const element of [...doc.body.querySelectorAll('*')]) {
		for (const name of element.getAttributeNames()) {
			const keep =
				(element.tagName === 'A' && name === 'href') ||
				(element.tagName === 'A' && name === 'title') ||
				(element.tagName === 'OL' && name === 'start');
			if (!keep) element.removeAttribute(name);
		}
		if (element.tagName === 'A') {
			const href = (element.getAttribute('href') ?? '').trim();
			if (!ALLOWED_HREF.test(href)) unwrap(element);
		}
	}
}

/** Removes comments, among them the conditional comments of Word. */
function removeComments(doc: Document): void {
	const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
	const comments: Node[] = [];
	while (walker.nextNode()) comments.push(walker.currentNode);
	for (const comment of comments) comment.parentNode?.removeChild(comment);
}

/** Cleans pasted HTML before ProseMirror reads it (`transformPastedHTML`). */
export function transformPastedHTML(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	removeComments(doc);
	for (const element of [...doc.querySelectorAll(DROP)]) element.remove();
	// Office namespaces (<o:p>, <v:shape>, <w:…>) carry nothing the schema knows.
	for (const element of [...doc.body.querySelectorAll('*')]) {
		if (element.tagName.includes(':')) element.remove();
	}
	convertWordLists(doc);
	convertInlineStyles(doc);
	for (const element of [...doc.body.querySelectorAll('font, span, form, label')]) unwrap(element);
	stripAttributes(doc);
	// Empty paragraphs (Word writes <p><o:p>&nbsp;</o:p></p> as spacing) would become blank lines;
	// trim() also removes the no-break space.
	for (const paragraph of [...doc.body.querySelectorAll('p')]) {
		const empty = (paragraph.textContent ?? '').trim() === '';
		if (empty && paragraph.querySelector('br') === null) paragraph.remove();
	}
	return doc.body.innerHTML;
}

/** Signs of Markdown at the start of a line or inline in plain text. */
const MARKDOWN_SIGNS = [
	/^#{1,6}\s/m,
	/^\s*[-*+]\s+\S/m,
	/^\s*\d{1,9}[.)]\s+\S/m,
	/^>\s?/m,
	/^```/m,
	/\*\*[^*\n]+\*\*/,
	/~~[^~\n]+~~/,
	/\+\+[^+\n]+\+\+/,
	/`[^`\n]+`/,
	/\[[^\]\n]+\]\([^)\s]+\)/
];

/** Whether plain text looks like Markdown, so pasting it reads it as Markdown. */
export function looksLikeMarkdown(text: string): boolean {
	return MARKDOWN_SIGNS.some((sign) => sign.test(text));
}
