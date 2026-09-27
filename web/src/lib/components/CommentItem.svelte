<script lang="ts">
	import { tick } from 'svelte';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { personLabel } from '$lib/domain/people';
	import { COMMENT_MAX_LENGTH, type Comment } from '$lib/domain/ticket';
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Markdown from './Markdown.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';

	// One comment (E2 plan, T-9 and T-13): author relative to the signed-in user, time in Berlin,
	// "bearbeitet" after a change, sanitized Markdown. "Löschen" asks through the confirmation of
	// ADR-0025 section 4; a failure shows at the comment. Only own comments offer "Bearbeiten" and
	// "Löschen"; the API rules enforce it. Only in own comments can tasks be ticked (ADR-0032
	// section 6); in foreign ones the checkboxes stay disabled.
	let {
		comment,
		store,
		ondeleted
	}: {
		comment: Comment;
		store: TicketActivityStore;
		/** Called after the comment was deleted, so the list can move the focus. */
		ondeleted: () => void;
	} = $props();

	const uid = $props.id();
	const errorId = `${uid}-error`;

	let editButton = $state<HTMLButtonElement>();
	let editText = $state<HTMLTextAreaElement>();

	const author = $derived(personLabel(comment.author, store.userId));
	const time = $derived(formatBerlinDateTime(comment.created));
	const edited = $derived(comment.updated > comment.created);
	const own = $derived(store.isOwn(comment));
	const editing = $derived(store.isEditing(comment.id));
	const busy = $derived(store.isBusy(comment.id));
	const error = $derived(store.commentError(comment.id));
	/** Names the comment for screen readers on its buttons ("Bearbeiten: Kommentar von Du …"). */
	const context = $derived(`Kommentar von ${author} vom ${time}`);

	async function startEdit() {
		store.startEdit(comment.id);
		await tick();
		editText?.focus();
	}

	async function endEdit(save: boolean) {
		if (save) {
			if (!(await store.saveEdit(comment.id))) return;
		} else {
			store.cancelEdit(comment.id);
		}
		await tick();
		editButton?.focus();
	}

	function onEditKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void endEdit(true);
		}
	}

	let confirmingDelete = $state(false);
	let deleting = $state(false);

	function remove() {
		if (!busy) confirmingDelete = true;
	}

	async function confirmRemove() {
		deleting = true;
		const deleted = await store.deleteComment(comment.id);
		deleting = false;
		confirmingDelete = false;
		if (deleted) ondeleted();
	}
</script>

<li class="comment">
	<article aria-label={context}>
		<header class="head">
			<span class="author">{author}</span>
			<span class="time">{time}</span>
			{#if edited}
				<span class="edited" title={`Bearbeitet am ${formatBerlinDateTime(comment.updated)}`}
					>bearbeitet</span
				>
			{/if}
			{#if own && !editing}
				<span class="actions">
					<button class="small" type="button" bind:this={editButton} onclick={startEdit}>
						Bearbeiten<span class="visually-hidden">: {context}</span>
					</button>
					<button class="small" type="button" aria-disabled={busy} onclick={remove}>
						Löschen<span class="visually-hidden">: {context}</span>
					</button>
				</span>
			{/if}
		</header>

		{#if editing}
			<MarkdownEditor
				label="Kommentar bearbeiten (Markdown)"
				maxlength={COMMENT_MAX_LENGTH}
				rows={4}
				bind:value={() => store.editValue(comment.id), (value) => store.setEdit(comment.id, value)}
				bind:textarea={editText}
				aria-invalid={error ? 'true' : undefined}
				aria-describedby={error ? errorId : undefined}
				onkeydown={onEditKeydown}
			/>
			{#if error}
				<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
			{/if}
			<div class="buttons">
				<button
					class="button-primary small-primary"
					type="button"
					disabled={busy}
					onclick={() => endEdit(true)}
				>
					{busy ? 'Wird gespeichert …' : 'Speichern'}
				</button>
				<button class="small" type="button" onclick={() => endEdit(false)}>Abbrechen</button>
			</div>
		{:else}
			<Markdown
				source={comment.body}
				ontoggletask={own
					? (index, checked) => store.toggleTask(comment.id, index, checked)
					: undefined}
				taskHint={busy ? 'Der Kommentar wird gerade gespeichert.' : null}
			/>
			{#if error}
				<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
			{/if}
		{/if}
	</article>
	<ConfirmDialog
		open={confirmingDelete}
		title="Kommentar löschen?"
		confirmLabel="Löschen"
		busy={deleting}
		onconfirm={() => void confirmRemove()}
		oncancel={() => (confirmingDelete = false)}
	>
		<p>Der Kommentar von {author} vom {time} wird endgültig gelöscht.</p>
	</ConfirmDialog>
</li>

<style>
	.comment {
		padding: 0.625rem 0;
		border-top: 1px solid var(--color-line);
	}

	article {
		display: grid;
		gap: 0.375rem;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: baseline;
		font-size: var(--font-size-control);
	}

	.author {
		font-weight: 600;
	}

	.time,
	.edited {
		color: var(--color-text-muted);
	}

	.edited {
		font-style: italic;
	}

	.actions {
		display: inline-flex;
		gap: 0.375rem;
		margin-left: auto;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.small {
		padding: 0.0625rem 0.5rem;
		font-size: var(--font-size-small);
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.small[aria-disabled='true'] {
		cursor: progress;
	}

	.small-primary {
		padding: 0.25rem 0.75rem;
		font-size: var(--font-size-control);
	}
</style>
