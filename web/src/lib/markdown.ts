// Markdown rendering (ADR-0008): markdown-it without raw HTML, then DOMPurify as a second,
// independent layer. The only consumer is Markdown.svelte, the one place with {@html}.

import DOMPurify, { type DOMPurify as Purifier } from 'dompurify';
import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: true });
// Images would load external resources (offline rule, CLAUDE.md section 3); attachments are
// stage 2. Without the rule "![alt](url)" stays a "!" followed by an ordinary link.
parser.disable('image');

/** Everything markdown-it produces except images. */
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
	'a'
];
const ALLOWED_ATTR = ['href', 'title', 'start', 'target', 'rel'];
/** Links only to http, https and mailto; everything else loses its href. */
const ALLOWED_URI_REGEXP = /^(?:https?|mailto):/i;
const EXTERNAL = /^https?:/i;

let purifier: Purifier | null = null;

/** Own DOMPurify instance, so the link hook does not affect other users of the library. */
function purify(): Purifier {
	if (purifier !== null) return purifier;
	const instance = DOMPurify(window);
	instance.addHook('afterSanitizeAttributes', (node) => {
		if (node.tagName !== 'A') return;
		const href = node.getAttribute('href');
		if (href !== null && EXTERNAL.test(href)) {
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer');
		} else {
			node.removeAttribute('target');
			node.removeAttribute('rel');
		}
	});
	purifier = instance;
	return instance;
}

/** Safe HTML for a Markdown text (ticket description, comment). */
export function renderMarkdown(source: string): string {
	return purify().sanitize(parser.render(source), {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOWED_URI_REGEXP,
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false
	});
}
