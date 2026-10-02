<script lang="ts">
	import TicketRouteLayout from '$lib/components/TicketRouteLayout.svelte';

	// Panel of a ticket in the inbox (/eingang/tickets/<id>) and its full view below it (ADR-0054):
	// the same parts as next to "Aufgaben"; the host of the inbox layout names the addresses and the
	// way back, to the entry the ticket replaced (`von`) or to the inbox. The fixed segment "tickets"
	// wins over /eingang/[id].
	let { children } = $props();
</script>

<TicketRouteLayout>
	{@render children()}
</TicketRouteLayout>
