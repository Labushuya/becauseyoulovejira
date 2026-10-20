<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';

	// Section bar above a view (E3 plan, T-3 and package 5): on the left the heading with the
	// number of shown entries, on the right the controls of the view. Later packages add their
	// controls through the snippets (view switch, grouping). In the phone frame (MO-1a, ADR-0073)
	// the top bar shows the name of the view; the heading stays for screen readers and as the target
	// of the focus, but only once on the screen. Since MO-3 (ADR-0073 addendum MO-3) the bar decides
	// in one place what it shows in the frame: a view with `phone` controls (the search and "Filter"
	// of "Aufgaben") shows only them in one row, the number for screen readers only; a view without
	// controls of its own and without a number (the day plan) keeps only its hidden heading and takes
	// no room; every other view shows its bar as before until its package.
	let {
		title,
		headingId,
		count = null,
		countLabel = '',
		heading = $bindable(),
		start,
		end,
		phone
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
		/** Controls in the phone frame instead of `start` and `end`, in one row (MO-3). */
		phone?: Snippet;
	} = $props();

	const mobileLayout = getMobileLayoutStore();
	const framed = $derived(mobileLayout.active);
	/** The row of the controls of the frame. */
	const tools = $derived(framed && phone !== undefined);
	/** Nothing to show in the frame: only the hidden heading, which takes no room. */
	const bare = $derived(framed && phone === undefined && end === undefined && count === null);
</script>

<div class="section-bar" class:tools class:bare>
	<div class="start">
		<h2
			id={headingId}
			tabindex="-1"
			data-view-heading
			class:visually-hidden={framed}
			bind:this={heading}
		>
			{title}
		</h2>
		{#if count !== null}
			<span class="count" class:visually-hidden={tools}>
				<span aria-hidden="true">{count}</span>
				<span class="visually-hidden">{countLabel}</span>
			</span>
		{/if}
		{@render start?.()}
	</div>
	{#if tools}
		<div class="phone-tools">{@render phone?.()}</div>
	{:else if end}
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
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	.count {
		min-width: 1.5rem;
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		line-height: 1.25rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	/*
	 * Phone frame (MO-3, ADR-0073 addendum MO-3). With controls of the frame: one row over the full
	 * width, the hidden heading and number out of the flow (`display: contents` leaves only their
	 * hidden boxes). Without anything to show: the bar takes no room, the view starts right below the
	 * top bar (the day plan, MO-2).
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .section-bar.tools {
			flex-wrap: nowrap;
			gap: 0.5rem;
		}

		:global(:root[data-mobile-layout='on']) .section-bar.tools > .start {
			display: contents;
		}

		:global(:root[data-mobile-layout='on']) .phone-tools {
			display: flex;
			flex: 1 1 auto;
			gap: 0.5rem;
			align-items: center;
			min-width: 0;
		}

		:global(:root[data-mobile-layout='on']) .section-bar.bare {
			position: absolute;
		}
	}
</style>
