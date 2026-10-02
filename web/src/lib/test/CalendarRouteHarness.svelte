<script lang="ts">
	import CalendarLayout from '../../routes/(app)/kalender/+layout.svelte';
	import ItemPage from '../../routes/(app)/kalender/eingang/[id]/+page.svelte';
	import RulePage from '../../routes/(app)/kalender/wiederholungen/[id]/+page.svelte';
	import {
		setTicketRowActions,
		type TicketRowActionsStore
	} from '$lib/stores/ticket-row-actions.svelte';

	// Test harness of /kalender and its children (kalender-layout.test.ts, ADR-0053, ADR-0054 §8): the
	// layout with the calendar and, as its child page, the panel of a rule or an inbox entry next to
	// it, as SvelteKit renders them, or a stand-in for the panel of a ticket, whose route has tests of
	// its own. With `rowActions` every ticket of the calendar gets the menu "•••", as below the (app)
	// layout.
	let {
		child = null,
		rowActions = null
	}: {
		child?: 'ticket' | 'rule' | 'item' | null;
		rowActions?: TicketRowActionsStore | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	if (rowActions !== null) setTicketRowActions(rowActions);
</script>

<CalendarLayout>
	{#if child === 'ticket'}
		<aside aria-label="Panel des Tickets">Panel</aside>
	{:else if child === 'rule'}
		<RulePage />
	{:else if child === 'item'}
		<ItemPage />
	{/if}
</CalendarLayout>
