<script lang="ts">
	import { cardSummary, type FilterCard } from '$lib/domain/filter-cards';

	// Summary above the list (FI-1, ADR-0013 addendum C): which cards the shown tickets come from,
	// e.g. "12 Tickets aus: In Arbeit, Heute fällig, Dringend", and whether filters of the filter bar
	// narrow them further. "Zurücksetzen" goes back to "Alle offenen" without filters and search; the
	// table decides where the focus goes then. No live region: the table announces the number already.
	let {
		cards,
		count,
		more = false,
		filtered = false,
		onreset
	}: {
		cards: readonly FilterCard[];
		/** Shown tickets, as the number next to "Aufgaben". */
		count: number;
		/** More tickets match than `count` (further pages of done tickets). */
		more?: boolean;
		/** A filter of the filter bar or the search narrows the cards as well. */
		filtered?: boolean;
		onreset: () => void;
	} = $props();
</script>

<div class="filter-summary">
	<p class="text">{cardSummary(cards, { count, more, filtered })}</p>
	<button class="button-secondary button-small" type="button" onclick={onreset}>
		Zurücksetzen
	</button>
</div>

<style>
	.filter-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin-bottom: 1rem;
	}

	.text {
		margin: 0;
		font-size: var(--font-size-body);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
</style>
