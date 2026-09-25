<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { pb } from '$lib/pocketbase';
	import { CatalogStore, catalogData, setCatalogStore } from '$lib/stores/catalog.svelte';
	import { InboxStore, inboxData, setInboxStore } from '$lib/stores/inbox.svelte';
	import { liveSource } from '$lib/stores/realtime';
	import {
		TicketActivityStore,
		setTicketActivityStore,
		ticketActivityData
	} from '$lib/stores/ticket-activity.svelte';
	import {
		TicketDetailStore,
		setTicketDetailStore,
		ticketDetailData
	} from '$lib/stores/ticket-detail.svelte';
	import {
		TicketListStore,
		setTicketListStore,
		ticketListData
	} from '$lib/stores/ticket-list.svelte';

	// Shell of every signed-in page (E2 plan, T-4). The root layout renders it only with a
	// session; the login page stays outside this group.
	let { children } = $props();

	// Stores live per layout instance (ADR-0006 section 1): a logout removes the layout and with
	// it every loaded ticket, project and tag.
	const catalog = setCatalogStore(new CatalogStore(catalogData(pb), auth));
	// The column sort "Projekt" resolves projects through the catalog (E3 plan, package 9).
	const tickets = setTicketListStore(
		new TicketListStore(ticketListData(pb), auth, {
			projectOf: (ticket) => catalog.projectOf(ticket)
		})
	);
	const detail = setTicketDetailStore(new TicketDetailStore(ticketDetailData(pb), auth, tickets));
	// The inbox (E4 plan, T-4): new entries in full, for the view and the count at the switch.
	const inbox = setInboxStore(new InboxStore(inboxData(pb), auth));
	const activity = setTicketActivityStore(
		new TicketActivityStore(ticketActivityData(pb), auth, () => auth.userId)
	);

	// Session care while the app is shown (ADR-0007 section 1). The returned cleanup removes the
	// timer and the listeners when the layout goes away (logout, session end). untrack: the
	// keep-alive must not restart when session state it reads changes.
	$effect(() => untrack(() => auth.keepAlive()));

	// Clock of "today" for the list order (T-3); the cleanup also empties the store.
	$effect(() => untrack(() => tickets.start()));

	// Projects and tags, loaded once per session (E3 plan, T-16); the cleanup empties the catalog.
	$effect(() => untrack(() => catalog.start()));

	// New inbox entries, loaded once per session; the cleanup empties the inbox.
	$effect(() => untrack(() => inbox.start()));

	// Live updates (ADR-0007 section 2): list, panel, comments, history, catalog and inbox. The
	// cleanups end every subscription when the layout goes away; a logout has already ended them.
	const live = liveSource(pb);
	$effect(() => untrack(() => tickets.connect(live)));
	$effect(() => untrack(() => detail.connect(live)));
	$effect(() => untrack(() => activity.connect(live)));
	$effect(() => untrack(() => catalog.connect(live)));
	$effect(() => untrack(() => inbox.connect(live)));
</script>

<AppHeader openCount={tickets.openState === 'ready' ? tickets.openCount : null} />
<main class="content">
	{@render children()}
</main>

<style>
	.content {
		padding: 1.5rem;
	}
</style>
