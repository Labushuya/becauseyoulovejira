<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import RecurrencesView from '$lib/components/RecurrencesView.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { RECURRENCES_HOST, setTicketHost } from '$lib/ticket-host';

	// Overview "Wiederholungen" (E5 plan, T-6 and package 5): the table of the rules on the left, the
	// rule panel (/wiederholungen/neu, /wiederholungen/<id>) on the right, like projects, tickets and
	// inbox (ViewWithPanel). The rules come from the store of the app layout (T-7), which follows
	// them live; the open tickets of the list store give the column "Offenes Ticket". Tickets open in
	// the rules (/wiederholungen/tickets/<id>, …/voll; ADR-0054): the host in the context makes every
	// ticket link below stay here; a ticket takes the panel column and replaces the rule it came
	// from, whose row stays marked (never the ID of a ticket).
	let { children } = $props();

	setTicketHost(RECURRENCES_HOST);

	const store = getRecurrenceStore();
	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const flags = getFlagStore();

	/** Rule of the panel, or the one the shown ticket came from (ADR-0054). */
	const activeId = $derived(RECURRENCES_HOST.activeIn(page));
	const withPanel = $derived(RECURRENCES_HOST.panelShown(page.route.id));
	const creating = $derived(page.route.id === '/(app)/wiederholungen/neu');

	// "Offenes Ticket" reads the open tickets, also when the app starts here.
	$effect(() => untrack(() => tickets.loadOpen()));
</script>

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<RecurrencesView
			{store}
			{tickets}
			{catalog}
			{flags}
			{activeId}
			{creating}
			inboxCount={inbox.newCount}
		/>
	{/snippet}
	{@render children()}
</ViewWithPanel>
