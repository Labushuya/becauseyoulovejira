<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import { viewOfRoute } from '$lib/domain/area';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { getTicketSourcesStore } from '$lib/stores/ticket-sources.svelte';
	import { findTicketReturn } from '$lib/ticket-return.svelte';
	import { arrowBack } from '$lib/views';
	import { previousEntry } from '$lib/way-back';
	import InboxPanel from './InboxPanel.svelte';

	// Panel of one inbox entry as a route (/eingang/<record id>, E4 plan T-3; next to the calendar
	// /kalender/eingang/<id>, ADR-0054 §8); a reload opens the same panel. Its tickets open with the
	// host of the place, and back from a ticket it replaced the focus goes to the link of that ticket.
	// In the phone frame (MO-6, ADR-0073 addendum MO-6) the entry is a page whose arrow goes back
	// through the history when the page of a view lies right before it: the list of the inbox with
	// its chips, or the view where "＋" captured the entry ("Eintrag ansehen"), named after it. From
	// elsewhere it leads to the view of the route like the × (`back`).
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

	/** The page before this one, when a link of the app or a step forward led here (MO-6). */
	let previous = $state<string | null>(null);
	afterNavigate(({ type, from, delta }) => {
		previous = previousEntry({ type, from: from?.url ?? null, delta });
	});
	const way = $derived(arrowBack(previous, viewOfRoute(page.route.id) ?? 'inbox'));

	function onback() {
		if (way.throughHistory) history.back();
		else void goto(back);
	}
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
		backLabel={way.label}
		{onback}
		initialFocus={() => ticketReturn?.focusTarget() ?? null}
	/>
{/key}
