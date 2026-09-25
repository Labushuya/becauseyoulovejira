<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import InboxPanel from '$lib/components/InboxPanel.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { inboxHref } from '$lib/ticket-links';

	// Panel of one inbox entry (/eingang/<record id>, E4 plan T-3); a reload opens the same panel.
	const inbox = getInboxStore();
	const tickets = getTicketListStore();
	const id = $derived(page.params.id ?? '');
	const back = $derived(inboxHref(page.url));
	const title = $derived(inbox.find(id)?.title);
</script>

<svelte:head>
	<title>{title ? `${title} · ` : ''}Eingang · becauseyoulovejira</title>
</svelte:head>

{#key id}
	<InboxPanel {id} store={inbox} openTickets={tickets.open} onclose={() => goto(back)} />
{/key}
