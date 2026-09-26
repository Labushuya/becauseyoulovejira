<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { RuleDraft } from '$lib/data/recurrence';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		SERVER_FIELDS,
		defaultFormValues,
		formErrors,
		formParams,
		formValuesOf,
		nextTicketText,
		ruleStateLabel,
		sameRhythm,
		type RecurrenceFormField,
		type RecurrenceFormValues,
		type RecurrenceRule
	} from '$lib/domain/recurrence-rule';
	import { isPriority, type Priority } from '$lib/domain/status';
	import {
		DEFAULT_PRIORITY,
		DESCRIPTION_MAX_LENGTH,
		TITLE_MAX_LENGTH,
		type ProjectRef,
		type TagRef
	} from '$lib/domain/ticket';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Lozenge from './guidance/Lozenge.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import Drawer from './overlay/Drawer.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import RecurrenceForm from './RecurrenceForm.svelte';
	import type { OpenInstance } from './RecurrenceTable.svelte';
	import TagPicker from './TagPicker.svelte';

	// Panel of a rule (E5 plan, T-6 and package 5) on the side panel building block, like the
	// project panel (UI-8): "Neue Regel" under /wiederholungen/neu and a rule under
	// /wiederholungen/<id>. The template (title, priority, project, tags, description) and the
	// rhythm (RecurrenceForm with the preview "Nächste Termine") in one form. A rule also shows its
	// state with the next ticket, its open ticket, the neutral hint of the server and "Pausieren" or
	// "Fortsetzen"; "Löschen …" in the header asks "Regel löschen?" (its tickets stay, ADR-0023
	// section 7). Saving an existing rule sends the rhythm only when it changed: a new template
	// never changes the open ticket, a new rhythm makes the hook compute the next ticket again
	// (ADR-0023 section 5). Field errors stand at their field, among them the one of "Fortsetzen"
	// with an archived project (ADR-0023 section 8); Escape and × ask before unsaved input is lost.
	// The owner navigates; the store shows the flags.
	let {
		rule = null,
		today,
		projects,
		tags,
		projectById,
		openTicket = null,
		ticketHrefOf,
		oncreatetag,
		onsave,
		ontoggle,
		ondelete,
		onsaved,
		ondeleted,
		onclose
	}: {
		/** Rule of the panel; null for "Neue Regel". */
		rule?: RecurrenceRule | null;
		today: CalendarDate;
		/** Projects that can be chosen (the active ones). */
		projects: readonly ProjectRef[];
		/** Tags that can be chosen (the catalog). */
		tags: readonly TagRef[];
		/** A project of the catalog, also an archived one (the current project of the template). */
		projectById: (id: string) => ProjectRef | null;
		/** Open ticket of the rule; null without one or while unknown. */
		openTicket?: OpenInstance | null;
		ticketHrefOf: (ticketId: string) => ResolvedPathname;
		/** Existing or new tag for a typed name (E3 plan, T-14). */
		oncreatetag: (name: string) => Promise<EnsureTagResult>;
		/** A new rule gets the whole draft, an existing one the changed parts. */
		onsave: (draft: Partial<RuleDraft>) => Promise<EditResult<RecurrenceRule>>;
		/** "Pausieren" and "Fortsetzen" of a rule. */
		ontoggle?: (active: boolean) => Promise<EditResult<RecurrenceRule>>;
		/** "Löschen …" of a rule. */
		ondelete?: () => Promise<EditResult<void>>;
		/** After saving: the saved rule (a new one gets its own panel). */
		onsaved?: (rule: RecurrenceRule) => void;
		/** After deleting: back to the overview. */
		ondeleted?: () => void;
		/** × and Escape (after the question about unsaved input). */
		onclose: () => void;
	} = $props();

	interface Template {
		title: string;
		description: string;
		/** Project ID, '' for none. */
		project: string;
		tagIds: string[];
		priority: Priority;
	}

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		form: `${uid}-form`,
		title: `${uid}-title`,
		titleError: `${uid}-title-error`,
		priority: `${uid}-priority`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		projectError: `${uid}-project-error`,
		tags: `${uid}-tags`,
		tagsError: `${uid}-tags-error`,
		description: `${uid}-description-error`,
		template: `${uid}-template`,
		rhythm: `${uid}-rhythm`,
		state: `${uid}-state`
	};

	function templateOf(source: RecurrenceRule | null): Template {
		return {
			title: source?.title ?? '',
			description: source?.description ?? '',
			project: source?.projectId ?? '',
			tagIds: [...(source?.tagIds ?? [])],
			priority: source?.priority ?? DEFAULT_PRIORITY
		};
	}

	function copyValues(values: RecurrenceFormValues): RecurrenceFormValues {
		return { ...values, weekdays: [...values.weekdays] };
	}

	// The route keys the panel by rule, so the values are read once; later changes of the rule
	// (realtime, "Fortsetzen") show in the state block, not in fields the user may be editing.
	const creating = untrack(() => rule === null);
	const initialTemplate = untrack(() => templateOf(rule));
	const initialValues = untrack(() =>
		rule === null ? defaultFormValues(null, today) : formValuesOf(rule, today)
	);

	let title = $state(initialTemplate.title);
	let description = $state(initialTemplate.description);
	let project = $state(initialTemplate.project);
	let tagIds = $state<string[]>([...initialTemplate.tagIds]);
	let priority = $state<Priority>(initialTemplate.priority);
	let values = $state<RecurrenceFormValues>(copyValues(initialValues));
	let tagText = $state('');
	/** Values as last saved; unsaved input is measured against them. */
	let saved = $state({ template: initialTemplate, values: copyValues(initialValues) });

	let fieldErrors = $state<Partial<Record<keyof Template | 'tags', string>>>({});
	let rhythmErrors = $state<Partial<Record<RecurrenceFormField, string>>>({});
	let tagError = $state<string | null>(null);
	let message = $state<string | null>(null);
	let stateError = $state<string | null>(null);
	let busy = $state(false);
	let toggling = $state(false);
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	let confirmingDiscard = $state(false);

	let heading = $state<HTMLElement>();
	let titleInput = $state<HTMLInputElement>();
	let form = $state<HTMLFormElement>();

	const chosenTags = $derived(
		tagIds.flatMap((tagId) => {
			const tag = tags.find((entry) => entry.id === tagId);
			return tag === undefined ? [] : [tag];
		})
	);
	/** The project of the template, shown even if it is archived. */
	const currentProject = $derived(project === '' ? null : projectById(project));
	const tagsError = $derived(tagError ?? fieldErrors.tags ?? null);
	const templateNow = $derived<Template>({ title, description, project, tagIds, priority });
	const templateChanged = $derived(
		templateNow.title !== saved.template.title ||
			templateNow.description !== saved.template.description ||
			templateNow.project !== saved.template.project ||
			templateNow.tagIds.join(',') !== saved.template.tagIds.join(',') ||
			templateNow.priority !== saved.template.priority
	);
	const rhythmChanged = $derived(!sameRhythm(values, saved.values));
	const dirty = $derived(templateChanged || rhythmChanged || tagText.trim() !== '');

	// Focus when the panel opens: the title for "Neue Regel", else the heading (ADR-0025 section 6).
	$effect(() => {
		const target = creating ? titleInput : heading;
		if (target) untrack(() => target.focus());
	});

	function close() {
		if (busy || deleting) return;
		if (dirty) confirmingDiscard = true;
		else onclose();
	}

	/** Field errors of the server: rhythm fields to the form, template fields to theirs. */
	function fromServer(fields: Readonly<Record<string, string>>): void {
		const rhythm: Partial<Record<RecurrenceFormField, string>> = {};
		const template: Partial<Record<keyof Template | 'tags', string>> = {};
		const others: string[] = [];
		for (const [field, text] of Object.entries(fields)) {
			const formField = (Object.keys(SERVER_FIELDS) as RecurrenceFormField[]).find(
				(candidate) => SERVER_FIELDS[candidate] === field
			);
			if (formField !== undefined) rhythm[formField] = text;
			else if (
				field === 'title' ||
				field === 'description' ||
				field === 'project' ||
				field === 'tags' ||
				field === 'priority'
			) {
				template[field] = text;
			} else others.push(text);
		}
		rhythmErrors = rhythm;
		fieldErrors = template;
		if (others.length > 0) message = others[0] ?? null;
	}

	async function focusFirstError() {
		await tick();
		form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	function draftOf(withRhythm: boolean): Partial<RuleDraft> {
		const template = {
			title: title.trim(),
			description,
			project: project === '' ? null : project,
			// Only tags the catalog knows: a tag may have been deleted since.
			tags: chosenTags.map((tag) => tag.id),
			priority
		};
		return withRhythm ? { ...template, ...formParams(values) } : template;
	}

	async function save(event?: Event) {
		event?.preventDefault();
		if (busy) return;
		message = null;
		fieldErrors = title.trim() === '' ? { title: 'Bitte einen Titel eingeben.' } : {};
		rhythmErrors = formErrors(values);
		if (Object.keys(fieldErrors).length > 0 || Object.keys(rhythmErrors).length > 0) {
			await focusFirstError();
			return;
		}
		busy = true;
		const sentTemplate: Template = { ...templateNow, title: title.trim(), tagIds: [...tagIds] };
		const sentValues = copyValues(values);
		try {
			const result = await onsave(draftOf(creating || rhythmChanged));
			if (result.ok) {
				saved = { template: sentTemplate, values: sentValues };
				title = sentTemplate.title;
				onsaved?.(result.value);
				return;
			}
			fromServer(result.fields);
			if (result.message !== null) message = result.message;
		} finally {
			busy = false;
		}
		await focusFirstError();
	}

	/** "Pausieren" or "Fortsetzen"; a refusal stands at the button, a field error at its field. */
	async function toggle() {
		if (rule === null || ontoggle === undefined || toggling) return;
		toggling = true;
		stateError = null;
		try {
			const result = await ontoggle(!rule.active);
			if (!result.ok) {
				stateError = result.message ?? Object.values(result.fields)[0] ?? null;
				if (result.fields.project) fieldErrors = { ...fieldErrors, project: result.fields.project };
			}
		} finally {
			toggling = false;
		}
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

	function askDelete() {
		deleteError = null;
		confirmingDelete = true;
	}

	async function remove() {
		if (deleting || ondelete === undefined) return;
		deleting = true;
		deleteError = null;
		const result = await ondelete();
		deleting = false;
		if (result.ok) {
			confirmingDelete = false;
			ondeleted?.();
		} else if (result.message !== null) {
			deleteError = result.message;
		} else {
			confirmingDelete = false;
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (confirmingDiscard || confirmingDelete) return;
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void save();
		}
	}
</script>

<Drawer labelledby={ids.heading} closeFromFields onclose={close} {onkeydown}>
	{#snippet context()}
		{rule === null ? 'Wiederholungen' : 'Wiederholung'}
	{/snippet}
	{#snippet actions()}
		{#if rule !== null && ondelete}
			<button class="button-subtle" type="button" aria-haspopup="dialog" onclick={askDelete}>
				Löschen …
			</button>
		{/if}
	{/snippet}
	{#snippet footer()}
		{#if creating}
			<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
		{/if}
		<button class="button-primary" type="submit" form={ids.form} aria-disabled={busy}>
			{busy ? 'Wird gespeichert …' : creating ? 'Anlegen' : 'Speichern'}
		</button>
	{/snippet}

	<h2 id={ids.heading} tabindex="-1" bind:this={heading}>
		{rule === null ? 'Neue Regel' : rule.title}
	</h2>

	{#if rule !== null}
		{@const current = rule}
		<section class="state" aria-labelledby={ids.state}>
			<h3 id={ids.state} class="visually-hidden">Zustand</h3>
			<div class="summary">
				<Lozenge
					label={ruleStateLabel(current)}
					icon={current.active ? 'refresh' : 'pause'}
					tone={current.active ? 'brand' : 'muted'}
				/>
				{#if current.active}
					<span class="next">{nextTicketText(current, today)}</span>
				{/if}
			</div>
			<p class="open">
				Offenes Ticket:
				{#if openTicket}
					<a class="key-link" href={ticketHrefOf(openTicket.id)}>{openTicket.key}</a>
					<span class="open-title">{openTicket.title}</span>
				{:else}
					keins
				{/if}
			</p>
			{#if current.lastHint !== ''}
				<SectionMessage tone="info" compact>{current.lastHint}</SectionMessage>
			{/if}
			{#if ontoggle}
				<button
					class="button-secondary toggle"
					type="button"
					aria-disabled={toggling ? 'true' : undefined}
					onclick={() => void toggle()}
				>
					{current.active ? 'Pausieren' : 'Fortsetzen'}
				</button>
			{/if}
			{#if stateError}
				<SectionMessage tone="error" compact live>{stateError}</SectionMessage>
			{/if}
		</section>
	{/if}

	<form id={ids.form} class="form" novalidate onsubmit={save} bind:this={form}>
		<section class="group" aria-labelledby={ids.template}>
			<h3 id={ids.template}>Vorlage</h3>
			<div class="field">
				<label for={ids.title}>Titel</label>
				<input
					id={ids.title}
					type="text"
					required
					aria-required="true"
					autocomplete="off"
					maxlength={TITLE_MAX_LENGTH}
					aria-invalid={fieldErrors.title ? 'true' : undefined}
					aria-describedby={fieldErrors.title ? ids.titleError : undefined}
					bind:value={title}
					bind:this={titleInput}
				/>
				{#if fieldErrors.title}
					<p class="field-error" id={ids.titleError}>
						<ErrorIcon /><span>{fieldErrors.title}</span>
					</p>
				{/if}
			</div>

			<div class="field">
				<label for={ids.priority}>Priorität</label>
				<PrioritySelect
					id={ids.priority}
					value={priority}
					error={fieldErrors.priority ?? null}
					errorId={`${ids.priority}-error`}
					onchoose={(value) => {
						if (isPriority(value)) priority = value;
					}}
				/>
			</div>

			<div class="field">
				<label for={ids.project}>Projekt</label>
				<ProjectSelect
					id={ids.project}
					value={project}
					{projects}
					current={currentProject}
					error={fieldErrors.project ?? null}
					errorId={ids.projectError}
					hintId={ids.projectHint}
					onchoose={(value) => {
						project = value;
						stateError = null;
						fieldErrors = { ...fieldErrors, project: undefined };
					}}
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
					{busy}
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

			<MarkdownEditor
				label="Beschreibung"
				maxlength={DESCRIPTION_MAX_LENGTH}
				rows={4}
				bind:value={description}
				aria-invalid={fieldErrors.description ? 'true' : undefined}
				aria-describedby={fieldErrors.description ? ids.description : undefined}
			/>
			{#if fieldErrors.description}
				<p class="field-error" id={ids.description}>
					<ErrorIcon /><span>{fieldErrors.description}</span>
				</p>
			{/if}
			<p class="hint">
				{creating
					? 'Jedes Ticket der Regel bekommt diese Vorlage.'
					: 'Änderungen gelten für die nächsten Tickets; ein offenes Ticket bleibt, wie es ist.'}
			</p>
		</section>

		<section class="group" aria-labelledby={ids.rhythm}>
			<h3 id={ids.rhythm}>Rhythmus</h3>
			<RecurrenceForm bind:values errors={rhythmErrors} {today} />
			{#if creating}
				<p class="hint">
					Das erste Ticket entsteht, sobald der Vorlauf erreicht ist; liegt der erste Termin schon
					darin, sofort nach dem Anlegen.
				</p>
			{/if}
		</section>

		<div aria-live="assertive">
			{#if message}
				<p class="alert-error"><ErrorIcon /><span>{message}</span></p>
			{/if}
		</div>
		<p class="hint">Tipp: <kbd>Strg</kbd>+<kbd>Enter</kbd> speichert.</p>
	</form>
</Drawer>

{#if rule !== null}
	<ConfirmDialog
		open={confirmingDelete}
		title="Regel löschen?"
		confirmLabel="Löschen"
		busy={deleting}
		error={deleteError}
		onconfirm={remove}
		oncancel={() => {
			confirmingDelete = false;
			deleteError = null;
		}}
	>
		<p>
			Bestehende Tickets bleiben erhalten. „{rule.title}“ erzeugt danach keine Tickets mehr{openTicket
				? `; ${openTicket.key} bleibt als normales Ticket offen`
				: ''}.
		</p>
	</ConfirmDialog>
{/if}

<ConfirmDialog
	open={confirmingDiscard}
	title={creating ? 'Neue Regel verwerfen?' : 'Änderungen verwerfen?'}
	confirmLabel="Verwerfen"
	cancelLabel="Weiter bearbeiten"
	onconfirm={() => {
		confirmingDiscard = false;
		onclose();
	}}
	oncancel={() => (confirmingDiscard = false)}
>
	<p>Die Eingaben gehen verloren.</p>
</ConfirmDialog>

<style>
	h2 {
		font-size: 1.125rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	h3 {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	p {
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.state {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
	}

	.summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 0.75rem;
		align-items: center;
		font-size: 0.8125rem;
	}

	.next {
		color: var(--color-text-muted);
	}

	.open {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.open-title {
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.key-link {
		font-family: var(--font-mono);
		color: var(--color-brand-text);
	}

	.form {
		display: grid;
		gap: 1.25rem;
	}

	.group {
		display: grid;
		gap: 0.875rem;
		min-width: 0;
	}

	.field {
		display: grid;
		gap: 0.375rem;
		align-content: start;
		min-width: 0;
	}

	label {
		font-size: 0.8125rem;
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

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
