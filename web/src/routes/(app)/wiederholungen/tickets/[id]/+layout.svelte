<script lang="ts">
	import TicketRouteLayout from '$lib/components/TicketRouteLayout.svelte';

	// Panel of a ticket in the rules (/wiederholungen/tickets/<id>) and its full view below it
	// (ADR-0054): the same parts as next to "Aufgaben"; the host of the rules layout names the
	// addresses and the way back, to the rule panel the ticket replaced (`von`) or to the overview.
	// The fixed segment "tickets" wins over /wiederholungen/[id].
	let { children } = $props();
</script>

<TicketRouteLayout>
	{@render children()}
</TicketRouteLayout>
