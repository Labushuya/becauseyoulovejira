<script lang="ts">
	import Popover from '$lib/components/overlay/Popover.svelte';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import { checkLink } from '$lib/domain/link';
	import { ariaKeyShortcuts, keysText, shortcutById } from '$lib/domain/shortcuts';
	import type { LinkState } from '$lib/editor/create-editor';

	// Link of the editor (plan editor section 3.2, RT-4): a Popover of kind "panel" at the button
	// "Link" of the toolbar, no dialog, so it works in the full view too (ADR-0025 section 3).
	// Ctrl+K and "Link" in the "/" menu open it by code. "Adresse" takes http, https and mailto
	// (domain/link.ts; "www…" becomes https, an e-mail address mailto), errors stand at the field.
	// "Text" replaces the linked words. "Link entfernen" appears on an existing link. Closing (also
	// with Escape) puts the focus back into the text.
	let {
		current,
		onapply,
		onremove,
		textTarget
	}: {
		/** The link at the selection when the popover opens. */
		current: () => LinkState;
		onapply: (href: string, text: string) => void;
		onremove: () => void;
		/** The editable element the focus returns to. */
		textTarget: () => HTMLElement | null;
	} = $props();

	const uid = $props.id();
	const hrefId = `${uid}-href`;
	const textId = `${uid}-text`;
	const errorId = `${uid}-error`;
	const shortcut = shortcutById('editor-link');

	let popover = $state<ReturnType<typeof Popover>>();
	let href = $state('');
	let text = $state('');
	let existing = $state(false);
	let error = $state<string | null>(null);

	/** Opens the popover (Ctrl+K, "/" menu). */
	export function open(): void {
		popover?.open();
	}

	function fill() {
		const link = current();
		href = link.href ?? '';
		text = link.text;
		existing = link.href !== null;
		error = null;
	}

	function submit(event: SubmitEvent, close: () => void) {
		event.preventDefault();
		const result = checkLink(href);
		if ('error' in result) {
			error = result.error;
			return;
		}
		close();
		onapply(result.href, text);
	}

	function remove(close: () => void) {
		close();
		onremove();
	}
</script>

<Popover
	bind:this={popover}
	kind="panel"
	label={existing ? 'Link bearbeiten' : 'Link einfügen'}
	buttonClass="button-icon tool"
	buttonLabel="Link"
	buttonTitle={`Link (${keysText(shortcut)})`}
	buttonKeyshortcuts={ariaKeyShortcuts(shortcut)}
	onopen={fill}
	returnFocus={textTarget}
	initialFocus={(element) => element.querySelector<HTMLElement>(`#${hrefId}`)}
>
	{#snippet button()}
		<svg
			class="icon"
			viewBox="0 0 16 16"
			width="16"
			height="16"
			aria-hidden="true"
			focusable="false"
		>
			<path
				d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2-2a2.75 2.75 0 0 0-3.9-3.9l-.6.6M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2 2a2.75 2.75 0 0 0 3.9 3.9l.6-.6"
			/>
		</svg>
	{/snippet}
	{#snippet children({ close })}
		<form class="link-form" novalidate onsubmit={(event) => submit(event, close)}>
			<!-- The same words name the popover (aria-label). -->
			<p class="title" aria-hidden="true">{existing ? 'Link bearbeiten' : 'Link einfügen'}</p>
			<label for={hrefId}>Adresse</label>
			<input
				id={hrefId}
				type="text"
				inputmode="url"
				autocomplete="off"
				spellcheck="false"
				placeholder="https://…"
				bind:value={href}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? errorId : undefined}
				oninput={() => (error = null)}
			/>
			{#if error}
				<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
			{/if}
			<label for={textId}>Text</label>
			<input id={textId} type="text" autocomplete="off" bind:value={text} />
			<div class="buttons">
				{#if existing}
					<button
						class="button-icon remove"
						type="button"
						aria-label="Link entfernen"
						title="Link entfernen"
						onclick={() => remove(close)}
					>
						<svg
							class="icon"
							viewBox="0 0 16 16"
							width="16"
							height="16"
							aria-hidden="true"
							focusable="false"
						>
							<path d="M4 4l8 8M12 4l-8 8" />
						</svg>
					</button>
				{/if}
				<button class="button-primary" type="submit">Übernehmen</button>
			</div>
		</form>
	{/snippet}
</Popover>

<style>
	.link-form {
		display: grid;
		gap: 0.375rem;
		width: 18rem;
		max-width: calc(100vw - 2rem);
		padding: 0.375rem;
	}

	.title {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	input {
		width: 100%;
		padding: 0.25rem 0.5rem;
		font: inherit;
		font-size: var(--font-size-body);
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	.buttons {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: flex-end;
		margin-top: 0.25rem;
	}

	.remove {
		margin-right: auto;
	}

	.icon {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
