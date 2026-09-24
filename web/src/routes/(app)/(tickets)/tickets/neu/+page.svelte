<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import NewTicketForm from '$lib/components/NewTicketForm.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { listHref, ticketHref } from '$lib/ticket-links';

	// "Neues Ticket" (E2 plan, T-8): after creating, the panel switches to the new ticket in
	// place (replaceState), so "back" leads to the list and not to an empty form.
	const detail = getTicketDetailStore();
</script>

<svelte:head>
	<title>Neues Ticket · becauseyoulovejira</title>
</svelte:head>

<NewTicketForm
	oncreate={(draft) => detail.create(draft)}
	oncreated={(id) => goto(ticketHref(id, page.url), { replaceState: true })}
	oncancel={() => goto(listHref(page.url))}
/>
