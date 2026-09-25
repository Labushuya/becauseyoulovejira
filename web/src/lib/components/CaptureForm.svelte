<script lang="ts">
	import { untrack } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { INBOX_BODY_MAX_LENGTH, INBOX_SOURCE_URL_MAX_LENGTH } from '$lib/domain/inbox';
	import { isPriority } from '$lib/domain/status';
	import {
		CAPTURE_TEMPLATES,
		DEFAULT_CAPTURE_TARGET,
		EMPTY_CAPTURE_INPUT,
		FIXED_TARGETS,
		TEMPLATE_FIELDS,
		TEMPLATE_LABELS,
		TEMPLATE_TAGS,
		buildCapture,
		targetOf,
		type Capture,
		type CaptureErrors,
		type CaptureField,
		type CaptureInput,
		type CaptureTarget,
		type CaptureTemplate
	} from '$lib/domain/templates';
	import { TITLE_MAX_LENGTH, type ProjectRef, type TagRef } from '$lib/domain/ticket';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import type { CaptureSaveResult } from '$lib/stores/capture';
	import ErrorIcon from './ErrorIcon.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import TagPicker from './TagPicker.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';

	// Capture by template (E4 plan, package 5; OF-E4-1 (a)): a radio group of the fixed templates,
	// the fields of the chosen one with required marks and field errors (ADR-0009), and the target
	// after OF-E4-3: a ticket by default, the inbox with the switch or Alt+Enter. Ctrl+Enter saves
	// to the chosen target. After saving, the form empties for the next object, keeps the
	// template and announces the result with a link. A web link (package 7, bookmarklet) always
	// goes into the inbox; the form comes filled from the page, and nothing is saved before the
	// click. A duplicate is named neutrally with a link to what exists.
	let {
		template,
		initial = {},
		hint = null,
		projects = [],
		tags = [],
		oncreatetag = async () => ({ ok: false, message: null }),
		ontemplate,
		onsave,
		onclose,
		resultHref
	}: {
		template: CaptureTemplate;
		/** Values the form starts with (bookmarklet); read once. */
		initial?: Partial<CaptureInput>;
		/** Neutral note above the form, e.g. why the address of a page was not taken. */
		hint?: string | null;
		/** Projects that can be chosen (the active ones). */
		projects?: readonly ProjectRef[];
		/** Tags that can be chosen (the catalog). */
		tags?: readonly TagRef[];
		/** Existing or new tag for a typed name. */
		oncreatetag?: (name: string) => Promise<EnsureTagResult>;
		/** Another template was chosen; the route keeps it in the URL. */
		ontemplate: (template: CaptureTemplate) => void;
		onsave: (capture: Capture, target: CaptureTarget) => Promise<CaptureSaveResult>;
		onclose: () => void;
		/** Address of a saved ticket or entry, for the link in the result. */
		resultHref: (target: CaptureTarget, id: string) => ResolvedPathname;
	} = $props();

	/** The question before entered data is lost (ADR-0025 section 4); "Weiter bearbeiten" keeps it. */
	let confirmingDiscard = $state(false);

	const uid = $props.id();
	const fieldId = (field: CaptureField) => `${uid}-${field}`;
	const errorId = (field: CaptureField) => `${uid}-${field}-error`;
	const headingId = `${uid}-heading`;
	const targetHintId = `${uid}-target-hint`;

	const start: CaptureInput = untrack(() => ({ ...EMPTY_CAPTURE_INPUT, tagIds: [], ...initial }));
	let input = $state<CaptureInput>({ ...start, tagIds: [...start.tagIds] });
	/** Values that count as untouched: the start, after a save the empty form. */
	let baseline = $state<CaptureInput>(start);
	let tagText = $state('');
	let target = $state<CaptureTarget>(DEFAULT_CAPTURE_TARGET);
	const fixedTarget = $derived(FIXED_TARGETS[template] ?? null);
	const effectiveTarget = $derived(targetOf(template, target));
	let errors = $state<CaptureErrors>({});
	let pending = $state(false);
	let message = $state<string | null>(null);
	let result = $state<{
		text: string;
		/** Link to the saved or existing ticket or entry; null if the server named none. */
		href: ResolvedPathname | null;
		target: CaptureTarget;
	} | null>(null);
	let form = $state<HTMLFormElement>();

	const fields = $derived(TEMPLATE_FIELDS[template]);
	const templateTag = $derived(TEMPLATE_TAGS[template]);
	const chosenTags = $derived(
		input.tagIds.flatMap((id) => tags.filter((tag) => tag.id === id).slice(0, 1))
	);
	const dirty = $derived(
		Object.entries(input).some(([key, value]) =>
			key === 'tagIds'
				? (value as string[]).join(',') !== baseline.tagIds.join(',')
				: value !== baseline[key as keyof CaptureInput]
		) || tagText.trim() !== ''
	);

	/** Focus on the first field of the template (on open and after saving). */
	function focusFirst() {
		form?.querySelector<HTMLElement>('[data-capture-field]')?.focus();
	}

	$effect(() => {
		focusFirst();
	});

	function chooseTemplate(next: CaptureTemplate) {
		errors = {};
		message = null;
		ontemplate(next);
	}

	async function save(to: CaptureTarget, event?: Event) {
		event?.preventDefault();
		if (pending) return;
		message = null;
		result = null;
		const built = buildCapture(template, input);
		if (!built.ok) {
			errors = built.errors;
			const first = fields.find((entry) => built.errors[entry.field] !== undefined);
			if (first !== undefined) document.getElementById(fieldId(first.field))?.focus();
			return;
		}
		errors = {};
		pending = true;
		const outcome = await onsave(built.capture, targetOf(template, to));
		pending = false;
		if (!outcome.ok && outcome.duplicate !== undefined) {
			// Already there: a result, not an error; the input stays for a change.
			const { itemId, ticketId } = outcome.duplicate;
			const existing: CaptureTarget | null =
				ticketId !== '' ? 'ticket' : itemId !== '' ? 'inbox' : null;
			result =
				existing === null
					? { text: outcome.message ?? '', href: null, target: 'inbox' }
					: {
							text: outcome.message ?? '',
							href: resultHref(existing, existing === 'ticket' ? ticketId : itemId),
							target: existing
						};
			return;
		}
		if (!outcome.ok) {
			message = outcome.message;
			errors = outcome.fields;
			return;
		}
		result = {
			text: outcome.message,
			href: resultHref(outcome.target, outcome.id),
			target: outcome.target
		};
		input = { ...EMPTY_CAPTURE_INPUT, tagIds: [] };
		baseline = input;
		tagText = '';
		focusFirst();
	}

	function close() {
		if (pending) return;
		if (dirty) confirmingDiscard = true;
		else onclose();
	}

	function onkeydown(event: KeyboardEvent) {
		if (confirmingDiscard) return;
		if (event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.metaKey) {
			event.preventDefault();
			void save('inbox');
		} else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void save(effectiveTarget);
		} else if (event.key === 'Escape' && !event.defaultPrevented) {
			event.preventDefault();
			close();
		}
	}

	function describedBy(field: CaptureField, hint?: string): string | undefined {
		const ids = [hint, errors[field] ? errorId(field) : undefined].filter(Boolean);
		return ids.length === 0 ? undefined : ids.join(' ');
	}

	async function createTag(name: string): Promise<boolean> {
		const created = await oncreatetag(name);
		if (!created.ok) {
			errors = { ...errors, tags: created.message ?? undefined };
			return false;
		}
		if (!input.tagIds.includes(created.tag.id)) input.tagIds = [...input.tagIds, created.tag.id];
		return true;
	}
</script>

{#snippet fieldError(field: CaptureField)}
	{#if errors[field]}
		<p class="field-error" id={errorId(field)}><ErrorIcon /><span>{errors[field]}</span></p>
	{/if}
{/snippet}

{#snippet label(field: CaptureField, text: string, required: boolean)}
	<label for={fieldId(field)}>
		{text}{#if required}<span class="required"> (Pflichtfeld)</span>{/if}
	</label>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="side-panel" aria-labelledby={headingId} {onkeydown}>
	<h2 id={headingId}>Erfassen</h2>
	{#if hint}
		<p class="hint" role="note">{hint}</p>
	{/if}

	<div aria-live="polite">
		{#if result}
			<p class="result">
				{result.text}
				{#if result.href !== null}
					<a href={result.href}>
						{result.target === 'ticket' ? 'Ticket ansehen' : 'Eintrag ansehen'}
					</a>
				{/if}
			</p>
		{/if}
	</div>
	<div aria-live="assertive">
		{#if message}
			<p class="alert-error"><ErrorIcon /><span>{message}</span></p>
		{/if}
	</div>

	<form class="form" novalidate onsubmit={(event) => save(effectiveTarget, event)} bind:this={form}>
		<fieldset class="templates">
			<legend>Vorlage</legend>
			{#each CAPTURE_TEMPLATES as option (option)}
				<label class="template">
					<input
						type="radio"
						name={`${uid}-template`}
						value={option}
						checked={option === template}
						onchange={() => chooseTemplate(option)}
					/>
					{TEMPLATE_LABELS[option]}
				</label>
			{/each}
		</fieldset>

		{#each fields as { field, label: text, required } (field)}
			<div class="field">
				{#if field === 'items' || field === 'excerpt'}
					{@render label(field, text, required)}
					<textarea
						id={fieldId(field)}
						data-capture-field
						rows="5"
						maxlength={field === 'excerpt' ? INBOX_BODY_MAX_LENGTH : undefined}
						required={required || undefined}
						aria-required={required ? 'true' : undefined}
						aria-invalid={errors[field] ? 'true' : undefined}
						aria-describedby={describedBy(field)}
						bind:value={input[field]}></textarea>
				{:else if field === 'date' || field === 'due'}
					{@render label(field, text, required)}
					<input
						id={fieldId(field)}
						data-capture-field
						type="date"
						required={required || undefined}
						aria-required={required ? 'true' : undefined}
						aria-invalid={errors[field] ? 'true' : undefined}
						aria-describedby={describedBy(field, field === 'date' ? `${uid}-date-hint` : undefined)}
						bind:value={input[field]}
					/>
					{#if field === 'date'}
						<p class="hint" id={`${uid}-date-hint`}>
							Der Termin wird nicht zur Fälligkeit des Tickets.
						</p>
					{/if}
				{:else if field === 'url'}
					{@render label(field, text, required)}
					<input
						id={fieldId(field)}
						data-capture-field
						type="url"
						inputmode="url"
						maxlength={INBOX_SOURCE_URL_MAX_LENGTH}
						required={required || undefined}
						aria-required={required ? 'true' : undefined}
						aria-invalid={errors[field] ? 'true' : undefined}
						aria-describedby={describedBy(field)}
						bind:value={input.url}
					/>
				{:else if field === 'time'}
					{@render label(field, text, required)}
					<input
						id={fieldId(field)}
						data-capture-field
						type="time"
						aria-invalid={errors[field] ? 'true' : undefined}
						aria-describedby={describedBy(field)}
						bind:value={input.time}
					/>
				{:else if field === 'priority'}
					{@render label(field, text, required)}
					<PrioritySelect
						id={fieldId(field)}
						value={input.priority}
						disabled={pending}
						error={errors.priority ?? null}
						errorId={errorId(field)}
						onchoose={(value) => {
							if (isPriority(value)) input.priority = value;
						}}
					/>
				{:else if field === 'project'}
					{@render label(field, text, required)}
					<select
						id={fieldId(field)}
						data-capture-field
						required={required || undefined}
						aria-required={required ? 'true' : undefined}
						aria-invalid={errors[field] ? 'true' : undefined}
						aria-describedby={describedBy(field)}
						bind:value={input.project}
					>
						<option value="">Projekt wählen</option>
						{#each projects as project (project.id)}
							<option value={project.id}>{project.name} ({project.code})</option>
						{/each}
					</select>
				{:else if field === 'tags'}
					{@render label(field, text, required)}
					<TagPicker
						id={fieldId(field)}
						selected={chosenTags}
						{tags}
						bind:text={tagText}
						busy={pending}
						error={errors.tags ?? null}
						errorId={errorId(field)}
						onadd={(id) => {
							if (!input.tagIds.includes(id)) input.tagIds = [...input.tagIds, id];
							return true;
						}}
						onremove={(id) => {
							input.tagIds = input.tagIds.filter((entry) => entry !== id);
							return true;
						}}
						oncreate={createTag}
					/>
				{:else}
					{@render label(field, text, required)}
					<input
						id={fieldId(field)}
						data-capture-field
						type={field === 'phone' ? 'tel' : 'text'}
						maxlength={TITLE_MAX_LENGTH}
						required={required || undefined}
						aria-required={required ? 'true' : undefined}
						aria-invalid={errors[field] ? 'true' : undefined}
						aria-describedby={describedBy(field)}
						bind:value={input[field]}
					/>
				{/if}
				{@render fieldError(field)}
			</div>
		{/each}

		{#if templateTag !== null}
			<p class="hint">Bekommt den Tag „{templateTag}“.</p>
		{/if}

		{#if fixedTarget === null}
			<label class="target">
				<input
					type="checkbox"
					checked={target === 'inbox'}
					aria-describedby={targetHintId}
					onchange={(event) => (target = event.currentTarget.checked ? 'inbox' : 'ticket')}
				/>
				In den Eingang statt direkt als Ticket
			</label>
		{:else}
			<p class="hint">Web-Links kommen immer in den Eingang.</p>
		{/if}

		<div class="buttons">
			<button class="button-primary" type="submit" aria-disabled={pending ? 'true' : undefined}>
				{pending
					? 'Wird gespeichert …'
					: effectiveTarget === 'inbox'
						? 'In den Eingang'
						: 'Ticket anlegen'}
			</button>
			<button class="button-secondary" type="button" onclick={close}>Schließen</button>
		</div>
		<p class="hint" id={targetHintId}>Tipp: Strg+Enter speichert, Alt+Enter legt in den Eingang.</p>
	</form>
</aside>

<ConfirmDialog
	open={confirmingDiscard}
	title="Erfassung verwerfen?"
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
	}

	.form {
		display: grid;
		gap: 1rem;
	}

	.templates {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 1rem;
		padding: 0;
		border: none;
	}

	legend {
		width: 100%;
		margin-bottom: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.template,
	.target {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		cursor: pointer;
	}

	.field {
		display: grid;
		gap: 0.375rem;
		align-content: start;
	}

	.field > label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.required {
		font-weight: 400;
	}

	.field input,
	.field textarea,
	.field select,
	.form :global(select) {
		padding: 0.375rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
	}

	.field input[type='text'],
	.field input[type='tel'],
	.field input[type='url'],
	.field textarea {
		width: 100%;
		font: inherit;
	}

	.buttons {
		display: flex;
		gap: 0.5rem;
	}

	.button-primary[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.6;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.result {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		margin-top: 0.5rem;
	}

	.result a {
		color: var(--color-brand-text);
	}
</style>
