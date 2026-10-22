<script lang="ts">
	import { inheritLabel, projectColorOf } from '$lib/domain/colors';
	import type {
		RuleTemplate,
		SubtaskStatusProblem,
		TemplateStatus,
		TicketSubtask
	} from '$lib/domain/series-template';
	import { isPriority } from '$lib/domain/status';
	import {
		DESCRIPTION_MAX_LENGTH,
		TITLE_MAX_LENGTH,
		type ProjectRef,
		type TagRef
	} from '$lib/domain/ticket';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import CharmPicker from './CharmPicker.svelte';
	import ColorChoice from './ColorChoice.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Field from './form/Field.svelte';
	import InitialStatusField from './InitialStatusField.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import RichTextEditor from './RichTextEditor.svelte';
	import TagPicker from './TagPicker.svelte';
	import TemplateSubtaskList from './TemplateSubtaskList.svelte';

	// Fields of the template of a rule (plan WV): what every next ticket of the series gets. The rule
	// panel (/wiederholungen) and the inline editor at the ticket ("Wiederholt sich" → "Bearbeiten")
	// use the same fields. Since RG-1 they follow the order and the names of "Neues Ticket" and of
	// the registry of the ticket options (domain/ticket-options.ts): Titel, "Status beim Anlegen",
	// Priorität, Projekt, Farbe, Charm, Tags, Beschreibung, Unteraufgaben; every text field and select
	// stands in a Field (ADR-0060: label above, then error and hint). `values` is replaced as a whole
	// on every change, so a binding through getter and setter (a draft in a store) works as well.
	// "Status beim Anlegen" after its migration (`statusAvailable`), every status but "Erledigt"
	// (ADR-0022 addendum 8); a new rule asks it without an answer in advance (`askStatus`, the answer
	// in `chosenStatus`, ADR-0022 addenda 9 and 17). The sub-tasks after their migration
	// (`subtasksAvailable`, ADR-0022 addendum 10); at a ticket with sub-tasks the list can take them
	// over (`ticketSubtasks`), and since UT-1 each sub-task offers its status (`subtaskStatusAvailable`),
	// without an own choice the "Status beim Anlegen"; a failed question for it says why with "Erneut
	// versuchen" (`subtaskStatusProblem`, UT-2). The color of the next tickets, "Wie Projekt
	// (Blau)" first, after its migration (`colorsAvailable`, ADR-0052); the charm after its migration
	// (`charmsAvailable`, ADR-0062). In the phone frame the keyboard starts the title with a capital
	// letter (MO-7b, `autocapitalize`, like the titles since MO-7a).
	let {
		values = $bindable(),
		tagText = $bindable(''),
		titleInput = $bindable(),
		chosenStatus = $bindable(''),
		errors = {},
		projects,
		tags,
		currentProject = null,
		busy = false,
		statusAvailable = false,
		askStatus = false,
		subtasksAvailable = false,
		subtaskStatusAvailable = false,
		subtaskStatusProblem = null,
		colorsAvailable = false,
		charmsAvailable = false,
		ticketSubtasks = [],
		invalidSubtasks = [],
		oncreatetag,
		onprojectchosen,
		onstatuschosen
	}: {
		values: RuleTemplate;
		/** Text in the tag picker, not yet a tag (unsaved input). */
		tagText?: string;
		titleInput?: HTMLInputElement;
		/** The answer to "Status beim Anlegen" of a new rule (`askStatus`); '' while none is given. */
		chosenStatus?: TemplateStatus | '';
		/** Field errors, by the field names of the server. */
		errors?: Partial<
			Record<
				| 'title'
				| 'description'
				| 'priority'
				| 'project'
				| 'tags'
				| 'initial_status'
				| 'template_subtasks'
				| 'color'
				| 'charm',
				string
			>
		>;
		/** Projects that can be chosen (the active ones). */
		projects: readonly ProjectRef[];
		/** Tags that can be chosen (the catalog). */
		tags: readonly TagRef[];
		/** The project of the template, shown even if it is archived. */
		currentProject?: ProjectRef | null;
		busy?: boolean;
		/** The server knows "Status beim Anlegen" (after its migration). */
		statusAvailable?: boolean;
		/** A new rule: "Status beim Anlegen" is a required choice without an answer in advance. */
		askStatus?: boolean;
		/** The server knows the sub-tasks of the template (after their migration, plan WV-3). */
		subtasksAvailable?: boolean;
		/** The hooks take a status per sub-task of the template (after the restart after UT-1). */
		subtaskStatusAvailable?: boolean;
		/** The question for it failed (UT-2): unknown, with "Erneut versuchen"; null otherwise. */
		subtaskStatusProblem?: SubtaskStatusProblem | null;
		/** The server knows the color of the template (after its migration, ADR-0052). */
		colorsAvailable?: boolean;
		/** The server knows the charm of the template (after its migration, ADR-0062). */
		charmsAvailable?: boolean;
		/** Sub-tasks of the ticket the template is edited at ("Unteraufgaben dieses Tickets übernehmen"). */
		ticketSubtasks?: readonly TicketSubtask[];
		/** Rows of the list the owner refused for a missing title. */
		invalidSubtasks?: readonly number[];
		/** Existing or new tag for a typed name (E3 plan, T-14). */
		oncreatetag: (name: string) => Promise<EnsureTagResult>;
		/** A project was chosen (the owner may clear a refusal that named it). */
		onprojectchosen?: () => void;
		/** A status was chosen for a new rule (the owner may clear the error of a missing answer). */
		onstatuschosen?: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		title: `${uid}-title`,
		status: `${uid}-status`,
		priority: `${uid}-priority`,
		project: `${uid}-project`,
		tags: `${uid}-tags`,
		color: `${uid}-color`,
		colorError: `${uid}-color-error`,
		charmError: `${uid}-charm-error`,
		description: `${uid}-description-error`
	};

	let tagError = $state<string | null>(null);
	const mobileLayout = getMobileLayoutStore();

	/** "Status beim Anlegen" as shown: the answer of a new rule, else the one of the template. */
	const shownStatus = $derived(askStatus ? chosenStatus : values.initialStatus);
	/** The status sub-tasks without an own one show and start with: the answer of a new rule once given. */
	const subtaskDefault = $derived(
		askStatus && chosenStatus !== '' ? chosenStatus : values.initialStatus
	);

	/** The color of the next tickets without an own one: of the project of the template. */
	const inherited = $derived.by(() => {
		const id = values.projectId;
		if (id === null) return null;
		const project =
			projects.find((choice) => choice.id === id) ??
			(currentProject?.id === id ? currentProject : null);
		return projectColorOf(project)?.color ?? null;
	});

	const chosenTags = $derived(
		values.tagIds.flatMap((tagId) => {
			const tag = tags.find((entry) => entry.id === tagId);
			return tag === undefined ? [] : [tag];
		})
	);
	const tagsError = $derived(tagError ?? errors.tags ?? null);

	function chooseStatus(status: TemplateStatus) {
		if (askStatus) {
			chosenStatus = status;
			onstatuschosen?.();
		} else {
			values = { ...values, initialStatus: status };
		}
	}

	function addTag(tagId: string): boolean {
		if (!values.tagIds.includes(tagId)) values = { ...values, tagIds: [...values.tagIds, tagId] };
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
</script>

<Field label="Titel" id={ids.title} error={errors.title ?? ''}>
	{#snippet control(field)}
		<input
			{...field}
			type="text"
			required
			aria-required="true"
			autocomplete="off"
			autocapitalize={mobileLayout.active ? 'sentences' : undefined}
			maxlength={TITLE_MAX_LENGTH}
			value={values.title}
			oninput={(event) => (values = { ...values, title: event.currentTarget.value })}
			bind:this={titleInput}
		/>
	{/snippet}
</Field>

<!-- Status before priority, side by side as in "Neues Ticket" (RG-1). -->
<div class="row">
	{#if statusAvailable}
		<InitialStatusField
			id={ids.status}
			value={shownStatus}
			ask={askStatus}
			error={errors.initial_status ?? null}
			onchoose={chooseStatus}
		/>
	{/if}
	<Field label="Priorität" id={ids.priority} error={errors.priority ?? ''} width="auto">
		{#snippet control(field)}
			<PrioritySelect
				{field}
				value={values.priority}
				onchoose={(value) => {
					if (isPriority(value)) values = { ...values, priority: value };
				}}
			/>
		{/snippet}
	</Field>
</div>

<Field label="Projekt" id={ids.project} error={errors.project ?? ''}>
	{#snippet control(field)}
		<ProjectSelect
			{field}
			value={values.projectId ?? ''}
			{projects}
			current={currentProject}
			onchoose={(value) => {
				values = { ...values, projectId: value === '' ? null : value };
				onprojectchosen?.();
			}}
		/>
	{/snippet}
</Field>

<!-- Color and charm are groups of their own (a radio group, a picker), named by a label above them
     in the look of the label of a Field. -->
{#if colorsAvailable}
	<div class="group">
		<span class="group-label" id={ids.color}>Farbe</span>
		<ColorChoice
			value={values.color}
			inheritLabel={inheritLabel('ticket', inherited)}
			{inherited}
			labelledby={ids.color}
			error={errors.color ?? null}
			errorId={ids.colorError}
			onchoose={(color) => (values = { ...values, color })}
		/>
	</div>
{/if}

{#if charmsAvailable}
	<div class="group">
		<span class="group-label">Charm</span>
		<CharmPicker
			value={values.charm}
			error={errors.charm ?? null}
			errorId={ids.charmError}
			onchoose={(charm) => (values = { ...values, charm })}
		/>
		<p class="hint">Jedes neue Ticket der Serie bekommt ihn beim Anlegen.</p>
	</div>
{/if}

<Field label="Tags" id={ids.tags} error={tagsError ?? ''}>
	{#snippet control(field)}
		<TagPicker
			{field}
			selected={chosenTags}
			{tags}
			bind:text={tagText}
			{busy}
			onadd={addTag}
			onremove={(tagId) => {
				values = { ...values, tagIds: values.tagIds.filter((entry) => entry !== tagId) };
				return true;
			}}
			oncreate={createTag}
		/>
	{/snippet}
</Field>

<div class="group">
	<RichTextEditor
		label="Beschreibung"
		maxlength={DESCRIPTION_MAX_LENGTH}
		bind:value={() => values.description, (description) => (values = { ...values, description })}
		invalid={errors.description !== undefined}
		describedby={errors.description ? ids.description : undefined}
	/>
	{#if errors.description}
		<p class="field-error" id={ids.description}>
			<ErrorIcon /><span>{errors.description}</span>
		</p>
	{/if}
</div>

{#if subtasksAvailable}
	<TemplateSubtaskList
		bind:subtasks={() => values.subtasks, (subtasks) => (values = { ...values, subtasks })}
		{ticketSubtasks}
		invalidRows={invalidSubtasks}
		error={errors.template_subtasks ?? null}
		{busy}
		statusAvailable={subtaskStatusAvailable}
		statusProblem={subtaskStatusProblem?.reason ?? null}
		statusBusy={subtaskStatusProblem?.busy ?? false}
		onretrystatus={subtaskStatusProblem?.retry}
		defaultStatus={subtaskDefault}
	/>
{/if}

<style>
	/* Status and priority side by side; on narrow columns the second wraps below. */
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
	}

	/* The gaps of a Field (ADR-0060) for the groups without one. */
	.group {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.25rem;
		align-content: start;
		min-width: 0;
	}

	/* The label of a Field, for a group that is no single control. */
	.group-label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
