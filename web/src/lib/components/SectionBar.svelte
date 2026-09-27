<script lang="ts">
	import type { Snippet } from 'svelte';

	// Section bar above a view (E3 plan, T-3 and package 5): on the left the heading with the
	// number of shown entries, on the right the controls of the view. Later packages add their
	// controls through the snippets (view switch, grouping).
	let {
		title,
		headingId,
		count = null,
		countLabel = '',
		heading = $bindable(),
		start,
		end
	}: {
		title: string;
		headingId: string;
		/** Number next to the heading ("12", "50+"); null shows none (e.g. while loading). */
		count?: number | string | null;
		/** Full text of the number for screen readers, e.g. "12 Tickets". */
		countLabel?: string;
		/** The heading element; views move the focus to it (tabindex -1). */
		heading?: HTMLElement;
		/** Controls right after the heading. */
		start?: Snippet;
		/** Controls on the right. */
		end?: Snippet;
	} = $props();
</script>

<div class="section-bar">
	<div class="start">
		<h2 id={headingId} tabindex="-1" data-view-heading bind:this={heading}>{title}</h2>
		{#if count !== null}
			<span class="count">
				<span aria-hidden="true">{count}</span>
				<span class="visually-hidden">{countLabel}</span>
			</span>
		{/if}
		{@render start?.()}
	</div>
	{#if end}
		<div class="end">{@render end()}</div>
	{/if}
</div>

<style>
	.section-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.start,
	.end {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	h2 {
		font-size: 1.125rem;
		font-weight: 600;
	}

	.count {
		min-width: 1.5rem;
		padding: 0 0.375rem;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.25rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}
</style>
