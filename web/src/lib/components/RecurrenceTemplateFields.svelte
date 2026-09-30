<script lang="ts">
	import { STATUS_LABELS } from '$lib/domain/labels';
	import {
		TEMPLATE_STATUSES,
		isTemplateStatus,
		type RuleTemplate
	} from '$lib/domain/series-template';
	import { isPriority } from '$lib/domain/status';
	import {
		DESCRIPTION_MAX_LENGTH,
		TITLE_MAX_LENGTH,
		type ProjectRef,
		type TagRef
	} from '$lib/domain/ticket';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import RichTextEditor from './RichTextEditor.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import TagPicker from './TagPicker.svelte';

	// Fields of the template of a rule (plan WV): title, priority, "Status beim Anlegen", project,
	// tags and description. The rule panel (/wiederholungen) and the inline editor at the ticket
	// ("Wiederholt sich" → "Bearbeiten") use the same fields. `values` is replaced as a whole on
	// every change, so a binding through getter and setter (a draft in a store) works as well.
	// The status is offered only after its migration (`statusAvailable`); every status but
	// "Erledigt" (ADR-0022 addendum 8).
	let {
		values = $bindable(),
		tagText = $bindable(''),
		titleInput = $bindable(),
		errors = {},
		projects,
		tags,
		currentProject = null,
		busy = false,
		statusAvailable = false,
		oncreatetag,
		onprojectchosen
	}: {
		values: RuleTemplate;
		/** Text in the tag picker, not yet a tag (unsaved input). */
		tagText?: string;
		titleInput?: HTMLInputElement;
		/** Field errors, by the field names of the server. */
		errors?: Partial<
			Record<'title' | 'description' | 'priority' | 'project' | 'tags' | 'initial_status', string>
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
		/** Existing or new tag for a typed name (E3 plan, T-14). */
		oncreatetag: (name: string) => Promise<EnsureTagResult>;
		/** A project was chosen (the owner may clear a refusal that named it). */
		onprojectchosen?: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		title: `${uid}-title`,
		titleError: `${uid}-title-error`,
		priority: `${uid}-priority`,
		status: `${uid}-status`,
		statusHint: `${uid}-status-hint`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		projectError: `${uid}-project-error`,
		tags: `${uid}-tags`,
		tagsError: `${uid}-tags-error`,
		description: `${uid}-description-error`
	};

	let tagError = $state<string | null>(null);

	const chosenTags = $derived(
		values.tagIds.flatMap((tagId) => {
			const tag = tags.find((entry) => entry.id === tagId);
			return tag === undefined ? [] : [tag];
		})
	);
	const tagsError = $derived(tagError ?? errors.tags ?? null);

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

<div class="field">
	<label for={ids.title}>Titel</label>
	<input
		id={ids.title}
		type="text"
		required
		aria-required="true"
		autocomplete="off"
		maxlength={TITLE_MAX_LENGTH}
		aria-invalid={errors.title ? 'true' : undefined}
		aria-describedby={errors.title ? ids.titleError : undefined}
		value={values.title}
		oninput={(event) => (values = { ...values, title: event.currentTarget.value })}
		bind:this={titleInput}
	/>
	{#if errors.title}
		<p class="field-error" id={ids.titleError}><ErrorIcon /><span>{errors.title}</span></p>
	{/if}
</div>

<div class="row">
	<div class="field">
		<label for={ids.priority}>Priorität</label>
		<PrioritySelect
			id={ids.priority}
			value={values.priority}
			error={errors.priority ?? null}
			errorId={`${ids.priority}-error`}
			onchoose={(value) => {
				if (isPriority(value)) values = { ...values, priority: value };
			}}
		/>
	</div>

	{#if statusAvailable}
		<div class="field">
			<label for={ids.status}>Status beim Anlegen</label>
			<StatusSelect
				id={ids.status}
				value={values.initialStatus}
				statuses={TEMPLATE_STATUSES}
				describedby={ids.statusHint}
				error={errors.initial_status ?? null}
				errorId={`${ids.status}-error`}
				onchoose={(value) => {
					if (isTemplateStatus(value)) values = { ...values, initialStatus: value };
				}}
			/>
		</div>
	{/if}
</div>
{#if statusAvailable}
	<p class="hint" id={ids.statusHint}>
		So startet jedes neue Ticket der Serie, Standard „{STATUS_LABELS.open}“.
	</p>
	{#if errors.initial_status}
		<p class="field-error" id={`${ids.status}-error`}>
			<ErrorIcon /><span>{errors.initial_status}</span>
		</p>
	{/if}
{/if}

<div class="field">
	<label for={ids.project}>Projekt</label>
	<ProjectSelect
		id={ids.project}
		value={values.projectId ?? ''}
		{projects}
		current={currentProject}
		error={errors.project ?? null}
		errorId={ids.projectError}
		hintId={ids.projectHint}
		onchoose={(value) => {
			values = { ...values, projectId: value === '' ? null : value };
			onprojectchosen?.();
		}}
	/>
	{#if errors.project}
		<p class="field-error" id={ids.projectError}>
			<ErrorIcon /><span>{errors.project}</span>
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
		{busy}
		error={tagsError}
		errorId={ids.tagsError}
		onadd={addTag}
		onremove={(tagId) => {
			values = { ...values, tagIds: values.tagIds.filter((entry) => entry !== tagId) };
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

<style>
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
	.field :global(select) {
		max-width: 100%;
		padding: 0.375rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	input[type='text'] {
		width: 100%;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
