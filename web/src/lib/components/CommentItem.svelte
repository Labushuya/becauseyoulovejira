<script lang="ts">
	import { tick } from 'svelte';
	import type { CommentPinControl } from '$lib/domain/comments';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { personLabel } from '$lib/domain/people';
	import { COMMENT_MAX_LENGTH, type Comment } from '$lib/domain/ticket';
	import type { CommentViewStore } from '$lib/stores/comment-view.svelte';
	import { findPeople } from '$lib/stores/people.svelte';
	import type { TicketActivityStore } from '$lib/stores/ticket-activity.svelte';
	import CommentBody from './CommentBody.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import RichTextEditor from './RichTextEditor.svelte';
	import Lozenge from './guidance/Lozenge.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';

	// One comment (E2 plan, T-9 and T-13): author relative to the signed-in user, time in Berlin,
	// "bearbeitet" after a change, sanitized Markdown. "Löschen" asks through the confirmation of
	// ADR-0025 section 4; a failure shows at the comment. Only own comments offer "Bearbeiten" and
	// "Löschen"; the API rules enforce it. Only in own comments can tasks be ticked (ADR-0032
	// section 6); in foreign ones the checkboxes stay disabled. "Bearbeiten" opens the compact
	// editor (RT-6), Ctrl+Enter saves.
	// Since ADR-0044 every comment offers "Anpinnen" (whoever may change the ticket may pin), the
	// pinned one carries "Angepinnt" and "Lösen"; a long text folds (CommentBody), while editing the
	// editor shows the whole text. The article takes the focus by script after a new comment was
	// sent to the end of the list.
	let {
		comment,
		store,
		ondeleted,
		pin = null,
		pinned = false,
		view
	}: {
		comment: Comment;
		store: TicketActivityStore;
		/** Called after the comment was deleted, so the list can move the focus. */
		ondeleted: () => void;
		/** Pinning through the ticket; null or before the restart: no pinning offered. */
		pin?: CommentPinControl | null;
		/** This is the pinned comment of the ticket. */
		pinned?: boolean;
		/** Unfolded long comments of this tab. */
		view: CommentViewStore;
	} = $props();

	const uid = $props.id();
	const errorId = `${uid}-error`;
	const pinErrorId = `${uid}-pin-error`;

	let editButton = $state<HTMLButtonElement>();
	let editText = $state<ReturnType<typeof RichTextEditor>>();

	// The author by name where it is visible (ADR-0056 §4), otherwise "Anderes Konto".
	const people = findPeople();
	const author = $derived(personLabel(comment.author, store.userId, people));
	const time = $derived(formatBerlinDateTime(comment.created));
	const edited = $derived(comment.updated > comment.created);
	const own = $derived(store.isOwn(comment));
	const editing = $derived(store.isEditing(comment.id));
	const busy = $derived(store.isBusy(comment.id));
	const error = $derived(store.commentError(comment.id));
	/** Names the comment for screen readers on its buttons ("Bearbeiten: Kommentar von Du …"). */
	const context = $derived(`Kommentar von ${author} vom ${time}`);
	const pinOffered = $derived(pin !== null && pin.pinnedComment !== undefined);
	const pinBusy = $derived(pin?.pinning === comment.id);
	const pinLocked = $derived((pin?.pinning ?? null) !== null);
	const pinError = $derived(pin?.pinError(comment.id) ?? null);

	async function startEdit() {
		store.startEdit(comment.id);
		await tick();
		editText?.focus();
	}

	async function endEdit(save: boolean) {
		if (save) {
			editText?.flush();
			if (!(await store.saveEdit(comment.id))) return;
		} else {
			store.cancelEdit(comment.id);
		}
		await tick();
		editButton?.focus();
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

	function togglePin() {
		if (pin === null || pinLocked) return;
		void (pinned ? pin.unpin() : pin.pin(comment.id));
	}
</script>

<li class="comment" class:pinned>
	<article aria-label={context} tabindex="-1" data-comment-id={comment.id}>
		<header class="head">
			<span class="author">{author}</span>
			<span class="time">{time}</span>
			{#if edited}
				<span class="edited" title={`Bearbeitet am ${formatBerlinDateTime(comment.updated)}`}
					>bearbeitet</span
				>
			{/if}
			{#if pinned}
				<Lozenge label="Angepinnt" icon="pin" tone="brand" />
			{/if}
			{#if !editing && (own || pinOffered)}
				<span class="actions">
					{#if pinOffered}
						<button
							class="button-secondary button-small"
							type="button"
							aria-disabled={pinLocked ? 'true' : undefined}
							aria-busy={pinBusy ? 'true' : undefined}
							aria-describedby={pinError ? pinErrorId : undefined}
							onclick={togglePin}
						>
							{pinned ? 'Lösen' : 'Anpinnen'}<span class="visually-hidden">: {context}</span>
						</button>
					{/if}
					{#if own}
						<button
							class="button-secondary button-small"
							type="button"
							bind:this={editButton}
							onclick={startEdit}
						>
							Bearbeiten<span class="visually-hidden">: {context}</span>
						</button>
						<button
							class="button-secondary button-small"
							type="button"
							aria-disabled={busy}
							onclick={remove}
						>
							Löschen<span class="visually-hidden">: {context}</span>
						</button>
					{/if}
				</span>
			{/if}
		</header>

		{#if editing}
			<RichTextEditor
				bind:this={editText}
				label="Kommentar bearbeiten"
				compact
				maxlength={COMMENT_MAX_LENGTH}
				bind:value={() => store.editValue(comment.id), (value) => store.setEdit(comment.id, value)}
				invalid={error !== null}
				describedby={error ? errorId : undefined}
				onsubmit={() => void endEdit(true)}
			/>
			{#if error}
				<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
			{/if}
			<div class="buttons">
				<button
					class="button-primary button-small"
					type="button"
					disabled={busy}
					aria-busy={busy ? 'true' : undefined}
					onclick={() => endEdit(true)}
				>
					{busy ? 'Wird gespeichert …' : 'Speichern'}
				</button>
				<button class="button-secondary button-small" type="button" onclick={() => endEdit(false)}
					>Abbrechen</button
				>
			</div>
		{:else}
			<CommentBody
				source={comment.body}
				ontoggletask={own
					? (index, checked) => store.toggleTask(comment.id, index, checked)
					: undefined}
				taskHint={busy ? 'Der Kommentar wird gerade gespeichert.' : null}
				expanded={view.isExpanded(comment.id)}
				onexpandedchange={(expanded) => view.setExpanded(comment.id, expanded)}
				name={context}
			/>
			{#if error}
				<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
			{/if}
		{/if}
		{#if pinError}
			<p class="field-error" id={pinErrorId}><ErrorIcon /><span>{pinError}</span></p>
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

	/* The pinned comment stands out by its label and a line in the accent, not by colour alone. */
	.pinned {
		padding-left: 0.625rem;
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	article {
		display: grid;
		gap: 0.375rem;
	}

	article:focus {
		outline: none;
	}

	article:focus-visible {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
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
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-left: auto;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
