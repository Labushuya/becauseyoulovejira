<script lang="ts">
	import { untrack } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { pb } from '$lib/pocketbase';
	import {
		TicketListStore,
		setTicketListStore,
		ticketListData
	} from '$lib/stores/ticket-list.svelte';

	// Shell of every signed-in page (E2 plan, T-4). The root layout renders it only with a
	// session; the login page stays outside this group.
	let { children } = $props();

	// Stores live per layout instance (ADR-0006 section 1): a logout removes the layout and with
	// it every loaded ticket.
	const tickets = setTicketListStore(new TicketListStore(ticketListData(pb), auth));

	// Session care while the app is shown (ADR-0007 section 1). The returned cleanup removes the
	// timer and the listeners when the layout goes away (logout, session end). untrack: the
	// keep-alive must not restart when session state it reads changes.
	$effect(() => untrack(() => auth.keepAlive()));

	// Clock of "today" for the list order (T-3); the cleanup also empties the store.
	$effect(() => untrack(() => tickets.start()));
</script>

<AppHeader />
<main class="content">
	{@render children()}
</main>

<style>
	.content {
		padding: 1.5rem;
	}
</style>
