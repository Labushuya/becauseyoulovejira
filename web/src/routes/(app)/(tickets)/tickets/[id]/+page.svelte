<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TicketActivity from '$lib/components/TicketActivity.svelte';
	import TicketPanel from '$lib/components/TicketPanel.svelte';
	import { getTicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { listHref } from '$lib/ticket-links';

	// Detail panel of /tickets/<record id> (E2 plan, T-4); a reload opens the same panel.
	const detail = getTicketDetailStore();
	const comments = getTicketActivityStore();
	const id = $derived(page.params.id ?? '');
	const back = $derived(listHref(page.url));

	$effect(() => {
		const current = id;
		untrack(() => {
			detail.open(current);
			comments.open(current);
		});
	});

	// Leaving the panel drops the ticket, its comments and all drafts.
	$effect(() => () => {
		detail.reset();
		comments.reset();
	});

	async function close() {
		await goto(back);
	}
</script>

<svelte:head>
	<title>{detail.ticket ? `${detail.ticket.key} · ` : ''}becauseyoulovejira</title>
</svelte:head>

<TicketPanel store={detail} listHref={back} onclose={close}>
	{#snippet activity()}
		<TicketActivity store={comments} />
	{/snippet}
</TicketPanel>
