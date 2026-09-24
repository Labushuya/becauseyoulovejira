<script lang="ts">
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import CommentForm from './CommentForm.svelte';
	import CommentItem from './CommentItem.svelte';
	import ErrorIcon from './ErrorIcon.svelte';

	// Comments of the open ticket (E2 plan, T-11): oldest first, the newest directly above the
	// input field. After a deletion the focus goes to the region, so it is not lost.
	let { store, label = 'Kommentare' }: { store: TicketActivityStore; label?: string } = $props();

	let region = $state<HTMLElement>();
</script>

<div class="comments" role="region" aria-label={label} tabindex="-1" bind:this={region}>
	{#if store.commentsState === 'error' && store.commentsError}
		<div class="alert-error">
			<ErrorIcon />
			<span class="grow">{store.commentsError}</span>
			<button class="retry" type="button" onclick={() => store.reload()}>Erneut versuchen</button>
		</div>
	{:else if store.commentsState === 'loading' && store.comments.length === 0}
		<p class="muted loading" role="status">Kommentare werden geladen …</p>
	{:else if store.commentsState === 'ready' && store.comments.length === 0}
		<p class="muted">Noch keine Kommentare.</p>
	{:else}
		<ol class="list">
			{#each store.comments as comment (comment.id)}
				<CommentItem {comment} {store} ondeleted={() => region?.focus()} />
			{/each}
		</ol>
	{/if}

	{#if store.commentsState !== 'error'}
		<CommentForm {store} />
	{/if}
</div>

<style>
	.comments {
		display: grid;
		gap: 0.5rem;
	}

	.comments:focus {
		outline: none;
	}

	.list {
		list-style: none;
	}

	.muted {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	/* Only shown if loading takes noticeably long: no flash on a fast local server. */
	.loading {
		animation: reveal 0s 0.4s both;
	}

	@keyframes reveal {
		from {
			visibility: hidden;
		}

		to {
			visibility: visible;
		}
	}

	.retry {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid currentColor;
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.grow {
		flex: 1;
	}
</style>
