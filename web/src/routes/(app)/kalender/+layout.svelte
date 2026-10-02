<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import CalendarView from '$lib/components/calendar/CalendarView.svelte';
	import TicketRowDialogs from '$lib/components/TicketRowDialogs.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import { parentOf } from '$lib/domain/subtasks';
	import { pb } from '$lib/pocketbase';
	import { CalendarDoneStore, calendarDoneData } from '$lib/stores/calendar.svelte';
	import { CalendarPrefsStore } from '$lib/stores/calendar-prefs.svelte';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import { liveSource } from '$lib/stores/realtime';
	import { getRecurrenceStore } from '$lib/stores/recurrence.svelte';
	import { findTicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { findTicketRowActions } from '$lib/stores/ticket-row-actions.svelte';
	import type { DeleteResult, DeleteSources } from '$lib/stores/trash-move';
	import {
		CALENDAR_HOST,
		CALENDAR_ITEM_ROUTE,
		CALENDAR_RULE_ROUTE,
		isTicketRoute,
		setTicketHost
	} from '$lib/ticket-host';
	import { followTicketReturn } from '$lib/ticket-return.svelte';

	// View "Kalender" (ADR-0053, plan kalender): the calendar on the left, the panel of a ticket
	// (/kalender/tickets/<id>) on the right like next to "Aufgaben", the full view over it. The host
	// in the context makes every ticket link below it stay in the calendar (ADR-0053 §6). The open
	// tickets, rules and new inbox entries come from the stores of the app layout, which follow them
	// live; done tickets of the shown period and what this device remembers live with this layout.
	// The questions of the menu "•••" of a ticket open here, like in the projects. A planned date
	// opens its rule and a date of the inbox its entry next to the calendar as well
	// (/kalender/wiederholungen/<id>, /kalender/eingang/<id>; ADR-0054 §8); a ticket opened from them
	// replaces that panel, and × with the focus leads back (followTicketReturn).
	let { children } = $props();

	setTicketHost(CALENDAR_HOST);
	followTicketReturn(CALENDAR_HOST);

	const tickets = getTicketListStore();
	const catalog = getCatalogStore();
	const rules = getRecurrenceStore();
	const inbox = getInboxStore();
	const rowActions = findTicketRowActions();
	const duplicates = findTicketDuplicateStore();
	const links = ticketLinks();
	const done = new CalendarDoneStore(calendarDoneData(pb), auth);
	const prefs = new CalendarPrefsStore(window);

	/** The shown ticket, rule or entry; each marks its own entries only. */
	const shownId = (routeId: string) =>
		page.route.id === routeId ? (page.params.id ?? null) : null;
	const activeId = $derived(
		isTicketRoute(CALENDAR_HOST, page.route.id) ? (page.params.id ?? null) : null
	);
	const activeRuleId = $derived(shownId(CALENDAR_RULE_ROUTE));
	const activeItemId = $derived(shownId(CALENDAR_ITEM_ROUTE));
	// One panel column for a ticket, a rule or an entry; the full view replaces it.
	const withPanel = $derived(
		page.route.id === CALENDAR_HOST.panelRoute ||
			page.route.id === CALENDAR_RULE_ROUTE ||
			page.route.id === CALENDAR_ITEM_ROUTE
	);

	// The open tickets, also when the app starts here; the done ones follow the shown period.
	$effect(() => untrack(() => tickets.loadOpen()));
	$effect(() => untrack(() => prefs.connect()));
	$effect(() => untrack(() => done.connect(liveSource(pb))));

	/** "In den Papierkorb …" of an entry; the panel of that ticket closes afterwards. */
	async function moveToTrash(ticketId: string, sources?: DeleteSources): Promise<DeleteResult> {
		if (rowActions === null) return { ok: false, message: null };
		const result = await rowActions.deleteTicket(sources);
		if (result.ok && ticketId === activeId) await goto(CALENDAR_HOST.view(page.url));
		return result;
	}
</script>

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<CalendarView
			{tickets}
			{catalog}
			{rules}
			{inbox}
			{done}
			{prefs}
			{rowActions}
			duplicates={duplicates !== null}
			{activeId}
			{activeRuleId}
			{activeItemId}
			inboxCount={inbox.newCount}
		/>
	{/snippet}
	{@render children()}
</ViewWithPanel>

<!-- The questions of the menu "•••" of a ticket in the calendar. -->
{#if rowActions}
	<TicketRowDialogs
		{rowActions}
		{duplicates}
		projects={catalog.activeProjects}
		subtaskCountOf={(id) => tickets.progressOf(id).total}
		parentKeyOf={(ticket) => parentOf(ticket, (id) => tickets.find(id))?.key ?? null}
		onopen={(id) => void goto(links.href(id, page.url))}
		{moveToTrash}
	/>
{/if}
