<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { berlinDateOf, formatBerlinDateTime } from '$lib/domain/format';
	import type { TicketPrefill } from '$lib/domain/inbox';
	import {
		defaultFormValues,
		formErrors,
		type RecurrenceFormField,
		type RecurrenceFormValues
	} from '$lib/domain/recurrence-rule';
	import { suggestionFormValues, type RruleSuggestion } from '$lib/domain/rrule';
	import { isPriority, isStatus, type Priority, type Status } from '$lib/domain/status';
	import {
		DEFAULT_PRIORITY,
		DEFAULT_STATUS,
		DESCRIPTION_MAX_LENGTH,
		TITLE_MAX_LENGTH,
		type ProjectRef,
		type TagRef,
		type TicketDraft
	} from '$lib/domain/ticket';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import type { CreateResult } from '$lib/stores/ticket-detail.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import RichTextEditor from './RichTextEditor.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import RecurrenceForm from './RecurrenceForm.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import TagPicker from './TagPicker.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import Drawer from './overlay/Drawer.svelte';

	// "Neues Ticket" in the side panel (E2 plan, T-8 and package 8; E3 plan, T-13 and T-14):
	// title (required, focused), priority "Mittel", status "Offen", due date, project, tags and
	// description (since RT-6 in the editor of ADR-0032; Ctrl+Enter in it reaches the handler of
	// the drawer below). With the list filtered by an active project, that project is chosen in
	// advance. "Anlegen" or Ctrl+Enter creates; the button is locked during the request, so a
	// double click creates one ticket. "Abbrechen" and Escape ask first through the confirmation
	// (ADR-0025 section 4) if something was entered, a name in the tag picker included. From the inbox (E4 plan, T-5) title and description come
	// filled in; the date at the sender is only a hint with "Als Fälligkeit übernehmen" (P-5).
	// An entry the user typed in brings the project, tags, priority and due date chosen then.
	// Repeating right away (plan OR-4): with `repeat` the form has the folded section "Wiederholen"
	// (a disclosure button with aria-expanded as its heading); opened it holds the fields of a
	// rhythm with the preview, starting on the due date or today. Only an open section creates a
	// rule: the route creates it after the ticket, the known two steps; if it fails, the ticket
	// stays and its panel offers "Wiederholen…". Folding keeps the values for this form. Untouched
	// default values follow a changed due date.
	// A calendar series (E5 plan, package 6; ADR-0024 section 1) shows its rhythm with "Als
	// Wiederholung übernehmen"; that click opens the section with the suggested values. A series the
	// rules cannot express gets a neutral hint. Nothing is set without a click (P-5).
	let {
		projects = [],
		initialProject = null,
		prefill = null,
		sourceLabel = null,
		suggestion = null,
		repeat = false,
		eachAvailable = false,
		today = null,
		tags = [],
		oncreatetag = async () => ({ ok: false, message: null }),
		oncreate,
		oncreated,
		oncancel
	}: {
		/** Projects that can be chosen (the active ones). */
		projects?: readonly ProjectRef[];
		/** Project chosen in advance (list filter); ignored unless it is among `projects`. */
		initialProject?: string | null;
		/** Values of an inbox entry (E4 plan, T-5); read once when the form opens. */
		prefill?: TicketPrefill | null;
		/** Way the entry came in, e.g. "Mail-Datei", shown under the heading. */
		sourceLabel?: string | null;
		/** Suggestion from the RRULE of the entry (rrule.ts); null without a series. */
		suggestion?: RruleSuggestion | null;
		/** Rules are available (after the E5 migration): the section "Wiederholen" is offered. */
		repeat?: boolean;
		/** Offer "Jeden Termin einzeln anlegen" in the section (plan OR-5). */
		eachAvailable?: boolean;
		/** Berlin date of today, for the preview of the section "Wiederholung". */
		today?: CalendarDate | null;
		/** Tags that can be chosen (the catalog). */
		tags?: readonly TagRef[];
		/** Existing or new tag for a typed name (T-14). */
		oncreatetag?: (name: string) => Promise<EnsureTagResult>;
		/** Creates the ticket; `recurrence` holds the values of the open section "Wiederholung". */
		oncreate: (
			draft: TicketDraft,
			recurrence: RecurrenceFormValues | null
		) => Promise<CreateResult>;
		oncreated: (id: string) => void;
		oncancel: () => void;
	} = $props();

	/** The question before entered data is lost; "Weiter bearbeiten" keeps it. */
	let confirmingDiscard = $state(false);

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		heading: `${uid}-heading`,
		title: `${uid}-title`,
		titleHint: `${uid}-title-hint`,
		titleError: `${uid}-title-error`,
		status: `${uid}-status`,
		priority: `${uid}-priority`,
		due: `${uid}-due`,
		sourceDate: `${uid}-source-date`,
		dueError: `${uid}-due-error`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		projectError: `${uid}-project-error`,
		tags: `${uid}-tags`,
		tagsError: `${uid}-tags-error`,
		description: `${uid}-description-error`,
		recurrence: `${uid}-recurrence`,
		recurrenceBody: `${uid}-recurrence-body`
	};

	// The form is opened for one entry (the route keys it), so the values are read once.
	const initialTitle = untrack(() => prefill?.title ?? '');
	const initialDescription = untrack(() => prefill?.description ?? '');
	const sourceDate = untrack(() => prefill?.sourceDate ?? null);
	// Values the user chose when typing the entry in (capture form, quick entry).
	const preset = untrack(() => prefill?.preset ?? null);
	const initialPriority: Priority = preset?.priority ?? DEFAULT_PRIORITY;
	const initialDue: string = preset?.due ?? '';
	const initialTagIds: readonly string[] = preset?.tagIds ?? [];

	let title = $state(initialTitle);
	let status = $state<Status>(DEFAULT_STATUS);
	let priority = $state<Priority>(initialPriority);
	let due = $state(initialDue);
	let dueInvalid = $state(false);
	let description = $state(initialDescription);
	/** Project chosen by the user; null until then, so a late catalog still sets the default. */
	let chosenProject = $state<string | null>(null);
	let tagIds = $state<string[]>([...initialTagIds]);
	let tagText = $state('');
	let tagError = $state<string | null>(null);
	let pending = $state(false);
	let message = $state<string | null>(null);
	let fieldErrors = $state<Partial<Record<keyof TicketDraft, string>>>({});
	let titleInput = $state<HTMLInputElement>();
	/**
	 * Values of the section "Wiederholen"; null until it is opened the first time. They stay while
	 * the section is folded; only an open section creates a rule.
	 */
	let recurrence = $state<{ values: RecurrenceFormValues } | null>(null);
	let repeatOpen = $state(false);
	/** Due date the default values were made for; null once they came from a suggestion. */
	let defaultsFor: string | null = null;
	let recurrenceErrors = $state<Partial<Record<RecurrenceFormField, string>>>({});
	let recurrenceSection = $state<HTMLElement>();
	let repeatToggle = $state<HTMLButtonElement>();
	const ruleSuggestion = $derived(suggestion?.kind === 'rule' ? suggestion : null);
	const unsupported = $derived(suggestion?.kind === 'unsupported' ? suggestion : null);
	/** The section is offered with rules available (or with a suggestion) and a known date. */
	const canRepeat = $derived(today !== null && (repeat || ruleSuggestion !== null));

	const wantedProject = $derived(preset?.project ?? initialProject);
	const defaultProject = $derived(
		wantedProject !== null && projects.some((entry) => entry.id === wantedProject)
			? wantedProject
			: ''
	);
	const project = $derived(chosenProject ?? defaultProject);
	/** Chosen tags from the catalog; a new tag is in it before it is chosen. */
	const chosenTags = $derived(
		tagIds.flatMap((tagId) => {
			const tag = tags.find((entry) => entry.id === tagId);
			return tag === undefined ? [] : [tag];
		})
	);
	const tagsError = $derived(tagError ?? fieldErrors.tags ?? null);
	const missingTitle = $derived(title.trim() === '');
	const dirty = $derived(
		title !== initialTitle ||
			description !== initialDescription ||
			due !== initialDue ||
			dueInvalid ||
			status !== DEFAULT_STATUS ||
			priority !== initialPriority ||
			project !== defaultProject ||
			tagIds.join(',') !== initialTagIds.join(',') ||
			tagText.trim() !== '' ||
			repeatOpen
	);
	const dueError = $derived(dueInvalid ? 'Ungültiges Datum.' : (fieldErrors.due ?? null));

	$effect(() => {
		titleInput?.focus();
	});

	async function submit(event?: Event) {
		event?.preventDefault();
		if (pending) return;
		if (missingTitle || dueInvalid) {
			if (missingTitle) titleInput?.focus();
			return;
		}
		const rhythm = repeatOpen && recurrence !== null ? recurrence.values : null;
		if (rhythm !== null) {
			recurrenceErrors = formErrors(rhythm);
			if (Object.keys(recurrenceErrors).length > 0) {
				await tick();
				recurrenceSection?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
				return;
			}
		}
		pending = true;
		message = null;
		fieldErrors = {};
		const result = await oncreate(
			{
				title,
				description,
				status,
				priority,
				due: due === '' ? null : (due as CalendarDate),
				project: project === '' ? null : project,
				// Only tags the catalog knows: a preset may name a tag deleted since.
				tags: chosenTags.map((tag) => tag.id)
			},
			rhythm
		);
		if (result.ok) {
			oncreated(result.ticket.id);
			return;
		}
		pending = false;
		message = result.message;
		fieldErrors = result.fields;
		if (result.fields.title) titleInput?.focus();
	}

	/** "Als Wiederholung übernehmen": opens the section with the suggested values. */
	async function takeOver() {
		if (ruleSuggestion === null) return;
		recurrence = { values: suggestionFormValues(ruleSuggestion.params) };
		defaultsFor = null;
		recurrenceErrors = {};
		repeatOpen = true;
		await tick();
		repeatToggle?.focus();
	}

	function dueOrNull(value: string): CalendarDate | null {
		return value === '' ? null : (value as CalendarDate);
	}

	/** The values are still the defaults made for `defaultsFor` (nothing chosen by hand). */
	function untouchedDefaults(): boolean {
		return (
			recurrence !== null &&
			defaultsFor !== null &&
			today !== null &&
			JSON.stringify(recurrence.values) ===
				JSON.stringify(defaultFormValues(dueOrNull(defaultsFor), today))
		);
	}

	function useDefaults() {
		if (today === null) return;
		recurrence = { values: defaultFormValues(dueOrNull(due), today) };
		defaultsFor = due;
	}

	/**
	 * The disclosure "Wiederholen": opening shows the values of before, or the defaults (weekly on
	 * the weekday of the due date or of today, starting then, lead time 3); folding creates no rule.
	 */
	function toggleRepeat() {
		if (repeatOpen) {
			repeatOpen = false;
			recurrenceErrors = {};
			return;
		}
		if (recurrence === null || untouchedDefaults()) useDefaults();
		repeatOpen = true;
	}

	/** A new due date moves untouched default values along (weekday and start). */
	function dueChanged() {
		if (repeatOpen && untouchedDefaults() && !dueInvalid) useDefaults();
	}

	/** "Als Fälligkeit übernehmen": the Berlin calendar date of the date at the sender. */
	function takeSourceDate() {
		if (sourceDate === null) return;
		due = berlinDateOf(sourceDate);
		dueInvalid = false;
	}

	function addTag(tagId: string): boolean {
		if (!tagIds.includes(tagId)) tagIds = [...tagIds, tagId];
		tagError = null;
		return true;
	}

	async function createTag(name: string): Promise<boolean> {
		const result = await oncreatetag(name);
		if (!result.ok) {
			tagError = result.message;
			return false;
		}
		return addTag(result.tag.id);
	}

	function cancel() {
		if (pending) return;
		if (dirty) confirmingDiscard = true;
		else oncancel();
	}

	function onkeydown(event: KeyboardEvent) {
		if (confirmingDiscard) return;
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void submit();
		}
	}
</script>

<Drawer labelledby={ids.heading} closeFromFields onclose={cancel} {onkeydown}>
	{#snippet context()}
		{sourceLabel !== null ? `Aus dem Eingang (${sourceLabel})` : 'Aufgaben'}
	{/snippet}
	{#snippet footer()}
		<button class="button-secondary" type="button" onclick={cancel}>Abbrechen</button>
		<button
			class="button-primary"
			type="submit"
			form={ids.form}
			aria-disabled={missingTitle || pending ? 'true' : undefined}
			aria-busy={pending ? 'true' : undefined}
			aria-describedby={missingTitle ? ids.titleHint : undefined}
		>
			{pending ? 'Wird angelegt …' : 'Anlegen'}
		</button>
	{/snippet}
	<h2 id={ids.heading}>Neues Ticket</h2>

	<div aria-live="polite">
		{#if message}
			<p class="alert-error"><ErrorIcon /><span>{message}</span></p>
		{/if}
	</div>

	<form
		id={ids.form}
		class="form"
		novalidate
		aria-busy={pending ? 'true' : undefined}
		onsubmit={submit}
	>
		<div class="field">
			<label for={ids.title}>Titel</label>
			<input
				id={ids.title}
				type="text"
				required
				aria-required="true"
				maxlength={TITLE_MAX_LENGTH}
				aria-invalid={fieldErrors.title ? 'true' : undefined}
				aria-describedby={fieldErrors.title ? ids.titleError : undefined}
				bind:value={title}
				bind:this={titleInput}
			/>
			{#if fieldErrors.title}
				<p class="field-error" id={ids.titleError}><ErrorIcon /><span>{fieldErrors.title}</span></p>
			{/if}
		</div>

		<div class="row">
			<div class="field">
				<label for={ids.status}>Status</label>
				<StatusSelect
					id={ids.status}
					value={status}
					disabled={pending}
					error={fieldErrors.status ?? null}
					errorId={`${ids.status}-error`}
					onchoose={(value) => {
						if (isStatus(value)) status = value;
					}}
				/>
			</div>
			<div class="field">
				<label for={ids.priority}>Priorität</label>
				<PrioritySelect
					id={ids.priority}
					value={priority}
					disabled={pending}
					error={fieldErrors.priority ?? null}
					errorId={`${ids.priority}-error`}
					onchoose={(value) => {
						if (isPriority(value)) priority = value;
					}}
				/>
			</div>
			<div class="field">
				<label for={ids.due}>Fälligkeit</label>
				<input
					id={ids.due}
					type="date"
					aria-invalid={dueError ? 'true' : undefined}
					aria-describedby={dueError ? ids.dueError : undefined}
					bind:value={due}
					oninput={(event) => (dueInvalid = event.currentTarget.validity.badInput)}
					onchange={dueChanged}
				/>
			</div>
		</div>
		{#if sourceDate !== null}
			<p class="hint source-date" id={ids.sourceDate}>
				Quelldatum: {formatBerlinDateTime(sourceDate)}
				<button class="text-button" type="button" onclick={takeSourceDate}>
					Als Fälligkeit übernehmen
				</button>
			</p>
		{/if}
		{#if dueError}
			<p class="field-error" id={ids.dueError}><ErrorIcon /><span>{dueError}</span></p>
		{/if}
		{#if ruleSuggestion !== null}
			<SectionMessage tone="info">
				Dieser Termin wiederholt sich: {ruleSuggestion.text}.
				{#each ruleSuggestion.notes as note (note)}
					{note}
				{/each}
				{#snippet actions()}
					{#if !repeatOpen}
						<button class="button-secondary" type="button" onclick={takeOver}>
							Als Wiederholung übernehmen
						</button>
					{/if}
				{/snippet}
			</SectionMessage>
		{:else if unsupported !== null}
			<SectionMessage tone="info">
				Diese Serie lässt sich nicht als Regel übernehmen ({unsupported.reasons.join('; ')}). Nach
				dem Anlegen kannst du am Ticket „Wiederholen…“ wählen.
			</SectionMessage>
		{/if}
		{#if canRepeat && today !== null}
			<section class="recurrence" aria-labelledby={ids.recurrence} bind:this={recurrenceSection}>
				<h3 id={ids.recurrence}>
					<button
						class="disclosure"
						type="button"
						aria-expanded={repeatOpen}
						aria-controls={ids.recurrenceBody}
						bind:this={repeatToggle}
						onclick={toggleRepeat}
					>
						<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
							<path d={repeatOpen ? 'M3 4.5l3 3 3-3' : 'M4.5 3l3 3-3 3'} />
						</svg>
						Wiederholen
					</button>
				</h3>
				<div class="recurrence-body" id={ids.recurrenceBody} hidden={!repeatOpen}>
					{#if repeatOpen && recurrence !== null}
						<p class="hint">
							Das Ticket wird das erste der Serie; die Regel entsteht direkt nach dem Anlegen.
							Zugeklappt entsteht keine Regel.
						</p>
						<RecurrenceForm
							bind:values={recurrence.values}
							errors={recurrenceErrors}
							{today}
							withoutDue={due === ''}
							{eachAvailable}
							context={{ kind: 'ticket', due: dueOrNull(due) }}
						/>
					{/if}
				</div>
			</section>
		{/if}

		<div class="field">
			<label for={ids.project}>Projekt</label>
			<ProjectSelect
				id={ids.project}
				value={project}
				{projects}
				disabled={pending}
				error={fieldErrors.project ?? null}
				errorId={ids.projectError}
				hintId={ids.projectHint}
				onchoose={(value) => (chosenProject = value)}
			/>
			{#if fieldErrors.project}
				<p class="field-error" id={ids.projectError}>
					<ErrorIcon /><span>{fieldErrors.project}</span>
				</p>
			{/if}
		</div>

		<div class="field">
			<label for={ids.tags}>Tags</label>
			<TagPicker
				id={ids.tags}
				selected={chosenTags}
				{tags}
				bind:text={tagText}
				busy={pending}
				error={tagsError}
				errorId={ids.tagsError}
				onadd={addTag}
				onremove={(tagId) => {
					tagIds = tagIds.filter((entry) => entry !== tagId);
					return true;
				}}
				oncreate={createTag}
			/>
			{#if tagsError}
				<p class="field-error" id={ids.tagsError}><ErrorIcon /><span>{tagsError}</span></p>
			{/if}
		</div>

		<RichTextEditor
			label="Beschreibung"
			placeholder="Beschreibung eingeben …"
			maxlength={DESCRIPTION_MAX_LENGTH}
			bind:value={description}
			invalid={fieldErrors.description !== undefined}
			describedby={fieldErrors.description ? ids.description : undefined}
		/>
		{#if fieldErrors.description}
			<p class="field-error" id={ids.description}>
				<ErrorIcon /><span>{fieldErrors.description}</span>
			</p>
		{/if}

		{#if missingTitle}
			<p class="hint" id={ids.titleHint}>Zum Anlegen fehlt noch ein Titel.</p>
		{/if}
		<p class="hint">Tipp: Strg+Enter legt das Ticket an.</p>
	</form>
</Drawer>

<ConfirmDialog
	open={confirmingDiscard}
	title="Neues Ticket verwerfen?"
	confirmLabel="Verwerfen"
	cancelLabel="Weiter bearbeiten"
	onconfirm={() => {
		confirmingDiscard = false;
		oncancel();
	}}
	oncancel={() => (confirmingDiscard = false)}
>
	<p>Die Eingaben gehen verloren.</p>
</ConfirmDialog>

<style>
	h2 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	.form {
		display: grid;
		gap: 1rem;
	}

	.field {
		display: grid;
		gap: 0.375rem;
		align-content: start;
		min-width: 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
	}

	label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	input,
	.form :global(select) {
		max-width: 100%;
		padding: 0.375rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	input[type='text'] {
		width: 100%;
	}

	.button-primary[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}

	/* The ticket is being created (ADR-0026, addendum of 2026-09-30). */
	.button-primary[aria-busy='true'] {
		cursor: progress;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.recurrence {
		display: grid;
		gap: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	.recurrence-body {
		display: grid;
		gap: 0.75rem;
	}

	.recurrence-body[hidden] {
		display: none;
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	/* The heading of the section is its disclosure button (plan OR-4). */
	.disclosure {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.125rem 0.25rem;
		margin-left: -0.25rem;
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.disclosure:hover {
		background: var(--fill-control-hover);
	}

	.disclosure svg {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.source-date {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
	}

	.text-button {
		padding: 0.0625rem 0.5rem;
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
		background: none;
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-control);
		cursor: pointer;
	}
</style>
