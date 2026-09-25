<script lang="ts">
	import { tick } from 'svelte';
	import { DESCRIPTION_MAX_LENGTH, type Ticket } from '$lib/domain/ticket';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Markdown from './Markdown.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';

	// Description of a ticket (E2 plan, package 7), shared by the side panel and the full view
	// (ADR-0025 section 7): sanitised Markdown with "Bearbeiten", an editor with preview, "Speichern"
	// (Ctrl+Enter) and "Abbrechen". The draft lives in the store, so it survives the change between
	// panel and full view; the focus moves into the editor and back to "Bearbeiten".
	let { store, ticket }: { store: TicketDetailStore; ticket: Ticket } = $props();

	const uid = $props.id();
	const titleId = `${uid}-description-title`;
	const errorId = `${uid}-description-error`;

	let editButton = $state<HTMLButtonElement>();
	let editor = $state<HTMLTextAreaElement>();

	const editing = $derived(store.isEditing('description'));
	const error = $derived(store.fieldError('description'));

	async function edit() {
		store.edit('description');
		await tick();
		editor?.focus();
	}

	async function end(save: boolean) {
		if (save) {
			if (!(await store.save('description'))) return;
		} else {
			store.cancel('description');
		}
		await tick();
		editButton?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void end(true);
		}
	}
</script>

<section class="description" aria-labelledby={titleId}>
	<div class="section-head">
		<h3 id={titleId}>Beschreibung</h3>
		{#if !editing}
			<button class="small" type="button" bind:this={editButton} onclick={edit}>
				Bearbeiten<span class="visually-hidden">: Beschreibung</span>
			</button>
		{/if}
	</div>
	{#if editing}
		<MarkdownEditor
			label="Beschreibung (Markdown)"
			maxlength={DESCRIPTION_MAX_LENGTH}
			bind:value={() => store.value('description'), (value) => store.setDraft('description', value)}
			bind:textarea={editor}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? errorId : undefined}
			{onkeydown}
		/>
		{#if error}
			<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
		{/if}
		<div class="buttons">
			<button
				class="button-primary small-primary"
				type="button"
				disabled={store.isSaving('description')}
				onclick={() => end(true)}
			>
				{store.isSaving('description') ? 'Wird gespeichert …' : 'Speichern'}
			</button>
			<button class="small" type="button" onclick={() => end(false)}>Abbrechen</button>
		</div>
	{:else if ticket.description.trim() !== ''}
		<Markdown source={ticket.description} />
	{:else}
		<p class="muted">Keine Beschreibung.</p>
	{/if}
</section>

<style>
	.description {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
	}

	.section-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.small {
		padding: 0.125rem 0.625rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.small-primary {
		padding: 0.25rem 0.75rem;
		font-size: 0.8125rem;
	}

	.muted {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}
</style>
