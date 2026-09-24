<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import TicketActivity from '$lib/components/TicketActivity.svelte';
	import TicketPanel from '$lib/components/TicketPanel.svelte';
	import { getTicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import { getTicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { listHref } from '$lib/ticket-links';

	// Detail panel of /tickets/<record id> (E2 plan, T-4); a reload opens the same panel.

	/** Question before a description or comment that is not saved would be lost. */
	const DISCARD_QUESTION = 'Änderungen verwerfen? Der nicht gespeicherte Text geht verloren.';
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

	/** Set once the ticket was deleted here: leaving then needs no question. */
	let discarding = false;

	// Leaving the panel within the app (Schließen, Escape, another ticket, "Neues Ticket", browser
	// back) asks first while a description or comment is not saved. Logout and session end go to
	// the login page and are not held up; closing the browser tab is not covered.
	beforeNavigate((navigation) => {
		const to = navigation.to;
		if (discarding || navigation.type === 'leave' || to === null) return;
		if (!to.route.id?.startsWith('/(app)/') || to.url.pathname === page.url.pathname) return;
		if (detail.state !== 'ready' || !(detail.unsavedDescription || comments.dirty)) return;
		if (!window.confirm(DISCARD_QUESTION)) navigation.cancel();
	});

	async function close() {
		await goto(back);
	}

	async function deleted() {
		discarding = true;
		await goto(back);
	}
</script>

<svelte:head>
	<title>{detail.ticket ? `${detail.ticket.key} · ` : ''}becauseyoulovejira</title>
</svelte:head>

<TicketPanel store={detail} listHref={back} onclose={close} ondeleted={deleted}>
	{#snippet activity()}
		<TicketActivity store={comments} />
	{/snippet}
</TicketPanel>
