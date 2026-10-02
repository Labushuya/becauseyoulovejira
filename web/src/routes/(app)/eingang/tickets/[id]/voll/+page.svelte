<script lang="ts">
	import TicketFullViewRoute from '$lib/components/TicketFullViewRoute.svelte';

	// Full view of a ticket over the inbox (/eingang/tickets/<id>/voll, ADR-0054); closing it returns
	// to the entry it came from, else to the inbox.
</script>

<TicketFullViewRoute />
