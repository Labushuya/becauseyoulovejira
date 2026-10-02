<script lang="ts">
	import TicketFullViewRoute from '$lib/components/TicketFullViewRoute.svelte';

	// Full view of a ticket over the rules (/wiederholungen/tickets/<id>/voll, ADR-0054); closing it
	// returns to the rule panel it came from, else to the overview.
</script>

<TicketFullViewRoute />
