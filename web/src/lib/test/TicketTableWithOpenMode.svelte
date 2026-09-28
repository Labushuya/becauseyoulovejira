<script lang="ts">
	import TicketTable from '$lib/components/TicketTable.svelte';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { setTicketOpenMode, type TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';

	// Test harness (ticket-table.test.ts, plan BI-1): the ticket table below the store that
	// remembers panel or full view, as the (app) layout provides it.
	let {
		openMode,
		store,
		catalog
	}: {
		openMode: TicketOpenModeStore;
		store: TicketListStore;
		catalog: CatalogStore;
	} = $props();

	// svelte-ignore state_referenced_locally
	setTicketOpenMode(openMode);
</script>

<TicketTable {store} {catalog} />
