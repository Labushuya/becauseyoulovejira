<script lang="ts">
	import type { Snippet } from 'svelte';
	import GuidanceIcon, { type GuidanceIconName } from './GuidanceIcon.svelte';

	// Empty state (ADR-0026 section 2, ADS pattern "empty state"): icon, heading in sentence case
	// without a full stop, one sentence of description and the actions. At most one primary action
	// (snippet `primary`), further ones as `secondary`. Sizes: "wide" (29rem) and "narrow" (19rem),
	// centred; "compact" left-aligned without icon for panels. Not an overlay.
	let {
		title,
		description,
		size = 'wide',
		icon,
		headingLevel = 3,
		primary,
		secondary
	}: {
		title: string;
		description?: string;
		size?: 'wide' | 'narrow' | 'compact';
		/** Line icon above the heading; never shown in the compact size. */
		icon?: GuidanceIconName;
		headingLevel?: 2 | 3 | 4;
		/** The one primary action (a button or link with .button-primary). */
		primary?: Snippet;
		/** Further actions, e.g. a link or .button-subtle. */
		secondary?: Snippet;
	} = $props();
</script>

<div class="empty-state {size}">
	{#if icon && size !== 'compact'}
		<span class="icon"><GuidanceIcon name={icon} size={48} /></span>
	{/if}
	<svelte:element this={`h${headingLevel}`} class="title">{title}</svelte:element>
	{#if description}
		<p class="description">{description}</p>
	{/if}
	{#if primary || secondary}
		<div class="actions">
			{@render primary?.()}
			{@render secondary?.()}
		</div>
	{/if}
</div>

<style>
	.empty-state {
		display: grid;
		gap: 0.5rem;
		justify-items: center;
		margin-inline: auto;
		padding: 2rem 1rem;
		text-align: center;
	}

	.wide {
		max-width: 29rem;
	}

	.narrow {
		max-width: 19rem;
	}

	.compact {
		justify-items: start;
		margin-inline: 0;
		padding: 0.25rem 0;
		text-align: left;
	}

	.icon {
		display: inline-flex;
		margin-bottom: 0.25rem;
		color: var(--color-text-muted);
	}

	.title {
		font-size: 1rem;
		font-weight: 600;
	}

	.compact .title {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.description {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	.compact .description {
		font-size: 0.8125rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
		justify-content: center;
		margin-top: 0.5rem;
	}

	.compact .actions {
		justify-content: flex-start;
		margin-top: 0.25rem;
	}
</style>
