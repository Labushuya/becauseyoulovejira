<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { colorOf, inheritLabel, projectColorOf } from '$lib/domain/colors';
	import type { Ticket } from '$lib/domain/ticket';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import CharmPicker from './CharmPicker.svelte';
	import ColorChoice from './ColorChoice.svelte';
	import DueInput from './DueInput.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import TagPicker from './TagPicker.svelte';
	import TicketCompletionQuestion from './TicketCompletionQuestion.svelte';
	import TicketReopenQuestion from './TicketReopenQuestion.svelte';
	import type { CompletionChoice } from '$lib/domain/subtasks';

	// Fields of a ticket (E2 plan, package 7; E3 plan, T-13 and T-14), shared by the side panel and
	// the full view (ADR-0025 section 7): status, priority, due date, project and tags, each saving
	// at once, with the field errors of the server at their field. Project and tags come from the
	// catalog; a new tag is taken from the catalog, which reuses an existing name. The row
	// "Übergeordnet" of sub-tasks (ADR-0033) comes in through `parentRow` as two cells of the grid.
	// The own color (ADR-0052) after the project, "Wie Projekt (Blau)" first, saves at once like the
	// project; only when the server knows the field. The charm (ADR-0062) after it, chosen in its
	// dialog and saved at once as well. The switch "Laufendes Vorhaben" (ADR-0065) after the charm:
	// the kind decides what the check mark of the day plan means; it saves at once, a refusal sets the
	// switch back and stands below it.
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
		color: `${uid}-color`,
		tags: `${uid}-tags`,
		kindHint: `${uid}-kind-hint`
	};
	const errorIdOf = (field: string) => `${uid}-${field}-error`;

	const ticketTags = $derived(catalog.tagsOf(ticket));
	/** The color without an own one: of the project, else of its parent (ADR-0052). */
	const inherited = $derived(projectColorOf(catalog.projectOf(ticket))?.color ?? null);
	/** Only when the server knows the field (it answers with it after the migration). */
	const colorShown = $derived(catalog.colorsReady && ticket.color !== undefined);
	/** The charm (ADR-0062) likewise: the ticket has the field only after its migration. */
	const charmShown = $derived(ticket.charm !== undefined);
	/** The kind (ADR-0065) likewise. */
	const kindShown = $derived(ticket.kind !== undefined);
	const ongoing = $derived(store.value('kind') === 'ongoing');

	/** The switch "Laufendes Vorhaben": saves at once; a refusal sets it back. */
	async function toggleKind(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		await store.choose('kind', input.checked ? 'ongoing' : 'task');
		input.checked = store.value('kind') === 'ongoing';
	}

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

	/** After a refused reopening (ADR-0023 addendum 4) the focus goes back to the status. */
	async function endReopen(detach: boolean) {
		if (detach) await store.reopenDetached();
		else store.cancelReopen();
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
		{#if store.reopenQuestion}
			<TicketReopenQuestion
				question={store.reopenQuestion}
				busy={store.isSaving('status')}
				onconfirm={() => void endReopen(true)}
				oncancel={() => void endReopen(false)}
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

	{#if colorShown}
		<span class="term" id={ids.color}>Farbe</span>
		<div class="control">
			<ColorChoice
				value={colorOf(store.value('color'))}
				inheritLabel={inheritLabel('ticket', inherited)}
				{inherited}
				labelledby={ids.color}
				busy={store.isSaving('color')}
				error={store.fieldError('color')}
				errorId={errorIdOf('color')}
				onchoose={(value) => store.choose('color', value ?? '')}
			/>
		</div>
	{/if}

	{#if charmShown}
		<span class="term">Charm</span>
		<div class="control">
			<CharmPicker
				value={store.value('charm') || null}
				busy={store.isSaving('charm')}
				error={store.fieldError('charm')}
				errorId={errorIdOf('charm')}
				onchoose={(value) => store.choose('charm', value ?? '')}
			/>
		</div>
	{/if}

	{#if kindShown}
		<span class="term">Art</span>
		<div class="control">
			<label class="switch-row">
				<span>Laufendes Vorhaben</span>
				<input
					type="checkbox"
					role="switch"
					checked={ongoing}
					aria-busy={store.isSaving('kind') ? 'true' : undefined}
					aria-invalid={store.fieldError('kind') ? 'true' : undefined}
					aria-describedby={store.fieldError('kind')
						? `${ids.kindHint} ${errorIdOf('kind')}`
						: ids.kindHint}
					onchange={toggleKind}
				/>
			</label>
			<p class="hint" id={ids.kindHint}>
				{ongoing
					? 'Im Tagesplan heißt der Haken „für heute erledigt“; das Ticket bleibt offen.'
					: 'Im Tagesplan erledigt der Haken dieses Ticket.'}
			</p>
			{#if store.fieldError('kind')}
				<p class="field-error" id={errorIdOf('kind')}>
					<ErrorIcon /><span>{store.fieldError('kind')}</span>
				</p>
			{/if}
		</div>
	{/if}

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
	}

	/* The switch "Laufendes Vorhaben" (ADR-0065): name left, switch right (ADR-0029 G-5). */
	.fields .switch-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		color: var(--color-text);
		cursor: pointer;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
