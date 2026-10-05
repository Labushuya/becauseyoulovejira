<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { COLOR_LABELS } from '$lib/domain/colors';
	import {
		DUPLICATE_AREA_TEXTS,
		copySourceHint,
		duplicateAreaOf,
		duplicateFormErrors,
		duplicateRequestOf,
		initialDuplicateForm,
		type DuplicateArea,
		type DuplicateField,
		type DuplicateForm,
		type DuplicateTarget
	} from '$lib/domain/duplicate';
	import { formatCalendarDate } from '$lib/domain/format';
	import type { InboxItemSummary } from '$lib/domain/inbox';
	import { PRIORITY_LABELS } from '$lib/domain/labels';
	import { projectPath } from '$lib/domain/project-tree';
	import type { ProjectRef, Ticket } from '$lib/domain/ticket';
	import type { TicketOrigin } from '$lib/domain/ticket-origins';
	import { insideModal } from '$lib/overlay/modal-context';
	import { findAreaStore } from '$lib/stores/area.svelte';
	import type { TicketDuplicateStore } from '$lib/stores/ticket-duplicate.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import InitialStatusChoice from './InitialStatusChoice.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';
	import ProjectSelect from './ProjectSelect.svelte';

	// "Wie soll das Duplikat entstehen?" (ADR-0045 §2): title with "(Kopie)", what the duplicate
	// takes over (the fields of the ticket checked, since ADR-0052 its own color as well, sub-tasks
	// and comments not; the project with ProjectSelect), the status as a required choice without an
	// answer in advance (the building
	// block of "Folgetickets starten mit") and, when the original has sources, whether the duplicate
	// gets a copy of its main source and, since QT-1 (ADR-0067), stems from its source tickets as
	// well. A series never comes along; the dialog says so. In the side
	// panel a modal M; inside a modal (the full view) the same form stands inline (InlineDialog,
	// ADR-0025 addendum 16). Errors of the server stand at their field, anything else as a message;
	// after the duplicate exists the dialog closes and the owner opens it. Since MV-2 (ADR-0045,
	// addendum MV-2) a member of a household chooses the "Ziel": the area of the original (the
	// default) or the other one. There the project is one of the target (loaded with its tags from
	// the server), the tags are mapped by name, the parent stays behind and no source comes along; the
	// dialog says so, and afterwards the flag leads to the duplicate while the tab stays.
	let {
		ticket,
		projects,
		sources = [],
		ticketSources = [],
		commentCount = 0,
		subtaskCount = 0,
		parentKey = null,
		household,
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
		/** Source tickets of the ticket (ADR-0067); those in the trash do not come along. */
		ticketSources?: readonly Pick<TicketOrigin, 'id' | 'key' | 'trashed'>[];
		commentCount?: number;
		/** Sub-tasks of a parent ticket. */
		subtaskCount?: number;
		/** Key of the parent of a sub-task, null for a top-level ticket. */
		parentKey?: string | null;
		/**
		 * Name of the household of the account (MV-2); null without one (no "Ziel"). Read from the area
		 * of the (app) layout when left out.
		 */
		household?: string | null;
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
		sourceError: `${uid}-source-error`,
		toError: `${uid}-to-error`,
		targetProject: `${uid}-target-project`,
		targetProjectHint: `${uid}-target-project-hint`,
		targetProjectError: `${uid}-target-project-error`,
		targetTags: `${uid}-target-tags`
	};
	/** In the full view (a modal) the form stands inline instead of in a dialog of its own. */
	const inline = insideModal();
	const area = findAreaStore();

	/** The area of the original: by its scope, else the area of the tab (MV-2). */
	const origin: DuplicateArea = untrack(() =>
		ticket.scope !== undefined
			? duplicateAreaOf(ticket.scope)
			: area?.active === 'household'
				? 'household'
				: 'private'
	);
	/** The household of the account; with it (and a store that loads the target) the "Ziel". */
	const householdName = $derived(
		household !== undefined ? household : (area?.household?.name ?? null)
	);
	const offersAreas = $derived(householdName !== null && store.offersAreas);

	let answers = $state<DuplicateForm>(
		untrack(() =>
			initialDuplicateForm(
				ticket,
				projects.map((project) => project.id),
				origin
			)
		)
	);
	let errors = $state<Partial<Record<DuplicateField, string>>>({});
	let message = $state<string | null>(null);
	let busy = $state(false);
	let formElement = $state<HTMLFormElement>();
	/** Projects and tags of the other area (MV-2): loaded when it is chosen. */
	let target = $state.raw<DuplicateTarget | null>(null);
	let targetLoading = $state(false);
	let targetMessage = $state<string | null>(null);

	const crossing = $derived(answers.to !== origin);
	/** How the tags of the original arrive in the other area (MV-2), '' in the same area. */
	const targetTags = $derived(
		crossing && target !== null ? DUPLICATE_AREA_TEXTS.tags(target.tags) : ''
	);

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
	/** The source tickets the duplicate would stem from as well (ADR-0067, addendum of ADR-0045). */
	const ticketKeys = $derived(
		ticketSources.filter((source) => !source.trashed).map((source) => source.key)
	);
	/** A refusal of the source without the section (no sources known) goes to the message. */
	const sourceShown = $derived(sources.length > 0 || ticketKeys.length > 0);

	async function focusFirstError() {
		await tick();
		formElement?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	/** "Ziel" (MV-2): the other area loads its projects and tags once; the original's needs nothing. */
	async function chooseArea(to: DuplicateArea) {
		answers.to = to;
		errors = { ...errors, to: undefined, project: undefined };
		if (to === origin || (target !== null && target.to === to) || targetLoading) return;
		targetLoading = true;
		targetMessage = null;
		try {
			const result = await store.target(ticket.id, to);
			if (result.ok) target = result.target;
			else targetMessage = result.message;
		} finally {
			targetLoading = false;
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || (crossing && target === null)) return;
		message = null;
		errors = duplicateFormErrors(answers);
		const status = answers.status;
		if (Object.keys(errors).length > 0 || status === '') {
			await focusFirstError();
			return;
		}
		busy = true;
		const elsewhere = crossing;
		try {
			const result = await store.duplicate(
				{ id: ticket.id, key: ticket.key },
				duplicateRequestOf({ ...answers, status }, origin),
				onopen
			);
			if (result.ok) {
				onclose();
				// Into the other area the tab stays with the original; the flag leads to the duplicate.
				if (!elsewhere) onopen(result.outcome.id);
				return;
			}
			const { source, project, ...others } = result.fields;
			const projectShown = elsewhere || answers.takeProject;
			errors = {
				...others,
				...(source !== undefined && sourceShown && !elsewhere ? { source } : {}),
				...(project !== undefined && projectShown ? { project } : {})
			};
			const hidden = [
				source !== undefined && (!sourceShown || elsewhere) ? source : null,
				project !== undefined && !projectShown ? project : null
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

		{#if offersAreas}
			<fieldset
				class="group"
				role="radiogroup"
				aria-invalid={errors.to ? 'true' : undefined}
				aria-describedby={errors.to ? ids.toError : undefined}
				tabindex="-1"
			>
				<legend>{DUPLICATE_AREA_TEXTS.legend}</legend>
				<div class="areas">
					<label class="choice">
						<input
							type="radio"
							name={`${uid}-to`}
							value="private"
							checked={answers.to === 'private'}
							onchange={() => void chooseArea('private')}
						/>
						{DUPLICATE_AREA_TEXTS.private}
					</label>
					<label class="choice">
						<input
							type="radio"
							name={`${uid}-to`}
							value="household"
							checked={answers.to === 'household'}
							onchange={() => void chooseArea('household')}
						/>
						{householdName}
					</label>
				</div>
				{#if errors.to}
					<p class="field-error" id={ids.toError}><ErrorIcon /><span>{errors.to}</span></p>
				{/if}
			</fieldset>
		{/if}

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
			{#if crossing}
				<div class="field">
					{#if target !== null}
						<label for={ids.targetProject}>{DUPLICATE_AREA_TEXTS.projectLabel}</label>
						<ProjectSelect
							id={ids.targetProject}
							value={answers.targetProject}
							projects={target.projects}
							error={errors.project ?? null}
							errorId={ids.targetProjectError}
							hintId={ids.targetProjectHint}
							hint={DUPLICATE_AREA_TEXTS.projectHint}
							onchoose={(value) => {
								answers.targetProject = value;
								errors = { ...errors, project: undefined };
							}}
						/>
						{#if errors.project}
							<p class="field-error" id={ids.targetProjectError}>
								<ErrorIcon /><span>{errors.project}</span>
							</p>
						{/if}
					{:else if targetLoading}
						<p class="hint" role="status">{DUPLICATE_AREA_TEXTS.loading}</p>
					{/if}
				</div>
			{:else}
				<label class="choice">
					<input type="checkbox" bind:checked={answers.takeProject} />
					Projekt
				</label>
			{/if}
			{#if answers.takeProject && !crossing}
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
				<input
					type="checkbox"
					bind:checked={answers.take.tags}
					aria-describedby={targetTags !== '' ? ids.targetTags : undefined}
				/>
				Tags: {tagNames === '' ? 'keine' : tagNames}
			</label>
			{#if targetTags !== ''}
				<p class="hint nested" id={ids.targetTags}>{targetTags}</p>
			{/if}
			<label class="choice">
				<input type="checkbox" bind:checked={answers.take.due} />
				Fälligkeit: {ticket.due === null ? 'keine' : formatCalendarDate(ticket.due)}
			</label>
			{#if ticket.color !== undefined}
				<label class="choice">
					<input type="checkbox" bind:checked={answers.take.color} />
					Farbe: {ticket.color === null ? 'wie Projekt' : COLOR_LABELS[ticket.color]}
				</label>
			{/if}
			{#if parentKey !== null && !crossing}
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

		{#if crossing}
			<SectionMessage tone="info" compact>
				{DUPLICATE_AREA_TEXTS.note(answers.to, householdName ?? '')}
				{DUPLICATE_AREA_TEXTS.sources}
				{parentKey === null ? '' : DUPLICATE_AREA_TEXTS.parent(parentKey)}
			</SectionMessage>
		{:else if sourceShown}
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
						disabled={mainSource === null && ticketKeys.length === 0}
						aria-describedby={ids.copy}
					/>
					Kopie der Herkunft übernehmen
				</label>
				<p class="hint nested" id={ids.copy}>
					{copySourceHint(mainSource, ticket.key, ticketKeys)}
				</p>
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

		{#if crossing && targetMessage}
			<div class="alert-error" role="alert"><ErrorIcon /><span>{targetMessage}</span></div>
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
		aria-disabled={busy || (crossing && target === null)}
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

	/* "Ziel" (MV-2): both areas side by side, one below the other when there is no room. */
	.areas {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 1.25rem;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
