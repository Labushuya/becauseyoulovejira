// Same display (ADR-0032, plan editor section 3.6): two HTML outputs of renderMarkdown count as
// equal when they have the same blocks and, inside them, the same text with the same formatting.
// Whitespace between tags and runs of blanks do not count, nor does the order of directly nested
// marks (<u><strong>x</strong></u> shows the same as <strong><u>x</u></strong>). The editor uses it
// before it opens a text and the parity test of the corpus uses it for every file.

/** Inline elements that only format their text; their nesting order does not matter. */
const MARKS = new Set(['STRONG', 'EM', 'U', 'S', 'CODE', 'A']);

/** One formatting of a text run, with the attributes that change what it shows. */
function markOf(element: Element): string {
	if (element.tagName !== 'A') return element.tagName.toLowerCase();
	return `a[${element.getAttribute('href') ?? ''}|${element.getAttribute('title') ?? ''}]`;
}

/** The attributes of a block element that change the display, in a fixed order. */
function attributesOf(element: Element): string {
	return element
		.getAttributeNames()
		.filter((name) => !(element.tagName === 'A' && (name === 'target' || name === 'rel')))
		.sort()
		.map((name) => `${name}=${JSON.stringify(element.getAttribute(name))}`)
		.join(' ');
}

interface Run {
	marks: string;
	text: string;
}

/** Canonical text of the children of a block: runs of text with their sorted marks. */
function inline(nodes: Iterable<ChildNode>, marks: readonly string[], out: string[], runs: Run[]) {
	for (const node of nodes) {
		if (node.nodeType === Node.TEXT_NODE) {
			const text = (node.textContent ?? '').replace(/\s+/g, ' ');
			if (text === '') continue;
			const key = [...marks].sort().join(',');
			const last = runs.at(-1);
			if (last !== undefined && last.marks === key) last.text += text;
			else runs.push({ marks: key, text });
			continue;
		}
		if (!(node instanceof Element)) continue;
		if (MARKS.has(node.tagName)) {
			inline(node.childNodes, [...marks, markOf(node)], out, runs);
			continue;
		}
		flush(out, runs);
		block(node, out);
	}
}

/**
 * Writes the collected runs and empties the list. Blanks at the start and end of a sequence of
 * runs sit between tags and do not show.
 */
function flush(out: string[], runs: Run[]): void {
	const first = runs[0];
	const last = runs.at(-1);
	if (first !== undefined) first.text = first.text.replace(/^ /, '');
	if (last !== undefined) last.text = last.text.replace(/ $/, '');
	for (const run of runs) if (run.text !== '') out.push(`[${run.marks}]${run.text}`);
	runs.length = 0;
}

/** Canonical form of a block element and everything in it. */
function block(element: Element, out: string[]): void {
	const attributes = attributesOf(element);
	out.push(`<${element.tagName.toLowerCase()}${attributes ? ` ${attributes}` : ''}>`);
	const runs: Run[] = [];
	inline(element.childNodes, [], out, runs);
	flush(out, runs);
	out.push(`</${element.tagName.toLowerCase()}>`);
}

/** Canonical form of the HTML of the display; equal forms show the same. */
export function canonicalHtml(html: string): string {
	const template = document.createElement('template');
	template.innerHTML = html;
	const out: string[] = [];
	const runs: Run[] = [];
	inline(template.content.childNodes, [], out, runs);
	flush(out, runs);
	return out.join('');
}

/** Whether two outputs of renderMarkdown show the same. */
export function sameDisplay(a: string, b: string): boolean {
	return canonicalHtml(a) === canonicalHtml(b);
}
