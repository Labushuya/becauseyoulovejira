<script lang="ts">
	import TrashNotice from '$lib/components/TrashNotice.svelte';
	import ViewSwitch from '$lib/components/ViewSwitch.svelte';
	import { setTrashStore, type TrashStore } from '$lib/stores/trash.svelte';

	// Test harness (trash-view.test.ts, ADR-0037): the store of the trash as the (app) layout
	// provides it, below it the switch with the number of the trash and the hint for a ticket in it.
	let { store, ticketId = null }: { store: TrashStore; ticketId?: string | null } = $props();

	// svelte-ignore state_referenced_locally
	setTrashStore(store);
</script>

<ViewSwitch current="tasks" />
<TrashNotice id={ticketId} />
