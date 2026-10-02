<script lang="ts">
	import TicketFullViewRoute from '$lib/components/TicketFullViewRoute.svelte';

	// Full view of a ticket over the list (/tickets/<id>/voll; ADR-0025 section 7). The parts live
	// in TicketFullViewRoute, which the calendar shares (ADR-0053 §6).
</script>

<TicketFullViewRoute />
