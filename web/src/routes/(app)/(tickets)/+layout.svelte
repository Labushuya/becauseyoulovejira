<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import TicketList from '$lib/components/TicketList.svelte';
	import { getTicketListStore } from '$lib/stores/ticket-list.svelte';
	import { showDoneFrom } from '$lib/ticket-links';

	// List plus panel area (E2 plan, T-4): the list stays in place while the detail panel opens
	// and closes, so scroll position and loaded pages survive.
	let { children } = $props();

	const tickets = getTicketListStore();
	const showDone = $derived(showDoneFrom(page.url));

	// Loads the list and follows the switch in the URL (reload, back and forward included).
	// untrack: only the switch triggers it, not the store state that activate() reads.
	$effect(() => {
		const show = showDone;
		untrack(() => tickets.activate(show));
	});
</script>

<div class="tickets">
	<TicketList store={tickets} />
	{@render children()}
</div>
