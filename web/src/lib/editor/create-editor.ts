// The WYSIWYG editor (ADR-0032, plan editor RT-3): Tiptap 3 with the schema the Markdown bridge
// knows, the keys of Jira and the input rules of Markdown. This module is the chunk that loads on
// the first "Bearbeiten" (RichTextEditor.svelte imports it with import(); editor-lazy.test.ts).
// Tiptap is headless: toolbar, menus and texts are ours.

import {
	Editor,
	Extension,
	getMarkRange,
	getSchema,
	markInputRule,
	type AnyExtension,
	type Range
} from '@tiptap/core';
import { BulletList, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { Slice, type Node } from '@tiptap/pm/model';
import { createMarkdownBridge, type MarkdownBridge } from './markdown-bridge';
import { looksLikeMarkdown, transformPastedHTML } from './paste';
import { richEditable, type EditableCheck } from './rich-editable';
import { closeSlash, slashExtension, type SlashCallbacks } from './slash';

export { filterSlashItems, type SlashItem, type SlashState } from './slash';

/** What the toolbar shows as pressed or chosen. */
export interface ToolbarState {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	code: boolean;
	/** Level of the heading at the selection, 0 for normal text. */
	heading: number;
	bulletList: boolean;
	orderedList: boolean;
	taskList: boolean;
	blockquote: boolean;
	codeBlock: boolean;
	/** In a code block no formatting applies. */
	marksDisabled: boolean;
}

export const EMPTY_TOOLBAR_STATE: ToolbarState = {
	bold: false,
	italic: false,
	underline: false,
	strike: false,
	code: false,
	heading: 0,
	bulletList: false,
	orderedList: false,
	taskList: false,
	blockquote: false,
	codeBlock: false,
	marksDisabled: false
};

/** Commands of the toolbar and the menus. */
export type EditorCommand =
	| 'bold'
	| 'italic'
	| 'underline'
	| 'strike'
	| 'code'
	| 'paragraph'
	| 'heading1'
	| 'heading2'
	| 'heading3'
	| 'bulletList'
	| 'orderedList'
	| 'taskList'
	| 'blockquote'
	| 'codeBlock'
	| 'horizontalRule'
	| 'clearFormatting';

/** Links only to http, https and mailto (ADR-0008, CLAUDE.md section 7). */
const ALLOWED_LINK = /^(?:https?:|mailto:)/i;

/** "++text++" underlines while typing, like "**text**" makes bold (ADR-0032 section 1). */
const UNDERLINE_INPUT = /(?:^|\s)(\+\+(?!\s+\+\+)((?:[^+]+))\+\+(?!\s+\+\+))$/;

/** Attributes of the lists that the bridge keeps and the editor does not show. */
const listAttributes = (marker: 'bullet' | 'delimiter') => ({
	tight: { default: true, rendered: false },
	[marker]: { default: marker === 'bullet' ? '-' : '.', rendered: false }
});

/** Extensions that make up the schema; the same for every editor. */
function schemaExtensions(): AnyExtension[] {
	return [
		StarterKit.configure({
			bulletList: false,
			orderedList: false,
			underline: false,
			trailingNode: false,
			link: {
				openOnClick: false,
				autolink: true,
				linkOnPaste: true,
				defaultProtocol: 'https',
				isAllowedUri: (url, context) => ALLOWED_LINK.test(url) && context.defaultValidate(url),
				HTMLAttributes: { target: null, rel: 'noopener noreferrer nofollow' }
			}
		}),
		Underline.extend({
			addInputRules() {
				return [markInputRule({ find: UNDERLINE_INPUT, type: this.type })];
			}
		}),
		BulletList.extend({
			addAttributes() {
				return { ...this.parent?.(), ...listAttributes('bullet') };
			}
		}),
		OrderedList.extend({
			addAttributes() {
				return { ...this.parent?.(), ...listAttributes('delimiter') };
			}
		}),
		TaskList.extend({
			addAttributes() {
				return { ...this.parent?.(), ...listAttributes('bullet') };
			}
		}),
		TaskItem.configure({
			nested: true,
			a11y: { checkboxLabel: (node) => node.textContent.trim().slice(0, 200) || 'Aufgabe' }
		})
	];
}

/** The schema of every editor: the nodes and marks the bridge maps, nothing else. */
export const editorSchema = getSchema(schemaExtensions());

/** The bridge on the schema of the editor. */
export const bridge: MarkdownBridge = createMarkdownBridge(editorSchema);

/** The document of a text, or why it opens in the source mode (ADR-0032 section 4). */
export function checkEditable(markdown: string): EditableCheck {
	return richEditable(markdown, bridge);
}

export interface RichEditorOptions {
	/** Element the editor mounts into. */
	element: HTMLElement;
	/** Start document (from `checkEditable`). */
	doc: Node;
	/** Attributes of the editable element: role, name, description, state. */
	attributes: Record<string, string>;
	placeholder?: string;
	/** The Markdown after a change of the document (not for setting it). */
	onChange: (markdown: string) => void;
	/** The state of the toolbar after every transaction. */
	onState: (state: ToolbarState) => void;
	/** Ctrl+Enter: save or send; without it the key is left to the form around. */
	onSubmit?: () => void;
	/** Alt+F10: to the toolbar. */
	onToolbar: () => void;
	/** Ctrl+K and "Link" in the "/" menu: open the link popover (RT-4). */
	onLink?: () => void;
	/** The "/" menu (RT-4). */
	onSlash?: SlashCallbacks;
}

/** The link at the selection: its address (null without link) and the text the popover shows. */
export interface LinkState {
	href: string | null;
	text: string;
}

export interface RichEditor {
	run(command: EditorCommand): void;
	/** Inserts the block of an entry of the "/" menu in place of "/" and its query. */
	runSlash(id: string, range: Range): void;
	/** Closes the "/" menu without inserting. */
	closeSlash(): void;
	/** The link at the selection, for the popover. */
	link(): LinkState;
	/** Sets a link on the selection (or the link there); a text replaces the linked words. */
	setLink(href: string, text: string): void;
	/** Removes the link at the selection. */
	unsetLink(): void;
	/** Replaces the document without counting as a change. */
	setDoc(doc: Node): void;
	setAttributes(attributes: Record<string, string>): void;
	/** Writes a pending change at once (before saving). */
	flush(): void;
	focus(): void;
	destroy(): void;
	/** The Tiptap editor, for tests and the menus of later packages. */
	readonly editor: Editor;
}

/** Documents up to this size are written to Markdown on every change, larger ones after a pause. */
const SYNC_LIMIT = 20_000;
const WRITE_DELAY = 250;

function toolbarStateOf(editor: Editor): ToolbarState {
	const codeBlock = editor.isActive('codeBlock');
	return {
		bold: editor.isActive('bold'),
		italic: editor.isActive('italic'),
		underline: editor.isActive('underline'),
		strike: editor.isActive('strike'),
		code: editor.isActive('code'),
		heading: [1, 2, 3, 4, 5, 6].find((level) => editor.isActive('heading', { level })) ?? 0,
		bulletList: editor.isActive('bulletList'),
		orderedList: editor.isActive('orderedList'),
		taskList: editor.isActive('taskList'),
		blockquote: editor.isActive('blockquote'),
		codeBlock,
		marksDisabled: codeBlock
	};
}

type Chain = ReturnType<Editor['chain']>;

const COMMANDS: Readonly<Record<EditorCommand, (chain: Chain) => Chain>> = {
	bold: (chain) => chain.toggleBold(),
	italic: (chain) => chain.toggleItalic(),
	underline: (chain) => chain.toggleUnderline(),
	strike: (chain) => chain.toggleStrike(),
	code: (chain) => chain.toggleCode(),
	paragraph: (chain) => chain.setParagraph(),
	heading1: (chain) => chain.setHeading({ level: 1 }),
	heading2: (chain) => chain.setHeading({ level: 2 }),
	heading3: (chain) => chain.setHeading({ level: 3 }),
	bulletList: (chain) => chain.toggleBulletList(),
	orderedList: (chain) => chain.toggleOrderedList(),
	taskList: (chain) => chain.toggleTaskList(),
	blockquote: (chain) => chain.toggleBlockquote(),
	codeBlock: (chain) => chain.toggleCodeBlock(),
	horizontalRule: (chain) => chain.setHorizontalRule(),
	clearFormatting: (chain) => chain.unsetAllMarks().clearNodes()
};

/** Creates an editor in `options.element`. */
export function createRichEditor(options: RichEditorOptions): RichEditor {
	let pending: ReturnType<typeof setTimeout> | null = null;

	const keys = Extension.create({
		name: 'bylEditorKeys',
		priority: 1000,
		addKeyboardShortcuts() {
			return {
				// Ctrl+Enter saves or sends, never a line break (Shift+Enter makes one). Without
				// onSubmit the key goes on to the form around (NewTicketForm, RecurrencePanel), which
				// saves with the value just written.
				'Mod-Enter': () => {
					flush();
					options.onSubmit?.();
					return true;
				},
				'Alt-F10': () => {
					options.onToolbar();
					return true;
				},
				'Mod-k': () => {
					if (options.onLink === undefined) return false;
					options.onLink();
					return true;
				}
			};
		}
	});

	// Pasting (RT-5): HTML is cleaned first; plain text that looks like Markdown is read through the
	// bridge, unless it is pasted as plain text (Ctrl+Shift+V) or the bridge cannot hold it.
	const readMarkdown = (text: string, plain: boolean): Slice | undefined => {
		if (plain || !looksLikeMarkdown(text)) return undefined;
		try {
			// The bridge builds in the shared schema; every editor has its own instance of it.
			const doc = editor.schema.nodeFromJSON(bridge.parse(text).toJSON());
			return Slice.maxOpen(doc.content);
		} catch {
			return undefined;
		}
	};
	const pasteProps = {
		transformPastedHTML: (html: string) => transformPastedHTML(html),
		// Without a result ProseMirror pastes the text as plain paragraphs (someProp takes the first
		// truthy answer), so the type of the prop is met on purpose only by the Markdown case.
		clipboardTextParser: (text: string, _context: unknown, plain: boolean) =>
			readMarkdown(text, plain) as Slice
	};

	const editor = new Editor({
		element: options.element,
		extensions: [
			...schemaExtensions(),
			Placeholder.configure({ placeholder: options.placeholder ?? '' }),
			keys,
			...(options.onSlash ? [slashExtension(options.onSlash)] : [])
		],
		content: options.doc.toJSON(),
		// The CSS ProseMirror needs stands in RichTextEditor.svelte with the tokens.
		injectCSS: false,
		// Markdown in pasted text is read by clipboardTextParser; the paste rules of Tiptap would
		// also format text pasted as plain text (Ctrl+Shift+V).
		enablePasteRules: false,
		editorProps: { attributes: options.attributes, ...pasteProps },
		onUpdate: () => {
			if (editor.state.doc.content.size <= SYNC_LIMIT) {
				write();
				return;
			}
			if (pending !== null) clearTimeout(pending);
			pending = setTimeout(write, WRITE_DELAY);
		},
		onTransaction: () => options.onState(toolbarStateOf(editor)),
		onBlur: () => flush()
	});

	/** Writes the changed document as Markdown. */
	function write() {
		if (pending !== null) {
			clearTimeout(pending);
			pending = null;
		}
		options.onChange(bridge.serialize(editor.state.doc));
	}

	/** Writes a change that waits for its pause; nothing if there is none. */
	function flush() {
		if (pending !== null) write();
	}

	options.onState(toolbarStateOf(editor));

	return {
		editor,
		run(command) {
			COMMANDS[command](editor.chain().focus()).run();
		},
		runSlash(id, range) {
			const chain = editor.chain().focus().deleteRange(range);
			if (id === 'link') {
				chain.run();
				options.onLink?.();
				return;
			}
			const command = COMMANDS[id as EditorCommand];
			if (command === undefined) return;
			command(chain).run();
		},
		closeSlash() {
			closeSlash(editor);
		},
		link() {
			const { state } = editor;
			const { from, to, empty, $from } = state.selection;
			const href = (editor.getAttributes('link').href as string | undefined) ?? null;
			const type = state.schema.marks.link;
			const range = href !== null && empty && type ? getMarkRange($from, type) : undefined;
			const text = range
				? state.doc.textBetween(range.from, range.to, ' ')
				: state.doc.textBetween(from, to, ' ');
			return { href, text };
		},
		setLink(href, text) {
			const { state } = editor;
			const type = state.schema.marks.link;
			let { from, to } = state.selection;
			if (from === to && type && editor.isActive('link')) {
				const range = getMarkRange(state.selection.$from, type);
				if (range) ({ from, to } = range);
			}
			const current = state.doc.textBetween(from, to, ' ');
			const given = text.trim();
			const wanted = given === '' ? (from === to ? href : current) : given;
			const chain = editor.chain().focus().setTextSelection({ from, to });
			if (wanted !== current) {
				chain
					.insertContent({ type: 'text', text: wanted, marks: [{ type: 'link', attrs: { href } }] })
					.run();
				return;
			}
			chain.setLink({ href }).run();
		},
		unsetLink() {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
		},
		setDoc(doc) {
			if (pending !== null) clearTimeout(pending);
			pending = null;
			editor.commands.setContent(doc.toJSON(), { emitUpdate: false });
		},
		setAttributes(attributes) {
			editor.setOptions({ editorProps: { attributes, ...pasteProps } });
		},
		flush,
		focus() {
			editor.commands.focus();
		},
		destroy() {
			flush();
			editor.destroy();
		}
	};
}
