<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import Markdown from './Markdown.svelte';

	// Markdown as plain text with a switch "Schreiben" / "Vorschau" (ADR-0008 point 4). The
	// preview uses the same rendering as the display. Extra attributes (aria-invalid,
	// aria-describedby, onkeydown ...) go to the textarea.
	let {
		value = $bindable(''),
		label,
		maxlength,
		rows = 8,
		textarea = $bindable(),
		...rest
	}: {
		value?: string;
		label: string;
		maxlength: number;
		rows?: number;
		textarea?: HTMLTextAreaElement;
	} & Omit<HTMLTextareaAttributes, 'value' | 'maxlength' | 'rows' | 'id'> = $props();

	const uid = $props.id();
	/** The counter appears once 90 % of the limit are used. */
	const COUNTER_THRESHOLD = 0.9;

	let preview = $state(false);
	const counterVisible = $derived(value.length >= maxlength * COUNTER_THRESHOLD);
	const describedBy = $derived(
		[rest['aria-describedby'], counterVisible ? `${uid}-counter` : null]
			.filter(Boolean)
			.join(' ') || undefined
	);
	const numbers = new Intl.NumberFormat('de-DE');
</script>

<div class="editor">
	<div class="head">
		<label for={`${uid}-text`}>{label}</label>
		<div class="modes" role="group" aria-label={`${label}: Ansicht`}>
			<button type="button" aria-pressed={!preview} onclick={() => (preview = false)}
				>Schreiben</button
			>
			<button type="button" aria-pressed={preview} onclick={() => (preview = true)}>
				Vorschau
			</button>
		</div>
	</div>
	<textarea
		{...rest}
		id={`${uid}-text`}
		{rows}
		{maxlength}
		hidden={preview}
		aria-describedby={describedBy}
		bind:value
		bind:this={textarea}></textarea>
	{#if preview}
		<div class="preview" role="region" aria-label={`${label}: Vorschau`}>
			{#if value.trim() === ''}
				<p class="nothing">Nichts zu zeigen.</p>
			{:else}
				<Markdown source={value} />
			{/if}
		</div>
	{/if}
	{#if counterVisible}
		<p class="counter" id={`${uid}-counter`}>
			{numbers.format(value.length)} von {numbers.format(maxlength)} Zeichen
		</p>
	{/if}
</div>

<style>
	.editor {
		display: grid;
		gap: 0.375rem;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.modes {
		display: inline-flex;
		gap: 0.125rem;
		padding: 0.125rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.modes button {
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		background: none;
		border: none;
		border-radius: var(--radius-item);
		cursor: pointer;
	}

	.modes button[aria-pressed='true'] {
		font-weight: 500;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
	}

	textarea {
		width: 100%;
		padding: 0.5rem 0.625rem;
		font: inherit;
		font-size: 0.875rem;
		line-height: 1.5;
		color: inherit;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
		resize: vertical;
	}

	.preview {
		min-height: 6rem;
		padding: 0.5rem 0.625rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.nothing,
	.counter {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
