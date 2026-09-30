<script lang="ts">
	import { STATUS_LABELS } from '$lib/domain/labels';
	import { STATUSES, type Status } from '$lib/domain/status';

	// Status of the panel (E2 plan, T-7): saves at once when chosen. "Erledigt" works like the
	// check mark of the list. The store decides what it shows: after a choice it shows `value`
	// again, which is the chosen status while it is saved, or the old one when a question comes
	// first (open blocking sub-tasks, ADR-0033 section 2). "Status beim Anlegen" of a template
	// offers only the statuses of an open ticket (`statuses`, plan WV).
	let {
		id,
		value,
		statuses = STATUSES,
		busy = false,
		disabled = false,
		error = null,
		errorId,
		describedby,
		onchoose
	}: {
		id: string;
		value: string;
		/** Statuses to offer, in this order; all of them by default. */
		statuses?: readonly Status[];
		/** A save is running; the select stays usable, so the keyboard focus stays on it. */
		busy?: boolean;
		disabled?: boolean;
		error?: string | null;
		errorId: string;
		/** ID of a hint that describes the select, besides the error. */
		describedby?: string;
		onchoose: (value: string) => void;
	} = $props();

	const description = $derived(
		[describedby, error ? errorId : undefined].filter((part) => part !== undefined).join(' ') ||
			undefined
	);

	function changed(event: Event & { currentTarget: HTMLSelectElement }) {
		const select = event.currentTarget;
		onchoose(select.value);
		select.value = value;
	}
</script>

<select
	{id}
	{value}
	aria-busy={busy ? 'true' : undefined}
	aria-invalid={error ? 'true' : undefined}
	aria-describedby={description}
	{disabled}
	onchange={changed}
>
	{#each statuses as status (status)}
		<option value={status}>{STATUS_LABELS[status]}</option>
	{/each}
</select>
