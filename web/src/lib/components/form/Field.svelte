<script lang="ts" module>
	/** What a field hands to its control; the control spreads it: `<input {...control} />`. */
	export interface FieldControl {
		readonly id: string;
		readonly 'aria-describedby': string | undefined;
		readonly 'aria-invalid': 'true' | undefined;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';

	// One field of a form (UI-1, ADR-0060): the label above the control, then the error and the
	// hint, in the same sizes and gaps in every form. The field links them: the label names the
	// control (for/id), the error and the hint describe it (aria-describedby, the error first), and
	// it is invalid while there is an error (aria-invalid, ADR-0009). The control stays a native
	// input, select or textarea of the caller, so binding, focus and events stay where they are;
	// its look comes from base.css. Checkboxes, radios and switches carry their name in their own
	// label and need no field.
	let {
		label,
		hint,
		error = '',
		id,
		describedBy,
		width = 'full',
		control
	}: {
		/** Visible name of the control. */
		label: string;
		/** Help below the control: a text, or a snippet with links and code. */
		hint?: string | Snippet;
		/** Error at the field (ADR-0009); empty for none. */
		error?: string;
		/** ID of the control; generated when missing. */
		id?: string;
		/** Further IDs that describe the control, after the error and the hint. */
		describedBy?: string;
		/** "full": the control takes the width of the field (up to 32rem); "auto": its own width. */
		width?: 'full' | 'auto';
		control: Snippet<[FieldControl]>;
	} = $props();

	const uid = $props.id();
	const controlId = $derived(id ?? `${uid}-control`);
	const errorId = $derived(`${controlId}-error`);
	const hintId = $derived(`${controlId}-hint`);

	const attributes: FieldControl = $derived({
		id: controlId,
		'aria-describedby':
			[error === '' ? '' : errorId, hint === undefined ? '' : hintId, describedBy ?? '']
				.filter((part) => part !== '')
				.join(' ') || undefined,
		'aria-invalid': error === '' ? undefined : 'true'
	});
</script>

<div class="field" class:auto={width === 'auto'}>
	<label class="label" for={controlId}>{label}</label>
	{@render control(attributes)}
	{#if error !== ''}
		<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
	{/if}
	{#if hint !== undefined}
		<p class="hint" id={hintId}>
			{#if typeof hint === 'string'}{hint}{:else}{@render hint()}{/if}
		</p>
	{/if}
</div>

<style>
	.field {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.25rem;
		align-content: start;
		min-width: 0;
		max-width: 32rem;
	}

	/* A control of its own width (date, number, code) stays at the start of the field. */
	.auto {
		justify-items: start;
	}

	/* As in the dialogs of the app: the label quieter than the value, the value in the text color. */
	.label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
