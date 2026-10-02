<script lang="ts">
	import { flushSync, type Snippet } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { entryCountText, fullDateLabel, moreLabel } from '$lib/domain/calendar';
	import Popover from '../overlay/Popover.svelte';

	// "+N weitere" of a full day (ADR-0053 §3): a popover of the kind "panel" with every entry of the
	// day as a list, named by the full date. Its list renders only once it was opened, so a month
	// with many full days carries no hidden lists; it renders before the popover is placed, so the
	// popover knows its size. In the cell the button is no stop of Tab (the arrow keys of the grid
	// reach it); in the popover the entries are, and each ticket shows its menu "•••" (in a popover
	// the browser keeps its own context menu, lib/overlay/context-menu.ts).
	let {
		date,
		more,
		total,
		entries
	}: {
		date: CalendarDate;
		/** Entries the cell does not show. */
		more: number;
		/** All entries of the day. */
		total: number;
		/** The list of all entries; rendered once the popover opened. */
		entries: Snippet;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;
	let opened = $state(false);
</script>

<Popover
	kind="panel"
	labelledby={headingId}
	buttonClass="calendar-more"
	buttonTabindex={-1}
	onopen={() => flushSync(() => (opened = true))}
>
	{#snippet button()}
		{moreLabel(more)}<span class="visually-hidden">: {fullDateLabel(date)}</span>
	{/snippet}
	<div class="day">
		<h4 id={headingId} class="heading">{fullDateLabel(date)}</h4>
		<p class="count">{entryCountText(total)}</p>
		{#if opened}
			<ul class="entries">
				{@render entries()}
			</ul>
		{/if}
	</div>
</Popover>

<style>
	.day {
		display: grid;
		gap: 0.375rem;
		width: min(22rem, calc(100vw - 2rem));
		padding: 0.25rem;
	}

	.heading {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.count {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.entries {
		display: grid;
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* The button of the popover lives in Popover.svelte; its class comes from here. */
	:global(.calendar-more) {
		align-self: flex-start;
		padding: 0 0.25rem;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		background: none;
		border: none;
		border-radius: var(--radius-item);
		cursor: pointer;
	}

	:global(.calendar-more:hover) {
		color: var(--color-text);
		background: var(--fill-control-hover);
	}
</style>
