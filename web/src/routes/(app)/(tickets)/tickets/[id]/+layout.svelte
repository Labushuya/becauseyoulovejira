<script lang="ts">
	import TicketRouteLayout from '$lib/components/TicketRouteLayout.svelte';

	// Detail panel of /tickets/<record id> (E2 plan, T-4) and the full view /tickets/<id>/voll below
	// it (ADR-0025 section 7), next to the list "Aufgaben". Loading, panel and the question about
	// unsaved text live in TicketRouteLayout, which the calendar shares (ADR-0053 §6).
	let { children } = $props();
</script>

<TicketRouteLayout>
	{@render children()}
</TicketRouteLayout>
