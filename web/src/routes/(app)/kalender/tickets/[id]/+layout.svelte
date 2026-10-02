<script lang="ts">
	import TicketRouteLayout from '$lib/components/TicketRouteLayout.svelte';

	// Panel of a ticket next to the calendar (/kalender/tickets/<id>) and its full view below it
	// (ADR-0053 §6): the same parts as next to "Aufgaben"; the host of the calendar layout names
	// the addresses and the way back.
	let { children } = $props();
</script>

<TicketRouteLayout>
	{@render children()}
</TicketRouteLayout>
