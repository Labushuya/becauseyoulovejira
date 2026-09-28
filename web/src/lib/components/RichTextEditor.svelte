<script lang="ts" module>
	import type * as EditorModule from '$lib/editor/create-editor';

	type Loaded = typeof EditorModule;
	let loading: Promise<Loaded> | null = null;

	/**
	 * The chunk of the editor (Tiptap, ProseMirror, the bridge), loaded once on the first
	 * "Bearbeiten" (ADR-0032 section 5); a failed load is tried again next time.
	 */
	export function loadEditor(): Promise<Loaded> {
		loading ??= import('$lib/editor/create-editor').catch((error: unknown) => {
			loading = null;
			throw error;
		});
		return loading;
	}
</script>

<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import type { EditorCommand, RichEditor, ToolbarState } from '$lib/editor/create-editor';
	import type { NotEditableReason } from '$lib/editor/markdown-bridge';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import EditorToolbar from './editor/EditorToolbar.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// Editor like Jira (ADR-0032, plan editor RT-3): Tiptap with a toolbar, the keys of Jira and
	// the input rules of Markdown; stored is Markdown through the bridge. The editor loads on
	// mount (the first "Bearbeiten"); until then an empty frame shows. `value` changes only when
	// the document changes, so opening and saving unchanged writes nothing (plan section 3.1).
	// "Markdown" switches to the textarea of before (MarkdownEditor) and back. A text the editor
	// cannot hold without changing it opens there with a hint, and so does everything when the
	// chunk cannot be loaded. Escape in the editor is consumed, so panel and full view stay open.
	let {
		value = $bindable(''),
		label,
		maxlength,
		compact = false,
		placeholder = '',
		invalid = false,
		describedby,
		onsubmit
	}: {
		value?: string;
		label: string;
		maxlength: number;
		/** Without the menu of text styles (comments). */
		compact?: boolean;
		placeholder?: string;
		invalid?: boolean;
		/** IDs of further descriptions, e.g. a field error. */
		describedby?: string;
		/** Ctrl+Enter: save or send. */
		onsubmit?: () => void;
	} = $props();

	const uid = $props.id();
	const labelId = `${uid}-label`;
	const contentId = `${uid}-content`;
	const counterId = `${uid}-counter`;
	const hintId = `${uid}-hint`;
	/** The counter appears once 90 % of the limit are used (as in MarkdownEditor). */
	const COUNTER_THRESHOLD = 0.9;

	const REASONS: Readonly<Record<NotEditableReason | 'difference', string>> = {
		table: 'Gefunden: eine Tabelle.',
		'mixed-list': 'Gefunden: eine Liste aus Aufgaben und normalen Punkten.',
		unknown: '',
		difference: ''
	};

	let loaded = $state<Loaded | null>(null);
	let failed = $state(false);
	/** The source mode (textarea) is shown. */
	let source = $state(false);
	/** Why the source mode was forced, shown as hint; null when the user chose it. */
	let reason = $state<NotEditableReason | 'difference' | null>(null);
	let toolbarState = $state<ToolbarState>({
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
	});
	let host = $state<HTMLDivElement>();
	let textarea = $state<HTMLTextAreaElement>();
	let toolbar = $state<ReturnType<typeof EditorToolbar>>();

	let rich: RichEditor | null = null;
	/** The last Markdown the editor wrote or was given; other values come from outside. */
	let written = untrack(() => value);
	/** The focus goes into the editor as soon as it exists. */
	let wantFocus = false;

	const counterVisible = $derived(value.length >= maxlength * COUNTER_THRESHOLD);
	const tooLong = $derived(value.length > maxlength);
	const describedBy = $derived(
		[describedby, counterVisible ? counterId : null].filter(Boolean).join(' ') || undefined
	);
	const attributes = $derived({
		id: contentId,
		role: 'textbox',
		'aria-multiline': 'true',
		'aria-labelledby': labelId,
		class: 'prose rich-text-content',
		...(describedBy ? { 'aria-describedby': describedBy } : {}),
		...(invalid || tooLong ? { 'aria-invalid': 'true' } : {})
	});
	const numbers = new Intl.NumberFormat('de-DE');

	onMount(() => {
		loadEditor().then(
			(module) => (loaded = module),
			() => {
				failed = true;
				source = true;
				if (wantFocus) void focusSource();
			}
		);
	});

	// The editor lives while the rich mode is shown; leaving it (source mode, unmount) destroys it.
	$effect(() => {
		const module = loaded;
		const element = host;
		if (module === null || element === undefined || source) return;
		return untrack(() => {
			const check = module.checkEditable(value);
			if (!check.editable) {
				reason = check.reason;
				source = true;
				if (wantFocus) void focusSource();
				return;
			}
			written = value;
			const instance = module.createRichEditor({
				element,
				doc: check.doc,
				attributes,
				placeholder,
				onChange: (markdown) => {
					written = markdown;
					value = markdown;
				},
				onState: (state) => (toolbarState = state),
				onSubmit: onsubmit === undefined ? undefined : () => onsubmit?.(),
				onToolbar: () => toolbar?.focus()
			});
			rich = instance;
			if (wantFocus) {
				wantFocus = false;
				instance.focus();
			}
			return () => {
				instance.destroy();
				if (rich === instance) rich = null;
			};
		});
	});

	$effect(() => {
		const next = attributes;
		untrack(() => rich?.setAttributes(next));
	});

	// A value from outside (sent comment, discarded draft) replaces the document.
	$effect(() => {
		const next = value;
		untrack(() => {
			if (next === written) return;
			written = next;
			if (source || rich === null || loaded === null) return;
			const check = loaded.checkEditable(next);
			if (check.editable) {
				rich.setDoc(check.doc);
			} else {
				reason = check.reason;
				source = true;
			}
		});
	});

	async function focusSource() {
		wantFocus = false;
		await tick();
		textarea?.focus();
	}

	/** Puts the focus into the editor or the textarea, also before the editor has loaded. */
	export function focus(): void {
		if (source) textarea?.focus();
		else if (rich !== null) rich.focus();
		else wantFocus = true;
	}

	/** Writes a change that still waits (large texts) into `value`. */
	export function flush(): void {
		rich?.flush();
	}

	function run(command: EditorCommand) {
		rich?.run(command);
	}

	async function toggleSource() {
		if (source) {
			if (loaded === null) return;
			const check = loaded.checkEditable(value);
			if (!check.editable) {
				reason = check.reason;
				return;
			}
			reason = null;
			wantFocus = true;
			source = false;
			return;
		}
		rich?.flush();
		reason = null;
		source = true;
		await tick();
		textarea?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		// A field in editing mode keeps Escape (escape chain, ADR-0025 section 1); menus inside
		// consumed theirs already.
		if (event.key === 'Escape' && !event.defaultPrevented) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (source && event.key === 'Enter' && (event.ctrlKey || event.metaKey) && onsubmit) {
			event.preventDefault();
			onsubmit();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="rich-text" class:compact {onkeydown}>
	{#if !source}
		<span class="label" id={labelId}>{label}</span>
	{/if}
	{#if failed}
		<SectionMessage tone="info" compact>
			<p id={hintId}>
				Der Editor konnte nicht geladen werden. Du bearbeitest den Text als Markdown.
			</p>
		</SectionMessage>
	{:else if source && reason !== null}
		<SectionMessage tone="info" compact>
			<p id={hintId}>
				Dieser Text enthält Elemente, die nur als Markdown bearbeitet werden können.
				{REASONS[reason]}
			</p>
		</SectionMessage>
	{/if}
	<div class="frame" class:source>
		{#if loaded !== null || failed}
			<EditorToolbar
				bind:this={toolbar}
				formats={toolbarState}
				{source}
				{compact}
				controls={source ? `${uid}-source` : contentId}
				sourceAvailable={!failed}
				onrun={run}
				onsource={() => void toggleSource()}
				onleave={() => rich?.focus()}
			/>
		{/if}
		{#if source}
			<div class="source-editor" id={`${uid}-source`}>
				<MarkdownEditor
					label={`${label} (Markdown)`}
					{maxlength}
					bind:value
					bind:textarea
					aria-invalid={invalid ? 'true' : undefined}
					aria-describedby={[describedby, reason !== null || failed ? hintId : null]
						.filter(Boolean)
						.join(' ') || undefined}
				/>
			</div>
		{:else if loaded === null}
			<div class="loading prose" aria-busy="true">
				<p>Editor wird geladen …</p>
			</div>
		{:else}
			<div class="content" bind:this={host}></div>
		{/if}
	</div>
	{#if !source && counterVisible}
		<p class="counter" id={counterId}>
			{numbers.format(value.length)} von {numbers.format(maxlength)} Zeichen
		</p>
	{/if}
</div>

<style>
	.rich-text {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.375rem;
	}

	.label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	/*
	 * The editing surface is opaque like every form (ADR-0029 section 1): surface, the frame of the
	 * textarea and its radius; no glass in the toolbar.
	 */
	.frame {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		overflow: hidden;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	/* The ring of the text sits on the frame, around toolbar and text, like around a textarea. */
	.frame:has(:global(.rich-text-content:focus)) {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 1px;
	}

	.frame.source {
		overflow: visible;
		border-color: transparent;
	}

	.source-editor {
		padding-top: 0.375rem;
	}

	.content :global(.rich-text-content),
	.loading {
		min-height: 8rem;
		max-height: 60vh;
		padding: 0.5rem 0.625rem;
		overflow-y: auto;
	}

	.compact .content :global(.rich-text-content) {
		min-height: 4.5rem;
	}

	.content :global(.rich-text-content:focus-visible) {
		outline: none;
	}

	.loading {
		color: var(--color-text-muted);
	}

	/* Placeholder of an empty document (Tiptap sets data-placeholder on the first paragraph). */
	.content :global(.rich-text-content p.is-editor-empty:first-child::before) {
		float: left;
		height: 0;
		color: var(--color-text-muted);
		pointer-events: none;
		content: attr(data-placeholder);
	}

	.counter {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	/*
	 * What ProseMirror needs from CSS; Tiptap would inject it with a fixed black cursor, so it
	 * stands here with the tokens instead (create-editor.ts: injectCSS false).
	 */
	.content :global(.ProseMirror) {
		position: relative;
		overflow-wrap: break-word;
		white-space: pre-wrap;
		white-space: break-spaces;
		font-variant-ligatures: none;
		font-feature-settings: 'liga' 0;
	}

	.content :global(.ProseMirror pre) {
		white-space: pre-wrap;
	}

	.content :global(img.ProseMirror-separator) {
		display: inline;
		width: 0;
		height: 0;
		margin: 0;
		border: none;
	}

	.content :global(.ProseMirror-gapcursor) {
		position: absolute;
		display: none;
		margin: 0;
		pointer-events: none;
	}

	.content :global(.ProseMirror-gapcursor::after) {
		position: absolute;
		top: -2px;
		display: block;
		width: 20px;
		border-top: 1px solid var(--color-text);
		content: '';
	}

	.content :global(.ProseMirror-focused .ProseMirror-gapcursor) {
		display: block;
	}

	.content :global(.ProseMirror-hideselection *::selection) {
		background: transparent;
	}

	.content :global(.ProseMirror-hideselection *) {
		caret-color: transparent;
	}
</style>
