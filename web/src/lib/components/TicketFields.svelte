<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { colorOf, inheritLabel, projectColorOf } from '$lib/domain/colors';
	import { NOBODY_LABEL, assigneeName } from '$lib/domain/assignee';
	import { overdueSinceText } from '$lib/domain/due-label';
	import { PRIORITY_LABELS } from '$lib/domain/labels';
	import { OFFLINE_TEXTS } from '$lib/domain/offline';
	import type { OngoingFinishQuestion } from '$lib/domain/ongoing-finish';
	import { projectChoiceLabel } from '$lib/domain/project-tree';
	import { REOPEN_STATUS, type Ticket } from '$lib/domain/ticket';
	import { insideModal } from '$lib/overlay/modal-context';
	import { findAssignees, type AssigneeSource } from '$lib/stores/assignees.svelte';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { OngoingFinishAsk } from '$lib/stores/ongoing-finish.svelte';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import AssigneeField from './AssigneeField.svelte';
	import CharmPicker from './CharmPicker.svelte';
	import ColorChoice from './ColorChoice.svelte';
	import DoneToggle from './DoneToggle.svelte';
	import DueInput from './DueInput.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import KindSwitch from './KindSwitch.svelte';
	import LockedControl from './offline/LockedControl.svelte';
	import OngoingFinishDialog from './OngoingFinishDialog.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProblemDetails from './problems/ProblemDetails.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import TagPicker from './TagPicker.svelte';
	import TicketCompletionQuestion from './TicketCompletionQuestion.svelte';
	import TicketReopenQuestion from './TicketReopenQuestion.svelte';
	import type { CompletionChoice } from '$lib/domain/subtasks';

	// Fields of a ticket (E2 plan, package 7; E3 plan, T-13 and T-14), shared by the side panel and
	// the full view (ADR-0025 section 7): status, priority, due date, project and tags, each saving
	// at once, with the field errors of the server at their field (a failed save with its "Details",
	// FP-1, ADR-0071). Project and tags come from the catalog; a new tag is taken from the catalog,
	// which reuses an existing name. The row
	// "Übergeordnet" of sub-tasks (ADR-0033) comes in through `parentRow` as two cells of the grid.
	// The own color (ADR-0052) after the project, "Wie Projekt (Blau)" first, saves at once like the
	// project; only when the server knows the field. The charm (ADR-0062) after it, chosen in its
	// dialog and saved at once as well. The switch "Laufendes Vorhaben" (ADR-0065) after the charm:
	// the kind decides what the check mark of the day plan means; it saves at once, a refusal sets the
	// switch back and stands below it. Below the due date an open overdue ticket says since when, in
	// the words of the list and the day plan, "überfällig seit 05.10." (WH-1). "Zuständig" (ADR-0068)
	// after the priority, only at a ticket of the household and only when the server knows the field:
	// "Niemand" or a member, saved at once, with "Ich übernehme". Every option carries its key of the
	// registry domain/ticket-options.ts at its control (`data-ticket-option`): "Neues Ticket" offers
	// the same options (NT-1, ADR-0069, parity test ticket-options-parity.test.ts). The status
	// "Erledigt" of an open ongoing project asks "Vorhaben abschließen?" first, the question of the
	// day plan (VH-1): in the panel as a confirmation, in the full view inline below the status.
	// The inline questions of the status (open sub-tasks, "Vorhaben abschließen?" in the full view,
	// a refused reopening) stand in a row of their own right after the status, over both columns
	// of the grid (QB-1, ADR-0025 addendum 19): in the value column of the narrow right column of the
	// full view only about 120 px were left. The order in the DOM, and so the tab order, stays.
	// In the phone frame (MO-4, ADR-0073 addendum MO-4) the panel shows the fields in two parts: the
	// page holds every field but the status, one below the other with the label above its value
	// (`part` "fields"); the fixed bar at its bottom holds "Erledigt" (one tap, the check mark of the
	// list) and the status with its questions above them (`part` "bar"). The status is the same
	// control with the same marker, so no option is new; on the PC and in the full view everything
	// stays one grid (`part` "all"). A ticket "＋" created that the server does not have yet (OF-4a
	// round 2, A6) shows priority, "Zuständig", project and tags locked with the reason ("gesperrt
	// statt weg"); status and due date stay editable.
	let {
		store,
		catalog,
		ticket,
		today,
		recurrenceShown = false,
		parentRow,
		assignees = findAssignees(),
		part = 'all'
	}: {
		store: TicketDetailStore;
		catalog: CatalogStore;
		ticket: Ticket;
		/**
		 * Which part: everything (PC, full view), the fields without the status (the page of the
		 * phone frame) or the bar with "Erledigt" and the status (its fixed footer).
		 */
		part?: 'all' | 'fields' | 'bar';
		/** The Berlin day of the list store; without it no line "überfällig seit …". */
		today?: CalendarDate;
		/** The recurrence of the ticket is shown elsewhere; otherwise a plain line says so. */
		recurrenceShown?: boolean;
		/** Row "Übergeordnet" (TicketParentField) after the tags. */
		parentRow?: Snippet;
		/** The members and names of the household (the directory of the layout). */
		assignees?: AssigneeSource | null;
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
		overdue: `${uid}-overdue`,
		assignee: `${uid}-assignee`
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
	/**
	 * "Zuständig" (ADR-0068): only at a ticket of the household, once the server knows the field and
	 * the members are known; a private ticket has none.
	 */
	const assigneeShown = $derived(
		ticket.assignee !== undefined &&
			(ticket.scope ?? '').startsWith('h:') &&
			assignees !== null &&
			assignees.members.length > 0
	);
	const ongoing = $derived(store.value('kind') === 'ongoing');
	/** Why the fields that need the server are locked: a ticket "＋" created (OF-4a round 2). */
	const locked = $derived(store.created ? OFFLINE_TEXTS.createdLocked : null);
	/** "überfällig seit 05.10." for an open ticket due before today (the saved due date), else null. */
	const overdueSince = $derived(
		today !== undefined && ticket.status !== 'done' && ticket.due !== null && ticket.due < today
			? overdueSinceText(ticket.due, today)
			: null
	);

	/** New tag from the picker: an existing one in another spelling or a new one, then assigned. */
	async function createTag(name: string): Promise<boolean> {
		const result = await catalog.ensureTag(name);
		if (!result.ok) {
			if (result.message !== null) store.reject('tags', result.message);
			return false;
		}
		return store.addTag(result.tag.id);
	}

	/** "Vorhaben abschließen?" before the status completes an ongoing project (VH-1). */
	const finishing = new OngoingFinishAsk();
	/** In a modal (the full view) it stands inline; in the panel it is a dialog of its own. */
	const finishInline = insideModal();
	/** A question stands inline below the status: its row over both columns is shown (QB-1). */
	const questionShown = $derived(
		(finishInline && finishing.question !== null) ||
			store.completionQuestion !== null ||
			store.reopenQuestion !== null
	);

	/** A status of the select; "Erledigt" of an open ongoing project asks first. */
	function chooseStatus(value: string) {
		if (value !== 'done') return void store.choose('status', value);
		void finishing.run([{ ...ticket, kind: store.value('kind') }], () =>
			store.choose('status', value)
		);
	}

	/** "Erledigt" of the bar (phone frame): done like the status "Erledigt", or open again. */
	function toggleDone(done: boolean) {
		chooseStatus(done ? 'done' : REOPEN_STATUS);
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
		<!-- A failed save, not a hint at the input, gets its "Details" (FP-1, ADR-0071). -->
		<ProblemDetails problem={store.fieldProblem(field)} />
	{/if}
{/snippet}

{#snippet finishQuestion(question: OngoingFinishQuestion)}
	<OngoingFinishDialog
		{question}
		onconfirm={() => finishing.accept()}
		oncancel={() => finishing.cancel()}
	/>
{/snippet}

{#snippet statusControl()}
	<div class="control" data-ticket-option="status">
		<StatusSelect
			id={ids.status}
			value={store.value('status')}
			busy={store.isSaving('status')}
			error={store.fieldError('status')}
			errorId={errorIdOf('status')}
			onchoose={chooseStatus}
		/>
		{@render fieldError('status')}
	</div>
	{#if finishing.question && !finishInline}
		<!-- The panel: a dialog of its own in the top layer, outside the flow of the grid. -->
		{@render finishQuestion(finishing.question)}
	{/if}
{/snippet}

{#snippet statusQuestions()}
	{#if questionShown}
		<!-- The questions of the status in a row of their own over both columns (QB-1). -->
		<div class="questions" data-status-questions>
			{#if finishing.question && finishInline}
				{@render finishQuestion(finishing.question)}
			{/if}
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
	{/if}
{/snippet}

{#if part === 'bar'}
	<!-- The fixed bar of the page (phone frame, MO-4): the questions above, then the controls. -->
	<div class="bar" data-ticket-bar>
		{@render statusQuestions()}
		<div class="bar-row">
			<!-- One tap anywhere in the target of 44 px; the name stays the one of the check mark. -->
			<label class="done-check">
				<DoneToggle
					key={ticket.key}
					checked={store.value('status') === 'done'}
					pending={store.isSaving('status')}
					onchange={toggleDone}
				/>
				<span aria-hidden="true">Erledigt</span>
			</label>
			<label class="bar-label" for={ids.status}>Status</label>
			{@render statusControl()}
		</div>
	</div>
{:else}
	<div class="fields">
		{#if part === 'all'}
			<label for={ids.status}>Status</label>
			{@render statusControl()}
			{@render statusQuestions()}
		{/if}

		<label for={ids.priority}>Priorität</label>
		<div class="control" data-ticket-option="priority">
			{#if locked !== null}
				<LockedControl
					id={ids.priority}
					label="Priorität"
					value={PRIORITY_LABELS[ticket.priority]}
					reason={locked}
				/>
			{:else}
				<PrioritySelect
					id={ids.priority}
					value={store.value('priority')}
					busy={store.isSaving('priority')}
					error={store.fieldError('priority')}
					errorId={errorIdOf('priority')}
					onchoose={(value) => store.choose('priority', value)}
				/>
			{/if}
			{@render fieldError('priority')}
		</div>

		{#if assigneeShown && assignees}
			<label for={ids.assignee}>Zuständig</label>
			<div class="control" data-ticket-option="assignee">
				{#if locked !== null}
					<LockedControl
						id={ids.assignee}
						label="Zuständig"
						value={ticket.assignee
							? assigneeName(ticket.assignee, assignees.context)
							: NOBODY_LABEL}
						reason={locked}
					/>
				{:else}
					<AssigneeField
						id={ids.assignee}
						value={store.value('assignee')}
						members={assignees.members}
						context={assignees.context}
						busy={store.isSaving('assignee')}
						error={store.fieldError('assignee')}
						errorId={errorIdOf('assignee')}
						onchoose={(value) => store.choose('assignee', value)}
					/>
				{/if}
				<ProblemDetails problem={store.fieldProblem('assignee')} />
			</div>
		{/if}

		<label for={ids.due}>Fälligkeit</label>
		<div class="control" data-ticket-option="due">
			<DueInput
				id={ids.due}
				value={store.value('due')}
				saving={store.isSaving('due')}
				error={store.fieldError('due')}
				errorId={errorIdOf('due')}
				hintId={overdueSince === null ? undefined : ids.overdue}
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
			{#if overdueSince !== null}
				<!-- Bold in text colour with the clock of the list, never red (ADR-0009). -->
				<p class="overdue" id={ids.overdue}>
					<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
						<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
						<path
							d="M8 4.75V8.5l2.25 1.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
					<span>{overdueSince}</span>
				</p>
			{/if}
			{@render fieldError('due')}
		</div>

		<label for={ids.project}>Projekt</label>
		<div class="control" data-ticket-option="project">
			{#if locked !== null}
				{@const project = catalog.projectOf(ticket)}
				<LockedControl
					id={ids.project}
					label="Projekt"
					value={project ? projectChoiceLabel(project) : 'kein Projekt'}
					reason={locked}
				/>
			{:else}
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
			{/if}
			{@render fieldError('project')}
		</div>

		{#if colorShown}
			<span class="term" id={ids.color}>Farbe</span>
			<div class="control" data-ticket-option="color">
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
				<ProblemDetails problem={store.fieldProblem('color')} />
			</div>
		{/if}

		{#if charmShown}
			<span class="term">Charm</span>
			<div class="control" data-ticket-option="charm">
				<CharmPicker
					value={store.value('charm') || null}
					busy={store.isSaving('charm')}
					error={store.fieldError('charm')}
					errorId={errorIdOf('charm')}
					onchoose={(value) => store.choose('charm', value ?? '')}
				/>
				<ProblemDetails problem={store.fieldProblem('charm')} />
			</div>
		{/if}

		{#if kindShown}
			<span class="term">Art</span>
			<div class="control" data-ticket-option="kind">
				<!-- Saves at once; a refusal sets the switch back and stands below it. -->
				<KindSwitch
					{ongoing}
					busy={store.isSaving('kind')}
					error={store.fieldError('kind')}
					onchange={(wanted) => store.choose('kind', wanted ? 'ongoing' : 'task')}
				/>
				<ProblemDetails problem={store.fieldProblem('kind')} />
			</div>
		{/if}

		<label for={ids.tags}>Tags</label>
		<div class="control" data-ticket-option="tags">
			{#if locked !== null}
				<LockedControl
					id={ids.tags}
					label="Tags"
					value={ticketTags.length === 0 ? 'keine' : ticketTags.map((tag) => tag.name).join(', ')}
					reason={locked}
				/>
			{:else}
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
			{/if}
			{@render fieldError('tags')}
		</div>
		{@render parentRow?.()}
		{#if ticket.recurring && !recurrenceShown}
			<span class="term">Wiederholung</span>
			<span class="detail">wiederkehrend</span>
		{/if}
	</div>
{/if}

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

	/* The questions of the status: a row of their own over both columns of the grid (QB-1). */
	.questions {
		display: grid;
		grid-column: 1 / -1;
		gap: 0.5rem;
		min-width: 0;
	}

	.fields :global(select),
	.fields :global(input[type='date']) {
		width: fit-content;
		max-width: 100%;
	}

	/* "überfällig seit 05.10." below the due date (WH-1): like the overdue label of the list. */
	.overdue {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		font-size: var(--font-size-small);
		font-weight: 600;
		color: var(--color-text);
	}

	/*
	 * Phone frame (MO-4, ADR-0073 addendum MO-4): one column, the label above its value, so every
	 * control has the whole width of the page (the colors in two columns, the tags, the picker of
	 * the parent). The bar at the bottom of the page: the questions of the status above, then
	 * "Erledigt" in a target of 44 px and the status.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .fields {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.25rem;
		}

		:global(:root[data-mobile-layout='on']) .fields > :global(:is(label, .term):not(:first-child)) {
			margin-top: 0.75rem;
		}

		:global(:root[data-mobile-layout='on']) .bar {
			display: grid;
			flex: 1 1 100%;
			gap: 0.5rem;
			min-width: 0;
			font-size: var(--font-size-body);
		}

		:global(:root[data-mobile-layout='on']) .bar .questions {
			max-height: 50dvh;
			overflow-y: auto;
		}

		:global(:root[data-mobile-layout='on']) .bar-row {
			display: flex;
			flex-wrap: wrap;
			gap: 0.25rem 0.75rem;
			align-items: center;
		}

		:global(:root[data-mobile-layout='on']) .done-check {
			display: inline-flex;
			gap: 0.5rem;
			align-items: center;
			min-height: var(--control-height-touch);
			padding-right: 0.25rem;
			font-weight: 600;
			cursor: pointer;
		}

		:global(:root[data-mobile-layout='on']) .bar-label {
			margin-left: auto;
			color: var(--color-text-muted);
		}

		:global(:root[data-mobile-layout='on']) .bar :global(select) {
			width: fit-content;
			max-width: 100%;
		}
	}
</style>
