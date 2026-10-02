<script lang="ts">
	import CalendarLayout from '../../routes/(app)/kalender/+layout.svelte';
	import {
		setTicketRowActions,
		type TicketRowActionsStore
	} from '$lib/stores/ticket-row-actions.svelte';

	// Test harness of /kalender and /kalender/tickets/<id> (kalender-layout.test.ts, ADR-0053): the
	// layout with the calendar and, as its child page, a stand-in for the panel of a ticket, as
	// SvelteKit renders it. With `rowActions` every ticket of the calendar gets the menu "•••", as
	// below the (app) layout.
	let {
		panel = false,
		rowActions = null
	}: {
		panel?: boolean;
		rowActions?: TicketRowActionsStore | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	if (rowActions !== null) setTicketRowActions(rowActions);
</script>

<CalendarLayout>
	{#if panel}
		<aside aria-label="Panel des Tickets">Panel</aside>
	{/if}
</CalendarLayout>
