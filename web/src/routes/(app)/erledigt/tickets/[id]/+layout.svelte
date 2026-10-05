<script lang="ts">
	import TicketRouteLayout from '$lib/components/TicketRouteLayout.svelte';

	// Panel of a ticket next to "Erledigte" (/erledigt/tickets/<id>) and its full view below it
	// (ADR-0054, ADR-0066): the same parts as next to "Aufgaben"; the host of the layout of the view
	// names the addresses and the way back, to the list with the same filters.
	let { children } = $props();
</script>

<TicketRouteLayout>
	{@render children()}
</TicketRouteLayout>
