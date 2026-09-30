<script lang="ts">
	import type { Snippet } from 'svelte';
	import { chipListStatus, chipListView, moreLabel } from '$lib/domain/chip-list';

	// A long list of chips (ADR-0026, addendum KL): the keywords in the details of the channel
	// cards and in the keyword editor. Up to 10 entries show whole; above that the first 8 and
	// "+ N weitere" (a disclosure button with aria-expanded on the list), unfolded "Weniger
	// anzeigen". Above 20 entries a filter field stands above the list; it compares like the ticket
	// picker (without case, accents and umlaut dots), shows every hit and says "N von M" (the status
	// region after a short pause). Escape in the field empties the filter first and is consumed.
	// `chip` renders the inside of a chip (the editor adds its remove button); `expanded` and
	// `query` can be bound, so the editor unfolds the list after adding a keyword.
	let {
		items,
		label,
		noun,
		chip,
		emptyText = null,
		expanded = $bindable(false),
		query = $bindable('')
	}: {
		items: readonly string[];
		/** Name of the list, e.g. "Stichwörter von „Gmail“". */
		label: string;
		/** The entries in the plural for the button and the filter, e.g. "Stichwörter". */
		noun: string;
		/** Inside of a chip; without it the entry as text. */
		chip?: Snippet<[string]>;
		/** Shown instead of the list without entries, e.g. "keine"; null shows nothing. */
		emptyText?: string | null;
		expanded?: boolean;
		query?: string;
	} = $props();

	/** Pause before the number of hits is said, so typing is not talked over. */
	const ANNOUNCE_DELAY_MS = 500;

	const uid = $props.id();
	const listId = `${uid}-list`;
	const countId = `${uid}-count`;

	const view = $derived(chipListView(items, { expanded, query }));
	const status = $derived(chipListStatus(view, items.length));
	let announced = $state('');

	$effect(() => {
		const text = status;
		const timer = setTimeout(() => (announced = text), ANNOUNCE_DELAY_MS);
		return () => clearTimeout(timer);
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || query === '') return;
		event.preventDefault();
		event.stopPropagation();
		query = '';
	}
</script>

{#if items.length === 0}
	{#if emptyText !== null}
		<p class="no-entries">{emptyText}</p>
	{/if}
{:else}
	<div class="chip-list">
		{#if view.filterable}
			<div class="filter">
				<span class="search-field">
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<circle cx="7" cy="7" r="4.25" />
						<path d="M10.25 10.25L13.5 13.5" />
					</svg>
					<input
						type="search"
						autocomplete="off"
						spellcheck="false"
						aria-label={`${noun} filtern`}
						aria-controls={listId}
						aria-describedby={status === '' ? undefined : countId}
						placeholder="Filtern"
						bind:value={query}
						{onkeydown}
					/>
				</span>
				{#if status !== ''}
					<span class="count" id={countId}>{status}</span>
				{/if}
			</div>
			<p class="visually-hidden" role="status">{announced}</p>
		{/if}
		<ul class="chips" id={listId} aria-label={label}>
			{#each view.shown as item (item)}
				<li>
					{#if chip}
						{@render chip(item)}
					{:else}
						{item}
					{/if}
				</li>
			{/each}
		</ul>
		{#if view.foldable}
			<button
				class="button-subtle more"
				type="button"
				aria-expanded={expanded}
				aria-controls={listId}
				onclick={() => (expanded = !expanded)}
			>
				{#if expanded}
					Weniger anzeigen<span class="visually-hidden">: {label}</span>
				{:else}
					{moreLabel(view.hidden)} <span class="visually-hidden">{noun} anzeigen: {label}</span>
				{/if}
			</button>
		{/if}
	</div>
{/if}

<style>
	.chip-list {
		display: grid;
		gap: 0.375rem;
		justify-items: start;
		min-width: 0;
	}

	.filter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		max-width: 100%;
	}

	.search-field {
		width: min(16rem, 100%);
	}

	.search-field input {
		width: 100%;
	}

	.count,
	.no-entries {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* Like the chips of the keyword editor: the accent surface, a pill. */
	.chips li {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		min-width: 0;
		padding: 0.125rem 0.5rem;
		font-size: var(--font-size-control);
		overflow-wrap: anywhere;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: var(--radius-pill);
	}

	.more {
		font-size: var(--font-size-small);
	}
</style>
