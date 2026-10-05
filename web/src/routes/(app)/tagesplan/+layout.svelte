<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import DayPlanView from '$lib/components/day-plan/DayPlanView.svelte';
	import ViewWithPanel from '$lib/components/ViewWithPanel.svelte';
	import { clientArea } from '$lib/data/area';
	import { pb } from '$lib/pocketbase';
	import { findAreaStore } from '$lib/stores/area.svelte';
	import { DayPlanStore, dayPlanData, dayPlanLive } from '$lib/stores/day-plan.svelte';
	import { getFlagStore } from '$lib/stores/flags.svelte';
	import { getInboxStore } from '$lib/stores/inbox.svelte';
	import { liveSource } from '$lib/stores/realtime';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { DAY_PLAN_HOST, setTicketHost } from '$lib/ticket-host';
	import { dayPlanDateFrom } from '$lib/ticket-links';
	import { followTicketReturn } from '$lib/ticket-return.svelte';

	// View "Tagesplan" (TP-1, ADR-0065): the plan of the area of the tab and the day of the address
	// (`tag`, today without it) on the left, the panel of a ticket (/tagesplan/tickets/<id>) on the
	// right like next to "Aufgaben", the full view over it. The host in the context makes every ticket
	// link below it stay here (ADR-0054); closing a ticket gives the focus back to its link. The open
	// tickets come from the list store of the app layout, which follows them live; the plan, its
	// entries and its suggestions live with this layout and follow the area of the tab, the day of the
	// address and the clock of the list (midnight).
	let { children } = $props();

	setTicketHost(DAY_PLAN_HOST);
	followTicketReturn(DAY_PLAN_HOST);

	const tickets = getTicketListStore();
	const inbox = getInboxStore();
	const flags = getFlagStore();
	const area = findAreaStore();
	const store = new DayPlanStore(dayPlanData(pb), tickets, auth, {
		flags,
		scope: () => clientArea(pb)
	});

	const withPanel = $derived(page.route.id === DAY_PLAN_HOST.panelRoute);
	const date = $derived(dayPlanDateFrom(page.url));

	// The open tickets feed the suggestions and the pool, also when the app starts here.
	$effect(() => untrack(() => tickets.loadOpen()));
	$effect(() => untrack(() => store.connect(liveSource(pb), dayPlanLive(pb))));

	// The day of the address; without one today, which follows the clock of the list at midnight.
	let shownToday: string | null = null;
	$effect(() => {
		const shown = date;
		const today = tickets.today;
		untrack(() => {
			const midnight = shownToday !== null && today !== shownToday;
			shownToday = today;
			if (midnight && shown === null) void store.reload();
			else store.show(shown);
		});
	});

	// The area of the tab (ADR-0059): the plan of the other area replaces the shown one.
	let shownArea: string | null = null;
	$effect(() => {
		const key = area?.key ?? '';
		untrack(() => {
			if (shownArea !== null && key !== shownArea) store.rescope();
			shownArea = key;
		});
	});

	// A ticket of an automatic source that just appeared (marked as an ongoing project, due today):
	// the server takes it into the plan of today.
	$effect(() => {
		if (store.automatic.length === 0) return;
		untrack(() => store.syncAutomatic());
	});
</script>

<ViewWithPanel {withPanel}>
	{#snippet list()}
		<DayPlanView
			{store}
			{area}
			inboxCount={inbox.newCount}
			projectsNewCount={tickets.newInProjects}
		/>
	{/snippet}
	{@render children()}
</ViewWithPanel>
