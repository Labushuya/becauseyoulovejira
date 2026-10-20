<script lang="ts">
	import type { Snippet } from 'svelte';
	import GroupPopover from './GroupPopover.svelte';
	import Modal from './overlay/Modal.svelte';
	import SortChoice from './SortChoice.svelte';

	// The filter sheet of "Aufgaben" in the phone frame (MO-3, ADR-0073 addendum MO-3; concept MO-0
	// §3.2): the button "Filter" in the row of the view opens it, the modal of size M stands there as a
	// sheet (MO-1b). It holds what the PC shows above the table: the filter cards, the chip groups,
	// "Projekt", "Tag" and "Zuständig" (`filters`, the same parts as on the PC from the layout), then
	// "Gruppieren" and, because the cards have no column headers, "Sortieren nach", last the switches
	// of the display the menu "Spalten" of the PC holds besides its columns (`display`). Every choice
	// is a navigation as on the PC: it applies at once, the list behind follows, and the state stays
	// in the URL, back and forward included. The footer: "Zurücksetzen" (cards, filters and search,
	// keeps sort and grouping, like the bar of the PC; locked while nothing is set) and "N Tickets
	// anzeigen", which closes the sheet. The modal gives the focus back to "Filter".
	let {
		count,
		filtered,
		onreset,
		onclose,
		filters,
		display
	}: {
		/** Tickets the list shows with these filters; null while they load. */
		count: number | null;
		/** A card, a filter or the search is set. */
		filtered: boolean;
		/** "Zurücksetzen": back to "Alle offenen" without filters and search. */
		onreset: () => void;
		onclose: () => void;
		/** Filter cards and the filters of the filter bar. */
		filters?: Snippet;
		/** Switches of the display, e.g. the sub-tasks below their parent. */
		display?: Snippet;
	} = $props();

	const uid = $props.id();
	const resetHint = `${uid}-reset-hint`;
	const showLabel = $derived(
		count === null
			? 'Tickets anzeigen'
			: count === 1
				? '1 Ticket anzeigen'
				: `${count} Tickets anzeigen`
	);
</script>

<Modal open size="m" title="Filter" {onclose}>
	<div class="filter-sheet">
		{@render filters?.()}
		<GroupPopover inline />
		<SortChoice />
		{@render display?.()}
	</div>
	{#snippet footer({ close })}
		<button
			class="button-secondary"
			type="button"
			aria-disabled={filtered ? undefined : 'true'}
			aria-describedby={filtered ? undefined : resetHint}
			onclick={() => {
				if (filtered) onreset();
			}}
		>
			Zurücksetzen
		</button>
		{#if !filtered}
			<span class="visually-hidden" id={resetHint}>Kein Filter gesetzt.</span>
		{/if}
		<button class="button-primary" type="button" onclick={close}>{showLabel}</button>
	{/snippet}
</Modal>

<style>
	/* Only in the phone frame (MO-3): the parts below each other with room between them. */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .filter-sheet {
			display: grid;
			gap: 1.25rem;
		}
	}
</style>
