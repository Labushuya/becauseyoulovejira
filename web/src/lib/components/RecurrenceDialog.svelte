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
	import RecurrenceForm from './RecurrenceForm.svelte';

	// "Wiederholen…" and "Regel bearbeiten" as a native modal <dialog> (E5 plan, package 4): focus
	// trap and Escape come from the browser, the focus starts on the first field, and the parent
	// returns it to the button that opened the dialog. The input is checked with the rules of the
	// hook before it is sent; field errors of the server stand at their field, any other refusal
	// as a message (ADR-0009). Nothing is saved without "Speichern".
	let {
		heading,
		initial,
		today,
		withoutDue = false,
		submitLabel,
		onsave,
		onclose
	}: {
		heading: string;
		initial: RecurrenceFormValues;
		today: CalendarDate;
		/** The ticket has no due date: the form names the first date it gets. */
		withoutDue?: boolean;
		submitLabel: string;
		onsave: (values: RecurrenceFormValues) => Promise<EditResult<unknown>>;
		/** Cancel, or after saving. */
		onclose: () => void;
	} = $props();

	const uid = $props.id();

	let values = $state<RecurrenceFormValues>(
		untrack(() => ({ ...initial, weekdays: [...initial.weekdays] }))
	);
	let errors = $state<Partial<Record<RecurrenceFormField, string>>>({});
	let message = $state<string | null>(null);
	let busy = $state(false);
	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		const element = dialog;
		if (element === undefined || element.open) return;
		element.showModal();
		void tick().then(() => element.querySelector<HTMLElement>('input:checked, input')?.focus());
		return () => {
			if (element.open) element.close();
		};
	});

	function close() {
		if (!busy) onclose();
	}

	function onDialogCancel(event: Event) {
		event.preventDefault();
		close();
	}

	function onkeydown(event: KeyboardEvent) {
		// Escape stays in the dialog: the panel behind must not close as well.
		if (event.key === 'Escape') event.stopPropagation();
	}

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
		dialog?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
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

<dialog
	class="recurrence-dialog"
	bind:this={dialog}
	aria-labelledby={`${uid}-title`}
	aria-busy={busy}
	oncancel={onDialogCancel}
	{onkeydown}
>
	<h2 id={`${uid}-title`}>{heading}</h2>
	<form class="form" novalidate onsubmit={save}>
		<RecurrenceForm bind:values {errors} {today} {withoutDue} />
		{#if message}
			<div class="alert-error" role="alert"><ErrorIcon /><span>{message}</span></div>
		{/if}
		<div class="buttons">
			<button class="secondary" type="button" aria-disabled={busy} onclick={close}>
				Abbrechen
			</button>
			<button class="button-primary action" type="submit" aria-disabled={busy}>
				{busy ? 'Wird gespeichert …' : submitLabel}
			</button>
		</div>
	</form>
</dialog>

<style>
	.recurrence-dialog {
		width: min(32rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		margin: auto;
		padding: 1.25rem;
		overflow: auto;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.recurrence-dialog[open] {
		display: grid;
		gap: 0.875rem;
	}

	/* Veils the page in the background color of the mode (no extra color token). */
	.recurrence-dialog::backdrop {
		background: var(--color-bg);
		opacity: 0.75;
	}

	h2 {
		font-size: 1rem;
		font-weight: 600;
	}

	.form {
		display: grid;
		gap: 0.875rem;
	}

	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.secondary {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.action {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
	}

	[aria-disabled='true'] {
		cursor: progress;
		opacity: 0.75;
	}
</style>
