<script lang="ts">
	import { tick } from 'svelte';
	import { DESCRIPTION_MAX_LENGTH, type Ticket } from '$lib/domain/ticket';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Markdown from './Markdown.svelte';
	import RichTextEditor from './RichTextEditor.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// Description of a ticket (E2 plan, package 7), shared by the side panel and the full view
	// (ADR-0025 section 7): sanitised Markdown with "Bearbeiten", the editor (since RT-3 the
	// WYSIWYG editor of ADR-0032 with "Markdown" as source mode), "Speichern" (Ctrl+Enter) and
	// "Abbrechen". The editor writes the draft only when the text changes, through the store, so
	// expected_updated and the question below apply as before. The draft lives in the store, so it
	// survives the change between panel and full view; the focus moves into the editor and back to
	// "Bearbeiten".
	// Tasks of the description can be ticked in the view (ADR-0032 section 6). If the description
	// changed while it was edited, saving asks inline instead of overwriting: "Überschreiben" or
	// "Verwerfen und neu laden". Inline and not as a confirmation, because the full view is a modal
	// and no dialog opens from a dialog (ADR-0025 section 3); the panel asks the same way.
	let { store, ticket }: { store: TicketDetailStore; ticket: Ticket } = $props();

	const uid = $props.id();
	const titleId = `${uid}-description-title`;
	const errorId = `${uid}-description-error`;
	const taskErrorId = `${uid}-task-error`;

	let editButton = $state<HTMLButtonElement>();
	let editor = $state<ReturnType<typeof RichTextEditor>>();
	/** Why ticking a task failed, for the ticket it happened on. */
	let taskError = $state<{ ticketId: string; message: string } | null>(null);

	const editing = $derived(store.isEditing('description'));
	const saving = $derived(store.isSaving('description'));
	const error = $derived(store.fieldError('description'));
	const conflict = $derived(editing && store.descriptionConflict);
	const shownTaskError = $derived(
		taskError !== null && taskError.ticketId === ticket.id ? taskError.message : null
	);

	async function edit() {
		taskError = null;
		store.edit('description');
		await tick();
		editor?.focus();
	}

	async function end(save: boolean) {
		if (save) {
			editor?.flush();
			if (!(await store.save('description'))) return;
		} else {
			store.cancel('description');
		}
		await tick();
		editButton?.focus();
	}

	async function overwrite() {
		if (!(await store.overwriteDescription())) return;
		await tick();
		editButton?.focus();
	}

	async function discard() {
		await store.discardDescription();
		await tick();
		editButton?.focus();
	}

	async function toggleTask(index: number, checked: boolean): Promise<boolean> {
		const ticketId = ticket.id;
		const result = await store.toggleTask(index, checked);
		taskError = result.ok || result.message === null ? null : { ticketId, message: result.message };
		return result.ok;
	}
</script>

<section class="description" aria-labelledby={titleId}>
	<div class="section-head">
		<h3 id={titleId}>Beschreibung</h3>
		{#if !editing}
			<button
				class="button-secondary button-small"
				type="button"
				bind:this={editButton}
				onclick={edit}
			>
				Bearbeiten<span class="visually-hidden">: Beschreibung</span>
			</button>
		{/if}
	</div>
	{#if editing}
		<RichTextEditor
			bind:this={editor}
			label="Beschreibung"
			maxlength={DESCRIPTION_MAX_LENGTH}
			placeholder="Beschreibung eingeben …"
			bind:value={() => store.value('description'), (value) => store.setDraft('description', value)}
			invalid={error !== null}
			describedby={error ? errorId : undefined}
			onsubmit={() => void end(true)}
		/>
		{#if error}
			<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
		{/if}
		{#if conflict}
			<SectionMessage
				tone="warning"
				title="Die Beschreibung wurde inzwischen geändert."
				headingLevel={4}
				live
			>
				<p>
					„Überschreiben“ speichert deinen Text anstelle der neuen Fassung. „Verwerfen und neu
					laden“ zeigt die neue Fassung; dein Text geht dabei verloren.
				</p>
				{#snippet actions()}
					<button
						class="button-secondary"
						type="button"
						disabled={saving}
						aria-busy={saving ? 'true' : undefined}
						onclick={overwrite}
					>
						{saving ? 'Wird gespeichert …' : 'Überschreiben'}
					</button>
					<button class="button-subtle" type="button" disabled={saving} onclick={discard}>
						Verwerfen und neu laden
					</button>
				{/snippet}
			</SectionMessage>
		{:else}
			<div class="buttons">
				<button
					class="button-primary button-small"
					type="button"
					disabled={saving}
					aria-busy={saving ? 'true' : undefined}
					onclick={() => end(true)}
				>
					{saving ? 'Wird gespeichert …' : 'Speichern'}
				</button>
				<button class="button-secondary button-small" type="button" onclick={() => end(false)}
					>Abbrechen</button
				>
			</div>
		{/if}
	{:else if ticket.description.trim() !== ''}
		<Markdown
			source={ticket.description}
			ontoggletask={toggleTask}
			taskHint={saving ? 'Die Beschreibung wird gerade gespeichert.' : null}
		/>
		{#if shownTaskError !== null}
			<p class="field-error" id={taskErrorId} role="alert">
				<ErrorIcon /><span>{shownTaskError}</span>
			</p>
		{/if}
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
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.muted {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}
</style>
