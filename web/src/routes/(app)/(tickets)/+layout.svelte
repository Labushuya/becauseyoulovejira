<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import TicketTable from '$lib/components/TicketTable.svelte';
	import { parseListQuery } from '$lib/domain/list-query';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';

	// Filter bar, table and panel area (E2 plan, T-4; E3 plan, T-3 and packages 5 and 10): the
	// table stays in place while the detail panel opens and closes, so scroll position and loaded
	// pages survive. The filter bar spans the width above table and panel (ADR-0010 section 1).
	let { children } = $props();

	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const query = $derived(parseListQuery(page.url.searchParams));
	const activeId = $derived(page.params.id ?? null);
	const withPanel = $derived(page.route.id !== '/(app)/(tickets)');
	const creating = $derived(page.route.id === '/(app)/(tickets)/tickets/neu');

	// Loads the list and follows the list state in the URL (reload, back and forward included).
	// untrack: only the URL triggers it, not the store state that activate() reads.
	$effect(() => {
		const current = query;
		untrack(() => tickets.activate(current));
	});
</script>

<FilterBar {catalog} />
<div class="tickets" class:with-panel={withPanel}>
	<TicketTable store={tickets} {catalog} {activeId} {creating} />
	{@render children()}
</div>

<style>
	.tickets {
		display: grid;
		gap: 1.5rem;
		align-items: start;
	}

	@media (min-width: 48rem) {
		.with-panel {
			grid-template-columns: minmax(0, 1fr) 32rem;
		}
	}
</style>
