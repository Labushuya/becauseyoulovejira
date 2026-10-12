<script lang="ts">
	import { STATUS_LABELS } from '$lib/domain/labels';
	import { STATUSES, type Status } from '$lib/domain/status';
	import type { FieldControl } from './form/Field.svelte';

	// Status of the panel (E2 plan, T-7): saves at once when chosen. "Erledigt" works like the
	// check mark of the list. The store decides what it shows: after a choice it shows `value`
	// again, which is the chosen status while it is saved, or the old one when a question comes
	// first (open blocking sub-tasks, ADR-0033 section 2). "Status beim Anlegen" of a template
	// offers only the statuses of an open ticket (`statuses`, plan WV).
	// In a form the select stands in a Field (ADR-0060, RG-1): `field` gives its ID, description and
	// invalid state, and the field shows label, error and hint. A required choice without an answer
	// in advance ("Status beim Anlegen" of a new rule, ADR-0022 addendum 9) shows `placeholder` as an
	// empty first option while nothing is chosen; `labels` names single statuses in their own words
	// ("In Arbeit (wie dieses Ticket)").
	let {
		id,
		field,
		value,
		statuses = STATUSES,
		labels = {},
		placeholder,
		required = false,
		busy = false,
		disabled = false,
		error = null,
		errorId,
		describedby,
		onchoose
	}: {
		/** The chosen status; '' only with `placeholder` (nothing chosen yet). */
		value: string;
		/** Statuses to offer, in this order; all of them by default. */
		statuses?: readonly Status[];
		/** Own names of single statuses; the others keep their usual name. */
		labels?: Partial<Record<Status, string>>;
		/** Text of the empty first option while `value` is '' (a choice without an answer in advance). */
		placeholder?: string;
		/** An answer is required (aria-required). */
		required?: boolean;
		/** A save is running; the select stays usable, so the keyboard focus stays on it. */
		busy?: boolean;
		disabled?: boolean;
		onchoose: (value: string) => void;
	} & (
		| {
				/** In a Field: ID, description and invalid state come from the field. */
				field: FieldControl;
				id?: undefined;
				error?: undefined;
				errorId?: undefined;
				describedby?: undefined;
		  }
		| {
				field?: undefined;
				id: string;
				error?: string | null;
				errorId: string;
				/** ID of a hint that describes the select, besides the error. */
				describedby?: string;
		  }
	) = $props();

	/** ID, description and invalid state: of the field, or from the own props. */
	const attributes: FieldControl = $derived(
		field ?? {
			id: id ?? '',
			'aria-describedby':
				[describedby, error ? errorId : undefined].filter((part) => part !== undefined).join(' ') ||
				undefined,
			'aria-invalid': error ? 'true' : undefined
		}
	);

	function changed(event: Event & { currentTarget: HTMLSelectElement }) {
		const select = event.currentTarget;
		onchoose(select.value);
		select.value = value;
	}
</script>

<select
	{...attributes}
	{value}
	{required}
	aria-required={required ? 'true' : undefined}
	aria-busy={busy ? 'true' : undefined}
	{disabled}
	onchange={changed}
>
	{#if placeholder !== undefined && value === ''}
		<option value="" disabled>{placeholder}</option>
	{/if}
	{#each statuses as status (status)}
		<option value={status}>{labels[status] ?? STATUS_LABELS[status]}</option>
	{/each}
</select>
