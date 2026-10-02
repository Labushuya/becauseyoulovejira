<script lang="ts">
	import TicketRouteLayout from '$lib/components/TicketRouteLayout.svelte';

	// Panel of a ticket in the projects (/projekte/tickets/<id>) and its full view below it
	// (ADR-0054): the same parts as next to "Aufgaben"; the host of the projects layout names the
	// addresses and the way back, to the project panel the ticket replaced (`von`) or to the view.
	// The fixed segment "tickets" wins over /projekte/[id].
	let { children } = $props();
</script>

<TicketRouteLayout>
	{@render children()}
</TicketRouteLayout>
