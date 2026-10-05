<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import DoneView from '$lib/components/done/DoneView.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import { parseDoneQuery } from '$lib/domain/done-view';
	import { parentOf } from '$lib/domain/subtasks';
	import { pb } from '$lib/pocketbase';
	import { findAreaStore } from '$lib/stores/area.svelte';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { DoneListStore, doneListData } from '$lib/stores/done-list.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { liveSource } from '$lib/stores/realtime';
	import { findTicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { findTicketRowActions } from '$lib/stores/ticket-row-actions.svelte';
	import { DONE_HOST, setTicketHost } from '$lib/ticket-host';
	import { followTicketReturn } from '$lib/ticket-return.svelte';

	// View "Erledigte" (ER-1, ADR-0066): the done tickets of the area of the tab with the filters of
	// the address on the left, the panel of a ticket (/erledigt/tickets/<id>) on the right like next
	// to "Aufgaben", the full view over it. The host in the context makes every ticket link below it
	// stay here (ADR-0054); closing a ticket gives the focus back to its link. The store lives with
	// this layout: it loads page by page, follows the tickets live, the filters of the address, the
	// sub projects of the catalog and the area of the tab; the groups follow the clock of the list
	// (midnight). A reopened ticket joins the open list at once. Leaving the view keeps the flags of
	// "Wieder öffnen", so "Rückgängig" still works from another view.
	let { children } = $props();

	setTicketHost(DONE_HOST);
	followTicketReturn(DONE_HOST);

	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const flags = getFlagStore();
	const area = findAreaStore();
	// The menu "•••" of every entry (plan aktionsmenues, AM-2) and its "Duplizieren …" (ADR-0045).
	const rowActions = findTicketRowActions();
	const duplicates = findTicketDuplicateStore();
	const store = new DoneListStore(doneListData(pb), auth, {
		today: () => tickets.today,
		subProjectsOf: (projectId) => catalog.subProjectsOf(projectId).map((project) => project.id),
		flags,
		open: tickets
	});

	const withPanel = $derived(page.route.id === DONE_HOST.panelRoute);
	const query = $derived(parseDoneQuery(page.url.searchParams));

	// The open tickets and every sub-task: the questions of the menu count the sub-tasks.
	$effect(() => untrack(() => tickets.loadOpen()));
	$effect(() => untrack(() => store.connect(liveSource(pb))));

	// Loads and follows the filters of the address (reload, back and forward included).
	$effect(() => {
		const current = query;
		untrack(() => store.show(current));
	});

	// The sub projects of the chosen project (ADR-0034), e.g. once the catalog has loaded or one was
	// added in another tab.
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
		untrack(() => store.followSubProjects());
	});

	// The area of the tab (ADR-0059): the done tickets of the other area replace the shown ones.
	let shownArea: string | null = null;
	$effect(() => {
		const key = area?.key ?? '';
		untrack(() => {
			if (shownArea !== null && key !== shownArea) store.rescope();
			shownArea = key;
		});
	});
</script>

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<DoneView
			{store}
			{catalog}
			{rowActions}
			{duplicates}
			subtaskCountOf={(id) => tickets.progressOf(id).total}
			parentKeyOf={(ticket) =>
				parentOf(ticket, (id) => tickets.find(id) ?? store.find(id))?.key ?? null}
			inboxCount={inbox.newCount}
			projectsNewCount={tickets.newInProjects}
		/>
	{/snippet}
	{@render children()}
</ViewWithPanel>
