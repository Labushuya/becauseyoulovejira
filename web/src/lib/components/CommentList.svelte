<script lang="ts">
	import { tick } from 'svelte';
	import {
		COMMENT_ORDERS,
		COMMENT_ORDER_LABELS,
		arrangeComments,
		commentOrderAnnouncement,
		type CommentOrder,
		type CommentPinControl
	} from '$lib/domain/comments';
	import { CommentViewStore, findCommentView } from '$lib/stores/comment-view.svelte';
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import CommentForm from './CommentForm.svelte';
	import CommentItem from './CommentItem.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';

	// Comments of the open ticket (E2 plan, T-11; ADR-0044): the switch "Neueste zuerst | Älteste
	// zuerst" (remembered on this device, announced politely), the input field at the top in either
	// order, the pinned comment always first, then the others in the chosen order. After a deletion
	// the owner moves the focus (`ondeleted`), so it is not lost; a new comment at the end of the
	// list ("Älteste zuerst") takes the focus, so it is seen. Without comments a compact empty state
	// stands below the form (plan EH-11). `view` is the store of the (app) layout; single component
	// tests get their own.
	let {
		store,
		ondeleted,
		pin = null,
		view: given
	}: {
		store: TicketActivityStore;
		ondeleted: () => void;
		/** Pinning through the ticket (ADR-0044); null offers no pinning. */
		pin?: CommentPinControl | null;
		/** Order and unfolded comments; without it the store of the (app) layout. */
		view?: CommentViewStore;
	} = $props();

	const fromContext = findCommentView() ?? new CommentViewStore(null);
	const view = $derived(given ?? fromContext);

	let list = $state<HTMLOListElement>();
	let announcement = $state('');

	const arranged = $derived(arrangeComments(store.comments, view.order, pin?.pinnedComment));

	function choose(order: CommentOrder) {
		if (order === view.order) return;
		view.setOrder(order);
		announcement = commentOrderAnnouncement(order);
	}

	/** "Älteste zuerst": the new comment stands at the end; it takes the focus and so the view. */
	async function showPosted(): Promise<boolean> {
		const id = store.lastPostedId;
		if (view.order !== 'oldest' || id === null) return false;
		await tick();
		const articles = list?.querySelectorAll<HTMLElement>('article[data-comment-id]') ?? [];
		const article = [...articles].find((element) => element.dataset.commentId === id);
		if (article === undefined) return false;
		article.focus();
		return true;
	}
</script>

<div class="comments">
	{#if store.commentsState === 'error' && store.commentsError}
		<div class="alert-error">
			<ErrorIcon />
			<span class="grow">{store.commentsError}</span>
			<button class="retry" type="button" onclick={() => store.reload()}>Erneut versuchen</button>
		</div>
	{:else}
		{#if store.comments.length > 1}
			<div class="order segmented" role="group" aria-label="Reihenfolge der Kommentare">
				{#each COMMENT_ORDERS as order (order)}
					<button type="button" aria-pressed={view.order === order} onclick={() => choose(order)}>
						{COMMENT_ORDER_LABELS[order]}
					</button>
				{/each}
			</div>
		{/if}
		<p class="visually-hidden" role="status">{announcement}</p>

		<CommentForm {store} onposted={showPosted} />

		{#if store.commentsState === 'loading' && store.comments.length === 0}
			<p class="muted loading" role="status">Kommentare werden geladen …</p>
		{:else if store.commentsState === 'ready' && store.comments.length === 0}
			<EmptyState size="compact" title="Noch keine Kommentare" headingLevel={3} />
		{:else}
			<ol class="list" bind:this={list}>
				{#if arranged.pinned}
					<CommentItem comment={arranged.pinned} {store} {ondeleted} {pin} {view} pinned />
				{/if}
				{#each arranged.rest as comment (comment.id)}
					<CommentItem {comment} {store} {ondeleted} {pin} {view} />
				{/each}
			</ol>
		{/if}
	{/if}
</div>

<style>
	.comments {
		display: grid;
		gap: 0.5rem;
	}

	.order {
		justify-self: end;
	}

	.list {
		list-style: none;
	}

	.muted {
		font-size: var(--font-size-body);
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
		font-size: var(--font-size-control);
		background: none;
		border: 1px solid currentColor;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.grow {
		flex: 1;
	}
</style>
