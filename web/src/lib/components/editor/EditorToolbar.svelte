<script lang="ts">
	import { tick } from 'svelte';
	import Popover from '$lib/components/overlay/Popover.svelte';
	import { ariaKeyShortcuts, keysText, shortcutById } from '$lib/domain/shortcuts';
	import type { EditorCommand, LinkState, ToolbarState } from '$lib/editor/create-editor';
	import EditorIcon, { type EditorIconName } from './EditorIcon.svelte';
	import LinkPopover from './LinkPopover.svelte';

	// Toolbar of the editor (ADR-0032, plan editor section 3.2), after the WAI-ARIA toolbar pattern:
	// one tab stop with a roving tabindex, arrow keys, Home and End move between the controls, Alt+F10
	// in the text comes here (create-editor.ts) and Escape goes back to the text. Toggles carry
	// aria-pressed, menus are the Popover building block (kind "menu"). Names, titles and
	// aria-keyshortcuts come from domain/shortcuts.ts. Where the toolbar is narrow (the 480 px panel)
	// lists and blocks move into the menu "…". In the source mode only "Markdown" stays.
	let {
		formats,
		source,
		compact = false,
		controls,
		sourceAvailable = true,
		onrun,
		onsource,
		onleave,
		link,
		textTarget
	}: {
		/** Formats at the selection: pressed toggles, chosen text style. */
		formats: ToolbarState;
		/** The source mode (textarea) is shown. */
		source: boolean;
		/** Without the menu of text styles (comments). */
		compact?: boolean;
		/** ID of the editable element. */
		controls: string;
		/** False while the editor cannot show the text (the switch back would fail). */
		sourceAvailable?: boolean;
		onrun: (command: EditorCommand) => void;
		onsource: () => void;
		/** Escape: back into the text. */
		onleave: () => void;
		/** The link at the selection and how to set or remove it (RT-4). */
		link: {
			current: () => LinkState;
			apply: (href: string, text: string) => void;
			remove: () => void;
		};
		/** The editable element, where the focus goes after the link popover. */
		textTarget: () => HTMLElement | null;
	} = $props();

	let linkPopover = $state<ReturnType<typeof LinkPopover>>();

	/** Opens the link popover (Ctrl+K and "Link" in the "/" menu). */
	export function openLink(): void {
		linkPopover?.open();
	}

	/** Below this width (px) lists and blocks go into the menu "…". */
	const NARROW_BELOW = 560;

	let root = $state<HTMLDivElement>();
	let width = $state(Infinity);
	/** Index of the control that holds the tab stop. */
	let current = 0;

	const narrow = $derived(width < NARROW_BELOW);

	$effect(() => {
		const element = root;
		if (element === undefined || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) width = entry.contentRect.width;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	/** The controls of the bar in order, without the entries inside the menus. */
	function items(): HTMLElement[] {
		if (root === undefined) return [];
		return [...root.querySelectorAll<HTMLElement>('.tool')].filter(
			(item) => item.closest('[popover]') === null
		);
	}

	/** Gives the tab stop to control `index`; every other control gets -1. */
	function rove(index: number): void {
		const list = items();
		if (list.length === 0) return;
		current = Math.min(Math.max(index, 0), list.length - 1);
		list.forEach((item, i) => (item.tabIndex = i === current ? 0 : -1));
	}

	// After every change of the controls exactly one of them holds the tab stop.
	$effect(() => {
		void [source, narrow, compact];
		void tick().then(() => rove(current));
	});

	/** Focus on the control that holds the tab stop (Alt+F10). */
	export function focus(): void {
		rove(current);
		items()[current]?.focus();
	}

	function onfocusin(event: FocusEvent) {
		const index = items().indexOf(event.target as HTMLElement);
		if (index >= 0) rove(index);
	}

	function onkeydown(event: KeyboardEvent) {
		if ((event.target as Element).closest('[popover]') !== null) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onleave();
			return;
		}
		const list = items();
		const index = list.indexOf(event.target as HTMLElement);
		if (index < 0) return;
		const next: Record<string, number> = {
			ArrowRight: (index + 1) % list.length,
			ArrowLeft: (index - 1 + list.length) % list.length,
			Home: 0,
			End: list.length - 1
		};
		const target = next[event.key];
		if (target === undefined) return;
		event.preventDefault();
		rove(target);
		list[target]?.focus();
	}

	/** Name with shortcut for the title, e.g. "Fett (Strg+B)". */
	function titleOf(label: string, shortcut: string): string {
		return `${label} (${keysText(shortcutById(shortcut))})`;
	}

	/** Runs a command of a menu after closing it, so the focus goes on into the text. */
	function choose(close: () => void, command: EditorCommand) {
		close();
		onrun(command);
	}

	interface Toggle {
		command: EditorCommand;
		label: string;
		icon: EditorIconName;
		shortcut: string;
		pressed: (formats: ToolbarState) => boolean;
	}

	const MARKS: readonly Toggle[] = [
		{
			command: 'bold',
			label: 'Fett',
			icon: 'bold',
			shortcut: 'editor-bold',
			pressed: (s) => s.bold
		},
		{
			command: 'italic',
			label: 'Kursiv',
			icon: 'italic',
			shortcut: 'editor-italic',
			pressed: (s) => s.italic
		},
		{
			command: 'underline',
			label: 'Unterstrichen',
			icon: 'underline',
			shortcut: 'editor-underline',
			pressed: (s) => s.underline
		},
		{
			command: 'strike',
			label: 'Durchgestrichen',
			icon: 'strike',
			shortcut: 'editor-strike',
			pressed: (s) => s.strike
		}
	];

	const LISTS: readonly Toggle[] = [
		{
			command: 'bulletList',
			label: 'Aufzählung',
			icon: 'bulletList',
			shortcut: 'editor-bullet-list',
			pressed: (s) => s.bulletList
		},
		{
			command: 'orderedList',
			label: 'Nummerierte Liste',
			icon: 'orderedList',
			shortcut: 'editor-ordered-list',
			pressed: (s) => s.orderedList
		},
		{
			command: 'taskList',
			label: 'Checkliste',
			icon: 'taskList',
			shortcut: 'editor-task-list',
			pressed: (s) => s.taskList
		}
	];

	const BLOCKS: readonly Toggle[] = [
		{
			command: 'blockquote',
			label: 'Zitat',
			icon: 'blockquote',
			shortcut: 'editor-quote',
			pressed: (s) => s.blockquote
		},
		{
			command: 'codeBlock',
			label: 'Codeblock',
			icon: 'codeBlock',
			shortcut: 'editor-code-block',
			pressed: (s) => s.codeBlock
		}
	];

	const STYLES: readonly {
		level: number;
		label: string;
		command: EditorCommand;
		shortcut: string;
	}[] = [
		{ level: 0, label: 'Normaler Text', command: 'paragraph', shortcut: 'editor-paragraph' },
		{ level: 1, label: 'Überschrift 1', command: 'heading1', shortcut: 'editor-heading-1' },
		{ level: 2, label: 'Überschrift 2', command: 'heading2', shortcut: 'editor-heading-2' },
		{ level: 3, label: 'Überschrift 3', command: 'heading3', shortcut: 'editor-heading-3' }
	];

	const styleLabel = $derived(
		formats.heading === 0 ? 'Normaler Text' : `Überschrift ${formats.heading}`
	);
</script>

{#snippet toggle(item: Toggle, disabled: boolean)}
	<button
		class="button-icon tool"
		type="button"
		aria-label={item.label}
		title={titleOf(item.label, item.shortcut)}
		aria-keyshortcuts={ariaKeyShortcuts(shortcutById(item.shortcut))}
		aria-pressed={item.pressed(formats)}
		aria-disabled={disabled ? 'true' : undefined}
		onclick={() => {
			if (!disabled) onrun(item.command);
		}}
	>
		<EditorIcon name={item.icon} />
	</button>
{/snippet}

{#snippet menuToggle(item: Toggle, close: () => void)}
	<button
		type="button"
		role="menuitemcheckbox"
		aria-checked={item.pressed(formats)}
		aria-keyshortcuts={ariaKeyShortcuts(shortcutById(item.shortcut))}
		onclick={() => choose(close, item.command)}
	>
		<EditorIcon name={item.icon} />
		<span class="entry">{item.label}</span>
	</button>
{/snippet}

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
	class="toolbar"
	role="toolbar"
	aria-label="Formatierung"
	aria-controls={controls}
	bind:this={root}
	{onkeydown}
	{onfocusin}
>
	{#if !source}
		{#if !compact}
			<Popover
				kind="menu"
				label="Textstil"
				buttonClass="tool style"
				buttonLabel={`Textstil: ${styleLabel}`}
			>
				{#snippet button()}
					<span class="style-label">{styleLabel}</span>
					<EditorIcon name="chevron" size={12} />
				{/snippet}
				{#snippet children({ close })}
					{#each STYLES as style (style.level)}
						<button
							type="button"
							role="menuitemradio"
							aria-checked={formats.heading === style.level}
							aria-keyshortcuts={ariaKeyShortcuts(shortcutById(style.shortcut))}
							onclick={() => choose(close, style.command)}
						>
							<span class="entry" class:heading={style.level > 0}>{style.label}</span>
						</button>
					{/each}
				{/snippet}
			</Popover>
			<span class="separator" aria-hidden="true"></span>
		{/if}
		{#each MARKS as item (item.command)}
			{@render toggle(item, formats.marksDisabled)}
		{/each}
		<Popover
			kind="menu"
			label="Weitere Formatierungen"
			buttonClass="button-icon tool"
			buttonLabel="Weitere Formatierungen"
		>
			{#snippet button()}
				<EditorIcon name="more" />
			{/snippet}
			{#snippet children({ close })}
				<button
					type="button"
					role="menuitemcheckbox"
					aria-checked={formats.code}
					aria-keyshortcuts={ariaKeyShortcuts(shortcutById('editor-code'))}
					onclick={() => choose(close, 'code')}
				>
					<span class="entry">Inline-Code</span>
				</button>
				<button type="button" role="menuitem" onclick={() => choose(close, 'clearFormatting')}>
					<span class="entry">Formatierung entfernen</span>
				</button>
			{/snippet}
		</Popover>
		<LinkPopover
			bind:this={linkPopover}
			current={link.current}
			onapply={link.apply}
			onremove={link.remove}
			{textTarget}
		/>
		{#if narrow}
			<Popover
				kind="menu"
				label="Listen und Blöcke"
				buttonClass="button-icon tool"
				buttonLabel="Listen und Blöcke"
			>
				{#snippet button()}
					<EditorIcon name="overflow" />
				{/snippet}
				{#snippet children({ close })}
					{#each LISTS as item (item.command)}
						{@render menuToggle(item, close)}
					{/each}
					<div role="separator"></div>
					{#each BLOCKS as item (item.command)}
						{@render menuToggle(item, close)}
					{/each}
					<button type="button" role="menuitem" onclick={() => choose(close, 'horizontalRule')}>
						<EditorIcon name="horizontalRule" />
						<span class="entry">Trennlinie</span>
					</button>
				{/snippet}
			</Popover>
		{:else}
			<span class="separator" aria-hidden="true"></span>
			{#each LISTS as item (item.command)}
				{@render toggle(item, false)}
			{/each}
			<span class="separator" aria-hidden="true"></span>
			{#each BLOCKS as item (item.command)}
				{@render toggle(item, false)}
			{/each}
			<button
				class="button-icon tool"
				type="button"
				aria-label="Trennlinie"
				title="Trennlinie"
				onclick={() => onrun('horizontalRule')}
			>
				<EditorIcon name="horizontalRule" />
			</button>
		{/if}
	{/if}
	<button
		class="tool source"
		type="button"
		aria-pressed={source}
		aria-disabled={sourceAvailable ? undefined : 'true'}
		title={source ? 'Zurück zum Editor' : 'Als Markdown bearbeiten'}
		onclick={() => {
			if (sourceAvailable) onsource();
		}}
	>
		Markdown
	</button>
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.125rem;
		align-items: center;
		min-width: 0;
		padding: 0.25rem;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-line);
	}

	.toolbar :global(.tool.button-icon) {
		width: var(--control-height-m);
		height: var(--control-height-m);
	}

	.toolbar :global(.tool[aria-pressed='true']) {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
	}

	.toolbar :global(.tool[aria-disabled='true']) {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.toolbar :global(.tool.style) {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		width: 8.5rem;
		height: var(--control-height-m);
		padding: 0 0.375rem 0 0.5rem;
		font-size: var(--font-size-control);
		color: var(--color-text);
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.toolbar :global(.tool.style:hover) {
		background: var(--fill-control-hover);
	}

	.style-label {
		flex: 1;
		overflow: hidden;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.separator {
		flex: none;
		width: 1px;
		height: 1.25rem;
		margin: 0 0.25rem;
		background: var(--color-line);
	}

	.source {
		margin-left: auto;
		height: var(--control-height-m);
		padding: 0 0.5rem;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.source:hover {
		color: var(--color-text);
		background: var(--fill-control-hover);
	}

	:global(.editor-icon) + .entry {
		margin-left: 0.375rem;
	}

	.entry.heading {
		font-weight: 600;
	}

	/* Without colors the pressed state keeps a frame (ADR-0029, forced colors). */
	@media (forced-colors: active) {
		.toolbar :global(.tool[aria-pressed='true']) {
			border-color: currentColor;
		}
	}
</style>
