<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		defaultFormValues,
		formValuesOf,
		isWaiting,
		joinedSeries,
		nextTicketText,
		openBlockText,
		parseSkipped,
		ruleText,
		skippedText,
		SKIPPED_FIELD,
		type OpenInstance,
		type RecurrenceFormValues
	} from '$lib/domain/recurrence-rule';
	import {
		DEFAULT_TEMPLATE_STATUS,
		templateOf,
		templateSummary,
		ticketTemplate,
		type RuleTemplate,
		type TemplateNames,
		type TemplateStatus
	} from '$lib/domain/series-template';
	import type { HistoryEntry, ProjectRef, TagRef, Ticket } from '$lib/domain/ticket';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import { RECURRENCE_UNAVAILABLE, type RecurrenceStore } from '$lib/stores/recurrence.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import RecurrenceBacklogQuestion from './RecurrenceBacklogQuestion.svelte';
	import RecurrenceDialog from './RecurrenceDialog.svelte';
	import RecurrenceTemplateFields from './RecurrenceTemplateFields.svelte';

	/** What the template needs of the catalog (the CatalogStore of the app). */
	interface TemplateCatalog {
		readonly activeProjects: readonly ProjectRef[];
		readonly tags: readonly TagRef[];
		projectById(id: string): ProjectRef | null;
		tagById(id: string): TagRef | null;
		ensureTag(name: string): Promise<EnsureTagResult>;
	}

	// Recurrence of the ticket in the panel (E5 plan, package 4). A ticket in a series shows
	// "Wiederholt sich: jeden Montag · Nächstes Ticket am 28.09." with "Regel bearbeiten",
	// "Pausieren" or "Fortsetzen" and "Aus der Serie lösen"; an open ticket without a series offers
	// "Wiederholen…". Actions work at once and are announced as flags by the store; a paused rule
	// shows its hint neutrally, a refused request as an error (ADR-0009). "Wiederholen…" may come
	// prepared from a calendar series (E5 plan, package 6; store.offerRepeat): from the inbox panel it
	// opens at once, after a failed conversion the panel shows why and offers the prepared dialog.
	// "Wiederholen…" asks with which status the next tickets start (ADR-0022 addendum 9), without
	// an answer in advance; only an answer the user gave before the failed rule comes prepared.
	// The template of the series (plan WV): "Künftige Tickets: Priorität Hoch · …" with
	// "Bearbeiten", which edits it inline here, not in a dialog (the full view is one already,
	// ADR-0025 section 3). Its draft lives in the store, so panel and full view share it and leaving
	// the ticket asks first; Escape or "Abbrechen" drop it.
	let {
		ticket,
		store,
		catalog,
		today,
		history = [],
		openTickets = [],
		onticket
	}: {
		ticket: Ticket;
		store: RecurrenceStore;
		/** Projects and tags for the template. */
		catalog: TemplateCatalog;
		today: CalendarDate;
		/** Open tickets of the series of the ticket, oldest first (recommendation 6). */
		openTickets?: readonly OpenInstance[];
		/**
		 * History of the ticket as the panel loaded it; a catch-up ticket finds its note about the
		 * missed dates there (ADR-0022 addendum 4).
		 */
		history?: readonly HistoryEntry[];
		/** The ticket after joining or leaving its series, for panel and list. */
		onticket: (ticket: Ticket) => void;
	} = $props();

	const uid = $props.id();
	const rule = $derived(store.ruleById(ticket.recurrenceId));
	const text = $derived(rule === null ? '' : ruleText(rule));
	const skipped = $derived.by(() => {
		const entry = history.find((item) => item.ticket === ticket.id && item.field === SKIPPED_FIELD);
		return entry === undefined ? null : parseSkipped(entry.newValue);
	});

	const initialOffer = untrack(() =>
		ticket.recurring || ticket.status === 'done' ? null : store.takeOffer(ticket.id)
	);
	/** Offer taken for this ticket; it prepares "Wiederholen…" until a rule exists. */
	let offer = $state(initialOffer);
	const prepared = $derived(offer !== null && offer.ticketId === ticket.id ? offer : null);

	let dialog = $state<'create' | 'edit' | null>(
		initialOffer !== null && initialOffer.message === null ? 'create' : null
	);
	let busy = $state(false);
	let error = $state<string | null>(initialOffer?.message ?? null);

	// The modal returns the focus to its opener, or to the heading of the view when the opener is
	// gone (after "Wiederholen…" the button gives way to the summary; ADR-0025 section 3).
	function closeDialog() {
		dialog = null;
	}

	async function repeat(values: RecurrenceFormValues, initialStatus: TemplateStatus | null) {
		const result = await store.repeat(ticket, { values, initialStatus });
		if (result.ok) {
			offer = null;
			error = null;
			onticket(joinedSeries(ticket, result.value.id, values, today));
		}
		return result;
	}

	/** Runs one action of the summary; a refusal shows as an error with its reason. */
	async function act(action: () => Promise<EditResult<unknown>>) {
		if (busy) return;
		busy = true;
		error = null;
		try {
			const result = await action();
			if (!result.ok) error = result.message ?? Object.values(result.fields)[0] ?? null;
		} finally {
			busy = false;
		}
	}

	async function detach() {
		await act(async () => {
			const result = await store.detach(ticket.id);
			if (result.ok) onticket(result.value);
			return result;
		});
	}

	// --- The template (plan WV) -------------------------------------------------------------------

	const names: TemplateNames = {
		project: (id) => catalog.projectById(id)?.name ?? null,
		tag: (id) => catalog.tagById(id)?.name ?? null
	};
	/** "Priorität Hoch · …" of the next tickets of the series. */
	const summary = $derived(
		rule === null ? '' : templateSummary(templateOf(rule), names, store.statusReady)
	);
	/**
	 * What "Wiederholen…" takes from this ticket, named in the dialog; the status is asked there
	 * ("Folgetickets starten mit", ADR-0022 addendum 9), so the sentence leaves it out.
	 */
	const repeatNote = $derived(
		`Künftige Tickets bekommen die Werte dieses Tickets: ${templateSummary(ticketTemplate(ticket, DEFAULT_TEMPLATE_STATUS), names, false)}. Ändern kannst du sie danach hier unter „Wiederholt sich“.`
	);
	/** The draft of the template of this series, while it is edited. */
	const draft = $derived(
		rule !== null && store.templateDraft?.ruleId === rule.id ? store.templateDraft : null
	);

	type TemplateError = 'title' | 'description' | 'priority' | 'project' | 'tags' | 'initial_status';
	const TEMPLATE_ERRORS: readonly string[] = [
		'title',
		'description',
		'priority',
		'project',
		'tags',
		'initial_status'
	];
	let templateErrors = $state<Partial<Record<TemplateError, string>>>({});
	let templateMessage = $state<string | null>(null);
	let templateBusy = $state(false);
	let editButton = $state<HTMLButtonElement>();
	let templateTitle = $state<HTMLInputElement>();
	let templateForm = $state<HTMLFormElement>();

	async function editTemplate() {
		if (rule === null) return;
		templateErrors = {};
		templateMessage = null;
		store.editTemplate(rule.id);
		await tick();
		templateTitle?.focus();
	}

	/** "Abbrechen" and Escape: the draft goes, the focus returns to "Bearbeiten". */
	async function endTemplate() {
		if (templateBusy) return;
		store.cancelTemplate();
		templateErrors = {};
		templateMessage = null;
		await tick();
		editButton?.focus();
	}

	async function saveTemplate(event: SubmitEvent) {
		event.preventDefault();
		const current = store.templateDraft;
		if (templateBusy || current === null) return;
		templateMessage = null;
		templateErrors =
			current.template.title.trim() === '' ? { title: 'Bitte einen Titel eingeben.' } : {};
		if (Object.keys(templateErrors).length === 0) {
			templateBusy = true;
			try {
				// Only tags the catalog knows: a tag may have been deleted since.
				const result = await store.saveTemplate((tagId) => catalog.tagById(tagId) !== null);
				if (result.ok) {
					await tick();
					editButton?.focus();
					return;
				}
				const errors: Partial<Record<TemplateError, string>> = {};
				const others: string[] = [];
				for (const [field, text] of Object.entries(result.fields)) {
					if (TEMPLATE_ERRORS.includes(field)) errors[field as TemplateError] = text;
					else others.push(text);
				}
				templateErrors = errors;
				templateMessage = result.message ?? others[0] ?? null;
			} finally {
				templateBusy = false;
			}
		}
		await tick();
		templateForm?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	/** Escape in the editor ends it, unless a field inside used it (tag list, text editor). */
	function templateKeys(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		event.stopPropagation();
		void endTemplate();
	}

	function setTemplate(template: RuleTemplate, tagText: string) {
		store.setTemplateDraft(template, tagText);
	}
</script>

<section class="recurrence" aria-labelledby={`${uid}-title`}>
	<h3 id={`${uid}-title`} class="visually-hidden">Wiederholung</h3>
	{#if ticket.recurring}
		<p class="line">
			<span>Wiederholt sich{text === '' ? '' : `: ${text}`}</span>
			{#if rule !== null}
				<span aria-hidden="true">·</span>
				<span
					>{nextTicketText(
						rule,
						today,
						openTickets.map((open) => open.key)
					)}</span
				>
				{#if rule.eachOccurrence === true}
					<span aria-hidden="true">·</span>
					<span>jeder Termin einzeln</span>
				{/if}
			{/if}
		</p>
		{#if skipped !== null}
			<SectionMessage tone="info" compact>
				{skippedText(skipped, today)}; dieses Ticket steht für sie mit.
			</SectionMessage>
		{/if}
		{#if rule !== null && !rule.eachOccurrence && rule.active && openTickets.length > 1}
			<!-- The switch went off while several were open (recommendation 6). -->
			<SectionMessage tone="info" compact>
				{openBlockText(openTickets.map((open) => open.key))}
			</SectionMessage>
		{/if}
		{#if rule !== null && isWaiting(rule)}
			{@const current = rule}
			<RecurrenceBacklogQuestion
				rule={current}
				{today}
				{busy}
				ondecide={(choice) => act(() => store.decideBacklog(current.id, choice, today))}
			/>
		{:else if rule !== null && rule.lastHint !== ''}
			<SectionMessage tone="info" compact>{rule.lastHint}</SectionMessage>
		{/if}
		{#if rule !== null}
			<div class="template">
				<p class="template-line">
					<span>Künftige Tickets: {summary}</span>
					{#if draft === null}
						<button
							class="small"
							type="button"
							aria-label="Vorlage bearbeiten"
							bind:this={editButton}
							onclick={() => void editTemplate()}
						>
							Bearbeiten
						</button>
					{/if}
				</p>
				{#if draft !== null}
					{@const current = draft}
					<!-- Escape from any field of the editor ends it (the keys stay with the fields). -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<form
						class="template-form"
						aria-label="Vorlage der künftigen Tickets"
						novalidate
						aria-busy={templateBusy ? 'true' : undefined}
						onsubmit={saveTemplate}
						onkeydown={templateKeys}
						bind:this={templateForm}
					>
						<RecurrenceTemplateFields
							bind:values={
								() => current.template, (template) => setTemplate(template, current.tagText)
							}
							bind:tagText={() => current.tagText, (text) => setTemplate(current.template, text)}
							bind:titleInput={templateTitle}
							errors={templateErrors}
							projects={catalog.activeProjects}
							tags={catalog.tags}
							currentProject={current.template.projectId === null
								? null
								: catalog.projectById(current.template.projectId)}
							busy={templateBusy}
							statusAvailable={store.statusReady}
							oncreatetag={(name) => catalog.ensureTag(name)}
						/>
						<p class="hint">
							Gilt für die künftigen Tickets der Serie; dieses Ticket bleibt, wie es ist.
						</p>
						{#if templateMessage}
							<div class="alert-error" role="alert">
								<ErrorIcon /><span>{templateMessage}</span>
							</div>
						{/if}
						<div class="form-actions">
							<button class="button-secondary" type="button" onclick={() => void endTemplate()}>
								Abbrechen
							</button>
							<button
								class="button-primary"
								type="submit"
								aria-disabled={templateBusy}
								aria-busy={templateBusy ? 'true' : undefined}
							>
								{templateBusy ? 'Wird gespeichert …' : 'Vorlage speichern'}
							</button>
						</div>
					</form>
				{/if}
			</div>
		{/if}
		<div class="actions" aria-busy={busy ? 'true' : undefined}>
			{#if rule !== null}
				{@const current = rule}
				<button
					class="small"
					type="button"
					aria-haspopup="dialog"
					onclick={() => (dialog = 'edit')}
				>
					Regel bearbeiten
				</button>
				<button
					class="small"
					type="button"
					aria-disabled={busy}
					onclick={() => act(() => store.setActive(current.id, !current.active))}
				>
					{current.active ? 'Pausieren' : 'Fortsetzen'}
				</button>
			{/if}
			<button class="small" type="button" aria-disabled={busy} onclick={detach}>
				Aus der Serie lösen
			</button>
		</div>
	{:else if store.state === 'unavailable'}
		<SectionMessage tone="info" compact>{RECURRENCE_UNAVAILABLE}</SectionMessage>
	{:else if ticket.status !== 'done'}
		<button class="small" type="button" aria-haspopup="dialog" onclick={() => (dialog = 'create')}>
			Wiederholen…
		</button>
	{/if}
	{#if error}
		<div class="alert-error" role="alert"><ErrorIcon /><span>{error}</span></div>
	{/if}
</section>

{#if dialog === 'create'}
	<RecurrenceDialog
		heading="Wiederholen…"
		initial={prepared?.values ?? defaultFormValues(ticket.due, today)}
		note={repeatNote}
		{today}
		withoutDue={ticket.due === null}
		eachAvailable={store.eachReady}
		context={{ kind: 'ticket', due: ticket.due }}
		askStatus={store.statusReady}
		ticketStatus={ticket.status}
		initialStatus={prepared?.initialStatus ?? null}
		submitLabel="Wiederholung anlegen"
		onsave={repeat}
		onclose={closeDialog}
	/>
{:else if dialog === 'edit' && rule !== null}
	{@const current = rule}
	<RecurrenceDialog
		heading="Regel bearbeiten"
		initial={formValuesOf(current, today)}
		{today}
		eachAvailable={store.eachReady}
		context={{ kind: 'rule', nextDue: current.nextDue, each: current.eachOccurrence === true }}
		openKeys={openTickets.map((open) => open.key)}
		submitLabel="Speichern"
		onsave={(values) => store.saveRhythm(current.id, values)}
		onclose={closeDialog}
	/>
{/if}

<style>
	.recurrence {
		display: grid;
		gap: 0.375rem;
		font-size: var(--font-size-body);
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.actions,
	.form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.template {
		display: grid;
		gap: 0.5rem;
	}

	.template-line {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: baseline;
	}

	.template-line > span {
		color: var(--color-text-muted);
	}

	.template-form {
		display: grid;
		gap: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.form-actions {
		justify-content: flex-end;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.small {
		width: fit-content;
		padding: 0.125rem 0.625rem;
		font-size: var(--font-size-control);
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	[aria-disabled='true'] {
		cursor: not-allowed;
		opacity: 0.75;
	}

	/* Locked because an action of the series or the template runs (ADR-0026, addendum of 2026-09-30). */
	[aria-busy='true'] [aria-disabled='true'],
	[aria-busy='true'][aria-disabled='true'] {
		cursor: progress;
	}
</style>
