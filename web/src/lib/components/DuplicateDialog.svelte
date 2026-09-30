<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		copySourceHint,
		duplicateFormErrors,
		duplicateRequestOf,
		initialDuplicateForm,
		type DuplicateField,
		type DuplicateForm
	} from '$lib/domain/duplicate';
	import { formatCalendarDate } from '$lib/domain/format';
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { PRIORITY_LABELS } from '$lib/domain/labels';
	import { projectPath } from '$lib/domain/project-tree';
	import type { ProjectRef, Ticket } from '$lib/domain/ticket';
	import { insideModal } from '$lib/overlay/modal-context';
	import type { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import InitialStatusChoice from './InitialStatusChoice.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';
	import ProjectSelect from './ProjectSelect.svelte';

	// "Wie soll das Duplikat entstehen?" (ADR-0045 §2): title with "(Kopie)", what the duplicate
	// takes over (the fields of the ticket checked, sub-tasks and comments not; the project with
	// ProjectSelect), the status as a required choice without an answer in advance (the building
	// block of "Folgetickets starten mit") and, when the original has sources, whether the duplicate
	// gets a copy of its main source. A series never comes along; the dialog says so. In the side
	// panel a modal M; inside a modal (the full view) the same form stands inline (InlineDialog,
	// ADR-0025 addendum 16). Errors of the server stand at their field, anything else as a message;
	// after the duplicate exists the dialog closes and the owner opens it.
	let {
		ticket,
		projects,
		sources = [],
		commentCount = 0,
		subtaskCount = 0,
		parentKey = null,
		store,
		onopen,
		onclose,
		returnFocus
	}: {
		ticket: Ticket;
		/** Projects a ticket can join (the active ones, in tree order). */
		projects: readonly ProjectRef[];
		/** Sources of the ticket (inbox items with `ticket = <id>`), the main one among them. */
		sources?: readonly InboxItemSummary[];
		commentCount?: number;
		/** Sub-tasks of a parent ticket. */
		subtaskCount?: number;
		/** Key of the parent of a sub-task, null for a top-level ticket. */
		parentKey?: string | null;
		store: TicketDuplicateStore;
		/** Opens a ticket in the remembered way (the duplicate, or the original from the flag). */
		onopen: (ticketId: string) => void;
		/** Cancel, or after duplicating. */
		onclose: () => void;
		/** Inline only: where the focus goes on closing when the opener is gone. */
		returnFocus?: () => HTMLElement | null | undefined;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	const ids = {
		title: `${uid}-title`,
		titleError: `${uid}-title-error`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		projectError: `${uid}-project-error`,
		subtasks: `${uid}-subtasks-hint`,
		comments: `${uid}-comments-hint`,
		copy: `${uid}-copy-hint`,
		none: `${uid}-none-hint`,
		sourceError: `${uid}-source-error`
	};
	/** In the full view (a modal) the form stands inline instead of in a dialog of its own. */
	const inline = insideModal();

	let answers = $state<DuplicateForm>(
		untrack(() =>
			initialDuplicateForm(
				ticket,
				projects.map((project) => project.id)
			)
		)
	);
	let errors = $state<Partial<Record<DuplicateField, string>>>({});
	let message = $state<string | null>(null);
	let busy = $state(false);
	let formElement = $state<HTMLFormElement>();

	const mainSource = $derived(sources.find((item) => item.id === ticket.sourceItem) ?? null);
	const tagNames = $derived(ticket.tags.map((tag) => tag.name).join(', '));
	/** The project of the original cannot take tickets any more (archived): named in the hint. */
	const archivedProject = $derived(
		ticket.project !== null && !projects.some((project) => project.id === ticket.projectId)
			? ticket.project
			: null
	);
	const projectHint = $derived(
		archivedProject === null
			? 'Das Duplikat bekommt einen neuen Key im gewählten Projekt.'
			: `„${projectPath(archivedProject)}“ ist archiviert und nimmt keine Tickets auf; wähle ein anderes Projekt oder keins.`
	);
	/** A refusal of the source without the section (no sources known) goes to the message. */
	const sourceShown = $derived(sources.length > 0);

	async function focusFirstError() {
		await tick();
		formElement?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		message = null;
		errors = duplicateFormErrors(answers);
		const status = answers.status;
		if (Object.keys(errors).length > 0 || status === '') {
			await focusFirstError();
			return;
		}
		busy = true;
		try {
			const result = await store.duplicate(
				{ id: ticket.id, key: ticket.key },
				duplicateRequestOf({ ...answers, status }),
				onopen
			);
			if (result.ok) {
				onclose();
				onopen(result.outcome.id);
				return;
			}
			const { source, project, ...others } = result.fields;
			errors = {
				...others,
				...(source !== undefined && sourceShown ? { source } : {}),
				...(project !== undefined && answers.takeProject ? { project } : {})
			};
			const hidden = [
				source !== undefined && !sourceShown ? source : null,
				project !== undefined && !answers.takeProject ? project : null
			].find((text) => text !== null);
			message = result.message ?? hidden ?? null;
		} finally {
			busy = false;
		}
		await focusFirstError();
	}
</script>

{#snippet content()}
	<form id={formId} class="form" novalidate onsubmit={submit} bind:this={formElement}>
		<div class="field">
			<label for={ids.title}>Titel</label>
			<input
				id={ids.title}
				type="text"
				maxlength="200"
				autocomplete="off"
				bind:value={answers.title}
				aria-invalid={errors.title ? 'true' : undefined}
				aria-describedby={errors.title ? ids.titleError : undefined}
				oninput={() => (errors = { ...errors, title: undefined })}
			/>
			{#if errors.title}
				<p class="field-error" id={ids.titleError}><ErrorIcon /><span>{errors.title}</span></p>
			{/if}
		</div>

		<fieldset class="group">
			<legend>Übernehmen</legend>
			<label class="choice">
				<input type="checkbox" bind:checked={answers.take.description} />
				Beschreibung{ticket.description.trim() === '' ? ' (leer)' : ''}
			</label>
			<label class="choice">
				<input type="checkbox" bind:checked={answers.take.priority} />
				Priorität: {PRIORITY_LABELS[ticket.priority]}
			</label>
			<label class="choice">
				<input type="checkbox" bind:checked={answers.takeProject} />
				Projekt
			</label>
			{#if answers.takeProject}
				<div class="nested">
					<label class="visually-hidden" for={ids.project}>Projekt des Duplikats</label>
					<ProjectSelect
						id={ids.project}
						value={answers.project}
						{projects}
						error={errors.project ?? null}
						errorId={ids.projectError}
						hintId={ids.projectHint}
						hint={projectHint}
						onchoose={(value) => {
							answers.project = value;
							errors = { ...errors, project: undefined };
						}}
					/>
					{#if errors.project}
						<p class="field-error" id={ids.projectError}>
							<ErrorIcon /><span>{errors.project}</span>
						</p>
					{/if}
				</div>
			{/if}
			<label class="choice">
				<input type="checkbox" bind:checked={answers.take.tags} />
				Tags: {tagNames === '' ? 'keine' : tagNames}
			</label>
			<label class="choice">
				<input type="checkbox" bind:checked={answers.take.due} />
				Fälligkeit: {ticket.due === null ? 'keine' : formatCalendarDate(ticket.due)}
			</label>
			{#if parentKey !== null}
				<label class="choice">
					<input type="checkbox" bind:checked={answers.take.parent} />
					Unter {parentKey} einordnen
				</label>
			{/if}
			{#if subtaskCount > 0}
				<label class="choice">
					<input
						type="checkbox"
						bind:checked={answers.take.subtasks}
						aria-describedby={ids.subtasks}
					/>
					Unteraufgaben ({subtaskCount})
				</label>
				<p class="hint nested" id={ids.subtasks}>
					Als neue, offene Unteraufgaben mit derselben Auswahl; sie kommen in das Projekt des
					Duplikats.
				</p>
			{/if}
			{#if commentCount > 0}
				<label class="choice">
					<input
						type="checkbox"
						bind:checked={answers.take.comments}
						aria-describedby={ids.comments}
					/>
					Kommentare ({commentCount})
				</label>
				<p class="hint nested" id={ids.comments}>
					Als Kopien mit „Kopiert aus {ticket.key}“; Autor und Zeit bleiben, ein angepinnter bleibt
					angepinnt.
				</p>
			{/if}
		</fieldset>

		<InitialStatusChoice
			bind:value={
				() => answers.status,
				(chosen) => {
					answers.status = chosen;
					errors = { ...errors, status: undefined };
				}
			}
			ticketStatus={ticket.status}
			error={errors.status ?? null}
			legend="Status des Duplikats"
			hint="Das Duplikat beginnt mit diesem Status; „Erledigt“ gibt es hier nicht."
			like="das Original"
		/>

		{#if sourceShown}
			<fieldset
				class="group"
				role="radiogroup"
				aria-invalid={errors.source ? 'true' : undefined}
				aria-describedby={errors.source ? ids.sourceError : undefined}
				tabindex="-1"
			>
				<legend>Quelle</legend>
				<label class="choice">
					<input
						type="radio"
						name={`${uid}-source`}
						value="none"
						bind:group={answers.source}
						aria-describedby={ids.none}
					/>
					Keine Quelle
				</label>
				<p class="hint nested" id={ids.none}>
					Die Quellen bleiben beim Original; ein Eintrag im Eingang gehört immer zu genau einem
					Ticket.
				</p>
				<label class="choice">
					<input
						type="radio"
						name={`${uid}-source`}
						value="copy"
						bind:group={answers.source}
						disabled={mainSource === null}
						aria-describedby={ids.copy}
					/>
					Kopie der Herkunft übernehmen
				</label>
				<p class="hint nested" id={ids.copy}>{copySourceHint(mainSource, ticket.key)}</p>
				{#if errors.source}
					<p class="field-error" id={ids.sourceError}><ErrorIcon /><span>{errors.source}</span></p>
				{/if}
			</fieldset>
		{/if}

		{#if ticket.recurring}
			<SectionMessage tone="info" compact>
				{ticket.key} gehört zu einer Serie. Das Duplikat wird ein normales Ticket ohne Wiederholung.
			</SectionMessage>
		{/if}

		{#if message}
			<div class="alert-error" role="alert"><ErrorIcon /><span>{message}</span></div>
		{/if}
	</form>
{/snippet}

{#snippet buttons({ close }: { close: () => void })}
	<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
		Abbrechen
	</button>
	<button
		class="button-primary"
		type="submit"
		form={formId}
		aria-disabled={busy}
		aria-busy={busy ? 'true' : undefined}
	>
		{busy ? 'Wird dupliziert …' : 'Duplizieren'}
	</button>
{/snippet}

{#if inline}
	<InlineDialog
		open
		title={`${ticket.key} duplizieren`}
		{busy}
		{returnFocus}
		onclose={() => onclose()}
		footer={buttons}
	>
		{@render content()}
	</InlineDialog>
{:else}
	<Modal
		open
		size="m"
		title={`${ticket.key} duplizieren`}
		{busy}
		onclose={() => onclose()}
		footer={buttons}
	>
		{@render content()}
	</Modal>
{/if}

<style>
	.form {
		display: grid;
		gap: 0.875rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.field label,
	legend {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	.group {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		margin-bottom: 0.25rem;
	}

	.choice {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		width: fit-content;
		max-width: 100%;
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
	}

	.nested {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
		margin-left: 1.375rem;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
