<script lang="ts">
	import { COMMENT_MAX_LENGTH } from '$lib/domain/ticket';
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';

	// New comment below the list (E2 plan, T-11 and package 9): Markdown with preview, `Strg+Enter`
	// sends. "Kommentieren" stays focusable while locked (like "Anlegen", package 8) and explains
	// why; the text stays after a failure.
	let { store }: { store: TicketActivityStore } = $props();

	const uid = $props.id();
	const hintId = `${uid}-hint`;
	const errorId = `${uid}-error`;

	let text = $state<HTMLTextAreaElement>();

	const empty = $derived(store.newComment.trim() === '');
	const locked = $derived(empty || store.posting);

	async function send() {
		if (empty) {
			text?.focus();
			return;
		}
		if (store.posting) return;
		await store.post();
		text?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void send();
		}
	}
</script>

<div class="comment-form">
	<MarkdownEditor
		label="Neuer Kommentar (Markdown)"
		maxlength={COMMENT_MAX_LENGTH}
		rows={3}
		bind:value={() => store.newComment, (value) => store.setNewComment(value)}
		bind:textarea={text}
		aria-invalid={store.postError ? 'true' : undefined}
		aria-describedby={store.postError ? errorId : undefined}
		{onkeydown}
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
</div>

<style>
	.comment-form {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
	}

	.send {
		padding: 0.25rem 0.875rem;
		font-size: 0.8125rem;
	}

	.send[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
