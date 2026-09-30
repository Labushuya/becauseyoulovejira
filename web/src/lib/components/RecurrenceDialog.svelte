<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		INITIAL_STATUS_REQUIRED,
		SERVER_FIELDS,
		formErrors,
		type RecurrenceFormContext,
		type RecurrenceFormField,
		type RecurrenceFormValues
	} from '$lib/domain/recurrence-rule';
	import type { TemplateStatus } from '$lib/domain/series-template';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import { insideModal } from '$lib/overlay/modal-context';
	import ErrorIcon from './ErrorIcon.svelte';
	import InitialStatusChoice from './InitialStatusChoice.svelte';
	import InlineDialog from './InlineDialog.svelte';
	import Modal from './overlay/Modal.svelte';
	import RecurrenceForm from './RecurrenceForm.svelte';

	// "Wiederholen…" and "Regel bearbeiten" (E5 plan, package 4) on the modal building block
	// (ADR-0025 section 3, size M; plan UI-4): the focus starts on the chosen kind of repetition and
	// goes back to the opener on closing. The input is checked with the rules of the hook before it
	// is sent; field errors of the server stand at their field, any other refusal as a message
	// (ADR-0009). Nothing is saved without the primary button.
	// "Wiederholen…" asks "Folgetickets starten mit" after the rhythm (`askStatus`, ADR-0022
	// addendum 9): a required choice without an answer in advance; "Regel bearbeiten" does not ask
	// again (the status of the rule is edited with its template).
	// Inside a modal (the full view) no dialog opens (ADR-0025 section 3, addendum 16): the same form
	// stands inline as an unfolded area (InlineDialog) where the owner renders it, with the same
	// rules for Escape, "Abbrechen", focus and a running save.
	let {
		heading,
		initial,
		note = null,
		today,
		withoutDue = false,
		eachAvailable = false,
		context,
		openKeys = [],
		askStatus = false,
		ticketStatus = null,
		initialStatus = null,
		submitLabel,
		returnFocus,
		onsave,
		onclose
	}: {
		heading: string;
		initial: RecurrenceFormValues;
		/** A hint above the question of the status, e.g. what the next tickets take from the ticket. */
		note?: string | null;
		today: CalendarDate;
		/** The ticket has no due date: the form names the first date it gets. */
		withoutDue?: boolean;
		/** Offer "Jeden Termin einzeln anlegen" (plan OR-5, RecurrenceStore.eachReady). */
		eachAvailable?: boolean;
		/** Ticket or rule the form belongs to (question about a backlog, ADR-0022 addendum 5). */
		context?: RecurrenceFormContext;
		/** Keys of the open tickets of the rule (hint when the switch goes off). */
		openKeys?: readonly string[];
		/** Ask "Folgetickets starten mit" (after the migration, RecurrenceStore.statusReady). */
		askStatus?: boolean;
		/** Status of the ticket, offered as "Wie dieses Ticket: …". */
		ticketStatus?: string | null;
		/** An answer the user gave before (a prepared "Wiederholen…" after a failed rule). */
		initialStatus?: TemplateStatus | null;
		submitLabel: string;
		/** Inline only: where the focus goes on closing when the opener is gone. */
		returnFocus?: () => HTMLElement | null | undefined;
		/** The rhythm and the answer to the question (null when it was not asked). */
		onsave: (
			values: RecurrenceFormValues,
			initialStatus: TemplateStatus | null
		) => Promise<EditResult<unknown>>;
		/** Cancel, or after saving. */
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;
	/** In the full view (a modal) the form stands inline instead of in a dialog of its own. */
	const inline = insideModal();

	let values = $state<RecurrenceFormValues>(
		untrack(() => ({ ...initial, weekdays: [...initial.weekdays] }))
	);
	let status = $state<TemplateStatus | ''>(untrack(() => initialStatus ?? ''));
	let errors = $state<Partial<Record<RecurrenceFormField, string>>>({});
	let statusError = $state<string | null>(null);
	let message = $state<string | null>(null);
	let busy = $state(false);
	let form = $state<HTMLFormElement>();

	/** Server field errors of the form's fields and of the question, the rest as one message. */
	function fromServer(fields: Readonly<Record<string, string>>): void {
		const mapped: Partial<Record<RecurrenceFormField, string>> = {};
		const others: string[] = [];
		statusError = null;
		for (const [field, text] of Object.entries(fields)) {
			const formField = (Object.keys(SERVER_FIELDS) as RecurrenceFormField[]).find(
				(candidate) => SERVER_FIELDS[candidate] === field
			);
			if (formField !== undefined) mapped[formField] = text;
			else if (field === 'initial_status' && askStatus) statusError = text;
			else others.push(text);
		}
		errors = mapped;
		message = others[0] ?? null;
	}

	async function focusFirstError() {
		await tick();
		form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		message = null;
		errors = formErrors(values);
		statusError = askStatus && status === '' ? INITIAL_STATUS_REQUIRED : null;
		if (Object.keys(errors).length > 0 || statusError !== null) {
			await focusFirstError();
			return;
		}
		busy = true;
		try {
			const result = await onsave(values, askStatus && status !== '' ? status : null);
			if (result.ok) {
				onclose();
				return;
			}
			fromServer(result.fields);
			if (result.message !== null) message = result.message;
		} finally {
			busy = false;
		}
		await focusFirstError();
	}
</script>

{#snippet content()}
	<form id={formId} class="form" novalidate onsubmit={save} bind:this={form}>
		<RecurrenceForm
			bind:values
			{errors}
			{today}
			{withoutDue}
			{eachAvailable}
			{context}
			{openKeys}
		/>
		{#if note}
			<p class="hint">{note}</p>
		{/if}
		{#if askStatus}
			<InitialStatusChoice
				bind:value={
					() => status,
					(chosen) => {
						status = chosen;
						statusError = null;
					}
				}
				{ticketStatus}
				error={statusError}
			/>
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
		{busy ? 'Wird gespeichert …' : submitLabel}
	</button>
{/snippet}

{#if inline}
	<InlineDialog
		open
		title={heading}
		{busy}
		initialFocus={form?.querySelector<HTMLElement>('input:checked') ?? null}
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
		title={heading}
		{busy}
		initialFocus={form?.querySelector<HTMLElement>('input:checked') ?? null}
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

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
