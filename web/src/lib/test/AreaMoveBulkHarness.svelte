<script lang="ts">
	import AreaMoveDialog from '$lib/components/AreaMoveDialog.svelte';
	import TicketTable from '$lib/components/TicketTable.svelte';
	import { setAreaMoveStore, type AreaMoveStore } from '$lib/stores/area-move.svelte';
	import { setAreaStore, type AreaStore } from '$lib/stores/area.svelte';
	import type { BulkEditStore } from '$lib/stores/bulk-edit.svelte';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { setHouseholdStore, type HouseholdStore } from '$lib/stores/household.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';

	// Tests: the table "Aufgaben" with the bar of the bulk actions and the dialog of a move, with the
	// stores of the (app) layout in the context (E7-4b, ADR-0061 §8).
	let {
		area,
		household,
		moves,
		store,
		catalog,
		bulk
	}: {
		area: AreaStore;
		household: HouseholdStore;
		moves: AreaMoveStore;
		store: TicketListStore;
		catalog: CatalogStore;
		bulk: BulkEditStore;
	} = $props();
	// svelte-ignore state_referenced_locally
	setAreaStore(area);
	// svelte-ignore state_referenced_locally
	setHouseholdStore(household);
	// svelte-ignore state_referenced_locally
	setAreaMoveStore(moves);
</script>

<TicketTable {store} {catalog} {bulk} />
{#if moves.request !== null}
	<AreaMoveDialog store={moves} />
{/if}
