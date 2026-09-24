<script lang="ts">
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import CommentList from './CommentList.svelte';

	// Activity below the ticket fields (E2 plan, T-11): the comments of the open ticket.
	let { store }: { store: TicketActivityStore } = $props();

	const uid = $props.id();
</script>

<section class="activity" aria-labelledby={`${uid}-title`}>
	<h3 id={`${uid}-title`}>Kommentare</h3>
	<CommentList {store} />
</section>

<style>
	.activity {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	h3 {
		font-size: 0.875rem;
		font-weight: 600;
	}
</style>
