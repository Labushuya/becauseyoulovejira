<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TicketPanel from '$lib/components/TicketPanel.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { listHref } from '$lib/ticket-links';

	// Detail panel of /tickets/<record id> (E2 plan, T-4); a reload opens the same panel.
	const detail = getTicketDetailStore();
	const id = $derived(page.params.id ?? '');
	const back = $derived(listHref(page.url));

	$effect(() => {
		const current = id;
		untrack(() => detail.open(current));
	});

	// Leaving the panel drops the ticket and its drafts.
	$effect(() => () => detail.reset());

	async function close() {
		await goto(back);
	}
</script>

<svelte:head>
	<title>{detail.ticket ? `${detail.ticket.key} · ` : ''}becauseyoulovejira</title>
</svelte:head>

<TicketPanel store={detail} listHref={back} onclose={close} />
