<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import type { RuleDraft } from '$lib/data/recurrence';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		INITIAL_STATUS_REQUIRED,
		SERVER_FIELDS,
		defaultFormValues,
		formErrors,
		formParams,
		formValuesOf,
		isWaiting,
		nextTicketText,
		openBlockText,
		ruleDeleteText,
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
		subtasksWithoutTitle,
		templateChanges,
		templateOf,
		trimmedSubtasks,
		type RuleTemplate,
		type TemplateStatus
	} from '$lib/domain/series-template';
	import { DEFAULT_PRIORITY, type ProjectRef, type TagRef } from '$lib/domain/ticket';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import { helpHref } from '$lib/settings-sections';
	import { appHref } from '$lib/ticket-links';
	import ErrorIcon from './ErrorIcon.svelte';
	import Lozenge from './guidance/Lozenge.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import InitialStatusChoice from './InitialStatusChoice.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import Drawer from './overlay/Drawer.svelte';
	import RecurrenceBacklogQuestion from './RecurrenceBacklogQuestion.svelte';
	import RecurrenceForm from './RecurrenceForm.svelte';
	import RecurrenceTemplateFields from './RecurrenceTemplateFields.svelte';
	import TicketLeaveQuestion from './TicketLeaveQuestion.svelte';

	// Panel of a rule (E5 plan, T-6 and package 5) on the side panel building block, like the
	// project panel (UI-8): "Neue Regel" under /wiederholungen/neu and a rule under
	// /wiederholungen/<id>. The template (title, priority, "Status beim Anlegen" since plan WV,
	// project, tags, description; the same fields as the inline editor at the ticket; "Neue Regel"
	// asks it as "Folgetickets starten mit" without an answer in advance, ADR-0022 addendum 9) and the
	// rhythm (RecurrenceForm with the preview "Nächste Termine") in one form. A rule also shows its
	// state with the next ticket, its open ticket, the neutral hint of the server and "Pausieren" or
	// "Fortsetzen"; "Löschen …" in the header asks "Regel löschen?" (its tickets stay, ADR-0023
	// section 7). Saving an existing rule sends the rhythm only when it changed: a new template
	// never changes the open ticket, a new rhythm makes the hook compute the next ticket again
	// (ADR-0023 section 5). Field errors stand at their field, among them the one of "Fortsetzen"
	// with an archived project (ADR-0023 section 8); Escape and × ask before unsaved input is lost.
	// The owner navigates; the store shows the flags. Since WV-3 the template has the list
	// "Unteraufgaben" (after its migration, `subtasksAvailable`). Tickets in the rules (ADR-0054): a
	// link that replaces the panel (a ticket, another rule, another view) asks "Änderungen
	// verwerfen?" inline at the top while input is unsaved, never as a dialog; back from a ticket
	// the focus goes to its link (`initialFocus`).
	let {
		rule = null,
		today,
		projects,
		tags,
		projectById,
		openTickets = [],
		eachAvailable = false,
		statusAvailable = false,
		subtasksAvailable = false,
		colorsAvailable = false,
		ticketHrefOf,
		oncreatetag,
		onsave,
		ontoggle,
		ondecide,
		ondelete,
		onsaved,
		ondeleted,
		onclose,
		initialFocus = null
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
		/** Offer the sub-tasks of the template and send them (plan WV-3, RecurrenceStore.subtasksReady). */
		subtasksAvailable?: boolean;
		/** Offer the color of the template and send it (ADR-0052, CatalogStore.colorsReady). */
		colorsAvailable?: boolean;
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
		/**
		 * Where the focus goes when the panel opens instead of its title: the link of the ticket the
		 * user came back from (ADR-0054 §7); null or no element keeps the title.
		 */
		initialFocus?: (() => HTMLElement | null) | null;
	} = $props();

	/** Fields of the template, by the names of the server. */
	type TemplateErrorField =
		| 'title'
		| 'description'
		| 'project'
		| 'tags'
		| 'priority'
		| 'initial_status'
		| 'template_subtasks'
		| 'color';
	const TEMPLATE_ERROR_FIELDS: readonly string[] = [
		'title',
		'description',
		'project',
		'tags',
		'priority',
		'initial_status',
		'template_subtasks',
		'color'
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
					initialStatus: DEFAULT_TEMPLATE_STATUS,
					subtasks: [],
					color: null
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
	/** "Neue Regel": the answer to "Folgetickets starten mit"; '' while none is given. */
	let chosenStatus = $state<TemplateStatus | ''>('');
	/** A new rule asks for the status of its tickets (ADR-0022 addendum 9), a saved one shows it. */
	const askStatus = $derived(creating && statusAvailable);
	/** Values as last saved; unsaved input is measured against them. */
	let saved = $state({ template: initialTemplate, values: copyValues(initialValues) });

	let fieldErrors = $state<Partial<Record<TemplateErrorField, string>>>({});
	/** Rows of the list of sub-tasks without a title (checked before sending). */
	let invalidSubtasks = $state<number[]>([]);
	let rhythmErrors = $state<Partial<Record<RecurrenceFormField, string>>>({});
	let message = $state<string | null>(null);
	let stateError = $state<string | null>(null);
	let busy = $state(false);
	let toggling = $state(false);
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	/** Keys of the open tickets, which stay as normal ones when the rule is deleted. */
	const openKeys = $derived(openTickets.map((open) => open.key));
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
	const dirty = $derived(
		templateChanged || rhythmChanged || tagText.trim() !== '' || (askStatus && chosenStatus !== '')
	);

	// Focus when the panel opens: the title for "Neue Regel", else the heading (ADR-0025 section 6),
	// or the link of the ticket the user came back from (ADR-0054 §7).
	$effect(() => {
		const target = creating ? titleInput : heading;
		if (target) untrack(() => (creating ? target : (initialFocus?.() ?? target)).focus());
	});

	/** A link that replaces the panel, held up by the question (ADR-0054 §7). */
	let leaving = $state<{ url: URL; delta: number | undefined } | null>(null);
	/** Set when the panel is left on purpose ("Verwerfen", deleting): no question then. */
	let discarding = false;

	// Unsaved input asks before a link replaces the panel, inline, because the link may come from a
	// dialog and no dialog opens from a dialog (ADR-0025 addendum 16). Saving (also the new rule,
	// which then gets its own panel) and changes of the query only pass.
	beforeNavigate((navigation) => {
		const to = navigation.to;
		if (discarding || busy || deleting || navigation.type === 'leave' || to === null) return;
		if (!to.route.id?.startsWith('/(app)/')) return;
		if (navigation.from !== null && to.url.pathname === navigation.from.url.pathname) return;
		if (!dirty) return;
		navigation.cancel();
		leaving = {
			url: to.url,
			delta: navigation.type === 'popstate' ? navigation.delta : undefined
		};
	});

	async function discardAndLeave() {
		const target = leaving;
		leaving = null;
		if (target === null) return;
		discarding = true;
		if (target.delta !== undefined && target.delta !== 0) history.go(target.delta);
		else await goto(appHref(target.url));
	}

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
			// Only a server after the migration knows the field (plan WV); a new rule sends the answer
			// to "Folgetickets starten mit" (ADR-0022 addendum 9).
			...(statusAvailable && {
				initial_status: askStatus && chosenStatus !== '' ? chosenStatus : template.initialStatus
			}),
			// The whole list, only for a server after its migration (plan WV-3).
			...(subtasksAvailable && { template_subtasks: trimmedSubtasks(template.subtasks) }),
			// The color of the next tickets, only for a server after its migration (ADR-0052).
			...(colorsAvailable && { color: template.color })
		};
		return withRhythm ? { ...draft, ...formParams(values) } : draft;
	}

	async function save(event?: Event) {
		event?.preventDefault();
		if (busy) return;
		message = null;
		fieldErrors = {
			...(template.title.trim() === '' && { title: 'Bitte einen Titel eingeben.' }),
			...(askStatus && chosenStatus === '' && { initial_status: INITIAL_STATUS_REQUIRED })
		};
		invalidSubtasks = subtasksAvailable ? subtasksWithoutTitle(template.subtasks) : [];
		rhythmErrors = formErrors(values);
		if (
			Object.keys(fieldErrors).length > 0 ||
			invalidSubtasks.length > 0 ||
			Object.keys(rhythmErrors).length > 0
		) {
			await focusFirstError();
			return;
		}
		busy = true;
		const sentTemplate: RuleTemplate = {
			...template,
			title: template.title.trim(),
			tagIds: [...template.tagIds],
			subtasks: trimmedSubtasks(template.subtasks)
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
			discarding = true;
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
		<button
			class="button-primary"
			type="submit"
			form={ids.form}
			aria-disabled={busy}
			aria-busy={busy ? 'true' : undefined}
		>
			{busy ? 'Wird gespeichert …' : creating ? 'Anlegen' : 'Speichern'}
		</button>
	{/snippet}

	<h2 id={ids.heading} tabindex="-1" bind:this={heading}>
		{rule === null ? 'Neue Regel' : rule.title}
	</h2>

	{#if leaving}
		<TicketLeaveQuestion
			title={creating ? 'Neue Regel verwerfen?' : 'Änderungen verwerfen?'}
			text="Die Eingaben gehen verloren."
			onstay={() => (leaving = null)}
			ondiscard={() => void discardAndLeave()}
		/>
	{/if}

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
								<a class="key-link" href={ticketHrefOf(open.id)} data-ticket-link={open.id}
									>{open.key}</a
								>
								<span class="open-title">{open.title}</span>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="open">
					Offenes Ticket:
					{#if openTickets[0]}
						<a
							class="key-link"
							href={ticketHrefOf(openTickets[0].id)}
							data-ticket-link={openTickets[0].id}>{openTickets[0].key}</a
						>
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
					aria-busy={toggling ? 'true' : undefined}
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
				statusAvailable={statusAvailable && !askStatus}
				{subtasksAvailable}
				{colorsAvailable}
				{invalidSubtasks}
				{oncreatetag}
				onprojectchosen={() => {
					stateError = null;
					fieldErrors = { ...fieldErrors, project: undefined };
				}}
			/>
			{#if askStatus}
				<InitialStatusChoice
					bind:value={
						() => chosenStatus,
						(chosen) => {
							chosenStatus = chosen;
							fieldErrors = { ...fieldErrors, initial_status: undefined };
						}
					}
					error={fieldErrors.initial_status ?? null}
				/>
			{/if}
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
		<p>{ruleDeleteText(rule.title, openKeys)}</p>
	</ConfirmDialog>
{/if}

<ConfirmDialog
	open={confirmingDiscard}
	title={creating ? 'Neue Regel verwerfen?' : 'Änderungen verwerfen?'}
	confirmLabel="Verwerfen"
	cancelLabel="Weiter bearbeiten"
	onconfirm={() => {
		confirmingDiscard = false;
		discarding = true;
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
