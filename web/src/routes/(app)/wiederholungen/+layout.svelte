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

	// Overview "Wiederholungen" (E5 plan, T-6 and package 5): the table of the rules on the left, the
	// rule panel (/wiederholungen/neu, /wiederholungen/<id>) on the right, like projects, tickets and
	// inbox (ViewWithPanel). The rules come from the store of the app layout (T-7), which follows
	// them live; the open tickets of the list store give the column "Offenes Ticket".
	let { children } = $props();

	const store = getRecurrenceStore();
	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const flags = getFlagStore();

	const activeId = $derived(page.params.id ?? null);
	const withPanel = $derived(page.route.id !== '/(app)/wiederholungen');
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
