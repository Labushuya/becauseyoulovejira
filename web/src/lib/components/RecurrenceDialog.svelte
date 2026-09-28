<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		SERVER_FIELDS,
		formErrors,
		type RecurrenceFormField,
		type RecurrenceFormValues
	} from '$lib/domain/recurrence-rule';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import ErrorIcon from './ErrorIcon.svelte';
	import Modal from './overlay/Modal.svelte';
	import RecurrenceForm from './RecurrenceForm.svelte';

	// "Wiederholen…" and "Regel bearbeiten" (E5 plan, package 4) on the modal building block
	// (ADR-0025 section 3, size M; plan UI-4): the focus starts on the chosen kind of repetition and
	// goes back to the opener on closing. The input is checked with the rules of the hook before it
	// is sent; field errors of the server stand at their field, any other refusal as a message
	// (ADR-0009). Nothing is saved without the primary button.
	let {
		heading,
		initial,
		today,
		withoutDue = false,
		eachAvailable = false,
		submitLabel,
		onsave,
		onclose
	}: {
		heading: string;
		initial: RecurrenceFormValues;
		today: CalendarDate;
		/** The ticket has no due date: the form names the first date it gets. */
		withoutDue?: boolean;
		/** Offer "Jeden Termin einzeln anlegen" (plan OR-5, RecurrenceStore.eachReady). */
		eachAvailable?: boolean;
		submitLabel: string;
		onsave: (values: RecurrenceFormValues) => Promise<EditResult<unknown>>;
		/** Cancel, or after saving. */
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;

	let values = $state<RecurrenceFormValues>(
		untrack(() => ({ ...initial, weekdays: [...initial.weekdays] }))
	);
	let errors = $state<Partial<Record<RecurrenceFormField, string>>>({});
	let message = $state<string | null>(null);
	let busy = $state(false);
	let form = $state<HTMLFormElement>();

	/** Server field errors of the form's fields, the rest as one message. */
	function fromServer(fields: Readonly<Record<string, string>>): void {
		const mapped: Partial<Record<RecurrenceFormField, string>> = {};
		const others: string[] = [];
		for (const [field, text] of Object.entries(fields)) {
			const formField = (Object.keys(SERVER_FIELDS) as RecurrenceFormField[]).find(
				(candidate) => SERVER_FIELDS[candidate] === field
			);
			if (formField === undefined) others.push(text);
			else mapped[formField] = text;
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
		if (Object.keys(errors).length > 0) {
			await focusFirstError();
			return;
		}
		busy = true;
		try {
			const result = await onsave(values);
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

<Modal
	open
	size="m"
	title={heading}
	{busy}
	initialFocus={form?.querySelector<HTMLElement>('input:checked') ?? null}
	onclose={() => onclose()}
>
	<form id={formId} class="form" novalidate onsubmit={save} bind:this={form}>
		<RecurrenceForm bind:values {errors} {today} {withoutDue} {eachAvailable} />
		{#if message}
			<div class="alert-error" role="alert"><ErrorIcon /><span>{message}</span></div>
		{/if}
	</form>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" aria-disabled={busy} onclick={close}>
			Abbrechen
		</button>
		<button class="button-primary" type="submit" form={formId} aria-disabled={busy}>
			{busy ? 'Wird gespeichert …' : submitLabel}
		</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: grid;
		gap: 0.875rem;
	}
</style>
