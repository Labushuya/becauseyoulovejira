<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import FilterCards from '$lib/components/FilterCards.svelte';
	import FirstSteps from '$lib/components/FirstSteps.svelte';
	import TicketTable from '$lib/components/TicketTable.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import { parseListQuery } from '$lib/domain/list-query';
	import { findBulkEditStore } from '$lib/stores/bulk-edit.svelte';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { findFirstStepsStore } from '$lib/stores/first-steps.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { findTicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { findTicketRowActions } from '$lib/stores/ticket-row-actions.svelte';
	import { getTourStarter } from '$lib/tour/tour-context';

	// Filter cards, filter bar, table and panel area (E2 plan, T-4; E3 plan, T-3 and packages 5, 10
	// and 12; FI-1): the table stays in place while the detail panel opens and closes, so scroll
	// position and loaded pages survive. Section bar, cards, filter bar and table form the view left of
	// the panel, which stands as a full column on the right from 64rem (ADR-0025 section 6, package
	// UI-6b). The section bar with the switch comes first, as in the other views (package UI-8).
	let { children } = $props();

	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const rules = getRecurrenceStore();
	// Bulk actions on the chosen rows (plan BI-2); only inside the (app) layout.
	const bulk = findBulkEditStore() ?? undefined;
	// The menu "•••" of every row (plan aktionsmenues, AM-2) and its "Duplizieren …" (ADR-0045).
	const rowActions = findTicketRowActions() ?? undefined;
	const duplicates = findTicketDuplicateStore();
	// "Erste Schritte" below the empty state (plan EH-12); only inside the (app) layout.
	const firstSteps = findFirstStepsStore();
	// The tour of the (app) layout (EH-13); with it "Erste Schritte" offers "Kurze Einführung".
	const startTour = getTourStarter();
	const query = $derived(parseListQuery(page.url.searchParams));
	const activeId = $derived(page.params.id ?? null);
	// The full view replaces the panel (plan BI-1): the list keeps its full width behind the modal.
	const withPanel = $derived(
		page.route.id !== '/(app)/(tickets)' && page.route.id !== '/(app)/(tickets)/tickets/[id]/voll'
	);
	const creating = $derived(page.route.id === '/(app)/(tickets)/tickets/neu');

	// Loads the list and follows the list state in the URL (reload, back and forward included).
	// untrack: only the URL triggers it, not the store state that activate() reads.
	$effect(() => {
		const current = query;
		untrack(() => tickets.activate(current));
	});

	// The section "Erledigt" follows the sub projects of the chosen project (ADR-0034), e.g. once
	// the catalog has loaded or a sub project was added in another tab.
	const subProjectKey = $derived(
		query.project === null
			? ''
			: catalog
					.subProjectsOf(query.project)
					.map((project) => project.id)
					.join(',')
	);
	$effect(() => {
		void subProjectKey;
		untrack(() => tickets.followSubProjects());
	});
</script>

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<TicketTable
			store={tickets}
			{catalog}
			{activeId}
			{creating}
			inboxCount={inbox.newCount}
			{bulk}
			{rowActions}
			{duplicates}
			recurrenceTextOf={(ticket) => rules.textOf(ticket.recurrenceId)}
		>
			{#snippet tools()}
				<FilterCards counts={tickets.openState === 'ready' ? tickets.cardCounts : null} />
				<FilterBar
					{catalog}
					searchBusy={tickets.searchBusy}
					searchError={tickets.searchError}
					onretrysearch={() => tickets.retrySearch()}
				/>
			{/snippet}
			{#snippet emptyExtra()}
				{#if firstSteps}
					<FirstSteps store={firstSteps} onstarttour={startTour} />
				{/if}
			{/snippet}
		</TicketTable>
	{/snippet}
	{@render children()}
</ViewWithPanel>
