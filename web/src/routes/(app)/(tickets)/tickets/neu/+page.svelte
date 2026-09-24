<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import NewTicketForm from '$lib/components/NewTicketForm.svelte';
	import { parseListQuery } from '$lib/domain/list-query';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { listHref, ticketHref } from '$lib/ticket-links';

	// "Neues Ticket" (E2 plan, T-8; E3 plan, T-13 and T-14): after creating, the panel switches to
	// the new ticket in place (replaceState), so "back" leads to the list and not to an empty form.
	// A list filtered by an active project chooses that project in advance ("ohne" is no project
	// ID and is ignored by the form). New tags come from the catalog, which reuses existing names.
	const detail = getTicketDetailStore();
	const catalog = getCatalogStore();
	const filteredProject = $derived(parseListQuery(page.url.searchParams).project);
</script>

<svelte:head>
	<title>Neues Ticket · becauseyoulovejira</title>
</svelte:head>

<NewTicketForm
	projects={catalog.activeProjects}
	initialProject={filteredProject}
	tags={catalog.tags}
	oncreatetag={(name) => catalog.ensureTag(name)}
	oncreate={(draft) => detail.create(draft)}
	oncreated={(id) => goto(ticketHref(id, page.url), { replaceState: true })}
	oncancel={() => goto(listHref(page.url))}
/>
