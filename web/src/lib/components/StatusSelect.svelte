<script lang="ts">
	import { STATUS_LABELS } from '$lib/domain/labels';
	import { STATUSES } from '$lib/domain/status';

	// Status of the panel (E2 plan, T-7): saves at once when chosen. "Erledigt" works like the
	// check mark of the list. The store decides what it shows: after a choice it shows `value`
	// again, which is the chosen status while it is saved, or the old one when a question comes
	// first (open blocking sub-tasks, ADR-0033 section 2).
	let {
		id,
		value,
		busy = false,
		disabled = false,
		error = null,
		errorId,
		onchoose
	}: {
		id: string;
		value: string;
		/** A save is running; the select stays usable, so the keyboard focus stays on it. */
		busy?: boolean;
		disabled?: boolean;
		error?: string | null;
		errorId: string;
		onchoose: (value: string) => void;
	} = $props();

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
	aria-describedby={error ? errorId : undefined}
	{disabled}
	onchange={changed}
>
	{#each STATUSES as status (status)}
		<option value={status}>{STATUS_LABELS[status]}</option>
	{/each}
</select>
