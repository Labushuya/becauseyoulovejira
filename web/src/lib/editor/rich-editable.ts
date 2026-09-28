// Can a text be opened in the editor without changing what it shows (ADR-0032 section 4)? Tables,
// lists of tasks and other items and every token the bridge does not know are not editable; for
// the rest the text goes through the bridge once, and the display of the result must equal the
// display of the text. Otherwise the editor opens the source mode, so nothing is lost.

import type { Node } from '@tiptap/pm/model';
import { renderMarkdown } from '$lib/markdown';
import { NotEditableError, type MarkdownBridge, type NotEditableReason } from './markdown-bridge';
import { sameDisplay } from './parity';

export type EditableCheck =
	{ editable: true; doc: Node } | { editable: false; reason: NotEditableReason | 'difference' };

/** The document of `markdown` for the editor, or why it opens in the source mode. */
export function richEditable(markdown: string, bridge: MarkdownBridge): EditableCheck {
	let doc: Node;
	try {
		doc = bridge.parse(markdown);
	} catch (error) {
		if (error instanceof NotEditableError) return { editable: false, reason: error.reason };
		return { editable: false, reason: 'unknown' };
	}
	if (markdown.trim() === '') return { editable: true, doc };
	const shown = renderMarkdown(markdown);
	const again = renderMarkdown(bridge.serialize(doc));
	return sameDisplay(shown, again)
		? { editable: true, doc }
		: { editable: false, reason: 'difference' };
}
