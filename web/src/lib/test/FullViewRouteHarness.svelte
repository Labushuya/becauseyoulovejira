<script lang="ts">
	import { setTicketOpenMode, type TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
	import TicketLayout from '../../routes/(app)/(tickets)/tickets/[id]/+layout.svelte';
	import FullViewPage from '../../routes/(app)/(tickets)/tickets/[id]/voll/+page.svelte';

	// Test harness of /tickets/<id>/voll (ticket-panel.test.ts, UI-7): the layout of the ticket
	// route with the full view as its child page, as SvelteKit renders it. With `full` false the
	// layout renders the panel alone (/tickets/<id>). `openMode` stands for the store of the (app)
	// layout that remembers panel or full view (plan BI-1).
	let {
		full = true,
		openMode
	}: {
		full?: boolean;
		openMode?: TicketOpenModeStore;
	} = $props();

	// svelte-ignore state_referenced_locally
	if (openMode !== undefined) setTicketOpenMode(openMode);
</script>

<TicketLayout>
	{#if full}
		<FullViewPage />
	{/if}
</TicketLayout>
