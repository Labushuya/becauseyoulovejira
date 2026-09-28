<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { Ticket } from '$lib/domain/ticket';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import DueInput from './DueInput.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import TagPicker from './TagPicker.svelte';
	import TicketCompletionQuestion from './TicketCompletionQuestion.svelte';
	import type { CompletionChoice } from '$lib/domain/subtasks';

	// Fields of a ticket (E2 plan, package 7; E3 plan, T-13 and T-14), shared by the side panel and
	// the full view (ADR-0025 section 7): status, priority, due date, project and tags, each saving
	// at once, with the field errors of the server at their field. Project and tags come from the
	// catalog; a new tag is taken from the catalog, which reuses an existing name. The row
	// "Übergeordnet" of sub-tasks (ADR-0033) comes in through `parentRow` as two cells of the grid.
	let {
		store,
		catalog,
		ticket,
		recurrenceShown = false,
		parentRow
	}: {
		store: TicketDetailStore;
		catalog: CatalogStore;
		ticket: Ticket;
		/** The recurrence of the ticket is shown elsewhere; otherwise a plain line says so. */
		recurrenceShown?: boolean;
		/** Row "Übergeordnet" (TicketParentField) after the tags. */
		parentRow?: Snippet;
	} = $props();

	const uid = $props.id();
	const ids = {
		status: `${uid}-status`,
		priority: `${uid}-priority`,
		due: `${uid}-due`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		tags: `${uid}-tags`
	};
	const errorIdOf = (field: string) => `${uid}-${field}-error`;

	const ticketTags = $derived(catalog.tagsOf(ticket));

	/** New tag from the picker: an existing one in another spelling or a new one, then assigned. */
	async function createTag(name: string): Promise<boolean> {
		const result = await catalog.ensureTag(name);
		if (!result.ok) {
			if (result.message !== null) store.reject('tags', result.message);
			return false;
		}
		return store.addTag(result.tag.id);
	}

	/** After the question about open sub-tasks the focus goes back to the status (ADR-0033). */
	async function endCompletion(choice: CompletionChoice | null) {
		if (choice === null) store.cancelCompletion();
		else await store.confirmCompletion(choice);
		await tick();
		document.getElementById(ids.status)?.focus();
	}
</script>

{#snippet fieldError(field: 'status' | 'priority' | 'due' | 'project' | 'tags')}
	{@const error = store.fieldError(field)}
	{#if error}
		<p class="field-error" id={errorIdOf(field)}><ErrorIcon /><span>{error}</span></p>
	{/if}
{/snippet}

<div class="fields">
	<label for={ids.status}>Status</label>
	<div class="control">
		<StatusSelect
			id={ids.status}
			value={store.value('status')}
			busy={store.isSaving('status')}
			error={store.fieldError('status')}
			errorId={errorIdOf('status')}
			onchoose={(value) => store.choose('status', value)}
		/>
		{@render fieldError('status')}
		{#if store.completionQuestion}
			<TicketCompletionQuestion
				question={store.completionQuestion}
				busy={store.isSaving('status')}
				onconfirm={(choice) => void endCompletion(choice)}
				oncancel={() => void endCompletion(null)}
			/>
		{/if}
	</div>

	<label for={ids.priority}>Priorität</label>
	<div class="control">
		<PrioritySelect
			id={ids.priority}
			value={store.value('priority')}
			busy={store.isSaving('priority')}
			error={store.fieldError('priority')}
			errorId={errorIdOf('priority')}
			onchoose={(value) => store.choose('priority', value)}
		/>
		{@render fieldError('priority')}
	</div>

	<label for={ids.due}>Fälligkeit</label>
	<div class="control">
		<DueInput
			id={ids.due}
			value={store.value('due')}
			saving={store.isSaving('due')}
			error={store.fieldError('due')}
			errorId={errorIdOf('due')}
			onedit={() => store.edit('due')}
			oninput={(value) => store.setDraft('due', value)}
			onsave={() => store.save('due')}
			oncancel={() => store.cancel('due')}
			onreject={() => store.reject('due', 'Ungültiges Datum.')}
			onclear={() => {
				store.edit('due');
				store.setDraft('due', '');
				void store.save('due');
			}}
		/>
		{@render fieldError('due')}
	</div>

	<label for={ids.project}>Projekt</label>
	<div class="control">
		<ProjectSelect
			id={ids.project}
			value={store.value('project')}
			projects={catalog.activeProjects}
			current={catalog.projectOf(ticket)}
			busy={store.isSaving('project')}
			error={store.fieldError('project')}
			errorId={errorIdOf('project')}
			hintId={ids.projectHint}
			onchoose={(value) => store.choose('project', value)}
		/>
		{@render fieldError('project')}
	</div>

	<label for={ids.tags}>Tags</label>
	<div class="control">
		<TagPicker
			id={ids.tags}
			selected={ticketTags}
			tags={catalog.tags}
			bind:text={() => store.tagInput, (text) => store.setTagInput(text)}
			busy={store.isSaving('tags')}
			error={store.fieldError('tags')}
			errorId={errorIdOf('tags')}
			onadd={(tagId) => store.addTag(tagId)}
			onremove={(tagId) => store.removeTag(tagId)}
			oncreate={createTag}
		/>
		{@render fieldError('tags')}
	</div>
	{@render parentRow?.()}
	{#if ticket.recurring && !recurrenceShown}
		<span class="term">Wiederholung</span>
		<span class="detail">wiederkehrend</span>
	{/if}
</div>

<style>
	.fields {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.625rem 1rem;
		align-items: baseline;
		font-size: var(--font-size-body);
	}

	.fields label,
	.term {
		color: var(--color-text-muted);
	}

	.control {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.fields :global(select),
	.fields :global(input[type='date']) {
		width: fit-content;
		max-width: 100%;
		padding: 0.25rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}
</style>
