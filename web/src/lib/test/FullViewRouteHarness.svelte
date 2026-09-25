<script lang="ts">
	import TicketLayout from '../../routes/(app)/(tickets)/tickets/[id]/+layout.svelte';
	import FullViewPage from '../../routes/(app)/(tickets)/tickets/[id]/voll/+page.svelte';

	// Test harness of /tickets/<id>/voll (ticket-panel.test.ts, UI-7): the layout of the ticket
	// route with the panel and the full view as its child page, as SvelteKit renders it.
</script>

<TicketLayout>
	<FullViewPage />
</TicketLayout>
