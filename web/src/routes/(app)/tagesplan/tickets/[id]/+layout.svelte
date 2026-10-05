<script lang="ts">
	import TicketRouteLayout from '$lib/components/TicketRouteLayout.svelte';

	// Panel of a ticket next to the day plan (/tagesplan/tickets/<id>) and its full view below it
	// (ADR-0054, ADR-0065): the same parts as next to "Aufgaben"; the host of the day plan layout names
	// the addresses and the way back, to the plan of the same day.
	let { children } = $props();
</script>

<TicketRouteLayout>
	{@render children()}
</TicketRouteLayout>
