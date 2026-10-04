<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import TrashView from '$lib/components/TrashView.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { getTrashStore } from '$lib/stores/trash.svelte';
	import { TrashArea } from '$lib/trash-area.svelte';

	// View "Papierkorb" (ADR-0037 §9): the table of the trash on the left, the read-only preview of a
	// ticket (/papierkorb/<id>) on the right, like the other views (ViewWithPanel). The tickets come
	// from the store of the app layout, which reads them again on every change of the server. A
	// restored ticket opens from its flag ("Öffnen") in "Aufgaben", in the remembered way (ADR-0054).
	// It is the trash of the area of the tab (E7-3, ADR-0059 §6).
	let { children } = $props();

	const store = getTrashStore();
	const catalog = getCatalogStore();
	const inbox = getInboxStore();
	const tickets = getTicketListStore();
	const links = ticketLinks();
	const trashArea = new TrashArea();

	const activeId = $derived(page.params.id ?? null);
	const withPanel = $derived(page.route.id !== '/(app)/papierkorb');
</script>

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<TrashView
			{store}
			projects={catalog.activeProjects}
			selfId={auth.userId}
			{activeId}
			inboxCount={inbox.newCount}
			projectsNewCount={tickets.newInProjects}
			canPurge={trashArea.canPurge}
			retentionHref={trashArea.retentionHref}
			retentionNote={trashArea.retentionNote}
			onopen={(ticketId) => void goto(links.path(ticketId))}
		/>
	{/snippet}
	{@render children()}
</ViewWithPanel>
