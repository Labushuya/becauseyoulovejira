<script lang="ts">
	import { untrack } from 'svelte';
	import TicketActions from '$lib/components/TicketActions.svelte';
	import { setDayPlanEntryStore, type DayPlanEntryStore } from '$lib/stores/day-plan.svelte';

	// Test harness (ADR-0065): the menu "•••" of a ticket inside the (app) layout, which gives the
	// store of "Zum Tagesplan" through the context.
	let {
		store,
		props
	}: {
		store: DayPlanEntryStore;
		/** The props of TicketActions. */
		props: Record<string, unknown>;
	} = $props();

	setDayPlanEntryStore(untrack(() => store));
	const Actions = TicketActions as unknown as import('svelte').Component<Record<string, unknown>>;
</script>

<Actions {...props} />
