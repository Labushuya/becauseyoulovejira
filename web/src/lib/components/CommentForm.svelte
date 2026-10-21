<script lang="ts">
	import { tick } from 'svelte';
	import { COMMENT_MAX_LENGTH } from '$lib/domain/ticket';
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import ProblemDetails from './problems/ProblemDetails.svelte';
	import RichTextEditor from './RichTextEditor.svelte';

	// New comment above the list (E2 plan, T-11 and package 9; since ADR-0044 at the top in either
	// order, like in Jira; since RT-6 the editor of ADR-0032, compact, with "Markdown" as source
	// mode): `Strg+Enter` sends. Like in Jira the editor opens on "Kommentar hinzufügen …", so
	// opening a ticket loads no editor (plan editor RT-6); a draft or an error keeps it open.
	// "Kommentieren" stays focusable while locked (like "Anlegen", package 8) and explains why; the
	// text stays after a failure. After sending the field closes and the focus goes back to
	// "Kommentar hinzufügen …", unless `onposted` shows the new comment and takes the focus there
	// (at the end of the list, "Älteste zuerst"). A comment the outbox keeps for later (OF-4b) says so
	// below in the polite status region.
	let {
		store,
		onposted
	}: {
		store: TicketActivityStore;
		/** After a sent comment; true if it moved the focus to the new comment itself. */
		onposted?: () => Promise<boolean>;
	} = $props();

	const uid = $props.id();
	const hintId = `${uid}-hint`;
	const errorId = `${uid}-error`;

	let editor = $state<ReturnType<typeof RichTextEditor>>();
	let opener = $state<HTMLButtonElement>();
	let opened = $state(false);

	const empty = $derived(store.newComment.trim() === '');
	const locked = $derived(empty || store.posting);
	const expanded = $derived(opened || !empty || store.postError !== null);

	async function open() {
		opened = true;
		await tick();
		editor?.focus();
	}

	async function send() {
		editor?.flush();
		if (store.newComment.trim() === '') {
			editor?.focus();
			return;
		}
		if (store.posting) return;
		if (!(await store.post())) {
			editor?.focus();
			return;
		}
		opened = false;
		await tick();
		if (!((await onposted?.()) ?? false)) opener?.focus();
	}
</script>

<div class="comment-form">
	{#if expanded}
		<RichTextEditor
			bind:this={editor}
			label="Neuer Kommentar"
			placeholder="Kommentar schreiben …"
			compact
			maxlength={COMMENT_MAX_LENGTH}
			bind:value={() => store.newComment, (value) => store.setNewComment(value)}
			invalid={store.postError !== null}
			describedby={store.postError ? errorId : undefined}
			onsubmit={() => void send()}
		/>
		{#if store.postError}
			<p class="field-error" id={errorId}><ErrorIcon /><span>{store.postError}</span></p>
			<ProblemDetails problem={store.postProblem} />
		{/if}
		<div class="buttons">
			<button
				class="button-primary button-small"
				type="button"
				aria-disabled={locked}
				aria-busy={store.posting ? 'true' : undefined}
				aria-describedby={empty ? hintId : undefined}
				onclick={send}
			>
				{store.posting ? 'Wird gesendet …' : 'Kommentieren'}
			</button>
			{#if empty}
				<span class="hint" id={hintId}>Zum Kommentieren fehlt noch Text.</span>
			{:else}
				<span class="hint">Strg+Enter sendet.</span>
			{/if}
		</div>
	{:else}
		<button class="opener" type="button" bind:this={opener} onclick={open}>
			Kommentar hinzufügen …
		</button>
	{/if}
	<p class="note" role="status">{store.postNote ?? ''}</p>
</div>

<style>
	/* Above the list; the line of the first comment separates them. */
	.comment-form {
		display: grid;
		gap: 0.5rem;
		padding-bottom: 0.25rem;
	}

	/* Looks like the empty field it opens, like in Jira. */
	.opener {
		width: 100%;
		min-height: var(--control-height-l);
		padding: 0.375rem 0.625rem;
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
		text-align: left;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
		cursor: text;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
	}

	.hint,
	.note {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.note:empty {
		display: none;
	}

	/*
	 * Phone frame (MO-4, ADR-0073 addendum MO-4): "Kommentar hinzufügen …" as a target of 44 px, and
	 * "Kommentieren" stays at the bottom of the page while the text is longer than the screen above
	 * the keyboard (the page scrolls, the row sticks to its lower edge).
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .opener {
			min-height: var(--control-height-touch);
		}

		:global(:root[data-mobile-layout='on']) .buttons {
			position: sticky;
			bottom: 0;
			z-index: 1;
			padding-block: 0.5rem;
			background: var(--color-surface);
			border-top: 1px solid var(--color-line);
		}
	}
</style>
