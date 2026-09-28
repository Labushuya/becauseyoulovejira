<script lang="ts">
	import TicketsSettings from '../../routes/(app)/einstellungen/tickets/+page.svelte';
	import { setTrashStore, type TrashStore } from '$lib/stores/trash.svelte';

	// Test harness (tickets-page.test.ts, ADR-0037 §8): the page "Einstellungen → Tickets" below the
	// store of the trash, as the (app) layout provides it.
	let { store }: { store: TrashStore } = $props();

	// svelte-ignore state_referenced_locally
	setTrashStore(store);
</script>

<TicketsSettings />
