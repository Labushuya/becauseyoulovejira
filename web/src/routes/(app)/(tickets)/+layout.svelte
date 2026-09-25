<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import KpiTiles from '$lib/components/KpiTiles.svelte';
	import TicketTable from '$lib/components/TicketTable.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import { parseListQuery } from '$lib/domain/list-query';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';

	// KPI tiles, filter bar, table and panel area (E2 plan, T-4; E3 plan, T-3 and packages 5, 10
	// and 12): the table stays in place while the detail panel opens and closes, so scroll position
	// and loaded pages survive. Tiles, filter bar and table form the view left of the panel, which
	// stands as a full column on the right from 64rem (ADR-0025 section 6, package UI-6b).
	let { children } = $props();

	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const rules = getRecurrenceStore();
	const query = $derived(parseListQuery(page.url.searchParams));
	const activeId = $derived(page.params.id ?? null);
	const withPanel = $derived(page.route.id !== '/(app)/(tickets)');
	const creating = $derived(page.route.id === '/(app)/(tickets)/tickets/neu');

	// Loads the list and follows the list state in the URL (reload, back and forward included).
	// untrack: only the URL triggers it, not the store state that activate() reads.
	$effect(() => {
		const current = query;
		untrack(() => tickets.activate(current));
	});
</script>

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<KpiTiles kpis={tickets.openState === 'ready' ? tickets.kpis : null} />
		<FilterBar
			{catalog}
			searchBusy={tickets.searchBusy}
			searchError={tickets.searchError}
			onretrysearch={() => tickets.retrySearch()}
		/>
		<TicketTable
			store={tickets}
			{catalog}
			{activeId}
			{creating}
			inboxCount={inbox.newCount}
			recurrenceTextOf={(ticket) => rules.textOf(ticket.recurrenceId)}
		/>
	{/snippet}
	{@render children()}
</ViewWithPanel>
