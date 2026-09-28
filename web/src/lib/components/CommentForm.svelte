<script lang="ts">
	import { tick } from 'svelte';
	import { COMMENT_MAX_LENGTH } from '$lib/domain/ticket';
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import RichTextEditor from './RichTextEditor.svelte';

	// New comment below the list (E2 plan, T-11 and package 9; since RT-6 the editor of ADR-0032,
	// compact, with "Markdown" as source mode): `Strg+Enter` sends. Like in Jira the editor opens
	// on "Kommentar hinzufügen …", so opening a ticket loads no editor (plan editor RT-6); a draft
	// or an error keeps it open. "Kommentieren" stays focusable while locked (like "Anlegen",
	// package 8) and explains why; the text stays after a failure. After sending the field closes
	// and the focus goes back to "Kommentar hinzufügen …".
	let { store }: { store: TicketActivityStore } = $props();

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
		opener?.focus();
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
		{/if}
		<div class="buttons">
			<button
				class="button-primary send"
				type="button"
				aria-disabled={locked}
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
</div>

<style>
	.comment-form {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
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

	.send {
		padding: 0.25rem 0.875rem;
		font-size: var(--font-size-control);
	}

	.send[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
