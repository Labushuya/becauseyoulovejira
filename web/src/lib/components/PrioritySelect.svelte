<script lang="ts">
	import { PRIORITY_LABELS } from '$lib/domain/labels';
	import { PRIORITIES } from '$lib/domain/status';
	import type { FieldControl } from './form/Field.svelte';

	// Priority of the panel and the new ticket form (E2 plan, T-7 and T-8), from urgent to low.
	// In a form the select stands in a Field (ADR-0060, RG-1): `field` gives its ID, description and
	// invalid state, and the field shows label, error and hint.
	let {
		id,
		field,
		value,
		busy = false,
		disabled = false,
		error = null,
		errorId,
		onchoose
	}: {
		value: string;
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
		  }
		| { field?: undefined; id: string; error?: string | null; errorId: string }
	) = $props();

	const ORDER = [...PRIORITIES].reverse();

	/** ID, description and invalid state: of the field, or from the own props. */
	const attributes: FieldControl = $derived(
		field ?? {
			id: id ?? '',
			'aria-describedby': error ? errorId : undefined,
			'aria-invalid': error ? 'true' : undefined
		}
	);
</script>

<select
	{...attributes}
	{value}
	aria-busy={busy ? 'true' : undefined}
	{disabled}
	onchange={(event) => onchoose(event.currentTarget.value)}
>
	{#each ORDER as priority (priority)}
		<option value={priority}>{PRIORITY_LABELS[priority]}</option>
	{/each}
</select>
