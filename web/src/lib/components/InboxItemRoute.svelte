<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { getTicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import { findTicketReturn } from '$lib/ticket-return.svelte';
	import InboxPanel from './InboxPanel.svelte';

	// Panel of one inbox entry as a route (/eingang/<record id>, E4 plan T-3; next to the calendar
	// /kalender/eingang/<id>, ADR-0054 §8); a reload opens the same panel. Its tickets open with the
	// host of the place, and back from a ticket it replaced the focus goes to the link of that ticket.
	let {
		back,
		section
	}: {
		/** × of the panel: the inbox with its chips or the calendar. */
		back: ResolvedPathname;
		/** Name of the place in the title of the page ("Eingang", "Kalender"). */
		section: string;
	} = $props();

	const inbox = getInboxStore();
	const tickets = getTicketListStore();
	const rules = getRecurrenceStore();
	const sources = getTicketSourcesStore();
	const ticketReturn = findTicketReturn();
	// Projects of the catalog name the target project of the entry (ADR-0049).
	const catalog = getCatalogStore();
	const id = $derived(page.params.id ?? '');
	const title = $derived(inbox.find(id)?.title);
</script>

<svelte:head>
	<title>{title ? `${title} · ` : ''}{section} · becauseyoulovejira</title>
</svelte:head>

{#key id}
	<InboxPanel
		{id}
		store={inbox}
		openTickets={tickets.open}
		projects={catalog.projects}
		recurrence={rules}
		today={tickets.today}
		{sources}
		onclose={() => goto(back)}
		initialFocus={() => ticketReturn?.focusTarget() ?? null}
	/>
{/key}
