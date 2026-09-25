<script lang="ts">
	import {
		TAG_NAME_MAX_LENGTH,
		findTagByName,
		normalizeTagName,
		tagNameProblem,
		tagSuggestions
	} from '$lib/domain/tag';
	import type { TagRef } from '$lib/domain/ticket';
	import { place } from '$lib/overlay/position';

	// Tag picker (E3 plan, T-14 and package 8) after the WAI-ARIA pattern "combobox with listbox":
	// an input with suggestions (arrow keys move, Enter chooses, Escape closes), the chosen tags as
	// chips with "Tag X entfernen". The last option creates a new tag from the input. Every action
	// runs through the callbacks, which save at once; while one runs the picker takes no further
	// action, so a quick double Enter creates one tag. The list of suggestions lies in the top layer
	// (popover="manual", ADR-0025 section 5, package UI-9), placed below the input by place() and
	// following scrolling and resizing, so a scrolling panel or a modal no longer cuts it off. It
	// opens and closes by code as before; the focus stays in the input. Escape closes the list and
	// is consumed (preventDefault), so the panel or the modal around stays open.
	let {
		id,
		selected,
		tags,
		text = $bindable(''),
		busy = false,
		error = null,
		errorId,
		describedBy,
		onadd,
		onremove,
		oncreate
	}: {
		/** ID of the input, for the label of the owner. */
		id: string;
		/** Tags of the ticket, in their order. */
		selected: readonly TagRef[];
		/** Every tag that can be chosen (the catalog). */
		tags: readonly TagRef[];
		/** Text of the input; the owner keeps it for the question on leaving. */
		text?: string;
		/** The owner saves; the picker takes no action meanwhile. */
		busy?: boolean;
		error?: string | null;
		errorId: string;
		/** Further description of the input (hint). */
		describedBy?: string;
		/** Each resolves to true when done; on false the input keeps its text. */
		onadd: (tagId: string) => Promise<boolean> | boolean;
		onremove: (tagId: string) => Promise<boolean> | boolean;
		oncreate: (name: string) => Promise<boolean> | boolean;
	} = $props();

	type Option = { kind: 'tag'; tag: TagRef } | { kind: 'create'; name: string };

	const uid = $props.id();
	const listboxId = `${uid}-listbox`;
	const optionId = (index: number) => `${uid}-option-${index}`;

	let input = $state<HTMLInputElement>();
	let list = $state<HTMLElement>();
	let expanded = $state(false);
	let activeIndex = $state(-1);
	/** An action of this picker is running. */
	let working = $state(false);

	const locked = $derived(busy || working);
	const chosenIds = $derived(selected.map((tag) => tag.id));
	const options = $derived.by((): Option[] => {
		const suggestions: Option[] = tagSuggestions(tags, chosenIds, text).map((tag) => ({
			kind: 'tag',
			tag
		}));
		const name = normalizeTagName(text);
		const creatable = tagNameProblem(text) === null && findTagByName(tags, name) === null;
		return creatable ? [...suggestions, { kind: 'create', name }] : suggestions;
	});
	const showList = $derived(expanded && options.length > 0);
	const activeId = $derived(showList && activeIndex >= 0 ? optionId(activeIndex) : undefined);
	const described = $derived(
		[describedBy, error ? errorId : undefined].filter((part) => part !== undefined).join(' ') ||
			undefined
	);

	function open(index: number) {
		expanded = true;
		activeIndex = options.length === 0 ? -1 : Math.min(Math.max(index, 0), options.length - 1);
	}

	function close() {
		expanded = false;
		activeIndex = -1;
	}

	function optionLabel(option: Option): string {
		return option.kind === 'tag' ? option.tag.name : `„${option.name}“ als neuen Tag anlegen`;
	}

	async function run(action: () => Promise<boolean> | boolean): Promise<boolean> {
		if (locked) return false;
		working = true;
		try {
			return await action();
		} finally {
			working = false;
		}
	}

	async function choose(option: Option) {
		const done = await run(() =>
			option.kind === 'tag' ? onadd(option.tag.id) : oncreate(option.name)
		);
		if (!done) return;
		text = '';
		close();
		input?.focus();
	}

	async function remove(tag: TagRef) {
		await run(() => onremove(tag.id));
		input?.focus();
	}

	function oninput() {
		// With text the first suggestion is active, so Enter takes it (list autocomplete).
		if (normalizeTagName(text) === '') close();
		else open(0);
	}

	function onkeydown(event: KeyboardEvent) {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				if (!showList) open(0);
				else activeIndex = (activeIndex + 1) % options.length;
				break;
			case 'ArrowUp':
				event.preventDefault();
				if (!showList) open(options.length - 1);
				else activeIndex = (activeIndex - 1 + options.length) % options.length;
				break;
			case 'Enter': {
				// Ctrl+Enter belongs to the form around (e.g. "Anlegen").
				if (event.ctrlKey || event.metaKey) return;
				event.preventDefault();
				const option = showList ? options[activeIndex] : undefined;
				if (option !== undefined) void choose(option);
				break;
			}
			case 'Escape':
				if (showList) {
					event.preventDefault();
					close();
				} else if (text !== '') {
					event.preventDefault();
					text = '';
				}
				break;
		}
	}

	function onblur() {
		close();
	}

	/** Highest list in CSS pixels, as before in the flow of the panel (12rem). */
	const LIST_MAX_HEIGHT = 192;

	function position() {
		if (!list || !input) return;
		const anchor = input.getBoundingClientRect();
		const at = place(
			anchor,
			{ width: anchor.width, height: Math.min(list.scrollHeight, LIST_MAX_HEIGHT) },
			{ width: window.innerWidth, height: window.innerHeight },
			'bottom-start'
		);
		list.style.top = `${at.top}px`;
		list.style.left = `${at.left}px`;
		list.style.width = `${anchor.width}px`;
		list.style.maxHeight = `${Math.min(at.maxHeight, LIST_MAX_HEIGHT)}px`;
	}

	// Shows the list in the top layer while there is something to show, and keeps it below the
	// input while the page or the panel scrolls.
	$effect(() => {
		const element = list;
		if (!element || !showList || typeof element.showPopover !== 'function') return;
		element.showPopover();
		position();
		const update = () => position();
		window.addEventListener('resize', update, { passive: true });
		window.addEventListener('scroll', update, { passive: true, capture: true });
		return () => {
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, { capture: true });
			if (element.matches(':popover-open')) element.hidePopover();
		};
	});

	// The suggestions change the height of the list; it stays below (or above) the input.
	$effect(() => {
		void options;
		if (showList) position();
	});
</script>

<div class="tag-picker">
	{#if selected.length > 0}
		<ul class="chips" aria-label="Gewählte Tags">
			{#each selected as tag (tag.id)}
				<li class="chip">
					<span>{tag.name}</span>
					<button
						class="remove"
						type="button"
						aria-label={`Tag ${tag.name} entfernen`}
						aria-disabled={locked ? 'true' : undefined}
						onclick={() => remove(tag)}
					>
						<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
							<path
								d="M4 4l8 8M12 4l-8 8"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
							/>
						</svg>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="combo">
		<input
			{id}
			bind:this={input}
			bind:value={text}
			type="text"
			role="combobox"
			autocomplete="off"
			placeholder="Tag hinzufügen"
			maxlength={TAG_NAME_MAX_LENGTH}
			aria-autocomplete="list"
			aria-expanded={showList}
			aria-controls={listboxId}
			aria-activedescendant={activeId}
			aria-busy={locked ? 'true' : undefined}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={described}
			{oninput}
			{onkeydown}
			{onblur}
			onclick={() => {
				if (!showList) open(normalizeTagName(text) === '' ? -1 : 0);
			}}
		/>
		<ul
			class="listbox"
			id={listboxId}
			role="listbox"
			aria-label="Vorschläge"
			popover="manual"
			hidden={!showList}
			data-overlay
			bind:this={list}
		>
			{#each options as option, index (option.kind === 'tag' ? option.tag.id : 'create')}
				<!-- Options are never focused: the keyboard works on the input (aria-activedescendant),
				     the click is for the mouse. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={optionId(index)}
					class="option"
					class:create={option.kind === 'create'}
					class:active={index === activeIndex}
					role="option"
					aria-selected={index === activeIndex}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => choose(option)}
				>
					{optionLabel(option)}
				</li>
			{/each}
		</ul>
	</div>
</div>

<style>
	.tag-picker {
		display: grid;
		gap: 0.375rem;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		list-style: none;
	}

	.chip {
		display: inline-flex;
		gap: 0.125rem;
		align-items: center;
		padding: 0 0.125rem 0 0.375rem;
		font-size: 0.75rem;
		line-height: 1.25rem;
		color: var(--color-text);
		border: 1px solid var(--color-line);
		border-radius: 0.25rem;
	}

	.remove {
		display: inline-flex;
		padding: 0.25rem;
		color: var(--color-text-muted);
		background: none;
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.remove:hover {
		color: var(--color-text);
	}

	.remove[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.6;
	}

	input {
		width: 100%;
		padding: 0.25rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
	}

	input[aria-busy='true'] {
		cursor: progress;
	}

	/* In the top layer, placed by position(); the surface of the popovers. */
	.listbox {
		position: fixed;
		inset: auto;
		margin: 0;
		max-height: 12rem;
		overflow-y: auto;
		padding: 0.25rem 0;
		list-style: none;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.listbox:popover-open {
		animation: list-in var(--motion-fast) var(--motion-ease);
	}

	@keyframes list-in {
		from {
			opacity: 0;
		}
	}

	.option {
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	/* Active option: colour plus a bar at its start (a second, non-colour mark). */
	.option.active {
		background: var(--color-brand-soft-bg);
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	.option.create {
		color: var(--color-brand-text);
	}
</style>
