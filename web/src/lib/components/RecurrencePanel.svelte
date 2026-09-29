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
		isWaiting,
		nextTicketText,
		openBlockText,
		ruleStateLabel,
		sameRhythm,
		type BacklogChoice,
		type OpenInstance,
		type RecurrenceFormField,
		type RecurrenceFormValues,
		type RecurrenceRule
	} from '$lib/domain/recurrence-rule';
	import {
		DEFAULT_TEMPLATE_STATUS,
		templateChanges,
		templateOf,
		type RuleTemplate
	} from '$lib/domain/series-template';
	import { DEFAULT_PRIORITY, type ProjectRef, type TagRef } from '$lib/domain/ticket';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import { helpHref } from '$lib/settings-sections';
	import ErrorIcon from './ErrorIcon.svelte';
	import Lozenge from './guidance/Lozenge.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import Drawer from './overlay/Drawer.svelte';
	import RecurrenceBacklogQuestion from './RecurrenceBacklogQuestion.svelte';
	import RecurrenceForm from './RecurrenceForm.svelte';
	import RecurrenceTemplateFields from './RecurrenceTemplateFields.svelte';

	// Panel of a rule (E5 plan, T-6 and package 5) on the side panel building block, like the
	// project panel (UI-8): "Neue Regel" under /wiederholungen/neu and a rule under
	// /wiederholungen/<id>. The template (title, priority, "Status beim Anlegen" since plan WV,
	// project, tags, description; the same fields as the inline editor at the ticket) and the
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
		openTickets = [],
		eachAvailable = false,
		statusAvailable = false,
		ticketHrefOf,
		oncreatetag,
		onsave,
		ontoggle,
		ondecide,
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
		/** Open tickets of the rule, oldest first; empty without one or while unknown. */
		openTickets?: readonly OpenInstance[];
		/** Offer "Jeden Termin einzeln anlegen" (plan OR-5, RecurrenceStore.eachReady). */
		eachAvailable?: boolean;
		/** Offer "Status beim Anlegen" and send it (plan WV, RecurrenceStore.statusReady). */
		statusAvailable?: boolean;
		ticketHrefOf: (ticketId: string) => ResolvedPathname;
		/** Existing or new tag for a typed name (E3 plan, T-14). */
		oncreatetag: (name: string) => Promise<EnsureTagResult>;
		/** A new rule gets the whole draft, an existing one the changed parts. */
		onsave: (draft: Partial<RuleDraft>) => Promise<EditResult<RecurrenceRule>>;
		/** "Pausieren" and "Fortsetzen" of a rule. */
		ontoggle?: (active: boolean) => Promise<EditResult<RecurrenceRule>>;
		/** The choice about a large backlog (ADR-0022 addendum 5). */
		ondecide?: (choice: BacklogChoice) => Promise<EditResult<RecurrenceRule>>;
		/** "Löschen …" of a rule. */
		ondelete?: () => Promise<EditResult<void>>;
		/** After saving: the saved rule (a new one gets its own panel). */
		onsaved?: (rule: RecurrenceRule) => void;
		/** After deleting: back to the overview. */
		ondeleted?: () => void;
		/** × and Escape (after the question about unsaved input). */
		onclose: () => void;
	} = $props();

	/** Fields of the template, by the names of the server. */
	type TemplateErrorField =
		'title' | 'description' | 'project' | 'tags' | 'priority' | 'initial_status';
	const TEMPLATE_ERROR_FIELDS: readonly string[] = [
		'title',
		'description',
		'project',
		'tags',
		'priority',
		'initial_status'
	];

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		form: `${uid}-form`,
		template: `${uid}-template`,
		rhythm: `${uid}-rhythm`,
		state: `${uid}-state`
	};

	/** The template of a rule, or the empty one of "Neue Regel". */
	function initialTemplateOf(source: RecurrenceRule | null): RuleTemplate {
		return source === null
			? {
					title: '',
					description: '',
					projectId: null,
					tagIds: [],
					priority: DEFAULT_PRIORITY,
					initialStatus: DEFAULT_TEMPLATE_STATUS
				}
			: templateOf(source);
	}

	function copyValues(values: RecurrenceFormValues): RecurrenceFormValues {
		return { ...values, weekdays: [...values.weekdays] };
	}

	// The route keys the panel by rule, so the values are read once; later changes of the rule
	// (realtime, "Fortsetzen") show in the state block, not in fields the user may be editing.
	const creating = untrack(() => rule === null);
	const initialTemplate = untrack(() => initialTemplateOf(rule));
	const initialValues = untrack(() =>
		rule === null ? defaultFormValues(null, today) : formValuesOf(rule, today)
	);

	let template = $state<RuleTemplate>({ ...initialTemplate, tagIds: [...initialTemplate.tagIds] });
	let values = $state<RecurrenceFormValues>(copyValues(initialValues));
	let tagText = $state('');
	/** Values as last saved; unsaved input is measured against them. */
	let saved = $state({ template: initialTemplate, values: copyValues(initialValues) });

	let fieldErrors = $state<Partial<Record<TemplateErrorField, string>>>({});
	let rhythmErrors = $state<Partial<Record<RecurrenceFormField, string>>>({});
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

	/** The project of the template, shown even if it is archived. */
	const currentProject = $derived(
		template.projectId === null ? null : projectById(template.projectId)
	);
	const templateChanged = $derived(
		Object.keys(templateChanges(saved.template, template)).length > 0
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
		const templateErrors: Partial<Record<TemplateErrorField, string>> = {};
		const others: string[] = [];
		for (const [field, text] of Object.entries(fields)) {
			const formField = (Object.keys(SERVER_FIELDS) as RecurrenceFormField[]).find(
				(candidate) => SERVER_FIELDS[candidate] === field
			);
			if (formField !== undefined) rhythm[formField] = text;
			else if (TEMPLATE_ERROR_FIELDS.includes(field)) {
				templateErrors[field as TemplateErrorField] = text;
			} else others.push(text);
		}
		rhythmErrors = rhythm;
		fieldErrors = templateErrors;
		if (others.length > 0) message = others[0] ?? null;
	}

	async function focusFirstError() {
		await tick();
		form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	function draftOf(withRhythm: boolean): Partial<RuleDraft> {
		const draft: Partial<RuleDraft> = {
			title: template.title.trim(),
			description: template.description,
			project: template.projectId,
			// Only tags the catalog knows: a tag may have been deleted since.
			tags: template.tagIds.filter((tagId) => tags.some((tag) => tag.id === tagId)),
			priority: template.priority,
			// Only a server after the migration knows the field (plan WV).
			...(statusAvailable && { initial_status: template.initialStatus })
		};
		return withRhythm ? { ...draft, ...formParams(values) } : draft;
	}

	async function save(event?: Event) {
		event?.preventDefault();
		if (busy) return;
		message = null;
		fieldErrors = template.title.trim() === '' ? { title: 'Bitte einen Titel eingeben.' } : {};
		rhythmErrors = formErrors(values);
		if (Object.keys(fieldErrors).length > 0 || Object.keys(rhythmErrors).length > 0) {
			await focusFirstError();
			return;
		}
		busy = true;
		const sentTemplate: RuleTemplate = {
			...template,
			title: template.title.trim(),
			tagIds: [...template.tagIds]
		};
		const sentValues = copyValues(values);
		try {
			const result = await onsave(draftOf(creating || rhythmChanged));
			if (result.ok) {
				saved = { template: sentTemplate, values: sentValues };
				template = { ...template, title: sentTemplate.title };
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

	/** The choice about a large backlog; a refusal stands below the state like one of "Fortsetzen". */
	async function decide(choice: BacklogChoice) {
		if (ondecide === undefined || toggling) return;
		toggling = true;
		stateError = null;
		try {
			const result = await ondecide(choice);
			if (!result.ok) stateError = result.message ?? Object.values(result.fields)[0] ?? null;
		} finally {
			toggling = false;
		}
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
		{@const waiting = isWaiting(current)}
		<section class="state" aria-labelledby={ids.state}>
			<h3 id={ids.state} class="visually-hidden">Zustand</h3>
			<div class="summary">
				<Lozenge
					label={ruleStateLabel(current)}
					icon={waiting ? 'warning' : current.active ? 'refresh' : 'pause'}
					tone={waiting ? 'neutral' : current.active ? 'brand' : 'muted'}
				/>
				{#if current.active}
					<span class="next"
						>{nextTicketText(
							current,
							today,
							openTickets.map((open) => open.key)
						)}</span
					>
				{/if}
			</div>
			<!-- All open tickets of the rule, not only one (recommendation 7). -->
			{#if openTickets.length > 1}
				<div class="open">
					<span>Offene Tickets ({openTickets.length}):</span>
					<ul class="open-list">
						{#each openTickets as open (open.id)}
							<li>
								<a class="key-link" href={ticketHrefOf(open.id)}>{open.key}</a>
								<span class="open-title">{open.title}</span>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="open">
					Offenes Ticket:
					{#if openTickets[0]}
						<a class="key-link" href={ticketHrefOf(openTickets[0].id)}>{openTickets[0].key}</a>
						<span class="open-title">{openTickets[0].title}</span>
					{:else}
						keins
					{/if}
				</p>
			{/if}
			{#if !current.eachOccurrence && current.active && openTickets.length > 1}
				<!-- The switch went off while several were open (recommendation 6). -->
				<SectionMessage tone="info" compact>
					{openBlockText(openTickets.map((open) => open.key))}
				</SectionMessage>
			{/if}
			{#if waiting}
				<RecurrenceBacklogQuestion
					rule={current}
					{today}
					busy={toggling}
					ondecide={(choice) => void decide(choice)}
				/>
			{:else if current.lastHint !== ''}
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
			<RecurrenceTemplateFields
				bind:values={template}
				bind:tagText
				bind:titleInput
				errors={fieldErrors}
				{projects}
				{tags}
				{currentProject}
				{busy}
				{statusAvailable}
				{oncreatetag}
				onprojectchosen={() => {
					stateError = null;
					fieldErrors = { ...fieldErrors, project: undefined };
				}}
			/>
			<p class="hint">
				{creating
					? 'Jedes Ticket der Regel bekommt diese Vorlage.'
					: 'Änderungen gelten für die nächsten Tickets; ein offenes Ticket bleibt, wie es ist.'}
			</p>
		</section>

		<section class="group" aria-labelledby={ids.rhythm}>
			<div class="rhythm-head">
				<h3 id={ids.rhythm}>Rhythmus</h3>
				<!-- The help with the examples; a new tab keeps the input of the panel. -->
				<a class="help-link" href={helpHref('wiederholungen')} target="_blank" rel="noopener"
					>So funktionieren Wiederholungen (neuer Tab)</a
				>
			</div>
			<RecurrenceForm
				bind:values
				errors={rhythmErrors}
				{today}
				{eachAvailable}
				context={rule === null
					? undefined
					: { kind: 'rule', nextDue: rule.nextDue, each: rule.eachOccurrence === true }}
				openKeys={openTickets.map((open) => open.key)}
			/>
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
			Bestehende Tickets bleiben erhalten. „{rule.title}“ erzeugt danach keine Tickets mehr{openTickets.length ===
			1
				? `; ${openTickets[0]?.key} bleibt als normales Ticket offen`
				: openTickets.length > 1
					? `; ${openTickets.map((open) => open.key).join(', ')} bleiben als normale Tickets offen`
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
		font-size: var(--font-size-title);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	h3 {
		font-size: var(--font-size-control);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	p {
		font-size: var(--font-size-body);
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
		font-size: var(--font-size-control);
	}

	.next {
		color: var(--color-text-muted);
	}

	.open {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.open-title {
		color: var(--color-text);
		overflow-wrap: anywhere;
	}

	.rhythm-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
		justify-content: space-between;
	}

	.help-link {
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
	}

	.open-list {
		display: grid;
		gap: 0.125rem;
		width: 100%;
		list-style: none;
	}

	.open-list li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
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

	.form :global(select) {
		max-width: 100%;
		padding: 0.375rem 0.5rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
