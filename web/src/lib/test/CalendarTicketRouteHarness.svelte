<script lang="ts">
	import { resolve } from '$app/paths';
	import { setTicketOpenMode, type TicketOpenModeStore } from '$lib/stores/open-mode.svelte';
	import { CALENDAR_HOST, setTicketHost } from '$lib/ticket-host';
	import TicketLayout from '../../routes/(app)/kalender/tickets/[id]/+layout.svelte';
	import FullViewPage from '../../routes/(app)/kalender/tickets/[id]/voll/+page.svelte';

	// Test harness of /kalender/tickets/<id> and its full view (calendar-ticket-route.test.ts,
	// ADR-0053 §6): the host of the calendar layout in the context, the layout of the ticket route
	// with the full view as its child page, and an entry of the ticket as the calendar shows it, so
	// the focus can return there.
	let {
		full = false,
		openMode,
		entry
	}: {
		full?: boolean;
		openMode?: TicketOpenModeStore;
		/** Record ID of the ticket whose entry stands in the calendar. */
		entry: string;
	} = $props();

	setTicketHost(CALENDAR_HOST);
	// svelte-ignore state_referenced_locally
	if (openMode !== undefined) setTicketOpenMode(openMode);
</script>

<a href={resolve('/kalender')} data-calendar-ticket={entry}>Eintrag im Kalender</a>
<TicketLayout>
	{#if full}
		<FullViewPage />
	{/if}
</TicketLayout>
