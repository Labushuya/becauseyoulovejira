// The "/" menu of the editor (plan editor section 3.2, RT-4): typing "/" at the start of a line or
// after a blank opens a list of blocks; the text after it filters, Enter or Tab inserts, Escape
// closes. A small ProseMirror plugin of our own instead of @tiptap/suggestion, which brings
// floating-ui; the list is SuggestionList in the top layer, placed with place() at the caret.

import { Extension, type Editor, type Range } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';

/** One entry of the menu. */
export interface SlashItem {
	id: string;
	label: string;
	/** Further words the filter finds it by. */
	keywords: readonly string[];
}

/** The entries in the order of the menu (no "Unteraufgabe": a product decision, plan section 4). */
export const SLASH_ITEMS: readonly SlashItem[] = [
	{ id: 'heading1', label: 'Überschrift 1', keywords: ['h1', 'titel', 'heading'] },
	{ id: 'heading2', label: 'Überschrift 2', keywords: ['h2', 'heading'] },
	{ id: 'heading3', label: 'Überschrift 3', keywords: ['h3', 'heading'] },
	{ id: 'bulletList', label: 'Aufzählung', keywords: ['liste', 'punkte', 'bullet', 'ul'] },
	{ id: 'orderedList', label: 'Nummerierte Liste', keywords: ['liste', 'zahlen', 'ol'] },
	{ id: 'taskList', label: 'Checkliste', keywords: ['aufgaben', 'todo', 'task', 'kästchen'] },
	{ id: 'blockquote', label: 'Zitat', keywords: ['quote'] },
	{ id: 'codeBlock', label: 'Codeblock', keywords: ['code', 'pre'] },
	{ id: 'horizontalRule', label: 'Trennlinie', keywords: ['linie', 'hr', 'trenner'] },
	{ id: 'link', label: 'Link', keywords: ['url', 'adresse', 'verweis'] }
];

/** The entries a query finds: a word of the name or a keyword starts with it, without case. */
export function filterSlashItems(query: string): SlashItem[] {
	const wanted = query.trim().toLocaleLowerCase('de-DE');
	if (wanted === '') return [...SLASH_ITEMS];
	return SLASH_ITEMS.filter((item) =>
		[...item.label.toLocaleLowerCase('de-DE').split(/\s+/), ...item.keywords].some((word) =>
			word.startsWith(wanted)
		)
	);
}

/** The open menu: where "/" stands, what follows it, and where the caret is on screen. */
export interface SlashState {
	range: Range;
	query: string;
	/** Caret rectangle in viewport coordinates, or null without layout. */
	rect: { top: number; left: number; bottom: number; right: number } | null;
}

export interface SlashCallbacks {
	/** The menu opened or its query changed; null: it closed. */
	onChange: (state: SlashState | null) => void;
	/** A key while the menu is open; true consumes it. */
	onKeyDown: (event: KeyboardEvent) => boolean;
}

type Trigger = { from: number; query: string } | null;

const slashKey = new PluginKey<Trigger>('bylSlash');
/** Meta of a transaction that closes the menu until "/" is typed again. */
const CLOSE = 'bylSlashClose';

/** "/" and what follows it before the caret, if it opens the menu there. */
function trigger(state: EditorState): Trigger {
	const { selection } = state;
	if (!selection.empty) return null;
	const $from = selection.$from;
	if ($from.parent.type.spec.code || $from.marks().some((mark) => mark.type.spec.code)) return null;
	const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
	const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
	if (match === null) return null;
	const query = match[1] ?? '';
	return { from: $from.pos - query.length - 1, query };
}

/** The plugin behind the menu; callbacks come from the editor component. */
export function slashExtension(callbacks: SlashCallbacks) {
	return Extension.create({
		name: 'bylSlash',
		addProseMirrorPlugins() {
			let closedAt: number | null = null;
			return [
				new Plugin<Trigger>({
					key: slashKey,
					state: {
						init: (): Trigger => null,
						apply(transaction, _previous, _old, state) {
							if (transaction.getMeta(CLOSE)) {
								closedAt = trigger(state)?.from ?? null;
								return null;
							}
							const found = trigger(state);
							if (found === null) {
								closedAt = null;
								return null;
							}
							return found.from === closedAt ? null : found;
						}
					},
					view() {
						return {
							update(view, previous) {
								const next = slashKey.getState(view.state);
								const before = slashKey.getState(previous);
								if (next === before) return;
								if (next === null || next === undefined) {
									if (before) callbacks.onChange(null);
									return;
								}
								if (before && before.from === next.from && before.query === next.query) return;
								let rect: SlashState['rect'];
								try {
									rect = view.coordsAtPos(next.from);
								} catch {
									// Without layout (jsdom) there is no position; the list opens anyway.
									rect = null;
								}
								callbacks.onChange({
									range: { from: next.from, to: view.state.selection.from },
									query: next.query,
									rect
								});
							},
							destroy() {
								callbacks.onChange(null);
							}
						};
					},
					props: {
						handleKeyDown(view, event) {
							if (!slashKey.getState(view.state)) return false;
							if (event.key === 'Escape') {
								view.dispatch(view.state.tr.setMeta(CLOSE, true));
								return true;
							}
							return callbacks.onKeyDown(event);
						}
					}
				})
			];
		}
	});
}

/** Closes the menu without inserting anything. */
export function closeSlash(editor: Editor): void {
	editor.view.dispatch(editor.state.tr.setMeta(CLOSE, true));
}
